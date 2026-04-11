import type { z } from 'zod';
import type {
	SessionManager,
	SessionState,
} from '../session/session-manager.js';

/**
 * Structured tool result for cases where `execute` needs to signal
 * an error without throwing (e.g., expected-state checks, partial failures).
 */
export interface ToolResult {
	text: string;
	isError?: boolean;
}

/**
 * Portable tool definition that can be consumed by both the MCP server
 * (via registerToolDefinitions) and a hosted orchestrator (via the
 * Anthropic API tool-use protocol).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional: input validated by Zod at runtime
export interface ToolDefinition<TInput = any> {
	/** Tool name (e.g., "wp_read_post") */
	name: string;

	/** Description shown to the model */
	description: string;

	/**
	 * Optional Zod raw shape (record of Zod fields).
	 * Omit for tools with no input parameters.
	 * Matches the shape the MCP SDK's registerTool() expects.
	 */
	inputSchema?: z.ZodRawShape;

	/**
	 * Execute the tool.
	 *
	 * Return a string for a simple success message, or a ToolResult object
	 * when you need to set isError without throwing (e.g., expected-state
	 * checks, partial failures).
	 *
	 * Throw on unexpected errors — the caller (MCP wrapper or hosted
	 * orchestrator) handles error formatting uniformly.
	 */
	execute: (
		session: SessionManager,
		input: TInput
	) => Promise<string | ToolResult> | string | ToolResult;

	/** Session states in which this tool is available (metadata only) */
	availableIn?: SessionState[];

	/** Tags for filtering (e.g., 'connection', 'editing', 'metadata') */
	tags?: string[];
}
