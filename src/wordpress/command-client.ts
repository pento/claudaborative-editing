/**
 * Command client: observes a Y.Map for commands from the WordPress editor
 * plugin and provides REST methods for command lifecycle operations.
 *
 * The Y.Map is in a shared Y.Doc synced via the SyncClient's polling loop.
 * Commands arrive as Y.Map entries written by the browser; status updates
 * are written by the MCP server after REST calls succeed.
 */

import * as Y from 'yjs';
import { debugLog } from '../debug-log.js';
import type { WordPressApiClient } from './api-client.js';
import {
	TERMINAL_STATUSES,
	type CommandSlug,
	type CommandStatus,
} from '../../shared/commands.js';

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
	 * Start observing the document Y.Map for command changes.
	 * The map follows core-data's convention: entity fields are stored in
	 * doc.getMap('document'). The 'commands' key within that map contains
	 * a plain object of command objects keyed by ID.
	 *
	 * Called by CommandHandler after the command doc is synced.
	 */
	startObserving(documentMap: Y.Map<unknown>): void {
		this.commandMap = documentMap;
		debugLog(
			'cmd-client',
			'startObserving, map size:',
			documentMap.size,
			'keys:',
			Array.from(documentMap.keys())
		);

		this.observer = (event: Y.YMapEvent<unknown>) => {
			debugLog(
				'cmd-client',
				'Y.Map change event, local:',
				event.transaction.local,
				'changed keys:',
				Array.from(event.changes.keys.keys())
			);

			// Only process remote changes (from the browser via sync).
			if (event.transaction.local) return;

			// The 'commands' key in the document map holds all command objects.
			if (event.changes.keys.has('commands')) {
				debugLog('cmd-client', 'commands key changed, processing');
				this.processAllCommands();
			}
		};

		documentMap.observe(this.observer);

		// Process any commands already in the map (e.g., from initial sync).
		debugLog('cmd-client', 'Processing initial commands');
		this.processAllCommands();

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
	}

	// --- Y.Map writes ---

	/**
	 * Write a command object to the Y.Map after a successful REST call.
	 * The update will be synced to the browser on the next poll cycle.
	 *
	 * Commands are stored under the 'commands' key in the document map,
	 * matching core-data's entity record structure.
	 */
	writeCommandToDoc(command: Command): void {
		const map = this.commandMap;
		if (!map) return;

		// Read current commands, update the specific command, write back.
		const raw = map.get('commands');
		const commands = (raw as Record<string, unknown> | undefined) ?? {};

		const plain: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(command)) {
			plain[k] = v;
		}

		const updated = { ...commands, [String(command.id)]: plain };

		map.doc?.transact(() => {
			map.set('commands', updated);
		});
	}

	/**
	 * Remove a terminal command from the Y.Map to prevent unbounded growth.
	 */
	removeCommandFromDoc(commandId: number): void {
		const map = this.commandMap;
		if (!map) return;

		const raw = map.get('commands');
		const commands = (raw as Record<string, unknown> | undefined) ?? {};

		const { [String(commandId)]: _, ...remaining } = commands;

		map.doc?.transact(() => {
			map.set('commands', remaining);
		});
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

		// Mirror the updated state to the Y.Doc so the browser sees it.
		// Remove terminal commands to prevent stale data persisting.
		if (TERMINAL_STATUSES.includes(command.status)) {
			this.removeCommandFromDoc(command.id);
		} else {
			this.writeCommandToDoc(command);
		}

		return command;
	}

	// --- Internal ---

	/**
	 * Process all commands in the 'commands' key of the document map.
	 */
	private processAllCommands(): void {
		if (!this.commandMap) return;

		const raw = this.commandMap.get('commands');
		debugLog(
			'cmd-client',
			'processAllCommands, raw type:',
			typeof raw,
			'value:',
			raw ? JSON.stringify(raw).slice(0, 200) : 'undefined'
		);

		const commands = raw as Record<string, unknown> | undefined;
		if (!commands || typeof commands !== 'object') {
			debugLog('cmd-client', 'No commands object found');
			return;
		}

		debugLog(
			'cmd-client',
			'Found',
			Object.keys(commands).length,
			'commands:',
			Object.keys(commands)
		);
		for (const value of Object.values(commands)) {
			if (value && typeof value === 'object') {
				this.processCommand(value as Command);
			}
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
			const prevCount = this.lastSeenUserMsgCounts.get(id) ?? 0;

			if (userCount > prevCount) {
				this.lastSeenUserMsgCounts.set(id, userCount);
				this.onResponse(command);
			}
		}
	}
}
