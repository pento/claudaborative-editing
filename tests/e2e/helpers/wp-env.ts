import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WP_BASE_URL = process.env.WP_BASE_URL ?? 'http://localhost:8889';
export const WP_ADMIN_USER = process.env.WP_E2E_ADMIN_USER ?? 'admin';
export const WP_ADMIN_PASSWORD =
	process.env.WP_E2E_ADMIN_PASSWORD ?? 'password';

const REPO_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../..'
);
// Include a hash of the repo root to avoid collisions between concurrent
// e2e runs from different checkouts on the same machine.
const repoHash = createHash('md5').update(REPO_ROOT).digest('hex').slice(0, 8);
const STATE_FILE = path.join(
	tmpdir(),
	`claudaborative-editing-e2e-wp-env-${repoHash}.json`
);

function runWpEnv(args: string[], inheritOutput: boolean = false): string {
	return execFileSync(
		'npx',
		['wp-env', '--config', '.wp-env.test.json', ...args],
		{
			cwd: REPO_ROOT,
			encoding: 'utf8',
			stdio: inheritOutput ? 'inherit' : ['ignore', 'pipe', 'pipe'],
		}
	);
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

/** App password created during global setup, shared by all tests. */
let sharedAppPassword: string | null = null;

export function getSharedAppPassword(): string {
	if (!sharedAppPassword) {
		// Read from state file (workers don't share memory with global setup)
		if (existsSync(STATE_FILE)) {
			const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as {
				appPassword?: string;
			};
			if (state.appPassword) {
				sharedAppPassword = state.appPassword;
				return sharedAppPassword;
			}
		}
		throw new Error(
			'No shared app password available. Did global setup run?'
		);
	}
	return sharedAppPassword;
}

export function ensureWpEnvRunning(): void {
	// Reuse an existing app password from a previous run if the state file
	// exists (avoids accumulating passwords across repeated runs).
	if (existsSync(STATE_FILE)) {
		const prev = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as {
			appPassword?: string;
		};
		if (prev.appPassword) {
			sharedAppPassword = prev.appPassword;
			writeFileSync(
				STATE_FILE,
				JSON.stringify({
					appPassword: sharedAppPassword,
				}),
				'utf8'
			);
			return;
		}
	}

	// Create a shared app password for REST API access (wp-cli runs once
	// here in global setup, then all tests use the REST API).
	const appPassword = runWpEnv([
		'run',
		'cli',
		'wp',
		'user',
		'application-password',
		'create',
		WP_ADMIN_USER,
		`e2e-shared-${Date.now()}`,
		'--porcelain',
	]).trim();

	sharedAppPassword = appPassword;

	writeFileSync(STATE_FILE, JSON.stringify({ appPassword }), 'utf8');
}

export function teardownWpEnv(): void {
	if (!existsSync(STATE_FILE)) {
		return;
	}

	// When reuse is enabled, keep the state file so the next run can
	// reuse the app password without creating a new one.
	if (process.env.CLAUDABORATIVE_E2E_REUSE_ENV === '1') {
		return;
	}

	unlinkSync(STATE_FILE);
}

// ---------------------------------------------------------------------------
// REST API helpers — safe for concurrent test execution (no wp-cli needed)
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
	if (!response.ok) {
		const text = await response.text();
		throw new Error(
			`API ${options.method ?? 'GET'} ${endpoint} failed (${response.status}): ${text}`
		);
	}
	return (await response.json()) as T;
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
