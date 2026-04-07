import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/session-manager.js';
import { buildEditContent, buildProofreadContent } from './prompt-content.js';

export function registerEditingPrompts(
	server: McpServer,
	session: SessionManager
): void {
	server.registerPrompt(
		'edit',
		{
			description: 'Edit a WordPress post with a specific editing focus.',
			argsSchema: {
				editingFocus: z
					.string()
					.trim()
					.min(1)
					.describe(
						'A brief description of the editing focus or intent (e.g., "Make it more formal", "Improve the flow", "Condense the intro")'
					),
			},
		},
		({ editingFocus }) => {
			const state = session.getState();

			if (state === 'disconnected') {
				return {
					description: 'Edit a WordPress post',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: 'I want to edit a WordPress post. Please connect to WordPress first using wp_connect, then open a post with wp_open_post.',
							},
						},
					],
				};
			}

			if (state === 'connected') {
				return {
					description: 'Edit a WordPress post',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: "I want to edit a WordPress post. Please open a post with wp_open_post first, then I'll tell you what changes to make.",
							},
						},
					],
				};
			}

			// state === 'editing'
			const postContent = session.readPost();

			return {
				description: `Edit "${session.getTitle()}"`,
				messages: [
					{
						role: 'user' as const,
						content: {
							type: 'text' as const,
							text: buildEditContent(postContent, editingFocus),
						},
					},
				],
			};
		}
	);

	server.registerPrompt(
		'proofread',
		{
			description:
				'Proofread a WordPress post for grammar, spelling, punctuation, and style issues.',
		},
		() => {
			const state = session.getState();

			if (state === 'disconnected') {
				return {
					description: 'Proofread a WordPress post',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: 'I want to proofread a WordPress post. Please connect to WordPress first using wp_connect, then open a post with wp_open_post.',
							},
						},
					],
				};
			}

			if (state === 'connected') {
				return {
					description: 'Proofread a WordPress post',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: 'I want to proofread a WordPress post. Please open a post with wp_open_post first.',
							},
						},
					],
				};
			}

			// state === 'editing'
			const postContent = session.readPost();

			return {
				description: `Proofread "${session.getTitle()}"`,
				messages: [
					{
						role: 'user' as const,
						content: {
							type: 'text' as const,
							text: buildProofreadContent(postContent),
						},
					},
				],
			};
		}
	);
}
