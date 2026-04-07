import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/session-manager.js';
import { buildTranslateContent } from './prompt-content.js';

export function registerAuthoringPrompts(
	server: McpServer,
	session: SessionManager
): void {
	server.registerPrompt(
		'translate',
		{
			description: 'Translate a WordPress post into another language.',
			argsSchema: {
				language: z
					.string()
					.trim()
					.min(1)
					.describe(
						'Target language (e.g., "Spanish", "French", "Japanese", "zh-CN")'
					),
			},
		},
		({ language }) => {
			const state = session.getState();

			if (state === 'disconnected') {
				return {
					description: 'Translate a WordPress post',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: 'I want to translate a WordPress post. Please connect to WordPress first using wp_connect, then open a post with wp_open_post.',
							},
						},
					],
				};
			}

			if (state === 'connected') {
				return {
					description: 'Translate a WordPress post',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: 'I want to translate a WordPress post. Please open a post with wp_open_post first.',
							},
						},
					],
				};
			}

			// state === 'editing'
			const postContent = session.readPost();

			return {
				description: `Translate "${session.getTitle()}" into ${language}`,
				messages: [
					{
						role: 'user' as const,
						content: {
							type: 'text' as const,
							text: buildTranslateContent(postContent, language),
						},
					},
				],
			};
		}
	);
}
