import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WPUser } from '../../src/wordpress/types.js';

// --- Mock McpServer to capture constructor args ---
let capturedOptions: Record<string, unknown> | undefined;

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => {
  return {
    McpServer: vi.fn().mockImplementation(function (this: Record<string, unknown>, _info: unknown, options?: Record<string, unknown>) {
      capturedOptions = options;
      this.tool = vi.fn();
      this.connect = vi.fn().mockResolvedValue(undefined);
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
vi.mock('../../src/session/session-manager.js', () => {
  return {
    SessionManager: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.connect = mockConnect;
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
