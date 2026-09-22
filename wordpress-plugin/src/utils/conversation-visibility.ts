/**
 * Shared logic for deciding when a command has a conversation panel.
 *
 * Used by ConversationPanel (to decide whether to render) and AiActionsMenu
 * (to decide whether to offer a "Resume" item that reopens the panel) so the
 * two always agree on when a panel exists to resume.
 */

/**
 * Internal dependencies
 */
import type { CommandSlug } from '#shared/commands';
import type { Command } from '../store/types';

// Command prompts that open the conversation sidebar on submit (before the
// MCP server has produced any messages).
export const CONVERSATIONAL_PROMPTS: readonly CommandSlug[] = ['compose'];

/**
 * Whether a command has a visible conversation panel.
 *
 * True when the command is awaiting user input, when it is running with
 * conversation messages already present, or when a conversational command
 * (e.g. compose) is in flight — those open the sidebar the moment they're
 * pending so the user sees the processing indicator instead of nothing.
 *
 * @param command The command to check, or null.
 * @return Whether a conversation panel exists for the command.
 */
export function isConversationVisible(command: Command | null): boolean {
	if (!command) {
		return false;
	}
	const isPending = command.status === 'pending';
	const isRunning = command.status === 'running';
	const isAwaitingInput = command.status === 'awaiting_input';
	const isRunningWithConversation = !!(
		isRunning &&
		command.result_data &&
		Array.isArray(command.result_data.messages)
	);
	const isConversationalCommand = CONVERSATIONAL_PROMPTS.includes(
		command.prompt
	);

	return (
		isAwaitingInput ||
		isRunningWithConversation ||
		((isPending || isRunning) && isConversationalCommand)
	);
}
