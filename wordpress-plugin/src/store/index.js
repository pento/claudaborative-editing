/**
 * WordPress data store for AI Actions.
 *
 * Manages MCP connection status and command queue state for the
 * Gutenberg editor sidebar panel.
 */

/**
 * WordPress dependencies
 */
import { createReduxStore, register } from '@wordpress/data';
import apiFetch from '@wordpress/api-fetch';

/**
 * Store name constant.
 *
 * @type {string}
 */
export const STORE_NAME = 'wpce/ai-actions';

/**
 * Maximum number of commands to keep in history.
 *
 * @type {number}
 */
const MAX_HISTORY = 10;

/**
 * Terminal command statuses that indicate the command is no longer active.
 *
 * @type {string[]}
 */
const TERMINAL_STATUSES = ['completed', 'failed', 'cancelled', 'expired'];

/**
 * Default state for the store.
 *
 * @type {Object}
 */
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

/**
 * Store reducer.
 *
 * @param {Object} state  Current state.
 * @param {Object} action Dispatched action.
 * @return {Object} Next state.
 */
function reducer(state = DEFAULT_STATE, action) {
	switch (action.type) {
		case 'SET_STATUS':
			return {
				...state,
				status: {
					...state.status,
					mcpConnected: action.mcpConnected,
					mcpLastSeenAt: action.mcpLastSeenAt,
					version: action.version,
					protocolVersion: action.protocolVersion,
					error: null,
				},
			};

		case 'SET_STATUS_LOADING':
			return {
				...state,
				status: {
					...state.status,
					isLoading: action.isLoading,
				},
			};

		case 'SET_STATUS_ERROR':
			return {
				...state,
				status: {
					...state.status,
					error: action.error,
					isLoading: false,
				},
			};

		case 'SUBMIT_COMMAND_START':
			return {
				...state,
				commands: {
					...state.commands,
					isSubmitting: true,
					error: null,
				},
			};

		case 'SUBMIT_COMMAND_SUCCESS':
			return {
				...state,
				commands: {
					...state.commands,
					active: action.command,
					isSubmitting: false,
				},
			};

		case 'SUBMIT_COMMAND_ERROR':
			return {
				...state,
				commands: {
					...state.commands,
					error: action.error,
					isSubmitting: false,
				},
			};

		case 'UPDATE_ACTIVE_COMMAND':
			return {
				...state,
				commands: {
					...state.commands,
					active: action.command,
				},
			};

		case 'CLEAR_ACTIVE_COMMAND': {
			// Use the provided command (with terminal status) if available,
			// otherwise fall back to the current active command.
			const finishedCommand = action.command || state.commands.active;
			const history = finishedCommand
				? [finishedCommand, ...state.commands.history].slice(
						0,
						MAX_HISTORY
					)
				: state.commands.history;

			return {
				...state,
				commands: {
					...state.commands,
					active: null,
					history,
				},
			};
		}

		case 'SET_COMMAND_HISTORY':
			return {
				...state,
				commands: {
					...state.commands,
					history: action.history.slice(0, MAX_HISTORY),
				},
			};

		default:
			return state;
	}
}

/**
 * Action creators for the store.
 *
 * Plain action creators return action objects. Thunk action creators
 * return async functions that receive `{ dispatch }`.
 */
