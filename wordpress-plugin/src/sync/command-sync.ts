/**
 * Command sync via core-data collection entity registration.
 *
 * Registers a custom `root/wpce_commands` entity with syncConfig so that
 * Gutenberg's polling manager includes the command room in its HTTP requests.
 * Uses collection sync (loadCollection) which creates a Y.Doc with a state
 * map. Both browser and MCP server read/write commands in the state map.
 *
 * The Y.Doc reference is captured via the syncConfig.createAwareness callback,
 * which receives the doc during loadCollection initialization.
 *
 * Gutenberg's polling manager pauses update queues for non-primary rooms.
 * In practice, the post room registers as primary before our command room.
 * A fetch interceptor injects our doc state when the queue is paused.
 */

/**
 * WordPress dependencies
 */
import { dispatch, resolveSelect } from '@wordpress/data';
import apiFetch from '@wordpress/api-fetch';
// eslint-disable-next-line import/no-extraneous-dependencies -- externalized by @wordpress/scripts
import { Y, Awareness } from '@wordpress/sync';
import { TERMINAL_STATUSES } from '#shared/commands';
import { store as coreDataStore } from '@wordpress/core-data';

/**
 * Internal dependencies
 */
import type { Command } from '../store/types';

// Types derived from the @wordpress/sync re-exports of Yjs.
type YDoc = InstanceType<typeof Y.Doc>;
type YMap = ReturnType<YDoc['getMap']>;
type YMapEvent = Y.YMapEvent<unknown>;

/** Whether the entity has been registered and sync started. */
let initialized = false;

/** Whether the fetch interceptor has been installed. */
let fetchInterceptorInstalled = false;

/** Captured Y.Doc from the collection sync initialization. */
let commandDoc: YDoc | null = null;

/** Captured Awareness instance from the collection sync initialization. */
let commandAwareness: InstanceType<typeof Awareness> | null = null;

/** The browserType value sent by the MCP server in awareness state. */
const MCP_BROWSER_TYPE = 'Claudaborative Editing MCP';

/** Interval ID for periodic stale command cleanup. */
let staleCleanupInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Get the state map from the captured Y.Doc.
 */
function getStateMap(): YMap | null {
	return commandDoc?.getMap('state') ?? null;
}

/**
 * Base64-encode a Uint8Array without spreading (avoids stack overflow
 * on large arrays from `String.fromCharCode(...arr)`).
 *
 * @param bytes The bytes to encode.
 */
function uint8ToBase64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return btoa(binary);
}

/**
 * Install a fetch interceptor that injects our Y.Doc state into
 * /wp-sync/v1/updates requests when the polling manager's queue is
 * paused (non-primary room). Only injects when the doc state has
 * changed since the last injection.
 */
function installFetchInterceptor(): void {
	if (fetchInterceptorInstalled) {
		return;
	}

	const origFetch = window.fetch;
	let lastInjectedStateVector = '';

	window.fetch = (async (...args: Parameters<typeof fetch>) => {
		const url =
			typeof args[0] === 'string'
				? args[0]
				: ((args[0] as Request)?.url ?? '');
		if (url.includes('wp-sync') && args[1]?.body && commandDoc) {
			try {
				const body = JSON.parse(args[1].body as string) as {
					rooms: Array<{
						room: string;
						updates: Array<{ type: string; data: string }>;
					}>;
				};
				const cmdRoom = body.rooms?.find(
					(r) => r.room === 'root/wpce_commands'
				);
				if (cmdRoom && cmdRoom.updates.length === 0) {
					const sv = uint8ToBase64(Y.encodeStateVector(commandDoc));
					if (sv !== lastInjectedStateVector) {
						const update = Y.encodeStateAsUpdateV2(commandDoc);
						cmdRoom.updates = [
							{
								type: 'compaction',
								data: uint8ToBase64(update),
							},
						];
						args[1] = {
							...args[1],
							body: JSON.stringify(body),
						};
						lastInjectedStateVector = sv;
					}
				}
			} catch {
				/* ignore parse errors */
			}
		}
		return origFetch(...args);
	}) as typeof fetch;

	fetchInterceptorInstalled = true;
}

/**
 * The syncConfig tells core-data how to handle the collection sync.
 * The key trick: createAwareness receives the Y.Doc, which we capture
 * for direct read/write access to the state map.
 */
