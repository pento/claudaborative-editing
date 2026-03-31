/**
 * Connection status component.
 *
 * Renders a sparkle icon in the editor footer bar that indicates
 * MCP connection state. Orange sparkles when connected, grey when
 * disconnected. Hover tooltip shows detailed status information.
 */

/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { Button, Popover } from '@wordpress/components';
import { useSelect, useDispatch } from '@wordpress/data';
import { useState, useEffect, useRef, createPortal } from '@wordpress/element';

/**
 * Internal dependencies
 */
import { useMcpStatus } from '../../hooks/use-mcp-status';
import { useCommands } from '../../hooks/use-commands';
import SparkleIcon from '../SparkleIcon';

import './style.scss';

/**
 * ConnectionStatus component.
 *
 * Portals into the editor footer and renders a sparkle icon with a
 * hover popover showing connection details.
 *
 * @return {import('react').ReactElement|null} Rendered component or null.
 */
export default function ConnectionStatus() {
	const { mcpConnected } = useMcpStatus();

	const currentPostId = useSelect(
		(select) => select('core/editor').getCurrentPostId(),
		[]
	);

	// Command polling — runs continuously regardless of footer visibility.
	const { activeCommand, history, cancel } = useCommands(currentPostId);

	// Toast notifications on command completion/failure.
	const { createNotice } = useDispatch('core/notices');
	const prevActiveRef = useRef(activeCommand);

	useEffect(() => {
		const wasActive = prevActiveRef.current;
		prevActiveRef.current = activeCommand;

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

	const [footerEl, setFooterEl] = useState(null);
	const [showPopover, setShowPopover] = useState(false);

	useEffect(() => {
		// Check for the footer element immediately, then observe the DOM
		// for it appearing/disappearing (e.g., distraction-free mode,
		// screen resizing).
		const selector = '.interface-interface-skeleton__footer';

		const check = () => {
			const el = document.querySelector(selector);
			setFooterEl(el || null);
		};

		check();

		const observer = new window.MutationObserver(check);
		observer.observe(document.body, { childList: true, subtree: true });

		return () => observer.disconnect();
	}, []);

	// Build tooltip content (computed every render, no early return above).
	const statusLines = [];

	statusLines.push(
		mcpConnected
			? __('Status: connected', 'claudaborative-editing')
			: __('Status: disconnected', 'claudaborative-editing')
	);

	if (mcpConnected) {
		if (isEditingOtherPost) {
			statusLines.push(
				otherPostTitle
					? sprintf(
							/* translators: %s: Title of the post Claude is editing. */
							__('Editing: %s', 'claudaborative-editing'),
							otherPostTitle
						)
					: __('Editing another post', 'claudaborative-editing')
			);
		}

		if (activeCommand) {
			switch (activeCommand.prompt) {
				case 'proofread':
					statusLines.push(
						__('Proofreading…', 'claudaborative-editing')
					);
					break;
				case 'review':
					statusLines.push(
						__('Reviewing…', 'claudaborative-editing')
					);
					break;
				case 'respond-to-notes':
					statusLines.push(
						__('Responding to notes…', 'claudaborative-editing')
					);
					break;
				default:
					statusLines.push(__('Working…', 'claudaborative-editing'));
			}
		}
	}

	const isCancellable =
		activeCommand &&
		(activeCommand.status === 'pending' ||
			activeCommand.status === 'claimed');

	if (!footerEl) {
		return null;
	}

	return createPortal(
		<div
			className="wpce-footer-status"
			onMouseEnter={() => setShowPopover(true)}
			onMouseLeave={() => setShowPopover(false)}
		>
			<SparkleIcon
				active={mcpConnected}
				processing={activeCommand !== null}
			/>
			{showPopover && (
				<Popover
					placement="top-end"
					noArrow={false}
					focusOnMount={false}
					className="wpce-footer-status__popover"
				>
					<div className="wpce-footer-status__tooltip">
						<div className="wpce-footer-status__title">
							{__(
								'Claudaborative Editing',
								'claudaborative-editing'
							)}
						</div>
						{statusLines.map((line, i) => (
							<div key={i} className="wpce-footer-status__line">
								{line}
								{i === statusLines.length - 1 &&
									isCancellable && (
										<>
											{' '}
											<Button
												className="wpce-footer-status__cancel"
												variant="link"
												isDestructive
												onClick={() =>
													cancel(activeCommand.id)
												}
											>
												{__(
													'(cancel)',
													'claudaborative-editing'
												)}
											</Button>
										</>
									)}
							</div>
						))}
					</div>
				</Popover>
			)}
		</div>,
		footerEl
	);
}
