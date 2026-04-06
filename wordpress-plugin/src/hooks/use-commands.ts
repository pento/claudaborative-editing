/**
 * Custom hook for AI command management.
 *
 * Provides reactive access to the command queue state, including
 * the active command, submission status, and command history.
 * Uses Yjs sync observation for real-time updates from the MCP server.
 */

/**
 * WordPress dependencies
 */
import { useEffect, useCallback, useRef } from '@wordpress/element';
import { useSelect, useDispatch } from '@wordpress/data';

/**
 * Internal dependencies
 */
import type { CommandSlug } from '#shared/commands';
import store from '../store';
import { subscribeToCommandSync } from '../sync/command-sync';
import type { Command } from '../store/types';

/**
 * Return type for the useCommands hook.
 */
export interface UseCommandsReturn {
	activeCommand: Command | null;
	isSubmitting: boolean;
	isResponding: boolean;
	error: string | null;
	history: Command[];
	submit: (prompt: CommandSlug, args?: Record<string, unknown>) => void;
	cancel: (id: number) => void;
	respondToCommand: (commandId: number, message: string) => Promise<void>;
}

/**
 * Hook that manages the command lifecycle for a given post.
 *
 * On mount, fetches any in-progress command from REST (recovery after
 * page reload). Subsequent updates arrive via Yjs sync observation
 * instead of REST polling.
 *
 * @param postId The post ID to manage commands for.
 * @return Command state and actions.
 */
export function useCommands(postId: number | null): UseCommandsReturn {
	const { activeCommand, isSubmitting, isResponding, error, history } =
		useSelect((select) => {
			const s = select(store);

			return {
				activeCommand: s.getActiveCommand(),
				isSubmitting: s.isSubmitting(),
				isResponding: s.isResponding(),
				error: s.getCommandError(),
				history: s.getCommandHistory(),
			};
		}, []);

	const {
		submitCommand,
		cancelCommand,
		respondToCommand: dispatchRespondToCommand,
		fetchActiveCommand,
		handleSyncUpdate,
	} = useDispatch(store);

	// Fetch any in-progress command when postId becomes available.
	// This is a one-time REST fetch for recovery after page reload.
	useEffect(() => {
		if (postId !== null) {
			fetchActiveCommand(postId);
		}
	}, [postId, fetchActiveCommand]);

	// Subscribe to Yjs sync for real-time command updates from the MCP server.
	// Replaces the 3-second REST polling with Y.Map observation.
	const postIdRef = useRef(postId);
	postIdRef.current = postId;

	useEffect(() => {
		return subscribeToCommandSync((commands) => {
			handleSyncUpdate(commands, postIdRef.current);
		});
	}, [handleSyncUpdate]);

	const submit = useCallback(
		(prompt: CommandSlug, args?: Record<string, unknown>) => {
			if (postId !== null) {
				return submitCommand(prompt, postId, args);
			}
		},
		[submitCommand, postId]
	);

	const cancel = useCallback(
		(id: number) => {
			return cancelCommand(id);
		},
		[cancelCommand]
	);

	const respond = useCallback(
		(commandId: number, message: string) => {
			return dispatchRespondToCommand(commandId, message);
		},
		[dispatchRespondToCommand]
	);

	return {
		activeCommand,
		isSubmitting,
		isResponding,
		error,
		history,
		submit,
		cancel,
		respondToCommand: respond,
	};
}
