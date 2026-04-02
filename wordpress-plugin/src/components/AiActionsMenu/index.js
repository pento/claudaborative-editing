/**
 * AI Actions dropdown menu.
 *
 * Registers a toolbar dropdown in the Gutenberg editor header containing
 * quick action buttons for AI-assisted editing. Submission errors are
 * shown as snackbar toasts rather than inline in the menu.
 */

/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { DropdownMenu, MenuGroup, MenuItem } from '@wordpress/components';
import { useSelect, useDispatch } from '@wordpress/data';
import { useEffect, useRef } from '@wordpress/element';
import { PinnedItems } from '@wordpress/interface';

/**
 * Internal dependencies
 */
import { useMcpStatus } from '../../hooks/use-mcp-status';
import SparkleIcon from '../SparkleIcon';
import { STORE_NAME } from '../../store';

/**
 * AiActionsMenu component.
 *
 * Renders a dropdown button in the editor toolbar's pinned items area
 * with Proofread and Review menu items.
 *
 * @return {import('react').ReactElement} Rendered dropdown.
 */
export default function AiActionsMenu() {
	const { mcpConnected } = useMcpStatus();

	const postId = useSelect(
		(select) => select('core/editor').getCurrentPostId(),
		[]
	);

	const { activeCommand, isSubmitting, error, isEditingOtherPost } =
		useSelect(
			(select) => {
				const store = select(STORE_NAME);
				const active = store.getActiveCommand();
				return {
					activeCommand: active,
					isSubmitting: store.isSubmitting(),
					error: store.getCommandError(),
					isEditingOtherPost:
						active !== null && active.post_id !== postId,
				};
			},
			[postId]
		);

	const { submitCommand } = useDispatch(STORE_NAME);
	const { createNotice } = useDispatch('core/notices');

	// Show submission errors as toasts.
	const prevErrorRef = useRef(error);
	useEffect(() => {
		if (error && error !== prevErrorRef.current) {
			createNotice('error', error, { type: 'snackbar' });
		}
		prevErrorRef.current = error;
	}, [error, createNotice]);

	const itemsDisabled =
		!mcpConnected ||
		!postId ||
		isSubmitting ||
		activeCommand !== null ||
		isEditingOtherPost;

	return (
		<PinnedItems scope="core">
			<DropdownMenu
				icon={
					<SparkleIcon
						size={24}
						processing={activeCommand !== null}
					/>
				}
				label={__('Claudaborative Editing', 'claudaborative-editing')}
				popoverProps={{ placement: 'bottom-end' }}
			>
				{({ onClose }) => {
					const handleSubmit = (prompt) => {
						submitCommand(prompt, postId);
						onClose();
					};

					return (
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
									'Leave editorial notes on the post',
									'claudaborative-editing'
								)}
								disabled={itemsDisabled}
								onClick={() => handleSubmit('review')}
							>
								{__('Review', 'claudaborative-editing')}
							</MenuItem>
						</MenuGroup>
					);
				}}
			</DropdownMenu>
		</PinnedItems>
	);
}
