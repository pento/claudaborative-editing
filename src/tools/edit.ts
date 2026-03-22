import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/session-manager.js';

/**
 * Recursive block input schema for nested blocks.
 * Uses z.lazy() for self-referential innerBlocks.
 */
interface BlockInput {
  name: string;
  content?: string;
  attributes?: Record<string, unknown>;
  innerBlocks?: BlockInput[];
}

const blockTypeDescription =
  'Block type name (e.g., "core/paragraph", "core/heading", "core/separator")';

const blockInputSchema: z.ZodType<BlockInput> = z.object({
  name: z.string().describe(blockTypeDescription),
  content: z.string().optional().describe('Text content for the block'),
  attributes: z.record(z.unknown()).optional().describe('Block attributes (key-value pairs)'),
  innerBlocks: z
    .lazy(() => z.array(blockInputSchema))
    .optional()
    .describe('Nested child blocks (e.g., list-items inside a list)'),
});

export function registerEditTools(server: McpServer, session: SessionManager): void {
  server.registerTool(
    'wp_update_block',
    {
      description: "Update a block's content and/or attributes",
      inputSchema: {
        index: z.string().describe('Block index (e.g., "0", "2.1" for nested blocks)'),
        content: z.string().optional().describe('New text content for the block'),
        attributes: z
          .record(z.unknown())
          .optional()
          .describe('Attributes to update (key-value pairs)'),
      },
    },
    async ({ index, content, attributes }) => {
      try {
        await session.updateBlock(index, { content, attributes });
        const updated = session.readBlock(index);
        return {
          content: [{ type: 'text' as const, text: `Updated block ${index}.\n\n${updated}` }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to update block: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'wp_insert_block',
    {
      description:
        'Insert a new block at a position in the post. Supports nested blocks via innerBlocks.',
      inputSchema: {
        position: z.number().describe('Position to insert the block (0-based index)'),
        name: z.string().describe(blockTypeDescription),
        content: z.string().optional().describe('Text content for the block'),
        attributes: z.record(z.unknown()).optional().describe('Block attributes (key-value pairs)'),
        innerBlocks: z
          .array(blockInputSchema)
          .optional()
          .describe('Nested child blocks (e.g., list-items inside a list)'),
      },
    },
    async ({ position, name, content, attributes, innerBlocks }) => {
      try {
        await session.insertBlock(position, { name, content, attributes, innerBlocks });
        return {
          content: [
            { type: 'text' as const, text: `Inserted ${name} block at position ${position}.` },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to insert block: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'wp_insert_inner_block',
    {
      description:
        'Insert a block as a child of an existing block (e.g., add a list-item to a list)',
      inputSchema: {
        parentIndex: z
          .string()
          .describe('Dot-notation index of the parent block (e.g., "0", "2.1")'),
        position: z.number().describe("Position within the parent's inner blocks (0-based)"),
        name: z.string().describe(blockTypeDescription),
        content: z.string().optional().describe('Text content for the block'),
        attributes: z.record(z.unknown()).optional().describe('Block attributes (key-value pairs)'),
        innerBlocks: z.array(blockInputSchema).optional().describe('Nested child blocks'),
      },
    },
    async ({ parentIndex, position, name, content, attributes, innerBlocks }) => {
      try {
        await session.insertInnerBlock(parentIndex, position, {
          name,
          content,
          attributes,
          innerBlocks,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: `Inserted ${name} as inner block at ${parentIndex}.${position}.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to insert inner block: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'wp_remove_blocks',
    {
      description: 'Remove one or more blocks from the post',
      inputSchema: {
        startIndex: z.number().describe('Index of the first block to remove'),
        count: z.number().optional().describe('Number of blocks to remove (default 1)'),
      },
    },
    async ({ startIndex, count }) => {
      try {
        const removeCount = count ?? 1;
        session.removeBlocks(startIndex, removeCount);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Removed ${removeCount} block${removeCount !== 1 ? 's' : ''} starting at index ${startIndex}.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to remove blocks: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'wp_remove_inner_blocks',
    {
      description: 'Remove inner blocks from a parent block',
      inputSchema: {
        parentIndex: z.string().describe('Dot-notation index of the parent block (e.g., "0")'),
        startIndex: z.number().describe('Index of the first inner block to remove'),
        count: z.number().optional().describe('Number of inner blocks to remove (default 1)'),
      },
    },
    async ({ parentIndex, startIndex, count }) => {
      try {
        const removeCount = count ?? 1;
        session.removeInnerBlocks(parentIndex, startIndex, removeCount);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Removed ${removeCount} inner block${removeCount !== 1 ? 's' : ''} from block ${parentIndex}.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to remove inner blocks: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'wp_move_block',
    {
      description: 'Move a block from one position to another',
      inputSchema: {
        fromIndex: z.number().describe('Current position of the block'),
        toIndex: z.number().describe('Target position for the block'),
      },
    },
    async ({ fromIndex, toIndex }) => {
      try {
        session.moveBlock(fromIndex, toIndex);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Moved block from position ${fromIndex} to ${toIndex}.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to move block: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'wp_replace_blocks',
    {
      description:
        'Replace a range of blocks with new blocks. Supports nested blocks via innerBlocks.',
      inputSchema: {
        startIndex: z.number().describe('Index of the first block to replace'),
        count: z.number().describe('Number of blocks to replace'),
        blocks: z
          .array(blockInputSchema)
          .describe('New blocks to insert in place of the removed ones'),
      },
    },
    async ({ startIndex, count, blocks }) => {
      try {
        await session.replaceBlocks(startIndex, count, blocks);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Replaced ${count} block${count !== 1 ? 's' : ''} at index ${startIndex} with ${blocks.length} new block${blocks.length !== 1 ? 's' : ''}.`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to replace blocks: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'wp_edit_block_text',
    {
      description:
        'Make surgical find-and-replace text edits within a block. ' +
        'More efficient than wp_update_block for small corrections (typos, ' +
        'grammar fixes) — only the targeted text is changed, preserving concurrent edits.',
      inputSchema: {
        index: z.string().describe('Block index (e.g., "0", "2.1" for nested blocks)'),
        attribute: z
          .string()
          .optional()
          .describe(
            'Rich-text attribute to edit (default: "content"). ' +
              'Use "citation" for quote/pullquote citations, "value" for pullquote text, etc.',
          ),
        edits: z
          .array(
            z.object({
              find: z
                .string()
                .min(1)
                .describe(
                  'Exact text to find in the current content (may include HTML tags like <strong>, <a href="...">)',
                ),
              replace: z
                .string()
                .describe('Replacement text (empty string to delete the found text)'),
              occurrence: z
                .number()
                .int()
                .min(1)
                .optional()
                .describe(
                  'Which occurrence to replace (1-indexed, default 1). Use when the same text appears multiple times.',
                ),
            }),
          )
          .min(1)
          .describe('List of find-and-replace operations applied sequentially'),
      },
    },
    async ({ index, attribute, edits }) => {
      try {
        const result = session.editBlockText(index, edits, attribute);

        const lines: string[] = [];
        if (result.failedCount > 0) {
          lines.push(
            `Applied ${result.appliedCount}/${result.edits.length} edit${result.edits.length !== 1 ? 's' : ''}.`,
          );
          for (const edit of result.edits) {
            if (!edit.applied) {
              lines.push(`  FAILED: find "${edit.find}" — ${edit.error}`);
            }
          }
        } else {
          lines.push(`Applied ${result.appliedCount} edit${result.appliedCount !== 1 ? 's' : ''}.`);
        }

        // Include the updated block rendering for verification
        const updated = session.readBlock(index);
        lines.push('');
        lines.push(updated);

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
          isError: result.appliedCount === 0 && result.failedCount > 0,
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to edit block text: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'wp_set_title',
    {
      description: 'Set the post title',
      inputSchema: {
        title: z.string().describe('New post title'),
      },
    },
    async ({ title }) => {
      try {
        await session.setTitle(title);
        return {
          content: [{ type: 'text' as const, text: `Title set to "${title}".` }],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to set title: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
