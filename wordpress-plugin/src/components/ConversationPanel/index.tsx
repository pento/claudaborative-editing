/**
 * Conversation panel component.
 *
 * Renders a PluginSidebar for two-way communication with the AI assistant
 * during commands that use the awaiting_input status. Shows message history
 * and provides a text input for the user to respond.
 *
 * The sidebar is hidden from the editor's Panels menu via CSS (see style.scss)
 * since it opens automatically based on command state.
 *
 * Closing the sidebar (close button, viewport shrinking below the medium
 * breakpoint, another sidebar taking the slot) only hides the panel — the
 * command stays alive and can be reopened from the AI Actions menu's Resume
 * item. Only the explicit Cancel button cancels the command.
 */

/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { Button, TextareaControl } from '@wordpress/components';
import { useViewportMatch } from '@wordpress/compose';
import { useSelect, useDispatch } from '@wordpress/data';
import { useState, useEffect, useRef, RawHTML } from '@wordpress/element';
import { store as noticesStore } from '@wordpress/notices';
import { PluginSidebar } from '@wordpress/editor';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * Internal dependencies
 */
import { useCommands } from '../../hooks/use-commands';
import { getCommandLabel } from '../../utils/command-i18n';
import aiActionsStore from '../../store';
import SparkleIcon from '../SparkleIcon';
import { useResizableSidebar } from './use-resizable-sidebar';
import {
	SIDEBAR_ID,
	FLOATING_NOTES_SIDEBAR,
	ALL_NOTES_SIDEBAR,
} from './constants';
import {
	CONVERSATIONAL_PROMPTS,
	isConversationVisible,
} from '../../utils/conversation-visibility';
import type {
	ConversationMessage,
	ConversationResultData,
} from '../../store/types';

import './style.scss';

const PROCESSING_WORD_INTERVAL_MS = 2000;

