/**
 * Playwright setup project: log in once and save storage state for all tests.
 */
import { test as setup } from '@playwright/test';
import { WP_ADMIN_USER, WP_ADMIN_PASSWORD } from './helpers/wp-env';

const AUTH_STATE_PATH = 'test-results/playwright/.auth/admin.json';

setup('authenticate', async ({ page }) => {
	await page.goto('/wp-login.php');
	await page.locator('#user_login').fill(WP_ADMIN_USER);
	await page.locator('#user_pass').fill(WP_ADMIN_PASSWORD);
	await page.locator('#wp-submit').click();
	await page.waitForURL(/\/wp-admin\/?/);
	await page.context().storageState({ path: AUTH_STATE_PATH });
});
