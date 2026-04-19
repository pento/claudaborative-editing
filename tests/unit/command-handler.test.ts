import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import { CommandHandler } from '../../src/session/command-handler.js';
import type {
	ChannelNotifier,
	ContentProvider,
	PreOpenHandler,
} from '../../src/session/command-handler.js';
import { WordPressApiError } from '../../src/wordpress/api-client.js';
import type { WordPressApiClient } from '../../src/wordpress/api-client.js';
import type {
	Command,
	PluginStatus,
} from '../../src/wordpress/command-client.js';

// --- Mocks ---

vi.mock('../../src/wordpress/command-client.js', async (importOriginal) => {
	const original =
		await importOriginal<
			typeof import('../../src/wordpress/command-client.js')
		>();
	return {
		CommandClient: vi.fn(),
		SUPPORTED_PROTOCOL_VERSIONS: original.SUPPORTED_PROTOCOL_VERSIONS,
		isProtocolCompatible: original.isProtocolCompatible,
	};
});

// Import the mocked constructor so we can configure instances
import { CommandClient } from '../../src/wordpress/command-client.js';

const MockedCommandClient = vi.mocked(CommandClient);

/** Flush the microtask queue so fire-and-forget async chains complete. */
function flushMicrotasks(): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, 0);
	});
}

/**
 * Helper: builds a mock CommandClient instance and wires it into the
 * constructor mock.  Returns the instance and `dispatchCommand` /
 * `dispatchResponse` helpers that invoke the captured callbacks and
 * flush microtasks so the async handler chains complete before assertions.
 */
function setupMockCommandClient(pluginStatusResult?: {
	resolve?: PluginStatus;
	reject?: Error;
}) {
	let capturedOnCommand: ((command: Command) => void) | null = null;
	let capturedOnResponse: ((command: Command) => void) | null = null;

	const instance = {
		getPluginStatus: vi.fn<() => Promise<PluginStatus>>(),
		startObserving: vi.fn(),
		stop: vi.fn(),
		updateCommandStatus: vi
			.fn<
				(
					id: number,
					status: string,
					message?: string,
					resultData?: string
				) => Promise<Command>
			>()
			.mockResolvedValue(makeCommand()),
		getTransport: vi.fn<() => 'yjs' | 'none'>().mockReturnValue('yjs'),
	};

	if (pluginStatusResult?.resolve) {
		instance.getPluginStatus.mockResolvedValue(pluginStatusResult.resolve);
	} else if (pluginStatusResult?.reject) {
		instance.getPluginStatus.mockRejectedValue(pluginStatusResult.reject);
	}

	// Use a regular function so it can be called with `new`.
	MockedCommandClient.mockImplementation(function mockCtor(
		_api: WordPressApiClient,
		onCommand: (command: Command) => void,
		onResponse: (command: Command) => void
	) {
		capturedOnCommand = onCommand;
		capturedOnResponse = onResponse;
		return instance as unknown as CommandClient;
	} as unknown as typeof CommandClient);

	/**
	 * Dispatch a command through the captured onCommand callback and
	 * flush microtasks so the async `handleCommand` promise chain
	 * (notify -> catch) runs to completion before returning.
	 */
	async function dispatchCommand(command: Command): Promise<void> {
		if (!capturedOnCommand) {
			throw new Error(
				'onCommand callback was not captured — did you call handler.start()?'
			);
		}
		capturedOnCommand(command);
		await flushMicrotasks();
	}

	/**
	 * Dispatch a response through the captured onResponse callback and
	 * flush microtasks so the async `handleResponse` promise chain
	 * runs to completion before returning.
	 */
	async function dispatchResponse(command: Command): Promise<void> {
		if (!capturedOnResponse) {
			throw new Error(
				'onResponse callback was not captured — did you call handler.start()?'
			);
		}
		capturedOnResponse(command);
		await flushMicrotasks();
	}

	return { instance, dispatchCommand, dispatchResponse };
}

function makePluginStatus(overrides?: Partial<PluginStatus>): PluginStatus {
	return {
		version: '1.0.0',
		protocol_version: 1,
		mcp_connected: false,
		mcp_last_seen_at: null,
		...overrides,
	};
}

function makeCommand(overrides?: Partial<Command>): Command {
	return {
		id: 42,
		post_id: 100,
		prompt: 'proofread',
		arguments: {},
		status: 'pending',
		user_id: 1,
		claimed_by: null,
		message: null,
		created_at: '2026-01-01T00:00:00Z',
		updated_at: '2026-01-01T00:00:00Z',
		expires_at: '2026-01-01T01:00:00Z',
		...overrides,
	};
}

function createMockApiClient(): WordPressApiClient {
	return {} as WordPressApiClient;
}

function createCommandMap(): Y.Map<unknown> {
	const doc = new Y.Doc();
	return doc.getMap('document');
}

// --- Tests ---

