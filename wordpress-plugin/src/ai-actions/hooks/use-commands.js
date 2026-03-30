/**
 * Custom hook for AI command management.
 *
 * Provides reactive access to the command queue state, including
 * the active command, submission status, and command history.
 * Automatically polls for updates while a command is active.
 */

/* global window */

/**
 * WordPress dependencies
 */
import { useEffect, useCallback } from '@wordpress/element';
import { useSelect, useDispatch } from '@wordpress/data';

/**
 * Internal dependencies
 */
import { STORE_NAME } from '../store';

/**
 * Polling interval for active command updates (milliseconds).
 *
 * @type {number}
 */
const COMMAND_POLL_INTERVAL = 3000;

/**
 * Hook that manages the command lifecycle for a given post.
 *
 * On mount, fetches any in-progress command for the post. While a
 * command is active, polls for status updates every 3 seconds.
 *
 * @param {number} postId The post ID to manage commands for.
 * @return {Object} Command state and actions: `activeCommand`, `isSubmitting`, `error`, `history`, `submit( prompt, args )`, and `cancel( id )`.
 */
export function useCommands(postId) {
	const { activeCommand, isSubmitting, error, history } = useSelect(
		(select) => {
			const store = select(STORE_NAME);

			return {
				activeCommand: store.getActiveCommand(),
				isSubmitting: store.isSubmitting(),
				error: store.getCommandError(),
				history: store.getCommandHistory(),
			};
		},
		[]
	);

	const {
		submitCommand,
		cancelCommand,
		fetchActiveCommand,
		pollActiveCommand,
	} = useDispatch(STORE_NAME);

	// Fetch any in-progress command on mount or when postId changes.
	useEffect(() => {
		if (postId) {
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
		(prompt, args) => {
			submitCommand(prompt, postId, args);
		},
		[submitCommand, postId]
	);

	const cancel = useCallback(
		(id) => {
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
