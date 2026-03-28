import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { assertDefined } from '../../test-utils.js';
import * as childProcess from 'node:child_process';
import type { IncomingMessage, ServerResponse, Server } from 'node:http';
import * as http from 'node:http';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
    cb(null);
  }),
}));

const MOCK_STATE = 'deadbeef1234567890abcdef12345678';
vi.mock('node:crypto', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:crypto')>();
  return {
    ...original,
    randomBytes: () => Buffer.from(MOCK_STATE, 'hex'),
  };
});

// ---------------------------------------------------------------------------
// Mock node:http to avoid sandbox restrictions on listen()
// ---------------------------------------------------------------------------

type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

let capturedHandler: RequestHandler | null = null;
const MOCK_PORT = 54321;

// Event listeners registered on the mock server
let serverListeners: Record<string, ((...args: unknown[]) => void)[]> = {};

const mockServer = {
  listen: vi.fn((_port: number, _host: string, cb: () => void) => {
    // Call asynchronously to match real server behaviour
    setImmediate(() => {
      cb();
    });
  }),
  address: vi.fn(() => ({ port: MOCK_PORT })),
  close: vi.fn(),
  closeAllConnections: vi.fn(),
  on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    const listeners = serverListeners[event] ?? [];
    listeners.push(handler);
    serverListeners[event] = listeners;
  }),
};

function emitServerEvent(event: string, ...args: unknown[]): void {
  for (const handler of serverListeners[event] ?? []) {
    handler(...args);
  }
}

vi.mock('node:http', async (importOriginal) => {
  const original = await importOriginal<typeof http>();
  return {
    ...original,
    createServer: vi.fn((handler: RequestHandler) => {
      capturedHandler = handler;
      return mockServer as unknown as Server;
    }),
  };
});

const { startAuthFlow, buildManualAuthUrl, openBrowserDefault, APP_NAME, APP_ID } =
  await import('../../../src/cli/auth-server.js');

// ---------------------------------------------------------------------------
// Helper: simulate an HTTP request to the captured handler
// ---------------------------------------------------------------------------

function simulateRequest(url: string): {
  status: number;
  headers: Record<string, string>;
  body: string;
} {
  if (!capturedHandler) throw new Error('No handler captured — startAuthFlow not called?');

  const req = { url, headers: { host: `127.0.0.1:${MOCK_PORT}` } } as unknown as IncomingMessage;

  let status = 0;
  const resHeaders: Record<string, string> = {};
  let body = '';

  const res = {
    writeHead: (s: number, h?: Record<string, string>) => {
      status = s;
      if (h) Object.assign(resHeaders, h);
    },
    end: (b?: string) => {
      if (b) body = b;
    },
  } as unknown as ServerResponse;

  capturedHandler(req, res);

  return { status, headers: resHeaders, body };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
  capturedHandler = null;
  serverListeners = {};
});

beforeEach(() => {
  mockServer.listen.mockImplementation((_port: number, _host: string, cb: () => void) => {
    setImmediate(() => {
      cb();
    });
  });
  mockServer.address.mockReturnValue({ port: MOCK_PORT });
  mockServer.close.mockReset();
  mockServer.closeAllConnections.mockReset();
});

