/**
 * AI Actions editor plugin.
 *
 * Registers a Gutenberg sidebar panel with quick action buttons for
 * AI-assisted editing, and a footer status indicator showing MCP
 * connection state.
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

import AiActionsMenu from './components/AiActionsSidebar';
import ConnectionStatus from './components/ConnectionStatus';
import NotesIntegration from './components/NotesIntegration';

registerPlugin('claudaborative-editing-ai-actions', {
	render: AiActionsMenu,
});

registerPlugin('claudaborative-editing-status', {
	render: ConnectionStatus,
});

registerPlugin('claudaborative-editing-notes', {
	render: NotesIntegration,
});
