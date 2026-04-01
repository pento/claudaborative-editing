import { request, type FullConfig } from '@playwright/test';
import { RequestUtils } from '@wordpress/e2e-test-utils-playwright';
import { ensureWpEnvRunning } from './helpers/wp-env';

export default async function globalSetup(config: FullConfig): Promise<void> {
	// Ensure wp-env is running and create a shared app password for MCP tests.
	ensureWpEnvRunning();

	// Authenticate via the WordPress login page and save browser storage state.
	const { storageState, baseURL } = config.projects[0].use;
	const storageStatePath =
		typeof storageState === 'string' ? storageState : undefined;

	const requestContext = await request.newContext({ baseURL });
	const requestUtils = new RequestUtils(requestContext, {
		storageStatePath,
	});

	await requestUtils.setupRest();

	// Clear user preferences so the welcome guide and fullscreen mode
	// don't interfere with tests on a fresh environment.
	await requestUtils.resetPreferences();

	await requestContext.dispose();
}
