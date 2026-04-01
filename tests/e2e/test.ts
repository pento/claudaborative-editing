/**
 * Extended Playwright test fixtures for WordPress E2E tests.
 *
 * Wraps the `page` fixture from @wordpress/e2e-test-utils-playwright
 * to suppress known harmless console messages from test output.
 *
 * The package's observeConsoleLogging handler forwards browser console
 * warnings/errors to Node's console. Since fixture extension wraps (not
 * replaces) the base, we intercept at the Node console level instead.
 */
import { test as base, expect } from '@wordpress/e2e-test-utils-playwright';

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

const test = base.extend({
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

		await use(page);

		// eslint-disable-next-line no-console
		console.warn = origWarn;
		// eslint-disable-next-line no-console
		console.error = origError;

		try {
			await page.evaluate('window.localStorage.clear()');
		} catch {
			// noop — page may already be closed (e.g., skipped tests).
		}
	},
});

export { test, expect };
