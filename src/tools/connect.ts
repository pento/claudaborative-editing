import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/session-manager.js';

export function registerConnectTools(
	server: McpServer,
	session: SessionManager
): void {
	server.registerTool(
		'wp_connect',
		{
			description:
				'Connect to a WordPress site for collaborative editing. Not needed if the server was started with WP_SITE_URL, WP_USERNAME, and WP_APP_PASSWORD environment variables — check wp_status first.',
			inputSchema: {
				siteUrl: z
					.string()
					.describe('WordPress site URL (e.g., https://example.com)'),
				username: z.string().describe('WordPress username'),
				appPassword: z
					.string()
					.describe('WordPress Application Password'),
			},
		},
		async ({ siteUrl, username, appPassword }) => {
			const state = session.getState();
			if (state !== 'disconnected') {
				const user = session.getUser();
				const userName = user?.name ?? 'unknown';
				return {
					content: [
						{
							type: 'text' as const,
							text: `Already connected as ${userName}. Use wp_disconnect first to reconnect to a different site.`,
						},
					],
				};
			}

			try {
				const user = await session.connect({
					siteUrl,
					username,
					appPassword,
				});
				return {
					content: [
						{
							type: 'text' as const,
							text: `Connected to ${siteUrl} as ${user.name ?? 'unknown'} (ID: ${user.id})`,
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text' as const,
							text: `Connection failed: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					isError: true,
				};
			}
		}
	);

	server.registerTool(
		'wp_disconnect',
		{ description: 'Disconnect from the WordPress site' },
		async () => {
			await session.disconnect();
			return {
				content: [
					{
						type: 'text' as const,
						text: 'Disconnected from WordPress.',
					},
				],
			};
		}
	);
}
