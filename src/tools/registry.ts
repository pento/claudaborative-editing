import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/session-manager.js';
import type { SessionState } from '../session/session-manager.js';
import type { ToolDefinition } from './definitions.js';

import { connectTools } from './connect.js';
import { postTools } from './posts.js';
import { readTools } from './read.js';
import { editTools } from './edit.js';
import { statusTools } from './status.js';
import { blockTypeTools } from './block-types.js';
import { mediaTools } from './media.js';
import { noteTools } from './notes.js';
import { metadataTools } from './metadata.js';
import { commandTools } from './commands.js';

/** All tool definitions, aggregated from every tool file. */
export const allTools: ToolDefinition[] = [
	...connectTools,
	...postTools,
	...readTools,
	...editTools,
	...statusTools,
	...blockTypeTools,
	...mediaTools,
	...noteTools,
	...metadataTools,
	...commandTools,
];

export function getToolByName(name: string): ToolDefinition | undefined {
	return allTools.find((t) => t.name === name);
}

export function getToolsForState(state: SessionState): ToolDefinition[] {
	return allTools.filter(
		(t) => !t.availableIn || t.availableIn.includes(state)
	);
}

export function getToolsByTag(tag: string): ToolDefinition[] {
	return allTools.filter((t) => t.tags?.includes(tag));
}

/**
 * Register a set of tool definitions on an MCP server instance.
 * Wraps each tool's execute function with uniform error handling.
 */
export function registerToolDefinitions(
	server: McpServer,
	session: SessionManager,
	tools: ToolDefinition[]
): void {
	for (const tool of tools) {
		server.registerTool(
			tool.name,
			{
				description: tool.description,
				...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
			},
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic dispatch, validated by Zod
			async (input: any) => {
				try {
					const result = await tool.execute(session, input);
					if (typeof result === 'string') {
						return {
							content: [{ type: 'text' as const, text: result }],
						};
					}
					return {
						content: [{ type: 'text' as const, text: result.text }],
						...(result.isError ? { isError: true } : {}),
					};
				} catch (error) {
					return {
						content: [
							{
								type: 'text' as const,
								text: `${tool.name} failed: ${error instanceof Error ? error.message : String(error)}`,
							},
						],
						isError: true,
					};
				}
			}
		);
	}
}

/**
 * Register all tools on an MCP server instance.
 */
export function registerAllTools(
	server: McpServer,
	session: SessionManager
): void {
	registerToolDefinitions(server, session, allTools);
}
