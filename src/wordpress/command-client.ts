/**
 * Command client: observes a Y.Map for commands from the WordPress editor
 * plugin and provides REST methods for command lifecycle operations.
 *
 * The Y.Map is in a shared Y.Doc synced via the SyncClient's polling loop.
 * Commands arrive as Y.Map entries written by the browser; status updates
 * are written by the MCP server after REST calls succeed.
 */

import * as Y from 'yjs';
import { debugLog, isDebugEnabled } from '../debug-log.js';
import type { WordPressApiClient } from './api-client.js';
import {
	commandKey,
	isCommandKey,
	type CommandSlug,
	type CommandStatus,
} from '../../shared/commands.js';

/**
 * Status progression rank. Writes that would move a command backward
 * (lower rank) are skipped so a late-arriving stale REST response can't
 * overwrite a fresh terminal write.
 */
const STATUS_RANK: Record<CommandStatus, number> = {
	pending: 0,
	running: 1,
	awaiting_input: 1,
	completed: 2,
	failed: 2,
	cancelled: 2,
	expired: 2,
};

/**
 * Transaction origin used for local writes. Must match the origin
 * checked by the session manager's updateV2 handler so updates are
 * queued for sync.
 */
const LOCAL_ORIGIN = 'local';

/**
 * Maximum time awaitCommandInMap() blocks waiting for sync to deliver
 * a command. Long enough to absorb the typical browser → sync-server →
 * MCP round-trip, short enough that a genuinely wedged sync still lets
 * the tool call return.
 */
const AWAIT_COMMAND_TIMEOUT_MS = 2000;

// --- Protocol version compatibility ---

/** Protocol versions this MCP server supports. */
export const SUPPORTED_PROTOCOL_VERSIONS = [1] as const;

/** Check if a plugin protocol version is compatible with this MCP server. */
export function isProtocolCompatible(version: number): boolean {
	return (SUPPORTED_PROTOCOL_VERSIONS as readonly number[]).includes(version);
}

// --- Types ---

export interface PluginStatus {
	version: string;
	protocol_version: number;
	mcp_connected: boolean;
	mcp_last_seen_at: string | null;
}

export interface Command {
	id: number;
	post_id: number;
	prompt: CommandSlug;
	arguments: Record<string, unknown>;
	status: CommandStatus;
	user_id: number;
	claimed_by: number | null;
	message: string | null;
	result_data?: Record<string, unknown> | null;
	created_at: string;
	updated_at: string;
	expires_at: string;
}

export type CommandTransport = 'yjs' | 'none';

// --- CommandClient ---

export class CommandClient {
	private commandMap: Y.Map<unknown> | null = null;
	private observer: ((event: Y.YMapEvent<unknown>) => void) | null = null;

	/** Track which pending commands we've already notified about. */
	private notifiedPendingIds = new Set<number>();
	/** Track user message counts per command for response detection. */
	private lastSeenUserMsgCounts = new Map<number, number>();
	/** Guards against spurious onResponse() calls during initial sync. */
	private initialScanComplete = false;

	private _transport: CommandTransport = 'none';

	constructor(
		private apiClient: WordPressApiClient,
		private onCommand: (command: Command) => void,
		private onResponse: (command: Command) => void
	) {}

	// --- Public accessors ---

	getTransport(): CommandTransport {
		return this._transport;
	}

	// --- Y.Map observation ---

	/**
	 * Start observing the provided Y.Map for command changes.
	 * The concrete shared map is injected by the caller/session layer;
	 * each command lives at its own `cmd_${id}` entry and is detected
	 * via `isCommandKey`. Other keys in the map (e.g. `savedAt`) are
	 * ignored.
	 *
	 * Called by CommandHandler after the command doc is synced.
	 */
	startObserving(documentMap: Y.Map<unknown>): void {
		this.commandMap = documentMap;
		if (isDebugEnabled()) {
			debugLog(
				'cmd-client',
				'startObserving, map size:',
				documentMap.size,
				'keys:',
				Array.from(documentMap.keys())
			);
		}

		this.observer = (event: Y.YMapEvent<unknown>) => {
			if (isDebugEnabled()) {
				debugLog(
					'cmd-client',
					'Y.Map change event, local:',
					event.transaction.local,
					'changed keys:',
					Array.from(event.changes.keys.keys())
				);
			}

			// Only process remote changes (from the browser via sync).
			if (event.transaction.local) return;

			// Per-command keys (`cmd_${id}`) store individual command objects.
			let touched = false;
			for (const key of event.changes.keys.keys()) {
				if (isCommandKey(key)) {
					touched = true;
					break;
				}
			}
			if (touched) {
				debugLog('cmd-client', 'command keys changed, processing');
				this.processAllCommands();
			}
		};

		documentMap.observe(this.observer);

		// Process any commands already in the map (e.g., from initial sync).
		// The initial scan primes lastSeenUserMsgCounts without firing
		// onResponse(), preventing spurious notifications on restart.
		debugLog('cmd-client', 'Processing initial commands');
		this.processAllCommands();
		this.initialScanComplete = true;

		this._transport = 'yjs';
	}

	/**
	 * Stop observing and clean up.
	 */
	stop(): void {
		if (this.commandMap && this.observer) {
			this.commandMap.unobserve(this.observer);
			this.observer = null;
		}
		this.commandMap = null;
		this._transport = 'none';
		this.notifiedPendingIds.clear();
		this.lastSeenUserMsgCounts.clear();
		this.initialScanComplete = false;
	}

	// --- Y.Map writes ---

