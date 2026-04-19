import { COMMANDS } from '../shared/commands.js';

/**
 * Base MCP server instructions, varying by auto-connect state.
 */
export function getBaseInstructions(autoConnected: boolean): string {
	return autoConnected
		? 'Already connected to WordPress. Do NOT call wp_connect. Use wp_status to check connection state, then wp_open_post or wp_create_post to start editing.'
		: 'Use wp_connect to connect to a WordPress site first, or use wp_status to check connection state.';
}

/**
 * Channel instructions for handling WordPress editor commands.
 * Built from the shared COMMANDS definitions.
 */
export function getChannelInstructions(): string {
	const promptDescriptions = Object.values(COMMANDS)
		.map((cmd) => {
			if (cmd.channelHint) {
				return cmd.channelHint;
			}
			const argHints = Object.entries(cmd.args)
				.map(([name]) => `arguments.${name}`)
				.join(', ');
			return argHints
				? `"${cmd.slug}" (${cmd.description}, using ${argHints})`
				: `"${cmd.slug}" (${cmd.description})`;
		})
		.join(', ');

	return `

When you receive a <channel source="wpce"> event, it contains a command from a user in the WordPress editor. Check the meta.event_type field:

**Content-embedded command (meta.content_embedded = "true"):**
The notification content contains the full post content and task instructions. The post is already open.
1. If meta.status is "already_claimed", proceed directly to step 3.
2. Otherwise, call wp_update_command_status with the command_id and status "running".
3. Execute the task described in the notification content. Do NOT call wp_open_post or wp_read_post — the content is already embedded.
4. Call wp_update_command_status with status "completed" and a brief summary, or "failed" with an error message.

**New command (no event_type or event_type is absent, no content_embedded):**
1. If meta.status is "already_claimed", skip this step. Otherwise, call wp_update_command_status with the command_id from the notification metadata and status "running".
2. If no post is open, call wp_open_post with the post_id from the notification metadata. If a different post is open, call wp_close_post first.
3. Execute the requested action based on the prompt field: ${promptDescriptions}.
4. Call wp_update_command_status with status "completed" and a brief summary, or "failed" with an error message.

**User response (event_type = "response"):**
This is a reply to a question you asked via awaiting_input. The command is already in "running" status — do NOT call wp_update_command_status with "running" again. The meta.messages field contains the full conversation history. Resume processing the original command using the conversation context.

**Asking the user a question (two-way communication):**
To ask the user a follow-up question during command execution:
1. Call wp_update_command_status with status "awaiting_input" and your question as the message. WordPress automatically tracks the conversation history, so resultData is optional. If you include resultData, use it only for non-message workflow flags (for example, state such as planReady) and do NOT duplicate conversation messages/history there.
2. Format messages as simple HTML: use <p> tags for paragraphs, <strong> for emphasis, <ol>/<ul>/<li> for lists.
3. Wait for a <channel source="wpce"> notification with event_type "response". Do not proceed until you receive it.
4. The awaiting_input status does not expire — the user can take their time responding.

**Language for status messages and questions:**
Text sent to wp_update_command_status — the "message" field for every status, and the question text on awaiting_input — is displayed in the WordPress editor UI and must be written in the user's locale. The user's locale is provided as meta.user_locale on the channel notification (e.g. "fr_FR", "ja_JP"). If meta.user_locale is missing or unknown, fall back to the document's language; if the document's language is also unknown or is itself what you're asking the user to clarify, fall back to the site locale hint in the embedded prompt. This rule applies to all status messages regardless of the language the post content is written in.`;
}
