import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/session-manager.js';
import type { PromptDefinition } from './definitions.js';

import { editingPrompts } from './editing.js';
import { reviewPrompts } from './review.js';
import { authoringPrompts } from './authoring.js';
import { composePrompts } from './compose.js';
import { prePublishPrompts } from './pre-publish.js';

/** All prompt definitions, aggregated from every prompt file. */
export const allPrompts: PromptDefinition[] = [
	...editingPrompts,
	...reviewPrompts,
	...authoringPrompts,
	...composePrompts,
	...prePublishPrompts,
];

export function getPromptByName(name: string): PromptDefinition | undefined {
	return allPrompts.find((p) => p.name === name);
}

/**
 * Register a set of prompt definitions on an MCP server instance.
 * Converts the simplified PromptMessage format to the MCP SDK's
 * { type: 'text', text } content structure.
 */
export function registerPromptDefinitions(
	server: McpServer,
	session: SessionManager,
	prompts: PromptDefinition[]
): void {
	for (const prompt of prompts) {
		server.registerPrompt(
			prompt.name,
			{
				description: prompt.description,
				...(prompt.argsSchema ? { argsSchema: prompt.argsSchema } : {}),
			},
			async (args: Record<string, unknown>) => {
				const result = await prompt.buildMessages(session, args);
				return {
					description: result.description,
					messages: result.messages.map((m) => ({
						role: m.role,
						content: {
							type: 'text' as const,
							text: m.content,
						},
					})),
				};
			}
		);
	}
}

/**
 * Register all prompts on an MCP server instance.
 */
export function registerAllPrompts(
	server: McpServer,
	session: SessionManager
): void {
	registerPromptDefinitions(server, session, allPrompts);
}
