import {
	describe,
	it,
	expect,
	vi,
	type MockInstance,
	beforeEach,
	afterEach,
} from 'vitest';
import type { WPUser } from '../../src/wordpress/types.js';
import { assertDefined } from '../test-utils.js';

// --- Mock McpServer to capture constructor args and close ---
let capturedOptions: Record<string, unknown> | undefined;
const mockServerClose = vi
	.fn<() => Promise<void>>()
	.mockResolvedValue(undefined);
const mockServerNotification = vi
	.fn<() => Promise<void>>()
	.mockResolvedValue(undefined);

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
	return {
		McpServer: vi.fn().mockImplementation(function (
			this: Record<string, unknown>,
			_info: unknown,
			options?: Record<string, unknown>
		) {
			capturedOptions = options;
			this.registerTool = vi.fn();
			this.registerPrompt = vi.fn();
			this.connect = vi.fn().mockResolvedValue(undefined);
			this.close = mockServerClose;
			this.server = { notification: mockServerNotification };
		}),
	};
});

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => {
	return {
		StdioServerTransport: vi.fn().mockImplementation(function () {}),
	};
});

// --- Mock SessionManager ---
const mockConnect = vi.fn<() => Promise<WPUser>>();
const mockDisconnect = vi.fn();
const mockSetChannelNotifier = vi.fn();
vi.mock('../../src/session/session-manager.js', () => {
	return {
		SessionManager: vi.fn().mockImplementation(function (
			this: Record<string, unknown>
		) {
			this.connect = mockConnect;
			this.disconnect = mockDisconnect;
			this.setChannelNotifier = mockSetChannelNotifier;
		}),
	};
});

// --- Mock tool and prompt registration (no-ops) ---
vi.mock('../../src/tools/registry.js', () => ({
	registerAllTools: vi.fn(),
}));
vi.mock('../../src/prompts/registry.js', () => ({
	registerAllPrompts: vi.fn(),
}));

describe('startServer()', () => {
	const originalEnv = { ...process.env };

	beforeEach(() => {
		vi.clearAllMocks();
		capturedOptions = undefined;
		// Clear env vars
		delete process.env.WP_SITE_URL;
		delete process.env.WP_USERNAME;
		delete process.env.WP_APP_PASSWORD;
	});

	afterEach(() => {
		// Restore original env
		process.env = { ...originalEnv };
	});

	it('sets instructions for auto-connected state', async () => {
		process.env.WP_SITE_URL = 'https://example.com';
		process.env.WP_USERNAME = 'admin';
		process.env.WP_APP_PASSWORD = 'xxxx yyyy';

		mockConnect.mockResolvedValue({
			id: 1,
			name: 'admin',
			slug: 'admin',
			avatar_urls: {},
		});

		const { startServer } = await import('../../src/server.js');
		await startServer();

		assertDefined(capturedOptions);
		expect(capturedOptions.instructions).toContain('Already connected');
		expect(capturedOptions.instructions).toContain(
			'Do NOT call wp_connect'
		);
	});

	it('sets instructions for disconnected state when no env vars', async () => {
		const { startServer } = await import('../../src/server.js');
		await startServer();

		assertDefined(capturedOptions);
		expect(capturedOptions.instructions).toContain('wp_connect');
		expect(capturedOptions.instructions).not.toContain('Already connected');
	});

	it('includes channel instructions in all instruction variants', async () => {
		const { startServer } = await import('../../src/server.js');
		await startServer();

		assertDefined(capturedOptions);
		const instructions = capturedOptions.instructions as string;
		expect(instructions).toContain('source="wpce"');
		expect(instructions).toContain('wp_update_command_status');
		expect(instructions).toContain('wp_open_post');
	});

	it('declares claude/channel experimental capability', async () => {
		const { startServer } = await import('../../src/server.js');
		await startServer();

		assertDefined(capturedOptions);
		const capabilities = capturedOptions.capabilities as Record<
			string,
			unknown
		>;
		expect(capabilities).toBeDefined();
		expect(capabilities.experimental).toEqual({
			'claude/channel': {},
		});
	});

	it('wires up channel notifier on session', async () => {
		const { startServer } = await import('../../src/server.js');
		await startServer();

		expect(mockSetChannelNotifier).toHaveBeenCalledOnce();
		expect(mockSetChannelNotifier).toHaveBeenCalledWith(
			expect.any(Function)
		);
	});

	it('channel notifier callback sends notification via MCP server', async () => {
		const { startServer } = await import('../../src/server.js');
		await startServer();

		// Extract the callback passed to setChannelNotifier
		const notifierCallback = mockSetChannelNotifier.mock.calls[0][0] as (
			params: Record<string, unknown>
		) => Promise<void>;
		assertDefined(notifierCallback);

		const testParams = {
			channel: 'wpce',
			data: { command_id: 42, prompt: 'proofread' },
		};
		await notifierCallback(testParams);

		expect(mockServerNotification).toHaveBeenCalledOnce();
		expect(mockServerNotification).toHaveBeenCalledWith({
			method: 'notifications/claude/channel',
			params: testParams,
		});
	});

	it('sets disconnected instructions when auto-connect fails', async () => {
		process.env.WP_SITE_URL = 'https://example.com';
		process.env.WP_USERNAME = 'admin';
		process.env.WP_APP_PASSWORD = 'bad';

		mockConnect.mockRejectedValue(new Error('401 Unauthorized'));

		// Suppress console.error from auto-connect failure
		const consoleSpy = vi
			.spyOn(console, 'error')
			.mockImplementation(() => {});

		const { startServer } = await import('../../src/server.js');
		await startServer();

		assertDefined(capturedOptions);
		expect(capturedOptions.instructions).not.toContain('Already connected');
		expect(capturedOptions.instructions).toContain('wp_connect');

		consoleSpy.mockRestore();
	});
});

