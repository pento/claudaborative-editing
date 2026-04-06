import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/session-manager.js';

export function registerCommandTools(
	server: McpServer,
	session: SessionManager
): void {
	server.registerTool(
		'wp_update_command_status',
		{
			description:
				'Update the status of a command received from the WordPress editor. Call this when starting, completing, or failing a command from a channel notification.',
			inputSchema: {
				commandId: z
					.number()
					.describe(
						'The command ID from the channel notification metadata'
					),
				status: z
					.enum(['running', 'completed', 'failed'])
					.describe('New status for the command'),
				message: z
					.string()
					.optional()
					.describe('Status message or error description'),
				resultData: z
					.string()
					.optional()
					.refine(
						(val) => {
							if (val === undefined) return true;
							try {
								const parsed: unknown = JSON.parse(val);
								return (
									typeof parsed === 'object' &&
									parsed !== null &&
									!Array.isArray(parsed)
								);
							} catch {
								return false;
							}
						},
						{ message: 'resultData must be a JSON object string' }
					)
					.describe(
						'Optional JSON object string of structured result data for the command response'
					),
			},
		},
		async ({ commandId, status, message, resultData }) => {
			try {
				await session.updateCommandStatus(
					commandId,
					status,
					message,
					resultData
				);
				return {
					content: [
						{
							type: 'text' as const,
							text: `Command ${commandId} status updated to "${status}".`,
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text' as const,
							text: `Failed to update command status: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					isError: true,
				};
			}
		}
	);
}
