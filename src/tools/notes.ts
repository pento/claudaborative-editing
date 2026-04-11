import { z } from 'zod';
import type { ToolDefinition } from './definitions.js';

export const noteTools: ToolDefinition[] = [
	{
		name: 'wp_list_notes',
		description:
			'List all notes (block comments) on the currently open post. Returns note content, author, date, and which block each note is attached to. Replies are nested under their parent notes.',
		execute: async (session) => {
			const { notes, noteBlockMap } = await session.listNotes();
			if (notes.length === 0) {
				return 'No notes on this post.';
			}
			// Group: top-level notes (parent === 0) and replies (nested at any depth)
			const topLevel = notes.filter((n) => n.parent === 0);
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
					lines.push(
						`${indent}Reply #${reply.id} by ${reply.author_name} — ${reply.date}`
					);
					const replyContent =
						reply.content.raw ?? stripHtml(reply.content.rendered);
					lines.push(`${indent}  "${replyContent}"`);
					renderReplies(reply.id, depth + 1);
				}
			};

			for (const note of topLevel) {
				const blockIdx = noteBlockMap[note.id];
				const blockInfo =
					blockIdx !== undefined
						? ` (block [${blockIdx}])`
						: ' (unlinked)';
				lines.push(
					`Note #${note.id} by ${note.author_name}${blockInfo} — ${note.date}`
				);
				const rawContent =
					note.content.raw ?? stripHtml(note.content.rendered);
				lines.push(`  "${rawContent}"`);
				renderReplies(note.id, 1);
				lines.push('');
			}
			return lines.join('\n').trim();
		},
		tags: ['notes'],
		availableIn: ['editing'],
	},
	{
		name: 'wp_add_note',
		description:
			'Add a note (block comment) to a specific block. Notes are editorial feedback visible in the WordPress editor but not shown to site visitors.',
		inputSchema: {
			blockIndex: z
				.string()
				.describe('Block index (e.g. "0", "2.1" for nested blocks)'),
			content: z.string().describe('Note text'),
		},
		execute: async (
			session,
			{ blockIndex, content }: { blockIndex: string; content: string }
		) => {
			const note = await session.addNote(blockIndex, content);
			return `Added note #${note.id} to block [${blockIndex}].`;
		},
		tags: ['notes'],
		availableIn: ['editing'],
	},
	{
		name: 'wp_reply_to_note',
		description:
			'Reply to an existing note. Replies are threaded under the parent note.',
		inputSchema: {
			noteId: z.number().describe('ID of the note to reply to'),
			content: z.string().describe('Reply text'),
		},
		execute: async (
			session,
			{ noteId, content }: { noteId: number; content: string }
		) => {
			const reply = await session.replyToNote(noteId, content);
			return `Added reply #${reply.id} to note #${noteId}.`;
		},
		tags: ['notes'],
		availableIn: ['editing'],
	},
	{
		name: 'wp_resolve_note',
		description:
			'Resolve (delete) a note and remove its association from the linked block.',
		inputSchema: {
			noteId: z.number().describe('ID of the note to resolve'),
		},
		execute: async (session, { noteId }: { noteId: number }) => {
			await session.resolveNote(noteId);
			return `Resolved note #${noteId}.`;
		},
		tags: ['notes'],
		availableIn: ['editing'],
	},
	{
		name: 'wp_update_note',
		description: 'Update the content of an existing note.',
		inputSchema: {
			noteId: z.number().describe('ID of the note to update'),
			content: z.string().describe('New note text'),
		},
		execute: async (
			session,
			{ noteId, content }: { noteId: number; content: string }
		) => {
			await session.updateNote(noteId, content);
			return `Updated note #${noteId}.`;
		},
		tags: ['notes'],
		availableIn: ['editing'],
	},
];
