import { z } from 'zod';
import type { ToolDefinition } from './definitions.js';

interface ConnectInput {
	siteUrl: string;
	username: string;
	appPassword: string;
}

export const connectTools: ToolDefinition[] = [
	{
		name: 'wp_connect',
		description:
			'Connect to a WordPress site for collaborative editing. Not needed if the server was started with WP_SITE_URL, WP_USERNAME, and WP_APP_PASSWORD environment variables — check wp_status first.',
		inputSchema: {
			siteUrl: z
				.string()
				.describe('WordPress site URL (e.g., https://example.com)'),
			username: z.string().describe('WordPress username'),
			appPassword: z.string().describe('WordPress Application Password'),
		},
		availableIn: ['disconnected'],
		tags: ['connection'],
		execute: async (
			session,
			{ siteUrl, username, appPassword }: ConnectInput
		) => {
			const state = session.getState();
			if (state !== 'disconnected') {
				const user = session.getUser();
				const userName = user?.name ?? 'unknown';
				return `Already connected as ${userName}. Use wp_disconnect first to reconnect to a different site.`;
			}
			const user = await session.connect({
				siteUrl,
				username,
				appPassword,
			});
			return `Connected to ${siteUrl} as ${user.name ?? 'unknown'} (ID: ${user.id})`;
		},
	},
	{
		name: 'wp_disconnect',
		description: 'Disconnect from the WordPress site',
		availableIn: ['connected', 'editing'],
		tags: ['connection'],
		execute: async (session) => {
			await session.disconnect();
			return 'Disconnected from WordPress.';
		},
	},
];
