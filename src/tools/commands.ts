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
				'Update the status of a command received from the WordPress editor. Call this when starting, completing, or failing a command from a channel notification. For awaiting_input: only send status and message — do NOT send resultData (WordPress manages conversation history automatically).',
			inputSchema: {
				commandId: z
					.number()
					.describe(
						'The command ID from the channel notification metadata'
					),
				status: z
					.enum(['running', 'completed', 'failed', 'awaiting_input'])
					.describe('New status for the command'),
				message: z
					.string()
					.optional()
					.describe(
						'Status message, error description, or question for the user. For awaiting_input: format as HTML (use <p> for paragraphs, <strong> for emphasis, <ol>/<ul>/<li> for lists, colons for labels).'
					),
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
						'Optional JSON object string of structured result data. For awaiting_input: conversation messages are managed automatically — only send flags here (e.g., {"planReady": true} when the outline is ready for approval). The planReady flag adds an Approve button in the editor.'
					),
			},
		},
		async ({ commandId, status, message, resultData }) => {
			// Strip CDATA wrappers that Claude Code may add to prevent
			// HTML in the message from being parsed as XML.
			const cleanMessage = message?.replace(
				/^<!\[CDATA\[([\s\S]*)\]\]>$/,
				'$1'
			);

			try {
				await session.updateCommandStatus(
					commandId,
					status,
					cleanMessage,
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
