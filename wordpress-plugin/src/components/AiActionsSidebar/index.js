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
 * Renders a star/sparkle SVG shape.
 *
 * @return {import('react').ReactElement} SVG icon element.
 */
const AiActionsIcon = () => (
	<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
		<path d="M12 2L14.09 8.26L20 9.27L15.55 13.97L16.91 20L12 16.9L7.09 20L8.45 13.97L4 9.27L9.91 8.26L12 2Z" />
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
