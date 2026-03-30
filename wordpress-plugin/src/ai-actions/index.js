/**
 * AI Actions editor plugin.
 *
 * Registers a Gutenberg sidebar panel with MCP connection status
 * and quick action buttons for AI-assisted editing.
 */

/**
 * WordPress dependencies
 */
import { registerPlugin } from '@wordpress/plugins';

/**
 * Internal dependencies
 */

// Register the data store (side-effect import).
import './store';

import './editor.css';

import AiActionsSidebar from './components/AiActionsSidebar';

registerPlugin('claudaborative-editing-ai-actions', {
	render: AiActionsSidebar,
});
