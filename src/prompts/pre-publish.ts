import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/session-manager.js';
import { buildPrePublishCheckContent } from './prompt-content.js';

export function registerPrePublishPrompts(
	server: McpServer,
	session: SessionManager
): void {
	server.registerPrompt(
		'pre-publish-check',
		{
			description:
				'Suggest metadata improvements before publishing — excerpt, categories, tags, and slug.',
		},
		() => {
			const state = session.getState();

			if (state === 'disconnected') {
				return {
					description: 'Pre-publish check',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: 'I want to run a pre-publish check on a WordPress post. Please connect to WordPress first using wp_connect, then open a post with wp_open_post.',
							},
						},
					],
				};
			}

			if (state === 'connected') {
				return {
					description: 'Pre-publish check',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: 'I want to run a pre-publish check on a WordPress post. Please open a post with wp_open_post first.',
							},
						},
					],
				};
			}

			// state === 'editing'
			const postContent = session.readPost();

			return {
				description: `Pre-publish check for "${session.getTitle()}"`,
				messages: [
					{
						role: 'user' as const,
						content: {
							type: 'text' as const,
							text: buildPrePublishCheckContent(postContent),
						},
					},
				],
			};
		}
	);
}
