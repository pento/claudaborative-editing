import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WP_BASE_URL = process.env.WP_BASE_URL ?? 'http://127.0.0.1:8889';
export const WP_ADMIN_USER = process.env.WP_E2E_ADMIN_USER ?? 'admin';
export const WP_ADMIN_PASSWORD =
	process.env.WP_E2E_ADMIN_PASSWORD ?? 'password';

const PLAYGROUND_PORT = Number.parseInt(
	new URL(WP_BASE_URL).port || '8889',
	10
);

const REPO_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../..'
);
// Include a hash of the repo root to avoid collisions between concurrent
// e2e runs from different checkouts on the same machine.
const repoHash = createHash('md5').update(REPO_ROOT).digest('hex').slice(0, 8);
const STATE_FILE = path.join(
	tmpdir(),
	`claudaborative-editing-e2e-playground-${repoHash}.json`
);

interface PlaygroundState {
	appPassword?: string;
	playgroundPid?: number;
}

function readState(): PlaygroundState {
	if (!existsSync(STATE_FILE)) {
		return {};
	}
	try {
		return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as PlaygroundState;
	} catch {
		return {};
	}
}

function writeState(state: PlaygroundState): void {
	// 0o600 — the state file holds the shared admin application password.
	// Restrict to the current user so the credential isn't world-readable on
	// shared CI boxes or dev machines.
	writeFileSync(STATE_FILE, JSON.stringify(state), { mode: 0o600 });
}

export async function waitForWordPress(
	timeoutMs: number = 180_000
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	let lastError: unknown;

	while (Date.now() < deadline) {
		try {
			const response = await fetch(`${WP_BASE_URL}/wp-login.php`, {
				redirect: 'manual',
			});
			if (response.ok || response.status === 302) {
				return;
			}
			lastError = new Error(`Unexpected status: ${response.status}`);
		} catch (error) {
			lastError = error;
		}

		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}

	throw new Error(
		`Timed out waiting for WordPress at ${WP_BASE_URL}: ${String(lastError)}`
	);
}

/**
 * Starts wp-playground-cli in server mode as a detached subprocess.
 *
 * NODE_USE_ENV_PROXY=1 is set so Node's built-in fetch respects HTTPS_PROXY
 * when the host is sandboxed (no-op outside a sandbox).
 */
