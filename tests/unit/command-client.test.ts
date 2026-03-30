import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	CommandClient,
	DEFAULT_COMMAND_CLIENT_CONFIG,
} from '../../src/wordpress/command-client.js';
import type {
	Command,
	CommandClientConfig,
} from '../../src/wordpress/command-client.js';
import type { WordPressApiClient } from '../../src/wordpress/api-client.js';

// --- Helpers ---

function createMockApiClient() {
	return {
		request: vi.fn(),
		requestStream: vi.fn(),
	} as unknown as WordPressApiClient & {
		request: ReturnType<typeof vi.fn>;
		requestStream: ReturnType<typeof vi.fn>;
	};
}

function createSSEStream(text: string): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(text));
			controller.close();
		},
	});
}

function createMultiChunkSSEStream(
	chunks: string[]
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(encoder.encode(chunk));
			}
			controller.close();
		},
	});
}

/**
 * Creates an SSE stream that stays open until the returned cancel function
 * is called.  This prevents processSSEStream from completing and triggering
 * automatic reconnection, which would create infinite loops under fake timers.
 */
function createHangingSSEStream(
	initialText: string
): [ReadableStream<Uint8Array>, () => void] {
	const encoder = new TextEncoder();
	let controllerRef: ReadableStreamDefaultController<Uint8Array>;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controllerRef = controller;
			if (initialText) {
				controller.enqueue(encoder.encode(initialText));
			}
		},
		cancel() {
			// Called when the reader is cancelled (e.g. via abort)
		},
	});

	const close = () => {
		try {
			controllerRef.close();
		} catch {
			// Already closed
		}
	};

	return [stream, close];
}

function fakeCommand(overrides?: Partial<Command>): Command {
	return {
		id: 1,
		post_id: 42,
		prompt: 'proofread',
		arguments: {},
		status: 'pending',
		user_id: 1,
		claimed_by: null,
		message: null,
		created_at: '2026-01-01T00:00:00',
		updated_at: '2026-01-01T00:00:00',
		expires_at: '2026-01-01T01:00:00',
		...overrides,
	};
}

function fakeSSEResponse(body: ReadableStream<Uint8Array>): Response {
	return {
		ok: true,
		status: 200,
		statusText: 'OK',
		body,
		headers: new Headers({ 'content-type': 'text/event-stream' }),
	} as unknown as Response;
}

/** Access the private parseSSEStream method for direct testing. */
function getParser(c: CommandClient) {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
	return (c as any).parseSSEStream.bind(c) as (
		stream: ReadableStream<Uint8Array>
	) => AsyncGenerator<{ event: string; data: string; id?: string }>;
}

// --- Tests ---

