import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/session-manager.js';

export function registerStatusTools(
	server: McpServer,
	session: SessionManager
): void {
	server.registerTool(
		'wp_status',
		{
			description:
				'Show current connection state, sync status, and post info',
		},
		() => {
			const state = session.getState();
			const lines: string[] = [];

			if (state === 'disconnected') {
				lines.push('Connection: disconnected');
				lines.push('');
				lines.push('Use wp_connect to connect to a WordPress site.');
			} else {
				const user = session.getUser();
				lines.push('Connection: connected');
				lines.push(
					`User: ${user?.name ?? 'unknown'} (ID: ${user?.id ?? '?'})`
				);

				lines.push(
					`Notes: ${session.getNotesSupported() ? 'supported' : 'not supported (requires WordPress 6.9+)'}`
				);

				const pluginInfo = session.getPluginInfo();
				if (pluginInfo) {
					lines.push(
						`Plugin: v${pluginInfo.version} (protocol v${pluginInfo.protocolVersion}), listener: ${pluginInfo.transport}`
					);
				} else {
					lines.push('Plugin: not detected');
				}

				const post = session.getCurrentPost();
				if (state === 'editing' && post) {
					const postGoneInfo = session.isPostGone();
					if (postGoneInfo.gone) {
						lines.push(
							`WARNING: ${postGoneInfo.reason ?? 'This post is no longer available.'}`
						);
						lines.push(
							'Use wp_close_post to close it, then open another post.'
						);
						lines.push(`Post: (ID: ${post.id})`);
					} else {
						const syncStatus = session.getSyncStatus();
						const collaboratorCount =
							session.getCollaborators().length;

						lines.push(
							`Sync: ${syncStatus?.isPolling ? 'polling' : 'stopped'} (${collaboratorCount + 1} collaborator${collaboratorCount + 1 !== 1 ? 's' : ''})`
						);
						lines.push(
							`Post: "${session.getTitle()}" (ID: ${post.id}, status: ${post.status})`
						);
						lines.push(
							`Queue: ${syncStatus?.queueSize ?? 0} pending updates`
						);
					}
				} else {
					lines.push('Post: none open');
					lines.push('');
					lines.push(
						'Use wp_open_post or wp_create_post to start editing.'
					);
				}
			}

			return {
				content: [{ type: 'text' as const, text: lines.join('\n') }],
			};
		}
	);

	server.registerTool(
		'wp_collaborators',
		{ description: 'List active collaborators on the current post' },
		() => {
			try {
				const state = session.getState();
				if (state !== 'editing') {
					return {
						content: [
							{
								type: 'text' as const,
								text: 'No post is currently open for editing.',
							},
						],
						isError: true,
					};
				}

				const collaborators = session.getCollaborators();
				const user = session.getUser();

				const lines: string[] = ['Active collaborators:'];

				// Add ourselves first
				if (user) {
					lines.push(`- ${user.name} (AI, Claude Code MCP)`);
				}

				// Add remote collaborators
				for (const collab of collaborators) {
					lines.push(
						`- ${collab.name} (Human, ${collab.browserType})`
					);
				}

				if (collaborators.length === 0 && !user) {
					lines.push('- No collaborators detected');
				}

				return {
					content: [
						{ type: 'text' as const, text: lines.join('\n') },
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text' as const,
							text: `Failed to get collaborators: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					isError: true,
				};
			}
		}
	);

	server.registerTool(
		'wp_save',
		{ description: 'Save the current post' },
		async () => {
			try {
				await session.save();
				return {
					content: [
						{
							type: 'text' as const,
							text: `Post "${session.getTitle()}" saved.`,
						},
					],
				};
			} catch (error) {
				return {
					content: [
						{
							type: 'text' as const,
							text: `Failed to save: ${error instanceof Error ? error.message : String(error)}`,
						},
					],
					isError: true,
				};
			}
		}
	);
}