// Declared at module scope so the interval effect's `deps.length` reference
// is stable and doesn't cause restarts across renders.
const PROCESSING_WORDS = [
	__('Reading\u2026', 'claudaborative-editing'),
	__('Thinking\u2026', 'claudaborative-editing'),
	__('Conjugating\u2026', 'claudaborative-editing'),
	__('Pondering\u2026', 'claudaborative-editing'),
	__('Drafting\u2026', 'claudaborative-editing'),
	__('Outlining\u2026', 'claudaborative-editing'),
];

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
	const [processingWordIndex, setProcessingWordIndex] = useState(0);
	const messagesEndRef = useRef<HTMLDivElement>(null);
	const textareaRef = useRef<HTMLTextAreaElement>(null);
	const prevStatusRef = useRef<string | null>(null);

	const isLargeViewport = useViewportMatch('medium');

	// Single subscription to the interface store for our sidebar's active
	// state; the hook below reuses this rather than subscribing separately.
	const isSidebarActive = useSelect((select) => {
		const iface = select('core/interface') as {
			getActiveComplementaryArea: (scope: string) => string | null;
		};
		return iface.getActiveComplementaryArea('core') === SIDEBAR_ID;
	}, []);

	const { containerRef, handle: resizeHandle } =
		useResizableSidebar(isSidebarActive);

	const isPending = activeCommand?.status === 'pending';
	const isRunning = activeCommand?.status === 'running';
	const isAwaitingInput = activeCommand?.status === 'awaiting_input';
	const isInFlight = isPending || isRunning;
	const isConversationalCommand = !!(
		activeCommand && CONVERSATIONAL_PROMPTS.includes(activeCommand.prompt)
	);
	const shouldShow = isConversationVisible(activeCommand);
	const shouldShowProcessing = shouldShow && isInFlight && !isAwaitingInput;

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

	const { enableComplementaryArea, disableComplementaryArea } = useDispatch(
		'core/interface'
	) as {
		enableComplementaryArea: (scope: string, id: string) => void;
		disableComplementaryArea: (scope: string) => void;
	};

	useEffect(() => {
		const currentStatus = activeCommand?.status ?? null;
		const prevStatus = prevStatusRef.current;

		const enteredAwaitingInput =
			currentStatus === 'awaiting_input' &&
			prevStatus !== 'awaiting_input';
		// Fire once when a conversational command first enters an in-flight
		// status; don't re-fire on pending → running or awaiting_input →
		// running. The latter matters because handleApprove switches the
		// sidebar to the notes panel on approve, and an awaiting_input →
		// running transition arriving on the /respond round-trip would
		// otherwise re-open the conversation panel and undo the switch.
		const inFlightStatuses: readonly (string | null)[] = [
			'pending',
			'running',
		];
		const alreadyInFlightStatuses: readonly (string | null)[] = [
			...inFlightStatuses,
			'awaiting_input',
		];
		const startedConversationalCommand =
			isConversationalCommand &&
			inFlightStatuses.includes(currentStatus) &&
			!alreadyInFlightStatuses.includes(prevStatus);

		if (enteredAwaitingInput || startedConversationalCommand) {
			enableComplementaryArea?.('core', SIDEBAR_ID);
		}
		prevStatusRef.current = currentStatus;
	}, [
		activeCommand?.status,
		isConversationalCommand,
		enableComplementaryArea,
	]);

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

	useEffect(() => {
		if (!shouldShowProcessing) {
			setProcessingWordIndex(0);
			return;
		}
		const interval = setInterval(() => {
			setProcessingWordIndex(
				(index) => (index + 1) % PROCESSING_WORDS.length
			);
		}, PROCESSING_WORD_INTERVAL_MS);
		return () => clearInterval(interval);
	}, [shouldShowProcessing]);

	// isConversationVisible() implies a non-null command; the extra check
	// narrows the type for the JSX below.
	if (!shouldShow || !activeCommand) {
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

	const handleKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	};

	const handleApprove = () => {
		if (activeCommand && !isResponding) {
			const approvedCommandId = activeCommand.id;
			void Promise.resolve(
				respondToCommand(approvedCommandId, 'approve')
			).then(
				() => {
					enableComplementaryArea?.(
						'core',
						isLargeViewport
							? FLOATING_NOTES_SIDEBAR
							: ALL_NOTES_SIDEBAR
					);
				},
				() => {
					createNotice(
						'error',
						__(
							'Failed to approve outline.',
							'claudaborative-editing'
						),
						{ type: 'snackbar' }
					);
				}
			);
		}
	};

	const handleCancel = () => {
		if (activeCommand) {
			cancel(activeCommand.id);
		}
		// Closing via the store plays the slide-out animation.
		disableComplementaryArea?.('core');
	};

	const commandLabel = getCommandLabel(activeCommand.prompt);

	return (
		<PluginSidebar
			name="conversation"
			title={commandLabel}
			isPinnable={false}
			// @ts-expect-error `closeLabel` is supported by the underlying
			// ComplementaryArea at runtime but not declared on PluginSidebar's
			// upstream type. Remove this suppression once @wordpress/editor
			// publishes the prop.
			closeLabel={__(
				'Close conversation panel',
				'claudaborative-editing'
			)}
		>
			<div className="wpce-conversation-panel" ref={containerRef}>
				{resizeHandle}
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

					{shouldShowProcessing && (
						<div className="wpce-conversation-panel__processing">
							<SparkleIcon size={16} active processing />
							<span>{PROCESSING_WORDS[processingWordIndex]}</span>
						</div>
					)}

					<div ref={messagesEndRef} />
				</div>

				{isPending && (
					<div className="wpce-conversation-panel__input-area">
						<div className="wpce-conversation-panel__actions">
							<Button
								variant="tertiary"
								isDestructive
								onClick={handleCancel}
							>
								{__('Cancel', 'claudaborative-editing')}
							</Button>
						</div>
					</div>
				)}

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
