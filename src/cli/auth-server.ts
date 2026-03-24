/**
 * Browser-based WordPress Application Password authorisation flow with
 * localhost HTTP callback.
 *
 * Starts a local HTTP server on 127.0.0.1, opens the browser to WordPress's
 * `authorize-application.php` with a `success_url` pointing back to the local
 * server. When the user approves, WordPress redirects to the callback with
 * `user_login` and `password` query parameters, which are captured
 * automatically.
 *
 * WordPress 7.0+ allows HTTP callbacks to loopback addresses. For older
 * versions, the caller can abort the flow and fall back to the non-callback
 * authorisation page.
 */

import { createServer, type Server } from 'node:http';
import { execFile } from 'node:child_process';
import type { WpCredentials } from './types.js';

/** Application name shown in the WordPress authorisation UI. */
export const APP_NAME = 'Claudaborative Editing';

/**
 * Fixed UUID identifying this application to WordPress.
 * WordPress uses this to track and allow revocation of Application Passwords.
 */
export const APP_ID = 'b7e3f1a2-8d4c-4e6f-9a1b-2c3d4e5f6a7b';

export interface AuthFlowOptions {
  /** Override browser opener for testing. */
  openBrowser?: (url: string) => Promise<void>;
}

export interface AuthResult {
  /** Credentials received via callback, or null on abort/rejection. */
  credentials: WpCredentials | null;
  /** Whether the user explicitly rejected the authorisation. */
  rejected: boolean;
}

export interface AuthFlowHandle {
  /** The authorisation URL (with callback params) for display to the user. */
  authUrl: string;
  /** Resolves when credentials are received, user rejects, or flow is aborted. */
  result: Promise<AuthResult>;
  /** Abort the flow — resolves the result promise with credentials: null. */
  abort: () => void;
}

const SUCCESS_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Claudaborative Editing</title>
<style>body{font-family:system-ui,sans-serif;text-align:center;padding:4rem;color:#1e293b;}
h1{color:#16a34a;}</style></head><body>
<h1>Authentication successful!</h1>
<p>You can close this tab and return to your terminal.</p>
</body></html>`;

const REJECTED_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Claudaborative Editing</title>
<style>body{font-family:system-ui,sans-serif;text-align:center;padding:4rem;color:#1e293b;}
h1{color:#dc2626;}</style></head><body>
<h1>Authentication denied</h1>
<p>The authorisation request was declined. Please return to your terminal.</p>
</body></html>`;

/**
 * Build the non-callback authorisation URL.
 *
 * Used as a fallback when the callback flow is aborted (pre-WP 7.0).
 * Without `success_url`/`reject_url`, WordPress shows the generated
 * credentials directly on the page for the user to copy.
 */
export function buildManualAuthUrl(siteUrl: string): string {
  const params = new URLSearchParams({
    app_name: APP_NAME,
    app_id: APP_ID,
  });
  return `${siteUrl}/wp-admin/authorize-application.php?${params.toString()}`;
}

/**
 * Start the authorisation flow: local callback server → browser.
 *
 * Returns a handle once the server is listening and the browser has been
 * opened. The caller should race `handle.result` against user input (e.g.,
 * a prompt to switch to manual auth) and call `handle.abort()` to tear
 * down the server if the user opts out.
 */
export async function startAuthFlow(
  siteUrl: string,
  options?: AuthFlowOptions,
): Promise<AuthFlowHandle> {
  const openFn = options?.openBrowser ?? openBrowserDefault;

  return new Promise<AuthFlowHandle>((resolveHandle, rejectHandle) => {
    let settled = false;
    let resolveResult!: (value: AuthResult) => void;

    const resultPromise = new Promise<AuthResult>((resolve) => {
      resolveResult = resolve;
    });

    function settle(result: AuthResult): void {
      if (settled) return;
      settled = true;
      server.close();
      server.closeAllConnections();
      resolveResult(result);
    }

    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

      if (url.pathname !== '/callback') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }

      if (url.searchParams.has('rejected')) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(REJECTED_HTML);
        settle({ credentials: null, rejected: true });
        return;
      }

      const userLogin = url.searchParams.get('user_login');
      const password = url.searchParams.get('password');

      if (!userLogin || !password) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Missing credentials');
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(SUCCESS_HTML);
      settle({
        credentials: { siteUrl, username: userLogin, appPassword: password },
        rejected: false,
      });
    });

    server.on('error', (err) => {
      // Server failed to start (e.g., permission denied).
      // Reject the handle promise so the caller knows setup failed.
      rejectHandle(err);
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;

      const callbackBase = `http://127.0.0.1:${port}/callback`;

      const params = new URLSearchParams({
        app_name: APP_NAME,
        app_id: APP_ID,
        success_url: callbackBase,
        reject_url: `${callbackBase}?rejected=true`,
      });

      const authUrl = `${siteUrl}/wp-admin/authorize-application.php?${params.toString()}`;

      openFn(authUrl).catch(() => {
        // Browser open failure is non-fatal — the user can visit the URL manually.
      });

      resolveHandle({
        authUrl,
        result: resultPromise,
        abort: () => {
          settle({ credentials: null, rejected: false });
        },
      });
    });
  });
}

/**
 * Open a URL in the system's default browser.
 *
 * Uses platform-specific commands. Does not reject if the browser fails
 * to open — the user can always visit the URL manually.
 */
export function openBrowserDefault(url: string): Promise<void> {
  return new Promise((resolve) => {
    const platform = process.platform;
    let command: string;
    let args: string[];

    if (platform === 'darwin') {
      command = 'open';
      args = [url];
    } else if (platform === 'win32') {
      command = 'explorer';
      args = [url];
    } else {
      command = 'xdg-open';
      args = [url];
    }

    execFile(command, args, (error) => {
      // Intentionally swallowed — the user can manually visit the URL.
      if (error) {
        // Silence: browser open failure is non-fatal.
      }
      resolve();
    });
  });
}