	/**
	 * Write a command object to the Y.Map after a successful REST call.
	 * The update will be synced to the browser on the next poll cycle.
	 *
	 * Each command is stored under its own `cmd_${id}` entry so that
	 * concurrent writes targeting different commands commute, and
	 * same-command writes stay causally ordered.
	 */
	writeCommandToDoc(command: Command): void {
		const map = this.commandMap;
		if (!map) return;

		const key = commandKey(command.id);

		// Guard against stale writes: if the Y.Doc already holds a more
		// advanced status for this command, skip. Two REST PATCHes can be
		// in flight simultaneously (e.g. server auto-claim → running and
		// Claude completing the command), and the later-resolving one can
		// otherwise overwrite the earlier-resolving one with older state.
		const existing = map.get(key) as Command | undefined;
		if (
			existing &&
			STATUS_RANK[command.status] < STATUS_RANK[existing.status]
		) {
			return;
		}

		const plain: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(command)) {
			plain[k] = v;
		}

		map.doc?.transact(() => {
			map.set(key, plain);
		}, LOCAL_ORIGIN);
	}

	/**
	 * Remove a terminal command from the Y.Map to prevent unbounded growth.
	 */
	removeCommandFromDoc(commandId: number): void {
		const map = this.commandMap;
		if (!map) return;

		map.doc?.transact(() => {
			map.delete(commandKey(commandId));
		}, LOCAL_ORIGIN);
	}

	// --- REST methods ---

	async getPluginStatus(): Promise<PluginStatus> {
		return this.apiClient.request<PluginStatus>('/wpce/v1/status');
	}

	async updateCommandStatus(
		id: number,
		status: CommandStatus,
		message?: string,
		resultData?: string
	): Promise<Command> {
		const body: Record<string, unknown> = { status };
		if (message !== undefined) {
			body.message = message;
		}
		if (resultData !== undefined) {
			body.result_data = resultData;
		}
		const command = await this.apiClient.request<Command>(
			`/wpce/v1/commands/${id}`,
			{
				method: 'PATCH',
				body: JSON.stringify(body),
			}
		);

		// Wait for sync to deliver the command to the shared map before
		// mirroring the new status. The command originates from the browser,
		// so if writeCommandToDoc runs before that arrival our item is
		// CRDT-concurrent with the browser's pending write and Y.Map's
		// tiebreak can discard ours, stranding the panel at "pending". A
		// short bounded wait is enough to serialise the writes; if sync is
		// wedged we fall through and write anyway.
		await this.awaitCommandInMap(id);

		// Terminal commands are NOT removed here — the browser-side stale
		// cleanup handles removal after processing. Removing on a timer
		// risks the browser never seeing the terminal state if its polling
		// batches the write and removal into a single update.
		this.writeCommandToDoc(command);

		return command;
	}

	/**
	 * Resolve once `cmd_${id}` exists in the observed map, or after a
	 * bounded timeout. Driven by the Y.Map observer rather than a polling
	 * loop so there's no 50ms jitter on the happy path and no CPU burn
	 * while waiting.
	 */
	private async awaitCommandInMap(id: number): Promise<void> {
		const map = this.commandMap;
		if (!map) return;
		const key = commandKey(id);
		if (map.get(key) !== undefined) return;

		await new Promise<void>((resolve) => {
			const timeout = setTimeout(() => {
				map.unobserve(onChange);
				resolve();
			}, AWAIT_COMMAND_TIMEOUT_MS);

			const onChange = (event: Y.YMapEvent<unknown>): void => {
				if (!event.changes.keys.has(key)) return;
				if (map.get(key) === undefined) return;
				clearTimeout(timeout);
				map.unobserve(onChange);
				resolve();
			};
			map.observe(onChange);
		});
	}

	// --- Internal ---

	private processAllCommands(): void {
		const map = this.commandMap;
		if (!map) return;

		const currentIds = new Set<number>();
		map.forEach((value, key) => {
			if (!isCommandKey(key)) return;
			if (!value || typeof value !== 'object') return;
			const cmd = value as Command;
			if (typeof cmd.id === 'number') {
				currentIds.add(cmd.id);
				this.processCommand(cmd);
			}
		});

		if (isDebugEnabled()) {
			debugLog(
				'cmd-client',
				'processAllCommands: found',
				currentIds.size,
				'commands'
			);
		}

		// Prune tracking state for commands no longer in the Y.Map.
		for (const id of this.notifiedPendingIds) {
			if (!currentIds.has(id)) this.notifiedPendingIds.delete(id);
		}
		for (const id of this.lastSeenUserMsgCounts.keys()) {
			if (!currentIds.has(id)) this.lastSeenUserMsgCounts.delete(id);
		}
	}

	/**
	 * Process a command from the Y.Map. Dispatch onCommand for new pending
	 * commands, onResponse for commands with new user messages.
	 */
	private processCommand(command: Command): void {
		const id = command.id;
		if (!id) return;

		// New pending command — notify once.
		if (command.status === 'pending' && !this.notifiedPendingIds.has(id)) {
			this.notifiedPendingIds.add(id);
			this.onCommand(command);
			return;
		}

		// Running command with user messages — check for new messages.
		if (command.status === 'running' && command.result_data?.messages) {
			const messages = command.result_data.messages as Array<{
				role: string;
			}>;
			const userCount = messages.filter((m) => m.role === 'user').length;

			if (!this.initialScanComplete) {
				// Prime the counter during the initial scan so we don't
				// fire onResponse() for conversations that already existed
				// before we started observing.
				this.lastSeenUserMsgCounts.set(id, userCount);
				return;
			}

			const prevCount = this.lastSeenUserMsgCounts.get(id) ?? 0;

			if (userCount > prevCount) {
				this.lastSeenUserMsgCounts.set(id, userCount);
				this.onResponse(command);
			}
		}
	}
}
