/**
 * Command sync via core-data collection entity registration.
 *
 * Registers a per-user `root/wpce_commands_{userId}` entity with syncConfig
 * so that Gutenberg's polling manager includes the command room in its HTTP
 * requests. Each user gets their own collection room, preventing concurrent
 * write races between different users sharing a single Y.Map.
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
// eslint-disable-next-line import/no-extraneous-dependencies -- externalized by @wordpress/scripts
import { addFilter } from '@wordpress/hooks';
import { TERMINAL_STATUSES } from '#shared/commands';
import { store as coreDataStore } from '@wordpress/core-data';

/**
 * Raise the connection limit for per-user command rooms. The polling manager
 * enforces DEFAULT_CLIENT_LIMIT_PER_ROOM (3) on the primary room's awareness
 * count. We defer initCommandSync() so the post room registers first as
 * primary, but this filter is a safety net for edge cases (pages without a post
 * room, race conditions). Uses prefix matching since the full room name
 * includes the user ID (root/wpce_commands_{userId}).
 */
addFilter(
	'sync.pollingProvider.maxClientsPerRoom',
	'claudaborative-editing/command-room-limit',
	(limit: number, room: string) => {
		return room.startsWith('root/wpce_commands_') ? 100 : limit;
	}
);

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

/** Computed room name for the per-user command room (set in initCommandSync). */
let commandRoomName: string | null = null;

/** Whether the fetch interceptor has been installed. */
let fetchInterceptorInstalled = false;

/**
 * Dirty flag: set when writeCommandToSync() modifies the Y.Doc after the
 * fetch interceptor has already sent a compaction. Forces the interceptor
 * to re-inject the full state on the next poll, bypassing the
 * lastInjectedStateVector dedup guard.
 */
let commandDocDirty = false;

/** Captured Y.Doc from the collection sync initialization. */
let commandDoc: YDoc | null = null;

/** Captured Awareness instance from the collection sync initialization. */
let commandAwareness: InstanceType<typeof Awareness> | null = null;

