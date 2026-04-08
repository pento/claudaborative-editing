/**
 * Interactive setup wizard for claudaborative-editing.
 *
 * Collects WordPress credentials (via browser auth or manual entry),
 * validates them, detects installed MCP clients, and configures them.
 */

import { createInterface } from 'readline';
import {
	WordPressApiClient,
	WordPressApiError,
} from '../wordpress/api-client.js';
import {
	startAuthFlow,
	buildManualAuthUrl,
	openBrowserDefault,
} from './auth-server.js';
import type { AuthFlowHandle } from './auth-server.js';
import { detectInstalledClients, SERVER_NAME } from './clients.js';
import {
	addServerToConfig,
	buildServerEntry,
	hasServerInConfig,
	removeServerFromConfig,
} from './config-writer.js';
import type { AuthFlowOptions } from './auth-server.js';
import type {
	McpClientConfig,
	McpClientType,
	SetupOptions,
	WpCredentials,
} from './types.js';

export interface SetupDeps {
	prompt: (question: string) => Promise<string>;
	/** Prompt for sensitive input, masking characters with '*' */
	promptSecret: (question: string) => Promise<string>;
	log: (message: string) => void;
	error: (message: string) => void;
	exit: (code: number) => never;
	cleanup: () => void;
	/** Override auth flow for testing */
	openAuth?: (
		siteUrl: string,
		options?: AuthFlowOptions
	) => Promise<AuthFlowHandle>;
	/** Override browser opener for testing (used in manual fallback) */
	openBrowser?: (url: string) => Promise<void>;
	/** Override client detection for testing */
	detectClients?: () => Array<{
		type: McpClientType;
		config: McpClientConfig;
		detected: boolean;
	}>;
	/** Override config writing for testing */
	writeConfig?: (
		config: McpClientConfig,
		credentials: WpCredentials
	) => Promise<boolean>;
	/** Override config removal for testing */
	removeConfig?: (config: McpClientConfig) => Promise<boolean>;
	/** Override config existence check for testing */
	hasConfig?: (config: McpClientConfig) => boolean;
}

/**
 * Read a line from stdin with each character masked as '*'.
 * Uses raw mode to intercept keystrokes before they echo.
 */
function readMasked(question: string): Promise<string> {
	return new Promise((resolve) => {
		process.stdout.write(question);

		if (!process.stdin.isTTY) {
			// Non-interactive: fall back to plain readline (e.g., piped input in tests)
			const rl = createInterface({
				input: process.stdin,
				output: process.stdout,
			});
			rl.question('', (answer) => {
				rl.close();
				resolve(answer.trim());
			});
			return;
		}

		/* v8 ignore start -- raw-mode TTY code requires a real terminal */
		const raw = process.stdin;
		raw.setRawMode(true);
		raw.resume();
		raw.setEncoding('utf8');

		let input = '';
		let finished = false;

		const onData = (chunk: string): void => {
			for (const c of chunk) {
				if (finished) {
					break;
				}
				if (c === '\n' || c === '\r') {
					finished = true;
					raw.setRawMode(false);
					raw.pause();
					raw.removeListener('data', onData);
					process.stdout.write('\n');
					resolve(input.trim());
				} else if (c === '\u0003') {
					raw.setRawMode(false);
					process.exit(130);
				} else if (c === '\u007F' || c === '\b') {
					if (input.length > 0) {
						input = input.slice(0, -1);
						process.stdout.write('\b \b');
					}
				} else if (c.charCodeAt(0) >= 32) {
					input += c;
					process.stdout.write('*');
				}
			}
		};
		raw.on('data', onData);
		/* v8 ignore stop */
	});
}

