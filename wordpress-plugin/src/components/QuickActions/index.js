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
import { MenuGroup, MenuItem } from '@wordpress/components';
import { useSelect, useDispatch } from '@wordpress/data';

/**
 * Internal dependencies
 */
import { useMcpStatus } from '../../hooks/use-mcp-status';
import { STORE_NAME } from '../../store';

import './style.scss';

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

	// Read command state from the store. Polling is handled by
	// ConnectionStatus which is always mounted.
	const activeCommand = useSelect(
		(select) => select(STORE_NAME).getActiveCommand(),
		[]
	);
	const isSubmitting = useSelect(
		(select) => select(STORE_NAME).isSubmitting(),
		[]
	);
	const error = useSelect(
		(select) => select(STORE_NAME).getCommandError(),
		[]
	);
	const { submitCommand } = useDispatch(STORE_NAME);

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

	const handleSubmit = (prompt) => {
		submitCommand(prompt, postId);
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
			</MenuGroup>

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
