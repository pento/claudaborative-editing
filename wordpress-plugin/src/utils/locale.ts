/**
 * Locale helpers: read the user/site locale fields that the PHP side
 * injects into `window.wpceInitialState`, and produce the metadata
 * object that gets merged into every MCP command's `arguments` so the
 * MCP server can thread locale hints into prompts.
 */

interface WpceLocaleState {
	userLocale?: string;
	siteLocale?: string;
}

function readInitialState(): WpceLocaleState | undefined {
	return (window as Window & { wpceInitialState?: WpceLocaleState })
		.wpceInitialState;
}

/**
 * Fields merged into every MCP command's `arguments` so the MCP server
 * can pick them up regardless of which command was issued.
 */
export interface CommandLocaleArgs {
	userLocale?: string;
	siteLocale?: string;
}

/**
 * Build the locale argument bag from `wpceInitialState`. Returns an empty
 * object if the state is unavailable (e.g. in tests that don't initialise
 * the global) — callers should tolerate missing fields.
 */
export function getCommandLocaleArgs(): CommandLocaleArgs {
	const state = readInitialState();
	const args: CommandLocaleArgs = {};
	if (state && typeof state.userLocale === 'string' && state.userLocale) {
		args.userLocale = state.userLocale;
	}
	if (state && typeof state.siteLocale === 'string' && state.siteLocale) {
		args.siteLocale = state.siteLocale;
	}
	return args;
}
