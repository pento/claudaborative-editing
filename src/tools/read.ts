import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/session-manager.js';

export function registerReadTools(server: McpServer, session: SessionManager): void {
  server.tool(
    'wp_read_post',
    'Read the current post content as a block listing',
    {},
    async () => {
      try {
        const content = session.readPost();
        return {
          content: [{ type: 'text' as const, text: content }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Failed to read post: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'wp_read_block',
    'Read a specific block by index (supports dot notation for nested blocks, e.g., "2.1")',
    {
      index: z.string().describe('Block index (e.g., "0", "2.1" for nested blocks)'),
    },
    async ({ index }) => {
      try {
        const content = session.readBlock(index);
        return {
          content: [{ type: 'text' as const, text: content }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Failed to read block: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
