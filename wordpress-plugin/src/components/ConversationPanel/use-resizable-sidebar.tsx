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
import type { ReactNode, RefCallback } from 'react';
import { __ } from '@wordpress/i18n';

const STORAGE_KEY = 'wpce:conversation-sidebar-width';
const HANDLE_HALF_WIDTH = 3;
const WIDTH_PROPS = ['width', 'flexBasis', 'maxWidth', 'minWidth'] as const;

export const MIN_WIDTH = 280;
export const DEFAULT_WIDTH = 280;

function getMaxWidth(): number {
	if (typeof window === 'undefined') {
		return MIN_WIDTH;
	}
	return Math.max(MIN_WIDTH, Math.floor(window.innerWidth * 0.8));
}

function clampWidth(width: number, max = getMaxWidth()): number {
	return Math.min(max, Math.max(MIN_WIDTH, width));
}

function readStoredWidth(): number {
	if (typeof window === 'undefined') {
		return DEFAULT_WIDTH;
	}
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
	if (typeof window === 'undefined') {
		return;
	}
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
	const [skeletonBody, setSkeletonBody] = useState<HTMLElement | null>(null);

	// Elements we're managing, for the belt-and-braces unmount cleanup.
	const appliedRef = useRef<HTMLElement[]>([]);
	// Portalled handle DOM, so pointermove can reposition it in lockstep
	// with the skeleton during a drag without waiting for React state.
	const handleRef = useRef<HTMLDivElement | null>(null);

	useLayoutEffect(() => {
		const { complementary, skeleton, body } =
			resolveAncestors(containerNode);

		setSkeletonBody((current) => (current === body ? current : body));

		if (!isActive) {
			return;
		}

		const targets: HTMLElement[] = [skeleton, complementary].filter(
			(node): node is HTMLElement => node !== null
		);
		if (targets.length === 0) {
			return;
		}
		applyWidth(targets, width);
		if (complementary) {
			complementary.style.position = 'relative';
		}
		appliedRef.current = targets;
		return () => {
			clearWidth(targets);
			if (complementary) {
				complementary.style.position = '';
			}
			appliedRef.current = [];
		};
	}, [containerNode, isActive, width]);

	// If Gutenberg tears down the PluginSidebar before our main effect's
	// cleanup fires, restore every element we ever touched.
	useEffect(() => {
		return () => {
			const nodes = appliedRef.current;
			clearWidth(nodes);
			for (const node of nodes) {
				node.style.position = '';
			}
			appliedRef.current = [];
			handleRef.current = null;
		};
	}, []);

	const onPointerDown = useCallback(
		(event: React.PointerEvent<HTMLDivElement>) => {
			if (event.button !== 0) {
				return;
			}
			// Re-resolve from the live DOM so the handler can't capture
			// stale refs after a sidebar re-mount.
			const { complementary, skeleton } = resolveAncestors(containerNode);
			const targets: HTMLElement[] = [skeleton, complementary].filter(
				(node): node is HTMLElement => node !== null
			);
			if (targets.length === 0) {
				return;
			}
			event.preventDefault();

			// Pointer capture keeps pointermove flowing even when the cursor
			// drags across Gutenberg's editor iframe, which otherwise
			// swallows pointer events going to the outer document.
			const handleEl = event.currentTarget;
			handleEl.setPointerCapture(event.pointerId);

			const startX = event.clientX;
			const startWidth = width;
			const maxWidth = getMaxWidth();
			const capturedPointerId = event.pointerId;
			let nextWidth = startWidth;

			const handleMove = (moveEvent: PointerEvent) => {
				if (moveEvent.pointerId !== capturedPointerId) {
					return;
				}
				// Sidebar is on the right: dragging left (negative delta)
				// grows the width.
				const delta = moveEvent.clientX - startX;
				nextWidth = clampWidth(startWidth - delta, maxWidth);
				applyWidth(targets, nextWidth);
				if (handleRef.current) {
					handleRef.current.style.right = `${
						nextWidth - HANDLE_HALF_WIDTH
					}px`;
				}
			};

			const prevUserSelect = document.body.style.userSelect;
			document.body.style.userSelect = 'none';

			const handleUp = (upEvent: PointerEvent) => {
				if (upEvent.pointerId !== capturedPointerId) {
					return;
				}
				handleEl.removeEventListener('pointermove', handleMove);
				handleEl.removeEventListener('pointerup', handleUp);
				handleEl.removeEventListener('pointercancel', handleUp);
				if (handleEl.hasPointerCapture(capturedPointerId)) {
					handleEl.releasePointerCapture(capturedPointerId);
				}
				document.body.style.userSelect = prevUserSelect;
				setWidth(nextWidth);
				writeStoredWidth(nextWidth);
			};

			handleEl.addEventListener('pointermove', handleMove);
			handleEl.addEventListener('pointerup', handleUp);
			handleEl.addEventListener('pointercancel', handleUp);
		},
		[containerNode, width]
	);

	const handle =
		isActive && skeletonBody
			? createPortal(
					<div
						ref={handleRef}
						role="separator"
						aria-orientation="vertical"
						aria-label={__(
							'Resize sidebar',
							'claudaborative-editing'
						)}
						className="wpce-conversation-panel__resize-handle"
						style={{ right: `${width - HANDLE_HALF_WIDTH}px` }}
						onPointerDown={onPointerDown}
					/>,
					skeletonBody
				)
			: null;

	return { containerRef, handle };
}