/* v8 ignore start -- defaultDeps creates real readline/stdin bindings; tests inject deps directly */
function defaultDeps(): SetupDeps {
	let rl = createInterface({ input: process.stdin, output: process.stdout });

	function closeRl(): void {
		rl.close();
	}

	function reopenRl(): void {
		rl = createInterface({ input: process.stdin, output: process.stdout });
	}

	return {
		prompt: (question: string) =>
			new Promise((resolve) => {
				rl.question(question, (answer) => {
					resolve(answer.trim());
				});
			}),
		promptSecret: (question: string) => {
			closeRl();
			return readMasked(question).finally(() => {
				reopenRl();
			});
		},
		log: (msg) => {
			console.log(msg);
		},
		error: (msg) => {
			console.error(`Error: ${msg}`);
		},
		exit: (code) => {
			closeRl();
			return process.exit(code);
		},
		cleanup: () => {
			closeRl();
		},
	};
}
/* v8 ignore stop */

export async function runSetup(
	deps: SetupDeps = defaultDeps(),
	options: SetupOptions = {}
): Promise<void> {
	if (options.remove) {
		await runRemove(deps);
		return;
	}

	deps.log('');
	deps.log('claudaborative-editing setup');
	deps.log('============================');
	deps.log('');
	deps.log('Prerequisites:');
	deps.log('  - WordPress 7.0+ with collaborative editing enabled');
	deps.log('    (Settings → Writing in your WordPress admin)');
	deps.log('');

	// 1. Collect credentials (browser or manual)
	const credentials = await collectCredentials(deps, options);

	// 2. Validate credentials
	await validateCredentials(deps, credentials);

	// 3. Detect Claude Code
	const selectedClients = detectAndSelectClients(deps);

	// 4. Configure selected clients
	await configureClients(deps, credentials, selectedClients);

	deps.log('');
	deps.log('Done! Restart Claude Code to start editing.');

	deps.cleanup();
}

// ---------------------------------------------------------------------------
// Credential collection
// ---------------------------------------------------------------------------

async function collectCredentials(
	deps: SetupDeps,
	options: SetupOptions
): Promise<WpCredentials> {
	if (options.manual) {
		return collectManualCredentials(deps);
	}
	return collectBrowserCredentials(deps);
}

async function collectManualCredentials(
	deps: SetupDeps
): Promise<WpCredentials> {
	const rawUrl = await deps.prompt('WordPress site URL: ');
	if (!rawUrl) {
		deps.error('Site URL is required.');
		deps.exit(1);
	}
	const siteUrl = normaliseSiteUrl(rawUrl);

	const username = await deps.prompt('WordPress username: ');
	if (!username) {
		deps.error('Username is required.');
		deps.exit(1);
	}

	deps.log('  Create an Application Password at:');
	deps.log('  Users → Your Profile → Application Passwords');
	deps.log('');

	const appPassword = await deps.promptSecret('Application Password: ');
	if (!appPassword) {
		deps.error('Application Password is required.');
		deps.exit(1);
	}

	return { siteUrl, username, appPassword };
}

async function collectBrowserCredentials(
	deps: SetupDeps
): Promise<WpCredentials> {
	const rawUrl = await deps.prompt('WordPress site URL: ');
	if (!rawUrl) {
		deps.error('Site URL is required.');
		deps.exit(1);
	}
	const siteUrl = normaliseSiteUrl(rawUrl);

	deps.log('');

	const doAuth = deps.openAuth ?? startAuthFlow;

	let handle: AuthFlowHandle | null = null;
	try {
		handle = await doAuth(siteUrl);
	} catch {
		// Callback server failed to start — fall through to manual auth.
	}

	if (handle) {
		const activeHandle = handle;

		deps.log(
			"Opening your browser to authorise with WordPress. If the browser didn't open, visit:"
		);
		deps.log('');
		deps.log(`  ${activeHandle.authUrl}`);
		deps.log('');

		// Race: WP 7.0+ callback vs user pressing Enter to switch to manual auth.
		const manualPromise = deps.prompt(
			'Press Enter to use the manual process, instead.\n'
		);

		const result = await Promise.race([
			activeHandle.result,
			manualPromise.then(() => {
				activeHandle.abort();
				return null;
			}),
		]);

		if (result?.rejected) {
			deps.error('Authorisation was denied in the browser.');
			deps.exit(1);
		}

		if (result?.credentials) {
			deps.log('  Credentials received automatically.');
			return result.credentials;
		}
	}

	// Manual fallback: user pressed Enter, or callback server failed to start.
	// Open the non-callback auth page so WordPress shows credentials directly.
	const manualUrl = buildManualAuthUrl(siteUrl);
	const doOpen = deps.openBrowser ?? openBrowserDefault;
	await doOpen(manualUrl);

	deps.log(
		"Approve the connection, then copy the credentials shown on the page. If the browser didn't open, visit:"
	);
	deps.log(`  ${manualUrl}`);
	deps.log('');

	const username = await deps.prompt(
		'WordPress username (shown after approval): '
	);
	if (!username) {
		deps.error('Username is required.');
		deps.exit(1);
	}

	const appPassword = await deps.promptSecret(
		'Application Password (shown after approval): '
	);
	if (!appPassword) {
		deps.error('Application Password is required.');
		deps.exit(1);
	}

	return { siteUrl, username, appPassword };
}

