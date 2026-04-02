import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CommandHandler } from '../../src/session/command-handler.js';
import type { ChannelNotifier } from '../../src/session/command-handler.js';
import { WordPressApiError } from '../../src/wordpress/api-client.js';
import type { WordPressApiClient } from '../../src/wordpress/api-client.js';
import type {
	Command,
	PluginStatus,
} from '../../src/wordpress/command-client.js';

// --- Mocks ---

vi.mock('../../src/wordpress/command-client.js', () => {
	return {
		CommandClient: vi.fn(),
		DEFAULT_COMMAND_CLIENT_CONFIG: {
			pollInterval: 5000,
			maxSseRetries: 3,
			sseRetryFromPollingInterval: 60000,
			sseBackoffBase: 1000,
			sseBackoffMax: 30000,
		},
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
 * constructor mock.  Returns the instance and a `dispatchCommand` helper
 * that invokes the captured `onCommand` callback and flushes microtasks
 * so the async `handleCommand` chain completes before assertions.
 */
function setupMockCommandClient(pluginStatusResult?: {
	resolve?: PluginStatus;
	reject?: Error;
}) {
	let capturedOnCommand: ((command: Command) => void) | null = null;

	const instance = {
		getPluginStatus: vi.fn<() => Promise<PluginStatus>>(),
		start: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
		stop: vi.fn(),
		updateCommandStatus: vi
			.fn<
				(
					id: number,
					status: string,
					message?: string
				) => Promise<Command>
			>()
			.mockResolvedValue(makeCommand()),
		getTransport: vi
			.fn<() => 'sse' | 'polling' | 'none'>()
			.mockReturnValue('sse'),
	};

	if (pluginStatusResult?.resolve) {
		instance.getPluginStatus.mockResolvedValue(pluginStatusResult.resolve);
	} else if (pluginStatusResult?.reject) {
		instance.getPluginStatus.mockRejectedValue(pluginStatusResult.reject);
	}

	// Use a regular function so it can be called with `new`.
	MockedCommandClient.mockImplementation(function mockCtor(
		_api: WordPressApiClient,
		onCommand: (command: Command) => void
	) {
		capturedOnCommand = onCommand;
		return instance as unknown as CommandClient;
	} as unknown as typeof CommandClient);

	/**
	 * Dispatch a command through the captured onCommand callback and
	 * flush microtasks so the async `handleCommand` promise chain
	 * (notify → catch) runs to completion before returning.
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

	return { instance, dispatchCommand };
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

			const result = await handler.start(createMockApiClient());

			expect(result).toBe(true);
			expect(handler.getPluginStatus()).toEqual(status);
		});

		it('calls CommandClient.start() when plugin is detected', async () => {
			const { instance } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			await handler.start(createMockApiClient());

			expect(instance.start).toHaveBeenCalledOnce();
		});

		it('returns false when plugin returns 404 (not installed)', async () => {
			setupMockCommandClient({
				reject: new WordPressApiError('Not Found', 404, ''),
			});

			const result = await handler.start(createMockApiClient());

			expect(result).toBe(false);
			expect(handler.getPluginStatus()).toBeNull();
		});

		it('throws on non-404 API errors', async () => {
			setupMockCommandClient({
				reject: new WordPressApiError('Internal Server Error', 500, ''),
			});

			await expect(handler.start(createMockApiClient())).rejects.toThrow(
				'Internal Server Error'
			);
		});

		it('throws on generic errors', async () => {
			setupMockCommandClient({
				reject: new Error('Network failure'),
			});

			await expect(handler.start(createMockApiClient())).rejects.toThrow(
				'Network failure'
			);
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
			await handler.start(createMockApiClient());

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
			await handler.start(createMockApiClient());

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
			await handler.start(createMockApiClient());

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
			await handler.start(createMockApiClient());

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

			await handler.start(createMockApiClient());

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

			await handler.start(createMockApiClient());
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
			await handler.start(createMockApiClient());

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

			await handler.start(createMockApiClient());
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
			await handler.start(createMockApiClient());

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

			await handler.start(createMockApiClient());
			handler.stop();

			expect(instance.stop).toHaveBeenCalledOnce();
		});

		it('returns transport as disabled after stop', async () => {
			setupMockCommandClient({ resolve: makePluginStatus() });

			await handler.start(createMockApiClient());
			handler.stop();

			expect(handler.getTransport()).toBe('disabled');
		});

		it('clears plugin status after stop', async () => {
			setupMockCommandClient({ resolve: makePluginStatus() });

			await handler.start(createMockApiClient());
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
			await handler.start(createMockApiClient());
			handler.stop();

			// Dispatch after stop — should be silently ignored
			await dispatchCommand(makeCommand({ id: 99 }));

			expect(notifier).not.toHaveBeenCalled();
		});

		it('clears pending notifications on stop', async () => {
			const { dispatchCommand } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});

			await handler.start(createMockApiClient());
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

			await handler.start(createMockApiClient());
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

			await handler.start(createMockApiClient());
			await handler.updateCommandStatus(42, 'completed', 'All done');

			expect(instance.updateCommandStatus).toHaveBeenCalledWith(
				42,
				'completed',
				'All done'
			);
		});

		it('delegates without message when not provided', async () => {
			const { instance } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});
			instance.updateCommandStatus.mockResolvedValue(
				makeCommand({ status: 'running' })
			);

			await handler.start(createMockApiClient());
			await handler.updateCommandStatus(42, 'running');

			expect(instance.updateCommandStatus).toHaveBeenCalledWith(
				42,
				'running',
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

			await handler.start(createMockApiClient());
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

			await handler.start(createMockApiClient());

			expect(handler.getPluginStatus()).toEqual(status);
		});

		it('returns null after failed start (404)', async () => {
			setupMockCommandClient({
				reject: new WordPressApiError('Not Found', 404, ''),
			});

			await handler.start(createMockApiClient());

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

			await handler.start(createMockApiClient());

			expect(handler.getTransport()).toBe('disabled');
		});

		it('delegates to CommandClient when started', async () => {
			const { instance } = setupMockCommandClient({
				resolve: makePluginStatus(),
			});
			instance.getTransport.mockReturnValue('polling');

			await handler.start(createMockApiClient());

			expect(handler.getTransport()).toBe('polling');
		});
	});

	// ---------------------------------------------------------------
	// Constructor config
	// ---------------------------------------------------------------
	describe('constructor config', () => {
		it('passes custom config to CommandClient', async () => {
			setupMockCommandClient({ resolve: makePluginStatus() });

			const customHandler = new CommandHandler({
				pollInterval: 10000,
			});
			await customHandler.start(createMockApiClient());
			customHandler.stop();

			expect(MockedCommandClient).toHaveBeenCalledWith(
				expect.anything(),
				expect.any(Function),
				expect.objectContaining({ pollInterval: 10000 })
			);
		});

		it('uses default config when none provided', async () => {
			setupMockCommandClient({ resolve: makePluginStatus() });

			await handler.start(createMockApiClient());

			expect(MockedCommandClient).toHaveBeenCalledWith(
				expect.anything(),
				expect.any(Function),
				expect.objectContaining({
					pollInterval: 5000,
					maxSseRetries: 3,
				})
			);
		});
	});
});