const syncConfig = {
	applyChangesToCRDTDoc: () => {
		// Collection sync doesn't call this — it only bumps savedAt.
	},

	createAwareness: (ydoc: unknown) => {
		// Capture the Y.Doc reference for direct state map access.
		commandDoc = ydoc as YDoc;

		// Install the fetch interceptor to work around the paused queue.
		installFetchInterceptor();

		// Create a real Awareness instance so the polling manager populates
		// it with remote awareness states (used for MCP connection detection).
		// Use Awareness from @wordpress/sync to avoid duplicate Yjs instances.
		commandAwareness = new Awareness(commandDoc);
		return commandAwareness;
	},

	getChangesFromCRDTDoc: () => {
		// Collection sync doesn't call this.
		return {};
	},
};

/**
 * Initialize the command sync entity.
 *
 * Registers the entity with core-data and triggers collection sync via
 * getEntityRecords (plural) with per_page=-1. Call once during plugin
 * initialization.
 */
export function initCommandSync(): void {
	if (initialized) {
		return;
	}
	initialized = true;

	// Register the entity. addEntities is a public core-data action.
	dispatch(coreDataStore).addEntities([
		{
			kind: 'root',
			name: 'wpce_commands',
			baseURL: '/wpce/v1/sync-entity',
			baseURLParams: { context: 'edit' },
			plural: 'wpceCommands',
			syncConfig,
		},
	]);

	// Trigger the collection resolver, which starts collection sync.
	// getEntityRecords with per_page=-1 calls getSyncManager().loadCollection()
	// which creates the Y.Doc and registers room 'root/wpce_commands' with
	// the polling manager.
	void resolveSelect(coreDataStore).getEntityRecords(
		'root',
		'wpce_commands',
		{ per_page: -1 }
	);

	// Periodically validate commands in the Y.Doc against the REST API.
	// Stale data can persist from previous sessions since the sync server
	// stores Y.Doc state. This observer removes commands that no longer
	// exist or have reached a terminal status in the REST API.
	void startStaleCommandCleanup();
}

/**
 * Check for stale commands in the Y.Doc and remove them.
 * Runs once immediately, then every 30 seconds.
 * Validates against the REST API to ensure only active commands remain.
 */
async function startStaleCommandCleanup(): Promise<void> {
	// Wait for the doc to be available (timeout after ~30 seconds)
	const DOC_WAIT_INTERVAL_MS = 200;
	const DOC_WAIT_MAX_RETRIES = 150;
	await new Promise<void>((resolve) => {
		let retries = 0;
		const check = setInterval(() => {
			retries++;
			if (getStateMap() || retries >= DOC_WAIT_MAX_RETRIES) {
				clearInterval(check);
				resolve();
			}
		}, DOC_WAIT_INTERVAL_MS);
	});

	// If the doc never initialized, bail out
	if (!getStateMap()) return;

	// Clear any previous interval (e.g., from HMR re-initialization)
	if (staleCleanupInterval) {
		clearInterval(staleCleanupInterval);
		staleCleanupInterval = null;
	}

	const runCleanup = async () => {
		const stateMap = getStateMap();
		if (!stateMap) return;

		const commands = stateMap.get('commands') as
			| Record<string, unknown>
			| undefined;
		if (!commands || Object.keys(commands).length === 0) return;

		try {
			const apiCommands = await apiFetch<Command[]>({
				path: '/wpce/v1/commands',
			});
			const activeIds = new Set(
				apiCommands
					.filter((c) => !TERMINAL_STATUSES.includes(c.status))
					.map((c) => String(c.id))
			);

			const cleaned: Record<string, unknown> = {};
			let changed = false;
			for (const [id, value] of Object.entries(commands)) {
				if (activeIds.has(id)) {
					cleaned[id] = value;
				} else {
					changed = true;
				}
			}

			if (changed) {
				commandDoc?.transact(() => {
					stateMap.set('commands', cleaned);
					stateMap.set('savedAt', Date.now());
				});
			}
		} catch {
			// Best-effort
		}
	};

	// Run immediately, then every 30 seconds to catch data that
	// arrives from the sync server after init or becomes stale over time.
	await runCleanup();
	staleCleanupInterval = setInterval(() => void runCleanup(), 30_000);
}

