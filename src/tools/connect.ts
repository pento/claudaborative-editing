import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/session-manager.js';

export function registerConnectTools(server: McpServer, session: SessionManager): void {
  server.tool(
    'wp_connect',
    'Connect to a WordPress site for collaborative editing',
    {
      siteUrl: z.string().describe('WordPress site URL (e.g., https://example.com)'),
      username: z.string().describe('WordPress username'),
      appPassword: z.string().describe('WordPress Application Password'),
    },
    async ({ siteUrl, username, appPassword }) => {
      try {
        const user = await session.connect({ siteUrl, username, appPassword });
        return {
          content: [{ type: 'text' as const, text: `Connected to ${siteUrl} as ${user.name} (ID: ${user.id})` }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Connection failed: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'wp_disconnect',
    'Disconnect from the WordPress site',
    {},
    async () => {
      session.disconnect();
      return {
        content: [{ type: 'text' as const, text: 'Disconnected from WordPress.' }],
      };
    },
  );
}