function startPlaygroundSubprocess(): number {
	// npm installs the CLI under node_modules/.bin as a symlink on macOS/Linux
	// and as a .cmd shim on Windows; pick the right entry for the host OS.
	const cliBinary =
		process.platform === 'win32'
			? 'wp-playground-cli.cmd'
			: 'wp-playground-cli';
	const child = spawn(
		path.join(REPO_ROOT, 'node_modules', '.bin', cliBinary),
		[
			'server',
			`--mount-before-install=${REPO_ROOT}/wordpress-plugin:/wordpress/wp-content/plugins/claudaborative-editing`,
			`--mount-before-install=${REPO_ROOT}/tests/e2e/mu-plugins/disable-autofocus.php:/wordpress/wp-content/mu-plugins/disable-autofocus.php`,
			`--mount-before-install=${REPO_ROOT}/tests/e2e/mu-plugins/enable-app-passwords.php:/wordpress/wp-content/mu-plugins/enable-app-passwords.php`,
			`--blueprint=${REPO_ROOT}/playground/e2e.blueprint.json`,
			`--port=${PLAYGROUND_PORT}`,
			'--wp=latest',
			'--php=8.5',
		],
		{
			cwd: REPO_ROOT,
			env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
			detached: true,
			stdio: 'inherit',
		}
	);
	child.unref();
	if (!child.pid) {
		throw new Error('Failed to spawn wp-playground-cli');
	}
	return child.pid;
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

async function isPlaygroundResponding(): Promise<boolean> {
	try {
		const response = await fetch(`${WP_BASE_URL}/wp-login.php`, {
			redirect: 'manual',
			signal: AbortSignal.timeout(1_000),
		});
		return response.ok || response.status === 302;
	} catch {
		return false;
	}
}

/**
 * Parses Set-Cookie headers into a single `Cookie:` header value that can be
 * reused across fetch() calls. Node's built-in fetch has no cookie jar, so we
 * manually accumulate Set-Cookie entries.
 */
function accumulateCookies(
	existing: Map<string, string>,
	response: Response
): void {
	const setCookie = response.headers.getSetCookie();
	for (const cookie of setCookie) {
		const [nameValue] = cookie.split(';');
		const eq = nameValue.indexOf('=');
		if (eq < 1) {
			continue;
		}
		const name = nameValue.slice(0, eq).trim();
		const value = nameValue.slice(eq + 1).trim();
		existing.set(name, value);
	}
}

function cookieHeader(jar: Map<string, string>): string {
	return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

/**
 * Bootstraps a shared admin application password by:
 *  1. POSTing to wp-login.php with admin/password to obtain a session cookie.
 *  2. Fetching the REST nonce via admin-ajax.php?action=rest-nonce.
 *  3. POSTing to /wp-json/wp/v2/users/me/application-passwords with the cookie + nonce.
 *
 * WP disables app passwords over HTTP in non-"local" environments. The e2e
 * mu-plugin at tests/e2e/mu-plugins/enable-app-passwords.php filters
 * wp_is_application_passwords_available to true so the bootstrap succeeds.
 */
async function bootstrapAppPassword(): Promise<string> {
	const jar = new Map<string, string>();

	// Prime the cookie jar with wordpress_test_cookie — wp-login requires it.
	const primeResp = await fetch(`${WP_BASE_URL}/wp-login.php`, {
		redirect: 'manual',
	});
	accumulateCookies(jar, primeResp);

	const form = new URLSearchParams({
		log: WP_ADMIN_USER,
		pwd: WP_ADMIN_PASSWORD,
		'wp-submit': 'Log In',
		redirect_to: `${WP_BASE_URL}/wp-admin/`,
		testcookie: '1',
	});
	const loginResp = await fetch(`${WP_BASE_URL}/wp-login.php`, {
		method: 'POST',
		body: form,
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			Cookie: cookieHeader(jar),
		},
		redirect: 'manual',
	});
	accumulateCookies(jar, loginResp);

	if (loginResp.status !== 302) {
		throw new Error(
			`Admin login failed: expected 302 redirect, got ${loginResp.status}`
		);
	}

	const nonceResp = await fetch(
		`${WP_BASE_URL}/wp-admin/admin-ajax.php?action=rest-nonce`,
		{
			headers: { Cookie: cookieHeader(jar) },
		}
	);
	const nonce = (await nonceResp.text()).trim();
	if (!/^[a-f0-9]+$/.test(nonce)) {
		throw new Error(
			`Failed to fetch REST nonce (got: ${nonce.slice(0, 80)})`
		);
	}

	const createResp = await fetch(
		`${WP_BASE_URL}/wp-json/wp/v2/users/me/application-passwords`,
		{
			method: 'POST',
			body: JSON.stringify({ name: `e2e-shared-${Date.now()}` }),
			headers: {
				'Content-Type': 'application/json',
				Cookie: cookieHeader(jar),
				'X-WP-Nonce': nonce,
			},
		}
	);
	if (!createResp.ok) {
		throw new Error(
			`Create app password failed (${createResp.status}): ${await createResp.text()}`
		);
	}
	const data = (await createResp.json()) as { password: string };
	return data.password;
}

/** App password created during global setup, shared by all tests. */
let sharedAppPassword: string | null = null;

export function getSharedAppPassword(): string {
	if (!sharedAppPassword) {
		const state = readState();
		if (state.appPassword) {
			sharedAppPassword = state.appPassword;
			return sharedAppPassword;
		}
		throw new Error(
			'No shared app password available. Did global setup run?'
		);
	}
	return sharedAppPassword;
}

export async function ensurePlaygroundRunning(): Promise<void> {
	const state = readState();

	// If a previous run left a Playground alive, reuse it.
	const alreadyUp = await isPlaygroundResponding();
	let pid = state.playgroundPid;

	if (!alreadyUp) {
		if (pid && !isProcessAlive(pid)) {
			pid = undefined; // stale
		}
		if (!pid) {
			pid = startPlaygroundSubprocess();
		}
		await waitForWordPress();
	}

	// Reuse a cached app password if we have one; otherwise bootstrap.
	let appPassword = state.appPassword;
	if (!appPassword) {
		appPassword = await bootstrapAppPassword();
	}

	sharedAppPassword = appPassword;
	writeState({ appPassword, playgroundPid: pid });
}

export async function stopPlayground(): Promise<void> {
	// When reuse is enabled, keep the state file and running instance so the
	// next run can skip startup.
	if (process.env.CLAUDABORATIVE_E2E_REUSE_ENV === '1') {
		return;
	}

	const state = readState();
	if (state.playgroundPid && isProcessAlive(state.playgroundPid)) {
		try {
			process.kill(state.playgroundPid, 'SIGTERM');
		} catch {
			// Process may have exited between the check and the kill; ignore.
		}
		// Give Playground a brief window to exit cleanly, then confirm it is
		// gone before clearing the state file. If the process is still alive,
		// keep the PID around so the next run can retry cleanup instead of
		// leaving an orphan behind.
		const deadline = Date.now() + 2_000;
		while (Date.now() < deadline && isProcessAlive(state.playgroundPid)) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		if (isProcessAlive(state.playgroundPid)) {
			return;
		}
	}
	if (existsSync(STATE_FILE)) {
		unlinkSync(STATE_FILE);
	}
}

// ---------------------------------------------------------------------------
// REST API helpers — safe for concurrent test execution.
// ---------------------------------------------------------------------------

/**
 * Per-worker auth context set by the testUser fixture.
 * When set, apiFetch uses these credentials by default instead of admin.
 * Playwright workers are single-threaded, so a module-level variable is safe.
 */
let currentTestAuth: { username: string; appPassword: string } | null = null;

/**
 * Set the default auth for API requests (called by testUser fixture on setup).
 */
export function setTestAuth(auth: {
	username: string;
	appPassword: string;
}): void {
	currentTestAuth = auth;
}

/**
 * Clear the default auth (called by testUser fixture on teardown).
 */
export function clearTestAuth(): void {
	currentTestAuth = null;
}

function basicAuth(): string {
	if (currentTestAuth) {
		return (
			'Basic ' +
			Buffer.from(
				`${currentTestAuth.username}:${currentTestAuth.appPassword}`
			).toString('base64')
		);
	}
	const password = getSharedAppPassword();
	return (
		'Basic ' +
		Buffer.from(`${WP_ADMIN_USER}:${password}`).toString('base64')
	);
}

async function apiFetch<T>(
	endpoint: string,
	options: RequestInit = {},
	auth?: { username: string; appPassword: string }
): Promise<T> {
	const url = `${WP_BASE_URL}/wp-json${endpoint}`;
	const authHeader = auth
		? 'Basic ' +
			Buffer.from(`${auth.username}:${auth.appPassword}`).toString(
				'base64'
			)
		: basicAuth();
	const headers = new Headers({
		'Content-Type': 'application/json',
		Authorization: authHeader,
	});
	if (options.headers) {
		new Headers(options.headers).forEach((v, k) => {
			headers.set(k, v);
		});
	}

	const response = await fetch(url, { ...options, headers });
	if (response.ok) {
		return (await response.json()) as T;
	}
	throw new Error(
		`API ${options.method ?? 'GET'} ${endpoint} failed (${response.status}): ${await response.text()}`
	);
}

export async function createDraftPost(
	title: string,
	content: string,
	auth?: { username: string; appPassword: string }
): Promise<number> {
	const post = await apiFetch<{ id: number }>(
		'/wp/v2/posts',
		{
			method: 'POST',
			body: JSON.stringify({
				title,
				content,
				status: 'draft',
			}),
		},
		auth
	);
	return post.id;
}

export async function deletePost(
	postId: number,
	auth?: { username: string; appPassword: string }
): Promise<void> {
	await apiFetch(
		`/wp/v2/posts/${postId}?force=true`,
		{ method: 'DELETE' },
		auth
	);
}

export async function trashPost(
	postId: number,
	auth?: { username: string; appPassword: string }
): Promise<void> {
	await apiFetch(
		`/wp/v2/posts/${postId}?force=false`,
		{ method: 'DELETE' },
		auth
	);
}

export interface CommandResponse {
	id: number;
	post_id: number;
	prompt: string;
	status: string;
	arguments: Record<string, unknown>;
	message: string | null;
	result_data: Record<string, unknown> | null;
}

export async function listCommands(
	postId?: number,
	auth?: { username: string; appPassword: string }
): Promise<CommandResponse[]> {
	const query = postId ? `?post_id=${postId}` : '';
	return apiFetch(`/wpce/v1/commands${query}`, {}, auth);
}

export async function updateCommand(
	commandId: number,
	params: {
		status: string;
		message?: string;
		result_data?: string;
	},
	auth?: { username: string; appPassword: string }
): Promise<CommandResponse> {
	return apiFetch(
		`/wpce/v1/commands/${commandId}`,
		{
			method: 'PATCH',
			body: JSON.stringify(params),
		},
		auth
	);
}

// ---------------------------------------------------------------------------
// Per-test user isolation — each test gets a unique WordPress user so that
// commands in the shared Yjs room are user-scoped and don't cross-contaminate.
// ---------------------------------------------------------------------------

export interface TestUser {
	username: string;
	password: string;
	appPassword: string;
	userId: number;
}

/**
 * Create a unique WordPress editor user with an application password.
 * The user has the `editor` role (has edit_posts but is not an admin).
 */
export async function createTestUser(): Promise<TestUser> {
	const uid = randomUUID().slice(0, 12);
	const username = `e2e-${uid}`;
	const password = `pass-${uid}`;

	// Create user as admin
	const user = await apiFetch<{ id: number }>('/wp/v2/users', {
		method: 'POST',
		body: JSON.stringify({
			username,
			password,
			email: `${username}@example.com`,
			roles: ['editor'],
		}),
	});

	// Create an app password for the new user (admin can do this)
	const appResult = await apiFetch<{ password: string }>(
		`/wp/v2/users/${user.id}/application-passwords`,
		{
			method: 'POST',
			body: JSON.stringify({ name: `e2e-${Date.now()}` }),
		}
	);

	// Pre-seed Gutenberg editor preferences so the welcome guide and
	// fullscreen mode don't race the test's openEditor() helper. Without
	// this, a new user's empty persisted_preferences meta lets the
	// WelcomeGuide modal mount on editor boot, before Playwright's
	// setPreferences dispatch can disable it — tests see the modal still
	// blocking input.
	await apiFetch(`/wp/v2/users/${user.id}`, {
		method: 'POST',
		body: JSON.stringify({
			meta: {
				persisted_preferences: {
					_modified: new Date().toISOString(),
					'core/edit-post': {
						welcomeGuide: false,
						welcomeGuideStyles: false,
						welcomeGuidePage: false,
						welcomeGuideTemplate: false,
						fullscreenMode: false,
					},
				},
			},
		}),
	});

	return {
		username,
		password,
		appPassword: appResult.password,
		userId: user.id,
	};
}

/**
 * Delete a test user (force-deletes, reassigns content to admin user 1).
 */
export async function deleteTestUser(userId: number): Promise<void> {
	await apiFetch(`/wp/v2/users/${userId}?force=true&reassign=1`, {
		method: 'DELETE',
	});
}
