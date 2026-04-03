import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/session-manager.js';

export function registerEditingPrompts(
	server: McpServer,
	session: SessionManager
): void {
	server.registerPrompt(
		'edit',
		{
			description: 'Edit a WordPress post with a specific editing focus.',
			argsSchema: {
				editingFocus: z
					.string()
					.describe(
						'A brief description of the editing focus or intent (e.g., "Make it more formal", "Improve the flow", "Condense the intro")'
					),
			},
		},
		({ editingFocus }) => {
			const state = session.getState();

			if (state === 'disconnected') {
				return {
					description: 'Edit a WordPress post',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: 'I want to edit a WordPress post. Please connect to WordPress first using wp_connect, then open a post with wp_open_post.',
							},
						},
					],
				};
			}

			if (state === 'connected') {
				return {
					description: 'Edit a WordPress post',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: "I want to edit a WordPress post. Please open a post with wp_open_post first, then I'll tell you what changes to make.",
							},
						},
					],
				};
			}

			// state === 'editing'
			const postContent = session.readPost();
			const focusInstruction = `Focus on: ${editingFocus}`;

			return {
				description: `Edit "${session.getTitle()}"`,
				messages: [
					{
						role: 'user' as const,
						content: {
							type: 'text' as const,
							text: `Edit the following WordPress post. ${focusInstruction}

Here is the current post content:

${postContent}

Available tools:
- wp_edit_block_text — make targeted find-and-replace corrections within a block (preferred for small edits)
- wp_update_block — modify an existing block by index (for larger rewrites)
- wp_insert_block — add a new block
- wp_remove_blocks — remove blocks
- wp_replace_blocks — replace a range of blocks
- wp_move_block — reorder blocks
- wp_set_title — change the post title
- wp_set_categories, wp_set_tags — update taxonomy
- wp_set_excerpt — update the post excerpt
- wp_read_post — re-read the post after making changes

Work block by block. Do not try to replace the entire post at once. Preserve the overall structure unless restructuring was requested. After completing edits, use wp_save to save the post.`,
						},
					},
				],
			};
		}
	);

	server.registerPrompt(
		'proofread',
		{
			description:
				'Proofread a WordPress post for grammar, spelling, punctuation, and style issues.',
		},
		() => {
			const state = session.getState();

			if (state === 'disconnected') {
				return {
					description: 'Proofread a WordPress post',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: 'I want to proofread a WordPress post. Please connect to WordPress first using wp_connect, then open a post with wp_open_post.',
							},
						},
					],
				};
			}

			if (state === 'connected') {
				return {
					description: 'Proofread a WordPress post',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: 'I want to proofread a WordPress post. Please open a post with wp_open_post first.',
							},
						},
					],
				};
			}

			// state === 'editing'
			const postContent = session.readPost();

			return {
				description: `Proofread "${session.getTitle()}"`,
				messages: [
					{
						role: 'user' as const,
						content: {
							type: 'text' as const,
							text: `Proofread the following WordPress post. Fix any grammar, spelling, punctuation, and style issues directly.

Here is the current post content:

${postContent}

Instructions:
- Use wp_edit_block_text for targeted corrections (typos, spelling, grammar fixes). This is faster and safer for concurrent editing than replacing the full block text.
- Use wp_update_block only when rewriting a significant portion of a block.
- Fix grammar, spelling, and punctuation errors.
- Fix inconsistent capitalization, hyphenation, and number formatting.
- Fix awkward phrasing or unclear sentences.
- Any obvious fixes can be performed without asking for clarification, but ask if you're unsure about a change.
- Do NOT change the meaning, tone, or structure of the content.
- Do NOT add or remove blocks — only update existing text.
- Do NOT change the title unless it has a clear error.
- Work through every block systematically — do not skip any.
- After completing all fixes, use wp_save to save the post.`,
						},
					},
				],
			};
		}
	);
}
