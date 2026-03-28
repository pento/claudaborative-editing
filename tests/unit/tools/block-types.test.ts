import { describe, it, expect, vi, beforeEach } from 'vitest';
import { registerBlockTypeTools } from '../../../src/tools/block-types.js';
import { createMockServer, createMockSession } from './helpers.js';
import { assertDefined } from '../../test-utils.js';
import { BlockTypeRegistry } from '../../../src/yjs/block-type-registry.js';
import type { WPBlockType } from '../../../src/wordpress/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../../../src/session/session-manager.js';

/**
 * Create a mock session whose getRegistry() returns a registry built
 * from the given WPBlockType array.
 */
function createSessionWithRegistry(blockTypes: WPBlockType[]) {
  const registry = BlockTypeRegistry.fromApiResponse(blockTypes);
  const session = createMockSession({ state: 'connected' });
  Object.assign(session, { getRegistry: vi.fn().mockReturnValue(registry) });
  return session;
}

/**
 * Create a mock session whose getRegistry() returns a fallback registry
 * (simulates API being unavailable during connect).
 */
function createSessionWithFallbackRegistry() {
  const registry = BlockTypeRegistry.createFallback();
  const session = createMockSession({ state: 'connected' });
  Object.assign(session, { getRegistry: vi.fn().mockReturnValue(registry) });
  return session;
}

/** A small set of block types used across multiple tests. */
const sampleBlockTypes: WPBlockType[] = [
  {
    name: 'core/paragraph',
    title: 'Paragraph',
    attributes: {
      content: { type: 'rich-text', source: 'rich-text' },
      dropCap: { type: 'boolean', default: false },
    },
  },
  {
    name: 'core/heading',
    title: 'Heading',
    attributes: {
      content: { type: 'rich-text', source: 'rich-text' },
      level: { type: 'integer', default: 2 },
    },
  },
  {
    name: 'core/quote',
    title: 'Quote',
    attributes: {
      value: { type: 'rich-text', source: 'rich-text' },
      citation: { type: 'rich-text', source: 'rich-text' },
    },
  },
  {
    name: 'core/pullquote',
    title: 'Pullquote',
    attributes: {
      value: { type: 'rich-text', source: 'rich-text' },
      citation: { type: 'rich-text', source: 'rich-text' },
      textAlign: { type: 'string' },
    },
  },
];

describe('block-types tool', () => {
  let server: ReturnType<typeof createMockServer>;
  let session: SessionManager;

  beforeEach(() => {
    server = createMockServer();
    session = createSessionWithRegistry(sampleBlockTypes);
    registerBlockTypeTools(server as unknown as McpServer, session);
  });

  it('registers wp_block_types tool', () => {
    expect(server.registeredTools.has('wp_block_types')).toBe(true);
  });

  describe('exact name lookup', () => {
    it('returns full block type info for exact name', async () => {
      const tool = server.registeredTools.get('wp_block_types');
      assertDefined(tool);
      const result = await tool.handler({ name: 'core/pullquote' });

      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain('core/pullquote');
      expect(text).toContain('Pullquote');
      expect(text).toContain('value');
      expect(text).toContain('rich-text');
      expect(text).toContain('citation');
    });

    it('returns error for unknown block type', async () => {
      const tool = server.registeredTools.get('wp_block_types');
      assertDefined(tool);
      const result = await tool.handler({ name: 'core/unknown' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('core/unknown');
      expect(result.content[0].text).toContain('not found');
    });
  });

  describe('search', () => {
    it('searches block types by name', async () => {
      const tool = server.registeredTools.get('wp_block_types');
      assertDefined(tool);
      const result = await tool.handler({ search: 'quote' });

      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain('core/pullquote');
      expect(text).toContain('core/quote');
    });

    it('searches block types by title', async () => {
      const tool = server.registeredTools.get('wp_block_types');
      assertDefined(tool);
      const result = await tool.handler({ search: 'Pullquote' });

      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain('core/pullquote');
    });

    it('returns message for no matches', async () => {
      const tool = server.registeredTools.get('wp_block_types');
      assertDefined(tool);
      const result = await tool.handler({ search: 'zzzzz' });

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('No block types matching');
    });
  });

  describe('list all', () => {
    it('lists all block types when no arguments given', async () => {
      const tool = server.registeredTools.get('wp_block_types');
      assertDefined(tool);
      const result = await tool.handler({});

      expect(result.isError).toBeUndefined();
      const text = result.content[0].text;
      expect(text).toContain('core/paragraph');
      expect(text).toContain('core/heading');
      expect(text).toContain('core/quote');
      expect(text).toContain('core/pullquote');
      expect(text).toContain('4 registered block types');
    });
  });

  describe('fallback warning', () => {
    it('shows reconnect hint when connected with fallback registry', async () => {
      server = createMockServer();
      session = createSessionWithFallbackRegistry();
      registerBlockTypeTools(server as unknown as McpServer, session);

      const tool = server.registeredTools.get('wp_block_types');
      assertDefined(tool);
      const result = await tool.handler({});

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('fallback');
      expect(result.content[0].text).toContain('disconnecting and reconnecting');
    });

    it('shows connect hint when disconnected with fallback registry', async () => {
      server = createMockServer();
      const registry = BlockTypeRegistry.createFallback();
      session = createMockSession({ state: 'disconnected' });
      Object.assign(session, { getRegistry: vi.fn().mockReturnValue(registry) });
      registerBlockTypeTools(server as unknown as McpServer, session);

      const tool = server.registeredTools.get('wp_block_types');
      assertDefined(tool);
      const result = await tool.handler({});

      expect(result.isError).toBeUndefined();
      expect(result.content[0].text).toContain('fallback');
      expect(result.content[0].text).toContain('Connect to a WordPress site');
    });
  });

  describe('info formatting', () => {
    it('shows parent/allowedBlocks constraints', async () => {
      server = createMockServer();
      session = createSessionWithRegistry([
        {
          name: 'core/column',
          title: 'Column',
          attributes: {},
          parent: ['core/columns'],
        },
        {
          name: 'core/columns',
          title: 'Columns',
          attributes: {},
          allowed_blocks: ['core/column'],
        },
      ]);
      registerBlockTypeTools(server as unknown as McpServer, session);

      const tool = server.registeredTools.get('wp_block_types');
      assertDefined(tool);

      const columnResult = await tool.handler({ name: 'core/column' });
      expect(columnResult.content[0].text).toContain('Parent: core/columns');

      const columnsResult = await tool.handler({ name: 'core/columns' });
      expect(columnsResult.content[0].text).toContain('Allowed inner blocks: core/column');
    });

    it('shows default values', async () => {
      const tool = server.registeredTools.get('wp_block_types');
      assertDefined(tool);
      const result = await tool.handler({ name: 'core/paragraph' });

      const text = result.content[0].text;
      expect(text).toContain('default=false');
    });

    it('shows InnerBlocks support when supports.allowedBlocks is true', async () => {
      server = createMockServer();
      session = createSessionWithRegistry([
        {
          name: 'core/quote',
          title: 'Quote',
          attributes: {
            citation: { type: 'rich-text', source: 'rich-text' },
          },
          supports: { allowedBlocks: true },
        },
      ]);
      registerBlockTypeTools(server as unknown as McpServer, session);

      const tool = server.registeredTools.get('wp_block_types');
      assertDefined(tool);
      const result = await tool.handler({ name: 'core/quote' });

      expect(result.content[0].text).toContain('Supports InnerBlocks: yes');
    });
  });
});
