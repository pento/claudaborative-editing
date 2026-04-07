import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/session-manager.js';

export function registerComposePrompts(
	server: McpServer,
	session: SessionManager
): void {
	server.registerPrompt(
		'compose',
		{
			description:
				'Plan and outline a WordPress post through guided conversation.',
		},
		() => {
			const state = session.getState();

			if (state === 'disconnected') {
				return {
					description: 'Compose a WordPress post',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: 'I want to plan and outline a WordPress post. Please connect to WordPress first using wp_connect, then open or create a post with wp_open_post or wp_create_post.',
							},
						},
					],
				};
			}

			if (state === 'connected') {
				return {
					description: 'Compose a WordPress post',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: 'I want to plan and outline a WordPress post. Please open an existing post with wp_open_post or create a new one with wp_create_post first.',
							},
						},
					],
				};
			}

			// state === 'editing'
			const postContent = session.readPost();
			const notesSupported = session.getNotesSupported();

			const scaffoldingInstructions = notesSupported
				? `When the user approves the outline, scaffold the post:
1. Set the post title with wp_set_title.
2. Insert a core/heading block (level 2) for each section with wp_insert_block.
3. Insert an empty core/paragraph block after each heading as a writing placeholder.
4. Save the post with wp_save — this flushes all block changes to the browser so that notes can be attached to the correct blocks.
5. After saving, add a Note on each heading block with wp_add_note describing what to write in that section — include key points, suggested angle, relevant details from the conversation, and approximate length guidance.
6. Save the post again with wp_save.

Important: You MUST save (step 4) between inserting blocks and adding notes. Notes reference blocks by index, so the blocks must be synced to the browser first.

The author will then write each section in their own voice, guided by the notes.`
				: `When the user approves the outline, scaffold the post:
- Set the post title with wp_set_title.
- Insert a core/heading block (level 2) for each section with wp_insert_block.
- Insert a core/paragraph block after each heading containing writing guidance in italics — key points, suggested angle, relevant details from the conversation, and approximate length guidance. The author will replace this with their own writing.
- Save the post with wp_save.

Note: This WordPress site does not support editorial notes (requires WordPress 6.9+), so writing guidance is included as placeholder paragraphs instead.`;

			return {
				description: `Compose outline for "${session.getTitle()}"`,
				messages: [
					{
						role: 'user' as const,
						content: {
							type: 'text' as const,
							text: `Help me plan and outline a WordPress post through a guided conversation. You are an assistant helping me organize my ideas — you will NOT write the actual post content. Your job is to help me clarify my thinking and produce a structured outline with writing notes.

${postContent.trim() ? `Here is the current post content (which may be empty or a rough starting point):\n\n${postContent}\n` : 'This is a new/empty post.'}

## Process

### Phase 1: Discovery
Ask me 2-3 focused questions to understand what I want to write about. Ask one question at a time using wp_update_command_status with status "awaiting_input". Topics to explore:
- What is the main purpose or thesis of this post?
- Who is the target audience?
- What are the key points or ideas to cover?
- What tone or style should it have?

Do NOT ask all questions at once — ask one, wait for my response, then ask the next based on what I said. Skip questions if the answer is already obvious from context or prior answers.

### Phase 2: Outlining
Based on my answers, propose an outline with 4-8 sections. For each section, include:
- A clear section title
- 2-4 bullet points describing what should be covered

Present the outline in your message and set status to "awaiting_input". Also send resultData with {"planReady": true} — this adds an "Approve outline" button in the editor sidebar so the user doesn't have to type "approve" manually.

### Phase 3: Refining
If I request changes (instead of approving), update the outline and re-propose with planReady: true again. If I ask a question that needs clarification before you can update the outline, respond WITHOUT planReady (omit resultData) until the outline is ready again.

### Phase 4: Scaffolding
${scaffoldingInstructions}

## Two-way communication

To ask me a question during any phase:
1. Call wp_update_command_status with status "awaiting_input" and your question as the message. WordPress automatically tracks the conversation history — you do NOT need to send resultData.
2. Wait for a channel notification with event_type "response" — this contains my answer. The full conversation history is in the notification's meta.messages field.

## Message formatting

Your messages are displayed in a WordPress sidebar panel. Format them as simple HTML:
- Use <p> tags for paragraphs (not literal newline characters).
- Use <strong> for emphasis, <ol>/<ul>/<li> for lists.
- Use plain colons instead of em dashes for labels (e.g., "Audience: ..." not "Audience — ...").
- Do NOT use markdown syntax — it will not be rendered.`,
						},
					},
				],
			};
		}
	);
}
