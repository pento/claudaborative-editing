/**
 * Conversation panel component.
 *
 * Renders a PluginSidebar for two-way communication with the AI assistant
 * during commands that use the awaiting_input status. Shows message history
 * and provides a text input for the user to respond.
 *
 * The sidebar is hidden from the editor's Panels menu via CSS (see style.scss)
 * since it opens/closes automatically based on command state.
 */

/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { Button, TextareaControl } from '@wordpress/components';
import { useSelect, useDispatch } from '@wordpress/data';
import { useState, useEffect, useRef, RawHTML } from '@wordpress/element';
import { store as noticesStore } from '@wordpress/notices';
import { PluginSidebar } from '@wordpress/editor';

/**
 * Internal dependencies
 */
import { useCommands } from '../../hooks/use-commands';
import { getCommandLabel } from '../../utils/command-i18n';
import aiActionsStore from '../../store';
import SparkleIcon from '../SparkleIcon';
import type {
	ConversationMessage,
	ConversationResultData,
} from '../../store/types';

import './style.scss';

const SIDEBAR_ID = 'claudaborative-editing-conversation/conversation';

/**
 * Extract conversation data from a command's result_data.
 *
 * @param resultData The command's result_data field.
 * @return Parsed conversation data, or null if not a conversation.
 */
function getConversationData(
	resultData: Record<string, unknown> | null
): ConversationResultData | null {
	if (!resultData || !Array.isArray(resultData.messages)) {
		return null;
	}
	return resultData as unknown as ConversationResultData;
}

/**
 * ConversationPanel component.
 *
 * Registers a PluginSidebar that shows conversation history and input
 * when the active command is in awaiting_input status. Auto-opens when
 * entering awaiting_input.
 *
 * @return Rendered sidebar or null.
 */
export default function ConversationPanel() {
	const currentPostId = useSelect(
		(select) => select(aiActionsStore).getCurrentPostId(),
		[]
	);

	const { activeCommand, isResponding, respondToCommand, cancel } =
		useCommands(currentPostId);

	const { createNotice } = useDispatch(noticesStore);

	const [inputValue, setInputValue] = useState('');
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const prevStatusRef = useRef<string | null>(null);

	const isAwaitingInput = activeCommand?.status === 'awaiting_input';
	const isRunningWithConversation =
		activeCommand?.status === 'running' &&
		activeCommand.result_data &&
		Array.isArray(activeCommand.result_data.messages);

	const shouldShow = isAwaitingInput || isRunningWithConversation;

	const conversationData = activeCommand
		? getConversationData(activeCommand.result_data)
		: null;

	// Use result_data.messages if available; fall back to the command's
	// message field so the panel still shows content when Claude puts the
	// question in message but omits the messages array from resultData.
	let messages: ConversationMessage[] = conversationData?.messages ?? [];
	if (messages.length === 0 && activeCommand?.message && isAwaitingInput) {
		messages = [
			{
				role: 'assistant',
				content: activeCommand.message,
				timestamp: '',
			},
		];
	}

	const inputPrompt = conversationData?.input_prompt;
	const planReady = activeCommand?.result_data?.planReady === true;

	// Auto-open the sidebar when entering awaiting_input state or on
	// initial mount with an existing awaiting_input command.
	const { enableComplementaryArea } = useDispatch('core/interface') as {
		enableComplementaryArea: (scope: string, id: string) => void;
	};

	useEffect(() => {
		const currentStatus = activeCommand?.status ?? null;

		if (
			currentStatus === 'awaiting_input' &&
			prevStatusRef.current !== 'awaiting_input'
		) {
			enableComplementaryArea?.('core', SIDEBAR_ID);
		}
		prevStatusRef.current = currentStatus;
	}, [activeCommand?.status, enableComplementaryArea]);

	// Auto-scroll to bottom when messages change
	useEffect(() => {
		messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
	}, [messages.length]);

	// Focus textarea when entering awaiting_input state
	useEffect(() => {
		if (isAwaitingInput) {
			const timer = setTimeout(() => {
				textareaRef.current?.focus();
			}, 100);
			return () => clearTimeout(timer);
		}
	}, [isAwaitingInput]);

	if (!shouldShow) {
		return null;
	}

	const handleSend = () => {
		const trimmed = inputValue.trim();
		if (!trimmed || !activeCommand || isResponding) return;

		setInputValue('');
		void Promise.resolve(respondToCommand(activeCommand.id, trimmed)).catch(
			() => {
				createNotice(
					'error',
					__('Failed to send response.', 'claudaborative-editing'),
					{ type: 'snackbar' }
				);
			}
		);
	};

	const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	const handleApprove = () => {
		if (activeCommand && !isResponding) {
			void Promise.resolve(
				respondToCommand(activeCommand.id, 'approve')
			).catch(() => {
				createNotice(
					'error',
					__('Failed to approve outline.', 'claudaborative-editing'),
					{ type: 'snackbar' }
				);
			});
		}
	};

	const handleCancel = () => {
		if (activeCommand) {
			cancel(activeCommand.id);
		}
	};

	const commandLabel = getCommandLabel(activeCommand.prompt);

	return (
		<PluginSidebar
			name="conversation"
			title={commandLabel}
			isPinnable={false}
		>
			<div className="wpce-conversation-panel">
				<div className="wpce-conversation-panel__messages">
					{messages.map((msg, index) => (
						<div
							key={index}
							className={`wpce-conversation-panel__message wpce-conversation-panel__message--${msg.role}`}
						>
							<div className="wpce-conversation-panel__message-content">
								<RawHTML>{msg.content}</RawHTML>
							</div>
						</div>
					))}

					{!isAwaitingInput && isRunningWithConversation && (
						<div className="wpce-conversation-panel__processing">
							<SparkleIcon size={16} active processing />
							<span>
								{__(
									'Processing\u2026',
									'claudaborative-editing'
								)}
							</span>
						</div>
					)}

					<div ref={messagesEndRef} />
				</div>

				{isAwaitingInput && (
					<div className="wpce-conversation-panel__input-area">
						{planReady && (
							<Button
								className="wpce-conversation-panel__approve"
								variant="primary"
								onClick={handleApprove}
								disabled={isResponding}
								isBusy={isResponding}
							>
								{__(
									'Approve outline',
									'claudaborative-editing'
								)}
							</Button>
						)}
						<TextareaControl
							ref={textareaRef}
							value={inputValue}
							onChange={setInputValue}
							placeholder={
								inputPrompt ??
								__(
									'Type a response\u2026',
									'claudaborative-editing'
								)
							}
							rows={3}
							onKeyDown={handleKeyDown}
							disabled={isResponding}
							__nextHasNoMarginBottom
						/>
						<div className="wpce-conversation-panel__actions">
							<Button
								variant="primary"
								onClick={handleSend}
								disabled={!inputValue.trim() || isResponding}
								isBusy={isResponding}
							>
								{__('Send', 'claudaborative-editing')}
							</Button>
							<Button
								variant="tertiary"
								isDestructive
								onClick={handleCancel}
								disabled={isResponding}
							>
								{__('Cancel', 'claudaborative-editing')}
							</Button>
						</div>
					</div>
				)}
			</div>
		</PluginSidebar>
	);
}
