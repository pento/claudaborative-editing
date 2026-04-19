import type { z } from 'zod';
import type { SessionManager } from '../session/session-manager.js';
import type { PromptSegments } from './prompt-content.js';

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
 *
 * `messages` is authoritative for the MCP prompt path.
 *
 * `segments`, when present, exposes the same prompt body split into a stable
 * `staticInstructions` prefix and a per-invocation `dynamicContext` suffix.
 * A hosted Anthropic orchestrator consumes these segments directly and
 * applies cache_control on the static prefix to enable prompt caching.
 * MCP callers can ignore it.
 */
export interface PromptResult {
	description: string;
	messages: PromptMessage[];
	segments?: PromptSegments;
}

/**
 * Portable prompt definition that can be consumed by both the MCP server
 * (via registerPromptDefinitions) and a hosted orchestrator.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional: args validated by Zod at runtime
export interface PromptDefinition<TArgs = any> {
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
		args: TArgs
	) => Promise<PromptResult> | PromptResult;
}
