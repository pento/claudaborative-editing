/**
 * Hook that makes the ConversationPanel's PluginSidebar resizable.
 *
 * PluginSidebar has no width prop, so we size three Gutenberg
 * InterfaceSkeleton ancestors of our panel:
 *
 * - `.interface-interface-skeleton__sidebar` + `.interface-complementary-area`
 *   both receive the chosen width (flex layout + fixed-width override).
 * - `.interface-interface-skeleton__body` hosts a portalled resize handle
 *   that can straddle the seam between editor and sidebar without being
 *   clipped by the skeleton sidebar's overflow.
 *
 * Width is persisted to localStorage and restored on next mount.
 */

import {
	createPortal,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from '@wordpress/element';
import type {
	KeyboardEvent as ReactKeyboardEvent,
	PointerEvent as ReactPointerEvent,
	ReactNode,
	RefCallback,
} from 'react';
import { __ } from '@wordpress/i18n';

const STORAGE_KEY = 'wpce:conversation-sidebar-width';
const HANDLE_HALF_WIDTH = 3;
const KEYBOARD_STEP = 20;
const WIDTH_PROPS = ['width', 'flexBasis', 'maxWidth', 'minWidth'] as const;
const HANDLE_SLOT_CLASS = 'wpce-conversation-panel__resize-handle-slot';

export const MIN_WIDTH = 280;
export const DEFAULT_WIDTH = 280;

function getMaxWidth(): number {
	return Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.8));
}

function clampWidth(width: number, max = getMaxWidth()): number {
	return Math.min(max, Math.max(MIN_WIDTH, width));
}

/**
 * Tracks the current max-width derived from `window.innerWidth`. Gutenberg
 * doesn't ship a useViewportWidth hook (`useViewportMatch` is
 * breakpoint-only, `useResizeObserver` targets a specific element), so we
 * subscribe to `window.resize` directly.
 */
function useViewportMaxWidth(): number {
	const [maxWidth, setMaxWidth] = useState<number>(() => getMaxWidth());
	useEffect(() => {
		function handleResize(): void {
			const next = getMaxWidth();
			setMaxWidth((current) => (current === next ? current : next));
		}
		window.addEventListener('resize', handleResize);
		return () => window.removeEventListener('resize', handleResize);
	}, []);
	return maxWidth;
}

function readStoredWidth(): number {
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (raw === null) {
			return DEFAULT_WIDTH;
		}
		const value = Number(raw);
		if (!Number.isFinite(value) || value <= 0) {
			return DEFAULT_WIDTH;
		}
		return clampWidth(value);
	} catch {
		return DEFAULT_WIDTH;
	}
}

function writeStoredWidth(width: number): void {
	try {
		window.localStorage.setItem(STORAGE_KEY, String(width));
	} catch {
		// Safari private mode and some quota-exhausted states throw on write.
	}
}

interface Ancestors {
	complementary: HTMLElement | null;
	skeleton: HTMLElement | null;
	body: HTMLElement | null;
}

function resolveAncestors(el: HTMLElement | null): Ancestors {
	if (!el) {
		return { complementary: null, skeleton: null, body: null };
	}
	return {
		complementary: el.closest<HTMLElement>('.interface-complementary-area'),
		skeleton: el.closest<HTMLElement>(
			'.interface-interface-skeleton__sidebar'
		),
		body: el.closest<HTMLElement>('.interface-interface-skeleton__body'),
	};
}

function applyWidth(nodes: HTMLElement[], width: number): void {
	const value = `${width}px`;
	for (const node of nodes) {
		for (const prop of WIDTH_PROPS) {
			node.style[prop] = value;
		}
	}
}

function clearWidth(nodes: HTMLElement[]): void {
	for (const node of nodes) {
		for (const prop of WIDTH_PROPS) {
			node.style[prop] = '';
		}
	}
}

interface ResizableSidebar {
	containerRef: RefCallback<HTMLDivElement>;
	handle: ReactNode;
}