describe('startAuthFlow', () => {
  it('resolves the handle once the server is listening', async () => {
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const handle = await startAuthFlow('https://example.com', { openBrowser });

    expect(handle.authUrl).toContain('authorize-application.php');
    expect(handle.result).toBeInstanceOf(Promise);
    expect(typeof handle.abort).toBe('function');

    handle.abort();
    await handle.result;
  });

  it('includes success_url and reject_url in the auth URL', async () => {
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const handle = await startAuthFlow('https://example.com', { openBrowser });

    const parsed = new URL(handle.authUrl);
    expect(parsed.searchParams.has('success_url')).toBe(true);
    expect(parsed.searchParams.has('reject_url')).toBe(true);

    handle.abort();
    await handle.result;
  });

  it('success_url points to 127.0.0.1 with the server port', async () => {
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const handle = await startAuthFlow('https://example.com', { openBrowser });

    const parsed = new URL(handle.authUrl);
    const successUrlParam = parsed.searchParams.get('success_url');
    assertDefined(successUrlParam);
    const successUrl = new URL(successUrlParam);
    expect(successUrl.hostname).toBe('127.0.0.1');
    expect(successUrl.port).toBe(String(MOCK_PORT));
    expect(successUrl.pathname).toBe('/callback');
    expect(successUrl.searchParams.get('state')).toBe(MOCK_STATE);

    handle.abort();
    await handle.result;
  });

  it('includes app_name and app_id', async () => {
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const handle = await startAuthFlow('https://example.com', { openBrowser });

    const parsed = new URL(handle.authUrl);
    expect(parsed.searchParams.get('app_name')).toBe(APP_NAME);
    expect(parsed.searchParams.get('app_id')).toBe(APP_ID);

    handle.abort();
    await handle.result;
  });

  it('uses the site URL as the base of the auth URL', async () => {
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const handle = await startAuthFlow('https://custom.wp-site.org', { openBrowser });

    expect(handle.authUrl).toMatch(/^https:\/\/custom\.wp-site\.org\/wp-admin\//);

    handle.abort();
    await handle.result;
  });

  it('resolves result with credentials when callback receives approval', async () => {
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const handle = await startAuthFlow('https://example.com', { openBrowser });

    simulateRequest(
      `/callback?state=${MOCK_STATE}&user_login=admin&password=xxxx+xxxx+xxxx&site_url=https%3A%2F%2Fexample.com`,
    );

    const result = await handle.result;
    expect(result.credentials).toEqual({
      siteUrl: 'https://example.com',
      username: 'admin',
      appPassword: 'xxxx xxxx xxxx',
    });
    expect(result.rejected).toBe(false);
  });

  it('uses the caller-provided siteUrl, not the WordPress callback site_url', async () => {
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const handle = await startAuthFlow('https://my-normalised-url.com', { openBrowser });

    simulateRequest(
      `/callback?state=${MOCK_STATE}&user_login=admin&password=xxxx&site_url=https%3A%2F%2FMY-NORMALISED-URL.COM%2F`,
    );

    const result = await handle.result;
    assertDefined(result.credentials);
    expect(result.credentials.siteUrl).toBe('https://my-normalised-url.com');
  });

  it('resolves result with rejected=true when callback receives rejection', async () => {
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const handle = await startAuthFlow('https://example.com', { openBrowser });

    simulateRequest(`/callback?state=${MOCK_STATE}&rejected=true`);

    const result = await handle.result;
    expect(result.credentials).toBeNull();
    expect(result.rejected).toBe(true);
  });

  it('resolves result with credentials=null when aborted', async () => {
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const handle = await startAuthFlow('https://example.com', { openBrowser });

    handle.abort();

    const result = await handle.result;
    expect(result.credentials).toBeNull();
    expect(result.rejected).toBe(false);
  });

  it('serves an HTML success page on approval', async () => {
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const handle = await startAuthFlow('https://example.com', { openBrowser });

    const response = simulateRequest(
      `/callback?state=${MOCK_STATE}&user_login=admin&password=xxxx`,
    );
    expect(response.status).toBe(200);
    expect(response.headers['Content-Type']).toContain('text/html');
    expect(response.body).toContain('Authentication successful');

    await handle.result;
  });

  it('serves an HTML rejection page on denial', async () => {
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const handle = await startAuthFlow('https://example.com', { openBrowser });

    const response = simulateRequest(`/callback?state=${MOCK_STATE}&rejected=true`);
    expect(response.status).toBe(200);
    expect(response.headers['Content-Type']).toContain('text/html');
    expect(response.body).toContain('Authentication denied');

    await handle.result;
  });

  it('returns 404 for unknown paths', async () => {
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const handle = await startAuthFlow('https://example.com', { openBrowser });

    const response = simulateRequest('/unknown');
    expect(response.status).toBe(404);

    handle.abort();
    await handle.result;
  });

  it('returns 403 when callback has invalid state', async () => {
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const handle = await startAuthFlow('https://example.com', { openBrowser });

    const response = simulateRequest('/callback?state=wrong&user_login=admin&password=xxxx');
    expect(response.status).toBe(403);

    handle.abort();
    await handle.result;
  });

  it('returns 400 when callback is missing credentials', async () => {
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const handle = await startAuthFlow('https://example.com', { openBrowser });

    const response = simulateRequest(`/callback?state=${MOCK_STATE}`);
    expect(response.status).toBe(400);

    handle.abort();
    await handle.result;
  });

  it('calls the browser opener with the auth URL', async () => {
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const handle = await startAuthFlow('https://example.com', { openBrowser });

    expect(openBrowser).toHaveBeenCalledOnce();
    expect(openBrowser).toHaveBeenCalledWith(handle.authUrl);

    handle.abort();
    await handle.result;
  });

  it('shuts down the server after receiving a callback', async () => {
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const handle = await startAuthFlow('https://example.com', { openBrowser });

    simulateRequest(`/callback?state=${MOCK_STATE}&user_login=admin&password=xxxx`);
    await handle.result;

    expect(mockServer.close).toHaveBeenCalled();
    expect(mockServer.closeAllConnections).toHaveBeenCalled();
  });

  it('shuts down the server when aborted', async () => {
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const handle = await startAuthFlow('https://example.com', { openBrowser });

    handle.abort();
    await handle.result;

    expect(mockServer.close).toHaveBeenCalled();
    expect(mockServer.closeAllConnections).toHaveBeenCalled();
  });

  it('rejects the handle when server emits an error', async () => {
    mockServer.listen.mockImplementation(() => {
      setImmediate(() => {
        emitServerEvent('error', new Error('EPERM'));
      });
    });

    const openBrowser = vi.fn().mockResolvedValue(undefined);

    await expect(startAuthFlow('https://example.com', { openBrowser })).rejects.toThrow('EPERM');
    expect(openBrowser).not.toHaveBeenCalled();
  });

  it('does not resolve result twice if callback arrives after abort', async () => {
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const handle = await startAuthFlow('https://example.com', { openBrowser });

    handle.abort();
    const result = await handle.result;

    // Second callback after abort — handler still runs but settle() is a no-op
    simulateRequest(`/callback?state=${MOCK_STATE}&user_login=other&password=second`);

    expect(result.credentials).toBeNull();
  });

  it('app_id is a valid UUID', () => {
    expect(APP_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

// ---------------------------------------------------------------------------
// buildManualAuthUrl
// ---------------------------------------------------------------------------

describe('buildManualAuthUrl', () => {
  it('builds an auth URL without success_url or reject_url', () => {
    const url = buildManualAuthUrl('https://example.com');
    const parsed = new URL(url);

    expect(parsed.origin + parsed.pathname).toBe(
      'https://example.com/wp-admin/authorize-application.php',
    );
    expect(parsed.searchParams.get('app_name')).toBe(APP_NAME);
    expect(parsed.searchParams.get('app_id')).toBe(APP_ID);
    expect(parsed.searchParams.has('success_url')).toBe(false);
    expect(parsed.searchParams.has('reject_url')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// openBrowserDefault
// ---------------------------------------------------------------------------

describe('openBrowserDefault', () => {
  it('calls execFile with "open" on darwin', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });

    await openBrowserDefault('https://example.com/auth');

    expect(childProcess.execFile).toHaveBeenCalledWith(
      'open',
      ['https://example.com/auth'],
      expect.any(Function),
    );

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('calls execFile with "explorer" on win32', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });

    await openBrowserDefault('https://example.com/auth');

    expect(childProcess.execFile).toHaveBeenCalledWith(
      'explorer',
      ['https://example.com/auth'],
      expect.any(Function),
    );

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('calls execFile with "xdg-open" on linux', async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });

    await openBrowserDefault('https://example.com/auth');

    expect(childProcess.execFile).toHaveBeenCalledWith(
      'xdg-open',
      ['https://example.com/auth'],
      expect.any(Function),
    );

    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true });
  });

  it('resolves even when execFile fails', async () => {
    vi.mocked(childProcess.execFile).mockImplementation(
      (_cmd: string, _args: readonly string[] | null | undefined, cb: unknown) => {
        (cb as (err: Error | null) => void)(new Error('spawn failed'));
        return {} as ReturnType<typeof childProcess.execFile>;
      },
    );

    // Should not reject
    await expect(openBrowserDefault('https://example.com')).resolves.toBeUndefined();
  });
});