const actions = {
	/**
	 * Fetch the current MCP connection status from the REST API.
	 *
	 * @return {Function} Thunk action.
	 */
	refreshStatus:
		() =>
		async ({ dispatch }) => {
			dispatch({ type: 'SET_STATUS_LOADING', isLoading: true });

			try {
				const response = await apiFetch({
					path: '/wpce/v1/status',
				});

				dispatch({
					type: 'SET_STATUS',
					mcpConnected: response.mcp_connected,
					mcpLastSeenAt: response.mcp_last_seen_at,
					version: response.version,
					protocolVersion: response.protocol_version,
				});
			} catch (error) {
				dispatch({
					type: 'SET_STATUS_ERROR',
					error: error.message || String(error),
				});
			} finally {
				dispatch({ type: 'SET_STATUS_LOADING', isLoading: false });
			}
		},

	/**
	 * Submit a new command to the REST API.
	 *
	 * @param {string} prompt The prompt identifier (e.g. 'proofread', 'review').
	 * @param {number} postId The target post ID.
	 * @param {Object} args   Optional arguments for the command.
	 * @return {Function} Thunk action.
	 */
	submitCommand:
		(prompt, postId, args = {}) =>
		async ({ dispatch }) => {
			dispatch({ type: 'SUBMIT_COMMAND_START' });

			try {
				const command = await apiFetch({
					path: '/wpce/v1/commands',
					method: 'POST',
					data: {
						prompt,
						post_id: postId,
						arguments: args,
					},
				});

				dispatch({
					type: 'SUBMIT_COMMAND_SUCCESS',
					command,
				});
			} catch (error) {
				dispatch({
					type: 'SUBMIT_COMMAND_ERROR',
					error: error.message || String(error),
				});
			}
		},

	/**
	 * Cancel an active command via the REST API.
	 *
	 * @param {number} id The command ID to cancel.
	 * @return {Function} Thunk action.
	 */
	cancelCommand:
		(id) =>
		async ({ dispatch }) => {
			try {
				const command = await apiFetch({
					path: `/wpce/v1/commands/${id}`,
					method: 'DELETE',
				});

				dispatch({ type: 'CLEAR_ACTIVE_COMMAND', command });
			} catch (error) {
				dispatch({
					type: 'SUBMIT_COMMAND_ERROR',
					error: error.message || String(error),
				});
			}
		},

	/**
	 * Fetch commands and detect any in-progress command.
	 *
	 * When postId is provided, fetches commands for that post.
	 * When omitted, fetches all commands for the current user
	 * (needed to discover active commands on other posts after reload).
	 *
	 * @param {number} [postId] Optional post ID to filter by.
	 * @return {Function} Thunk action.
	 */
	fetchActiveCommand:
		(postId) =>
		async ({ dispatch }) => {
			try {
				const query = postId ? `?post_id=${postId}` : '';
				const commands = await apiFetch({
					path: `/wpce/v1/commands${query}`,
				});

				const active = commands.find((command) =>
					['pending', 'claimed', 'running'].includes(command.status)
				);

				if (active) {
					dispatch({
						type: 'SUBMIT_COMMAND_SUCCESS',
						command: active,
					});
				}

				const pastCommands = commands.filter(
					(command) =>
						!['pending', 'claimed', 'running'].includes(
							command.status
						)
				);
				dispatch({
					type: 'SET_COMMAND_HISTORY',
					history: pastCommands,
				});
			} catch (error) {
				// Silently fail — the sidebar will still function without
				// historical data.
			}
		},

	/**
	 * Poll for updates to the currently active command.
	 *
	 * @return {Function} Thunk action.
	 */
	pollActiveCommand:
		() =>
		async ({ dispatch, select }) => {
			const active = select.getActiveCommand();

			if (!active) {
				return;
			}

			try {
				const commands = await apiFetch({
					path: `/wpce/v1/commands?post_id=${active.post_id}`,
				});

				const updated = commands.find(
					(command) => command.id === active.id
				);

				if (!updated) {
					dispatch({ type: 'CLEAR_ACTIVE_COMMAND' });
					return;
				}

				if (TERMINAL_STATUSES.includes(updated.status)) {
					dispatch({
						type: 'CLEAR_ACTIVE_COMMAND',
						command: updated,
					});
				} else {
					dispatch({
						type: 'UPDATE_ACTIVE_COMMAND',
						command: updated,
					});
				}
			} catch (error) {
				// Silently fail — will retry on the next poll cycle.
			}
		},
};

/**
 * Store selectors.
 */
const selectors = {
	/**
	 * Get the full MCP status object.
	 *
	 * @param {Object} state Store state.
	 * @return {Object} Status object.
	 */
	getMcpStatus(state) {
		return state.status;
	},

	/**
	 * Check whether the MCP server is connected.
	 *
	 * @param {Object} state Store state.
	 * @return {boolean} True if connected.
	 */
	isMcpConnected(state) {
		return state.status.mcpConnected;
	},

	/**
	 * Get the currently active command, if any.
	 *
	 * @param {Object} state Store state.
	 * @return {Object|null} Active command object or null.
	 */
	getActiveCommand(state) {
		return state.commands.active;
	},

	/**
	 * Check whether a command is currently running.
	 *
	 * @param {Object} state Store state.
	 * @return {boolean} True if a command is active.
	 */
	isCommandRunning(state) {
		return state.commands.active !== null;
	},

	/**
	 * Check whether a command is being submitted.
	 *
	 * @param {Object} state Store state.
	 * @return {boolean} True if submitting.
	 */
	isSubmitting(state) {
		return state.commands.isSubmitting;
	},

	/**
	 * Get the command history.
	 *
	 * @param {Object} state Store state.
	 * @return {Array} Array of past commands.
	 */
	getCommandHistory(state) {
		return state.commands.history;
	},

	/**
	 * Get the current command error, if any.
	 *
	 * @param {Object} state Store state.
	 * @return {string|null} Error message or null.
	 */
	getCommandError(state) {
		return state.commands.error;
	},
};

/**
 * Store resolvers — auto-fetch data on first selector access.
 */
const resolvers = {
	/**
	 * Resolver for getMcpStatus — fetches status from the API on first access.
	 *
	 * @return {Function} Thunk action.
	 */
	getMcpStatus:
		() =>
		async ({ dispatch }) => {
			dispatch(actions.refreshStatus());
		},
};

/**
 * The Redux store instance.
 *
 * @type {Object}
 */
const store = createReduxStore(STORE_NAME, {
	reducer,
	actions,
	selectors,
	resolvers,
});

register(store);

export default store;
