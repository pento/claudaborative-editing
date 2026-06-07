/**
 * Build-time-guarded test hatch that exposes the command-sync Y.Doc and
 * Awareness on `window.__wpceTest__` for bridging a fake MCP peer into.
 * Only imported when `process.env.WPCE_TEST_HATCH` folds to `'true'` at
 * build time; production builds dead-code-eliminate the import call site
 * entirely.
 */

/**
 * WordPress dependencies
 */
import { Y, Awareness } from '@wordpress/sync';
// y-protocols is pinned to an exact version (no caret) in
// wordpress-plugin/package.json devDependencies, matching the version
// @wordpress/sync resolves, so the bundled awareness codec stays
// wire-compatible with Gutenberg's runtime copy and test builds don't
// silently break if @wordpress/sync narrows the transitive. Bundled into the
// test-hatch chunk at build time; its own `yjs` import is externalized to
// wp.sync.Y (see webpack.config.js) so it shares the one Yjs instance.
import {
	encodeAwarenessUpdate,
	applyAwarenessUpdate,
} from 'y-protocols/awareness';

/**
 * Internal dependencies
 */
// eslint-disable-next-line camelcase -- name is load-bearing for grep-ability
import { __getInternals_UNSAFE_FOR_TESTS } from './sync/command-sync';

type YDoc = InstanceType<typeof Y.Doc>;
type YAwareness = InstanceType<typeof Awareness>;

export interface WpceTestHatch {
	getCommandDoc(): YDoc | null;
	getCommandAwareness(): YAwareness | null;
	waitForCommandDoc(
		timeoutMs?: number
	): Promise<{ doc: YDoc; awareness: YAwareness }>;
	// Y.js primitives the fake-MCP helper uses to construct a peer Y.Doc +
	// Awareness inside the page. `Y` and `Awareness` are @wordpress/sync's
	// own exports — the real runtime instances — so the helper reuses them
	// instead of bundling a second Yjs (the duplicate-Yjs-instance trap the
	// project pins yjs to avoid). `encodeAwarenessUpdate` /
	// `applyAwarenessUpdate` are NOT re-exported by @wordpress/sync, so these
	// two are a separate bundled copy from `y-protocols`; safe because the
	// awareness codec is stateless and never constructs or compares Y types,
	// and its own `import * as Y from 'yjs'` is mapped to `wp.sync.Y` by a
	// webpack external (see webpack.config.js) so even that copy shares the
	// one Yjs instance.
	Y: typeof Y;
	Awareness: typeof Awareness;
	encodeAwarenessUpdate: typeof encodeAwarenessUpdate;
	applyAwarenessUpdate: typeof applyAwarenessUpdate;
	fakeMcpAttached: boolean;
}

declare global {
	interface Window {
		__wpceTest__?: WpceTestHatch;
	}
}

const POLL_INTERVAL_MS = 50;
const DEFAULT_TIMEOUT_MS = 30_000;

export function installTestHatch(): void {
	// Prevent accidental double-installation.
	if (window.__wpceTest__) {
		return;
	}

	const hatch: WpceTestHatch = {
		getCommandDoc() {
			return __getInternals_UNSAFE_FOR_TESTS().commandDoc;
		},
		getCommandAwareness() {
			return __getInternals_UNSAFE_FOR_TESTS().commandAwareness;
		},
		waitForCommandDoc(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
			return new Promise((resolve, reject) => {
				const start = Date.now();
				const check = () => {
					const { commandDoc, commandAwareness } =
						__getInternals_UNSAFE_FOR_TESTS();
					if (commandDoc && commandAwareness) {
						resolve({
							doc: commandDoc,
							awareness: commandAwareness,
						});
						return;
					}
					if (Date.now() - start >= timeoutMs) {
						reject(
							new Error(
								`[wpce test-hatch] waitForCommandDoc timed out after ${timeoutMs}ms`
							)
						);
						return;
					}
					setTimeout(check, POLL_INTERVAL_MS);
				};
				check();
			});
		},
		Y,
		Awareness,
		encodeAwarenessUpdate,
		applyAwarenessUpdate,
		fakeMcpAttached: false,
	};

	window.__wpceTest__ = hatch;
}