/** The browserType value sent by the MCP server in awareness state. */
const MCP_BROWSER_TYPE = 'Claudaborative Editing MCP';

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
	const CHUNK = 8192;
	const parts: string[] = [];
	for (let i = 0; i < bytes.length; i += CHUNK) {
		parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
	}
	return btoa(parts.join(''));
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
					(r) => r.room === commandRoomName
				);
				if (cmdRoom && cmdRoom.updates.length === 0) {
					const sv = uint8ToBase64(Y.encodeStateVector(commandDoc));
					if (commandDocDirty || sv !== lastInjectedStateVector) {
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
						commandDocDirty = false;
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
 * Resolves the current user, registers a per-user entity with core-data,
 * and triggers collection sync via getEntityRecords. Each user gets their
 * own command room (root/wpce_commands_{userId}) to prevent concurrent
 * write races in the shared Y.Map.
 *
 * Call once during plugin initialization.
 */
export async function initCommandSync(): Promise<void> {
	if (initialized) {
		return;
	}
	initialized = true;

	// Resolve the current user ID for the per-user command room.
	let currentUser: { id: number } | undefined;
	try {
		currentUser = (await resolveSelect(coreDataStore).getCurrentUser()) as
			| { id: number }
			| undefined;
	} catch {
		initialized = false;
		return;
	}
	if (!currentUser?.id) {
		initialized = false;
		return;
	}
	const entityName = `wpce_commands_${currentUser.id}`;
	commandRoomName = `root/${entityName}`;

	// Register a per-user entity. The entity name includes the user ID so
	// each user gets their own collection room (root/wpce_commands_{userId}).
	// We use collection sync rather than single-entity sync because
	// Gutenberg's sync server enforces per-record permission checks on
	// single-entity rooms that don't apply to our custom entity.
	dispatch(coreDataStore).addEntities([
		{
			kind: 'root',
			name: entityName,
			baseURL: '/wpce/v1/sync-entity',
			baseURLParams: { context: 'edit' },
			plural: entityName,
			syncConfig,
		},
	]);

	// Trigger the collection resolver, which starts collection sync.
	// getEntityRecords with per_page=-1 calls getSyncManager().loadCollection()
	// which creates the Y.Doc and registers room 'root/wpce_commands_{userId}'
	// with the polling manager.
	void resolveSelect(coreDataStore).getEntityRecords('root', entityName, {
		per_page: -1,
	});

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

	const runCleanup = async () => {
		const stateMap = getStateMap();
		if (!stateMap) return;

		const commands = stateMap.get('commands') as
			| Record<string, unknown>
			| undefined;
		if (!commands || Object.keys(commands).length === 0) return;

		try {
			// Per-user room: all commands belong to the current user,
			// so no user_id filtering is needed.
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
				commandDocDirty = true;
			}
		} catch {
			// Best-effort
		}
	};

	// Run immediately, then every 30 seconds to catch data that
	// arrives from the sync server after init or becomes stale over time.
	await runCleanup();
	setInterval(() => void runCleanup(), 30_000);
}

/**
 * Pending writes queued while the Y.Doc is still initializing.
 * Flushed by a single shared retry timer once the state map is available.
 */
let pendingWrites: Command[] = [];
let pendingWriteTimer: ReturnType<typeof setInterval> | null = null;
const WRITE_RETRY_INTERVAL_MS = 200;
const WRITE_MAX_RETRIES = 50; // 10 seconds

/**
 * Flush all pending writes to the Y.Doc's state map.
 * Returns true if the state map is available (all writes applied).
 */
function flushPendingWrites(): boolean {
	const stateMap = getStateMap();
	if (!stateMap) return false;

	for (const cmd of pendingWrites) {
		applyCommandToStateMap(stateMap, cmd);
	}
	pendingWrites = [];
	return true;
}

/**
 * Apply a single command write to the state map.
 * @param stateMap
 * @param command
 */
function applyCommandToStateMap(stateMap: YMap, command: Command): void {
	const commands = {
		...((stateMap.get('commands') as Record<string, unknown> | undefined) ??
			{}),
	};

	if (TERMINAL_STATUSES.includes(command.status)) {
		delete commands[String(command.id)];
	} else {
		commands[String(command.id)] = { ...command };
	}

	commandDoc?.transact(() => {
		stateMap.set('commands', commands);
		stateMap.set('savedAt', Date.now());
	});

	// Signal the fetch interceptor to re-inject on the next poll.
	// Without this, the interceptor's lastInjectedStateVector guard
	// may skip re-injection after a queued write completes.
	commandDocDirty = true;
}

/**
 * Write a command to the Y.Doc's state map.
 * Call after a successful REST API operation (submit, respond, cancel).
 * If the Y.Doc isn't ready yet (collection sync still initializing),
 * queues the write and retries via a single shared timer.
 *
 * @param command The command to write.
 */
export function writeCommandToSync(command: Command): void {
	const stateMap = getStateMap();
	if (stateMap) {
		applyCommandToStateMap(stateMap, command);
		return;
	}

	// Y.Doc not ready — queue and start a shared retry timer if needed.
	pendingWrites.push(command);
	if (pendingWriteTimer !== null) return;

	let retries = 0;
	pendingWriteTimer = setInterval(() => {
		retries++;
		if (flushPendingWrites() || retries >= WRITE_MAX_RETRIES) {
			if (retries >= WRITE_MAX_RETRIES && pendingWrites.length > 0) {
				// eslint-disable-next-line no-console
				console.warn(
					`[wpce] Dropping ${pendingWrites.length} pending command write(s) — Y.Doc not ready after ${WRITE_MAX_RETRIES} retries`
				);
			}
			clearInterval(pendingWriteTimer!);
			pendingWriteTimer = null;
			pendingWrites = [];
		}
	}, WRITE_RETRY_INTERVAL_MS);
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

	commandDocDirty = true;
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

	// Poll until the doc is available (it's created async during loadCollection).
	// Timeout after ~30 seconds to avoid leaking an interval if sync never initializes.
	const DOC_POLL_INTERVAL_MS = 100;
	const DOC_POLL_MAX_RETRIES = 300;
	let retries = 0;
	const checkInterval = setInterval(() => {
		retries++;
		if (retries >= DOC_POLL_MAX_RETRIES) {
			clearInterval(checkInterval);
			return;
		}

		const stateMap = getStateMap();
		if (!stateMap) return;

		clearInterval(checkInterval);
		observedMap = stateMap;

		observer = (event: YMapEvent) => {
			if (!event.changes.keys.has('commands')) return;
			callback(
				(stateMap.get('commands') as Record<string, Command>) ?? {}
			);
		};

		stateMap.observe(observer);
	}, DOC_POLL_INTERVAL_MS);

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
	// Real-time check via Yjs awareness (authoritative when available).
	if (commandAwareness) {
		const states = commandAwareness.getStates();
		for (const [clientId, state] of states) {
			if (clientId === commandAwareness.clientID) continue;
			if (!state || typeof state !== 'object') continue;

			const info = (
				state as { collaboratorInfo?: { browserType?: string } }
			).collaboratorInfo;
			if (info?.browserType === MCP_BROWSER_TYPE) {
				return true;
			}
		}
		// Awareness has no MCP client — but this may be transient
		// (awareness just initialized and hasn't received sync data).
		// Fall through to the server-side hint rather than returning
		// false immediately, so we don't flash a disconnected state.
	}

	// Server-side hint injected via wp_add_inline_script on page load.
	// Covers both: awareness not yet initialized, and awareness fresh
	// with no remote data yet.
	const initialState = (
		window as Window & {
			wpceInitialState?: { mcpConnected?: boolean };
		}
	).wpceInitialState;
	return initialState?.mcpConnected ?? false;
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
		// Awareness not yet initialized — poll until it is.
		// Timeout after ~30 seconds to avoid leaking an interval if sync never initializes.
		const AWARENESS_POLL_INTERVAL_MS = 100;
		const AWARENESS_POLL_MAX_RETRIES = 300;
		let attached = false;
		let retries = 0;
		const checkInterval = setInterval(() => {
			retries++;
			if (retries >= AWARENESS_POLL_MAX_RETRIES) {
				clearInterval(checkInterval);
				callback(false);
				return;
			}
			if (commandAwareness) {
				clearInterval(checkInterval);
				attached = true;
				handler();
				commandAwareness.on('change', handler);
			}
		}, AWARENESS_POLL_INTERVAL_MS);
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
