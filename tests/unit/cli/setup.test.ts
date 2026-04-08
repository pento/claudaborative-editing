import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { SetupDeps } from '../../../src/cli/setup.js';
import type { McpClientConfig, McpClientType } from '../../../src/cli/types.js';
import type {
	AuthResult,
	AuthFlowHandle,
} from '../../../src/cli/auth-server.js';

// Temp directory for tests that need real filesystem writes
const testTmpDir = mkdtempSync(join(tmpdir(), 'setup-test-'));

// Mock fetch globally before importing the module under test
const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

function mockResponse(
	body: unknown,
	init?: { status?: number; statusText?: string }
): Response {
	const status = init?.status ?? 200;
	return {
		ok: status >= 200 && status < 300,
		status,
		statusText: init?.statusText ?? 'OK',
		json() {
			return body;
		},
		text() {
			return JSON.stringify(body);
		},
		headers: new Headers(),
	} as unknown as Response;
}

const { runSetup } = await import('../../../src/cli/setup.js');

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
	overrides?: Partial<McpClientConfig>
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
	useCli: () => true,
	removeCli: () => true,
});

function defaultClientList(): Array<{
	type: McpClientType;
	config: McpClientConfig;
	detected: boolean;
}> {
	return [{ type: 'claude-code', config: mockClaudeCode, detected: true }];
}

// ---------------------------------------------------------------------------
// Test helper
// ---------------------------------------------------------------------------