describe('CommandClient', () => {
	let apiClient: ReturnType<typeof createMockApiClient>;
	let onCommand: ReturnType<typeof vi.fn<(command: Command) => void>>;
	let config: CommandClientConfig;
	let client: CommandClient;

	beforeEach(() => {
		vi.useFakeTimers();
		apiClient = createMockApiClient();
		onCommand = vi.fn();
		config = {
			...DEFAULT_COMMAND_CLIENT_CONFIG,
			// Use short intervals for tests
			pollInterval: 100,
			sseBackoffBase: 50,
			sseBackoffMax: 200,
			sseRetryFromPollingInterval: 500,
		};
		client = new CommandClient(apiClient, onCommand, config);
	});

	afterEach(() => {
		client.stop();
		vi.useRealTimers();
	});

	// -------------------------------------------------------
	// REST methods
	// -------------------------------------------------------

	describe('getPluginStatus()', () => {
		it('calls apiClient.request with the correct path', async () => {
			const status = {
				version: '1.0.0',
				protocol_version: 1,
				mcp_connected: true,
				mcp_last_seen_at: '2026-01-01T00:00:00',
			};
			apiClient.request.mockResolvedValue(status);

			const result = await client.getPluginStatus();

			expect(apiClient.request).toHaveBeenCalledWith('/wpce/v1/status');
			expect(result).toEqual(status);
		});
	});

	describe('listPendingCommands()', () => {
		it('calls apiClient.request with status=pending query', async () => {
			const commands = [fakeCommand({ id: 1 }), fakeCommand({ id: 2 })];
			apiClient.request.mockResolvedValue(commands);

			const result = await client.listPendingCommands();

			expect(apiClient.request).toHaveBeenCalledWith(
				'/wpce/v1/commands?status=pending'
			);
			expect(result).toEqual(commands);
		});
	});

	describe('claimCommand()', () => {
		it('sends PATCH with status claimed', async () => {
			const claimed = fakeCommand({ id: 5, status: 'claimed' });
			apiClient.request.mockResolvedValue(claimed);

			const result = await client.claimCommand(5);

			expect(apiClient.request).toHaveBeenCalledWith(
				'/wpce/v1/commands/5',
				{
					method: 'PATCH',
					body: JSON.stringify({ status: 'claimed' }),
				}
			);
			expect(result).toEqual(claimed);
		});
	});

	describe('updateCommandStatus()', () => {
		it('sends PATCH with status only', async () => {
			const updated = fakeCommand({ id: 3, status: 'running' });
			apiClient.request.mockResolvedValue(updated);

			const result = await client.updateCommandStatus(3, 'running');

			expect(apiClient.request).toHaveBeenCalledWith(
				'/wpce/v1/commands/3',
				{
					method: 'PATCH',
					body: JSON.stringify({ status: 'running' }),
				}
			);
			expect(result).toEqual(updated);
		});

		it('sends PATCH with status and message', async () => {
			const updated = fakeCommand({
				id: 7,
				status: 'completed',
				message: 'Done!',
			});
			apiClient.request.mockResolvedValue(updated);

			const result = await client.updateCommandStatus(
				7,
				'completed',
				'Done!'
			);

			expect(apiClient.request).toHaveBeenCalledWith(
				'/wpce/v1/commands/7',
				{
					method: 'PATCH',
					body: JSON.stringify({
						status: 'completed',
						message: 'Done!',
					}),
				}
			);
			expect(result).toEqual(updated);
		});

		it('does not include message key when message is undefined', async () => {
			apiClient.request.mockResolvedValue(
				fakeCommand({ id: 1, status: 'failed' })
			);

			await client.updateCommandStatus(1, 'failed');

			const callArgs = apiClient.request.mock.calls[0][1] as {
				body: string;
			};
			const body = JSON.parse(callArgs.body) as Record<string, unknown>;
			expect(body).not.toHaveProperty('message');
		});
	});

	// -------------------------------------------------------
	// SSE transport — connectSSE
	// -------------------------------------------------------

	describe('SSE transport', () => {
		it('sets transport to sse on successful connection', async () => {
			const [stream, closeStream] = createHangingSSEStream(
				'event: heartbeat\ndata: \n\n'
			);
			apiClient.requestStream.mockResolvedValue(fakeSSEResponse(stream));

			expect(client.getTransport()).toBe('none');

			await client.start();
			await vi.advanceTimersByTimeAsync(0);

			expect(client.getTransport()).toBe('sse');
			closeStream();
		});

		it('delivers command events to onCommand callback', async () => {
			const cmd = fakeCommand({ id: 10, prompt: 'review' });
			const [stream, closeStream] = createHangingSSEStream(
				`event: command\nid: 10\ndata: ${JSON.stringify(cmd)}\n\n`
			);
			apiClient.requestStream.mockResolvedValue(fakeSSEResponse(stream));

			await client.start();
			await vi.advanceTimersByTimeAsync(0);

			expect(onCommand).toHaveBeenCalledTimes(1);
			expect(onCommand).toHaveBeenCalledWith(cmd);
			closeStream();
		});

		it('ignores heartbeat events', async () => {
			const cmd = fakeCommand({ id: 11 });
			const [stream, closeStream] = createHangingSSEStream(
				`event: heartbeat\ndata: \n\nevent: command\nid: 11\ndata: ${JSON.stringify(cmd)}\n\nevent: heartbeat\ndata: \n\n`
			);
			apiClient.requestStream.mockResolvedValue(fakeSSEResponse(stream));

			await client.start();
			await vi.advanceTimersByTimeAsync(0);

			expect(onCommand).toHaveBeenCalledTimes(1);
			expect(onCommand).toHaveBeenCalledWith(cmd);
			closeStream();
		});

		it('passes Last-Event-ID header on reconnection after stream ends', async () => {
			const cmd = fakeCommand({ id: 25 });
			// First connection: delivers a command, then stream closes
			const stream1 = createSSEStream(
				`event: command\nid: 25\ndata: ${JSON.stringify(cmd)}\n\n`
			);
			// Second connection: hangs open so we don't trigger another reconnect
			const [stream2, closeStream2] = createHangingSSEStream(
				'event: heartbeat\ndata: \n\n'
			);

			apiClient.requestStream
				.mockResolvedValueOnce(fakeSSEResponse(stream1))
				.mockResolvedValueOnce(fakeSSEResponse(stream2));

			await client.start();
			// Process first stream and allow reconnection
			await vi.advanceTimersByTimeAsync(0);

			// The second call should include Last-Event-ID
			expect(apiClient.requestStream).toHaveBeenCalledTimes(2);
			const secondCall = apiClient.requestStream.mock.calls[1];
			const options = secondCall[1] as RequestInit & {
				headers?: Record<string, string>;
			};
			expect(options.headers?.['Last-Event-ID']).toBe('25');
			closeStream2();
		});

		it('skips malformed command data without crashing', async () => {
			const goodCmd = fakeCommand({ id: 20 });
			const [stream, closeStream] = createHangingSSEStream(
				`event: command\nid: 19\ndata: NOT VALID JSON\n\nevent: command\nid: 20\ndata: ${JSON.stringify(goodCmd)}\n\n`
			);
			apiClient.requestStream.mockResolvedValue(fakeSSEResponse(stream));

			await client.start();
			await vi.advanceTimersByTimeAsync(0);

			// Only the valid command should be delivered
			expect(onCommand).toHaveBeenCalledTimes(1);
			expect(onCommand).toHaveBeenCalledWith(goodCmd);
			closeStream();
		});

		it('tracks lastSeenCommandId from SSE event ids', async () => {
			const cmd1 = fakeCommand({ id: 30 });
			const cmd2 = fakeCommand({ id: 35 });
			// First connection delivers two commands, then closes
			const stream1 = createSSEStream(
				`event: command\nid: 30\ndata: ${JSON.stringify(cmd1)}\n\nevent: command\nid: 35\ndata: ${JSON.stringify(cmd2)}\n\n`
			);
			// Second connection: hangs open
			const [stream2, closeStream2] = createHangingSSEStream(
				'event: heartbeat\ndata: \n\n'
			);

			apiClient.requestStream
				.mockResolvedValueOnce(fakeSSEResponse(stream1))
				.mockResolvedValueOnce(fakeSSEResponse(stream2));

			await client.start();
			await vi.advanceTimersByTimeAsync(0);

			// Reconnect should use the highest seen ID
			const reconnectOpts = apiClient.requestStream.mock.calls[1][1] as {
				headers?: Record<string, string>;
			};
			expect(reconnectOpts.headers?.['Last-Event-ID']).toBe('35');
			closeStream2();
		});

		it('does not send Last-Event-ID header on first connection', async () => {
			const [stream, closeStream] = createHangingSSEStream(
				'event: heartbeat\ndata: \n\n'
			);
			apiClient.requestStream.mockResolvedValue(fakeSSEResponse(stream));

			await client.start();
			await vi.advanceTimersByTimeAsync(0);

			const firstCall = apiClient.requestStream.mock.calls[0];
			const options = firstCall[1] as RequestInit & {
				headers?: Record<string, string>;
			};
			expect(options.headers?.['Last-Event-ID']).toBeUndefined();
			closeStream();
		});
	});

	// -------------------------------------------------------
	// SSE parser — parseSSEStream
	// -------------------------------------------------------

	describe('parseSSEStream()', () => {
		it('parses well-formed SSE events', async () => {
			const stream = createSSEStream(
				'event: command\ndata: {"id":1}\n\nevent: heartbeat\ndata: \n\n'
			);
			const events: Array<{ event: string; data: string; id?: string }> =
				[];

			for await (const event of getParser(client)(stream)) {
				events.push(event);
			}

			expect(events).toHaveLength(2);
			expect(events[0]).toEqual({
				event: 'command',
				data: '{"id":1}',
				id: undefined,
			});
			expect(events[1]).toEqual({
				event: 'heartbeat',
				data: '',
				id: undefined,
			});
		});

		it('handles multi-line data fields', async () => {
			const stream = createSSEStream(
				'event: command\ndata: line1\ndata: line2\ndata: line3\n\n'
			);
			const events: Array<{ event: string; data: string }> = [];

			for await (const event of getParser(client)(stream)) {
				events.push(event);
			}

			expect(events).toHaveLength(1);
			expect(events[0].data).toBe('line1\nline2\nline3');
		});

		it('handles events split across chunks', async () => {
			const stream = createMultiChunkSSEStream([
				'event: com',
				'mand\ndata: {"id":1}\n\n',
			]);
			const events: Array<{ event: string; data: string }> = [];

			for await (const event of getParser(client)(stream)) {
				events.push(event);
			}

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				event: 'command',
				data: '{"id":1}',
				id: undefined,
			});
		});

		it('handles data split across chunks mid-line', async () => {
			const stream = createMultiChunkSSEStream([
				'event: command\ndata: {"i',
				'd":42}\n\n',
			]);
			const events: Array<{ event: string; data: string }> = [];

			for await (const event of getParser(client)(stream)) {
				events.push(event);
			}

			expect(events).toHaveLength(1);
			expect(events[0].data).toBe('{"id":42}');
		});

		it('ignores comment lines', async () => {
			const stream = createSSEStream(
				': this is a comment\nevent: command\ndata: ok\n\n'
			);
			const events: Array<{ event: string; data: string }> = [];

			for await (const event of getParser(client)(stream)) {
				events.push(event);
			}

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				event: 'command',
				data: 'ok',
				id: undefined,
			});
		});

		it('preserves event id field', async () => {
			const stream = createSSEStream(
				'event: command\nid: 99\ndata: hello\n\n'
			);
			const events: Array<{ event: string; data: string; id?: string }> =
				[];

			for await (const event of getParser(client)(stream)) {
				events.push(event);
			}

			expect(events).toHaveLength(1);
			expect(events[0].id).toBe('99');
		});

		it('defaults event type to "message" when not specified', async () => {
			const stream = createSSEStream('data: hello\n\n');
			const events: Array<{ event: string; data: string }> = [];

			for await (const event of getParser(client)(stream)) {
				events.push(event);
			}

			expect(events).toHaveLength(1);
			expect(events[0].event).toBe('message');
		});

		it('handles fields without values (no colon)', async () => {
			const stream = createSSEStream('event: command\ndata\n\n');
			const events: Array<{ event: string; data: string }> = [];

			for await (const event of getParser(client)(stream)) {
				events.push(event);
			}

			expect(events).toHaveLength(1);
			expect(events[0].data).toBe('');
		});

		it('strips leading space after colon per SSE spec', async () => {
			const stream = createSSEStream('data: hello world\n\n');
			const events: Array<{ event: string; data: string }> = [];

			for await (const event of getParser(client)(stream)) {
				events.push(event);
			}

			expect(events[0].data).toBe('hello world');
		});

		it('does not strip when no leading space after colon', async () => {
			const stream = createSSEStream('data:nospace\n\n');
			const events: Array<{ event: string; data: string }> = [];

			for await (const event of getParser(client)(stream)) {
				events.push(event);
			}

			expect(events[0].data).toBe('nospace');
		});

		it('handles \\r\\n line endings', async () => {
			const stream = createSSEStream(
				'event: command\r\ndata: ok\r\n\r\n'
			);
			const events: Array<{ event: string; data: string }> = [];

			for await (const event of getParser(client)(stream)) {
				events.push(event);
			}

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				event: 'command',
				data: 'ok',
				id: undefined,
			});
		});

		it('emits no events for empty stream', async () => {
			const stream = createSSEStream('');
			const events: Array<{ event: string; data: string }> = [];

			for await (const event of getParser(client)(stream)) {
				events.push(event);
			}

			expect(events).toHaveLength(0);
		});

		it('flushes partial event at end of stream', async () => {
			// Stream ends without a trailing blank line
			const stream = createSSEStream('event: command\ndata: partial');
			const events: Array<{ event: string; data: string }> = [];

			for await (const event of getParser(client)(stream)) {
				events.push(event);
			}

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				event: 'command',
				data: 'partial',
				id: undefined,
			});
		});

		it('handles multiple events in a single chunk', async () => {
			const stream = createSSEStream(
				'event: a\ndata: 1\n\nevent: b\ndata: 2\n\nevent: c\ndata: 3\n\n'
			);
			const events: Array<{ event: string; data: string }> = [];

			for await (const event of getParser(client)(stream)) {
				events.push(event);
			}

			expect(events).toHaveLength(3);
			expect(events.map((e) => e.event)).toEqual(['a', 'b', 'c']);
			expect(events.map((e) => e.data)).toEqual(['1', '2', '3']);
		});

		it('ignores empty events (double blank lines)', async () => {
			const stream = createSSEStream(
				'event: command\ndata: first\n\n\n\nevent: command\ndata: second\n\n'
			);
			const events: Array<{ event: string; data: string }> = [];

			for await (const event of getParser(client)(stream)) {
				events.push(event);
			}

			// Two real events — the empty-line-only "events" should not yield
			expect(events).toHaveLength(2);
			expect(events[0].data).toBe('first');
			expect(events[1].data).toBe('second');
		});
	});

	// -------------------------------------------------------
	// SSE reconnection
	// -------------------------------------------------------

	describe('SSE reconnection', () => {
		it('retries with exponential backoff when connectSSE rejects', async () => {
			// connectSSE rejects (requestStream rejects) — the retry count
			// accumulates because connectSSE never succeeds to reset it.
			// Initial connect: rejected in start() → falls back to polling
			// But handleSSEDisconnect is the backoff path, which is only
			// entered from the setTimeout retry chain.
			//
			// To trigger the backoff retry chain, we need the initial connect
			// to succeed (stream opens), then the stream errors, which calls
			// handleSSEDisconnect. The subsequent retries from the setTimeout
			// call connectSSE().catch(handleSSEDisconnect). If those rejects,
			// the count accumulates.
			const errorStream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.error(new Error('Connection lost'));
				},
			});
			apiClient.requestStream.mockResolvedValueOnce(
				fakeSSEResponse(errorStream)
			);

			// Retry 1 and 2 will reject (connectSSE itself throws)
			apiClient.requestStream
				.mockRejectedValueOnce(new Error('Connection refused'))
				.mockRejectedValueOnce(new Error('Connection refused'));

			// Retry 3 succeeds
			const [goodStream, closeGoodStream] = createHangingSSEStream(
				'event: heartbeat\ndata: \n\n'
			);
			apiClient.requestStream.mockResolvedValueOnce(
				fakeSSEResponse(goodStream)
			);

			await client.start();
			// Process first stream error → handleSSEDisconnect (count=1)
			await vi.advanceTimersByTimeAsync(0);

			expect(apiClient.requestStream).toHaveBeenCalledTimes(1);

			// First retry after sseBackoffBase * 2^0 = 50ms
			// connectSSE rejects → handleSSEDisconnect (count=2)
			await vi.advanceTimersByTimeAsync(config.sseBackoffBase);
			await vi.advanceTimersByTimeAsync(0);

			expect(apiClient.requestStream).toHaveBeenCalledTimes(2);

			// Second retry: backoff = 50 * 2^1 = 100ms
			// connectSSE rejects → handleSSEDisconnect (count=3, >= max → poll)
			// But we mocked a 4th call that succeeds, which won't be reached
			// because count=3 triggers polling fallback.
			// Actually wait — let's make the 3rd call succeed instead.
			// Re-reading the logic: count goes 1, 2, then on the 3rd
			// handleSSEDisconnect call count becomes 3 which >= maxSseRetries(3)
			// so it falls back to polling. Let's verify that:
			await vi.advanceTimersByTimeAsync(config.sseBackoffBase * 2);
			await vi.advanceTimersByTimeAsync(0);

			// After count reaches maxSseRetries, it should fall back to polling
			expect(client.getTransport()).toBe('polling');
			closeGoodStream();
		});

		it('resets retry count after successful SSE connection', async () => {
			// First connection succeeds, delivers data, then closes
			const stream1 = createSSEStream('event: heartbeat\ndata: \n\n');
			// Reconnect also succeeds and hangs
			const [stream2, closeStream2] = createHangingSSEStream(
				'event: heartbeat\ndata: \n\n'
			);

			apiClient.requestStream
				.mockResolvedValueOnce(fakeSSEResponse(stream1))
				.mockResolvedValueOnce(fakeSSEResponse(stream2));

			await client.start();
			await vi.advanceTimersByTimeAsync(0);

			// After first stream ends, it reconnects immediately (not via backoff)
			// Both connections should have succeeded
			expect(apiClient.requestStream).toHaveBeenCalledTimes(2);
			expect(client.getTransport()).toBe('sse');
			closeStream2();
		});

		it('falls back to polling after maxSseRetries exceeded', async () => {
			// The initial connect succeeds but the stream errors immediately.
			// This triggers handleSSEDisconnect which retries via setTimeout.
			// Each retry has connectSSE reject (requestStream rejects),
			// which calls handleSSEDisconnect again. After maxSseRetries (3)
			// calls to handleSSEDisconnect, it falls back to polling.
			const errorStream = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.error(new Error('Connection lost'));
				},
			});
			apiClient.requestStream.mockResolvedValueOnce(
				fakeSSEResponse(errorStream)
			);

			// Retries 1 and 2 reject
			apiClient.requestStream
				.mockRejectedValueOnce(new Error('Refused'))
				.mockRejectedValueOnce(new Error('Refused'));

			// Mock listPendingCommands for the polling fallback
			apiClient.request.mockResolvedValue([]);

			await client.start();
			// Process first stream error → handleSSEDisconnect (count=1)
			await vi.advanceTimersByTimeAsync(0);

			// Retry 1: backoff = 50ms → connectSSE rejects → count=2
			await vi.advanceTimersByTimeAsync(config.sseBackoffBase);
			await vi.advanceTimersByTimeAsync(0);

			// Retry 2: backoff = 100ms → connectSSE rejects → count=3 >= max
			await vi.advanceTimersByTimeAsync(config.sseBackoffBase * 2);
			await vi.advanceTimersByTimeAsync(0);

			expect(client.getTransport()).toBe('polling');
		});

		it('falls back to polling when initial SSE connection rejects', async () => {
			apiClient.requestStream.mockRejectedValue(
				new Error('Network error')
			);
			apiClient.request.mockResolvedValue([]);

			await client.start();
			await vi.advanceTimersByTimeAsync(0);

			expect(client.getTransport()).toBe('polling');
		});

		it('attempts SSE reconnection from polling mode', async () => {
			// Initial SSE rejects
			apiClient.requestStream.mockRejectedValueOnce(
				new Error('SSE down')
			);
			apiClient.request.mockResolvedValue([]);

			await client.start();
			await vi.advanceTimersByTimeAsync(0);

			expect(client.getTransport()).toBe('polling');

			// Now set up a successful SSE for the retry (hangs open)
			const [stream, closeStream] = createHangingSSEStream(
				'event: heartbeat\ndata: \n\n'
			);
			apiClient.requestStream.mockResolvedValueOnce(
				fakeSSEResponse(stream)
			);

			// Advance to the sseRetryFromPollingInterval
			await vi.advanceTimersByTimeAsync(
				config.sseRetryFromPollingInterval
			);
			await vi.advanceTimersByTimeAsync(0);

			expect(client.getTransport()).toBe('sse');
			closeStream();
		});

		it('resumes polling when SSE retry from polling fails', async () => {
			// Initial SSE rejects
			apiClient.requestStream.mockRejectedValueOnce(
				new Error('SSE down')
			);
			apiClient.request.mockResolvedValue([]);

			await client.start();
			await vi.advanceTimersByTimeAsync(0);

			expect(client.getTransport()).toBe('polling');

			// SSE retry also fails
			apiClient.requestStream.mockRejectedValueOnce(
				new Error('Still down')
			);

			await vi.advanceTimersByTimeAsync(
				config.sseRetryFromPollingInterval
			);
			await vi.advanceTimersByTimeAsync(0);

			expect(client.getTransport()).toBe('polling');
		});
	});

	// -------------------------------------------------------
	// Polling transport
	// -------------------------------------------------------

	describe('Polling transport', () => {
		beforeEach(() => {
			// Force polling by making SSE reject
			apiClient.requestStream.mockRejectedValue(
				new Error('SSE unavailable')
			);
		});

		it('polls listPendingCommands at configured interval', async () => {
			apiClient.request.mockResolvedValue([]);

			await client.start();
			await vi.advanceTimersByTimeAsync(0);

			expect(client.getTransport()).toBe('polling');
			apiClient.request.mockClear();

			// First poll
			await vi.advanceTimersByTimeAsync(config.pollInterval);
			expect(apiClient.request).toHaveBeenCalledTimes(1);
			expect(apiClient.request).toHaveBeenCalledWith(
				'/wpce/v1/commands?status=pending'
			);

			// Second poll
			await vi.advanceTimersByTimeAsync(config.pollInterval);
			expect(apiClient.request).toHaveBeenCalledTimes(2);
		});

		it('delivers new commands via onCommand callback', async () => {
			const cmd1 = fakeCommand({ id: 1 });
			const cmd2 = fakeCommand({ id: 2 });

			apiClient.request.mockResolvedValue([cmd1, cmd2]);

			await client.start();
			await vi.advanceTimersByTimeAsync(0);

			// First poll
			await vi.advanceTimersByTimeAsync(config.pollInterval);

			expect(onCommand).toHaveBeenCalledTimes(2);
			expect(onCommand).toHaveBeenCalledWith(cmd1);
			expect(onCommand).toHaveBeenCalledWith(cmd2);
		});

		it('does not deliver duplicate commands (lastSeenCommandId tracking)', async () => {
			const cmd1 = fakeCommand({ id: 5 });
			const cmd2 = fakeCommand({ id: 10 });
			const cmd3 = fakeCommand({ id: 15 });

			// First poll: commands 5 and 10
			apiClient.request.mockResolvedValueOnce([cmd1, cmd2]);
			// Second poll: commands 5, 10 (already seen), and 15 (new)
			apiClient.request.mockResolvedValueOnce([cmd1, cmd2, cmd3]);
			// Subsequent polls: empty
			apiClient.request.mockResolvedValue([]);

			await client.start();
			await vi.advanceTimersByTimeAsync(0);

			// First poll
			await vi.advanceTimersByTimeAsync(config.pollInterval);
			expect(onCommand).toHaveBeenCalledTimes(2);

			// Second poll
			await vi.advanceTimersByTimeAsync(config.pollInterval);
			// Only cmd3 is new
			expect(onCommand).toHaveBeenCalledTimes(3);
			expect(onCommand).toHaveBeenLastCalledWith(cmd3);
		});

		it('continues polling after a network error', async () => {
			// First poll fails
			apiClient.request.mockRejectedValueOnce(new Error('Network error'));
			// Second poll succeeds
			const cmd = fakeCommand({ id: 1 });
			apiClient.request.mockResolvedValueOnce([cmd]);
			// Subsequent polls: empty
			apiClient.request.mockResolvedValue([]);

			await client.start();
			await vi.advanceTimersByTimeAsync(0);

			// First poll — error
			await vi.advanceTimersByTimeAsync(config.pollInterval);
			expect(onCommand).not.toHaveBeenCalled();

			// Second poll — succeeds
			await vi.advanceTimersByTimeAsync(config.pollInterval);
			expect(onCommand).toHaveBeenCalledTimes(1);
			expect(onCommand).toHaveBeenCalledWith(cmd);
		});

		it('does not overlap concurrent poll cycles', async () => {
			let resolveFirst!: (value: Command[]) => void;
			const slowRequest = new Promise<Command[]>((resolve) => {
				resolveFirst = resolve;
			});

			apiClient.request.mockReturnValueOnce(slowRequest);
			apiClient.request.mockResolvedValue([]);

			await client.start();
			await vi.advanceTimersByTimeAsync(0);

			// Trigger first poll (will be blocked on slowRequest)
			await vi.advanceTimersByTimeAsync(config.pollInterval);

			// While first poll is pending, advance another interval
			const callCountDuringBlock = apiClient.request.mock.calls.length;
			await vi.advanceTimersByTimeAsync(config.pollInterval);
			// No new request should have been made because polling lock is held
			expect(apiClient.request.mock.calls.length).toBe(
				callCountDuringBlock
			);

			// Now resolve the first poll
			resolveFirst([]);
			await vi.advanceTimersByTimeAsync(0);

			// Next interval should trigger a new poll
			await vi.advanceTimersByTimeAsync(config.pollInterval);
			expect(apiClient.request.mock.calls.length).toBeGreaterThan(
				callCountDuringBlock
			);
		});

		it('only delivers commands with ids greater than lastSeenCommandId', async () => {
			// Commands arrive out of order in the response
			const cmd1 = fakeCommand({ id: 3 });
			const cmd2 = fakeCommand({ id: 1 });
			const cmd3 = fakeCommand({ id: 5 });

			apiClient.request.mockResolvedValueOnce([cmd1, cmd2, cmd3]);
			apiClient.request.mockResolvedValue([]);

			await client.start();
			await vi.advanceTimersByTimeAsync(0);

			await vi.advanceTimersByTimeAsync(config.pollInterval);

			// cmd1 (id:3) is delivered because 3 > 0
			// cmd2 (id:1) is skipped because 1 < 3 (lastSeenCommandId is now 3)
			// cmd3 (id:5) is delivered because 5 > 3
			expect(onCommand).toHaveBeenCalledTimes(2);
			expect(onCommand).toHaveBeenCalledWith(cmd1);
			expect(onCommand).toHaveBeenCalledWith(cmd3);
		});
	});

	// -------------------------------------------------------
	// stop()
	// -------------------------------------------------------

	describe('stop()', () => {
		it('sets transport to none from SSE', async () => {
			const [stream, closeStream] = createHangingSSEStream(
				'event: heartbeat\ndata: \n\n'
			);
			apiClient.requestStream.mockResolvedValue(fakeSSEResponse(stream));

			await client.start();
			await vi.advanceTimersByTimeAsync(0);

			expect(client.getTransport()).toBe('sse');

			client.stop();

			expect(client.getTransport()).toBe('none');
			closeStream();
		});

		it('sets transport to none from polling', async () => {
			apiClient.requestStream.mockRejectedValue(
				new Error('SSE unavailable')
			);
			apiClient.request.mockResolvedValue([]);

			await client.start();
			await vi.advanceTimersByTimeAsync(0);

			expect(client.getTransport()).toBe('polling');

			client.stop();

			expect(client.getTransport()).toBe('none');
		});

		it('clears poll timer — no further polls fire', async () => {
			apiClient.requestStream.mockRejectedValue(
				new Error('SSE unavailable')
			);
			apiClient.request.mockResolvedValue([]);

			await client.start();
			await vi.advanceTimersByTimeAsync(0);

			expect(client.getTransport()).toBe('polling');

			client.stop();

			// No more polls should fire
			apiClient.request.mockClear();
			await vi.advanceTimersByTimeAsync(config.pollInterval * 10);
			expect(apiClient.request).not.toHaveBeenCalled();
		});

		it('clears SSE retry-from-polling timer', async () => {
			apiClient.requestStream.mockRejectedValue(
				new Error('SSE unavailable')
			);
			apiClient.request.mockResolvedValue([]);

			await client.start();
			await vi.advanceTimersByTimeAsync(0);

			expect(client.getTransport()).toBe('polling');

			client.stop();

			// Reset mocks to track new calls
			apiClient.requestStream.mockClear();

			// The sseRetryFromPollingInterval should not fire
			await vi.advanceTimersByTimeAsync(
				config.sseRetryFromPollingInterval * 2
			);
			expect(apiClient.requestStream).not.toHaveBeenCalled();
		});

		it('is safe to call multiple times', () => {
			expect(() => {
				client.stop();
				client.stop();
				client.stop();
			}).not.toThrow();

			expect(client.getTransport()).toBe('none');
		});

		it('prevents SSE reconnection after stop', async () => {
			// Stream closes immediately, triggering reconnect logic
			const stream = createSSEStream('event: heartbeat\ndata: \n\n');
			apiClient.requestStream.mockResolvedValueOnce(
				fakeSSEResponse(stream)
			);

			await client.start();
			// Let processSSEStream start consuming
			await vi.advanceTimersByTimeAsync(0);

			// Stop before any reconnect can happen
			client.stop();
			apiClient.requestStream.mockClear();

			// Advance time well past any backoff
			await vi.advanceTimersByTimeAsync(config.sseBackoffMax * 10);

			expect(apiClient.requestStream).not.toHaveBeenCalled();
		});

		it('prevents polling from starting after stop during SSE failure', async () => {
			// SSE rejects on connect
			apiClient.requestStream.mockRejectedValue(
				new Error('SSE unavailable')
			);

			// Stop immediately after start (before the rejection settles)
			const startPromise = client.start();
			client.stop();
			await startPromise;
			await vi.advanceTimersByTimeAsync(0);

			expect(client.getTransport()).toBe('none');

			// No polls should happen
			apiClient.request.mockClear();
			await vi.advanceTimersByTimeAsync(config.pollInterval * 10);
			expect(apiClient.request).not.toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------
	// getTransport()
	// -------------------------------------------------------

	describe('getTransport()', () => {
		it('returns none before start', () => {
			expect(client.getTransport()).toBe('none');
		});

		it('returns sse when connected via SSE', async () => {
			const [stream, closeStream] = createHangingSSEStream(
				'event: heartbeat\ndata: \n\n'
			);
			apiClient.requestStream.mockResolvedValue(fakeSSEResponse(stream));

			await client.start();
			await vi.advanceTimersByTimeAsync(0);

			expect(client.getTransport()).toBe('sse');
			closeStream();
		});

		it('returns polling when SSE is unavailable', async () => {
			apiClient.requestStream.mockRejectedValue(
				new Error('SSE unavailable')
			);
			apiClient.request.mockResolvedValue([]);

			await client.start();
			await vi.advanceTimersByTimeAsync(0);

			expect(client.getTransport()).toBe('polling');
		});

		it('returns none after stop', async () => {
			const [stream, closeStream] = createHangingSSEStream(
				'event: heartbeat\ndata: \n\n'
			);
			apiClient.requestStream.mockResolvedValue(fakeSSEResponse(stream));

			await client.start();
			await vi.advanceTimersByTimeAsync(0);

			client.stop();
			expect(client.getTransport()).toBe('none');
			closeStream();
		});
	});

	// -------------------------------------------------------
	// SSE error handling edge cases
	// -------------------------------------------------------

	describe('SSE error handling', () => {
		it('falls back to polling when response has no body', async () => {
			const noBodyResponse = {
				ok: true,
				status: 200,
				statusText: 'OK',
				body: null,
				headers: new Headers(),
			} as unknown as Response;

			// connectSSE throws "SSE response has no body" — triggers
			// handleSSEDisconnect on each retry, then falls back to polling.
			apiClient.requestStream.mockResolvedValue(noBodyResponse);
			apiClient.request.mockResolvedValue([]);

			await client.start();
			await vi.advanceTimersByTimeAsync(0);

			// start() caught the initial rejection and fell back to polling
			expect(client.getTransport()).toBe('polling');
		});
	});
});
