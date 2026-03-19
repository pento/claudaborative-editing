import { describe, it, expect, beforeEach } from 'vitest';
import { registerEditTools } from '../../../src/tools/edit.js';
import { createMockServer, createMockSession, fakeUser, fakePost } from './helpers.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../../../src/session/session-manager.js';

describe('edit tools', () => {
  let server: ReturnType<typeof createMockServer>;
  let session: SessionManager;

  beforeEach(() => {
    server = createMockServer();
    session = createMockSession({
      state: 'editing',
      user: fakeUser,
      post: fakePost,
      blockContent: '[0] core/paragraph\n  "Updated content"',
    });
    registerEditTools(server as unknown as McpServer, session);
  });

  it('registers all edit tools', () => {
    expect(server.registeredTools.has('wp_update_block')).toBe(true);
    expect(server.registeredTools.has('wp_insert_block')).toBe(true);
    expect(server.registeredTools.has('wp_remove_blocks')).toBe(true);
    expect(server.registeredTools.has('wp_move_block')).toBe(true);
    expect(server.registeredTools.has('wp_replace_blocks')).toBe(true);
    expect(server.registeredTools.has('wp_set_title')).toBe(true);
  });

  describe('wp_update_block', () => {
    it('updates block and returns confirmation', async () => {
      const tool = server.registeredTools.get('wp_update_block')!;
      const result = await tool.handler({
        index: '0',
        content: 'New content',
      });

      expect(session.updateBlock).toHaveBeenCalledWith('0', {
        content: 'New content',
        attributes: undefined,
      });
      expect(result.content[0].text).toContain('Updated block 0');
    });

    it('passes attributes to updateBlock', async () => {
      const tool = server.registeredTools.get('wp_update_block')!;
      await tool.handler({
        index: '1',
        attributes: { level: 3 },
      });

      expect(session.updateBlock).toHaveBeenCalledWith('1', {
        content: undefined,
        attributes: { level: 3 },
      });
    });

    it('returns error when not editing', async () => {
      (session.updateBlock as ReturnType<typeof import('vitest').vi.fn>).mockImplementation(() => {
        throw new Error("Operation requires state editing, but current state is 'connected'");
      });

      const tool = server.registeredTools.get('wp_update_block')!;
      const result = await tool.handler({ index: '0', content: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to update block');
    });
  });

  describe('wp_insert_block', () => {
    it('inserts block and returns confirmation', async () => {
      const tool = server.registeredTools.get('wp_insert_block')!;
      const result = await tool.handler({
        position: 1,
        name: 'core/paragraph',
        content: 'New paragraph',
      });

      expect(session.insertBlock).toHaveBeenCalledWith(1, {
        name: 'core/paragraph',
        content: 'New paragraph',
        attributes: undefined,
      });
      expect(result.content[0].text).toContain('Inserted core/paragraph block at position 1');
    });

    it('returns error on failure', async () => {
      (session.insertBlock as ReturnType<typeof import('vitest').vi.fn>).mockImplementation(() => {
        throw new Error("Operation requires state editing, but current state is 'disconnected'");
      });

      const tool = server.registeredTools.get('wp_insert_block')!;
      const result = await tool.handler({ position: 0, name: 'core/paragraph' });

      expect(result.isError).toBe(true);
    });
  });

  describe('wp_remove_blocks', () => {
    it('removes blocks with default count of 1', async () => {
      const tool = server.registeredTools.get('wp_remove_blocks')!;
      const result = await tool.handler({ startIndex: 2 });

      expect(session.removeBlocks).toHaveBeenCalledWith(2, 1);
      expect(result.content[0].text).toContain('Removed 1 block starting at index 2');
    });

    it('removes multiple blocks', async () => {
      const tool = server.registeredTools.get('wp_remove_blocks')!;
      const result = await tool.handler({ startIndex: 0, count: 3 });

      expect(session.removeBlocks).toHaveBeenCalledWith(0, 3);
      expect(result.content[0].text).toContain('Removed 3 blocks');
    });
  });

  describe('wp_move_block', () => {
    it('moves block and returns confirmation', async () => {
      const tool = server.registeredTools.get('wp_move_block')!;
      const result = await tool.handler({ fromIndex: 0, toIndex: 3 });

      expect(session.moveBlock).toHaveBeenCalledWith(0, 3);
      expect(result.content[0].text).toContain('Moved block from position 0 to 3');
    });
  });

  describe('wp_replace_blocks', () => {
    it('replaces blocks and returns confirmation', async () => {
      const tool = server.registeredTools.get('wp_replace_blocks')!;
      const result = await tool.handler({
        startIndex: 1,
        count: 2,
        blocks: [
          { name: 'core/heading', content: 'New Heading', attributes: { level: 2 } },
          { name: 'core/paragraph', content: 'New paragraph' },
        ],
      });

      expect(session.replaceBlocks).toHaveBeenCalledWith(1, 2, [
        { name: 'core/heading', content: 'New Heading', attributes: { level: 2 } },
        { name: 'core/paragraph', content: 'New paragraph' },
      ]);
      expect(result.content[0].text).toContain('Replaced 2 blocks at index 1 with 2 new blocks');
    });
  });

  describe('wp_set_title', () => {
    it('sets title and returns confirmation', async () => {
      const tool = server.registeredTools.get('wp_set_title')!;
      const result = await tool.handler({ title: 'New Title' });

      expect(session.setTitle).toHaveBeenCalledWith('New Title');
      expect(result.content[0].text).toContain('Title set to "New Title"');
    });

    it('returns error when not editing', async () => {
      (session.setTitle as ReturnType<typeof import('vitest').vi.fn>).mockImplementation(() => {
        throw new Error("Operation requires state editing, but current state is 'disconnected'");
      });

      const tool = server.registeredTools.get('wp_set_title')!;
      const result = await tool.handler({ title: 'Test' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to set title');
    });
  });
});
