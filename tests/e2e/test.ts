/**
 * Extended Playwright test fixtures for WordPress E2E tests.
 *
 * Provides:
 * - Console suppression for known harmless messages
 * - Per-test user isolation via the `testUser` fixture (creates a unique
 *   WordPress user + app password, logs the browser in as that user, and
 *   cleans up afterwards). This prevents command cross-contamination when
 *   tests run in parallel, since commands are user-scoped.
 * - `mcpClient` fixture: MCP subprocess lifecycle with stderr-enhanced errors
 * - `draftPost` fixture: draft post creation with automatic cleanup
 * - `connectedMcpClient` fixture: MCP client pre-connected as admin
 */
import { test as base, expect } from '@wordpress/e2e-test-utils-playwright';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createMcpTestClient, callToolOrThrow } from './helpers/mcp';
import {
	WP_ADMIN_USER,
	WP_BASE_URL,
	getSharedAppPassword,
	createTestUser,
	deleteTestUser,
	createDraftPost,
	deletePost,
	type TestUser,
} from './helpers/wp-env';

/**
 * Console message substrings to suppress from test output.
 */
const SUPPRESSED_MESSAGES = [
	// WordPress registers some stores multiple times on initial load.
	'is already registered',
	// jQuery Migrate deprecation warnings are not relevant to our tests.
	'JQMIGRATE',
	// Chrome advisory about SameSite cookies.
	'A cookie associated with a cross-site resource',
	// Non-unique nonce IDs in WP admin.
	'elements with non-unique id #_wpnonce',
];

function isSuppressed(args: unknown[]): boolean {
	const text = String(args[0]);
	return SUPPRESSED_MESSAGES.some((msg) => text.includes(msg));
}

export interface McpClientFixture {
	client: Client;
	stderr: string[];
}

export type DraftPostFactory = (
	title: string,
	content: string,
	auth?: { username: string; appPassword: string }
) => Promise<number>;

const test = base.extend<{
	testUser: TestUser;
	mcpClient: McpClientFixture;
	draftPost: DraftPostFactory;
	connectedMcpClient: McpClientFixture;
}>({
	// Per-test user fixture — opt-in. Creates a unique WordPress user,
	// logs the browser in as that user, and cleans up afterwards.
	// Tests must explicitly destructure `testUser` to activate it.
	testUser: [
		async ({ page }, use) => {
			const user = await createTestUser();

			// Log the browser in as the test user. Set values via JS to
			// avoid interference from wp-login.php's focus timer script
			// which fires at 200ms and can yank focus between fields.
			await page.goto(`${WP_BASE_URL}/wp-login.php`);
			await page.waitForSelector('#user_login');
			await page.evaluate(`
				document.getElementById('user_login').value = ${JSON.stringify(user.username)};
				document.getElementById('user_pass').value = ${JSON.stringify(user.password)};
			`);
			await page.click('#wp-submit');
			await page.waitForURL('**/wp-admin/**');

			try {
				await use(user);
			} finally {
				await deleteTestUser(user.userId);
			}
		},
		{ auto: false },
	],

	// MCP client fixture — opt-in. Spawns an MCP subprocess, enhances
	// errors with stderr output on failure, and closes the transport
	// on teardown.
	mcpClient: [
		// eslint-disable-next-line no-empty-pattern -- Playwright requires destructuring
		async ({}, use) => {
			const { client, close, stderr } = await createMcpTestClient();
			try {
				await use({ client, stderr });
			} catch (error) {
				const stderrOutput = stderr.join('').trim();
				throw new Error(
					`${error instanceof Error ? error.message : String(error)}${stderrOutput ? `\n\nMCP stderr:\n${stderrOutput}` : ''}`,
					{ cause: error }
				);
			} finally {
				await close();
			}
		},
		{ auto: false },
	],

	// Draft post fixture — opt-in. Returns a factory function that
	// creates a draft post. The post is automatically deleted on teardown.
	draftPost: [
		// eslint-disable-next-line no-empty-pattern -- Playwright requires destructuring
		async ({}, use) => {
			let createdPostId: number | undefined;
			let createdAuth:
				| { username: string; appPassword: string }
				| undefined;

			const create: DraftPostFactory = async (
				title,
				content,
				postAuth
			) => {
				createdAuth = postAuth;
				createdPostId = await createDraftPost(title, content, postAuth);
				return createdPostId;
			};

			await use(create);

			if (createdPostId !== undefined) {
				try {
					await deletePost(createdPostId, createdAuth);
				} catch {
					// Post may already be deleted (e.g., deleted-post tests)
				}
			}
		},
		{ auto: false },
	],

	// Connected MCP client fixture — opt-in. Composes on mcpClient and
	// calls wp_connect as admin with the shared app password.
	connectedMcpClient: [
		async ({ mcpClient }, use) => {
			const appPassword = getSharedAppPassword();
			await callToolOrThrow(mcpClient.client, 'wp_connect', {
				siteUrl: WP_BASE_URL,
				username: WP_ADMIN_USER,
				appPassword,
			});
			await use(mcpClient);
		},
		{ auto: false },
	],

	page: async ({ page }, use) => {
		// Intercept Node console methods to filter messages forwarded
		// by the package's observeConsoleLogging page handler.
		const origWarn = console.warn;
		const origError = console.error;

		// eslint-disable-next-line no-console
		console.warn = (...args: unknown[]) => {
			if (!isSuppressed(args)) origWarn.apply(console, args);
		};
		// eslint-disable-next-line no-console
		console.error = (...args: unknown[]) => {
			if (!isSuppressed(args)) origError.apply(console, args);
		};

		try {
			await use(page);
		} finally {
			// eslint-disable-next-line no-console
			console.warn = origWarn;
			// eslint-disable-next-line no-console
			console.error = origError;

			try {
				await page.evaluate('window.localStorage.clear()');
			} catch {
				// noop — page may already be closed (e.g., skipped tests).
			}
		}
	},
});

export { test, expect };
