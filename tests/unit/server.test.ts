import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WPUser } from '../../src/wordpress/types.js';

// --- Mock McpServer to capture constructor args and close ---
let capturedOptions: Record<string, unknown> | undefined;
const mockServerClose = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  return {
    McpServer: vi.fn().mockImplementation(function (
      this: Record<string, unknown>,
      _info: unknown,
      options?: Record<string, unknown>,
    ) {
      capturedOptions = options;
      this.registerTool = vi.fn();
      this.registerPrompt = vi.fn();
      this.connect = vi.fn().mockResolvedValue(undefined);
      this.close = mockServerClose;
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
vi.mock('../../src/session/session-manager.js', () => {
  return {
    SessionManager: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.connect = mockConnect;
      this.disconnect = mockDisconnect;
    }),
  };
});

// --- Mock tool registration functions (no-ops) ---
vi.mock('../../src/tools/connect.js', () => ({ registerConnectTools: vi.fn() }));
vi.mock('../../src/tools/posts.js', () => ({ registerPostTools: vi.fn() }));
vi.mock('../../src/tools/read.js', () => ({ registerReadTools: vi.fn() }));
vi.mock('../../src/tools/edit.js', () => ({ registerEditTools: vi.fn() }));
vi.mock('../../src/tools/status.js', () => ({ registerStatusTools: vi.fn() }));
vi.mock('../../src/tools/block-types.js', () => ({ registerBlockTypeTools: vi.fn() }));
vi.mock('../../src/tools/media.js', () => ({ registerMediaTools: vi.fn() }));
vi.mock('../../src/tools/notes.js', () => ({ registerNoteTools: vi.fn() }));
vi.mock('../../src/tools/metadata.js', () => ({ registerMetadataTools: vi.fn() }));

// --- Mock prompt registration functions (no-ops) ---
vi.mock('../../src/prompts/editing.js', () => ({ registerEditingPrompts: vi.fn() }));
vi.mock('../../src/prompts/review.js', () => ({ registerReviewPrompts: vi.fn() }));
vi.mock('../../src/prompts/authoring.js', () => ({ registerAuthoringPrompts: vi.fn() }));

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

    expect(capturedOptions).toBeDefined();
    expect(capturedOptions!.instructions).toContain('Already connected');
    expect(capturedOptions!.instructions).toContain('Do NOT call wp_connect');
  });

  it('sets instructions for disconnected state when no env vars', async () => {
    const { startServer } = await import('../../src/server.js');
    await startServer();

    expect(capturedOptions).toBeDefined();
    expect(capturedOptions!.instructions).toContain('wp_connect');
    expect(capturedOptions!.instructions).not.toContain('Already connected');
  });

  it('sets disconnected instructions when auto-connect fails', async () => {
    process.env.WP_SITE_URL = 'https://example.com';
    process.env.WP_USERNAME = 'admin';
    process.env.WP_APP_PASSWORD = 'bad';

    mockConnect.mockRejectedValue(new Error('401 Unauthorized'));

    // Suppress console.error from auto-connect failure
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { startServer } = await import('../../src/server.js');
    await startServer();

    expect(capturedOptions).toBeDefined();
    expect(capturedOptions!.instructions).not.toContain('Already connected');
    expect(capturedOptions!.instructions).toContain('wp_connect');

    consoleSpy.mockRestore();
  });
});

describe('graceful shutdown', () => {
  const originalEnv = { ...process.env };
  let processOnSpy: ReturnType<typeof vi.spyOn>;
  let stdinOnSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

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
      handler: () => void,
    ) => {
      if (!signalHandlers[event]) signalHandlers[event] = [];
      signalHandlers[event].push(handler);
      return process;
    }) as typeof process.on);

    stdinOnSpy = vi.spyOn(process.stdin, 'on').mockImplementation(((
      event: string,
      handler: () => void,
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
    signalHandlers.SIGTERM[0]();

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

    signalHandlers.SIGINT[0]();

    await vi.waitFor(() => {
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    expect(mockDisconnect).toHaveBeenCalledOnce();
    expect(mockServerClose).toHaveBeenCalledOnce();
  });

  it('disconnects session and closes server on stdin end', async () => {
    const { startServer } = await import('../../src/server.js');
    await startServer();

    stdinHandlers.end[0]();

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
    signalHandlers.SIGTERM[0]();
    stdinHandlers.end[0]();

    await vi.waitFor(() => {
      expect(processExitSpy).toHaveBeenCalled();
    });

    // disconnect and close should only be called once despite two triggers
    expect(mockDisconnect).toHaveBeenCalledOnce();
    expect(mockServerClose).toHaveBeenCalledOnce();
    expect(processExitSpy).toHaveBeenCalledOnce();
  });
});
