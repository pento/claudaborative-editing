/**
 * Command client: listens for commands from the WordPress editor plugin
 * via SSE (primary) or REST polling (fallback), and provides REST methods
 * for command lifecycle operations.
 *
 * Analogous to SyncClient for the Yjs sync protocol.
 */

import type { WordPressApiClient } from './api-client.js';
import type { CommandSlug, CommandStatus } from '../../shared/commands.js';

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
	created_at: string;
	updated_at: string;
	expires_at: string;
}

export interface CommandClientConfig {
	/** Polling interval in ms (default 5000). */
	pollInterval: number;
	/** Max SSE reconnect attempts before falling back to polling (default 3). */
	maxSseRetries: number;
	/** Interval to retry SSE while in polling mode, in ms (default 60000). */
	sseRetryFromPollingInterval: number;
	/** Initial backoff delay for SSE reconnection in ms (default 1000). */
	sseBackoffBase: number;
	/** Maximum backoff delay for SSE reconnection in ms (default 30000). */
	sseBackoffMax: number;
}

export const DEFAULT_COMMAND_CLIENT_CONFIG: CommandClientConfig = {
	pollInterval: 5000,
	maxSseRetries: 3,
	sseRetryFromPollingInterval: 60_000,
	sseBackoffBase: 1000,
	sseBackoffMax: 30_000,
};

/** Parsed SSE event. */
interface SSEEvent {
	event: string;
	data: string;
	id?: string;
}

export type CommandTransport = 'sse' | 'polling' | 'none';

// --- CommandClient ---

export class CommandClient {
	private abortController: AbortController | null = null;
	private pollTimer: ReturnType<typeof setTimeout> | null = null;
	private sseRetryFromPollingTimer: ReturnType<typeof setTimeout> | null =
		null;
	private sseBackoffTimer: ReturnType<typeof setTimeout> | null = null;
	private _transport: CommandTransport = 'none';
	private sseRetryCount = 0;
	private lastSeenCommandId = 0;
	private _stopped = false;

	/** Processing lock to prevent overlapping poll cycles. */
	private polling = false;

	constructor(
		private apiClient: WordPressApiClient,
		private onCommand: (command: Command) => void,
		private config: CommandClientConfig = DEFAULT_COMMAND_CLIENT_CONFIG
	) {}

	// --- Public accessors ---

	getTransport(): CommandTransport {
		return this._transport;
	}

	/**
	 * Check if the client has been stopped.
	 * Method call prevents TypeScript from narrowing across await boundaries.
	 */
	private isStopped(): boolean {
		return this._stopped;
	}

	// --- REST methods ---

	async getPluginStatus(): Promise<PluginStatus> {
		return this.apiClient.request<PluginStatus>('/wpce/v1/status');
	}

	async listPendingCommands(): Promise<Command[]> {
		return this.apiClient.request<Command[]>(
			'/wpce/v1/commands?status=pending'
		);
	}

	async updateCommandStatus(
		id: number,
		status: CommandStatus,
		message?: string
	): Promise<Command> {
		const body: Record<string, unknown> = { status };
		if (message !== undefined) {
			body.message = message;
		}
		return this.apiClient.request<Command>(`/wpce/v1/commands/${id}`, {
			method: 'PATCH',
			body: JSON.stringify(body),
		});
	}

	// --- Transport lifecycle ---

	/**
	 * Start listening for commands. Tries SSE first, falls back to polling.
	 */
	async start(): Promise<void> {
		this._stopped = false;
		this.sseRetryCount = 0;

		try {
			await this.connectSSE();
		} catch {
			// SSE failed immediately — fall back to polling
			if (!this.isStopped()) {
				this.startPolling();
			}
		}
	}

	/**
	 * Stop all transport. Safe to call multiple times.
	 */
	stop(): void {
		this._stopped = true;
		this._transport = 'none';

		if (this.abortController) {
			this.abortController.abort();
			this.abortController = null;
		}

		if (this.pollTimer !== null) {
			clearTimeout(this.pollTimer);
			this.pollTimer = null;
		}

		if (this.sseRetryFromPollingTimer !== null) {
			clearTimeout(this.sseRetryFromPollingTimer);
			this.sseRetryFromPollingTimer = null;
		}

		if (this.sseBackoffTimer !== null) {
			clearTimeout(this.sseBackoffTimer);
			this.sseBackoffTimer = null;
		}
	}

	// --- SSE transport ---

	private async connectSSE(): Promise<void> {
		if (this.isStopped()) return;

		const controller = new AbortController();
		this.abortController = controller;

		const headers: Record<string, string> = {};
		if (this.lastSeenCommandId > 0) {
			headers['Last-Event-ID'] = String(this.lastSeenCommandId);
		}

		const response = await this.apiClient.requestStream(
			'/wpce/v1/commands/stream',
			{
				signal: controller.signal,
				headers,
			}
		);

		if (!response.body) {
			throw new Error('SSE response has no body');
		}

		this._transport = 'sse';
		this.sseRetryCount = 0;

		// Process the stream in the background — don't await.
		// The stream continues until the server closes it or we abort.
		this.processSSEStream(response.body).catch((error: unknown) => {
			if (this.isStopped()) return;

			// AbortError means we stopped intentionally
			if (error instanceof Error && error.name === 'AbortError') return;

			this.handleSSEDisconnect();
		});
	}