export function useResizableSidebar(isActive: boolean): ResizableSidebar {
	// Callback ref + state: Gutenberg's Slot can mount our Fill's children in
	// a later commit than our own mount. A plain `useRef` wouldn't re-run
	// the layout effect when that late attach finally happens.
	const [containerNode, setContainerNode] = useState<HTMLDivElement | null>(
		null
	);
	const containerRef = useCallback<RefCallback<HTMLDivElement>>((node) => {
		setContainerNode(node);
	}, []);
	const [width, setWidth] = useState<number>(() => readStoredWidth());
	const maxWidth = useViewportMaxWidth();
	// Portal target = a small wrapper we insert as `__sidebar`'s previous
	// sibling inside `__body`. Putting it there means keyboard tab order
	// reaches the handle before the sidebar content (otherwise it'd come
	// last, after every control inside the panel).
	const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
	const wrapperRef = useRef<HTMLDivElement | null>(null);
	// Stores the current drag's teardown so we can run it from any exit
	// path (pointerup, pointercancel, lostpointercapture, or component
	// unmount) without leaving `userSelect: none` stuck on the body.
	const dragCleanupRef = useRef<(() => void) | null>(null);

	// If the viewport shrinks below the stored width, clamp down so we
	// never display a sidebar wider than the allowed maximum.
	useEffect(() => {
		setWidth((current) => {
			const clamped = clampWidth(current, maxWidth);
			return clamped === current ? current : clamped;
		});
	}, [maxWidth]);

	useLayoutEffect(() => {
		const { complementary, skeleton, body } =
			resolveAncestors(containerNode);

		// Gutenberg always renders both wrappers together; if either is
		// missing (unexpected layout change) we bail instead of applying a
		// half-baked style.
		if (!isActive || !skeleton || !complementary || !body) {
			// Sidebar closed mid-drag — tear down the in-progress drag so
			// `document.body.style.userSelect` doesn't stay stuck at 'none'.
			dragCleanupRef.current?.();
			if (wrapperRef.current) {
				wrapperRef.current.remove();
			}
			setPortalTarget(null);
			return;
		}

		if (!wrapperRef.current) {
			wrapperRef.current = document.createElement('div');
			wrapperRef.current.className = HANDLE_SLOT_CLASS;
		}
		// Only (re)insert if the wrapper isn't already in the right spot.
		// insertBefore on a node already at its target position still
		// detaches and re-attaches, which drops focus from any
		// descendant — so pressing arrow keys on the handle would move
		// the sidebar one step and then lose focus.
		const alreadyPositioned =
			wrapperRef.current.parentNode === body &&
			wrapperRef.current.nextSibling === skeleton;
		if (!alreadyPositioned) {
			body.insertBefore(wrapperRef.current, skeleton);
		}
		setPortalTarget((current) =>
			current === wrapperRef.current ? current : wrapperRef.current
		);

		const targets: HTMLElement[] = [skeleton, complementary];
		applyWidth(targets, width);
		complementary.style.position = 'relative';
		return () => {
			clearWidth(targets);
			complementary.style.position = '';
		};
	}, [containerNode, isActive, width]);

	// Tear down the wrapper and any in-progress drag on final unmount.
	// The drag cleanup restores `userSelect` if we never received a
	// pointerup/cancel (e.g. the sidebar closed mid-drag).
	useEffect(() => {
		return () => {
			dragCleanupRef.current?.();
			wrapperRef.current?.remove();
			wrapperRef.current = null;
		};
	}, []);

	const onPointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			if (event.button !== 0) {
				return;
			}
			// Re-resolve from the live DOM so the handler can't capture
			// stale refs after a sidebar re-mount.
			const { complementary, skeleton } = resolveAncestors(containerNode);
			if (!skeleton || !complementary) {
				return;
			}
			const targets: HTMLElement[] = [skeleton, complementary];
			event.preventDefault();

			// Pointer capture keeps pointermove flowing even when the cursor
			// drags across Gutenberg's editor iframe, which otherwise
			// swallows pointer events going to the outer document.
			const handleEl = event.currentTarget;
			handleEl.setPointerCapture(event.pointerId);

			const startX = event.clientX;
			const startWidth = width;
			const capturedPointerId = event.pointerId;
			const capturedMaxWidth = maxWidth;
			let nextWidth = startWidth;

			const handleMove = (moveEvent: PointerEvent) => {
				if (moveEvent.pointerId !== capturedPointerId) {
					return;
				}
				// Sidebar is on the right: dragging left (negative delta)
				// grows the width.
				const delta = moveEvent.clientX - startX;
				nextWidth = clampWidth(startWidth - delta, capturedMaxWidth);
				applyWidth(targets, nextWidth);
				handleEl.style.right = `${nextWidth - HANDLE_HALF_WIDTH}px`;
			};

			const prevUserSelect = document.body.style.userSelect;
			document.body.style.userSelect = 'none';

			// One teardown fn shared by pointerup, pointercancel,
			// lostpointercapture, and the unmount path. The ref lets the
			// unmount effect restore `userSelect` if we never got a
			// pointerup/cancel (e.g. sidebar closes mid-drag). All event
			// listeners are removed atomically, so there's no valid path
			// to a second call.
			const dispose = (commit: boolean) => {
				handleEl.removeEventListener('pointermove', handleMove);
				handleEl.removeEventListener('pointerup', handleUp);
				handleEl.removeEventListener('pointercancel', handleCancel);
				handleEl.removeEventListener(
					'lostpointercapture',
					handleLostCapture
				);
				if (handleEl.hasPointerCapture(capturedPointerId)) {
					handleEl.releasePointerCapture(capturedPointerId);
				}
				document.body.style.userSelect = prevUserSelect;
				if (commit) {
					setWidth(nextWidth);
					writeStoredWidth(nextWidth);
				} else {
					// Revert DOM to pre-drag state so it matches React
					// state and ARIA — otherwise the user would see the
					// sidebar snap back on the next render.
					applyWidth(targets, startWidth);
					handleEl.style.right = `${startWidth - HANDLE_HALF_WIDTH}px`;
				}
				dragCleanupRef.current = null;
			};

			const handleUp = (upEvent: PointerEvent) => {
				if (upEvent.pointerId !== capturedPointerId) {
					return;
				}
				dispose(true);
			};
			// `pointercancel` means the gesture was aborted (OS gesture,
			// browser cancellation, etc.), so we shouldn't commit the
			// in-progress width.
			const handleCancel = (cancelEvent: PointerEvent) => {
				if (cancelEvent.pointerId !== capturedPointerId) {
					return;
				}
				dispose(false);
			};
			const handleLostCapture = () => dispose(false);

			dragCleanupRef.current = () => dispose(false);
			handleEl.addEventListener('pointermove', handleMove);
			handleEl.addEventListener('pointerup', handleUp);
			handleEl.addEventListener('pointercancel', handleCancel);
			handleEl.addEventListener('lostpointercapture', handleLostCapture);
		},
		[containerNode, width, maxWidth]
	);

	const onKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLDivElement>) => {
			// Arrow keys nudge by one step; Home/End jump to the extremes.
			// Left grows the sidebar (matches the drag direction: pulling
			// the seam leftward widens the panel).
			let next: number | null = null;
			switch (event.key) {
				case 'ArrowLeft':
					next = width + KEYBOARD_STEP;
					break;
				case 'ArrowRight':
					next = width - KEYBOARD_STEP;
					break;
				case 'Home':
					next = MIN_WIDTH;
					break;
				case 'End':
					next = maxWidth;
					break;
			}
			if (next === null) {
				return;
			}
			event.preventDefault();
			const clamped = clampWidth(next, maxWidth);
			setWidth(clamped);
			writeStoredWidth(clamped);
		},
		[width, maxWidth]
	);

	const handle =
		isActive && portalTarget
			? createPortal(
					// A focusable resize separator is interactive per ARIA 1.2
					// (aria-valuenow/min/max make it behave like a slider); the
					// jsx-a11y rule flags `role="separator"` as non-interactive.
					// eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
					<div
						role="separator"
						aria-orientation="vertical"
						aria-label={__(
							'Resize sidebar',
							'claudaborative-editing'
						)}
						aria-valuenow={width}
						aria-valuemin={MIN_WIDTH}
						aria-valuemax={maxWidth}
						tabIndex={0}
						className="wpce-conversation-panel__resize-handle"
						style={{ right: `${width - HANDLE_HALF_WIDTH}px` }}
						onPointerDown={onPointerDown}
						onKeyDown={onKeyDown}
					/>,
					portalTarget
				)
			: null;

	return { containerRef, handle };
}
