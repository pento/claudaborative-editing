import { describe, it, expect, vi, afterEach } from 'vitest';

const { openAuthPage, APP_NAME, APP_ID } = await import('../../../src/cli/auth-server.js');

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
