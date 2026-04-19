import type { PromptDefinition } from './definitions.js';
import {
	buildPrePublishCheckSegments,
	joinSegments,
} from './prompt-content.js';

export const prePublishPrompts: PromptDefinition[] = [
	{
		name: 'pre-publish-check',
		description:
			'Suggest metadata improvements before publishing — excerpt, categories, tags, and slug.',
		buildMessages: (session) => {
			const state = session.getState();

			if (state === 'disconnected') {
				return {
					description: 'Pre-publish check',
					messages: [
						{
							role: 'user',
							content:
								'I want to run a pre-publish check on a WordPress post. Please connect to WordPress first using wp_connect, then open a post with wp_open_post.',
						},
					],
				};
			}

			if (state === 'connected') {
				return {
					description: 'Pre-publish check',
					messages: [
						{
							role: 'user',
							content:
								'I want to run a pre-publish check on a WordPress post. Please open a post with wp_open_post first.',
						},
					],
				};
			}

			// state === 'editing'
			const postContent = session.readPost();
			const segments = buildPrePublishCheckSegments(postContent);

			return {
				description: `Pre-publish check for "${session.getTitle()}"`,
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