/**
 * Write a command to the Y.Doc's state map.
 * Call after a successful REST API operation (submit, respond, cancel).
 *
 * @param command The command to write.
 */
export function writeCommandToSync(command: Command): void {
	const stateMap = getStateMap();
	if (!stateMap) return;

	// Read current commands, update the specific one, write back.
	const commands = {
		...((stateMap.get('commands') as Record<string, unknown> | undefined) ??
			{}),
	};

	if (TERMINAL_STATUSES.includes(command.status)) {
		// Remove terminal commands to prevent stale data persisting
		// in the Y.Doc after the CPT post is deleted.
		delete commands[String(command.id)];
	} else {
		commands[String(command.id)] = { ...command };
	}

	commandDoc?.transact(() => {
		stateMap.set('commands', commands);
		stateMap.set('savedAt', Date.now());
	});
}

/**
 * Remove a specific command from the Y.Doc's state map.
 *
 * @param commandId The command ID to remove.
 */
export function removeCommandFromSync(commandId: number): void {
	const stateMap = getStateMap();
	if (!stateMap) return;

	const commands = {
		...((stateMap.get('commands') as Record<string, unknown> | undefined) ??
			{}),
	};

	delete commands[String(commandId)];

	commandDoc?.transact(() => {
		stateMap.set('commands', commands);
		stateMap.set('savedAt', Date.now());
	});
}

/**
 * Get the current commands from the Y.Doc's state map.
 */
export function getCommandsFromSync(): Record<string, Command> {
	const stateMap = getStateMap();
	if (!stateMap) return {};

	return (stateMap.get('commands') as Record<string, Command>) ?? {};
}

/**
 * Subscribe to command changes from the Y.Doc's state map.
 * Returns an unsubscribe function.
 *
 * @param callback Called when commands change.
 */
export function subscribeToCommandSync(
	callback: (commands: Record<string, Command>) => void
): () => void {
	let observer: ((event: YMapEvent) => void) | null = null;
	let observedMap: YMap | null = null;

	// Poll until the doc is available (it's created async during loadCollection)
	const checkInterval = setInterval(() => {
		const stateMap = getStateMap();
		if (!stateMap) return;

		clearInterval(checkInterval);
		observedMap = stateMap;

		let prev = JSON.stringify(stateMap.get('commands'));

		observer = () => {
			const current = JSON.stringify(stateMap.get('commands'));
			if (current !== prev) {
				prev = current;
				callback(
					(stateMap.get('commands') as Record<string, Command>) ?? {}
				);
			}
		};

		stateMap.observe(observer);
	}, 100);

	return () => {
		clearInterval(checkInterval);
		if (observedMap && observer) {
			observedMap.unobserve(observer);
		}
	};
}

/**
 * Check whether the MCP server is connected by examining the awareness
 * state in the command room. The MCP server sends awareness with
 * browserType: 'Claudaborative Editing MCP'.
 */
export function isMcpConnected(): boolean {
	if (!commandAwareness) return false;

	const states = commandAwareness.getStates();
	for (const [clientId, state] of states) {
		// Skip our own client
		if (clientId === commandAwareness.clientID) continue;
		if (!state || typeof state !== 'object') continue;

		const info = (state as { collaboratorInfo?: { browserType?: string } })
			.collaboratorInfo;
		if (info?.browserType === MCP_BROWSER_TYPE) {
			return true;
		}
	}
	return false;
}

/**
 * Subscribe to MCP connection status changes via awareness.
 * Returns an unsubscribe function.
 *
 * @param callback Called with the current connection status on each change.
 */
export function subscribeToMcpConnection(
	callback: (connected: boolean) => void
): () => void {
	const handler = () => callback(isMcpConnected());

	if (!commandAwareness) {
		// Awareness not yet initialized — poll until it is
		let attached = false;
		const checkInterval = setInterval(() => {
			if (commandAwareness) {
				clearInterval(checkInterval);
				attached = true;
				handler();
				commandAwareness.on('change', handler);
			}
		}, 100);
		return () => {
			clearInterval(checkInterval);
			if (attached) {
				commandAwareness?.off('change', handler);
			}
		};
	}

	handler();
	commandAwareness.on('change', handler);
	return () => commandAwareness?.off('change', handler);
}
