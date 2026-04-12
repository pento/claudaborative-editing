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

import { connectToCloud } from './cloud/connect';
import { initCommandSync } from './sync/command-sync';

// Defer command sync initialization so the post room registers first and
// becomes the polling manager's "primary" room. The primary room controls
// connection limits (DEFAULT_CLIENT_LIMIT_PER_ROOM = 3) and collaborator
// detection. The per-user command room should not be primary because the
// post room is the natural primary for editor collaboration.
setTimeout(() => void initCommandSync(), 0);

// Notify the cloud service (if configured) so it creates a SessionManager
// that will connect back to this site via Yjs sync.
connectToCloud();

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
