jest.mock('@wordpress/data', () => ({
	useSelect: jest.fn(),
	useDispatch: jest.fn(() => ({})),
}));
jest.mock('../../store', () => ({ __esModule: true, default: 'mock-store' }));
jest.mock('../../sync/command-sync', () => ({
	subscribeToCommandSync: jest.fn(() => jest.fn()),
}));

import { renderHook, act } from '@testing-library/react';
import { useSelect, useDispatch } from '@wordpress/data';
import store from '../../store';
import { useCommands } from '../use-commands';
import { subscribeToCommandSync } from '../../sync/command-sync';
import type { Command } from '../../store/types';

const mockedUseSelect = useSelect as jest.Mock;
const mockedUseDispatch = useDispatch as jest.Mock;
const mockedSubscribeToCommandSync = subscribeToCommandSync as jest.Mock;

const MOCK_COMMAND: Command = {
	id: 42,
	post_id: 123,
	prompt: 'proofread',
	status: 'running',
	arguments: {},
	message: null,
	result_data: null,
};

function mockUseSelect(
	storeData: Record<string, (...args: unknown[]) => unknown>
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
	let respondToCommand: jest.Mock;
	let fetchActiveCommand: jest.Mock;
	let handleSyncUpdate: jest.Mock;

	beforeEach(() => {
		jest.clearAllMocks();

		submitCommand = jest.fn();
		cancelCommand = jest.fn();
		respondToCommand = jest.fn();
		fetchActiveCommand = jest.fn();
		handleSyncUpdate = jest.fn();

		mockUseSelect({
			getActiveCommand: () => null,
			isSubmitting: () => false,
			isResponding: () => false,
			getCommandError: () => null,
			getCommandHistory: () => [],
		});

		mockedUseDispatch.mockReturnValue({
			submitCommand,
			cancelCommand,
			respondToCommand,
			fetchActiveCommand,
			handleSyncUpdate,
		});
	});

	it('returns command state from useSelect', () => {
		mockUseSelect({
			getActiveCommand: () => MOCK_COMMAND,
			isSubmitting: () => true,
			isResponding: () => false,
			getCommandError: () => 'some error',
			getCommandHistory: () => [{ ...MOCK_COMMAND, status: 'completed' }],
		});

		const { result } = renderHook(() => useCommands(123));

		expect(result.current.activeCommand).toEqual(MOCK_COMMAND);
		expect(result.current.isSubmitting).toBe(true);
		expect(result.current.isResponding).toBe(false);
		expect(result.current.error).toBe('some error');
		expect(result.current.history).toHaveLength(1);
	});

	it('calls fetchActiveCommand with postId on mount', () => {
		renderHook(() => useCommands(123));

		expect(fetchActiveCommand).toHaveBeenCalledWith(123);
	});

	it('does not call fetchActiveCommand when postId is null', () => {
		renderHook(() => useCommands(null));

		expect(fetchActiveCommand).not.toHaveBeenCalled();
	});

	it('subscribes to command sync on mount', () => {
		renderHook(() => useCommands(123));

		expect(mockedSubscribeToCommandSync).toHaveBeenCalledTimes(1);
		expect(mockedSubscribeToCommandSync).toHaveBeenCalledWith(
			expect.any(Function)
		);
	});

	it('unsubscribes from command sync on unmount', () => {
		const unsubscribe = jest.fn();
		mockedSubscribeToCommandSync.mockReturnValue(unsubscribe);

		const { unmount } = renderHook(() => useCommands(123));
		unmount();

		expect(unsubscribe).toHaveBeenCalledTimes(1);
	});

	it('calls handleSyncUpdate when sync provides command changes', () => {
		let syncCallback: (
			commands: Record<string, Command>
		) => void = () => {};
		mockedSubscribeToCommandSync.mockImplementation(
			(cb: (commands: Record<string, Command>) => void) => {
				syncCallback = cb;
				return jest.fn();
			}
		);

		renderHook(() => useCommands(123));

		const commands = {
			'42': {
				...MOCK_COMMAND,
				status: 'awaiting_input' as const,
			},
		};

		act(() => {
			syncCallback(commands);
		});

		expect(handleSyncUpdate).toHaveBeenCalledWith(commands, 123);
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

	it('respondToCommand() calls store respondToCommand', () => {
		const { result } = renderHook(() => useCommands(123));

		act(() => {
			result.current.respondToCommand(42, 'Yes, go ahead');
		});

		expect(respondToCommand).toHaveBeenCalledWith(42, 'Yes, go ahead');
	});

	it('returns isResponding state from useSelect', () => {
		mockUseSelect({
			getActiveCommand: () => MOCK_COMMAND,
			isSubmitting: () => false,
			isResponding: () => true,
			getCommandError: () => null,
			getCommandHistory: () => [],
		});

		const { result } = renderHook(() => useCommands(123));

		expect(result.current.isResponding).toBe(true);
	});
});
