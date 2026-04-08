import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/session-manager.js';
import { buildComposeContent } from './prompt-content.js';

export function registerComposePrompts(
	server: McpServer,
	session: SessionManager
): void {
	server.registerPrompt(
		'compose',
		{
			description:
				'Plan and outline a WordPress post through guided conversation.',
		},
		() => {
			const state = session.getState();

			if (state === 'disconnected') {
				return {
					description: 'Compose a WordPress post',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: 'I want to plan and outline a WordPress post. Please connect to WordPress first using wp_connect, then open or create a post with wp_open_post or wp_create_post.',
							},
						},
					],
				};
			}

			if (state === 'connected') {
				return {
					description: 'Compose a WordPress post',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: 'I want to plan and outline a WordPress post. Please open an existing post with wp_open_post or create a new one with wp_create_post first.',
							},
						},
					],
				};
			}

			// state === 'editing'
			const postContent = session.readPost();
			const notesSupported = session.getNotesSupported();

			return {
				description: `Compose outline for "${session.getTitle()}"`,
				messages: [
					{
						role: 'user' as const,
						content: {
							type: 'text' as const,
							text: buildComposeContent(
								postContent,
								notesSupported
							),
						},
					},
				],
			};
		}
	);
}
