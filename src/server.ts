import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SessionManager } from './session/session-manager.js';
import { registerConnectTools } from './tools/connect.js';
import { registerPostTools } from './tools/posts.js';
import { registerReadTools } from './tools/read.js';
import { registerEditTools } from './tools/edit.js';
import { registerStatusTools } from './tools/status.js';

export async function startServer(): Promise<void> {
  const server = new McpServer({
    name: 'claudaborative-editing',
    version: '0.1.0',
  });

  const session = new SessionManager();

  // Auto-connect from env vars if available
  const siteUrl = process.env.WP_SITE_URL;
  const username = process.env.WP_USERNAME;
  const appPassword = process.env.WP_APP_PASSWORD;

  if (siteUrl && username && appPassword) {
    try {
      await session.connect({ siteUrl, username, appPassword });
    } catch (e) {
      // Don't fail startup — user can connect via wp_connect tool
      console.error('Auto-connect failed:', e);
    }
  }

  // Register all tools
  registerConnectTools(server, session);
  registerPostTools(server, session);
  registerReadTools(server, session);
  registerEditTools(server, session);
  registerStatusTools(server, session);

  // Start stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
