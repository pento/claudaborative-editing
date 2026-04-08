/**
 * Extended Playwright test fixtures for WordPress E2E tests.
 *
 * Provides:
 * - Console suppression for known harmless messages
 * - Per-test user isolation via the `testUser` fixture (creates a unique
 *   WordPress user + app password, logs the browser in as that user, and
 *   cleans up afterwards). This prevents command cross-contamination when
 *   tests run in parallel, since commands are user-scoped.
 */
import { test as base, expect } from '@wordpress/e2e-test-utils-playwright';
import {
	WP_BASE_URL,
	createTestUser,
	deleteTestUser,
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

const test = base.extend<{ testUser: TestUser }>({
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
