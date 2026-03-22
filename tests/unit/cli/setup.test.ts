import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SetupDeps } from '../../../src/cli/setup.js';
import type { CheckboxResult } from '../../../src/cli/checkbox-prompt.js';
import type { McpClientConfig, McpClientType } from '../../../src/cli/types.js';

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

const { runSetup, shellQuote } = await import('../../../src/cli/setup.js');

class SetupExitError extends Error {
  constructor(public readonly code: number) {
    super(`exit(${code})`);
  }
}

// ---------------------------------------------------------------------------
// Mock client configs
// ---------------------------------------------------------------------------

function makeMockClient(
  name: McpClientType,
  displayName: string,
  overrides?: Partial<McpClientConfig>,
): McpClientConfig {
  return {
    name,
    displayName,
    configPath: () => `/mock/config/${name}.json`,
    configKey: 'mcpServers',
    detectInstall: () => true,
    ...overrides,
  };
}

const mockClaudeCode = makeMockClient('claude-code', 'Claude Code', {
  useCli: async () => true,
  removeCli: async () => true,
});

const mockClaudeDesktop = makeMockClient('claude-desktop', 'Claude Desktop');

const mockVscode = makeMockClient('vscode', 'VS Code', {
  detectInstall: () => false,
});

function defaultClientList(): Array<{
  type: McpClientType;
  config: McpClientConfig;
  detected: boolean;
}> {
  return [
    { type: 'claude-code', config: mockClaudeCode, detected: true },
    { type: 'claude-desktop', config: mockClaudeDesktop, detected: true },
    { type: 'vscode', config: mockVscode, detected: false },
  ];
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

function createTestDeps(
  answers: string[],
  overrides?: Partial<SetupDeps>,
): { deps: SetupDeps; logs: string[]; errors: string[] } {
  const logs: string[] = [];
  const errors: string[] = [];
  let answerIndex = 0;

  return {
    deps: {
      prompt: async () => answers[answerIndex++] ?? '',
      promptSecret: async () => answers[answerIndex++] ?? '',
      log: (msg: string) => logs.push(msg),
      error: (msg: string) => errors.push(msg),
      exit: ((code: number) => {
        throw new SetupExitError(code);
      }) as (code: number) => never,
      cleanup: () => {},
      ...overrides,
    },
    logs,
    errors,
  };
}

// Successful fetch responses for validation (user + sync endpoint)
function mockSuccessfulValidation(): void {
  fetchMock
    .mockResolvedValueOnce(mockResponse({ id: 1, name: 'admin', slug: 'admin', avatar_urls: {} }))
    .mockResolvedValueOnce(mockResponse({ rooms: [] }));
}

// Mock openAuth that returns the auth URL
const mockOpenAuth = vi
  .fn()
  .mockResolvedValue('https://example.com/wp-admin/authorize-application.php?app_name=test');

/** Create a selectCheckbox mock that returns the given indices */
function mockCheckbox(selected: number[]): () => Promise<CheckboxResult> {
  return vi.fn().mockResolvedValue({ selected });
}

describe('setup wizard', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  // -----------------------------------------------------------------------
  // Manual credential collection (legacy behavior preserved)
  // -----------------------------------------------------------------------

  describe('manual credential flow', () => {
    it('validates and configures clients on successful setup', async () => {
      mockSuccessfulValidation();
      const writeConfig = vi.fn().mockResolvedValue(true);

      const { deps, logs } = createTestDeps(['https://example.com', 'admin', 'xxxx xxxx xxxx'], {
        detectClients: () => defaultClientList(),
        selectCheckbox: mockCheckbox([0, 1]),
        writeConfig,
        hasConfig: () => false,
      });

      await runSetup(deps, { manual: true });

      const output = logs.join('\n');
      expect(output).toContain('Authenticated as "admin"');
      expect(output).toContain('Collaborative editing endpoint available');
      expect(output).toContain('Done! Restart your MCP clients to start editing.');
      // writeConfig called for selected clients (claude-code and claude-desktop)
      expect(writeConfig).toHaveBeenCalledTimes(2);
    });

    it('prepends https:// to bare domain URLs', async () => {
      mockSuccessfulValidation();
      const writeConfig = vi.fn().mockResolvedValue(true);

      const { deps } = createTestDeps(['pento.net', 'admin', 'xxxx xxxx xxxx'], {
        detectClients: () => defaultClientList(),
        selectCheckbox: mockCheckbox([0]),
        writeConfig,
        hasConfig: () => false,
      });

      await runSetup(deps, { manual: true });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('https://pento.net/wp-json/'),
        expect.anything(),
      );
    });

    it('preserves explicit http:// scheme', async () => {
      mockSuccessfulValidation();
      const writeConfig = vi.fn().mockResolvedValue(true);

      const { deps } = createTestDeps(['http://localhost:8080', 'admin', 'xxxx xxxx xxxx'], {
        detectClients: () => defaultClientList(),
        selectCheckbox: mockCheckbox([0]),
        writeConfig,
        hasConfig: () => false,
      });

      await runSetup(deps, { manual: true });

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('http://localhost:8080/wp-json/'),
        expect.anything(),
      );
    });

    it('exits with error on auth failure', async () => {
      fetchMock.mockResolvedValueOnce(
        mockResponse(
          { code: 'rest_forbidden', message: 'Sorry' },
          { status: 401, statusText: 'Unauthorized' },
        ),
      );

      const { deps, errors } = createTestDeps(['https://example.com', 'admin', 'bad-password'], {
        detectClients: () => defaultClientList(),
        hasConfig: () => false,
      });

      await expect(runSetup(deps, { manual: true })).rejects.toThrow(SetupExitError);
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

      const { deps, errors } = createTestDeps(['https://example.com', 'admin', 'xxxx xxxx xxxx'], {
        detectClients: () => defaultClientList(),
        hasConfig: () => false,
      });

      await expect(runSetup(deps, { manual: true })).rejects.toThrow(SetupExitError);
      expect(errors.join('\n')).toContain('Collaborative editing is not enabled');
    });

    it('exits with error when site URL is empty', async () => {
      const { deps, errors } = createTestDeps(['', 'admin', 'xxxx'], {
        detectClients: () => defaultClientList(),
      });

      await expect(runSetup(deps, { manual: true })).rejects.toThrow(SetupExitError);
      expect(errors.join('\n')).toContain('Site URL is required');
    });

    it('exits with error when username is empty', async () => {
      const { deps, errors } = createTestDeps(['https://example.com', '', 'xxxx'], {
        detectClients: () => defaultClientList(),
      });

      await expect(runSetup(deps, { manual: true })).rejects.toThrow(SetupExitError);
      expect(errors.join('\n')).toContain('Username is required');
    });

    it('exits with error when application password is empty', async () => {
      const { deps, errors } = createTestDeps(['https://example.com', 'admin', ''], {
        detectClients: () => defaultClientList(),
      });

      await expect(runSetup(deps, { manual: true })).rejects.toThrow(SetupExitError);
      expect(errors.join('\n')).toContain('Application Password is required');
    });

    it('exits with generic connection error on non-API auth failure', async () => {
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

      const { deps, errors } = createTestDeps(['https://example.com', 'admin', 'xxxx xxxx xxxx'], {
        detectClients: () => defaultClientList(),
        hasConfig: () => false,
      });

      await expect(runSetup(deps, { manual: true })).rejects.toThrow(SetupExitError);
      expect(errors.join('\n')).toContain('Could not connect to https://example.com');
    });

    it('exits with API error message on non-404 sync endpoint failure', async () => {
      fetchMock
        .mockResolvedValueOnce(
          mockResponse({ id: 1, name: 'admin', slug: 'admin', avatar_urls: {} }),
        )
        .mockResolvedValueOnce(
          mockResponse(
            { code: 'internal_server_error', message: 'Something broke' },
            { status: 500, statusText: 'Internal Server Error' },
          ),
        );

      const { deps, errors } = createTestDeps(['https://example.com', 'admin', 'xxxx xxxx xxxx'], {
        detectClients: () => defaultClientList(),
        hasConfig: () => false,
      });

      await expect(runSetup(deps, { manual: true })).rejects.toThrow(SetupExitError);

      const errorOutput = errors.join('\n');
      expect(errorOutput).not.toContain('Collaborative editing is not enabled');
      expect(errorOutput).toMatch(/Something broke|Internal Server Error|500/);
    });

    it('exits with generic sync error on non-API sync endpoint failure', async () => {
      fetchMock
        .mockResolvedValueOnce(
          mockResponse({ id: 1, name: 'admin', slug: 'admin', avatar_urls: {} }),
        )
        .mockRejectedValueOnce(new Error('network timeout'));

      const { deps, errors } = createTestDeps(['https://example.com', 'admin', 'xxxx xxxx xxxx'], {
        detectClients: () => defaultClientList(),
        hasConfig: () => false,
      });

      await expect(runSetup(deps, { manual: true })).rejects.toThrow(SetupExitError);
      expect(errors.join('\n')).toContain('Could not validate the sync endpoint');
    });

    it('does not call browser auth when --manual flag is set', async () => {
      mockSuccessfulValidation();
      const openAuth = vi.fn();

      const { deps } = createTestDeps(['https://example.com', 'admin', 'xxxx xxxx xxxx'], {
        openAuth,
        detectClients: () => defaultClientList(),
        selectCheckbox: mockCheckbox([0]),
        writeConfig: vi.fn().mockResolvedValue(true),
        hasConfig: () => false,
      });

      await runSetup(deps, { manual: true });
      expect(openAuth).not.toHaveBeenCalled();
    });
  });

  // -----------------------------------------------------------------------
  // Browser auth flow
  // -----------------------------------------------------------------------

  describe('browser auth flow', () => {
    it('opens auth page and prompts for credentials', async () => {
      mockSuccessfulValidation();
      const openAuth = vi
        .fn()
        .mockResolvedValue('https://example.com/wp-admin/authorize-application.php?app_name=test');

      const { deps, logs } = createTestDeps(['https://example.com', 'admin', 'xxxx xxxx xxxx'], {
        openAuth,
        detectClients: () => defaultClientList(),
        selectCheckbox: mockCheckbox([0, 1]),
        writeConfig: vi.fn().mockResolvedValue(true),
        hasConfig: () => false,
      });

      await runSetup(deps);

      expect(openAuth).toHaveBeenCalledWith('https://example.com');

      const output = logs.join('\n');
      expect(output).toContain('Opening your browser to authorize');
      expect(output).toContain('Approve the connection');
      expect(output).toContain('authorize-application.php');
      expect(output).toContain('Authenticated as "admin"');
    });

    it('prepends https:// to bare domain before opening auth page', async () => {
      mockSuccessfulValidation();
      const openAuth = vi
        .fn()
        .mockResolvedValue('https://pento.net/wp-admin/authorize-application.php');

      const { deps } = createTestDeps(['pento.net', 'admin', 'xxxx xxxx xxxx'], {
        openAuth,
        detectClients: () => defaultClientList(),
        selectCheckbox: mockCheckbox([0]),
        writeConfig: vi.fn().mockResolvedValue(true),
        hasConfig: () => false,
      });

      await runSetup(deps);

      expect(openAuth).toHaveBeenCalledWith('https://pento.net');
    });

    it('exits when site URL is empty in browser flow', async () => {
      const { deps, errors } = createTestDeps([''], {
        openAuth: mockOpenAuth,
        detectClients: () => defaultClientList(),
      });

      await expect(runSetup(deps)).rejects.toThrow(SetupExitError);
      expect(errors.join('\n')).toContain('Site URL is required');
    });

    it('exits when username is empty in browser flow', async () => {
      const { deps, errors } = createTestDeps(
        [
          'https://example.com',
          '', // empty username
        ],
        {
          openAuth: mockOpenAuth,
          detectClients: () => defaultClientList(),
        },
      );

      await expect(runSetup(deps)).rejects.toThrow(SetupExitError);
      expect(errors.join('\n')).toContain('Username is required');
    });

    it('exits when app password is empty in browser flow', async () => {
      const { deps, errors } = createTestDeps(
        [
          'https://example.com',
          'admin',
          '', // empty password
        ],
        {
          openAuth: mockOpenAuth,
          detectClients: () => defaultClientList(),
        },
      );

      await expect(runSetup(deps)).rejects.toThrow(SetupExitError);
      expect(errors.join('\n')).toContain('Application Password is required');
    });
  });

  // -----------------------------------------------------------------------
  // Client detection and selection
  // -----------------------------------------------------------------------

  describe('client detection and selection', () => {
    const manualAnswers = ['https://example.com', 'admin', 'xxxx xxxx xxxx'];

    it('displays instruction text for checkbox selection', async () => {
      mockSuccessfulValidation();

      const { deps, logs } = createTestDeps(manualAnswers, {
        detectClients: () => defaultClientList(),
        selectCheckbox: mockCheckbox([0, 1]),
        writeConfig: vi.fn().mockResolvedValue(true),
        hasConfig: () => false,
      });

      await runSetup(deps, { manual: true });

      const output = logs.join('\n');
      expect(output).toContain('Select MCP clients to configure');
    });

    it('configures all clients when all are selected', async () => {
      mockSuccessfulValidation();
      const writeConfig = vi.fn().mockResolvedValue(true);

      const { deps } = createTestDeps(manualAnswers, {
        detectClients: () => defaultClientList(),
        selectCheckbox: mockCheckbox([0, 1, 2]),
        writeConfig,
        hasConfig: () => false,
      });

      await runSetup(deps, { manual: true });

      // All 3 clients should be configured
      expect(writeConfig).toHaveBeenCalledTimes(3);
    });

    it('configures only selected clients', async () => {
      mockSuccessfulValidation();
      const writeConfig = vi.fn().mockResolvedValue(true);

      const { deps } = createTestDeps(manualAnswers, {
        detectClients: () => defaultClientList(),
        selectCheckbox: mockCheckbox([0, 2]),
        writeConfig,
        hasConfig: () => false,
      });

      await runSetup(deps, { manual: true });

      // Clients 0 and 2 should be configured
      expect(writeConfig).toHaveBeenCalledTimes(2);
    });

    it('configures only detected clients when defaults are used', async () => {
      mockSuccessfulValidation();
      const writeConfig = vi.fn().mockResolvedValue(true);

      const { deps } = createTestDeps(manualAnswers, {
        detectClients: () => defaultClientList(),
        selectCheckbox: mockCheckbox([0, 1]),
        writeConfig,
        hasConfig: () => false,
      });

      await runSetup(deps, { manual: true });

      // Only the 2 detected clients should be configured
      expect(writeConfig).toHaveBeenCalledTimes(2);
    });
  });

  // -----------------------------------------------------------------------
  // Client configuration
  // -----------------------------------------------------------------------

  describe('client configuration', () => {
    const manualAnswers = ['https://example.com', 'admin', 'xxxx xxxx xxxx'];

    it('uses CLI when writeConfig returns true', async () => {
      mockSuccessfulValidation();
      const writeConfig = vi.fn().mockResolvedValue(true);

      const { deps, logs } = createTestDeps(manualAnswers, {
        detectClients: () => defaultClientList(),
        selectCheckbox: mockCheckbox([0]),
        writeConfig,
        hasConfig: () => false,
      });

      await runSetup(deps, { manual: true });

      expect(writeConfig).toHaveBeenCalledTimes(1);
      const output = logs.join('\n');
      expect(output).toContain('Claude Code — configured via CLI');
    });

    it('falls back to config file for client without useCli', async () => {
      mockSuccessfulValidation();
      const writeConfig = vi.fn().mockResolvedValue(true);

      const { deps, logs } = createTestDeps(manualAnswers, {
        detectClients: () => defaultClientList(),
        selectCheckbox: mockCheckbox([1]),
        writeConfig,
        hasConfig: () => false,
      });

      await runSetup(deps, { manual: true });

      const output = logs.join('\n');
      expect(output).toMatch(/Claude Desktop/);
    });

    it('prompts when entry already exists and skips on decline', async () => {
      mockSuccessfulValidation();
      const writeConfig = vi.fn().mockResolvedValue(true);

      // 'n' is the prompt answer for the overwrite confirmation
      const { deps, logs } = createTestDeps([...manualAnswers, 'n'], {
        detectClients: () => defaultClientList(),
        selectCheckbox: mockCheckbox([0]),
        writeConfig,
        hasConfig: () => true,
      });

      await runSetup(deps, { manual: true });

      expect(writeConfig).not.toHaveBeenCalled();
      const output = logs.join('\n');
      expect(output).toContain('Claude Code — skipped');
    });

    it('overwrites when entry exists and user confirms', async () => {
      mockSuccessfulValidation();
      const writeConfig = vi.fn().mockResolvedValue(true);

      const { deps, logs } = createTestDeps([...manualAnswers, 'Y'], {
        detectClients: () => defaultClientList(),
        selectCheckbox: mockCheckbox([0]),
        writeConfig,
        hasConfig: () => true,
      });

      await runSetup(deps, { manual: true });

      expect(writeConfig).toHaveBeenCalledTimes(1);
      const output = logs.join('\n');
      expect(output).toContain('Claude Code — configured via CLI');
    });

    it('overwrites on empty response (default yes)', async () => {
      mockSuccessfulValidation();
      const writeConfig = vi.fn().mockResolvedValue(true);

      const { deps } = createTestDeps([...manualAnswers, ''], {
        detectClients: () => defaultClientList(),
        selectCheckbox: mockCheckbox([0]),
        writeConfig,
        hasConfig: () => true,
      });

      await runSetup(deps, { manual: true });

      expect(writeConfig).toHaveBeenCalledTimes(1);
    });

    it('logs failure when configuration throws', async () => {
      mockSuccessfulValidation();
      const writeConfig = vi.fn().mockRejectedValue(new Error('Permission denied'));

      const { deps, logs } = createTestDeps(manualAnswers, {
        detectClients: () => defaultClientList(),
        selectCheckbox: mockCheckbox([0]),
        writeConfig,
        hasConfig: () => false,
      });

      await runSetup(deps, { manual: true });

      const output = logs.join('\n');
      expect(output).toContain('Claude Code — failed: Permission denied');
    });
  });

  // -----------------------------------------------------------------------
  // --client flag
  // -----------------------------------------------------------------------

  describe('--client flag', () => {
    it('configures only the specified client', async () => {
      mockSuccessfulValidation();
      const writeConfig = vi.fn().mockResolvedValue(true);

      const { deps, logs } = createTestDeps(
        [
          'https://example.com', // site URL
          'admin', // username
          'xxxx xxxx xxxx', // app password
        ],
        {
          detectClients: () => defaultClientList(),
          writeConfig,
          hasConfig: () => false,
        },
      );

      await runSetup(deps, { client: 'claude-code' });

      expect(writeConfig).toHaveBeenCalledTimes(1);
      const output = logs.join('\n');
      expect(output).toContain('Claude Code — configured via CLI');
    });

    it('uses manual credential entry when --client is specified', async () => {
      mockSuccessfulValidation();
      const openAuth = vi.fn();

      const { deps } = createTestDeps(['https://example.com', 'admin', 'xxxx xxxx xxxx'], {
        openAuth,
        detectClients: () => defaultClientList(),
        writeConfig: vi.fn().mockResolvedValue(true),
        hasConfig: () => false,
      });

      await runSetup(deps, { client: 'claude-desktop' });

      // Browser auth should NOT be called when --client is specified
      expect(openAuth).not.toHaveBeenCalled();
    });

    it('exits with error for unknown client', async () => {
      mockSuccessfulValidation();

      const { deps, errors } = createTestDeps(['https://example.com', 'admin', 'xxxx xxxx xxxx'], {
        detectClients: () => defaultClientList(),
        hasConfig: () => false,
      });

      await expect(runSetup(deps, { client: 'nonexistent' as McpClientType })).rejects.toThrow(
        SetupExitError,
      );
      expect(errors.join('\n')).toContain('Unknown client: nonexistent');
    });
  });

  // -----------------------------------------------------------------------
  // Remove flow
  // -----------------------------------------------------------------------

  describe('remove flow', () => {
    it('removes configured clients', async () => {
      const removeConfig = vi.fn().mockResolvedValue(true);

      const { deps, logs } = createTestDeps([], {
        detectClients: () => defaultClientList(),
        hasConfig: (config: McpClientConfig) => config.name !== 'vscode',
        selectCheckbox: mockCheckbox([0, 1]),
        removeConfig,
      });

      await runSetup(deps, { remove: true });

      // claude-code and claude-desktop have config, vscode does not
      expect(removeConfig).toHaveBeenCalledTimes(2);
      const output = logs.join('\n');
      expect(output).toContain('Claude Code — removed via CLI');
      expect(output).toContain('Claude Desktop — removed via CLI');
      expect(output).toContain('Done! Restart your MCP clients to complete removal.');
    });

    it('shows message when no clients are configured', async () => {
      const { deps, logs } = createTestDeps([], {
        detectClients: () => defaultClientList(),
        hasConfig: () => false,
      });

      await runSetup(deps, { remove: true });

      const output = logs.join('\n');
      expect(output).toContain('No MCP clients have claudaborative-editing configured.');
    });

    it('allows selecting specific clients for removal', async () => {
      const removeConfig = vi.fn().mockResolvedValue(true);

      const { deps, logs } = createTestDeps([], {
        detectClients: () => defaultClientList(),
        hasConfig: (config: McpClientConfig) => config.name !== 'vscode',
        selectCheckbox: mockCheckbox([0]),
        removeConfig,
      });

      await runSetup(deps, { remove: true });

      expect(removeConfig).toHaveBeenCalledTimes(1);
      const output = logs.join('\n');
      expect(output).toContain('Claude Code — removed via CLI');
      expect(output).not.toContain('Claude Desktop — removed');
    });

    it('removes all configured clients when all selected', async () => {
      const removeConfig = vi.fn().mockResolvedValue(true);

      const { deps } = createTestDeps([], {
        detectClients: () => defaultClientList(),
        hasConfig: (config: McpClientConfig) => config.name !== 'vscode',
        selectCheckbox: mockCheckbox([0, 1]),
        removeConfig,
      });

      await runSetup(deps, { remove: true });

      expect(removeConfig).toHaveBeenCalledTimes(2);
    });

    it('logs failure when removal throws', async () => {
      const removeConfig = vi.fn().mockRejectedValue(new Error('Permission denied'));

      const { deps, logs } = createTestDeps([], {
        detectClients: () => defaultClientList(),
        hasConfig: (config: McpClientConfig) => config.name === 'claude-code',
        selectCheckbox: mockCheckbox([0]),
        removeConfig,
      });

      await runSetup(deps, { remove: true });

      const output = logs.join('\n');
      expect(output).toContain('Claude Code — failed: Permission denied');
    });
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
