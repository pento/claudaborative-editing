import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WP_BASE_URL = process.env.WP_BASE_URL ?? 'http://localhost:8888';
export const WP_ADMIN_USER = process.env.WP_E2E_ADMIN_USER ?? 'admin';
export const WP_ADMIN_PASSWORD = process.env.WP_E2E_ADMIN_PASSWORD ?? 'password';
export const WP_MCP_USER = process.env.WP_E2E_MCP_USER ?? 'claudaborative-e2e';
export const WP_MCP_PASSWORD = process.env.WP_E2E_MCP_PASSWORD ?? 'claudaborative-e2e-pass';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const STATE_FILE = path.join(tmpdir(), 'claudaborative-editing-e2e-wp-env.json');

function runCommand(command: string, args: string[], inheritOutput: boolean = false): string {
  return execFileSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: inheritOutput ? 'inherit' : ['ignore', 'pipe', 'pipe'],
  });
}

function runWpEnv(args: string[], inheritOutput: boolean = false): string {
  return runCommand('npx', ['wp-env', ...args], inheritOutput);
}

function tryRunWpEnv(args: string[]): string | null {
  try {
    return runWpEnv(args);
  } catch {
    return null;
  }
}

export async function waitForWordPress(timeoutMs: number = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${WP_BASE_URL}/wp-login.php`, { redirect: 'manual' });
      if (response.ok || response.status === 302) {
        return;
      }
      lastError = new Error(`Unexpected status: ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(`Timed out waiting for WordPress at ${WP_BASE_URL}: ${String(lastError)}`);
}

export async function ensureWpEnvRunning(): Promise<void> {
  const alreadyRunning = await (async () => {
    try {
      const response = await fetch(`${WP_BASE_URL}/wp-login.php`, { redirect: 'manual' });
      return response.ok || response.status === 302;
    } catch {
      return false;
    }
  })();

  if (!alreadyRunning) {
    runWpEnv(['start'], true);
    writeFileSync(STATE_FILE, JSON.stringify({ startedBySuite: true }), 'utf8');
  }

  await waitForWordPress();
}

export function teardownWpEnv(): void {
  if (!existsSync(STATE_FILE) || process.env.CLAUDABORATIVE_E2E_REUSE_ENV === '1') {
    return;
  }

  const state = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as { startedBySuite?: boolean };
  if (state.startedBySuite) {
    runWpEnv(['stop'], true);
  }

  unlinkSync(STATE_FILE);
}

export function createAppPassword(label: string): string {
  return runWpEnv([
    'run',
    'cli',
    'wp',
    'user',
    'application-password',
    'create',
    WP_ADMIN_USER,
    label,
    '--porcelain',
  ]).trim();
}

export function ensureEditorUserExists(): void {
  const existing = tryRunWpEnv(['run', 'cli', 'wp', 'user', 'get', WP_MCP_USER, '--field=ID']);
  if (existing) {
    return;
  }

  runWpEnv([
    'run',
    'cli',
    'wp',
    'user',
    'create',
    WP_MCP_USER,
    `${WP_MCP_USER}@example.com`,
    '--role=editor',
    `--user_pass=${WP_MCP_PASSWORD}`,
    '--display_name=E2E MCP Editor',
  ]);
}

export function createAppPasswordForUser(username: string, label: string): string {
  return runWpEnv([
    'run',
    'cli',
    'wp',
    'user',
    'application-password',
    'create',
    username,
    label,
    '--porcelain',
  ]).trim();
}

export function createDraftPost(title: string, content: string): number {
  const result = runWpEnv([
    'run',
    'cli',
    'wp',
    'post',
    'create',
    `--post_title=${title}`,
    '--post_type=post',
    '--post_status=draft',
    `--post_content=${content}`,
    '--porcelain',
  ]).trim();

  return Number.parseInt(result, 10);
}

export function deletePost(postId: number): void {
  runWpEnv(['run', 'cli', 'wp', 'post', 'delete', String(postId), '--force']);
}
