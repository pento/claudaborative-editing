/**
 * Unit tests for the AI Actions data store.
 *
 * Tests the reducer, selectors, and thunk action creators that power
 * the sidebar panel's state management.
 */

/* eslint-disable jsdoc/require-jsdoc */

/**
 * Mocks are provided via moduleNameMapper in jest.config.json
 * pointing to src/__mocks__/@wordpress/{data,api-fetch}.js.
 */
import { createReduxStore } from '@wordpress/data';
import apiFetch from '@wordpress/api-fetch';
import { STORE_NAME } from '../index';

const storeConfig = createReduxStore.mock.calls[0][1];
const { reducer, actions, selectors } = storeConfig;

const DEFAULT_STATE = {
	status: {
		mcpConnected: false,
		mcpLastSeenAt: null,
		version: null,
		protocolVersion: null,
		isLoading: false,
		error: null,
	},
	commands: {
		active: null,
		history: [],
		isSubmitting: false,
		error: null,
	},
};

const MOCK_COMMAND = {
	id: 42,
	post_id: 123,
	prompt: 'proofread',
	status: 'pending',
	arguments: {},
	message: null,
};

describe('AI Actions store', () => {
	beforeEach(() => {
		apiFetch.mockReset();
	});

	it('registers with the correct store name', () => {
		expect(STORE_NAME).toBe('wpce/ai-actions');
		expect(createReduxStore).toHaveBeenCalledWith(
			'wpce/ai-actions',
			expect.any(Object)
		);
	});

	describe('reducer', () => {
		it('returns default state', () => {
			const state = reducer(undefined, { type: '@@INIT' });
			expect(state).toEqual(DEFAULT_STATE);
		});

		it('returns state unchanged for unknown action', () => {
			const state = { ...DEFAULT_STATE };
			const result = reducer(state, { type: 'UNKNOWN' });
			expect(result).toBe(state);
		});

		it('handles SET_STATUS', () => {
			const state = reducer(DEFAULT_STATE, {
				type: 'SET_STATUS',
				mcpConnected: true,
				mcpLastSeenAt: '2026-03-30T12:00:00Z',
				version: '0.1.0',
				protocolVersion: 1,
			});

			expect(state.status).toEqual({
				mcpConnected: true,
				mcpLastSeenAt: '2026-03-30T12:00:00Z',
				version: '0.1.0',
				protocolVersion: 1,
				isLoading: false,
				error: null,
			});
		});

		it('SET_STATUS clears previous error', () => {
			const initial = {
				...DEFAULT_STATE,
				status: { ...DEFAULT_STATE.status, error: 'old error' },
			};
			const state = reducer(initial, {
				type: 'SET_STATUS',
				mcpConnected: false,
				mcpLastSeenAt: null,
				version: null,
				protocolVersion: null,
			});
			expect(state.status.error).toBeNull();
		});

		it('handles SET_STATUS_LOADING', () => {
			const state = reducer(DEFAULT_STATE, {
				type: 'SET_STATUS_LOADING',
				isLoading: true,
			});
			expect(state.status.isLoading).toBe(true);
		});

		it('handles SET_STATUS_ERROR', () => {
			const initial = {
				...DEFAULT_STATE,
				status: { ...DEFAULT_STATE.status, isLoading: true },
			};
			const state = reducer(initial, {
				type: 'SET_STATUS_ERROR',
				error: 'Network error',
			});
			expect(state.status.error).toBe('Network error');
			expect(state.status.isLoading).toBe(false);
		});

		it('handles SUBMIT_COMMAND_START', () => {
			const initial = {
				...DEFAULT_STATE,
				commands: {
					...DEFAULT_STATE.commands,
					error: 'previous error',
				},
			};
			const state = reducer(initial, {
				type: 'SUBMIT_COMMAND_START',
			});
			expect(state.commands.isSubmitting).toBe(true);
			expect(state.commands.error).toBeNull();
		});

		it('handles SUBMIT_COMMAND_SUCCESS', () => {
			const initial = {
				...DEFAULT_STATE,
				commands: {
					...DEFAULT_STATE.commands,
					isSubmitting: true,
				},
			};
			const state = reducer(initial, {
				type: 'SUBMIT_COMMAND_SUCCESS',
				command: MOCK_COMMAND,
			});
			expect(state.commands.active).toEqual(MOCK_COMMAND);
			expect(state.commands.isSubmitting).toBe(false);
		});

		it('handles SUBMIT_COMMAND_ERROR', () => {
			const initial = {
				...DEFAULT_STATE,
				commands: {
					...DEFAULT_STATE.commands,
					isSubmitting: true,
				},
			};
			const state = reducer(initial, {
				type: 'SUBMIT_COMMAND_ERROR',
				error: 'Failed',
			});
			expect(state.commands.error).toBe('Failed');
			expect(state.commands.isSubmitting).toBe(false);
		});

		it('handles UPDATE_ACTIVE_COMMAND', () => {
			const updated = { ...MOCK_COMMAND, status: 'running' };
			const initial = {
				...DEFAULT_STATE,
				commands: {
					...DEFAULT_STATE.commands,
					active: MOCK_COMMAND,
				},
			};
			const state = reducer(initial, {
				type: 'UPDATE_ACTIVE_COMMAND',
				command: updated,
			});
			expect(state.commands.active).toEqual(updated);
		});

		it('handles CLEAR_ACTIVE_COMMAND with provided command', () => {
			const completed = { ...MOCK_COMMAND, status: 'completed' };
			const initial = {
				...DEFAULT_STATE,
				commands: {
					...DEFAULT_STATE.commands,
					active: { ...MOCK_COMMAND, status: 'running' },
				},
			};
			const state = reducer(initial, {
				type: 'CLEAR_ACTIVE_COMMAND',
				command: completed,
			});
			expect(state.commands.active).toBeNull();
			expect(state.commands.history[0]).toEqual(completed);
		});

		it('handles CLEAR_ACTIVE_COMMAND without provided command', () => {
			const initial = {
				...DEFAULT_STATE,
				commands: {
					...DEFAULT_STATE.commands,
					active: MOCK_COMMAND,
				},
			};
			const state = reducer(initial, {
				type: 'CLEAR_ACTIVE_COMMAND',
			});
			expect(state.commands.active).toBeNull();
			expect(state.commands.history[0]).toEqual(MOCK_COMMAND);
		});

		it('CLEAR_ACTIVE_COMMAND caps history at 10', () => {
			const existingHistory = Array.from({ length: 10 }, (_, i) => ({
				...MOCK_COMMAND,
				id: i,
			}));
			const initial = {
				...DEFAULT_STATE,
				commands: {
					...DEFAULT_STATE.commands,
					active: { ...MOCK_COMMAND, id: 99 },
					history: existingHistory,
				},
			};
			const state = reducer(initial, {
				type: 'CLEAR_ACTIVE_COMMAND',
			});
			expect(state.commands.history).toHaveLength(10);
			expect(state.commands.history[0].id).toBe(99);
			expect(state.commands.history[9].id).toBe(8);
		});

		it('handles SET_COMMAND_HISTORY', () => {
			const history = [MOCK_COMMAND];
			const state = reducer(DEFAULT_STATE, {
				type: 'SET_COMMAND_HISTORY',
				history,
			});
			expect(state.commands.history).toEqual(history);
		});
	});

	describe('selectors', () => {
		const state = {
			status: {
				mcpConnected: true,
				mcpLastSeenAt: '2026-03-30T12:00:00Z',
				version: '0.1.0',
				protocolVersion: 1,
				isLoading: false,
				error: null,
			},
			commands: {
				active: MOCK_COMMAND,
				history: [{ ...MOCK_COMMAND, id: 1, status: 'completed' }],
				isSubmitting: false,
				error: 'some error',
			},
		};

		it('getMcpStatus returns status object', () => {
			expect(selectors.getMcpStatus(state)).toBe(state.status);
		});

		it('isMcpConnected returns connection state', () => {
			expect(selectors.isMcpConnected(state)).toBe(true);
			expect(
				selectors.isMcpConnected({
					...state,
					status: { ...state.status, mcpConnected: false },
				})
			).toBe(false);
		});

		it('getActiveCommand returns active command', () => {
			expect(selectors.getActiveCommand(state)).toBe(MOCK_COMMAND);
		});

		it('isCommandRunning returns true when active', () => {
			expect(selectors.isCommandRunning(state)).toBe(true);
			expect(
				selectors.isCommandRunning({
					...state,
					commands: { ...state.commands, active: null },
				})
			).toBe(false);
		});

		it('isSubmitting returns submitting state', () => {
			expect(selectors.isSubmitting(state)).toBe(false);
		});

		it('getCommandHistory returns history array', () => {
			expect(selectors.getCommandHistory(state)).toBe(
				state.commands.history
			);
		});

		it('getCommandError returns error', () => {
			expect(selectors.getCommandError(state)).toBe('some error');
		});
	});

	describe('actions', () => {
		let dispatch;

		beforeEach(() => {
			dispatch = jest.fn();
		});

		describe('refreshStatus', () => {
			it('dispatches status on success', async () => {
				apiFetch.mockResolvedValueOnce({
					mcp_connected: true,
					mcp_last_seen_at: '2026-03-30T12:00:00Z',
					version: '0.1.0',
					protocol_version: 1,
				});

				await actions.refreshStatus()({ dispatch });

				expect(apiFetch).toHaveBeenCalledWith({
					path: '/wpce/v1/status',
				});
				expect(dispatch).toHaveBeenCalledWith({
					type: 'SET_STATUS_LOADING',
					isLoading: true,
				});
				expect(dispatch).toHaveBeenCalledWith({
					type: 'SET_STATUS',
					mcpConnected: true,
					mcpLastSeenAt: '2026-03-30T12:00:00Z',
					version: '0.1.0',
					protocolVersion: 1,
				});
				expect(dispatch).toHaveBeenCalledWith({
					type: 'SET_STATUS_LOADING',
					isLoading: false,
				});
			});

			it('dispatches error on failure', async () => {
				apiFetch.mockRejectedValueOnce(new Error('Network error'));

				await actions.refreshStatus()({ dispatch });

				expect(dispatch).toHaveBeenCalledWith({
					type: 'SET_STATUS_ERROR',
					error: 'Network error',
				});
				expect(dispatch).toHaveBeenCalledWith({
					type: 'SET_STATUS_LOADING',
					isLoading: false,
				});
			});
		});

		describe('submitCommand', () => {
			it('submits command and dispatches success', async () => {
				apiFetch.mockResolvedValueOnce(MOCK_COMMAND);

				await actions.submitCommand('proofread', 123, {})({ dispatch });

				expect(apiFetch).toHaveBeenCalledWith({
					path: '/wpce/v1/commands',
					method: 'POST',
					data: {
						prompt: 'proofread',
						post_id: 123,
						arguments: {},
					},
				});
				expect(dispatch).toHaveBeenCalledWith({
					type: 'SUBMIT_COMMAND_START',
				});
				expect(dispatch).toHaveBeenCalledWith({
					type: 'SUBMIT_COMMAND_SUCCESS',
					command: MOCK_COMMAND,
				});
			});

			it('dispatches error on failure', async () => {
				apiFetch.mockRejectedValueOnce(new Error('Forbidden'));

				await actions.submitCommand('review', 456)({ dispatch });

				expect(dispatch).toHaveBeenCalledWith({
					type: 'SUBMIT_COMMAND_ERROR',
					error: 'Forbidden',
				});
			});
		});

		describe('cancelCommand', () => {
			it('cancels and dispatches clear', async () => {
				apiFetch.mockResolvedValueOnce({});

				await actions.cancelCommand(42)({ dispatch });

				expect(apiFetch).toHaveBeenCalledWith({
					path: '/wpce/v1/commands/42',
					method: 'DELETE',
				});
				expect(dispatch).toHaveBeenCalledWith({
					type: 'CLEAR_ACTIVE_COMMAND',
				});
			});

			it('dispatches error on failure', async () => {
				apiFetch.mockRejectedValueOnce(new Error('Not found'));

				await actions.cancelCommand(99)({ dispatch });

				expect(dispatch).toHaveBeenCalledWith({
					type: 'SUBMIT_COMMAND_ERROR',
					error: 'Not found',
				});
			});
		});

		describe('fetchActiveCommand', () => {
			it('sets active command when found', async () => {
				const running = { ...MOCK_COMMAND, status: 'running' };
				const completed = {
					...MOCK_COMMAND,
					id: 41,
					status: 'completed',
				};
				apiFetch.mockResolvedValueOnce([running, completed]);

				await actions.fetchActiveCommand(123)({ dispatch });

				expect(apiFetch).toHaveBeenCalledWith({
					path: '/wpce/v1/commands?post_id=123',
				});
				expect(dispatch).toHaveBeenCalledWith({
					type: 'SUBMIT_COMMAND_SUCCESS',
					command: running,
				});
			});

			it('does not set active when none found', async () => {
				const completed = {
					...MOCK_COMMAND,
					status: 'completed',
				};
				apiFetch.mockResolvedValueOnce([completed]);

				await actions.fetchActiveCommand(123)({ dispatch });

				expect(dispatch).not.toHaveBeenCalledWith(
					expect.objectContaining({
						type: 'SUBMIT_COMMAND_SUCCESS',
					})
				);
			});

			it('filters active commands from history', async () => {
				const running = { ...MOCK_COMMAND, status: 'running' };
				const completed = {
					...MOCK_COMMAND,
					id: 41,
					status: 'completed',
				};
				apiFetch.mockResolvedValueOnce([running, completed]);

				await actions.fetchActiveCommand(123)({ dispatch });

				expect(dispatch).toHaveBeenCalledWith({
					type: 'SET_COMMAND_HISTORY',
					history: [completed],
				});
			});

			it('silently fails on API error', async () => {
				apiFetch.mockRejectedValueOnce(new Error('Server error'));

				await actions.fetchActiveCommand(123)({ dispatch });

				expect(dispatch).not.toHaveBeenCalled();
			});
		});

		describe('pollActiveCommand', () => {
			let select;

			beforeEach(() => {
				select = {
					getActiveCommand: jest.fn(),
				};
			});

			it('returns early when no active command', async () => {
				select.getActiveCommand.mockReturnValue(null);

				await actions.pollActiveCommand()({ dispatch, select });

				expect(apiFetch).not.toHaveBeenCalled();
				expect(dispatch).not.toHaveBeenCalled();
			});

			it('updates when command still running', async () => {
				const active = { ...MOCK_COMMAND, status: 'running' };
				select.getActiveCommand.mockReturnValue(active);

				const updated = { ...active, message: 'in progress' };
				apiFetch.mockResolvedValueOnce([updated]);

				await actions.pollActiveCommand()({ dispatch, select });

				expect(dispatch).toHaveBeenCalledWith({
					type: 'UPDATE_ACTIVE_COMMAND',
					command: updated,
				});
			});

			it('clears with terminal command when completed', async () => {
				const active = { ...MOCK_COMMAND, status: 'running' };
				select.getActiveCommand.mockReturnValue(active);

				const completed = {
					...MOCK_COMMAND,
					status: 'completed',
					message: 'Done',
				};
				apiFetch.mockResolvedValueOnce([completed]);

				await actions.pollActiveCommand()({ dispatch, select });

				expect(dispatch).toHaveBeenCalledWith({
					type: 'CLEAR_ACTIVE_COMMAND',
					command: completed,
				});
			});

			it('clears when command not found', async () => {
				select.getActiveCommand.mockReturnValue(MOCK_COMMAND);
				apiFetch.mockResolvedValueOnce([]);

				await actions.pollActiveCommand()({ dispatch, select });

				expect(dispatch).toHaveBeenCalledWith({
					type: 'CLEAR_ACTIVE_COMMAND',
				});
			});

			it('handles all terminal statuses', async () => {
				for (const status of [
					'completed',
					'failed',
					'cancelled',
					'expired',
				]) {
					dispatch.mockClear();
					apiFetch.mockReset();

					select.getActiveCommand.mockReturnValue(MOCK_COMMAND);
					const terminal = { ...MOCK_COMMAND, status };
					apiFetch.mockResolvedValueOnce([terminal]);

					await actions.pollActiveCommand()({
						dispatch,
						select,
					});

					expect(dispatch).toHaveBeenCalledWith({
						type: 'CLEAR_ACTIVE_COMMAND',
						command: terminal,
					});
				}
			});

			it('silently fails on API error', async () => {
				select.getActiveCommand.mockReturnValue(MOCK_COMMAND);
				apiFetch.mockRejectedValueOnce(new Error('Timeout'));

				await actions.pollActiveCommand()({ dispatch, select });

				expect(dispatch).not.toHaveBeenCalled();
			});
		});
	});
});
