jest.mock('@wordpress/data', () => ({
	useSelect: jest.fn(),
	useDispatch: jest.fn(() => ({})),
}));
jest.mock('../../store', () => ({ __esModule: true, default: 'mock-store' }));

import { renderHook, act } from '@testing-library/react';
import { useSelect, useDispatch } from '@wordpress/data';
import store from '../../store';
import { useCommands } from '../use-commands';
import type { Command } from '../../store/types';

const mockedUseSelect = useSelect as jest.Mock;
const mockedUseDispatch = useDispatch as jest.Mock;

const MOCK_COMMAND: Command = {
	id: 42,
	post_id: 123,
	prompt: 'proofread',
	status: 'running',
	arguments: {},
	message: null,
};

function mockUseSelect(
	storeData: Record<string, (...args: any[]) => any>
): void {
	mockedUseSelect.mockImplementation((selector: Function) => {
		const select = (s: unknown) => {
			if (s === store) {
				return storeData;
			}
			return {};
		};
		return selector(select);
	});
}

describe('useCommands', () => {
	let submitCommand: jest.Mock;
	let cancelCommand: jest.Mock;
	let fetchActiveCommand: jest.Mock;
	let pollActiveCommand: jest.Mock;

	beforeEach(() => {
		jest.clearAllMocks();
		jest.useFakeTimers();

		submitCommand = jest.fn();
		cancelCommand = jest.fn();
		fetchActiveCommand = jest.fn();
		pollActiveCommand = jest.fn();

		mockUseSelect({
			getActiveCommand: () => null,
			isSubmitting: () => false,
			getCommandError: () => null,
			getCommandHistory: () => [],
		});

		mockedUseDispatch.mockReturnValue({
			submitCommand,
			cancelCommand,
			fetchActiveCommand,
			pollActiveCommand,
		});
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('returns command state from useSelect', () => {
		mockUseSelect({
			getActiveCommand: () => MOCK_COMMAND,
			isSubmitting: () => true,
			getCommandError: () => 'some error',
			getCommandHistory: () => [{ ...MOCK_COMMAND, status: 'completed' }],
		});

		const { result } = renderHook(() => useCommands(123));

		expect(result.current.activeCommand).toEqual(MOCK_COMMAND);
		expect(result.current.isSubmitting).toBe(true);
		expect(result.current.error).toBe('some error');
		expect(result.current.history).toHaveLength(1);
	});

	it('calls fetchActiveCommand with postId on mount', () => {
		renderHook(() => useCommands(123));

		expect(fetchActiveCommand).toHaveBeenCalledWith(123);
	});

	it('does not call fetchActiveCommand when postId is falsy', () => {
		renderHook(() => useCommands(null));

		expect(fetchActiveCommand).not.toHaveBeenCalled();
	});

	it('sets up polling when activeCommand is present', () => {
		mockUseSelect({
			getActiveCommand: () => MOCK_COMMAND,
			isSubmitting: () => false,
			getCommandError: () => null,
			getCommandHistory: () => [],
		});

		renderHook(() => useCommands(123));

		act(() => {
			jest.advanceTimersByTime(3000);
		});

		expect(pollActiveCommand).toHaveBeenCalledTimes(1);
	});

	it('does not poll when no active command', () => {
		renderHook(() => useCommands(123));

		act(() => {
			jest.advanceTimersByTime(9000);
		});

		expect(pollActiveCommand).not.toHaveBeenCalled();
	});

	it('stops polling on unmount', () => {
		mockUseSelect({
			getActiveCommand: () => MOCK_COMMAND,
			isSubmitting: () => false,
			getCommandError: () => null,
			getCommandHistory: () => [],
		});

		const { unmount } = renderHook(() => useCommands(123));

		unmount();

		act(() => {
			jest.advanceTimersByTime(9000);
		});

		expect(pollActiveCommand).not.toHaveBeenCalled();
	});

	it('submit() calls submitCommand with correct args', () => {
		const { result } = renderHook(() => useCommands(123));

		act(() => {
			result.current.submit('proofread', { focus: 'grammar' });
		});

		expect(submitCommand).toHaveBeenCalledWith('proofread', 123, {
			focus: 'grammar',
		});
	});

	it('cancel() calls cancelCommand with correct id', () => {
		const { result } = renderHook(() => useCommands(123));

		act(() => {
			result.current.cancel(42);
		});

		expect(cancelCommand).toHaveBeenCalledWith(42);
	});
});
