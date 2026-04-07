/**
 * Debug logger that writes to a file.
 * MCP server stdout/stderr is consumed by the MCP protocol,
 * so we need file-based logging for debugging.
 *
 * Enable by setting WPCE_DEBUG_LOG environment variable to a file path.
 */

import { appendFileSync } from 'node:fs';

const logFile = process.env.WPCE_DEBUG_LOG;

/** Whether debug logging is enabled. Check before computing expensive arguments. */
export function isDebugEnabled(): boolean {
	return !!logFile;
}

export function debugLog(category: string, ...args: unknown[]): void {
	if (!logFile) return;

	const timestamp = new Date().toISOString();
	const message = args
		.map((a) => {
			if (a === null || a === undefined) return '';
			if (typeof a === 'object') return JSON.stringify(a);
			if (typeof a === 'string') return a;
			return String(a as string | number | boolean);
		})
		.join(' ');

	try {
		appendFileSync(logFile, `[${timestamp}] [${category}] ${message}\n`);
	} catch {
		// Silently ignore write errors
	}
}
