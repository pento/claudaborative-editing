import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/session-manager.js';
import {
	formatNotes,
	buildReviewContent,
	buildRespondToNotesContent,
	buildRespondToNoteContent,
} from './prompt-content.js';

export function registerReviewPrompts(
	server: McpServer,
	session: SessionManager
): void {
	server.registerPrompt(
		'review',
		{
			description:
				'Review a WordPress post and leave editorial feedback as notes on individual blocks.',
		},
		() => {
			const state = session.getState();

			if (state === 'disconnected') {
				return {
					description: 'Review a WordPress post',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: 'I want to review a WordPress post. Please connect to WordPress first using wp_connect, then open a post with wp_open_post.',
							},
						},
					],
				};
			}

			if (state === 'connected') {
				return {
					description: 'Review a WordPress post',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: 'I want to review a WordPress post. Please open a post with wp_open_post first.',
							},
						},
					],
				};
			}

			// state === 'editing'
			const postContent = session.readPost();
			const notesSupported = session.getNotesSupported();

			return {
				description: `Review "${session.getTitle()}"`,
				messages: [
					{
						role: 'user' as const,
						content: {
							type: 'text' as const,
							text: buildReviewContent(
								postContent,
								notesSupported
							),
						},
					},
				],
			};
		}
	);

	server.registerPrompt(
		'respond-to-notes',
		{
			description:
				'Address editorial notes on a WordPress post — read each note, make the requested changes, and resolve notes when done.',
		},
		async () => {
			const state = session.getState();

			if (state === 'disconnected') {
				return {
					description: 'Respond to editorial notes',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: 'I want to respond to editorial notes on a WordPress post. Please connect to WordPress first using wp_connect, then open a post with wp_open_post.',
							},
						},
					],
				};
			}

			if (state === 'connected') {
				return {
					description: 'Respond to editorial notes',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: 'I want to respond to editorial notes on a WordPress post. Please open a post with wp_open_post first.',
							},
						},
					],
				};
			}

			// state === 'editing'
			const notesSupported = session.getNotesSupported();

			if (!notesSupported) {
				return {
					description: 'Respond to editorial notes',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: 'This WordPress site does not support notes (requires WordPress 6.9+). There are no notes to respond to.',
							},
						},
					],
				};
			}

			const postContent = session.readPost();
			const { notes, noteBlockMap } = await session.listNotes();

			if (notes.length === 0) {
				return {
					description: 'Respond to editorial notes',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: 'There are no notes on this post. No action needed.',
							},
						},
					],
				};
			}

			const formattedNotes = formatNotes(notes, noteBlockMap);

			return {
				description: `Respond to notes on "${session.getTitle()}"`,
				messages: [
					{
						role: 'user' as const,
						content: {
							type: 'text' as const,
							text: buildRespondToNotesContent(
								postContent,
								formattedNotes
							),
						},
					},
				],
			};
		}
	);

	server.registerPrompt(
		'respond-to-note',
		{
			description:
				'Address a single editorial note on a WordPress post — read it, make the requested changes, and resolve when done.',
			argsSchema: {
				noteId: z.coerce
					.number()
					.int()
					.positive()
					.describe('The ID of the note to address.'),
			},
		},
		async ({ noteId }) => {
			const state = session.getState();

			if (state === 'disconnected') {
				return {
					description: 'Respond to a note',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: 'I want to respond to an editorial note on a WordPress post. Please connect to WordPress first using wp_connect, then open a post with wp_open_post.',
							},
						},
					],
				};
			}

			if (state === 'connected') {
				return {
					description: 'Respond to a note',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: 'I want to respond to an editorial note on a WordPress post. Please open a post with wp_open_post first.',
							},
						},
					],
				};
			}

			// state === 'editing'
			const notesSupported = session.getNotesSupported();

			if (!notesSupported) {
				return {
					description: 'Respond to a note',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: 'This WordPress site does not support notes (requires WordPress 6.9+). There are no notes to respond to.',
							},
						},
					],
				};
			}

			const postContent = session.readPost();
			const { notes, noteBlockMap } = await session.listNotes();

			// Find the target note and its replies
			const targetNote = notes.find((n) => n.id === noteId);

			if (!targetNote) {
				return {
					description: 'Respond to a note',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: `Note #${noteId} was not found on this post. It may have already been resolved. Use wp_list_notes to see current notes.`,
							},
						},
					],
				};
			}

			// Collect the target note and all descendants (not just
			// direct children) so formatNotes can render the full thread.
			const relevantIds = new Set<number>([noteId]);
			let changed = true;
			while (changed) {
				changed = false;
				for (const n of notes) {
					if (!relevantIds.has(n.id) && relevantIds.has(n.parent)) {
						relevantIds.add(n.id);
						changed = true;
					}
				}
			}
			const relevantNotes = notes.filter((n) => relevantIds.has(n.id));
			const relevantMap: Partial<Record<number, string>> = {};
			const blockIdx = noteBlockMap[noteId];
			if (blockIdx !== undefined) {
				relevantMap[noteId] = blockIdx;
			}

			const formattedNote = formatNotes(relevantNotes, relevantMap);

			return {
				description: `Respond to note #${noteId} on "${session.getTitle()}"`,
				messages: [
					{
						role: 'user' as const,
						content: {
							type: 'text' as const,
							text: buildRespondToNoteContent(
								postContent,
								formattedNote
							),
						},
					},
				],
			};
		}
	);
}
