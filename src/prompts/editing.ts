import { z } from 'zod';
import type { PromptDefinition } from './definitions.js';
import {
	buildEditSegments,
	buildProofreadSegments,
	joinSegments,
} from './prompt-content.js';

export const editingPrompts: PromptDefinition[] = [
	{
		name: 'edit',
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
		buildMessages: (
			session,
			{ editingFocus }: { editingFocus: string }
		) => {
			const state = session.getState();

			if (state === 'disconnected') {
				return {
					description: 'Edit a WordPress post',
					messages: [
						{
							role: 'user',
							content:
								'I want to edit a WordPress post. Please connect to WordPress first using wp_connect, then open a post with wp_open_post.',
						},
					],
				};
			}

			if (state === 'connected') {
				return {
					description: 'Edit a WordPress post',
					messages: [
						{
							role: 'user',
							content:
								"I want to edit a WordPress post. Please open a post with wp_open_post first, then I'll tell you what changes to make.",
						},
					],
				};
			}

			// state === 'editing'
			const postContent = session.readPost();
			const segments = buildEditSegments(postContent, editingFocus);

			return {
				description: `Edit "${session.getTitle()}"`,
				messages: [
					{
						role: 'user',
						content: joinSegments(segments),
					},
				],
				segments,
			};
		},
	},
	{
		name: 'proofread',
		description:
			'Proofread a WordPress post for grammar, spelling, punctuation, and style issues.',
		buildMessages: (session) => {
			const state = session.getState();

			if (state === 'disconnected') {
				return {
					description: 'Proofread a WordPress post',
					messages: [
						{
							role: 'user',
							content:
								'I want to proofread a WordPress post. Please connect to WordPress first using wp_connect, then open a post with wp_open_post.',
						},
					],
				};
			}

			if (state === 'connected') {
				return {
					description: 'Proofread a WordPress post',
					messages: [
						{
							role: 'user',
							content:
								'I want to proofread a WordPress post. Please open a post with wp_open_post first.',
						},
					],
				};
			}

			// state === 'editing'
			const postContent = session.readPost();
			const segments = buildProofreadSegments(postContent);

			return {
				description: `Proofread "${session.getTitle()}"`,
				messages: [
					{
						role: 'user',
						content: joinSegments(segments),
					},
				],
				segments,
			};
		},
	},
];
