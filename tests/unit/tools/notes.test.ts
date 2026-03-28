import { describe, it, expect, beforeEach } from 'vitest';
import { registerNoteTools } from '../../../src/tools/notes.js';
import { createMockServer, createMockSession, fakeUser, fakePost } from './helpers.js';
import { assertDefined } from '../../test-utils.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../../../src/session/session-manager.js';

describe('note tools', () => {
  let server: ReturnType<typeof createMockServer>;
  let session: SessionManager;

  beforeEach(() => {
    server = createMockServer();
    session = createMockSession({
      state: 'editing',
      user: fakeUser,
      post: fakePost,
    });
    registerNoteTools(server as unknown as McpServer, session);
  });

  it('registers all note tools', () => {
    expect(server.registeredTools.has('wp_list_notes')).toBe(true);
    expect(server.registeredTools.has('wp_add_note')).toBe(true);
    expect(server.registeredTools.has('wp_reply_to_note')).toBe(true);
    expect(server.registeredTools.has('wp_resolve_note')).toBe(true);
    expect(server.registeredTools.has('wp_update_note')).toBe(true);
  });

  describe('wp_list_notes', () => {
    it('returns "No notes" when empty', async () => {
      const tool = server.registeredTools.get('wp_list_notes');
      assertDefined(tool);
      const result = await tool.handler({});

      expect(result.content[0].text).toBe('No notes on this post.');
    });

    it('formats notes with block index and replies', async () => {
      const fakeNotes = [
        {
          id: 1,
          post: 42,
          parent: 0,
          author: 1,
          author_name: 'Alice',
          date: '2026-03-20',
          content: { rendered: '<p>Needs more detail</p>', raw: 'Needs more detail' },
          status: 'hold',
          type: 'note',
        },
        {
          id: 2,
          post: 42,
          parent: 1,
          author: 2,
          author_name: 'Bob',
          date: '2026-03-21',
          content: { rendered: '<p>Agreed</p>', raw: 'Agreed' },
          status: 'hold',
          type: 'note',
        },
      ];
      (session.listNotes as ReturnType<typeof import('vitest').vi.fn>).mockResolvedValue({
        notes: fakeNotes,
        noteBlockMap: { 1: '0' },
      });

      const tool = server.registeredTools.get('wp_list_notes');
      assertDefined(tool);
      const result = await tool.handler({});

      const text = result.content[0].text;
      expect(text).toContain('Note #1 by Alice (block [0])');
      expect(text).toContain('"Needs more detail"');
      expect(text).toContain('Reply #2 by Bob');
      expect(text).toContain('"Agreed"');
    });

    it('shows unlinked for notes without block mapping', async () => {
      const fakeNotes = [
        {
          id: 5,
          post: 42,
          parent: 0,
          author: 1,
          author_name: 'Alice',
          date: '2026-03-20',
          content: { rendered: '<p>Orphaned</p>', raw: 'Orphaned' },
          status: 'hold',
          type: 'note',
        },
      ];
      (session.listNotes as ReturnType<typeof import('vitest').vi.fn>).mockResolvedValue({
        notes: fakeNotes,
        noteBlockMap: {},
      });

      const tool = server.registeredTools.get('wp_list_notes');
      assertDefined(tool);
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('(unlinked)');
    });

    it('returns error on failure', async () => {
      (session.listNotes as ReturnType<typeof import('vitest').vi.fn>).mockRejectedValue(
        new Error('Not editing'),
      );

      const tool = server.registeredTools.get('wp_list_notes');
      assertDefined(tool);
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to list notes');
    });
  });

  describe('wp_add_note', () => {
    it('calls session.addNote and returns confirmation', async () => {
      const tool = server.registeredTools.get('wp_add_note');
      assertDefined(tool);
      const result = await tool.handler({ blockIndex: '0', content: 'Needs review' });

      expect(session.addNote).toHaveBeenCalledWith('0', 'Needs review');
      expect(result.content[0].text).toBe('Added note #1 to block [0].');
    });

    it('returns error on failure', async () => {
      (session.addNote as ReturnType<typeof import('vitest').vi.fn>).mockRejectedValue(
        new Error('Block not found'),
      );

      const tool = server.registeredTools.get('wp_add_note');
      assertDefined(tool);
      const result = await tool.handler({ blockIndex: '99', content: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to add note');
    });
  });

  describe('wp_reply_to_note', () => {
    it('calls session.replyToNote and returns confirmation', async () => {
      const tool = server.registeredTools.get('wp_reply_to_note');
      assertDefined(tool);
      const result = await tool.handler({ noteId: 1, content: 'Good point' });

      expect(session.replyToNote).toHaveBeenCalledWith(1, 'Good point');
      expect(result.content[0].text).toBe('Added reply #2 to note #1.');
    });

    it('returns error on failure', async () => {
      (session.replyToNote as ReturnType<typeof import('vitest').vi.fn>).mockRejectedValue(
        new Error('Note not found'),
      );

      const tool = server.registeredTools.get('wp_reply_to_note');
      assertDefined(tool);
      const result = await tool.handler({ noteId: 999, content: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to reply to note');
    });
  });

  describe('wp_resolve_note', () => {
    it('calls session.resolveNote and returns confirmation', async () => {
      const tool = server.registeredTools.get('wp_resolve_note');
      assertDefined(tool);
      const result = await tool.handler({ noteId: 1 });

      expect(session.resolveNote).toHaveBeenCalledWith(1);
      expect(result.content[0].text).toBe('Resolved note #1.');
    });

    it('returns error on failure', async () => {
      (session.resolveNote as ReturnType<typeof import('vitest').vi.fn>).mockRejectedValue(
        new Error('Note not found'),
      );

      const tool = server.registeredTools.get('wp_resolve_note');
      assertDefined(tool);
      const result = await tool.handler({ noteId: 999 });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to resolve note');
    });
  });

  describe('wp_update_note', () => {
    it('calls session.updateNote and returns confirmation', async () => {
      const tool = server.registeredTools.get('wp_update_note');
      assertDefined(tool);
      const result = await tool.handler({ noteId: 1, content: 'Revised feedback' });

      expect(session.updateNote).toHaveBeenCalledWith(1, 'Revised feedback');
      expect(result.content[0].text).toBe('Updated note #1.');
    });

    it('returns error on failure', async () => {
      (session.updateNote as ReturnType<typeof import('vitest').vi.fn>).mockRejectedValue(
        new Error('Note not found'),
      );

      const tool = server.registeredTools.get('wp_update_note');
      assertDefined(tool);
      const result = await tool.handler({ noteId: 999, content: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to update note');
    });
  });
});