describe('CommandHandler', () => {
	let handler: CommandHandler;

	beforeEach(() => {
		MockedCommandClient.mockReset();
		handler = new CommandHandler();
	});

	afterEach(() => {
		handler.stop();
	});

	// ---------------------------------------------------------------
	// start()
	// ---------------------------------------------------------------
	describe('start()', () => {
		it('returns true when plugin is detected', async () => {
			const status = makePluginStatus();
			setupMockCommandClient({ resolve: status });

			const result = await handler.start(
				createMockApiClient(),
				createCommandMap()
			);

			expect(result).toBe(true);
			expect(handler.getPluginStatus()).toEqual(status);
		});

		it('calls CommandClient.startObserving() when plugin is detected', async () => {
			const { instance } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});
			const commandMap = createCommandMap();

			await handler.start(createMockApiClient(), commandMap);

			expect(instance.startObserving).toHaveBeenCalledOnce();
			expect(instance.startObserving).toHaveBeenCalledWith(commandMap);
		});

		it('passes apiClient and callbacks to CommandClient constructor', async () => {
			setupMockCommandClient({ resolve: makePluginStatus() });
			const apiClient = createMockApiClient();

			await handler.start(apiClient, createCommandMap());

			expect(MockedCommandClient).toHaveBeenCalledWith(
				apiClient,
				expect.any(Function),
				expect.any(Function)
			);
		});

		it('returns false when plugin returns 404 (not installed)', async () => {
			setupMockCommandClient({
				reject: new WordPressApiError('Not Found', 404, ''),
			});

			const result = await handler.start(
				createMockApiClient(),
				createCommandMap()
			);

			expect(result).toBe(false);
			expect(handler.getPluginStatus()).toBeNull();
		});

		it('throws on non-404 API errors', async () => {
			setupMockCommandClient({
				reject: new WordPressApiError('Internal Server Error', 500, ''),
			});

			await expect(
				handler.start(createMockApiClient(), createCommandMap())
			).rejects.toThrow('Internal Server Error');
		});

		it('throws on generic errors', async () => {
			setupMockCommandClient({
				reject: new Error('Network failure'),
			});

			await expect(
				handler.start(createMockApiClient(), createCommandMap())
			).rejects.toThrow('Network failure');
		});
	});

	// ---------------------------------------------------------------
	// Protocol version negotiation
	// ---------------------------------------------------------------
	describe('protocol version negotiation', () => {
		it('starts observation when protocol version is compatible', async () => {
			const { instance } = setupMockCommandClient({
				resolve: makePluginStatus({ protocol_version: 1 }),
			});

			const result = await handler.start(
				createMockApiClient(),
				createCommandMap()
			);

			expect(result).toBe(true);
			expect(instance.startObserving).toHaveBeenCalledOnce();
			expect(handler.getProtocolWarning()).toBeNull();
		});

		it('does not start observation when protocol is incompatible', async () => {
			const { instance } = setupMockCommandClient({
				resolve: makePluginStatus({ protocol_version: 99 }),
			});

			const result = await handler.start(
				createMockApiClient(),
				createCommandMap()
			);

			expect(result).toBe(true); // plugin IS detected
			expect(instance.startObserving).not.toHaveBeenCalled();
			expect(handler.getPluginStatus()).not.toBeNull();
		});

		it('stores warning suggesting MCP update when plugin version is higher', async () => {
			setupMockCommandClient({
				resolve: makePluginStatus({ protocol_version: 99 }),
			});

			await handler.start(createMockApiClient(), createCommandMap());

			const warning = handler.getProtocolWarning();
			expect(warning).toContain('protocol v99');
			expect(warning).toContain('Update the MCP server.');
		});

		it('stores warning suggesting plugin update when MCP version is higher', async () => {
			setupMockCommandClient({
				resolve: makePluginStatus({ protocol_version: 0 }),
			});

			await handler.start(createMockApiClient(), createCommandMap());

			const warning = handler.getProtocolWarning();
			expect(warning).toContain('protocol v0');
			expect(warning).toContain('Update the WordPress plugin.');
		});

		it('reports transport as disabled when protocol is incompatible', async () => {
			setupMockCommandClient({
				resolve: makePluginStatus({ protocol_version: 99 }),
			});

			await handler.start(createMockApiClient(), createCommandMap());

			expect(handler.getTransport()).toBe('disabled');
		});

		it('clears protocol warning on stop', async () => {
			setupMockCommandClient({
				resolve: makePluginStatus({ protocol_version: 99 }),
			});

			await handler.start(createMockApiClient(), createCommandMap());
			expect(handler.getProtocolWarning()).not.toBeNull();

			handler.stop();
			expect(handler.getProtocolWarning()).toBeNull();
		});
	});

	// ---------------------------------------------------------------
	// Command notification
	// ---------------------------------------------------------------
	describe('command notification', () => {
		it('sends notification for incoming command', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);
			await handler.start(createMockApiClient(), createCommandMap());

			const command = makeCommand({
				id: 7,
				post_id: 55,
				prompt: 'review',
			});
			await dispatchCommand(command);

			expect(notifier).toHaveBeenCalledOnce();

			const notification = notifier.mock.calls[0][0];
			expect(notification.content).toBe(
				'User requested: review on post #55.'
			);
			expect(notification.meta).toEqual({
				command_id: '7',
				prompt: 'review',
				post_id: '55',
			});
		});

		it('includes arguments description when command has arguments', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);
			await handler.start(createMockApiClient(), createCommandMap());

			const command = makeCommand({
				id: 10,
				post_id: 200,
				prompt: 'translate',
				arguments: { language: 'French' },
			});
			await dispatchCommand(command);

			const notification = notifier.mock.calls[0][0];
			expect(notification.content).toBe(
				'User requested: translate on post #200. Arguments: language: French.'
			);
			expect(notification.meta.arguments).toBe(
				JSON.stringify({ language: 'French' })
			);
		});

		it('does not include arguments key in meta when no arguments', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);
			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(makeCommand({ arguments: {} }));

			const notification = notifier.mock.calls[0][0];
			expect(notification.meta).not.toHaveProperty('arguments');
		});
	});

	// ---------------------------------------------------------------
	// Notification buffering
	// ---------------------------------------------------------------
	describe('notification buffering', () => {
		it('buffers notifications when no notifier is set', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			// Start without setting a notifier
			await handler.start(createMockApiClient(), createCommandMap());

			// Dispatch a command — should be buffered
			await dispatchCommand(
				makeCommand({ id: 1, prompt: 'proofread', post_id: 10 })
			);

			// Now set the notifier — buffered notification should flush
			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			expect(notifier).toHaveBeenCalledOnce();
			expect(notifier.mock.calls[0][0].content).toBe(
				'User requested: proofread on post #10.'
			);
		});

		it('buffers multiple notifications and flushes all on setNotifier', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({ id: 1, prompt: 'proofread', post_id: 10 })
			);
			await dispatchCommand(
				makeCommand({ id: 2, prompt: 'review', post_id: 20 })
			);

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			expect(notifier).toHaveBeenCalledTimes(2);
			expect(notifier.mock.calls[0][0].meta.command_id).toBe('1');
			expect(notifier.mock.calls[1][0].meta.command_id).toBe('2');
		});
	});

	// ---------------------------------------------------------------
	// setNotifier
	// ---------------------------------------------------------------
	describe('setNotifier()', () => {
		it('flushes pending notifications on set', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			await handler.start(createMockApiClient(), createCommandMap());
			await dispatchCommand(makeCommand({ id: 5 }));

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			expect(notifier).toHaveBeenCalledOnce();
			expect(notifier.mock.calls[0][0].meta.command_id).toBe('5');
		});

		it('sends subsequent commands directly to notifier', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);
			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({ id: 11, prompt: 'edit', post_id: 300 })
			);

			expect(notifier).toHaveBeenCalledOnce();
			expect(notifier.mock.calls[0][0].content).toBe(
				'User requested: edit on post #300.'
			);
		});

		it('handles notifier errors gracefully on flush', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			await handler.start(createMockApiClient(), createCommandMap());
			await dispatchCommand(makeCommand({ id: 1 }));
			await dispatchCommand(makeCommand({ id: 2 }));

			// Notifier that rejects — should not throw
			const notifier = vi
				.fn<ChannelNotifier>()
				.mockRejectedValue(new Error('delivery failed'));
			handler.setNotifier(notifier);

			// Both should still be attempted
			expect(notifier).toHaveBeenCalledTimes(2);
		});

		it('handles notifier errors gracefully on direct send', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const consoleSpy = vi
				.spyOn(console, 'error')
				.mockImplementation(() => {});
			const notifier = vi
				.fn<ChannelNotifier>()
				.mockRejectedValue(new Error('delivery failed'));
			handler.setNotifier(notifier);
			await handler.start(createMockApiClient(), createCommandMap());

			// The onCommand callback uses `void this.handleCommand(command)`,
			// so dispatchCommand flushes microtasks to let the async chain
			// (notify -> catch) complete before we assert.
			await dispatchCommand(makeCommand({ id: 77 }));

			expect(notifier).toHaveBeenCalledOnce();
			expect(consoleSpy).toHaveBeenCalledWith(
				'Failed to send channel notification for command 77'
			);
			consoleSpy.mockRestore();
		});
	});

	// ---------------------------------------------------------------
	// stop()
	// ---------------------------------------------------------------
	describe('stop()', () => {
		it('calls CommandClient.stop()', async () => {
			const { instance } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			await handler.start(createMockApiClient(), createCommandMap());
			handler.stop();

			expect(instance.stop).toHaveBeenCalledOnce();
		});

		it('returns transport as disabled after stop', async () => {
			setupMockCommandClient({ resolve: makePluginStatus() });

			await handler.start(createMockApiClient(), createCommandMap());
			handler.stop();

			expect(handler.getTransport()).toBe('disabled');
		});

		it('clears plugin status after stop', async () => {
			setupMockCommandClient({ resolve: makePluginStatus() });

			await handler.start(createMockApiClient(), createCommandMap());
			expect(handler.getPluginStatus()).not.toBeNull();

			handler.stop();
			expect(handler.getPluginStatus()).toBeNull();
		});

		it('silently ignores commands dispatched after stop', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);
			await handler.start(createMockApiClient(), createCommandMap());
			handler.stop();

			// Dispatch after stop — should be silently ignored
			await dispatchCommand(makeCommand({ id: 99 }));

			expect(notifier).not.toHaveBeenCalled();
		});

		it('clears pending notifications on stop', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			await handler.start(createMockApiClient(), createCommandMap());
			await dispatchCommand(makeCommand());

			handler.stop();

			// Set notifier after stop — should get nothing
			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			expect(notifier).not.toHaveBeenCalled();
		});

		it('is safe to call multiple times', async () => {
			const { instance } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			await handler.start(createMockApiClient(), createCommandMap());
			handler.stop();
			handler.stop(); // second call should not throw

			expect(instance.stop).toHaveBeenCalledOnce();
		});

		it('is safe to call without start', () => {
			expect(() => {
				handler.stop();
			}).not.toThrow();
		});
	});

	// ---------------------------------------------------------------
	// updateCommandStatus
	// ---------------------------------------------------------------
	describe('updateCommandStatus()', () => {
		it('delegates to CommandClient', async () => {
			const { instance } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});
			instance.updateCommandStatus.mockResolvedValue(
				makeCommand({ status: 'completed' })
			);

			await handler.start(createMockApiClient(), createCommandMap());
			await handler.updateCommandStatus(42, 'completed', 'All done');

			expect(instance.updateCommandStatus).toHaveBeenCalledWith(
				42,
				'completed',
				'All done',
				undefined
			);
		});

		it('delegates resultData to CommandClient', async () => {
			const { instance } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});
			instance.updateCommandStatus.mockResolvedValue(
				makeCommand({ status: 'completed' })
			);

			await handler.start(createMockApiClient(), createCommandMap());
			await handler.updateCommandStatus(
				42,
				'completed',
				'Done',
				'{"foo":"bar"}'
			);

			expect(instance.updateCommandStatus).toHaveBeenCalledWith(
				42,
				'completed',
				'Done',
				'{"foo":"bar"}'
			);
		});

		it('delegates without message when not provided', async () => {
			const { instance } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});
			instance.updateCommandStatus.mockResolvedValue(
				makeCommand({ status: 'running' })
			);

			await handler.start(createMockApiClient(), createCommandMap());
			await handler.updateCommandStatus(42, 'running');

			expect(instance.updateCommandStatus).toHaveBeenCalledWith(
				42,
				'running',
				undefined,
				undefined
			);
		});

		it('throws when commandClient is null (not started)', async () => {
			await expect(
				handler.updateCommandStatus(1, 'completed')
			).rejects.toThrow(
				'WordPress editor plugin is not connected. Command features are not available.'
			);
		});

		it('throws when commandClient is null (after stop)', async () => {
			setupMockCommandClient({ resolve: makePluginStatus() });

			await handler.start(createMockApiClient(), createCommandMap());
			handler.stop();

			await expect(
				handler.updateCommandStatus(1, 'completed')
			).rejects.toThrow(
				'WordPress editor plugin is not connected. Command features are not available.'
			);
		});
	});

	// ---------------------------------------------------------------
	// getPluginStatus
	// ---------------------------------------------------------------
	describe('getPluginStatus()', () => {
		it('returns null before start', () => {
			expect(handler.getPluginStatus()).toBeNull();
		});

		it('returns plugin status after successful start', async () => {
			const status = makePluginStatus({
				version: '2.0.0',
				mcp_connected: true,
			});
			setupMockCommandClient({ resolve: status });

			await handler.start(createMockApiClient(), createCommandMap());

			expect(handler.getPluginStatus()).toEqual(status);
		});

		it('returns null after failed start (404)', async () => {
			setupMockCommandClient({
				reject: new WordPressApiError('Not Found', 404, ''),
			});

			await handler.start(createMockApiClient(), createCommandMap());

			expect(handler.getPluginStatus()).toBeNull();
		});
	});

	// ---------------------------------------------------------------
	// getTransport
	// ---------------------------------------------------------------
	describe('getTransport()', () => {
		it('returns disabled before start', () => {
			expect(handler.getTransport()).toBe('disabled');
		});

		it('returns disabled when plugin not found', async () => {
			setupMockCommandClient({
				reject: new WordPressApiError('Not Found', 404, ''),
			});

			await handler.start(createMockApiClient(), createCommandMap());

			expect(handler.getTransport()).toBe('disabled');
		});

		it('delegates to CommandClient when started', async () => {
			const { instance } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});
			instance.getTransport.mockReturnValue('yjs');

			await handler.start(createMockApiClient(), createCommandMap());

			expect(handler.getTransport()).toBe('yjs');
		});
	});

	// ---------------------------------------------------------------
	// Response notification
	// ---------------------------------------------------------------
	describe('response notification', () => {
		it('sends notification for incoming response with user message', async () => {
			const { dispatchResponse } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);
			await handler.start(createMockApiClient(), createCommandMap());

			const command = makeCommand({
				id: 7,
				post_id: 55,
				prompt: 'proofread',
				status: 'running',
				result_data: {
					messages: [
						{ role: 'assistant', content: 'I fixed the typos.' },
						{
							role: 'user',
							content: 'Can you also check paragraph 3?',
						},
					],
				},
			});
			await dispatchResponse(command);

			expect(notifier).toHaveBeenCalledOnce();

			const notification = notifier.mock.calls[0][0];
			expect(notification.content).toBe(
				'User responded to proofread command #7: "Can you also check paragraph 3?"'
			);
			expect(notification.meta).toEqual({
				command_id: '7',
				prompt: 'proofread',
				post_id: '55',
				event_type: 'response',
				messages: JSON.stringify([
					{ role: 'assistant', content: 'I fixed the typos.' },
					{
						role: 'user',
						content: 'Can you also check paragraph 3?',
					},
				]),
			});
		});

		it('uses "(no message)" when messages array has no user role', async () => {
			const { dispatchResponse } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);
			await handler.start(createMockApiClient(), createCommandMap());

			const command = makeCommand({
				id: 8,
				post_id: 60,
				prompt: 'review',
				status: 'running',
				result_data: {
					messages: [
						{ role: 'assistant', content: 'Review complete.' },
					],
				},
			});
			await dispatchResponse(command);

			const notification = notifier.mock.calls[0][0];
			expect(notification.content).toBe(
				'User responded to review command #8: "(no message)"'
			);
		});

		it('uses "(no message)" when result_data has no messages', async () => {
			const { dispatchResponse } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);
			await handler.start(createMockApiClient(), createCommandMap());

			const command = makeCommand({
				id: 9,
				post_id: 70,
				prompt: 'edit',
				status: 'running',
				result_data: { some_other_field: true },
			});
			await dispatchResponse(command);

			const notification = notifier.mock.calls[0][0];
			expect(notification.content).toBe(
				'User responded to edit command #9: "(no message)"'
			);
			// meta should not have messages key when messages is undefined
			expect(notification.meta).not.toHaveProperty('messages');
		});

		it('extracts the last user message from multiple user messages', async () => {
			const { dispatchResponse } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);
			await handler.start(createMockApiClient(), createCommandMap());

			const command = makeCommand({
				id: 11,
				post_id: 80,
				prompt: 'translate',
				status: 'running',
				result_data: {
					messages: [
						{ role: 'user', content: 'Translate to French' },
						{ role: 'assistant', content: 'Done.' },
						{
							role: 'user',
							content: 'Actually, translate to Spanish instead',
						},
					],
				},
			});
			await dispatchResponse(command);

			const notification = notifier.mock.calls[0][0];
			expect(notification.content).toBe(
				'User responded to translate command #11: "Actually, translate to Spanish instead"'
			);
		});

		it('includes event_type: response in meta', async () => {
			const { dispatchResponse } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);
			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchResponse(
				makeCommand({
					id: 12,
					post_id: 90,
					prompt: 'proofread',
					status: 'running',
					result_data: {
						messages: [{ role: 'user', content: 'Thanks' }],
					},
				})
			);

			const notification = notifier.mock.calls[0][0];
			expect(notification.meta.event_type).toBe('response');
		});

		it('falls back to command.message when no user messages exist', async () => {
			const { dispatchResponse } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);
			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchResponse(
				makeCommand({
					id: 13,
					post_id: 100,
					prompt: 'edit',
					status: 'running',
					message: 'Please fix the intro',
					result_data: {
						messages: [
							{ role: 'assistant', content: 'Working on it.' },
						],
					},
				})
			);

			const notification = notifier.mock.calls[0][0];
			expect(notification.content).toBe(
				'User responded to edit command #13: "Please fix the intro"'
			);
		});
	});

	// ---------------------------------------------------------------
	// Auto-claim (Phase 3)
	// ---------------------------------------------------------------
	describe('auto-claim', () => {
		it('channelsVerified starts as false', () => {
			expect(handler.channelsVerified).toBe(false);
		});

		it('channelsVerified becomes true after a successful updateCommandStatus call', async () => {
			const { instance } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});
			instance.updateCommandStatus.mockResolvedValue(
				makeCommand({ status: 'running' })
			);

			await handler.start(createMockApiClient(), createCommandMap());
			expect(handler.channelsVerified).toBe(false);

			await handler.updateCommandStatus(1, 'running');
			expect(handler.channelsVerified).toBe(true);
		});

		it('auto-claims command when channelsVerified is true', async () => {
			const { instance, dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});
			instance.updateCommandStatus.mockResolvedValue(
				makeCommand({ status: 'running' })
			);

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);
			await handler.start(createMockApiClient(), createCommandMap());

			// Verify channels first
			await handler.updateCommandStatus(1, 'running');
			expect(handler.channelsVerified).toBe(true);
			instance.updateCommandStatus.mockClear();

			// Dispatch a new command — should auto-claim
			const command = makeCommand({
				id: 50,
				post_id: 200,
				prompt: 'review',
			});
			await dispatchCommand(command);

			expect(instance.updateCommandStatus).toHaveBeenCalledWith(
				50,
				'running'
			);
		});

		it('sets meta.status to already_claimed when auto-claim succeeds', async () => {
			const { instance, dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});
			instance.updateCommandStatus.mockResolvedValue(
				makeCommand({ status: 'running' })
			);

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);
			await handler.start(createMockApiClient(), createCommandMap());

			// Verify channels
			await handler.updateCommandStatus(1, 'running');
			instance.updateCommandStatus.mockClear();
			instance.updateCommandStatus.mockResolvedValue(
				makeCommand({ status: 'running' })
			);

			await dispatchCommand(
				makeCommand({ id: 50, post_id: 200, prompt: 'review' })
			);

			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];
			expect(notification.meta.status).toBe('already_claimed');
		});

		it('sends no notification when auto-claim gets a 409 conflict', async () => {
			const { instance, dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});
			instance.updateCommandStatus.mockResolvedValue(
				makeCommand({ status: 'running' })
			);

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);
			await handler.start(createMockApiClient(), createCommandMap());

			// Verify channels
			await handler.updateCommandStatus(1, 'running');
			instance.updateCommandStatus.mockClear();

			// Next auto-claim attempt returns 409
			instance.updateCommandStatus.mockRejectedValue(
				new WordPressApiError('Conflict', 409, '')
			);

			await dispatchCommand(
				makeCommand({ id: 60, post_id: 300, prompt: 'proofread' })
			);

			expect(notifier).not.toHaveBeenCalled();
		});

		it('falls back to manual claim notification when auto-claim gets a non-409 error', async () => {
			const { instance, dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});
			instance.updateCommandStatus.mockResolvedValue(
				makeCommand({ status: 'running' })
			);

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);
			await handler.start(createMockApiClient(), createCommandMap());

			// Verify channels
			await handler.updateCommandStatus(1, 'running');
			instance.updateCommandStatus.mockClear();

			// Next auto-claim attempt returns a generic error
			instance.updateCommandStatus.mockRejectedValue(
				new Error('Network failure')
			);

			await dispatchCommand(
				makeCommand({ id: 70, post_id: 400, prompt: 'proofread' })
			);

			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];
			// Should NOT have the already_claimed status
			expect(notification.meta).not.toHaveProperty('status');
		});

		it('falls back to manual claim when auto-claim gets a non-409 WordPressApiError', async () => {
			const { instance, dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});
			instance.updateCommandStatus.mockResolvedValue(
				makeCommand({ status: 'running' })
			);

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);
			await handler.start(createMockApiClient(), createCommandMap());

			// Verify channels
			await handler.updateCommandStatus(1, 'running');
			instance.updateCommandStatus.mockClear();

			// Next auto-claim attempt returns 500
			instance.updateCommandStatus.mockRejectedValue(
				new WordPressApiError('Internal Server Error', 500, '')
			);

			await dispatchCommand(
				makeCommand({ id: 80, post_id: 500, prompt: 'edit' })
			);

			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];
			expect(notification.meta).not.toHaveProperty('status');
		});

		it('does not auto-claim when channelsVerified is false', async () => {
			const { instance, dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);
			await handler.start(createMockApiClient(), createCommandMap());

			expect(handler.channelsVerified).toBe(false);

			await dispatchCommand(
				makeCommand({ id: 90, post_id: 600, prompt: 'proofread' })
			);

			// updateCommandStatus should NOT have been called for auto-claim
			expect(instance.updateCommandStatus).not.toHaveBeenCalled();

			// Notification should still be sent
			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];
			expect(notification.meta).not.toHaveProperty('status');
		});

		it('stop() resets channelsVerified to false', async () => {
			const { instance } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});
			instance.updateCommandStatus.mockResolvedValue(
				makeCommand({ status: 'running' })
			);

			await handler.start(createMockApiClient(), createCommandMap());
			await handler.updateCommandStatus(1, 'running');
			expect(handler.channelsVerified).toBe(true);

			handler.stop();
			expect(handler.channelsVerified).toBe(false);
		});

		it('does not auto-claim signal commands (open-post) even when channelsVerified is true', async () => {
			const { instance, dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});
			instance.updateCommandStatus.mockResolvedValue(
				makeCommand({ status: 'running' })
			);

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);
			await handler.start(createMockApiClient(), createCommandMap());

			// Verify channels first
			await handler.updateCommandStatus(1, 'running');
			expect(handler.channelsVerified).toBe(true);
			instance.updateCommandStatus.mockClear();

			// Dispatch an open-post command — should NOT auto-claim
			await dispatchCommand(
				makeCommand({
					id: 100,
					post_id: 700,
					prompt: 'open-post' as Command['prompt'],
				})
			);

			// updateCommandStatus should NOT have been called for auto-claim
			expect(instance.updateCommandStatus).not.toHaveBeenCalled();

			// Notification should still be sent
			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];
			expect(notification.meta).not.toHaveProperty('status');
		});
	});

	// ---------------------------------------------------------------
	// Content embedding (Phase 4)
	// ---------------------------------------------------------------
	describe('content embedding', () => {
		it('embeds content when content provider returns a snapshot for proofread', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			const contentProvider: ContentProvider = vi
				.fn<ContentProvider>()
				.mockResolvedValue({
					postId: 50,
					postContent: 'Hello world post content',
					notesSupported: false,
				});
			handler.setContentProvider(contentProvider);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({ id: 10, post_id: 50, prompt: 'proofread' })
			);

			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];

			// buildProofreadContent includes "grammar" in its instructions
			expect(notification.content).toContain('grammar');
			expect(notification.content).toContain('Hello world post content');
			expect(notification.meta.content_embedded).toBe('true');
		});

		it('falls back to minimal notification when content provider returns null', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			const contentProvider: ContentProvider = vi
				.fn<ContentProvider>()
				.mockResolvedValue(null);
			handler.setContentProvider(contentProvider);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({ id: 11, post_id: 60, prompt: 'proofread' })
			);

			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];
			expect(notification.content).toBe(
				'User requested: proofread on post #60.'
			);
			expect(notification.meta).not.toHaveProperty('content_embedded');
		});

		it('falls back when snapshot postId does not match command post_id', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			// Snapshot is for post 999, but command targets post 60.
			const contentProvider: ContentProvider = vi
				.fn<ContentProvider>()
				.mockResolvedValue({
					postId: 999,
					postContent: 'Wrong post content',
					notesSupported: false,
				});
			handler.setContentProvider(contentProvider);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({ id: 11, post_id: 60, prompt: 'proofread' })
			);

			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];
			expect(notification.content).toBe(
				'User requested: proofread on post #60.'
			);
			expect(notification.meta).not.toHaveProperty('content_embedded');
		});

		it('falls back to minimal notification when content provider throws', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			const contentProvider: ContentProvider = vi
				.fn<ContentProvider>()
				.mockRejectedValue(new Error('Failed to read post'));
			handler.setContentProvider(contentProvider);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({ id: 12, post_id: 70, prompt: 'proofread' })
			);

			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];
			expect(notification.content).toBe(
				'User requested: proofread on post #70.'
			);
			expect(notification.meta).not.toHaveProperty('content_embedded');
		});

		it('falls back to minimal notification when no content provider is set', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);
			// No setContentProvider call

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({ id: 13, post_id: 80, prompt: 'proofread' })
			);

			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];
			expect(notification.content).toBe(
				'User requested: proofread on post #80.'
			);
			expect(notification.meta).not.toHaveProperty('content_embedded');
		});

		it('embeds content for translate command with language argument', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			const contentProvider: ContentProvider = vi
				.fn<ContentProvider>()
				.mockResolvedValue({
					postId: 90,
					postContent: 'Some post content',
					notesSupported: false,
				});
			handler.setContentProvider(contentProvider);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({
					id: 14,
					post_id: 90,
					prompt: 'translate',
					arguments: { language: 'French' },
				})
			);

			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];
			expect(notification.content).toContain('French');
			expect(notification.content).toContain('Some post content');
			expect(notification.meta.content_embedded).toBe('true');
		});

		it('falls back for edit command when editingFocus argument is missing', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			const contentProvider: ContentProvider = vi
				.fn<ContentProvider>()
				.mockResolvedValue({
					postId: 100,
					postContent: 'Some post content',
					notesSupported: false,
				});
			handler.setContentProvider(contentProvider);

			await handler.start(createMockApiClient(), createCommandMap());

			// edit command without editingFocus — buildEmbeddedContent returns null
			await dispatchCommand(
				makeCommand({
					id: 15,
					post_id: 100,
					prompt: 'edit',
					arguments: {},
				})
			);

			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];
			expect(notification.content).toBe(
				'User requested: edit on post #100.'
			);
			expect(notification.meta).not.toHaveProperty('content_embedded');
		});

		it('falls back for translate command when language argument is missing', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			const contentProvider: ContentProvider = vi
				.fn<ContentProvider>()
				.mockResolvedValue({
					postId: 100,
					postContent: 'Some post content',
					notesSupported: false,
				});
			handler.setContentProvider(contentProvider);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({
					id: 16,
					post_id: 100,
					prompt: 'translate',
					arguments: {},
				})
			);

			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];
			expect(notification.content).toBe(
				'User requested: translate on post #100.'
			);
			expect(notification.meta).not.toHaveProperty('content_embedded');
		});

		it('embeds content with auto-claim when both features are active', async () => {
			const { instance, dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});
			instance.updateCommandStatus.mockResolvedValue(
				makeCommand({ status: 'running' })
			);

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			const contentProvider: ContentProvider = vi
				.fn<ContentProvider>()
				.mockResolvedValue({
					postId: 150,
					postContent: 'My post text',
					notesSupported: false,
				});
			handler.setContentProvider(contentProvider);

			await handler.start(createMockApiClient(), createCommandMap());

			// Verify channels
			await handler.updateCommandStatus(1, 'running');
			instance.updateCommandStatus.mockClear();
			instance.updateCommandStatus.mockResolvedValue(
				makeCommand({ status: 'running' })
			);

			await dispatchCommand(
				makeCommand({ id: 20, post_id: 150, prompt: 'proofread' })
			);

			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];

			// Both auto-claim and content embedding should be active
			expect(notification.meta.status).toBe('already_claimed');
			expect(notification.meta.content_embedded).toBe('true');
			expect(notification.content).toContain('grammar');
			expect(notification.content).toContain('My post text');
		});

		it('embeds content for review command with notesSupported', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			const contentProvider: ContentProvider = vi
				.fn<ContentProvider>()
				.mockResolvedValue({
					postId: 110,
					postContent: 'Review this content',
					notesSupported: true,
				});
			handler.setContentProvider(contentProvider);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({ id: 16, post_id: 110, prompt: 'review' })
			);

			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];
			expect(notification.content).toContain('Review this content');
			expect(notification.meta.content_embedded).toBe('true');
		});
	});

	// ---------------------------------------------------------------
	// setPreOpenHandler / setUserId
	// ---------------------------------------------------------------
	describe('setPreOpenHandler()', () => {
		it('can be called without error', () => {
			expect(() => {
				handler.setPreOpenHandler(async () => {});
			}).not.toThrow();
		});
	});

	describe('setUserId()', () => {
		it('can be called without error', () => {
			expect(() => {
				handler.setUserId(42);
			}).not.toThrow();
		});
	});

	// ---------------------------------------------------------------
	// buildEmbeddedContent — additional prompt cases
	// ---------------------------------------------------------------
	describe('content embedding — additional prompts', () => {
		it('embeds content for edit command with editingFocus argument', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			const contentProvider: ContentProvider = vi
				.fn<ContentProvider>()
				.mockResolvedValue({
					postId: 100,
					postContent: 'Some post content',
					notesSupported: false,
				});
			handler.setContentProvider(contentProvider);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({
					id: 20,
					post_id: 100,
					prompt: 'edit',
					arguments: { editingFocus: 'Improve the introduction' },
				})
			);

			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];
			expect(notification.content).toContain('Focus on:');
			expect(notification.content).toContain('Improve the introduction');
			expect(notification.content).toContain('Some post content');
			expect(notification.meta.content_embedded).toBe('true');
		});

		it('embeds content for respond-to-notes with notes in snapshot', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			const contentProvider: ContentProvider = vi
				.fn<ContentProvider>()
				.mockResolvedValue({
					postId: 100,
					postContent: 'Post with notes',
					notes: {
						notes: [
							{
								id: 1,
								parent: 0,
								content: {
									rendered: '<p>Fix this paragraph</p>',
								},
								author_name: 'Editor',
								date: '2026-01-01T00:00:00',
							} as import('../../src/wordpress/types.js').WPNote,
						],
						noteBlockMap: { 1: '0' },
					},
					notesSupported: true,
				});
			handler.setContentProvider(contentProvider);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({
					id: 21,
					post_id: 100,
					prompt: 'respond-to-notes',
				})
			);

			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];
			expect(notification.content).toContain('wp_resolve_note');
			expect(notification.content).toContain('Post with notes');
			expect(notification.meta.content_embedded).toBe('true');
		});

		it('embeds content for respond-to-note with matching noteId', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			const contentProvider: ContentProvider = vi
				.fn<ContentProvider>()
				.mockResolvedValue({
					postId: 100,
					postContent: 'Post with specific note',
					notes: {
						notes: [
							{
								id: 5,
								parent: 0,
								content: { rendered: '<p>Fix heading</p>' },
								author_name: 'Reviewer',
								date: '2026-01-01T00:00:00',
							} as import('../../src/wordpress/types.js').WPNote,
							{
								id: 6,
								parent: 5,
								content: { rendered: '<p>Reply to note</p>' },
								author_name: 'Author',
								date: '2026-01-01T01:00:00',
							} as import('../../src/wordpress/types.js').WPNote,
						],
						noteBlockMap: { 5: '2' },
					},
					notesSupported: true,
				});
			handler.setContentProvider(contentProvider);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({
					id: 22,
					post_id: 100,
					prompt: 'respond-to-note',
					arguments: { noteId: 5 },
				})
			);

			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];
			expect(notification.content).toContain('wp_resolve_note');
			expect(notification.content).toContain('Post with specific note');
			expect(notification.meta.content_embedded).toBe('true');
		});

		it('embeds content for respond-to-note with deeply nested replies', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			const contentProvider: ContentProvider = vi
				.fn<ContentProvider>()
				.mockResolvedValue({
					postId: 100,
					postContent: 'Post with nested thread',
					notes: {
						notes: [
							{
								id: 5,
								parent: 0,
								content: { rendered: '<p>Root note</p>' },
								author_name: 'Reviewer',
								date: '2026-01-01T00:00:00',
							} as import('../../src/wordpress/types.js').WPNote,
							{
								id: 6,
								parent: 5,
								content: {
									rendered: '<p>Direct reply</p>',
								},
								author_name: 'Author',
								date: '2026-01-01T01:00:00',
							} as import('../../src/wordpress/types.js').WPNote,
							{
								id: 7,
								parent: 6,
								content: {
									rendered: '<p>Nested reply</p>',
								},
								author_name: 'Reviewer',
								date: '2026-01-01T02:00:00',
							} as import('../../src/wordpress/types.js').WPNote,
						],
						noteBlockMap: { 5: '0' },
					},
					notesSupported: true,
				});
			handler.setContentProvider(contentProvider);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({
					id: 30,
					post_id: 100,
					prompt: 'respond-to-note',
					arguments: { noteId: 5 },
				})
			);

			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];
			expect(notification.meta.content_embedded).toBe('true');
			// All three notes should be included (root + reply + nested reply)
			expect(notification.content).toContain('Root note');
			expect(notification.content).toContain('Direct reply');
			expect(notification.content).toContain('Nested reply');
		});

		it('falls back to minimal notification for respond-to-note with non-matching noteId', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			const contentProvider: ContentProvider = vi
				.fn<ContentProvider>()
				.mockResolvedValue({
					postId: 100,
					postContent: 'Post with notes',
					notes: {
						notes: [
							{
								id: 5,
								parent: 0,
								content: { rendered: '<p>Some note</p>' },
								author_name: 'Reviewer',
								date: '2026-01-01T00:00:00',
							} as import('../../src/wordpress/types.js').WPNote,
						],
						noteBlockMap: { 5: '0' },
					},
					notesSupported: true,
				});
			handler.setContentProvider(contentProvider);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({
					id: 23,
					post_id: 100,
					prompt: 'respond-to-note',
					arguments: { noteId: 999 },
				})
			);

			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];
			expect(notification.content).toBe(
				'User requested: respond-to-note on post #100. Arguments: noteId: 999.'
			);
			expect(notification.meta).not.toHaveProperty('content_embedded');
		});

		it('embeds content for compose command', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			const contentProvider: ContentProvider = vi
				.fn<ContentProvider>()
				.mockResolvedValue({
					postId: 100,
					postContent: 'Draft post content',
					notesSupported: true,
				});
			handler.setContentProvider(contentProvider);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({
					id: 25,
					post_id: 100,
					prompt: 'compose',
				})
			);

			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];
			expect(notification.content).toContain('awaiting_input');
			expect(notification.content).toContain('Draft post content');
			expect(notification.meta.content_embedded).toBe('true');
		});

		it('embeds content for pre-publish-check command', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			const contentProvider: ContentProvider = vi
				.fn<ContentProvider>()
				.mockResolvedValue({
					postId: 100,
					postContent: 'Ready to publish content',
					notesSupported: false,
				});
			handler.setContentProvider(contentProvider);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({
					id: 26,
					post_id: 100,
					prompt: 'pre-publish-check' as Command['prompt'],
				})
			);

			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];
			expect(notification.content).toContain('READ-ONLY');
			expect(notification.content).toContain('Ready to publish content');
			expect(notification.meta.content_embedded).toBe('true');
		});

		it('falls back to minimal notification for unknown prompt', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			const contentProvider: ContentProvider = vi
				.fn<ContentProvider>()
				.mockResolvedValue({
					postId: 100,
					postContent: 'Some content',
					notesSupported: false,
				});
			handler.setContentProvider(contentProvider);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({
					id: 27,
					post_id: 100,
					prompt: 'unknown-future-prompt' as Command['prompt'],
				})
			);

			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];
			expect(notification.content).toBe(
				'User requested: unknown-future-prompt on post #100.'
			);
			expect(notification.meta).not.toHaveProperty('content_embedded');
		});

		it('falls back for respond-to-notes when no notes in snapshot', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			const contentProvider: ContentProvider = vi
				.fn<ContentProvider>()
				.mockResolvedValue({
					postId: 100,
					postContent: 'Post without notes',
					notes: { notes: [], noteBlockMap: {} },
					notesSupported: true,
				});
			handler.setContentProvider(contentProvider);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({
					id: 28,
					post_id: 100,
					prompt: 'respond-to-notes',
				})
			);

			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];
			expect(notification.content).toBe(
				'User requested: respond-to-notes on post #100.'
			);
			expect(notification.meta).not.toHaveProperty('content_embedded');
		});

		it('falls back for respond-to-note when notes object is missing', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			const contentProvider: ContentProvider = vi
				.fn<ContentProvider>()
				.mockResolvedValue({
					postId: 100,
					postContent: 'Post without notes',
					notesSupported: false,
				});
			handler.setContentProvider(contentProvider);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({
					id: 29,
					post_id: 100,
					prompt: 'respond-to-note',
					arguments: { noteId: 1 },
				})
			);

			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];
			expect(notification.content).toBe(
				'User requested: respond-to-note on post #100. Arguments: noteId: 1.'
			);
			expect(notification.meta).not.toHaveProperty('content_embedded');
		});
	});

	// ---------------------------------------------------------------
	// Locale plumbing — userLocale/siteLocale flow from command
	// arguments into both the embedded content and notification meta.
	// ---------------------------------------------------------------
	describe('locale plumbing', () => {
		it('threads userLocale / siteLocale from command arguments into embedded content', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			const contentProvider: ContentProvider = vi
				.fn<ContentProvider>()
				.mockResolvedValue({
					postId: 80,
					postContent: 'Bonjour',
					notesSupported: false,
				});
			handler.setContentProvider(contentProvider);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({
					id: 40,
					post_id: 80,
					prompt: 'proofread',
					arguments: {
						userLocale: 'fr_FR',
						siteLocale: 'en_US',
					},
				})
			);

			expect(notifier).toHaveBeenCalledOnce();
			const notification = notifier.mock.calls[0][0];
			expect(notification.content).toContain('User locale: fr_FR');
			expect(notification.content).toContain('Site locale hint: en_US');
		});

		it('copies userLocale to notification meta.user_locale for command events', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			const contentProvider: ContentProvider = vi
				.fn<ContentProvider>()
				.mockResolvedValue({
					postId: 81,
					postContent: 'Hola',
					notesSupported: false,
				});
			handler.setContentProvider(contentProvider);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({
					id: 41,
					post_id: 81,
					prompt: 'proofread',
					arguments: { userLocale: 'es_ES' },
				})
			);

			const notification = notifier.mock.calls[0][0];
			expect(notification.meta.user_locale).toBe('es_ES');
		});

		it('copies userLocale to notification meta.user_locale for response events', async () => {
			const { dispatchResponse } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchResponse(
				makeCommand({
					id: 42,
					post_id: 82,
					prompt: 'compose',
					status: 'awaiting_input',
					arguments: { userLocale: 'de_DE' },
					message: 'user answered',
				})
			);

			const notification = notifier.mock.calls[0][0];
			expect(notification.meta.event_type).toBe('response');
			expect(notification.meta.user_locale).toBe('de_DE');
		});

		it('omits meta.user_locale when userLocale is absent', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			const contentProvider: ContentProvider = vi
				.fn<ContentProvider>()
				.mockResolvedValue({
					postId: 83,
					postContent: 'Hello',
					notesSupported: false,
				});
			handler.setContentProvider(contentProvider);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({
					id: 43,
					post_id: 83,
					prompt: 'proofread',
					arguments: {},
				})
			);

			const notification = notifier.mock.calls[0][0];
			expect(notification.meta).not.toHaveProperty('user_locale');
		});
	});

	// ---------------------------------------------------------------
	// Pre-open handler in handleCommand
	// ---------------------------------------------------------------
	describe('open-post pre-open handler', () => {
		it('calls preOpenHandler with post_id for open-post command', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			const preOpenHandler = vi
				.fn<PreOpenHandler>()
				.mockResolvedValue(undefined);
			handler.setPreOpenHandler(preOpenHandler);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({
					id: 30,
					post_id: 200,
					prompt: 'open-post' as Command['prompt'],
				})
			);

			expect(preOpenHandler).toHaveBeenCalledOnce();
			expect(preOpenHandler).toHaveBeenCalledWith(200);
			// Notification should still be sent
			expect(notifier).toHaveBeenCalledOnce();
		});

		it('still sends notification when preOpenHandler throws', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			const preOpenHandler = vi
				.fn<PreOpenHandler>()
				.mockRejectedValue(new Error('Pre-open failed'));
			handler.setPreOpenHandler(preOpenHandler);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({
					id: 31,
					post_id: 300,
					prompt: 'open-post' as Command['prompt'],
				})
			);

			expect(preOpenHandler).toHaveBeenCalledOnce();
			// Notification should still be sent despite error
			expect(notifier).toHaveBeenCalledOnce();
		});

		it('does not call preOpenHandler for non-open-post commands', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			const preOpenHandler = vi
				.fn<PreOpenHandler>()
				.mockResolvedValue(undefined);
			handler.setPreOpenHandler(preOpenHandler);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({
					id: 32,
					post_id: 400,
					prompt: 'proofread',
				})
			);

			expect(preOpenHandler).not.toHaveBeenCalled();
			expect(notifier).toHaveBeenCalledOnce();
		});
	});

	// ---------------------------------------------------------------
	// User ID filtering
	// ---------------------------------------------------------------
	describe('userId filtering', () => {
		it('ignores command from a different user when userId is set', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);
			handler.setUserId(10);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({
					id: 40,
					post_id: 100,
					prompt: 'proofread',
					user_id: 99,
				})
			);

			expect(notifier).not.toHaveBeenCalled();
		});

		it('processes command from the same user when userId is set', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);
			handler.setUserId(10);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchCommand(
				makeCommand({
					id: 41,
					post_id: 100,
					prompt: 'proofread',
					user_id: 10,
				})
			);

			expect(notifier).toHaveBeenCalledOnce();
		});

		it('ignores response from a different user when userId is set', async () => {
			const { dispatchResponse } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);
			handler.setUserId(10);

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchResponse(
				makeCommand({
					id: 42,
					post_id: 100,
					prompt: 'proofread',
					status: 'running',
					user_id: 99,
					result_data: {
						messages: [{ role: 'user', content: 'Hello' }],
					},
				})
			);

			expect(notifier).not.toHaveBeenCalled();
		});
	});

	// ---------------------------------------------------------------
	// Response notification buffering
	// ---------------------------------------------------------------
	describe('response notification buffering', () => {
		it('buffers response notifications when no notifier is set', async () => {
			const { dispatchResponse } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchResponse(
				makeCommand({
					id: 1,
					prompt: 'proofread',
					post_id: 10,
					status: 'running',
					result_data: {
						messages: [{ role: 'user', content: 'Fix this' }],
					},
				})
			);

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);

			expect(notifier).toHaveBeenCalledOnce();
			expect(notifier.mock.calls[0][0].meta.event_type).toBe('response');
		});

		it('handles notifier errors gracefully on direct response send', async () => {
			const { dispatchResponse } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const consoleSpy = vi
				.spyOn(console, 'error')
				.mockImplementation(() => {});
			const notifier = vi
				.fn<ChannelNotifier>()
				.mockRejectedValue(new Error('delivery failed'));
			handler.setNotifier(notifier);
			await handler.start(createMockApiClient(), createCommandMap());

			await dispatchResponse(
				makeCommand({
					id: 77,
					status: 'running',
					result_data: {
						messages: [{ role: 'user', content: 'Hi' }],
					},
				})
			);

			expect(notifier).toHaveBeenCalledOnce();
			expect(consoleSpy).toHaveBeenCalledWith(
				'Failed to send response notification for command 77'
			);
			consoleSpy.mockRestore();
		});

		it('silently ignores response dispatched after stop', async () => {
			const { dispatchResponse } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			const notifier = vi
				.fn<ChannelNotifier>()
				.mockResolvedValue(undefined);
			handler.setNotifier(notifier);
			await handler.start(createMockApiClient(), createCommandMap());
			handler.stop();

			await dispatchResponse(
				makeCommand({
					id: 99,
					status: 'running',
					result_data: {
						messages: [{ role: 'user', content: 'Hello' }],
					},
				})
			);

			expect(notifier).not.toHaveBeenCalled();
		});
	});
});
