import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/session-manager.js';
import type { BlockTypeInfo } from '../yjs/block-type-registry.js';

/**
 * Format a single block type's info for display.
 */
function formatBlockTypeInfo(info: BlockTypeInfo): string {
  const lines: string[] = [];
  lines.push(`${info.name} — ${info.title}`);

  if (info.attributes.length > 0) {
    lines.push('  Attributes:');
    for (const attr of info.attributes) {
      let desc = `    ${attr.name} (${attr.type})`;
      if (attr.richText) desc += ' [rich-text]';
      if (attr.default !== undefined) desc += ` default=${JSON.stringify(attr.default)}`;
      lines.push(desc);
    }
  } else {
    lines.push('  Attributes: (none)');
  }

  if (info.parent) {
    lines.push(`  Parent: ${info.parent.join(', ')}`);
  }
  if (info.ancestor) {
    lines.push(`  Ancestor: ${info.ancestor.join(', ')}`);
  }
  if (info.allowedBlocks) {
    lines.push(`  Allowed inner blocks: ${info.allowedBlocks.join(', ')}`);
  }

  return lines.join('\n');
}

export function registerBlockTypeTools(server: McpServer, session: SessionManager): void {
  server.registerTool(
    'wp_block_types',
    {
      description:
        'Look up block type schemas — attributes, defaults, nesting constraints. Use before inserting unfamiliar block types.',
      inputSchema: {
        name: z
          .string()
          .optional()
          .describe('Exact block type name (e.g., "core/pullquote") for full details'),
        search: z
          .string()
          .optional()
          .describe('Search block types by name (e.g., "quote", "media")'),
      },
    },
    async ({ name, search }) => {
      try {
        const registry = session.getRegistry();

        if (registry.isUsingFallback()) {
          const state = session.getState();
          const hint =
            state === 'disconnected'
              ? 'Connect to a WordPress site to load full block schemas.'
              : 'Full block schemas could not be loaded. Try disconnecting and reconnecting.';
          return {
            content: [
              {
                type: 'text' as const,
                text: `Block type registry is using fallback data. Only basic block type information is available. ${hint}`,
              },
            ],
          };
        }

        // Exact lookup by name
        if (name) {
          const info = registry.getBlockTypeInfo(name);
          if (!info) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `Block type "${name}" not found. Use search to find block types.`,
                },
              ],
              isError: true,
            };
          }
          return {
            content: [{ type: 'text' as const, text: formatBlockTypeInfo(info) }],
          };
        }

        // Search by substring
        if (search) {
          const results = registry.searchBlockTypes(search);
          if (results.length === 0) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `No block types matching "${search}".`,
                },
              ],
            };
          }
          const text = results.map((r) => `${r.name} — ${r.title}`).join('\n');
          return {
            content: [
              {
                type: 'text' as const,
                text: `Found ${results.length} block type${results.length !== 1 ? 's' : ''}:\n${text}`,
              },
            ],
          };
        }

        // No arguments: list all block type names
        const allNames = registry.getKnownBlockTypeNames();
        return {
          content: [
            {
              type: 'text' as const,
              text: `${allNames.length} registered block types:\n${allNames.join('\n')}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to look up block types: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
