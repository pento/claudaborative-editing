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

import { initCommandSync } from './sync/command-sync';

// Initialize command sync FIRST — registers root/wpce_commands with core-data.
// This must happen before Gutenberg registers the post room, so that our room
// becomes the "primary" room in the polling manager. The primary room's
// collaborator detection controls queue resumption for ALL rooms.
initCommandSync();

import AiActionsMenu from './components/AiActionsMenu';
import ConnectionStatus from './components/ConnectionStatus';
import NotesIntegration from './components/NotesIntegration';
import PrePublishPanel from './components/PrePublishPanel';
import ConversationPanel from './components/ConversationPanel';

registerPlugin('claudaborative-editing-ai-actions', {
	render: AiActionsMenu,
});

registerPlugin('claudaborative-editing-status', {
	render: ConnectionStatus,
});

registerPlugin('claudaborative-editing-notes', {
	render: NotesIntegration,
});

registerPlugin('claudaborative-editing-pre-publish', {
	render: PrePublishPanel,
});

registerPlugin('claudaborative-editing-conversation', {
	render: ConversationPanel,
});
