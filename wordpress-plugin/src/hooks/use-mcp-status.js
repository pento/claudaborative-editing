/**
 * Custom hook for MCP connection status.
 *
 * Provides reactive access to the MCP server connection state,
 * with automatic polling to keep the status up to date.
 */

/**
 * WordPress dependencies
 */
import { useEffect } from '@wordpress/element';
import { useSelect, useDispatch } from '@wordpress/data';

/**
 * Internal dependencies
 */
import { STORE_NAME } from '../store';

/**
 * Polling interval for MCP status refresh (milliseconds).
 *
 * @type {number}
 */
const STATUS_POLL_INTERVAL = 5000;

/**
 * Hook that provides MCP connection status with automatic polling.
 *
 * On first render, the store resolver fetches the status from the
 * REST API. Subsequent updates are fetched every 5 seconds via
 * `setInterval`.
 *
 * @return {Object} Status object with `mcpConnected`, `mcpLastSeenAt`, `isLoading`, and `error` properties.
 */
export function useMcpStatus() {
	const {
		mcpConnected,
		mcpLastSeenAt,
		version,
		protocolVersion,
		isLoading,
		error,
	} = useSelect((select) => select(STORE_NAME).getMcpStatus(), []);

	const { refreshStatus } = useDispatch(STORE_NAME);

	useEffect(() => {
		const intervalId = window.setInterval(() => {
			refreshStatus();
		}, STATUS_POLL_INTERVAL);

		return () => {
			window.clearInterval(intervalId);
		};
	}, [refreshStatus]);

	return {
		mcpConnected,
		mcpLastSeenAt,
		version,
		protocolVersion,
		isLoading,
		error,
	};
}
