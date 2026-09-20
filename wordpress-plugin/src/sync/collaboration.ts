/**
 * Real-time collaboration (RTC) enablement state.
 *
 * Gutenberg 23.8+ gates its RTC sync providers behind the
 * "gutenberg-real-time-collaboration" experiment (Settings → Experiments).
 * The companion plugin's PHP localises the site's enablement state onto
 * wpceInitialState.collaboration (see includes/class-collaboration.php);
 * this module reads it. Gutenberg's own page-scoped runtime flag (the one
 * it sets to gate @wordpress/sync's providers) is deliberately not read
 * here: it is false in the site editor even when the experiment is on,
 * and would disappear if the experiment graduates.
 */

/** Shape of wpceInitialState.collaboration, PHP-localised (camelCase). */
export interface CollaborationState {
	gutenbergActive: boolean;
	collaborationEnabled: boolean;
	canManageOptions: boolean;
	experimentsUrl: string | null;
}

/**
 * Read the collaboration fields from wpceInitialState (set server-side via
 * wp_add_inline_script).
 *
 * @return The collaboration state, or null when absent (older plugin/PHP
 *         builds that don't localise it yet).
 */
export function getCollaborationState(): CollaborationState | null {
	return (
		(
			window as Window & {
				wpceInitialState?: { collaboration?: CollaborationState };
			}
		).wpceInitialState?.collaboration ?? null
	);
}

/**
 * Whether real-time collaboration is enabled on this site.
 *
 * When the state is unavailable (older PHP that hasn't localised
 * `collaboration` yet), assume enabled so behaviour matches the pre-RTC-gate
 * plugin: sync is attempted as before rather than silently short-circuited.
 *
 * @return True when collaboration is enabled, or unknown.
 */
export function isCollaborationEnabled(): boolean {
	return getCollaborationState()?.collaborationEnabled ?? true;
}
