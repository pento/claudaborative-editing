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
import { Popover } from '@wordpress/components';
import { useSelect } from '@wordpress/data';
import { useState, useEffect, createPortal } from '@wordpress/element';

/**
 * Internal dependencies
 */
import { useMcpStatus } from '../../hooks/use-mcp-status';
import { STORE_NAME } from '../../store';

import './style.scss';

/**
 * Sparkle icon — 3 sparkles matching the sidebar icon.
 *
 * @param {Object}  props        Component props.
 * @param {boolean} props.active Whether to show active (orange) or inactive (grey) colour.
 * @return {import('react').ReactElement} SVG element.
 */
function SparkleIcon({ active }) {
	const fill = active ? '#D97706' : '#949494';

	return (
		<svg
			width="20"
			height="20"
			viewBox="6 2 18 16"
			xmlns="http://www.w3.org/2000/svg"
		>
			<path
				d="M14 4l1.5 4.5 4.5 1.5-4.5 1.5-1.5 4.5-1.5-4.5-4.5-1.5 4.5-1.5z"
				fill={fill}
			/>
			<path
				d="M20 4l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z"
				fill={fill}
			/>
			<path
				d="M19.5 11l.4 1.1 1.1.4-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4z"
				fill={fill}
			/>
		</svg>
	);
}

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

	const [footerEl, setFooterEl] = useState(null);
	const [showPopover, setShowPopover] = useState(false);

	useEffect(() => {
		const footer = document.querySelector(
			'.interface-interface-skeleton__footer'
		);
		if (footer) {
			setFooterEl(footer);
		}
	}, []);

	if (!footerEl) {
		return null;
	}

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
			statusLines.push(
				sprintf(
					/* translators: %s: Command status string. */
					__('Command: %s', 'claudaborative-editing'),
					activeCommand.status
				)
			);
		}
	}

	return createPortal(
		<div
			className="wpce-footer-status"
			onMouseEnter={() => setShowPopover(true)}
			onMouseLeave={() => setShowPopover(false)}
		>
			<SparkleIcon active={mcpConnected} />
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
							</div>
						))}
					</div>
				</Popover>
			)}
		</div>,
		footerEl
	);
}
