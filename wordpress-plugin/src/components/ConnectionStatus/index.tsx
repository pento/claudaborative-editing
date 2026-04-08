/**
 * Connection status component.
 *
 * Renders a sparkle icon in the editor footer bar that indicates
 * MCP connection state. Orange sparkles when connected, grey when
 * disconnected. Click to toggle a popover with detailed status.
 */

/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { Button, Popover } from '@wordpress/components';
import { useSelect, useDispatch } from '@wordpress/data';
import {
	useState,
	useEffect,
	useRef,
	useCallback,
	createPortal,
} from '@wordpress/element';
import { store as coreDataStore } from '@wordpress/core-data';
import { store as noticesStore } from '@wordpress/notices';

/**
 * Internal dependencies
 */
import { useMcpStatus } from '../../hooks/use-mcp-status';
import { useCommands } from '../../hooks/use-commands';
import { getCommandProgressLabel } from '../../utils/command-i18n';
import aiActionsStore from '../../store';
import SparkleIcon from '../SparkleIcon';

import './style.scss';

/**
 * ConnectionStatus component.
 *
 * Portals into the editor footer and renders a sparkle icon.
 * Click to toggle a popover with connection details and cancel control.
 *
 * @return Rendered component or null.
 */
export default function ConnectionStatus() {
	const { mcpConnected } = useMcpStatus();

	const currentPostId = useSelect(
		(select) => select(aiActionsStore).getCurrentPostId(),
		[]
	);

	// Send open-post signal when MCP is connected and we have a post ID.
	// This triggers the MCP server to pre-open the post and verify channels.
	// open-post is a signal command, so submitCommand skips active state.
	const { submitCommand } = useDispatch(aiActionsStore);
	const openPostSentRef = useRef<number | null>(null);
	useEffect(() => {
		if (!mcpConnected || !currentPostId) return;
		if (openPostSentRef.current === currentPostId) return;
		openPostSentRef.current = currentPostId;
		submitCommand('open-post', currentPostId);
	}, [mcpConnected, currentPostId, submitCommand]);

	// Command polling — runs continuously regardless of footer visibility.
	const { activeCommand, history, cancel } = useCommands(currentPostId);

	// Toast notifications on command completion/failure.
	const { createNotice } = useDispatch(noticesStore);
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

			const post = select(coreDataStore).getEntityRecord(
				'postType',
				'post',
				activeCommand.post_id
			) as { title?: { rendered?: string } } | null | undefined;

			return post?.title?.rendered ?? null;
		},
		[isEditingOtherPost, activeCommand?.post_id]
	);

	const [footerEl, setFooterEl] = useState<Element | null>(null);
	const [showPopover, setShowPopover] = useState<boolean>(false);

	useEffect(() => {
		// Check for the footer element immediately, then observe the DOM
		// for it appearing/disappearing (e.g., distraction-free mode,
		// screen resizing).
		const selector = '.interface-interface-skeleton__footer';

		const check = (): void => {
			const el = document.querySelector(selector);
			setFooterEl(el || null);
		};

		check();

		const observer = new window.MutationObserver(check);
		observer.observe(document.body, { childList: true, subtree: true });

		return () => observer.disconnect();
	}, []);

	// Build tooltip content (computed every render, no early return above).
	const statusLines: string[] = [];

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
			if (activeCommand.status === 'awaiting_input') {
				statusLines.push(
					__('Waiting for your input', 'claudaborative-editing')
				);
			} else {
				statusLines.push(getCommandProgressLabel(activeCommand.prompt));
			}
		}
	}

	const isCancellable =
		mcpConnected &&
		activeCommand &&
		(activeCommand.status === 'pending' ||
			activeCommand.status === 'awaiting_input');

	const togglePopover = useCallback(
		() => setShowPopover((prev) => !prev),
		[]
	);
	const closePopover = useCallback(() => setShowPopover(false), []);

	if (!footerEl) {
		return null;
	}

	return createPortal(
		<div className="wpce-footer-status">
			<Button
				className="wpce-footer-status-toggle"
				onClick={togglePopover}
				label={__(
					'Claudaborative Editing status',
					'claudaborative-editing'
				)}
			>
				<SparkleIcon
					active={mcpConnected}
					processing={activeCommand !== null}
				/>
			</Button>
			{showPopover && (
				<Popover
					placement="top-end"
					noArrow={false}
					onClose={closePopover}
					constrainTabbing={false}
					className="wpce-footer-status-popover"
				>
					<div className="wpce-footer-status-tooltip">
						<div className="wpce-footer-status-title">
							{__(
								'Claudaborative Editing',
								'claudaborative-editing'
							)}
						</div>
						{statusLines.map((line, i) => (
							<div key={i} className="wpce-footer-status-line">
								{line}
								{i === statusLines.length - 1 &&
									isCancellable && (
										<>
											{' '}
											<Button
												className="wpce-footer-status-cancel"
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