// ---------------------------------------------------------------------------
// Credential validation
// ---------------------------------------------------------------------------

async function validateCredentials(
	deps: SetupDeps,
	credentials: WpCredentials
): Promise<void> {
	deps.log('');
	deps.log('Validating credentials...');

	const client = new WordPressApiClient({
		siteUrl: credentials.siteUrl,
		username: credentials.username,
		appPassword: credentials.appPassword,
	});

	try {
		const user = await client.validateConnection();
		const displayName = user.name ?? credentials.username;
		deps.log(`  ✓ Authenticated as "${displayName}"`);
	} catch (err) {
		if (err instanceof WordPressApiError) {
			deps.error(err.message);
		} else {
			deps.error(
				`Could not connect to ${credentials.siteUrl}. Check the URL and try again.`
			);
		}
		deps.exit(1);
	}

	const wpVersion = await client.getWordPressVersion();
	deps.log(`  WordPress version: ${wpVersion}`);

	try {
		await client.validateSyncEndpoint();
		deps.log('  ✓ Collaborative editing endpoint available');
	} catch (err) {
		if (err instanceof WordPressApiError && err.status === 404) {
			deps.log('');
			deps.error(
				'Collaborative editing is not available.\n' +
					'  Requires WordPress 7.0 or later, or the Gutenberg plugin 22.8 or later.\n' +
					(wpVersion !== 'unknown'
						? `  Current WordPress version: ${wpVersion}\n`
						: '') +
					'  If using WordPress 7.0+, enable collaborative editing in Settings → Writing.'
			);
			deps.exit(1);
		}
		if (err instanceof WordPressApiError) {
			deps.error(err.message);
		} else {
			deps.error('Could not validate the sync endpoint.');
		}
		deps.exit(1);
	}
}

// ---------------------------------------------------------------------------
// Client detection and selection
// ---------------------------------------------------------------------------

function detectAndSelectClients(deps: SetupDeps): McpClientConfig[] {
	const clients = deps.detectClients?.() ?? detectInstalledClients();
	const claudeCode = clients[0];

	if (!claudeCode.detected) {
		deps.error(
			'Claude Code is not installed.\n' +
				'  Install it from https://claude.ai/download'
		);
		deps.exit(1);
	}

	return [claudeCode.config];
}

// ---------------------------------------------------------------------------
// Client configuration
// ---------------------------------------------------------------------------

async function configureClients(
	deps: SetupDeps,
	credentials: WpCredentials,
	selectedClients: McpClientConfig[]
): Promise<void> {
	if (selectedClients.length === 0) {
		return;
	}

	deps.log('');
	deps.log('Configuring MCP clients...');

	for (const client of selectedClients) {
		await configureSingleClient(deps, credentials, client);
	}
}

