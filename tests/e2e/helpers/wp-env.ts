import { createHash } from 'node:crypto';
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

function basicAuth(): string {
	const password = getSharedAppPassword();
	return (
		'Basic ' +
		Buffer.from(`${WP_ADMIN_USER}:${password}`).toString('base64')
	);
}

async function apiFetch<T>(
	endpoint: string,
	options: RequestInit = {}
): Promise<T> {
	const url = `${WP_BASE_URL}/wp-json${endpoint}`;
	const headers = new Headers({
		'Content-Type': 'application/json',
		Authorization: basicAuth(),
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
	content: string
): Promise<number> {
	const post = await apiFetch<{ id: number }>('/wp/v2/posts', {
		method: 'POST',
		body: JSON.stringify({
			title,
			content,
			status: 'draft',
		}),
	});
	return post.id;
}

export async function deletePost(postId: number): Promise<void> {
	await apiFetch(`/wp/v2/posts/${postId}?force=true`, {
		method: 'DELETE',
	});
}

export async function trashPost(postId: number): Promise<void> {
	await apiFetch(`/wp/v2/posts/${postId}?force=false`, {
		method: 'DELETE',
	});
}

export async function listCommands(postId?: number): Promise<
	Array<{
		id: number;
		post_id: number;
		prompt: string;
		status: string;
		arguments: Record<string, unknown>;
	}>
> {
	const query = postId ? `?post_id=${postId}` : '';
	return apiFetch(`/wpce/v1/commands${query}`);
}

export async function createAppPassword(label: string): Promise<string> {
	const result = await apiFetch<{ password: string }>(
		`/wp/v2/users/me/application-passwords`,
		{
			method: 'POST',
			body: JSON.stringify({
				name: label,
			}),
		}
	);
	return result.password;
}
