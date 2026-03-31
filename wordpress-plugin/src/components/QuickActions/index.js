/**
 * Quick actions component.
 *
 * Provides menu items for common AI operations (proofread, review,
 * respond to notes) and displays the status of the currently active command.
 */

/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { MenuGroup, MenuItem, Spinner } from '@wordpress/components';
import { useSelect, useDispatch } from '@wordpress/data';
import { useEffect, useRef } from '@wordpress/element';

/**
 * Internal dependencies
 */
import { useMcpStatus } from '../../hooks/use-mcp-status';
import { useCommands } from '../../hooks/use-commands';
import { STORE_NAME } from '../../store';

import './style.scss';

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
 * @param {Object}   props         Component props.
 * @param {Function} props.onClose Callback to close the parent dropdown.
 * @return {import('react').ReactElement} Rendered component.
 */
export default function QuickActions({ onClose }) {
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
				status: 'all',
				per_page: 1,
			});
			return Array.isArray(notes) && notes.length > 0;
		},
		[postId]
	);

	// Notes can be added by collaborators via Yjs, but getEntityRecords
	// caches the result. Periodically invalidate to re-fetch.
	const { invalidateResolution } = useDispatch('core');
	useEffect(() => {
		const id = window.setInterval(() => {
			invalidateResolution('getEntityRecords', [
				'root',
				'comment',
				{ post: postId, type: 'note', status: 'all', per_page: 1 },
			]);
		}, 10000);
		return () => window.clearInterval(id);
	}, [postId, invalidateResolution]);

	const isEditingOtherPost = useSelect(
		(select) => {
			const active = select(STORE_NAME).getActiveCommand();
			return active !== null && active.post_id !== postId;
		},
		[postId]
	);

	const itemsDisabled =
		!mcpConnected ||
		isSubmitting ||
		activeCommand !== null ||
		isEditingOtherPost;

	const prevActiveRef = useRef(activeCommand);
	const { createNotice } = useDispatch('core/notices');

	useEffect(() => {
		const wasActive = prevActiveRef.current;
		prevActiveRef.current = activeCommand;

		// When activeCommand transitions from non-null to null, check history
		// for the completed/failed entry and show a snackbar toast.
		if (wasActive && activeCommand === null && history.length > 0) {
			const latest = history[0];

			if (latest.status === 'completed') {
				createNotice(
					'success',
					latest.message || __('Done!', 'claudaborative-editing'),
					{ type: 'snackbar' }
				);
			} else if (latest.status === 'failed') {
				createNotice(
					'error',
					latest.message ||
						__('Command failed.', 'claudaborative-editing'),
					{ type: 'snackbar' }
				);
			}
		}
	}, [activeCommand, history, createNotice]);

	const isCancellable =
		activeCommand &&
		(activeCommand.status === 'pending' ||
			activeCommand.status === 'claimed');

	const handleSubmit = (prompt) => {
		submit(prompt);
		if (onClose) {
			onClose();
		}
	};

	return (
		<div className="wpce-quick-actions-menu">
			<MenuGroup>
				<MenuItem
					info={__(
						'Fix grammar, spelling, and punctuation',
						'claudaborative-editing'
					)}
					disabled={itemsDisabled}
					onClick={() => handleSubmit('proofread')}
				>
					{__('Proofread', 'claudaborative-editing')}
				</MenuItem>
				<MenuItem
					info={__(
						'Leave editorial notes the post',
						'claudaborative-editing'
					)}
					disabled={itemsDisabled}
					onClick={() => handleSubmit('review')}
				>
					{__('Review', 'claudaborative-editing')}
				</MenuItem>
				{hasNotes && (
					<MenuItem
						info={__(
							'Address existing notes with edits and replies',
							'claudaborative-editing'
						)}
						disabled={itemsDisabled}
						onClick={() => handleSubmit('respond-to-notes')}
					>
						{__('Respond to Notes', 'claudaborative-editing')}
					</MenuItem>
				)}
			</MenuGroup>

			{activeCommand && (
				<MenuGroup>
					<div className="wpce-command-status">
						<Spinner />
						<span>{getStatusLabel(activeCommand.prompt)}</span>
						{isCancellable && (
							<MenuItem
								variant="tertiary"
								onClick={() => cancel(activeCommand.id)}
							>
								{__('Cancel', 'claudaborative-editing')}
							</MenuItem>
						)}
					</div>
				</MenuGroup>
			)}

			{error && (
				<MenuGroup>
					<div className="wpce-command-notice wpce-command-notice--error">
						{error}
					</div>
				</MenuGroup>
			)}
		</div>
	);
}
