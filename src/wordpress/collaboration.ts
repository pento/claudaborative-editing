/**
 * Shared constants and guidance text for Gutenberg's real-time collaboration
 * (RTC) experiment gate.
 *
 * Since Gutenberg 23.8 (PR #80658), RTC is an opt-in experiment
 * (`gutenberg-real-time-collaboration`) rather than something WordPress core
 * ships. When it is off, `rest_api_init` never registers `wp-sync/v1`, so
 * the MCP server's sync endpoint probe 404s. This module builds every
 * user-facing string describing that state from a single set of constants,
 * so the wording can't drift between the CLI, the tool layer, and the
 * companion plugin's PHP/TS equivalents (see WP0 in the implementation plan).
 *
 * Imports nothing internal — consumed by api-client.ts, session-manager.ts,
 * tools/status.ts, and cli/setup.ts, none of which this module depends on.
 */

/** Gutenberg experiment id for real-time collaboration. */
export const RTC_EXPERIMENT_ID = 'gutenberg-real-time-collaboration';

/** Site option storing all Gutenberg experiment toggles. */
export const GUTENBERG_EXPERIMENTS_OPTION = 'gutenberg-experiments';

/** Human-readable label for the experiment, as shown in the Gutenberg UI. */
export const RTC_EXPERIMENT_LABEL = 'Enable real-time collaboration';

/** Minimum Gutenberg version that gates RTC behind an experiment. */
export const MIN_GUTENBERG_VERSION = '23.8';

/** Menu path wording for the WordPress admin experiments page. */
export const EXPERIMENTS_MENU = 'Settings → Experiments';

/** Absolute admin path (from the site root) to the experiments page. */
export const EXPERIMENTS_ADMIN_PATH =
	'/wp-admin/options-general.php?page=experiments-wp-admin';

/**
 * Collaboration status as reported by the companion plugin's
 * `GET /wpce/v1/status` endpoint (the `collaboration` field). Keys match
 * the WordPress plugin's `Collaboration::build_status()` byte-for-byte.
 */
export interface CollaborationStatus {
	gutenberg_active: boolean;
	gutenberg_version: string | null;
	collaboration_enabled: boolean;
	sync_endpoint_registered: boolean;
	can_manage_options: boolean;
	experiments_url: string | null;
}

/**
 * Extra context for the one case `describeCollaborationState()` cannot
 * explain on its own: the plugin reports the sync route as registered, yet
 * the sync POST still 404s. Appended by the callers that know the probe
 * just failed (connect() and the setup wizard), so the "enabled" sentence
 * is never the whole of a failure message.
 */
export const SYNC_BLOCKED_HINT =
	'The sync endpoint is registered but still returned 404 — a proxy, ' +
	'security plugin or filter may be blocking POST /wp-sync/v1/updates.';

/** Build the full experiments admin URL for a given site URL. */
export function experimentsUrl(siteUrl: string): string {
	return siteUrl.replace(/\/+$/, '') + EXPERIMENTS_ADMIN_PATH;
}

/**
 * Generic guidance shown when the companion plugin is absent (no
 * CollaborationStatus available), so the only actionable thing is the URL.
 */
export function collaborationGuidance(siteUrl: string): string {
	return (
		`Real-time collaboration is not enabled on this WordPress site. ` +
		`It requires the Gutenberg plugin (${MIN_GUTENBERG_VERSION} or later) with the "${RTC_EXPERIMENT_LABEL}" experiment ` +
		`turned on under ${EXPERIMENTS_MENU}: ${experimentsUrl(siteUrl)}`
	);
}

/**
 * Whether a Gutenberg version string is at or above MIN_GUTENBERG_VERSION.
 * Only the major.minor prefix is compared; a missing or unparsable version
 * is treated as unsupported.
 */
export function isGutenbergVersionSupported(version: string | null): boolean {
	if (!version) return false;
	const match = version.match(/^(\d+)\.(\d+)/);
	if (!match) return false;
	const major = parseInt(match[1], 10);
	const minor = parseInt(match[2], 10);

	const [minMajorStr, minMinorStr] = MIN_GUTENBERG_VERSION.split('.');
	const minMajor = parseInt(minMajorStr, 10);
	const minMinor = parseInt(minMinorStr, 10);

	if (major !== minMajor) return major > minMajor;
	return minor >= minMinor;
}

/** Lower-case the first character of `text`, used when prefixed by "Ask an administrator to ". */
function lowerFirst(text: string, shouldLower: boolean): string {
	if (!shouldLower) return text;
	return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * Describe the current collaboration state in a single human-readable
 * sentence, precise enough to act on.
 *
 * Checked in this order (registered wins first): if the sync endpoint is
 * registered, RTC is enabled — full stop — even if the other fields look
 * stale or contradictory. This is a deliberate anti-regression guard: if
 * Gutenberg ever graduates the experiment (removing the gate entirely), the
 * route still registers and this function must never report a false "off"
 * diagnosis just because `collaboration_enabled` no longer means anything.
 */
export function describeCollaborationState(
	s: CollaborationStatus,
	siteUrl: string
): string {
	const url = s.experiments_url ?? experimentsUrl(siteUrl);
	const v = s.gutenberg_version ?? 'unknown version';
	const who = s.can_manage_options ? '' : 'Ask an administrator to ';

	if (s.sync_endpoint_registered) {
		return `Real-time collaboration is enabled (Gutenberg ${v}).`;
	}

	if (!s.gutenberg_active) {
		return (
			`Real-time collaboration is not available: the Gutenberg plugin is not active. ` +
			who +
			lowerFirst(
				`Install and activate Gutenberg ${MIN_GUTENBERG_VERSION} or later, then turn on the "${RTC_EXPERIMENT_LABEL}" experiment under ${EXPERIMENTS_MENU}.`,
				Boolean(who)
			)
		);
	}

	if (!isGutenbergVersionSupported(s.gutenberg_version)) {
		return (
			`Real-time collaboration is not available: Gutenberg ${v} is active, but ${MIN_GUTENBERG_VERSION} or later is required. ` +
			who +
			lowerFirst(
				`Update Gutenberg, then turn on the "${RTC_EXPERIMENT_LABEL}" experiment under ${EXPERIMENTS_MENU}.`,
				Boolean(who)
			)
		);
	}

	if (!s.collaboration_enabled) {
		return (
			`Real-time collaboration is not enabled: Gutenberg ${v} is active, but the "${RTC_EXPERIMENT_LABEL}" experiment is off. ` +
			who +
			lowerFirst(`Turn it on at ${url}`, Boolean(who))
		);
	}

	return (
		`Real-time collaboration is enabled in Gutenberg ${v}, but the sync endpoint (/wp-sync/v1/updates) is not registered. ` +
		`Another plugin may be disabling it.`
	);
}
