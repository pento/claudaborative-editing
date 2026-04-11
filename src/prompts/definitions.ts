import type { z } from 'zod';
import type { SessionManager } from '../session/session-manager.js';

/**
 * A single message in a prompt response.
 * Uses simplified `content: string` instead of the MCP SDK's
 * `{ type: 'text', text }` object — the registry wrapper converts.
 */
export interface PromptMessage {
	role: 'user' | 'assistant';
	content: string;
}

/**
 * Result returned by a prompt's buildMessages function.
 */
export interface PromptResult {
	description: string;
	messages: PromptMessage[];
}

/**
 * Portable prompt definition that can be consumed by both the MCP server
 * (via registerPromptDefinitions) and a hosted orchestrator.
 */
export interface PromptDefinition {
	/** Prompt name (e.g., "review", "proofread") */
	name: string;

	/** Description shown to the model */
	description: string;

	/**
	 * Optional Zod raw shape for prompt arguments.
	 * Omit for prompts with no arguments.
	 */
	argsSchema?: z.ZodRawShape;

	/**
	 * Build the prompt messages for the given session state and arguments.
	 * Handles state checks internally (returns guidance messages for
	 * disconnected/connected states).
	 */
	buildMessages: (
		session: SessionManager,
		args: Record<string, string>
	) => Promise<PromptResult> | PromptResult;
}
