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
import { store as noticesStore } from '@wordpress/notices';
import { PinnedItems } from '@wordpress/interface';

/**
 * Internal dependencies
 */
import { useMcpStatus } from '../../hooks/use-mcp-status';
import {
	getCommandLabel,
	getCommandDescription,
} from '../../utils/command-i18n';
import type { CommandSlug } from '#shared/commands';
import SparkleIcon from '../SparkleIcon';
import aiActionsStore from '../../store';

import './style.scss';

/**
 * AiActionsMenu component.
 *
 * Renders a dropdown button in the editor toolbar's pinned items area
 * with Proofread and Review menu items.
 *
 * @return Rendered dropdown.
 */
export default function AiActionsMenu() {
	const { mcpConnected } = useMcpStatus();

	const { postId, activeCommand, isSubmitting, error, isEditingOtherPost } =
		useSelect((select) => {
			const s = select(aiActionsStore);
			const currentPostId = s.getCurrentPostId();
			const active = s.getActiveCommand();
			return {
				postId: currentPostId,
				activeCommand: active,
				isSubmitting: s.isSubmitting(),
				error: s.getCommandError(),
				isEditingOtherPost:
					active !== null && active.post_id !== currentPostId,
			};
		}, []);

	const { submitCommand } = useDispatch(aiActionsStore);
	const { createNotice } = useDispatch(noticesStore);

	// Show submission errors as toasts.
	const prevErrorRef = useRef<string | null>(error);
	useEffect(() => {
		if (error && error !== prevErrorRef.current) {
			createNotice('error', error, { type: 'snackbar' });
		}
		prevErrorRef.current = error;
	}, [error, createNotice]);

	const itemsDisabled =
		!mcpConnected ||
		postId === null ||
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
				{({ onClose }: { onClose: () => void }) => {
					const handleSubmit = (prompt: CommandSlug): void => {
						if (postId !== null) {
							submitCommand(prompt, postId);
						}
						onClose();
					};

					return (
						<MenuGroup className="claudaborative-editing-ai-actions-menu">
							<MenuItem
								info={getCommandDescription('proofread')}
								disabled={itemsDisabled}
								onClick={() => handleSubmit('proofread')}
							>
								{getCommandLabel('proofread')}
							</MenuItem>
							<MenuItem
								info={getCommandDescription('review')}
								disabled={itemsDisabled}
								onClick={() => handleSubmit('review')}
							>
								{getCommandLabel('review')}
							</MenuItem>
						</MenuGroup>
					);
				}}
			</DropdownMenu>
		</PinnedItems>
	);
}
