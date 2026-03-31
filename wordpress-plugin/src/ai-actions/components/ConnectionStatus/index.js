/**
 * Connection status component.
 *
 * Displays the current MCP server connection status with a colored
 * indicator dot, and shows which post Claude is editing when active
 * on a different post.
 */

/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { PanelRow } from '@wordpress/components';
import { useSelect } from '@wordpress/data';

/**
 * Internal dependencies
 */
import { useMcpStatus } from '../../hooks/use-mcp-status';
import { STORE_NAME } from '../../store';

import './style.scss';

/**
 * ConnectionStatus component.
 *
 * @return {import('react').ReactElement} Rendered component.
 */
export default function ConnectionStatus() {
	const { mcpConnected } = useMcpStatus();

	const activeCommand = useSelect(
		(select) => select(STORE_NAME).getActiveCommand(),
		[]
	);

	const currentPostId = useSelect(
		(select) => select('core/editor').getCurrentPostId(),
		[]
	);

	const isEditingOtherPost =
		activeCommand !== null && activeCommand.post_id !== currentPostId;

	const otherPostTitle = useSelect(
		(select) => {
			if (!isEditingOtherPost) {
				return null;
			}

			const post = select('core').getEntityRecord(
				'postType',
				'post',
				activeCommand.post_id
			);

			return post?.title?.rendered || null;
		},
		[isEditingOtherPost, activeCommand?.post_id]
	);

	const dotClassName = mcpConnected
		? 'wpce-connection-status__dot wpce-connection-status__dot--connected'
		: 'wpce-connection-status__dot wpce-connection-status__dot--disconnected';

	const statusText = mcpConnected
		? __('Claude connected', 'claudaborative-editing')
		: __('Claude not connected', 'claudaborative-editing');

	return (
		<PanelRow>
			<div className="wpce-connection-status">
				<span className={dotClassName} />
				<span className="wpce-connection-status__text">
					{statusText}
				</span>
				{isEditingOtherPost && (
					<span className="wpce-connection-status__text wpce-connection-status__text--editing-other">
						{otherPostTitle
							? sprintf(
									/* translators: %s: Title of the post Claude is editing. */
									__(
										'Claude is editing %s',
										'claudaborative-editing'
									),
									otherPostTitle
								)
							: __(
									'Claude is editing another post',
									'claudaborative-editing'
								)}
					</span>
				)}
			</div>
		</PanelRow>
	);
}
