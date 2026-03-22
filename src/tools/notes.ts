import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/session-manager.js';

export function registerNoteTools(server: McpServer, session: SessionManager): void {
  server.tool(
    'wp_list_notes',
    'List all notes (block comments) on the currently open post. Returns note content, author, date, and which block each note is attached to. Replies are nested under their parent notes.',
    {},
    async () => {
      try {
        const { notes, noteBlockMap } = await session.listNotes();
        if (notes.length === 0) {
          return { content: [{ type: 'text' as const, text: 'No notes on this post.' }] };
        }
        // Group: top-level notes (parent === 0) and replies (nested at any depth)
        const topLevel = notes.filter(n => n.parent === 0);
        const replyMap = new Map<number, typeof notes>();
        for (const note of notes) {
          if (note.parent !== 0) {
            const list = replyMap.get(note.parent) ?? [];
            list.push(note);
            replyMap.set(note.parent, list);
          }
        }

        const lines: string[] = [];
        const stripHtml = (html: string) => html.replace(/<[^>]*>/g, '');
        const renderReplies = (parentId: number, depth: number) => {
          const replies = replyMap.get(parentId) ?? [];
          const indent = '  '.repeat(depth);
          for (const reply of replies) {
            lines.push(`${indent}Reply #${reply.id} by ${reply.author_name} — ${reply.date}`);
            const replyContent = reply.content.raw ?? stripHtml(reply.content.rendered);
            lines.push(`${indent}  "${replyContent}"`);
            renderReplies(reply.id, depth + 1);
          }
        };

        for (const note of topLevel) {
          const blockIdx = noteBlockMap[note.id];
          const blockInfo = blockIdx != null ? ` (block [${blockIdx}])` : ' (unlinked)';
          lines.push(`Note #${note.id} by ${note.author_name}${blockInfo} — ${note.date}`);
          const rawContent = note.content.raw ?? stripHtml(note.content.rendered);
          lines.push(`  "${rawContent}"`);
          renderReplies(note.id, 1);
          lines.push('');
        }
        return { content: [{ type: 'text' as const, text: lines.join('\n').trim() }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed to list notes: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    'wp_add_note',
    'Add a note (block comment) to a specific block. Notes are editorial feedback visible in the WordPress editor but not shown to site visitors.',
    {
      blockIndex: z.string().describe('Block index (e.g. "0", "2.1" for nested blocks)'),
      content: z.string().describe('Note text'),
    },
    async ({ blockIndex, content }) => {
      try {
        const note = await session.addNote(blockIndex, content);
        return { content: [{ type: 'text' as const, text: `Added note #${note.id} to block [${blockIndex}].` }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed to add note: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    'wp_reply_to_note',
    'Reply to an existing note. Replies are threaded under the parent note.',
    {
      noteId: z.number().describe('ID of the note to reply to'),
      content: z.string().describe('Reply text'),
    },
    async ({ noteId, content }) => {
      try {
        const reply = await session.replyToNote(noteId, content);
        return { content: [{ type: 'text' as const, text: `Added reply #${reply.id} to note #${noteId}.` }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed to reply to note: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    'wp_resolve_note',
    'Resolve (delete) a note and remove its association from the linked block.',
    {
      noteId: z.number().describe('ID of the note to resolve'),
    },
    async ({ noteId }) => {
      try {
        await session.resolveNote(noteId);
        return { content: [{ type: 'text' as const, text: `Resolved note #${noteId}.` }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed to resolve note: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  server.tool(
    'wp_update_note',
    'Update the content of an existing note.',
    {
      noteId: z.number().describe('ID of the note to update'),
      content: z.string().describe('New note text'),
    },
    async ({ noteId, content }) => {
      try {
        await session.updateNote(noteId, content);
        return { content: [{ type: 'text' as const, text: `Updated note #${noteId}.` }] };
      } catch (err) {
        return { content: [{ type: 'text' as const, text: `Failed to update note: ${(err as Error).message}` }], isError: true };
      }
    },
  );
}
