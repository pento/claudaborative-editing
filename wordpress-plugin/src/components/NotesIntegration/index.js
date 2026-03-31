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
import { __ } from '@wordpress/i18n';
import { Button } from '@wordpress/components';
import { useSelect, useDispatch } from '@wordpress/data';
import { useState, useEffect, createPortal } from '@wordpress/element';

/**
 * Internal dependencies
 */
import { useMcpStatus } from '../../hooks/use-mcp-status';
import { STORE_NAME } from '../../store';
import SparkleIcon from '../SparkleIcon';

import './style.scss';

/**
 * Extract the numeric note/thread ID from a thread element's id attribute.
 * Thread elements have id="comment-thread-{noteId}".
 *
 * @param {Element} threadEl The thread DOM element.
 * @return {number|null} The note ID, or null if not found.
 */
function getThreadNoteId(threadEl) {
	const match = /^comment-thread-(\d+)$/.exec(threadEl.id);
	return match ? parseInt(match[1], 10) : null;
}

/**
 * NotesIntegration component.
 *
 * Always mounted. Observes the DOM for Gutenberg's notes sidebar
 * panels and injects action buttons.
 *
 * @return {import('react').ReactElement|null} Portals or null.
 */
export default function NotesIntegration() {
	const { mcpConnected } = useMcpStatus();

	const postId = useSelect(
		(select) => select('core/editor').getCurrentPostId(),
		[]
	);

	const activeCommand = useSelect(
		(select) => select(STORE_NAME).getActiveCommand(),
		[]
	);

	const { submitCommand } = useDispatch(STORE_NAME);

	const isDisabled = !mcpConnected || activeCommand !== null;
	const isProcessing = activeCommand !== null;

	// Track DOM elements for portals. A revision counter forces
	// re-renders when sidebar DOM changes (e.g., a thread expands
	// and its comment-status element appears).
	const [panelEls, setPanelEls] = useState([]);
	const [, setRevision] = useState(0);

	useEffect(() => {
		const arraysEqual = (a, b) =>
			a.length === b.length && a.every((el, i) => el === b[i]);

		const scan = () => {
			const panels = Array.from(
				document.querySelectorAll('.editor-collab-sidebar-panel')
			);
			setPanelEls((prev) => (arraysEqual(prev, panels) ? prev : panels));

			// Bump revision so the render loop re-checks thread elements
			// even when the thread list itself hasn't changed (e.g., a
			// thread expanded and its status HStack appeared).
			setRevision((r) => r + 1);
		};

		scan();

		const observer = new window.MutationObserver(scan);
		observer.observe(document.body, { childList: true, subtree: true });

		return () => observer.disconnect();
	}, []);

	const portals = [];

	// "Respond to All Notes" button pinned at the top of each panel
	for (const panel of panelEls) {
		let container = panel.querySelector('.wpce-notes-respond-all');
		if (!container) {
			container = document.createElement('div');
			container.className = 'wpce-notes-respond-all';
			panel.prepend(container);
		}

		portals.push(
			createPortal(
				<Button
					className="wpce-notes-respond-all-button"
					variant="secondary"
					disabled={isDisabled}
					onClick={() => submitCommand('respond-to-notes', postId)}
				>
					<SparkleIcon size={18} processing={isProcessing} />
					{__('Address All Notes', 'claudaborative-editing')}
				</Button>,
				container
			)
		);
	}

	// Per-note sparkle button on each root thread.
	// Queried fresh each render (driven by revision counter) so we
	// pick up threads that have just expanded their status HStack.
	const threadEls = document.querySelectorAll(
		'.editor-collab-sidebar-panel > .editor-collab-sidebar-panel__thread'
	);
	for (const threadEl of threadEls) {
		const noteId = getThreadNoteId(threadEl);
		if (!noteId) {
			continue;
		}

		// Find the inner HStack inside the first comment-status
		const statusEl = threadEl.querySelector(
			'.editor-collab-sidebar-panel__comment-status'
		);
		if (!statusEl) {
			continue;
		}

		// The HStack is the first child element of the comment-status FlexItem
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

		portals.push(
			createPortal(
				<Button
					className="wpce-notes-ask-claude-button"
					variant="tertiary"
					size="small"
					disabled={isDisabled}
					onClick={() =>
						submitCommand('respond-to-note', postId, { noteId })
					}
					label={__('Address This Note', 'claudaborative-editing')}
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
