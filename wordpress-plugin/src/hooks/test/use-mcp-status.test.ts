jest.mock('../../sync/command-sync', () => ({
	isMcpConnected: jest.fn(() => false),
	subscribeToMcpConnection: jest.fn(() => jest.fn()),
}));

import { renderHook, act } from '@testing-library/react';
import { useMcpStatus } from '../use-mcp-status';
import {
	isMcpConnected,
	subscribeToMcpConnection,
} from '../../sync/command-sync';

const mockedIsMcpConnected = isMcpConnected as jest.Mock;
const mockedSubscribeToMcpConnection = subscribeToMcpConnection as jest.Mock;

describe('useMcpStatus', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockedIsMcpConnected.mockReturnValue(false);
		mockedSubscribeToMcpConnection.mockImplementation(() => jest.fn());
	});

	it('returns initial connection state from isMcpConnected', () => {
		mockedIsMcpConnected.mockReturnValue(true);

		const { result } = renderHook(() => useMcpStatus());

		expect(result.current.mcpConnected).toBe(true);
	});

	it('returns false when MCP is not connected', () => {
		const { result } = renderHook(() => useMcpStatus());

		expect(result.current.mcpConnected).toBe(false);
	});

	it('subscribes to connection changes on mount', () => {
		renderHook(() => useMcpStatus());

		expect(mockedSubscribeToMcpConnection).toHaveBeenCalledTimes(1);
		expect(mockedSubscribeToMcpConnection).toHaveBeenCalledWith(
			expect.any(Function)
		);
	});

	it('updates when connection status changes', () => {
		let callback: (connected: boolean) => void = () => {};
		mockedSubscribeToMcpConnection.mockImplementation(
			(cb: (connected: boolean) => void) => {
				callback = cb;
				return jest.fn();
			}
		);

		const { result } = renderHook(() => useMcpStatus());
		expect(result.current.mcpConnected).toBe(false);

		act(() => {
			callback(true);
		});

		expect(result.current.mcpConnected).toBe(true);
	});

	it('unsubscribes on unmount', () => {
		const unsubscribe = jest.fn();
		mockedSubscribeToMcpConnection.mockReturnValue(unsubscribe);

		const { unmount } = renderHook(() => useMcpStatus());
		unmount();

		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});
});
