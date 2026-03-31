/**
 * Quick actions component.
 *
 * Provides action buttons for common AI operations (proofread, review,
 * respond to notes) and displays the status of the currently active command.
 */

/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { Button, PanelBody, Spinner, Notice } from '@wordpress/components';
import { useSelect } from '@wordpress/data';
import { useState, useEffect, useCallback, useRef } from '@wordpress/element';

/**
 * Internal dependencies
 */
import { useMcpStatus } from '../hooks/use-mcp-status';
import { useCommands } from '../hooks/use-commands';
import { STORE_NAME } from '../store';

/**
 * Maps a command prompt identifier to a human-readable status label.
 *
 * @param {string} prompt The prompt identifier.
 * @return {string} Status label for the active command.
 */
function getStatusLabel(prompt) {
	switch (prompt) {
		case 'proofread':
			return __('Proofreading…', 'claudaborative-editing');
		case 'review':
			return __('Reviewing…', 'claudaborative-editing');
		case 'respond-to-notes':
			return __('Responding to notes…', 'claudaborative-editing');
		default:
			return __('Working…', 'claudaborative-editing');
	}
}

/**
 * QuickActions component.
 *
 * @return {import('react').ReactElement} Rendered component.
 */
export default function QuickActions() {
	const { mcpConnected } = useMcpStatus();

	const postId = useSelect(
		(select) => select('core/editor').getCurrentPostId(),
		[]
	);

	const { activeCommand, isSubmitting, error, history, submit, cancel } =
		useCommands(postId);

	const hasNotes = useSelect(
		(select) => {
			const notes = select('core').getEntityRecords('root', 'comment', {
				post: postId,
				type: 'note',
				per_page: 1,
			});
			return Array.isArray(notes) && notes.length > 0;
		},
		[postId]
	);

	const isEditingOtherPost = useSelect(
		(select) => {
			const active = select(STORE_NAME).getActiveCommand();
			return active !== null && active.post_id !== postId;
		},
		[postId]
	);

	const buttonsDisabled =
		!mcpConnected ||
		isSubmitting ||
		activeCommand !== null ||
		isEditingOtherPost;

	const [completedMessage, setCompletedMessage] = useState(null);
	const prevActiveRef = useRef(activeCommand);
	const dismissTimerRef = useRef(null);

	const clearMessage = useCallback(() => {
		setCompletedMessage(null);
		if (dismissTimerRef.current) {
			window.clearTimeout(dismissTimerRef.current);
			dismissTimerRef.current = null;
		}
	}, []);

	useEffect(() => {
		const wasActive = prevActiveRef.current;
		prevActiveRef.current = activeCommand;

		// When activeCommand transitions from non-null to null, check history
		// for the completed/failed entry.
		if (wasActive && activeCommand === null && history.length > 0) {
			const latest = history[0];

			if (latest.status === 'completed' || latest.status === 'failed') {
				setCompletedMessage({
					status: latest.status === 'completed' ? 'success' : 'error',
					text:
						latest.message ||
						(latest.status === 'completed'
							? __('Done!', 'claudaborative-editing')
							: __('Command failed.', 'claudaborative-editing')),
				});

				dismissTimerRef.current = window.setTimeout(clearMessage, 5000);
			}
		}

		return () => {
			if (dismissTimerRef.current) {
				window.clearTimeout(dismissTimerRef.current);
			}
		};
	}, [activeCommand, history, clearMessage]);

	const isCancellable =
		activeCommand &&
		(activeCommand.status === 'pending' ||
			activeCommand.status === 'claimed');

	return (
		<PanelBody
			title={__('Quick Actions', 'claudaborative-editing')}
			initialOpen
		>
			<div className="wpce-quick-actions">
				<Button
					variant="secondary"
					disabled={buttonsDisabled}
					onClick={() => submit('proofread')}
				>
					{__('Proofread', 'claudaborative-editing')}
				</Button>
				<Button
					variant="secondary"
					disabled={buttonsDisabled}
					onClick={() => submit('review')}
				>
					{__('Review', 'claudaborative-editing')}
				</Button>
				{hasNotes && (
					<Button
						variant="secondary"
						disabled={buttonsDisabled}
						onClick={() => submit('respond-to-notes')}
					>
						{__('Respond to Notes', 'claudaborative-editing')}
					</Button>
				)}
			</div>

			{activeCommand && (
				<div className="wpce-command-status">
					<Spinner />
					<span>{getStatusLabel(activeCommand.prompt)}</span>
					{isCancellable && (
						<Button
							variant="link"
							onClick={() => cancel(activeCommand.id)}
						>
							{__('Cancel', 'claudaborative-editing')}
						</Button>
					)}
				</div>
			)}

			{error && (
				<div className="wpce-command-notice">
					<Notice status="error" isDismissible={false}>
						{error}
					</Notice>
				</div>
			)}

			{completedMessage && (
				<div className="wpce-command-notice">
					<Notice
						status={completedMessage.status}
						isDismissible
						onDismiss={clearMessage}
					>
						{completedMessage.text}
					</Notice>
				</div>
			)}
		</PanelBody>
	);
}
