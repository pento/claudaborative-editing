/**
 * Browser-based WordPress Application Password authorization flow.
 *
 * Opens the browser to WordPress's built-in `authorize-application.php` page.
 * After the user approves, WordPress displays the generated credentials on the
 * page — no localhost callback needed (which avoids the HTTPS-only restriction
 * on `success_url`).
 */

import { execFile } from 'node:child_process';

/** Application name shown in the WordPress authorization UI. */
export const APP_NAME = 'Claudaborative Editing';

/**
 * Fixed UUID identifying this application to WordPress.
 * WordPress uses this to track and allow revocation of Application Passwords.
 */
export const APP_ID = 'b7e3f1a2-8d4c-4e6f-9a1b-2c3d4e5f6a7b';

export interface BrowserAuthOptions {
  /** Override browser opener for testing */
  openBrowser?: (url: string) => Promise<void>;
}

/**
 * Build the WordPress authorize-application URL and open it in the browser.
 *
 * WordPress's `authorize-application.php` handles the full flow:
 * 1. User logs in (if needed) and clicks "Approve"
 * 2. WordPress generates an Application Password and displays it on the page
 *
 * We intentionally omit `success_url` / `reject_url` because WordPress
 * requires them to be HTTPS when the site uses HTTPS, and a local HTTP
 * server can't satisfy that. Without callback URLs, WordPress simply shows
 * the credentials on the page for the user to copy back to the terminal.
 *
 * Returns the authorization URL (for display to the user).
 */
export async function openAuthPage(siteUrl: string, options?: BrowserAuthOptions): Promise<string> {
  const params = new URLSearchParams({
    app_name: APP_NAME,
    app_id: APP_ID,
  });

  const authUrl = `${siteUrl}/wp-admin/authorize-application.php?${params.toString()}`;

  const openFn = options?.openBrowser ?? openBrowserDefault;
  await openFn(authUrl);

  return authUrl;
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
      command = 'cmd';
      args = ['/c', 'start', '', url];
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
