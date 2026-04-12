/**
 * Cloud connection helpers.
 *
 * Provides functions to connect to the Claudaborative Cloud service and
 * to check whether cloud settings are configured in wpceInitialState.
 */

/** Shape of the cloud-related fields on wpceInitialState. */
interface WpceCloudState {
	cloudUrl?: string;
	cloudApiKey?: string;
}

/**
 * Read the cloud fields from wpceInitialState (set server-side via
 * wp_add_inline_script).
 */
function getCloudState(): WpceCloudState | undefined {
	return (window as Window & { wpceInitialState?: WpceCloudState })
		.wpceInitialState;
}

/**
 * Check whether cloud settings (URL and API key) are present.
 *
 * @return True when both cloudUrl and cloudApiKey are non-empty.
 */
export function isCloudConfigured(): boolean {
	const state = getCloudState();
	return Boolean(state?.cloudUrl && state?.cloudApiKey);
}

/**
 * Connect to the Claudaborative Cloud service when the editor loads.
 *
 * Sends the site's API key so the cloud service creates a SessionManager
 * that will connect back via the Yjs sync protocol.
 */
export function connectToCloud(): void {
	const state = getCloudState();

	if (!state?.cloudUrl || !state?.cloudApiKey) {
		return;
	}

	const url = `${state.cloudUrl.replace(/\/+$/, '')}/api/v1/connect`;

	fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${state.cloudApiKey}`,
		},
		// No credentials -- cross-origin request with API key auth.
		mode: 'cors',
	}).catch(() => {
		// Best-effort: if the cloud service is down, the user still has
		// the local editor. The cloud service's idle timeout handles cleanup.
	});
}
