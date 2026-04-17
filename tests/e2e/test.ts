/**
 * Extended Playwright test fixtures for WordPress E2E tests.
 *
 * Provides:
 * - Console suppression for known harmless messages
 * - Per-test user isolation via the `testUser` fixture (creates a unique
 *   WordPress user + app password, logs the browser in as that user, and
 *   cleans up afterwards). This prevents command cross-contamination when
 *   tests run in parallel, since commands are user-scoped.
 * - `mcpClient` fixture: MCP subprocess auto-connected as the test user,
 *   with stderr-enhanced errors and automatic cleanup
 * - `draftPost` fixture: draft post creation with automatic cleanup
 */
import { test as base, expect } from '@wordpress/e2e-test-utils-playwright';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createMcpTestClient } from './helpers/mcp';
import {
	WP_BASE_URL,
	createTestUser,
	deleteTestUser,
	setTestAuth,
	clearTestAuth,
	createDraftPost,
	deletePost,
	type TestUser,
} from './helpers/playground';

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

/** Default content for auto-created draft posts. */
const DEFAULT_POST_CONTENT =
	'<!-- wp:paragraph --><p>Test paragraph</p><!-- /wp:paragraph -->';

const test = base.extend<{
	testUser: TestUser;
	mcpClient: McpClientFixture;
	draftPost: number;
}>({
	// Per-test user fixture — opt-in. Creates a unique WordPress user,
	// logs the browser in as that user, and cleans up afterwards.
	// Tests must explicitly destructure `testUser` to activate it.
	testUser: [
		async ({ page }, use) => {
			const user = await createTestUser();

			// Set as default auth for API helpers so tests don't need
			// to pass credentials explicitly.
			setTestAuth({
				username: user.username,
				appPassword: user.appPassword,
			});

			try {
				// Log the browser in as the test user.
				await page.goto(`${WP_BASE_URL}/wp-login.php?reauth=1`);
				await page.fill('#user_login', user.username);
				await page.fill('#user_pass', user.password);
				await page.click('#wp-submit');
				await page.waitForURL('**/wp-admin/**');

				await use(user);
			} finally {
				// Clear localStorage while still on the WordPress origin,
				// then navigate away so Gutenberg's sync polling stops
				// before we delete the user.
				try {
					await page.evaluate('window.localStorage.clear()');
					await page.goto('about:blank');
				} catch {
					// Page may already be closed.
				}
				clearTestAuth();
				await deleteTestUser(user.userId);
			}
		},
		{ auto: false },
	],

	// MCP client fixture — opt-in. Spawns an MCP subprocess with the
	// test user's credentials so it auto-connects to WordPress on startup.
	// Enhances errors with stderr output on failure and closes the
	// transport on teardown.
	mcpClient: [
		async ({ testUser }, use) => {
			const { client, close, stderr } = await createMcpTestClient({
				WP_SITE_URL: WP_BASE_URL,
				WP_USERNAME: testUser.username,
				WP_APP_PASSWORD: testUser.appPassword,
			});
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

	// Draft post fixture — opt-in. Creates a draft post owned by the
	// test user (via setTestAuth), using the test title as the post title,
	// and deletes it on teardown. Provides the post ID directly.
	draftPost: [
		// eslint-disable-next-line @typescript-eslint/no-unused-vars -- ensures setTestAuth runs first
		async ({ testUser: _ensureAuth }, use, testInfo) => {
			const postId = await createDraftPost(
				testInfo.title,
				DEFAULT_POST_CONTENT
			);

			await use(postId);

			// Cleanup: delete the post. Swallow 404 (post already deleted
			// mid-test, e.g. deleted-post tests), rethrow anything else so
			// real cleanup failures are surfaced.
			try {
				await deletePost(postId);
			} catch (error) {
				if (
					!(error instanceof Error) ||
					!error.message.includes('(404)')
				) {
					throw error;
				}
			}
		},
		{ auto: false },
	],

	page: async ({ page }, use) => {
		// Intercept Node console methods to filter messages forwarded
		// by the package's observeConsoleLogging page handler.
		const origWarn = console.warn;
		const origError = console.error;

		console.warn = (...args: unknown[]) => {
			if (!isSuppressed(args)) origWarn.apply(console, args);
		};
		console.error = (...args: unknown[]) => {
			if (!isSuppressed(args)) origError.apply(console, args);
		};

		try {
			await use(page);
		} finally {
			console.warn = origWarn;
			console.error = origError;

			// localStorage is cleared in testUser's teardown (before
			// about:blank navigation) while still on the WP origin.
		}
	},
});

export { test, expect };
