/**
 * Interactive setup wizard for claudaborative-editing.
 *
 * Prompts for WordPress credentials, validates them, and outputs
 * the `claude mcp add` command the user can copy-paste.
 */

import { createInterface } from 'readline';
import { WordPressApiClient, WordPressApiError } from '../wordpress/api-client.js';

export interface SetupDeps {
  prompt: (question: string) => Promise<string>;
  log: (message: string) => void;
  error: (message: string) => void;
  exit: (code: number) => never;
  cleanup: () => void;
}

function defaultDeps(): SetupDeps {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  return {
    prompt: (question: string) =>
      new Promise((resolve) => {
        rl.question(question, (answer) => resolve(answer.trim()));
      }),
    log: (msg) => console.log(msg),
    error: (msg) => console.error(`Error: ${msg}`),
    exit: (code) => {
      rl.close();
      return process.exit(code);
    },
    cleanup: () => rl.close(),
  };
}

export async function runSetup(deps: SetupDeps = defaultDeps()): Promise<void> {
  const { prompt, log, error, exit, cleanup } = deps;

  log('');
  log('claudaborative-editing setup');
  log('============================');
  log('');
  log('This wizard will validate your WordPress credentials and give you');
  log('the command to register this MCP server with Claude Code.');
  log('');
  log('Prerequisites:');
  log('  - WordPress 7.0+ with collaborative editing enabled');
  log('    (Settings → Writing in your WordPress admin)');
  log('  - An Application Password for your WordPress user');
  log('    (Users → Your Profile → Application Passwords)');
  log('');

  // 1. Collect credentials
  const siteUrl = await prompt('WordPress site URL: ');
  if (!siteUrl) {
    error('Site URL is required.');
    exit(1);
  }

  const username = await prompt('WordPress username: ');
  if (!username) {
    error('Username is required.');
    exit(1);
  }

  const appPassword = await prompt('Application Password: ');
  if (!appPassword) {
    error('Application Password is required.');
    exit(1);
  }

  log('');
  log('Validating credentials...');

  // 2. Validate auth
  const client = new WordPressApiClient({
    siteUrl,
    username,
    appPassword,
  });

  let displayName: string;
  try {
    const user = await client.validateConnection();
    displayName = user.name ?? username;
    log(`  ✓ Authenticated as "${displayName}"`);
  } catch (err) {
    if (err instanceof WordPressApiError) {
      error(err.message);
    } else {
      error(`Could not connect to ${siteUrl}. Check the URL and try again.`);
    }
    exit(1);
  }

  // 3. Validate sync endpoint
  try {
    await client.validateSyncEndpoint();
    log('  ✓ Collaborative editing endpoint available');
  } catch (err) {
    if (err instanceof WordPressApiError && err.status === 404) {
      log('');
      error(
        'Collaborative editing is not enabled.\n' +
          '  Go to Settings → Writing in your WordPress admin and enable it.\n' +
          '  (Requires WordPress 7.0 or later.)',
      );
      exit(1);
    }
    if (err instanceof WordPressApiError) {
      error(err.message);
    } else {
      error('Could not validate the sync endpoint.');
    }
    exit(1);
  }

  log('');
  log('Setup complete! Run this command to register the MCP server:');
  log('');

  // Build the env flags
  const envFlags = [
    `-e WP_SITE_URL=${shellQuote(siteUrl)}`,
    `-e WP_USERNAME=${shellQuote(username)}`,
    `-e WP_APP_PASSWORD=${shellQuote(appPassword)}`,
  ].join(' ');

  log(`  claude mcp add claudaborative-editing ${envFlags} -- npx claudaborative-editing`);
  log('');

  cleanup();
}

/**
 * Quote a value for safe shell use in the output command.
 * Wraps in double quotes if it contains spaces or special characters.
 */
export function shellQuote(value: string): string {
  if (/^[a-zA-Z0-9_./:@-]+$/.test(value)) {
    return value;
  }
  // Escape backslashes, double quotes, dollar signs, backticks
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');
  return `"${escaped}"`;
}
