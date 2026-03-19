import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/session-manager.js';

export function registerEditTools(server: McpServer, session: SessionManager): void {
  server.tool(
    'wp_update_block',
    'Update a block\'s content and/or attributes',
    {
      index: z.string().describe('Block index (e.g., "0", "2.1" for nested blocks)'),
      content: z.string().optional().describe('New text content for the block'),
      attributes: z.record(z.unknown()).optional().describe('Attributes to update (key-value pairs)'),
    },
    async ({ index, content, attributes }) => {
      try {
        session.updateBlock(index, { content, attributes });
        const updated = session.readBlock(index);
        return {
          content: [{ type: 'text' as const, text: `Updated block ${index}.\n\n${updated}` }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Failed to update block: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'wp_insert_block',
    'Insert a new block at a position in the post',
    {
      position: z.number().describe('Position to insert the block (0-based index)'),
      name: z.string().describe('Block type name (e.g., "core/paragraph", "core/heading")'),
      content: z.string().optional().describe('Text content for the block'),
      attributes: z.record(z.unknown()).optional().describe('Block attributes (key-value pairs)'),
    },
    async ({ position, name, content, attributes }) => {
      try {
        session.insertBlock(position, { name, content, attributes });
        return {
          content: [{ type: 'text' as const, text: `Inserted ${name} block at position ${position}.` }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Failed to insert block: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'wp_remove_blocks',
    'Remove one or more blocks from the post',
    {
      startIndex: z.number().describe('Index of the first block to remove'),
      count: z.number().optional().describe('Number of blocks to remove (default 1)'),
    },
    async ({ startIndex, count }) => {
      try {
        const removeCount = count ?? 1;
        session.removeBlocks(startIndex, removeCount);
        return {
          content: [{
            type: 'text' as const,
            text: `Removed ${removeCount} block${removeCount !== 1 ? 's' : ''} starting at index ${startIndex}.`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Failed to remove blocks: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'wp_move_block',
    'Move a block from one position to another',
    {
      fromIndex: z.number().describe('Current position of the block'),
      toIndex: z.number().describe('Target position for the block'),
    },
    async ({ fromIndex, toIndex }) => {
      try {
        session.moveBlock(fromIndex, toIndex);
        return {
          content: [{
            type: 'text' as const,
            text: `Moved block from position ${fromIndex} to ${toIndex}.`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Failed to move block: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'wp_replace_blocks',
    'Replace a range of blocks with new blocks',
    {
      startIndex: z.number().describe('Index of the first block to replace'),
      count: z.number().describe('Number of blocks to replace'),
      blocks: z.array(z.object({
        name: z.string().describe('Block type name (e.g., "core/paragraph")'),
        content: z.string().optional().describe('Text content for the block'),
        attributes: z.record(z.unknown()).optional().describe('Block attributes'),
      })).describe('New blocks to insert in place of the removed ones'),
    },
    async ({ startIndex, count, blocks }) => {
      try {
        session.replaceBlocks(startIndex, count, blocks);
        return {
          content: [{
            type: 'text' as const,
            text: `Replaced ${count} block${count !== 1 ? 's' : ''} at index ${startIndex} with ${blocks.length} new block${blocks.length !== 1 ? 's' : ''}.`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Failed to replace blocks: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'wp_set_title',
    'Set the post title',
    {
      title: z.string().describe('New post title'),
    },
    async ({ title }) => {
      try {
        session.setTitle(title);
        return {
          content: [{ type: 'text' as const, text: `Title set to "${title}".` }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Failed to set title: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
