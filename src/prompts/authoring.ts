import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/session-manager.js';

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
							text: `Translate the following WordPress post into ${language}.

Here is the current post content:

${postContent}

Instructions:
- Translate the title using wp_set_title.
- Translate each block's content using wp_update_block, working through blocks in order.
- If the post has an excerpt, translate it using wp_set_excerpt.
- Preserve all HTML formatting, links, and block structure exactly.
- Do NOT add, remove, or reorder blocks.
- Do NOT change non-text attributes (images, URLs, etc.) unless they contain translatable alt text or captions.
- Adapt idioms and cultural references naturally rather than translating literally.
- After completing the translation, use wp_read_post to verify, then wp_save to save.`,
						},
					},
				],
			};
		}
	);
}
