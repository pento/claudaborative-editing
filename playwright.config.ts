import path from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.WP_BASE_URL ?? 'http://127.0.0.1:8889';

// Set STORAGE_STATE_PATH so the @wordpress/e2e-test-utils-playwright
// requestUtils fixture uses the same storage state as our global setup.
const STORAGE_STATE_PATH = path.resolve(
	'test-results/playwright/.auth/admin.json'
);
process.env.STORAGE_STATE_PATH = STORAGE_STATE_PATH;

export default defineConfig({
	testDir: './tests/e2e',
	timeout: 120_000,
	expect: {
		timeout: 30_000,
	},
	fullyParallel: true,
	workers: 4,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	outputDir: 'test-results/playwright',
	use: {
		baseURL,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure',
		headless: true,
		contextOptions: {
			reducedMotion: 'reduce',
			strictSelectors: true,
		},
		storageState: STORAGE_STATE_PATH,
	},
	globalSetup: './tests/e2e/global-setup.ts',
	globalTeardown: './tests/e2e/global-teardown.ts',
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
	],
});
