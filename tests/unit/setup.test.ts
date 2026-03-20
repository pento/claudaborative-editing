import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SetupDeps } from '../../src/cli/setup.js';

// Mock fetch globally before importing the module under test
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function mockResponse(body: unknown, init?: { status?: number; statusText?: string }): Response {
  const status = init?.status ?? 200;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: init?.statusText ?? 'OK',
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as unknown as Response;
}

const { runSetup, shellQuote } = await import('../../src/cli/setup.js');

class SetupExitError extends Error {
  constructor(public readonly code: number) {
    super(`exit(${code})`);
  }
}

function createTestDeps(answers: string[]): { deps: SetupDeps; logs: string[]; errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  let answerIndex = 0;

  return {
    deps: {
      prompt: async () => answers[answerIndex++] ?? '',
      log: (msg: string) => logs.push(msg),
      error: (msg: string) => errors.push(msg),
      exit: ((code: number) => {
        throw new SetupExitError(code);
      }) as (code: number) => never,
      cleanup: () => {},
    },
    logs,
    errors,
  };
}

describe('setup wizard', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('outputs mcp add command on successful validation', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockResponse({ id: 1, name: 'admin', slug: 'admin', avatar_urls: {} }),
      )
      .mockResolvedValueOnce(mockResponse({ rooms: [] }));

    const { deps, logs } = createTestDeps(['https://example.com', 'admin', 'xxxx xxxx xxxx']);

    await runSetup(deps);

    const output = logs.join('\n');
    expect(output).toContain('Authenticated as "admin"');
    expect(output).toContain('Collaborative editing endpoint available');
    expect(output).toContain('claude mcp add claudaborative-editing');
    expect(output).toContain('WP_SITE_URL');
    expect(output).toContain('npx claudaborative-editing');
  });

  it('exits with error on auth failure', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse(
        { code: 'rest_forbidden', message: 'Sorry' },
        { status: 401, statusText: 'Unauthorized' },
      ),
    );

    const { deps, errors } = createTestDeps(['https://example.com', 'admin', 'bad-password']);

    await expect(runSetup(deps)).rejects.toThrow(SetupExitError);

    expect(errors.join('\n')).toContain('Authentication failed');
  });

  it('exits with error when sync endpoint returns 404', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockResponse({ id: 1, name: 'admin', slug: 'admin', avatar_urls: {} }),
      )
      .mockResolvedValueOnce(
        mockResponse(
          { code: 'rest_no_route', message: 'No route' },
          { status: 404, statusText: 'Not Found' },
        ),
      );

    const { deps, errors } = createTestDeps(['https://example.com', 'admin', 'xxxx xxxx xxxx']);

    await expect(runSetup(deps)).rejects.toThrow(SetupExitError);

    expect(errors.join('\n')).toContain('Collaborative editing is not enabled');
  });

  it('exits with error when site URL is empty', async () => {
    const { deps, errors } = createTestDeps(['', 'admin', 'xxxx']);

    await expect(runSetup(deps)).rejects.toThrow(SetupExitError);

    expect(errors.join('\n')).toContain('Site URL is required');
  });

  it('quotes values with spaces in the mcp add command', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockResponse({ id: 1, name: 'admin', slug: 'admin', avatar_urls: {} }),
      )
      .mockResolvedValueOnce(mockResponse({ rooms: [] }));

    const { deps, logs } = createTestDeps([
      'https://example.com',
      'admin',
      'xxxx xxxx xxxx xxxx',
    ]);

    await runSetup(deps);

    const mcpLine = logs.find((l) => l.includes('claude mcp add'));
    expect(mcpLine).toBeDefined();
    expect(mcpLine).toContain('"xxxx xxxx xxxx xxxx"');
  });
});

describe('shellQuote', () => {
  it('returns simple values unquoted', () => {
    expect(shellQuote('https://example.com')).toBe('https://example.com');
    expect(shellQuote('admin')).toBe('admin');
  });

  it('quotes values with spaces', () => {
    expect(shellQuote('xxxx xxxx xxxx')).toBe('"xxxx xxxx xxxx"');
  });

  it('escapes double quotes', () => {
    expect(shellQuote('say "hello"')).toBe('"say \\"hello\\""');
  });

  it('escapes dollar signs', () => {
    expect(shellQuote('$HOME/site')).toBe('"\\$HOME/site"');
  });

  it('escapes backticks', () => {
    expect(shellQuote('`cmd`')).toBe('"\\`cmd\\`"');
  });

  it('escapes backslashes', () => {
    expect(shellQuote('path\\to\\file')).toBe('"path\\\\to\\\\file"');
  });
});
