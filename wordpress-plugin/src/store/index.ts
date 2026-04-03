/**
 * WordPress data store for AI Actions.
 *
 * Manages MCP connection status and command queue state for the
 * Gutenberg editor sidebar panel.
 */

/**
 * WordPress dependencies
 */
import {
	createReduxStore,
	createRegistrySelector,
	register,
} from '@wordpress/data';
import apiFetch from '@wordpress/api-fetch';
import { store as editorStore } from '@wordpress/editor';

/**
 * Internal dependencies
 */
import { TERMINAL_STATUSES, type CommandSlug } from '#shared/commands';
import type {
	Command,
	StoreState,
	StoreAction,
	StatusApiResponse,
} from './types';

/**
 * Thunk arguments provided by @wordpress/data to thunk action creators.
 *
 * `dispatch` accepts both plain action objects and thunk functions.
 * `select` exposes the store's bound selectors.
 */
interface StoreThunkArgs {
	dispatch: (action: unknown) => void;
	select: {
		getActiveCommand: () => Command | null;
	};
}

export const STORE_NAME = 'wpce/ai-actions' as const;

/**
 * Maximum number of commands to keep in history.
 */
const MAX_HISTORY = 10;

/**
 * Default state for the store.
 */
const DEFAULT_STATE: StoreState = {
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
 * @param state  Current state.
 * @param action Dispatched action.
 * @return Next state.
 */
function reducer(
	state: StoreState = DEFAULT_STATE,
	action: StoreAction
): StoreState {
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
			const history = action.command
				? [action.command, ...state.commands.history].slice(
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
	 * @return Thunk action.
	 */
	refreshStatus:
		() =>
		async ({ dispatch }: StoreThunkArgs) => {
			dispatch({ type: 'SET_STATUS_LOADING', isLoading: true });

			try {
				const response = await apiFetch<StatusApiResponse>({
					path: '/wpce/v1/status',
				});

				dispatch({
					type: 'SET_STATUS',
					mcpConnected: response.mcp_connected,
					mcpLastSeenAt: response.mcp_last_seen_at,
					version: response.version,
					protocolVersion: response.protocol_version,
				});
			} catch (error: unknown) {
				dispatch({
					type: 'SET_STATUS_ERROR',
					error:
						error instanceof Error ? error.message : String(error),
				});
			} finally {
				dispatch({
					type: 'SET_STATUS_LOADING',
					isLoading: false,
				});
			}
		},

	/**
	 * Submit a new command to the REST API.
	 *
	 * @param prompt The prompt identifier (e.g. 'proofread', 'review').
	 * @param postId The target post ID.
	 * @param args   Optional arguments for the command.
	 * @return Thunk action.
	 */
	submitCommand:
		(
			prompt: CommandSlug,
			postId: number,
			args: Record<string, unknown> = {}
		) =>
		async ({ dispatch }: StoreThunkArgs) => {
			dispatch({ type: 'SUBMIT_COMMAND_START' });

			try {
				const command = await apiFetch<Command>({
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
			} catch (error: unknown) {
				dispatch({
					type: 'SUBMIT_COMMAND_ERROR',
					error:
						error instanceof Error ? error.message : String(error),
				});
			}
		},

	/**
	 * Cancel an active command via the REST API.
	 *
	 * @param id The command ID to cancel.
	 * @return Thunk action.
	 */
	cancelCommand:
		(id: number) =>
		async ({ dispatch }: StoreThunkArgs) => {
			try {
				const command = await apiFetch<Command>({
					path: `/wpce/v1/commands/${id}`,
					method: 'DELETE',
				});

				dispatch({ type: 'CLEAR_ACTIVE_COMMAND', command });
			} catch (error: unknown) {
				dispatch({
					type: 'SUBMIT_COMMAND_ERROR',
					error:
						error instanceof Error ? error.message : String(error),
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
	 * @param postId Optional post ID to filter by.
	 * @return Thunk action.
	 */
	fetchActiveCommand:
		(postId?: number) =>
		async ({ dispatch }: StoreThunkArgs) => {
			try {
				const query = postId !== undefined ? `?post_id=${postId}` : '';
				const commands = await apiFetch<Command[]>({
					path: `/wpce/v1/commands${query}`,
				});

				const active = commands.find((command) =>
					['pending', 'running'].includes(command.status)
				);

				if (active) {
					dispatch({
						type: 'SUBMIT_COMMAND_SUCCESS',
						command: active,
					});
				}

				const pastCommands = commands.filter(
					(command) =>
						!['pending', 'running'].includes(command.status)
				);
				dispatch({
					type: 'SET_COMMAND_HISTORY',
					history: pastCommands,
				});
			} catch {
				// Silently fail — the sidebar will still function without
				// historical data.
			}
		},

	/**
	 * Poll for updates to the currently active command.
	 *
	 * @return Thunk action.
	 */
	pollActiveCommand:
		() =>
		async ({ dispatch, select }: StoreThunkArgs) => {
			const active = select.getActiveCommand();

			if (!active) {
				return;
			}

			try {
				const commands = await apiFetch<Command[]>({
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
			} catch {
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
	 * @param state Store state.
	 * @return Status object.
	 */
	getMcpStatus(state: StoreState) {
		return state.status;
	},

	/**
	 * Check whether the MCP server is connected.
	 *
	 * @param state Store state.
	 * @return True if connected.
	 */
	isMcpConnected(state: StoreState) {
		return state.status.mcpConnected;
	},

	/**
	 * Get the currently active command, if any.
	 *
	 * @param state Store state.
	 * @return Active command object or null.
	 */
	getActiveCommand(state: StoreState) {
		return state.commands.active;
	},

	/**
	 * Check whether a command is currently running.
	 *
	 * @param state Store state.
	 * @return True if a command is active.
	 */
	isCommandRunning(state: StoreState) {
		return state.commands.active !== null;
	},

	/**
	 * Check whether a command is being submitted.
	 *
	 * @param state Store state.
	 * @return True if submitting.
	 */
	isSubmitting(state: StoreState) {
		return state.commands.isSubmitting;
	},

	/**
	 * Get the command history.
	 *
	 * @param state Store state.
	 * @return Array of past commands.
	 */
	getCommandHistory(state: StoreState) {
		return state.commands.history;
	},

	/**
	 * Get the current command error, if any.
	 *
	 * @param state Store state.
	 * @return Error message or null.
	 */
	getCommandError(state: StoreState) {
		return state.commands.error;
	},

	/**
	 * Get the current post ID from the editor, coerced to number | null.
	 *
	 * WordPress's getCurrentPostId() returns string | number | null.
	 * This selector normalizes the value so consumers don't need to
	 * handle the string case individually.
	 */
	getCurrentPostId: createRegistrySelector((select) => (): number | null => {
		const id = select(editorStore).getCurrentPostId();
		if (typeof id === 'number') {
			return id;
		}
		if (typeof id === 'string' && id.length > 0) {
			const num = Number(id);
			return Number.isFinite(num) ? num : null;
		}
		return null;
	}),
};

/**
 * Store resolvers — auto-fetch data on first selector access.
 */
const resolvers = {
	/**
	 * Resolver for getMcpStatus — fetches status from the API on first access.
	 *
	 * @return Thunk action.
	 */
	getMcpStatus:
		() =>
		async ({ dispatch }: StoreThunkArgs) => {
			dispatch(actions.refreshStatus());
		},
};

/**
 * The Redux store instance.
 */
const store = createReduxStore(STORE_NAME, {
	reducer,
	actions,
	selectors,
	resolvers,
});

register(store);

export default store;
