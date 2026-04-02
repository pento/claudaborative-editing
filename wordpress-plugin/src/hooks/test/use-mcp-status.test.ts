jest.mock('@wordpress/data', () => ({
	useSelect: jest.fn(),
	useDispatch: jest.fn(() => ({})),
}));
jest.mock('../../store', () => ({ __esModule: true, default: 'mock-store' }));

import { renderHook, act } from '@testing-library/react';
import { useSelect, useDispatch } from '@wordpress/data';
import store from '../../store';
import { useMcpStatus } from '../use-mcp-status';
import type { McpStatus } from '../../store/types';

const mockedUseSelect = useSelect as jest.Mock;
const mockedUseDispatch = useDispatch as jest.Mock;

function mockUseSelect(statusData: Partial<McpStatus>): void {
	mockedUseSelect.mockImplementation((selector: Function) => {
		const select = (s: unknown) => {
			if (s === store) {
				return { getMcpStatus: () => statusData };
			}
			return {};
		};
		return selector(select);
	});
}

describe('useMcpStatus', () => {
	let refreshStatus: jest.Mock;

	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();

		refreshStatus = jest.fn();

		mockUseSelect({
			mcpConnected: false,
			mcpLastSeenAt: null,
			isLoading: false,
			error: null,
		});

		mockedUseDispatch.mockReturnValue({ refreshStatus });
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('returns status values from useSelect', () => {
		mockUseSelect({
			mcpConnected: true,
			mcpLastSeenAt: '2026-03-30T12:00:00Z',
			isLoading: false,
			error: null,
		});

		const { result } = renderHook(() => useMcpStatus());

		expect(result.current.mcpConnected).toBe(true);
		expect(result.current.mcpLastSeenAt).toBe('2026-03-30T12:00:00Z');
		expect(result.current.isLoading).toBe(false);
		expect(result.current.error).toBeNull();
	});

	it('sets up polling interval on mount', () => {
		renderHook(() => useMcpStatus());

		expect(refreshStatus).not.toHaveBeenCalled();

		act(() => {
			jest.advanceTimersByTime(5000);
		});

		expect(refreshStatus).toHaveBeenCalledTimes(1);
	});

	it('clears interval on unmount', () => {
		const { unmount } = renderHook(() => useMcpStatus());

		unmount();

		act(() => {
			jest.advanceTimersByTime(10000);
		});

		expect(refreshStatus).not.toHaveBeenCalled();
	});

	it('calls refreshStatus on each interval tick', () => {
		renderHook(() => useMcpStatus());

		act(() => {
			jest.advanceTimersByTime(15000);
		});

		expect(refreshStatus).toHaveBeenCalledTimes(3);
	});
});
