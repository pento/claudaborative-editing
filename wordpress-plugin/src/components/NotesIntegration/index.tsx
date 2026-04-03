/**
 * Notes integration component.
 *
 * Injects buttons into Gutenberg's collaboration/notes sidebar:
 * - "Respond to All Notes" button pinned at the top of the notes panel
 * - Per-note sparkle button on each root thread's action bar
 *
 * Uses MutationObserver to track sidebar DOM changes since Gutenberg
 * does not provide public SlotFills for the notes sidebar content.
 */

/**
 * WordPress dependencies
 */
import { Button } from '@wordpress/components';
import { useSelect, useDispatch } from '@wordpress/data';
import { useState, useEffect, createPortal } from '@wordpress/element';
import type { ReactPortal } from 'react';

/**
 * Internal dependencies
 */
import { useMcpStatus } from '../../hooks/use-mcp-status';
import { getCommandLabel } from '../../utils/command-i18n';
import aiActionsStore from '../../store';
import SparkleIcon from '../SparkleIcon';

import './style.scss';

/**
 * Extract the numeric note/thread ID from a thread element's id attribute.
 * Thread elements have id="comment-thread-{noteId}".
 *
 * @param threadEl The thread DOM element.
 * @return The note ID, or null if not found.
 */
function getThreadNoteId(threadEl: Element): number | null {
	const match = /^comment-thread-(\d+)$/.exec(threadEl.id);
	return match ? parseInt(match[1], 10) : null;
}

interface ContainersState {
	panels: Element[];
	threads: Array<{ noteId: number; container: Element }>;
}

/**
 * NotesIntegration component.
 *
 * Always mounted. Observes the DOM for Gutenberg's notes sidebar
 * panels and injects action buttons.
 *
 * @return Portals or null.
 */
export default function NotesIntegration() {
	const { mcpConnected } = useMcpStatus();

	const { postId, activeCommand } = useSelect((select) => {
		const s = select(aiActionsStore);
		return {
			postId: s.getCurrentPostId(),
			activeCommand: s.getActiveCommand(),
		};
	}, []);

	const { submitCommand } = useDispatch(aiActionsStore);

	const isDisabled =
		!mcpConnected || postId === null || activeCommand !== null;
	const isProcessing = activeCommand !== null;

	// Track sidebar panel elements and a revision counter that
	// forces re-scanning when DOM changes within existing panels
	// (e.g., a thread expands and its status HStack appears).
	const [panelEls, setPanelEls] = useState<Element[]>([]);
	const [revision, setRevision] = useState<number>(0);

	// Portal containers created by effects (not during render,
	// since Gutenberg DOM is React-managed).
	const [containers, setContainers] = useState<ContainersState>({
		panels: [],
		threads: [],
	});

	// Observe DOM for sidebar panel elements.
	useEffect(() => {
		const arraysEqual = (a: Element[], b: Element[]): boolean =>
			a.length === b.length && a.every((el, i) => el === b[i]);

		const scan = () => {
			const panels = Array.from(
				document.querySelectorAll('.editor-collab-sidebar-panel')
			);
			setPanelEls((prev) => (arraysEqual(prev, panels) ? prev : panels));

			// Only bump revision when the notes sidebar is open to avoid
			// unnecessary re-renders from unrelated DOM mutations.
			if (panels.length > 0) {
				setRevision((r) => r + 1);
			}
		};

		scan();

		const observer = new window.MutationObserver(scan);
		observer.observe(document.body, { childList: true, subtree: true });

		return () => observer.disconnect();
	}, []);

	// Create/find portal containers when sidebar DOM changes.
	// Runs as an effect (not during render) because we're injecting
	// into React-managed DOM owned by Gutenberg.
	useEffect(() => {
		// Panel containers for "Address All Notes" buttons
		const panelResults = panelEls.map((panel) => {
			let container = panel.querySelector('.wpce-notes-respond-all');
			if (!container) {
				container = document.createElement('div');
				container.className = 'wpce-notes-respond-all';
				panel.prepend(container);
			}
			return container;
		});

		// Thread containers for per-note sparkle buttons
		const threadResults: Array<{ noteId: number; container: Element }> = [];
		const threadEls = document.querySelectorAll(
			'.editor-collab-sidebar-panel > .editor-collab-sidebar-panel__thread'
		);
		for (const threadEl of threadEls) {
			const noteId = getThreadNoteId(threadEl);
			if (!noteId) {
				continue;
			}

			const statusEl = threadEl.querySelector(
				'.editor-collab-sidebar-panel__comment-status'
			);
			if (!statusEl) {
				continue;
			}

			const hstack = statusEl.firstElementChild;
			if (!hstack) {
				continue;
			}

			let container = hstack.querySelector('.wpce-notes-ask-claude');
			if (!container) {
				container = document.createElement('div');
				container.className = 'wpce-notes-ask-claude';
				hstack.prepend(container);
			}
			threadResults.push({ noteId, container });
		}

		setContainers({ panels: panelResults, threads: threadResults });
	}, [panelEls, revision]);

	// Build portals from containers created by effects.
	const portals: ReactPortal[] = [];

	for (const container of containers.panels) {
		portals.push(
			createPortal(
				<Button
					className="wpce-notes-respond-all-button"
					variant="secondary"
					disabled={isDisabled}
					onClick={() => {
						if (postId !== null) {
							submitCommand('respond-to-notes', postId);
						}
					}}
				>
					<SparkleIcon size={18} processing={isProcessing} />
					{getCommandLabel('respond-to-notes')}
				</Button>,
				container
			)
		);
	}

	for (const { noteId, container } of containers.threads) {
		portals.push(
			createPortal(
				<Button
					className="wpce-notes-ask-claude-button"
					variant="tertiary"
					size="small"
					disabled={isDisabled}
					onClick={() => {
						if (postId !== null) {
							submitCommand('respond-to-note', postId, {
								noteId,
							});
						}
					}}
					label={getCommandLabel('respond-to-note')}
				>
					<SparkleIcon size={16} processing={isProcessing} />
				</Button>,
				container
			)
		);
	}

	if (portals.length === 0) {
		return null;
	}

	return <>{portals}</>;
}