	private async processSSEStream(
		stream: ReadableStream<Uint8Array>
	): Promise<void> {
		for await (const event of this.parseSSEStream(stream)) {
			if (this.isStopped()) return;

			if (event.event === 'command') {
				try {
					const command = JSON.parse(event.data) as Command;
					if (event.id) {
						this.lastSeenCommandId = Math.max(
							this.lastSeenCommandId,
							Number(event.id)
						);
					}
					this.onCommand(command);
				} catch {
					// Malformed event data — skip
				}
			}
			// Heartbeat events are ignored (they keep the connection alive)
		}

		// Stream ended normally (server closed after ~5 minutes).
		// Reconnect immediately unless stopped.
		if (!this.isStopped()) {
			try {
				await this.connectSSE();
			} catch {
				this.handleSSEDisconnect();
			}
		}
	}

	private handleSSEDisconnect(): void {
		if (this.isStopped()) return;

		this.sseRetryCount++;

		if (this.sseRetryCount >= this.config.maxSseRetries) {
			// Max retries exceeded — switch to polling
			this.startPolling();
			return;
		}

		// Retry with exponential backoff
		const delay = Math.min(
			this.config.sseBackoffBase * Math.pow(2, this.sseRetryCount - 1),
			this.config.sseBackoffMax
		);

		this.sseBackoffTimer = setTimeout(() => {
			this.sseBackoffTimer = null;
			if (this.isStopped()) return;
			this.connectSSE().catch(() => {
				this.handleSSEDisconnect();
			});
		}, delay);
	}

	// --- SSE parser ---

	/**
	 * Parse an SSE stream into discrete events.
	 * Handles chunks split across read boundaries.
	 */
	async *parseSSEStream(
		stream: ReadableStream<Uint8Array>
	): AsyncGenerator<SSEEvent> {
		const reader = stream.getReader();
		const decoder = new TextDecoder();
		let buffer = '';

		// Current event being assembled
		let eventType = '';
		let eventData: string[] = [];
		let eventId: string | undefined;

		/** Parse a single SSE field line and accumulate into the current event. */
		function parseLine(line: string): void {
			if (line.startsWith(':')) return; // Comment — ignore

			const colonIndex = line.indexOf(':');
			let field: string;
			let fieldValue: string;

			if (colonIndex === -1) {
				field = line.replace(/\r$/, '');
				fieldValue = '';
			} else {
				field = line.slice(0, colonIndex);
				// Strip leading space after colon (per SSE spec)
				fieldValue = line.slice(
					colonIndex + 1 + (line[colonIndex + 1] === ' ' ? 1 : 0)
				);
				fieldValue = fieldValue.replace(/\r$/, '');
			}

			switch (field) {
				case 'event':
					eventType = fieldValue;
					break;
				case 'data':
					eventData.push(fieldValue);
					break;
				case 'id':
					eventId = fieldValue;
					break;
				// 'retry' and unknown fields are ignored
			}
		}

		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });

				// Process complete lines
				const lines = buffer.split('\n');
				// Keep the last incomplete line in the buffer
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					if (line === '' || line === '\r') {
						// Empty line = end of event
						if (eventData.length > 0 || eventType) {
							yield {
								event: eventType || 'message',
								data: eventData.join('\n'),
								id: eventId,
							};
						}
						eventType = '';
						eventData = [];
						eventId = undefined;
					} else {
						parseLine(line);
					}
				}
			}

			// Flush the TextDecoder (handles multi-byte chars split across chunks)
			buffer += decoder.decode();

			// Process any remaining buffered line
			if (buffer.trim()) {
				parseLine(buffer.replace(/\r$/, ''));
			}

			if (eventData.length > 0 || eventType) {
				yield {
					event: eventType || 'message',
					data: eventData.join('\n'),
					id: eventId,
				};
			}
		} finally {
			reader.releaseLock();
		}
	}

	// --- Polling transport ---

	private startPolling(): void {
		if (this.isStopped()) return;

		this._transport = 'polling';
		this.schedulePoll();
		this.scheduleSSERetry();
	}

	private schedulePoll(): void {
		if (this.isStopped()) return;

		this.pollTimer = setTimeout(() => {
			this.pollTimer = null;
			void this.poll();
		}, this.config.pollInterval);
	}

	private async poll(): Promise<void> {
		if (this.isStopped() || this.polling) return;

		this.polling = true;
		try {
			const commands = await this.listPendingCommands();

			// Filter to commands newer than the last seen, then process in
			// ascending ID order to avoid skipping older pending commands when
			// the API returns results newest-first (DESC by date).
			const newCommands = commands
				.filter((c) => c.id > this.lastSeenCommandId)
				.sort((a, b) => a.id - b.id);

			let maxDeliveredId = this.lastSeenCommandId;
			for (const command of newCommands) {
				if (this.isStopped()) break;
				this.onCommand(command);
				if (command.id > maxDeliveredId) {
					maxDeliveredId = command.id;
				}
			}
			if (maxDeliveredId > this.lastSeenCommandId) {
				this.lastSeenCommandId = maxDeliveredId;
			}
		} catch {
			// Network error — will retry on next poll
		} finally {
			this.polling = false;
			if (!this.isStopped() && this._transport === 'polling') {
				this.schedulePoll();
			}
		}
	}

	/**
	 * Periodically attempt to reconnect SSE while in polling mode.
	 */
	private scheduleSSERetry(): void {
		if (this.isStopped() || this._transport !== 'polling') return;

		this.sseRetryFromPollingTimer = setTimeout(() => {
			this.sseRetryFromPollingTimer = null;
			if (this.isStopped() || this._transport !== 'polling') return;

			// Stop polling, try SSE
			if (this.pollTimer !== null) {
				clearTimeout(this.pollTimer);
				this.pollTimer = null;
			}

			this.sseRetryCount = 0;
			this.connectSSE()
				.then(() => {
					// SSE succeeded — transport is now 'sse'
				})
				.catch(() => {
					// SSE still broken — resume polling
					if (!this.isStopped()) {
						this.startPolling();
					}
				});
		}, this.config.sseRetryFromPollingInterval);
	}
}
