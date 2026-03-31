/**
 * AI Actions sidebar component.
 *
 * Registers a PluginSidebar panel in the Gutenberg editor containing
 * the MCP connection status and quick action buttons.
 */

/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { PluginSidebar } from '@wordpress/editor';
import { PanelBody } from '@wordpress/components';

/**
 * Internal dependencies
 */
import ConnectionStatus from '../ConnectionStatus';
import QuickActions from '../QuickActions';

/**
 * Custom icon for the AI Actions sidebar.
 *
 * Document page with a magic wand overlay. The wand tip and sparkle
 * use Claude's brand colour.
 *
 * @return {import('react').ReactElement} SVG icon element.
 */
const AiActionsIcon = () => (
	<svg
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
			d="M14 4l1.5 4.5 4.5 1.5-4.5 1.5-1.5 4.5-1.5-4.5-4.5-1.5 4.5-1.5z"
			fill="#D97706"
		/>
		{/* Small sparkle top-right */}
		<path
			d="M20 4l.5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z"
			fill="#D97706"
		/>
		{/* Small sparkle right */}
		<path
			d="M19.5 11l.4 1.1 1.1.4-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4z"
			fill="#D97706"
		/>
	</svg>
);

/**
 * AiActionsSidebar component.
 *
 * @return {import('react').ReactElement} Rendered sidebar.
 */
export default function AiActionsSidebar() {
	return (
		<PluginSidebar
			name="claudaborative-editing-ai-actions"
			title={__('AI Actions', 'claudaborative-editing')}
			icon={<AiActionsIcon />}
		>
			<PanelBody>
				<ConnectionStatus />
			</PanelBody>
			<QuickActions />
		</PluginSidebar>
	);
}
