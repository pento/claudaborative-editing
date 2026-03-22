import { describe, it, expect, vi, afterEach } from 'vitest';
import * as childProcess from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFile: vi.fn((_cmd: string, _args: string[], cb: (err: Error | null) => void) => {
    cb(null);
  }),
}));

const { openAuthPage, openBrowserDefault, APP_NAME, APP_ID } =
  await import('../../../src/cli/auth-server.js');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('openAuthPage', () => {
  it('constructs the authorization URL with correct parameters', async () => {
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const url = await openAuthPage('https://my-site.example.com', { openBrowser });

    expect(url).toContain('https://my-site.example.com/wp-admin/authorize-application.php');

    const parsed = new URL(url);
    expect(parsed.searchParams.get('app_name')).toBe(APP_NAME);
    expect(parsed.searchParams.get('app_id')).toBe(APP_ID);
  });

  it('does not include success_url or reject_url', async () => {
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const url = await openAuthPage('https://example.com', { openBrowser });

    const parsed = new URL(url);
    expect(parsed.searchParams.has('success_url')).toBe(false);
    expect(parsed.searchParams.has('reject_url')).toBe(false);
  });

  it('calls the browser opener with the auth URL', async () => {
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const url = await openAuthPage('https://example.com', { openBrowser });

    expect(openBrowser).toHaveBeenCalledWith(url);
  });

  it('returns the auth URL', async () => {
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const url = await openAuthPage('https://example.com', { openBrowser });

    expect(typeof url).toBe('string');
    expect(url).toContain('authorize-application.php');
  });

  it('uses the provided site URL as the base', async () => {
    const openBrowser = vi.fn().mockResolvedValue(undefined);

    const url = await openAuthPage('https://custom.wp-site.org', { openBrowser });

    expect(url).toMatch(/^https:\/\/custom\.wp-site\.org\/wp-admin\//);
  });

  it('app_id is a valid UUID', () => {
    expect(APP_ID).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

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
      (_cmd: string, _args: readonly string[], cb: unknown) => {
        (cb as (err: Error | null) => void)(new Error('spawn failed'));
        return {} as ReturnType<typeof childProcess.execFile>;
      },
    );

    // Should not reject
    await expect(openBrowserDefault('https://example.com')).resolves.toBeUndefined();
  });
});
