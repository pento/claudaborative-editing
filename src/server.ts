import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { COMMANDS } from '../shared/commands.js';
import { SessionManager } from './session/session-manager.js';
import { registerConnectTools } from './tools/connect.js';
import { registerPostTools } from './tools/posts.js';
import { registerReadTools } from './tools/read.js';
import { registerEditTools } from './tools/edit.js';
import { registerStatusTools } from './tools/status.js';
import { registerBlockTypeTools } from './tools/block-types.js';
import { registerMediaTools } from './tools/media.js';
import { registerNoteTools } from './tools/notes.js';
import { registerMetadataTools } from './tools/metadata.js';
import { registerCommandTools } from './tools/commands.js';
import { registerEditingPrompts } from './prompts/editing.js';
import { registerReviewPrompts } from './prompts/review.js';
import { registerAuthoringPrompts } from './prompts/authoring.js';

declare const __PKG_VERSION__: string;

export const VERSION =
	typeof __PKG_VERSION__ !== 'undefined' ? __PKG_VERSION__ : '0.0.0-dev';

export async function startServer(): Promise<void> {
	const session = new SessionManager();

	// Auto-connect from env vars if available
	let autoConnected = false;
	const siteUrl = process.env.WP_SITE_URL;
	const username = process.env.WP_USERNAME;
	const appPassword = process.env.WP_APP_PASSWORD;

	if (siteUrl && username && appPassword) {
		try {
			await session.connect({ siteUrl, username, appPassword });
			autoConnected = true;
		} catch (e) {
			// Don't fail startup — user can connect via wp_connect tool
			console.error('Auto-connect failed:', e);
		}
	}

	// Set instructions based on whether auto-connect succeeded
	const baseInstructions = autoConnected
		? 'Already connected to WordPress. Do NOT call wp_connect. Use wp_status to check connection state, then wp_open_post or wp_create_post to start editing.'
		: 'Use wp_connect to connect to a WordPress site first, or use wp_status to check connection state.';

	// Build the prompt→action mapping for channel instructions from shared definitions
	const promptDescriptions = Object.values(COMMANDS)
		.map((cmd) => {
			const argHints = Object.entries(cmd.args)
				.map(([name]) => `arguments.${name}`)
				.join(', ');
			const hint = argHints
				? `"${cmd.slug}" (${cmd.description}, using ${argHints})`
				: `"${cmd.slug}" (${cmd.description})`;
			return hint;
		})
		.join(', ');

	const channelInstructions = `

When you receive a <channel source="wpce"> event, it contains a command from a user in the WordPress editor. Follow these steps:
1. Call wp_update_command_status with the command_id from the notification metadata and status "running".
2. If no post is open, call wp_open_post with the post_id from the notification metadata. If a different post is open, call wp_close_post first.
3. Execute the requested action based on the prompt field: ${promptDescriptions}.
4. Call wp_update_command_status with status "completed" and a brief summary, or "failed" with an error message.`;

	const instructions = baseInstructions + channelInstructions;

	const server = new McpServer(
		{ name: 'wpce', version: VERSION },
		{
			capabilities: {
				experimental: { 'claude/channel': {} },
			},
			instructions,
		}
	);

	// Register all tools
	registerConnectTools(server, session);
	registerPostTools(server, session);
	registerReadTools(server, session);
	registerEditTools(server, session);
	registerStatusTools(server, session);
	registerBlockTypeTools(server, session);
	registerMediaTools(server, session);
	registerNoteTools(server, session);
	registerMetadataTools(server, session);
	registerCommandTools(server, session);

	// Wire up channel notifications from the command handler to the MCP client.
	// Uses a type cast because notifications/claude/channel is experimental
	// and not in the SDK's ServerNotification union type.
	session.setChannelNotifier(async (params) => {
		await server.server.notification({
			method: 'notifications/claude/channel',
			params,
		} as never);
	});

	// Register all prompts
	registerEditingPrompts(server, session);
	registerReviewPrompts(server, session);
	registerAuthoringPrompts(server, session);

	// Start stdio transport
	const transport = new StdioServerTransport();
	await server.connect(transport);

	// Graceful shutdown: prevent the default SIGTERM/SIGINT behavior (immediate
	// exit) so the MCP SDK can finish responding to any pending shutdown request.
	// Also handle stdin EOF — the StdioServerTransport doesn't detect it, and the
	// SyncClient polling timer would otherwise keep the process alive forever.
	let shutdownInProgress = false;

	const cleanup = async () => {
		if (shutdownInProgress) return;
		shutdownInProgress = true;

		await session.disconnect();
		await server.close();
		process.exit(0);
	};

	process.on('SIGTERM', () => {
		void cleanup();
	});
	process.on('SIGINT', () => {
		void cleanup();
	});
	process.stdin.on('end', () => {
		void cleanup();
	});
}
