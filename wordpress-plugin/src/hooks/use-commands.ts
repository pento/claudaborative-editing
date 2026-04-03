/**
 * Custom hook for AI command management.
 *
 * Provides reactive access to the command queue state, including
 * the active command, submission status, and command history.
 * Automatically polls for updates while a command is active.
 */

/**
 * WordPress dependencies
 */
import { useEffect, useCallback } from '@wordpress/element';
import { useSelect, useDispatch } from '@wordpress/data';

/**
 * Internal dependencies
 */
import type { CommandSlug } from '#shared/commands';
import store from '../store';
import type { Command } from '../store/types';

/**
 * Polling interval for active command updates (milliseconds).
 */
const COMMAND_POLL_INTERVAL = 3000;

/**
 * Return type for the useCommands hook.
 */
export interface UseCommandsReturn {
	activeCommand: Command | null;
	isSubmitting: boolean;
	error: string | null;
	history: Command[];
	submit: (prompt: CommandSlug, args?: Record<string, unknown>) => void;
	cancel: (id: number) => void;
}

/**
 * Hook that manages the command lifecycle for a given post.
 *
 * On mount, fetches any in-progress command for the post. While a
 * command is active, polls for status updates every 3 seconds.
 *
 * @param postId The post ID to manage commands for.
 * @return Command state and actions: `activeCommand`, `isSubmitting`, `error`, `history`, `submit( prompt, args )`, and `cancel( id )`.
 */
export function useCommands(postId: number | null): UseCommandsReturn {
	const { activeCommand, isSubmitting, error, history } = useSelect(
		(select) => {
			const s = select(store);

			return {
				activeCommand: s.getActiveCommand(),
				isSubmitting: s.isSubmitting(),
				error: s.getCommandError(),
				history: s.getCommandHistory(),
			};
		},
		[]
	);

	const {
		submitCommand,
		cancelCommand,
		fetchActiveCommand,
		pollActiveCommand,
	} = useDispatch(store);

	// Fetch any in-progress command when postId becomes available.
	useEffect(() => {
		if (postId !== null) {
			fetchActiveCommand(postId);
		}
	}, [postId, fetchActiveCommand]);

	// Poll for active command updates while one is running.
	// Use a boolean dependency to avoid tearing down/recreating the
	// interval on every poll response (activeCommand is a new object ref
	// each time UPDATE_ACTIVE_COMMAND fires).
	const hasActiveCommand = activeCommand !== null;
	useEffect(() => {
		if (!hasActiveCommand) {
			return;
		}

		const intervalId = window.setInterval(() => {
			pollActiveCommand();
		}, COMMAND_POLL_INTERVAL);

		return () => {
			window.clearInterval(intervalId);
		};
	}, [hasActiveCommand, pollActiveCommand]);

	const submit = useCallback(
		(prompt: CommandSlug, args?: Record<string, unknown>) => {
			if (postId !== null) {
				submitCommand(prompt, postId, args);
			}
		},
		[submitCommand, postId]
	);

	const cancel = useCallback(
		(id: number) => {
			cancelCommand(id);
		},
		[cancelCommand]
	);

	return {
		activeCommand,
		isSubmitting,
		error,
		history,
		submit,
		cancel,
	};
}
