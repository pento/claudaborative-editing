/**
 * Custom hook for MCP connection status.
 *
 * Detects MCP connection via Yjs awareness in the command sync room.
 * The MCP server sends awareness with browserType 'Claudaborative Editing MCP'.
 */

/**
 * WordPress dependencies
 */
import { useState, useEffect } from '@wordpress/element';

/**
 * Internal dependencies
 */
import { isMcpConnected, subscribeToMcpConnection } from '../sync/command-sync';

/**
 * Return type for the useMcpStatus hook.
 */
export interface McpStatus {
	mcpConnected: boolean;
}

/**
 * Hook that provides MCP connection status via Yjs awareness.
 *
 * Subscribes to awareness changes in the per-user command room.
 * The MCP server's presence is detected by its browserType field.
 *
 * @return Status object with `mcpConnected`.
 */
export function useMcpStatus(): McpStatus {
	const [mcpConnected, setMcpConnected] = useState(() => isMcpConnected());

	useEffect(() => {
		return subscribeToMcpConnection(setMcpConnected);
	}, []);

	return { mcpConnected };
}
