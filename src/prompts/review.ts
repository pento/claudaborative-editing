import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/session-manager.js';
import type { WPNote } from '../wordpress/types.js';

function formatNotes(
	notes: WPNote[],
	noteBlockMap: Partial<Record<number, string>>
): string {
	const topLevel = notes.filter((n) => n.parent === 0);
	const replyMap = new Map<number, WPNote[]>();
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
			blockIdx !== undefined ? ` (block [${blockIdx}])` : ' (unlinked)';
		lines.push(
			`Note #${note.id} by ${note.author_name}${blockInfo} — ${note.date}`
		);
		const rawContent = note.content.raw ?? stripHtml(note.content.rendered);
		lines.push(`  "${rawContent}"`);
		renderReplies(note.id, 1);
		lines.push('');
	}
	return lines.join('\n').trim();
}

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

			if (!notesSupported) {
				return {
					description: `Review "${session.getTitle()}"`,
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: `Review the following WordPress post and provide editorial feedback.

Note: This WordPress site does not support notes (requires WordPress 6.9+). Please provide your feedback as a text summary instead.

Here is the current post content:

${postContent}

Please review for:
- Clarity and readability
- Logical flow and structure
- Factual accuracy concerns
- Missing information or gaps
- Tone and audience appropriateness
- Heading hierarchy and paragraph length
- Post metadata: are categories, tags, and excerpt set appropriately?

Provide your feedback as a structured summary, written in the same language as the post content.`,
							},
						},
					],
				};
			}

			return {
				description: `Review "${session.getTitle()}"`,
				messages: [
					{
						role: 'user' as const,
						content: {
							type: 'text' as const,
							text: `Review the following WordPress post and leave editorial notes on individual blocks.

Here is the current post content:

${postContent}

Instructions:
- Use wp_add_note to attach feedback to specific blocks by their index.
- Each block can have one note. If a block already has a note (marked [has note]), use wp_list_notes to read existing notes and wp_reply_to_note to add your feedback as a reply.
- Review for: clarity, logical flow, factual accuracy, missing information, tone, audience fit, heading hierarchy, and paragraph length.
- Also review post metadata: are categories, tags, and excerpt set appropriately?
- Be specific and actionable in your notes — explain what should change and why.
- Not every block needs a note — only flag issues worth addressing.
- Write all notes in the same language as the post content.
- After leaving all notes, provide a brief summary of your overall assessment.`,
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
							text: `Address the editorial notes on this WordPress post. Read each note, make the requested changes, and resolve notes when done.

Here is the current post content:

${postContent}

Here are the editorial notes:

${formattedNotes}

Instructions:
- Work through each note one at a time.
- For each note:
  1. Read the feedback carefully.
  2. Use wp_update_block to make the requested changes to the referenced block.
  3. If the note requires a response or clarification, use wp_reply_to_note.
  4. Once the note is fully addressed, use wp_resolve_note to mark it done.
- If a note's feedback doesn't apply or you disagree, use wp_reply_to_note to explain why, then move on without resolving.
- Write all replies in the same language as the post content.
- Use wp_read_post to verify your changes after editing.
- After addressing all notes, use wp_save to save the post.`,
						},
					},
				],
			};
		}
	);
}
