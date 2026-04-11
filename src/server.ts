import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SessionManager } from './session/session-manager.js';
import { registerAllTools } from './tools/registry.js';
import { registerAllPrompts } from './prompts/registry.js';
import {
	getBaseInstructions,
	getChannelInstructions,
} from './server-instructions.js';

import { VERSION } from './version.js';
export { VERSION };

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

	const instructions =
		getBaseInstructions(autoConnected) + getChannelInstructions();

	const server = new McpServer(
		{ name: 'wpce', version: VERSION },
		{
			capabilities: {
				experimental: { 'claude/channel': {} },
			},
			instructions,
		}
	);

	// Register all tools and prompts
	registerAllTools(server, session);

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
	registerAllPrompts(server, session);

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
