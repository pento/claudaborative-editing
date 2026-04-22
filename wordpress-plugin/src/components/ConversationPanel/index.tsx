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
import { TERMINAL_STATUSES, type CommandSlug } from '#shared/commands';
import type {
	ConversationMessage,
	ConversationResultData,
} from '../../store/types';

import './style.scss';

// Command prompts that open the conversation sidebar on submit (before the
// MCP server has produced any messages).
const CONVERSATIONAL_PROMPTS: readonly CommandSlug[] = ['compose'];

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
	// Holds the id of the command whose approval triggered a sidebar
	// switch, so the cancel-on-close watcher below can skip cancelling
	// that specific command. Scoping by id (rather than a boolean)
	// ensures a stale signal can't leak into a future command's close
	// event — if the approved command transitions to terminal before
	// the watcher fires, the id simply won't match any subsequent
	// active command.
	const postApproveSwitchCommandIdRef = useRef<number | null>(null);

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
	const isRunningWithConversation =
		isRunning &&
		activeCommand.result_data &&
		Array.isArray(activeCommand.result_data.messages);

	// Conversational commands open the sidebar the moment they're pending,
	// so the user sees the processing indicator instead of staring at
	// nothing while the MCP server spins up.
	const shouldShow =
		isAwaitingInput ||
		isRunningWithConversation ||
		(isInFlight && isConversationalCommand);
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

	// Close actions (built-in close button, Cancel button, switching to
	// another sidebar) all route through `disableComplementaryArea`, which
	// flips `isSidebarActive` false. When that happens while a non-terminal
	// command is loaded, cancel it — one watcher for every close path.
	const isCommandActive = !!(
		activeCommand &&
		!TERMINAL_STATUSES.includes(
			activeCommand.status as (typeof TERMINAL_STATUSES)[number]
		)
	);
	const prevSidebarActiveRef = useRef(isSidebarActive);
	useEffect(() => {
		const wasActive = prevSidebarActiveRef.current;
		prevSidebarActiveRef.current = isSidebarActive;
		if (wasActive && !isSidebarActive && activeCommand && isCommandActive) {
			// Approve intentionally switches away to the notes sidebar while
			// the command is still running the scaffold — don't treat that
			// as a user-initiated close and cancel the command. Match by
			// id so an unconsumed signal from a prior approve can't cause
			// an unrelated command's close to silently skip cancel.
			if (postApproveSwitchCommandIdRef.current === activeCommand.id) {
				postApproveSwitchCommandIdRef.current = null;
				return;
			}
			cancel(activeCommand.id);
		}
	}, [isSidebarActive, activeCommand, isCommandActive, cancel]);

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
					postApproveSwitchCommandIdRef.current = approvedCommandId;
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
		// Closing via the store plays the slide-out animation; the watcher
		// above cancels the actual command as the sidebar goes inactive.
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
