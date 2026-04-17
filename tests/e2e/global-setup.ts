import { request, type FullConfig } from '@playwright/test';
import { RequestUtils } from '@wordpress/e2e-test-utils-playwright';
import { ensurePlaygroundRunning } from './helpers/playground';

export default async function globalSetup(config: FullConfig): Promise<void> {
	// Ensure Playground is running and create a shared app password for MCP tests.
	await ensurePlaygroundRunning();

	// Authenticate via the WordPress login page and save browser storage state.
	const project = config.projects.find((p) => p.name === 'chromium');
	if (!project) {
		throw new Error(
			'globalSetup: could not find the "chromium" project in playwright config'
		);
	}
	const { storageState, baseURL } = project.use;
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