async function configureSingleClient(
	deps: SetupDeps,
	credentials: WpCredentials,
	client: McpClientConfig
): Promise<void> {
	// Check if entry already exists
	const exists =
		deps.hasConfig?.(client) ??
		hasServerInConfig(client.configPath(), client.configKey, SERVER_NAME);
	if (exists) {
		const answer = await deps.prompt(
			`${client.displayName}: entry already exists. Update? (Y/n): `
		);
		if (answer !== '' && !/^[yY]/.test(answer)) {
			deps.log(`  - ${client.displayName} — skipped`);
			return;
		}
	}

	try {
		// If a full write override is provided (e.g., for testing), use it exclusively
		if (deps.writeConfig) {
			const result = await deps.writeConfig(client, credentials);
			if (result) {
				deps.log(`  ✓ ${client.displayName} — configured via CLI`);
			} else {
				deps.log(
					`  ✗ ${client.displayName} — configuration returned false`
				);
			}
			return;
		}

		// Try CLI first if available
		if (client.useCli) {
			const cliResult = await client.useCli(credentials);
			if (cliResult) {
				deps.log(`  ✓ ${client.displayName} — configured via CLI`);
				return;
			}
		}

		// Fall back to config file writing
		addServerToConfig(
			client.configPath(),
			client.configKey,
			SERVER_NAME,
			buildServerEntry(credentials)
		);
		deps.log(
			`  ✓ ${client.displayName} — written to ${client.configPath()}`
		);
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		deps.log(`  ✗ ${client.displayName} — failed: ${message}`);
	}
}

// ---------------------------------------------------------------------------
// Remove flow
// ---------------------------------------------------------------------------

async function runRemove(deps: SetupDeps): Promise<void> {
	deps.log('');
	deps.log('claudaborative-editing remove');
	deps.log('=============================');
	deps.log('');

	const clients = deps.detectClients?.() ?? detectInstalledClients();
	const claudeCode = clients[0];

	let isConfigured: boolean;
	try {
		isConfigured =
			deps.hasConfig?.(claudeCode.config) ??
			hasServerInConfig(
				claudeCode.config.configPath(),
				claudeCode.config.configKey,
				SERVER_NAME
			);
	} catch {
		isConfigured = false;
	}

	if (!isConfigured) {
		deps.log('claudaborative-editing is not configured in Claude Code.');
		deps.cleanup();
		return;
	}

	await removeSingleClient(deps, claudeCode.config);

	deps.log('');
	deps.log('Done! Restart Claude Code to complete removal.');
	deps.cleanup();
}

async function removeSingleClient(
	deps: SetupDeps,
	client: McpClientConfig
): Promise<void> {
	try {
		// If a full remove override is provided (e.g., for testing), use it exclusively
		if (deps.removeConfig) {
			const result = await deps.removeConfig(client);
			if (result) {
				deps.log(`  ✓ ${client.displayName} — removed via CLI`);
			} else {
				deps.log(`  - ${client.displayName} — removal returned false`);
			}
			return;
		}

		// Try CLI removal first
		if (client.removeCli) {
			const cliResult = await client.removeCli();
			if (cliResult) {
				deps.log(`  ✓ ${client.displayName} — removed via CLI`);
				return;
			}
		}

		// Fall back to config file removal
		const removed = removeServerFromConfig(
			client.configPath(),
			client.configKey,
			SERVER_NAME
		);
		if (removed) {
			deps.log(
				`  ✓ ${client.displayName} — removed from ${client.configPath()}`
			);
		} else {
			deps.log(`  - ${client.displayName} — entry not found`);
		}
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		deps.log(`  ✗ ${client.displayName} — failed: ${message}`);
	}
}

// ---------------------------------------------------------------------------
// URL normalisation
// ---------------------------------------------------------------------------

/**
 * Ensure a site URL has a scheme and no trailing slashes.
 * If the user enters a bare domain like "pento.net", prepend "https://".
 */
function normaliseSiteUrl(url: string): string {
	let normalised = url;
	if (!/^https?:\/\//i.test(normalised)) {
		normalised = `https://${normalised}`;
	}
	return normalised.replace(/\/+$/, '');
}
