import type { SessionManager } from '../session/session-manager.js';
import { VERSION } from '../version.js';
import { WordPressApiError } from '../wordpress/api-client.js';
import type { ToolDefinition, ToolResult } from './definitions.js';

function getPluginDownloadUrl(): string {
	return `https://github.com/pento/claudaborative-editing/releases/download/v${VERSION}/claudaborative-editing-plugin.zip`;
}

export const statusTools: ToolDefinition[] = [
	{
		name: 'wp_status',
		description:
			'Show current connection state, sync status, and post info. ' +
			'If the plugin status includes URLs (download or admin links), ' +
			'always show them to the user as clickable links.',
		execute: async (session) => {
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

				// If plugin not yet detected, try to detect/activate/install it.
				if (!session.getPluginInfo()) {
					await ensureEditorPlugin(session, lines);
				}

				const pluginInfo = session.getPluginInfo();
				if (pluginInfo) {
					lines.push(
						`Plugin: v${pluginInfo.version} (protocol v${pluginInfo.protocolVersion}), listener: ${pluginInfo.transport}`
					);
					if (pluginInfo.protocolWarning) {
						lines.push(`WARNING: ${pluginInfo.protocolWarning}`);
					}
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

			return lines.join('\n');
		},
		tags: ['status'],
	},
	{
		name: 'wp_collaborators',
		description: 'List active collaborators on the current post',
		execute: (session): string | ToolResult => {
			const state = session.getState();
			if (state !== 'editing') {
				return {
					text: 'No post is currently open for editing.',
					isError: true,
				};
			}

			const collaborators = session.getCollaborators();
			const user = session.getUser();

			const lines: string[] = ['Active collaborators:'];

			// Add ourselves first
			if (user) {
				lines.push(`- ${user.name} (AI, Claudaborative Editing MCP)`);
			}

			// Add remote collaborators
			for (const collab of collaborators) {
				lines.push(`- ${collab.name} (Human, ${collab.browserType})`);
			}

			if (collaborators.length === 0 && !user) {
				lines.push('- No collaborators detected');
			}

			return lines.join('\n');
		},
		tags: ['status'],
		availableIn: ['editing'],
	},
	{
		name: 'wp_save',
		description: 'Save the current post',
		execute: async (session) => {
			await session.save();
			return `Post "${session.getTitle()}" saved.`;
		},
		tags: ['status'],
		availableIn: ['editing'],
	},
];

/**
 * Try to get the editor plugin running. Attempts, in order:
 * 1. Re-probe (plugin may have been installed after connect)
 * 2. If installed but inactive, activate it
 * 3. If not installed, install from wordpress.org
 * 4. Fall back to a download URL
 *
 * Appends status messages to `lines`. On success, the command listener
 * is started via detectEditorPlugin() so getPluginInfo() returns data.
 */
async function ensureEditorPlugin(
	session: SessionManager,
	lines: string[]
): Promise<void> {
	// 1. Re-probe — plugin may have been installed/activated externally
	if (await session.detectEditorPlugin()) return;

	// 2. Check if installed but inactive
	try {
		const status = await session.getEditorPluginInstallStatus();

		if (status.installed && !status.active && status.pluginFile) {
			try {
				await session.activateEditorPlugin(status.pluginFile);
				if (await session.detectEditorPlugin()) return;
			} catch {
				// Activation failed — fall through
			}
			lines.push(
				`Plugin: installed but inactive. Activate at ${session.apiClient.createUrl('/wp-admin/plugins.php')}`
			);
			return;
		}

		if (status.installed && status.active) {
			// Plugin is active but detection failed (e.g., older version
			// without /wpce/v1/status, or endpoint blocked). Report as
			// installed but incompatible rather than "not installed".
			lines.push(
				`Plugin: installed (v${status.version}) but not compatible with this MCP server. Check for updates at ${session.apiClient.createUrl('/wp-admin/plugins.php')}`
			);
			return;
		}

		if (!status.installed) {
			// 3. Try wordpress.org install
			try {
				await session.installEditorPlugin();
				if (await session.detectEditorPlugin()) return;
			} catch (installError) {
				if (
					installError instanceof WordPressApiError &&
					installError.status === 404
				) {
					// Not on wordpress.org — fall through to download URL
				} else {
					// Other error (e.g., network) — fall through
				}
			}
		}
	} catch {
		// getEditorPluginInstallStatus failed (e.g., 403 insufficient
		// permissions to list plugins) — fall through to download URL
	}

	lines.push(
		`Plugin: not installed. Download from ${getPluginDownloadUrl()}, then install at ${session.apiClient.createUrl('/wp-admin/plugin-install.php')}`
	);
}
