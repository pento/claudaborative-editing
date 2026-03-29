/**
 * Shared test helpers for prompt tests.
 *
 * Provides a mock McpServer that captures prompt registrations and
 * re-exports mock session helpers from the tool test helpers.
 */

import { vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Re-export session helpers so prompt tests don't import from tools/
export {
	createMockSession,
	fakePost,
	fakeUser,
	fakeNote,
} from '../tools/helpers.js';

export interface RegisteredPrompt {
	name: string;
	description: string;
	schema: Record<string, unknown> | undefined;
	handler: (params: Record<string, unknown>) => Promise<{
		description?: string;
		messages: Array<{
			role: 'user' | 'assistant';
			content: { type: string; text: string };
		}>;
	}>;
}

/**
 * Create a mock McpServer that captures prompt registrations.
 *
 * Handles the registerPrompt() signature:
 *   registerPrompt(name, config, handler)
 * where config is { description, argsSchema? }
 */
export function createMockServer(): McpServer & {
	registeredPrompts: Map<string, RegisteredPrompt>;
} {
	const registeredPrompts = new Map<string, RegisteredPrompt>();

	const server = {
		registeredPrompts,
		registerPrompt: vi.fn(
			(
				name: string,
				config: {
					description: string;
					argsSchema?: Record<string, unknown>;
				},
				handler: RegisteredPrompt['handler']
			) => {
				registeredPrompts.set(name, {
					name,
					description: config.description,
					schema: config.argsSchema,
					handler,
				});
			}
		),
	};

	return server as unknown as McpServer & {
		registeredPrompts: Map<string, RegisteredPrompt>;
	};
}