describe('graceful shutdown', () => {
	const originalEnv = { ...process.env };
	let processOnSpy: MockInstance;
	let stdinOnSpy: MockInstance;
	let processExitSpy: MockInstance;

	// Capture registered handlers so we can invoke them in tests
	let signalHandlers: Partial<Record<string, (() => void)[]>>;
	let stdinHandlers: Partial<Record<string, (() => void)[]>>;

	beforeEach(() => {
		vi.clearAllMocks();
		capturedOptions = undefined;
		delete process.env.WP_SITE_URL;
		delete process.env.WP_USERNAME;
		delete process.env.WP_APP_PASSWORD;

		signalHandlers = {};
		stdinHandlers = {};

		processOnSpy = vi.spyOn(process, 'on').mockImplementation(((
			event: string,
			handler: () => void
		) => {
			if (!signalHandlers[event]) signalHandlers[event] = [];
			signalHandlers[event].push(handler);
			return process;
		}) as typeof process.on);

		stdinOnSpy = vi.spyOn(process.stdin, 'on').mockImplementation(((
			event: string,
			handler: () => void
		) => {
			if (!stdinHandlers[event]) stdinHandlers[event] = [];
			stdinHandlers[event].push(handler);
			return process.stdin;
		}) as typeof process.stdin.on);

		processExitSpy = vi
			.spyOn(process, 'exit')
			.mockImplementation((() => {}) as typeof process.exit);
	});

	afterEach(() => {
		processOnSpy.mockRestore();
		stdinOnSpy.mockRestore();
		processExitSpy.mockRestore();
		process.env = { ...originalEnv };
	});

	it('installs SIGTERM, SIGINT, and stdin end handlers', async () => {
		const { startServer } = await import('../../src/server.js');
		await startServer();

		expect(signalHandlers.SIGTERM).toHaveLength(1);
		expect(signalHandlers.SIGINT).toHaveLength(1);
		expect(stdinHandlers.end).toHaveLength(1);
	});

	it('disconnects session and closes server on SIGTERM', async () => {
		const { startServer } = await import('../../src/server.js');
		await startServer();

		// Trigger the SIGTERM handler
		const sigtermHandlers = signalHandlers.SIGTERM;
		assertDefined(sigtermHandlers);
		const sigtermHandler = sigtermHandlers[0];
		assertDefined(sigtermHandler);
		sigtermHandler();

		// Allow the async cleanup to complete
		await vi.waitFor(() => {
			expect(processExitSpy).toHaveBeenCalledWith(0);
		});

		expect(mockDisconnect).toHaveBeenCalledOnce();
		expect(mockServerClose).toHaveBeenCalledOnce();
	});

	it('disconnects session and closes server on SIGINT', async () => {
		const { startServer } = await import('../../src/server.js');
		await startServer();

		const sigintHandlers = signalHandlers.SIGINT;
		assertDefined(sigintHandlers);
		const sigintHandler = sigintHandlers[0];
		assertDefined(sigintHandler);
		sigintHandler();

		await vi.waitFor(() => {
			expect(processExitSpy).toHaveBeenCalledWith(0);
		});

		expect(mockDisconnect).toHaveBeenCalledOnce();
		expect(mockServerClose).toHaveBeenCalledOnce();
	});

	it('disconnects session and closes server on stdin end', async () => {
		const { startServer } = await import('../../src/server.js');
		await startServer();

		const endHandlers = stdinHandlers.end;
		assertDefined(endHandlers);
		const endHandler = endHandlers[0];
		assertDefined(endHandler);
		endHandler();

		await vi.waitFor(() => {
			expect(processExitSpy).toHaveBeenCalledWith(0);
		});

		expect(mockDisconnect).toHaveBeenCalledOnce();
		expect(mockServerClose).toHaveBeenCalledOnce();
	});

	it('only runs cleanup once even if triggered multiple times', async () => {
		const { startServer } = await import('../../src/server.js');
		await startServer();

		// Trigger both SIGTERM and stdin end simultaneously
		const sigtermHandlers2 = signalHandlers.SIGTERM;
		assertDefined(sigtermHandlers2);
		const sigtermHandler2 = sigtermHandlers2[0];
		assertDefined(sigtermHandler2);
		sigtermHandler2();
		const endHandlers2 = stdinHandlers.end;
		assertDefined(endHandlers2);
		const endHandler2 = endHandlers2[0];
		assertDefined(endHandler2);
		endHandler2();

		await vi.waitFor(() => {
			expect(processExitSpy).toHaveBeenCalled();
		});

		// disconnect and close should only be called once despite two triggers
		expect(mockDisconnect).toHaveBeenCalledOnce();
		expect(mockServerClose).toHaveBeenCalledOnce();
		expect(processExitSpy).toHaveBeenCalledOnce();
	});
});