function createTestDeps(
	answers: string[],
	overrides?: Partial<SetupDeps>
): { deps: SetupDeps; logs: string[]; errors: string[] } {
	const logs: string[] = [];
	const errors: string[] = [];
	let answerIndex = 0;

	return {
		deps: {
			prompt: () => Promise.resolve(answers[answerIndex++] ?? ''),
			promptSecret: () => Promise.resolve(answers[answerIndex++] ?? ''),
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

// Successful fetch responses for validation (user + version check + sync endpoint)
function mockSuccessfulValidation(): void {
	fetchMock
		.mockResolvedValueOnce(
			mockResponse({
				id: 1,
				name: 'admin',
				slug: 'admin',
				avatar_urls: {},
			})
		)
		.mockResolvedValueOnce(mockResponse({ version: '7.0' }))
		.mockResolvedValueOnce(mockResponse({ rooms: [] }));
}

// Helper to build an AuthFlowHandle for test mocks.
// The result promise resolves immediately with the given AuthResult.
function mockAuthHandle(overrides?: Partial<AuthResult>): AuthFlowHandle {
	const authResult: AuthResult = {
		credentials: {
			siteUrl: 'https://example.com',
			username: 'admin',
			appPassword: 'xxxx xxxx xxxx',
		},
		rejected: false,
		...overrides,
	};
	return {
		authUrl:
			'https://example.com/wp-admin/authorize-application.php?app_name=test',
		result: Promise.resolve(authResult),
		abort: vi.fn(),
	};
}

// Handle where the callback never fires — simulates pre-WP 7.0.
// The result promise never resolves, so the race prompt wins.
function mockNeverHandle(authUrl?: string): AuthFlowHandle {
	return {
		authUrl:
			authUrl ??
			'https://example.com/wp-admin/authorize-application.php?app_name=test',
		result: new Promise<AuthResult>(() => {}),
		abort: vi.fn(),
	};
}

// Mock openAuth that returns successful credentials via callback
const mockOpenAuth = vi.fn().mockResolvedValue(mockAuthHandle());

afterAll(() => {
	rmSync(testTmpDir, { recursive: true, force: true });
});

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

			const { deps, logs } = createTestDeps(
				['https://example.com', 'admin', 'xxxx xxxx xxxx'],
				{
					detectClients: () => defaultClientList(),
					writeConfig,
					hasConfig: () => false,
				}
			);

			await runSetup(deps, { manual: true });

			const output = logs.join('\n');
			expect(output).toContain('Authenticated as "admin"');
			expect(output).toContain(
				'Collaborative editing endpoint available'
			);
			expect(output).toContain(
				'Done! Restart Claude Code to start editing.'
			);
			expect(writeConfig).toHaveBeenCalledTimes(1);
		});

		it('prepends https:// to bare domain URLs', async () => {
			mockSuccessfulValidation();
			const writeConfig = vi.fn().mockResolvedValue(true);

			const { deps } = createTestDeps(
				['pento.net', 'admin', 'xxxx xxxx xxxx'],
				{
					detectClients: () => defaultClientList(),
					writeConfig,
					hasConfig: () => false,
				}
			);

			await runSetup(deps, { manual: true });

			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining('https://pento.net/wp-json/'),
				expect.anything()
			);
		});

		it('preserves explicit http:// scheme', async () => {
			mockSuccessfulValidation();
			const writeConfig = vi.fn().mockResolvedValue(true);

			const { deps } = createTestDeps(
				['http://localhost:8080', 'admin', 'xxxx xxxx xxxx'],
				{
					detectClients: () => defaultClientList(),
					writeConfig,
					hasConfig: () => false,
				}
			);

			await runSetup(deps, { manual: true });

			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining('http://localhost:8080/wp-json/'),
				expect.anything()
			);
		});

		it('strips trailing slashes from URLs', async () => {
			mockSuccessfulValidation();
			const writeConfig = vi.fn().mockResolvedValue(true);

			const { deps } = createTestDeps(
				['https://example.com/', 'admin', 'xxxx xxxx xxxx'],
				{
					detectClients: () => defaultClientList(),
					writeConfig,
					hasConfig: () => false,
				}
			);

			await runSetup(deps, { manual: true });

			// Should use the URL without trailing slash
			expect(fetchMock).toHaveBeenCalledWith(
				expect.stringContaining('https://example.com/wp-json/'),
				expect.anything()
			);
		});

		it('exits with error on auth failure', async () => {
			fetchMock.mockResolvedValueOnce(
				mockResponse(
					{ code: 'rest_forbidden', message: 'Sorry' },
					{ status: 401, statusText: 'Unauthorized' }
				)
			);

			const { deps, errors } = createTestDeps(
				['https://example.com', 'admin', 'bad-password'],
				{
					detectClients: () => defaultClientList(),
					hasConfig: () => false,
				}
			);

			await expect(runSetup(deps, { manual: true })).rejects.toThrow(
				SetupExitError
			);
			expect(errors.join('\n')).toContain('Authentication failed');
		});

		it('includes version in error when old WP lacks sync endpoint', async () => {
			fetchMock
				.mockResolvedValueOnce(
					mockResponse({
						id: 1,
						name: 'admin',
						slug: 'admin',
						avatar_urls: {},
					})
				)
				.mockResolvedValueOnce(mockResponse({ version: '6.7' }))
				.mockResolvedValueOnce(
					mockResponse(
						{ code: 'rest_no_route', message: 'No route' },
						{ status: 404, statusText: 'Not Found' }
					)
				);

			const { deps, errors } = createTestDeps(
				['https://example.com', 'admin', 'xxxx xxxx xxxx'],
				{
					detectClients: () => defaultClientList(),
					hasConfig: () => false,
				}
			);

			await expect(runSetup(deps, { manual: true })).rejects.toThrow(
				SetupExitError
			);
			const errorText = errors.join('\n');
			expect(errorText).toContain(
				'Collaborative editing is not available'
			);
			expect(errorText).toContain('6.7');
		});

		it('exits with error when sync endpoint returns 404', async () => {
			fetchMock
				.mockResolvedValueOnce(
					mockResponse({
						id: 1,
						name: 'admin',
						slug: 'admin',
						avatar_urls: {},
					})
				)
				.mockResolvedValueOnce(mockResponse({ version: '7.0' }))
				.mockResolvedValueOnce(
					mockResponse(
						{ code: 'rest_no_route', message: 'No route' },
						{ status: 404, statusText: 'Not Found' }
					)
				);

			const { deps, errors } = createTestDeps(
				['https://example.com', 'admin', 'xxxx xxxx xxxx'],
				{
					detectClients: () => defaultClientList(),
					hasConfig: () => false,
				}
			);

			await expect(runSetup(deps, { manual: true })).rejects.toThrow(
				SetupExitError
			);
			expect(errors.join('\n')).toContain(
				'Collaborative editing is not available'
			);
		});

		it('exits with error when site URL is empty', async () => {
			const { deps, errors } = createTestDeps(['', 'admin', 'xxxx'], {
				detectClients: () => defaultClientList(),
			});

			await expect(runSetup(deps, { manual: true })).rejects.toThrow(
				SetupExitError
			);
			expect(errors.join('\n')).toContain('Site URL is required');
		});

		it('exits with error when username is empty', async () => {
			const { deps, errors } = createTestDeps(
				['https://example.com', '', 'xxxx'],
				{
					detectClients: () => defaultClientList(),
				}
			);

			await expect(runSetup(deps, { manual: true })).rejects.toThrow(
				SetupExitError
			);
			expect(errors.join('\n')).toContain('Username is required');
		});

		it('exits with error when application password is empty', async () => {
			const { deps, errors } = createTestDeps(
				['https://example.com', 'admin', ''],
				{
					detectClients: () => defaultClientList(),
				}
			);

			await expect(runSetup(deps, { manual: true })).rejects.toThrow(
				SetupExitError
			);
			expect(errors.join('\n')).toContain(
				'Application Password is required'
			);
		});

		it('exits with generic connection error on non-API auth failure', async () => {
			fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));

			const { deps, errors } = createTestDeps(
				['https://example.com', 'admin', 'xxxx xxxx xxxx'],
				{
					detectClients: () => defaultClientList(),
					hasConfig: () => false,
				}
			);

			await expect(runSetup(deps, { manual: true })).rejects.toThrow(
				SetupExitError
			);
			expect(errors.join('\n')).toContain(
				'Could not connect to https://example.com'
			);
		});

		it('exits with API error message on non-404 sync endpoint failure', async () => {
			fetchMock
				.mockResolvedValueOnce(
					mockResponse({
						id: 1,
						name: 'admin',
						slug: 'admin',
						avatar_urls: {},
					})
				)
				.mockResolvedValueOnce(mockResponse({ version: '7.0' }))
				.mockResolvedValueOnce(
					mockResponse(
						{
							code: 'internal_server_error',
							message: 'Something broke',
						},
						{ status: 500, statusText: 'Internal Server Error' }
					)
				);

			const { deps, errors } = createTestDeps(
				['https://example.com', 'admin', 'xxxx xxxx xxxx'],
				{
					detectClients: () => defaultClientList(),
					hasConfig: () => false,
				}
			);

			await expect(runSetup(deps, { manual: true })).rejects.toThrow(
				SetupExitError
			);

			const errorOutput = errors.join('\n');
			expect(errorOutput).not.toContain(
				'Collaborative editing is not enabled'
			);
			expect(errorOutput).toMatch(
				/Something broke|Internal Server Error|500/
			);
		});

		it('exits with generic sync error on non-API sync endpoint failure', async () => {
			fetchMock
				.mockResolvedValueOnce(
					mockResponse({
						id: 1,
						name: 'admin',
						slug: 'admin',
						avatar_urls: {},
					})
				)
				.mockRejectedValueOnce(new Error('network timeout'));

			const { deps, errors } = createTestDeps(
				['https://example.com', 'admin', 'xxxx xxxx xxxx'],
				{
					detectClients: () => defaultClientList(),
					hasConfig: () => false,
				}
			);

			await expect(runSetup(deps, { manual: true })).rejects.toThrow(
				SetupExitError
			);
			expect(errors.join('\n')).toContain(
				'Could not validate the sync endpoint'
			);
		});

		it('does not call browser auth when --manual flag is set', async () => {
			mockSuccessfulValidation();
			const openAuth = vi.fn();

			const { deps } = createTestDeps(
				['https://example.com', 'admin', 'xxxx xxxx xxxx'],
				{
					openAuth,
					detectClients: () => defaultClientList(),
					writeConfig: vi.fn().mockResolvedValue(true),
					hasConfig: () => false,
				}
			);

			await runSetup(deps, { manual: true });
			expect(openAuth).not.toHaveBeenCalled();
		});
	});

	// -----------------------------------------------------------------------
	// Browser auth flow
	// -----------------------------------------------------------------------

	describe('browser auth flow', () => {
		it('auto-receives credentials via callback without manual prompts', async () => {
			mockSuccessfulValidation();
			const openAuth = vi.fn().mockResolvedValue(mockAuthHandle());

			// site URL + race prompt answer (race prompt is consumed but callback wins)
			const { deps, logs } = createTestDeps(['https://example.com', ''], {
				openAuth,
				detectClients: () => defaultClientList(),
				writeConfig: vi.fn().mockResolvedValue(true),
				hasConfig: () => false,
			});

			await runSetup(deps);

			expect(openAuth).toHaveBeenCalledWith('https://example.com');

			const output = logs.join('\n');
			expect(output).toContain('Opening your browser to authorise');
			expect(output).toContain('authorize-application.php');
			expect(output).toContain('Credentials received automatically');
			expect(output).toContain('Authenticated as "admin"');
		});

		it('prepends https:// to bare domain before starting auth flow', async () => {
			mockSuccessfulValidation();
			const openAuth = vi.fn().mockResolvedValue(mockAuthHandle());

			const { deps } = createTestDeps(['pento.net', ''], {
				openAuth,
				detectClients: () => defaultClientList(),

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

		it('exits with error when authorisation is rejected', async () => {
			const openAuth = vi
				.fn()
				.mockResolvedValue(
					mockAuthHandle({ credentials: null, rejected: true })
				);

			const { deps, errors } = createTestDeps(
				['https://example.com', ''],
				{
					openAuth,
					detectClients: () => defaultClientList(),
				}
			);

			await expect(runSetup(deps)).rejects.toThrow(SetupExitError);
			expect(errors.join('\n')).toContain('Authorisation was denied');
		});

		it('falls back to manual auth page when user presses Enter', async () => {
			mockSuccessfulValidation();
			const openAuth = vi.fn().mockResolvedValue(mockNeverHandle());
			const openBrowser = vi.fn().mockResolvedValue(undefined);

			// site URL, race prompt (Enter wins because callback never resolves),
			// then manual username + password
			const { deps, logs } = createTestDeps(
				['https://example.com', '', 'admin', 'xxxx xxxx xxxx'],
				{
					openAuth,
					openBrowser,
					detectClients: () => defaultClientList(),
					writeConfig: vi.fn().mockResolvedValue(true),
					hasConfig: () => false,
				}
			);

			await runSetup(deps);

			const output = logs.join('\n');
			expect(output).toContain('Approve the connection');
			expect(output).toContain('Authenticated as "admin"');

			// Should have called abort on the auth flow handle
			const resolvedHandle = (await openAuth.mock.results[0]
				.value) as AuthFlowHandle;
			expect(resolvedHandle.abort).toHaveBeenCalled();

			// Should have opened the non-callback auth URL
			expect(openBrowser).toHaveBeenCalledOnce();
			const manualUrl = openBrowser.mock.calls[0][0] as string;
			expect(manualUrl).toContain('authorize-application.php');
			expect(manualUrl).not.toContain('success_url');
		});

		it('exits when username is empty in manual fallback', async () => {
			const openAuth = vi.fn().mockResolvedValue(mockNeverHandle());
			const openBrowser = vi.fn().mockResolvedValue(undefined);

			const { deps, errors } = createTestDeps(
				[
					'https://example.com',
					'', // race prompt (Enter)
					'', // empty username in fallback
				],
				{
					openAuth,
					openBrowser,
					detectClients: () => defaultClientList(),
				}
			);

			await expect(runSetup(deps)).rejects.toThrow(SetupExitError);
			expect(errors.join('\n')).toContain('Username is required');
		});

		it('exits when app password is empty in manual fallback', async () => {
			const openAuth = vi.fn().mockResolvedValue(mockNeverHandle());
			const openBrowser = vi.fn().mockResolvedValue(undefined);

			const { deps, errors } = createTestDeps(
				[
					'https://example.com',
					'', // race prompt (Enter)
					'admin',
					'', // empty password in fallback
				],
				{
					openAuth,
					openBrowser,
					detectClients: () => defaultClientList(),
				}
			);

			await expect(runSetup(deps)).rejects.toThrow(SetupExitError);
			expect(errors.join('\n')).toContain(
				'Application Password is required'
			);
		});
	});

	// -----------------------------------------------------------------------
	// Claude Code detection
	// -----------------------------------------------------------------------

	describe('Claude Code detection', () => {
		it('exits with error when Claude Code is not detected', async () => {
			mockSuccessfulValidation();

			const { deps, errors } = createTestDeps(
				['https://example.com', 'admin', 'xxxx xxxx xxxx'],
				{
					detectClients: () => [
						{
							type: 'claude-code' as McpClientType,
							config: mockClaudeCode,
							detected: false,
						},
					],
					hasConfig: () => false,
				}
			);

			await expect(runSetup(deps, { manual: true })).rejects.toThrow(
				SetupExitError
			);
			expect(errors.join('\n')).toContain('Claude Code is not installed');
		});
	});

	// -----------------------------------------------------------------------
	// Client configuration
	// -----------------------------------------------------------------------

	describe('client configuration', () => {
		const manualAnswers = [
			'https://example.com',
			'admin',
			'xxxx xxxx xxxx',
		];

		it('uses CLI when writeConfig returns true', async () => {
			mockSuccessfulValidation();
			const writeConfig = vi.fn().mockResolvedValue(true);

			const { deps, logs } = createTestDeps(manualAnswers, {
				detectClients: () => defaultClientList(),

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
			const clientNoCli = makeMockClient('claude-code', 'Claude Code', {
				configPath: () =>
					join(testTmpDir, 'no-cli-fallback', 'config.json'),
			});

			const { deps, logs } = createTestDeps(manualAnswers, {
				detectClients: () => [
					{
						type: 'claude-code' as McpClientType,
						config: clientNoCli,
						detected: true,
					},
				],
				hasConfig: () => false,
			});

			await runSetup(deps, { manual: true });

			const output = logs.join('\n');
			expect(output).toContain('Claude Code — written to');
		});

		it('prompts when entry already exists and skips on decline', async () => {
			mockSuccessfulValidation();
			const writeConfig = vi.fn().mockResolvedValue(true);

			// 'n' is the prompt answer for the overwrite confirmation
			const { deps, logs } = createTestDeps([...manualAnswers, 'n'], {
				detectClients: () => defaultClientList(),

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

				writeConfig,
				hasConfig: () => true,
			});

			await runSetup(deps, { manual: true });

			expect(writeConfig).toHaveBeenCalledTimes(1);
		});

		it('logs when writeConfig returns false', async () => {
			mockSuccessfulValidation();
			const writeConfig = vi.fn().mockResolvedValue(false);

			const { deps, logs } = createTestDeps(manualAnswers, {
				detectClients: () => defaultClientList(),

				writeConfig,
				hasConfig: () => false,
			});

			await runSetup(deps, { manual: true });

			const output = logs.join('\n');
			expect(output).toContain(
				'Claude Code — configuration returned false'
			);
		});

		it('uses client.useCli when no writeConfig override is provided', async () => {
			mockSuccessfulValidation();
			const useCli = vi.fn().mockResolvedValue(true);
			const clientWithCli = makeMockClient('claude-code', 'Claude Code', {
				useCli,
			});

			const { deps, logs } = createTestDeps(manualAnswers, {
				detectClients: () => [
					{
						type: 'claude-code' as McpClientType,
						config: clientWithCli,
						detected: true,
					},
				],

				hasConfig: () => false,
			});

			await runSetup(deps, { manual: true });

			expect(useCli).toHaveBeenCalledTimes(1);
			const output = logs.join('\n');
			expect(output).toContain('Claude Code — configured via CLI');
		});

		it('falls back to addServerToConfig when useCli returns false', async () => {
			mockSuccessfulValidation();
			const useCli = vi.fn().mockResolvedValue(false);
			const clientWithFailingCli = makeMockClient(
				'claude-code',
				'Claude Code',
				{
					useCli,
					configPath: () =>
						join(testTmpDir, 'setup-fallback', 'config.json'),
				}
			);

			const { deps, logs } = createTestDeps(manualAnswers, {
				detectClients: () => [
					{
						type: 'claude-code' as McpClientType,
						config: clientWithFailingCli,
						detected: true,
					},
				],

				hasConfig: () => false,
			});

			await runSetup(deps, { manual: true });

			const output = logs.join('\n');
			// Should show the config file path (written via addServerToConfig)
			expect(output).toContain('Claude Code — written to');
		});

		it('logs failure when configuration throws', async () => {
			mockSuccessfulValidation();
			const writeConfig = vi
				.fn()
				.mockRejectedValue(new Error('Permission denied'));

			const { deps, logs } = createTestDeps(manualAnswers, {
				detectClients: () => defaultClientList(),

				writeConfig,
				hasConfig: () => false,
			});

			await runSetup(deps, { manual: true });

			const output = logs.join('\n');
			expect(output).toContain('Claude Code — failed: Permission denied');
		});
	});

	// -----------------------------------------------------------------------
	// Remove flow
	// -----------------------------------------------------------------------

	describe('remove flow', () => {
		it('removes Claude Code when configured', async () => {
			const removeConfig = vi.fn().mockResolvedValue(true);

			const { deps, logs } = createTestDeps([], {
				detectClients: () => defaultClientList(),
				hasConfig: () => true,
				removeConfig,
			});

			await runSetup(deps, { remove: true });

			expect(removeConfig).toHaveBeenCalledTimes(1);
			const output = logs.join('\n');
			expect(output).toContain('Claude Code — removed via CLI');
			expect(output).toContain(
				'Done! Restart Claude Code to complete removal.'
			);
		});

		it('shows message when not configured', async () => {
			const { deps, logs } = createTestDeps([], {
				detectClients: () => defaultClientList(),
				hasConfig: () => false,
			});

			await runSetup(deps, { remove: true });

			const output = logs.join('\n');
			expect(output).toContain(
				'claudaborative-editing is not configured in Claude Code.'
			);
		});

		it('uses client.removeCli when no removeConfig override is provided', async () => {
			const removeCli = vi.fn().mockResolvedValue(true);
			const clientWithRemove = makeMockClient(
				'claude-code',
				'Claude Code',
				{ removeCli }
			);

			const { deps, logs } = createTestDeps([], {
				detectClients: () => [
					{
						type: 'claude-code' as McpClientType,
						config: clientWithRemove,
						detected: true,
					},
				],
				hasConfig: () => true,
			});

			await runSetup(deps, { remove: true });

			expect(removeCli).toHaveBeenCalledTimes(1);
			const output = logs.join('\n');
			expect(output).toContain('Claude Code — removed via CLI');
		});

		it('falls back to removeServerFromConfig when removeCli returns false', async () => {
			const removeCli = vi.fn().mockResolvedValue(false);
			const clientWithFailingRemove = makeMockClient(
				'claude-code',
				'Claude Code',
				{
					removeCli,
					configPath: () =>
						join(testTmpDir, 'remove-fallback', 'config.json'),
				}
			);

			const { deps, logs } = createTestDeps([], {
				detectClients: () => [
					{
						type: 'claude-code' as McpClientType,
						config: clientWithFailingRemove,
						detected: true,
					},
				],
				hasConfig: () => true,
			});

			await runSetup(deps, { remove: true });

			const output = logs.join('\n');
			// Entry doesn't exist on disk, so it reports "entry not found"
			expect(output).toContain('Claude Code — entry not found');
		});

		it('removeConfig returning false logs accordingly', async () => {
			const removeConfig = vi.fn().mockResolvedValue(false);

			const { deps, logs } = createTestDeps([], {
				detectClients: () => defaultClientList(),
				hasConfig: () => true,
				removeConfig,
			});

			await runSetup(deps, { remove: true });

			const output = logs.join('\n');
			expect(output).toContain('Claude Code — removal returned false');
		});

		it('logs failure when removal throws', async () => {
			const removeConfig = vi
				.fn()
				.mockRejectedValue(new Error('Permission denied'));

			const { deps, logs } = createTestDeps([], {
				detectClients: () => defaultClientList(),
				hasConfig: () => true,
				removeConfig,
			});

			await runSetup(deps, { remove: true });

			const output = logs.join('\n');
			expect(output).toContain('Claude Code — failed: Permission denied');
		});
	});
});
