/**
 * AI Actions dropdown menu.
 *
 * Registers a toolbar dropdown in the Gutenberg editor header containing
 * quick action buttons for AI-assisted editing.
 */

/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { DropdownMenu } from '@wordpress/components';
import { useSelect } from '@wordpress/data';
import { PinnedItems } from '@wordpress/interface';

/**
 * Internal dependencies
 */
import QuickActions from '../QuickActions';
import { STORE_NAME } from '../../store';

/**
 * Custom icon for the AI Actions menu.
 *
 * Document page with a magic wand overlay. The wand tip and sparkle
 * use Claude's brand colour.
 *
 * @param {Object}  props            Component props.
 * @param {boolean} props.processing Whether to animate sparkles.
 * @return {import('react').ReactElement} SVG icon element.
 */
const AiActionsIcon = ({ processing }) => {
	const cls = processing
		? 'wpce-sparkles wpce-sparkles--processing'
		: 'wpce-sparkles';

	return (
		<svg
			className={cls}
			height="24"
			width="24"
			viewBox="0 0 24 24"
			xmlns="http://www.w3.org/2000/svg"
		>
			{/* Document page - white fill with dark outline, 16px tall (4–20), ~9px wide */}
			<path
				d="M16 4H11C10.45 4 10 4.45 10 5v14c0 .55.45 1 1 1h8c.55 0 1-.45 1-1V9l-4-5z"
				fill="white"
				stroke="currentColor"
				strokeWidth="1.2"
			/>
			{/* Document fold */}
			<path
				d="M16 4v4.5c0 .28.22.5.5.5H20"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.2"
			/>
			{/* Text lines */}
			<path
				d="M12 13h5M12 16h4"
				stroke="currentColor"
				strokeWidth="1.2"
				strokeLinecap="round"
				fill="none"
			/>
			{/* Wand - black body, white tip at top */}
			<line
				x1="3"
				y1="20"
				x2="12"
				y2="11"
				stroke="currentColor"
				strokeWidth="2.5"
				strokeLinecap="round"
			/>
			<line
				x1="11"
				y1="12"
				x2="12"
				y2="11"
				stroke="white"
				strokeWidth="1.8"
				strokeLinecap="round"
			/>
			{/* Main sparkle at wand tip */}
			<path
				className="wpce-sparkles__main"
				d="M14 4l1.5 4.5 4.5 1.5-4.5 1.5-1.5 4.5-1.5-4.5-4.5-1.5 4.5-1.5z"
				fill="#D97706"
			/>
			{/* Small sparkle top-right */}
			<path
				className="wpce-sparkles__small wpce-sparkles__small--1"
				d="M20 4l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z"
				fill="#D97706"
			/>
			{/* Small sparkle right */}
			<path
				className="wpce-sparkles__small wpce-sparkles__small--2"
				d="M19.5 11l.4 1.1 1.1.4-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4z"
				fill="#D97706"
			/>
		</svg>
	);
};

/**
 * AiActionsMenu component.
 *
 * Renders a dropdown button in the editor toolbar's pinned items area.
 *
 * @return {import('react').ReactElement} Rendered dropdown.
 */
export default function AiActionsMenu() {
	const hasActiveCommand = useSelect(
		(select) => select(STORE_NAME).getActiveCommand() !== null,
		[]
	);

	return (
		<PinnedItems scope="core">
			<DropdownMenu
				icon={<AiActionsIcon processing={hasActiveCommand} />}
				label={__('Claudaborative Editing', 'claudaborative-editing')}
				popoverProps={{ placement: 'bottom-end' }}
			>
				{({ onClose }) => <QuickActions onClose={onClose} />}
			</DropdownMenu>
		</PinnedItems>
	);
}
