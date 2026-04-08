import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assertDefined } from '../../test-utils.js';

vi.mock('child_process', () => ({
	execSync: vi.fn(),
	execFileSync: vi.fn(),
}));

vi.mock('fs', () => ({
	existsSync: vi.fn(),
	readFileSync: vi.fn(),
	writeFileSync: vi.fn(),
	mkdirSync: vi.fn(),
	renameSync: vi.fn(),
	unlinkSync: vi.fn(),
}));

vi.mock('os', () => ({
	homedir: vi.fn(() => '/mock/home'),
	platform: vi.fn(() => 'darwin'),
}));

const { execSync, execFileSync } = await import('child_process');
const { existsSync, readFileSync, writeFileSync } = await import('fs');
const { homedir, platform } = await import('os');

const { MCP_CLIENTS, detectInstalledClients, SERVER_NAME, isOnPath } =
	await import('../../../src/cli/clients.js');

const execSyncMock = vi.mocked(execSync);
const execFileSyncMock = vi.mocked(execFileSync);
const existsSyncMock = vi.mocked(existsSync);
const readFileSyncMock = vi.mocked(readFileSync);
const writeFileSyncMock = vi.mocked(writeFileSync);
const homedirMock = vi.mocked(homedir);
const platformMock = vi.mocked(platform);

describe('clients registry', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		homedirMock.mockReturnValue('/mock/home');
		platformMock.mockReturnValue('darwin');
		// Default: settings file doesn't exist (readJsonConfig returns {})
		readFileSyncMock.mockImplementation(() => {
			const err = new Error('ENOENT') as NodeJS.ErrnoException;
			err.code = 'ENOENT';
			throw err;
		});
	});

	describe('SERVER_NAME', () => {
		it('is "wpce"', () => {
			expect(SERVER_NAME).toBe('wpce');
		});
	});

	describe('MCP_CLIENTS', () => {
		it('contains only claude-code', () => {
			const types = Object.keys(MCP_CLIENTS);
			expect(types).toEqual(['claude-code']);
		});

		it('each client has the required properties', () => {
			for (const [key, config] of Object.entries(MCP_CLIENTS)) {
				expect(config.name).toBe(key);
				expect(config.displayName).toBeTruthy();
				expect(typeof config.configPath).toBe('function');
				expect(typeof config.configKey).toBe('string');
				expect(typeof config.detectInstall).toBe('function');
			}
		});
	});

	describe('configPath', () => {
		it('claude-code returns ~/.claude.json', () => {
			const path = MCP_CLIENTS['claude-code'].configPath();
			expect(path).toBe('/mock/home/.claude.json');
		});
	});

	describe('configKey', () => {
		it('claude-code uses "mcpServers"', () => {
			expect(MCP_CLIENTS['claude-code'].configKey).toBe('mcpServers');
		});
	});

	describe('detectInstall', () => {
		it('claude-code requires both directory existence and claude on PATH', () => {
			existsSyncMock.mockReturnValue(true);
			execSyncMock.mockReturnValue(Buffer.from('/usr/local/bin/claude'));

			expect(MCP_CLIENTS['claude-code'].detectInstall()).toBe(true);
		});

		it('claude-code returns false when claude is not on PATH', () => {
			existsSyncMock.mockReturnValue(true);
			execSyncMock.mockImplementation(() => {
				throw new Error('not found');
			});

			expect(MCP_CLIENTS['claude-code'].detectInstall()).toBe(false);
		});
	});

	describe('claude-code useCli', () => {
		const credentials = {
			siteUrl: 'https://example.com',
			username: 'admin',
			appPassword: 'xxxx xxxx xxxx',
		};

		it('runs claude mcp add with correct arguments via execFileSync', async () => {
			execSyncMock.mockReturnValue(Buffer.from('/usr/local/bin/claude'));
			execFileSyncMock.mockReturnValue(Buffer.from(''));

			const useCli = MCP_CLIENTS['claude-code'].useCli;
			assertDefined(useCli);
			const result = await useCli(credentials);

			expect(result).toBe(true);
			// isOnPath uses execSync with `which claude`
			expect(execSyncMock).toHaveBeenCalledWith(
				expect.stringContaining('which claude'),
				expect.anything()
			);
			// The actual command uses execFileSync with an args array (no shell injection)
			expect(execFileSyncMock).toHaveBeenCalledWith(
				'claude',
				[
					'mcp',
					'add',
					'--scope',
					'user',
					'-e',
					'WP_SITE_URL=https://example.com',
					'-e',
					'WP_USERNAME=admin',
					'-e',
					'WP_APP_PASSWORD=xxxx xxxx xxxx',
					'wpce',
					'--',
					'npx',
					'claudaborative-editing',
				],
				{ stdio: 'ignore' }
			);
		});

		it('returns false when claude is not on PATH', async () => {
			execSyncMock.mockImplementation(() => {
				throw new Error('not found');
			});

			const useCli = MCP_CLIENTS['claude-code'].useCli;
			assertDefined(useCli);
			const result = await useCli(credentials);

			expect(result).toBe(false);
		});

		it('returns false when claude mcp add fails', async () => {
			// isOnPath (execSync) succeeds
			execSyncMock.mockReturnValue(Buffer.from('/usr/local/bin/claude'));
			// The actual add command (execFileSync) fails
			execFileSyncMock.mockImplementation(() => {
				throw new Error('command failed');
			});

			const useCli = MCP_CLIENTS['claude-code'].useCli;
			assertDefined(useCli);
			const result = await useCli(credentials);

			expect(result).toBe(false);
		});
	});

	describe('claude-code removeCli', () => {
		it('runs claude mcp remove with the server name', async () => {
			execFileSyncMock.mockReturnValue(Buffer.from(''));

			const removeCli = MCP_CLIENTS['claude-code'].removeCli;
			assertDefined(removeCli);
			const result = await removeCli();

			expect(result).toBe(true);
			expect(execFileSyncMock).toHaveBeenCalledWith(
				'claude',
				['mcp', 'remove', '--scope', 'user', SERVER_NAME],
				{ stdio: 'ignore' }
			);
		});

		it('removes tool permission from settings.json when present', async () => {
			execFileSyncMock.mockReturnValue(Buffer.from(''));
			const permission = `mcp__${SERVER_NAME}__*`;
			readFileSyncMock.mockReturnValue(
				JSON.stringify({
					permissions: { allow: [permission, 'other-perm'] },
				})
			);

			const removeCli = MCP_CLIENTS['claude-code'].removeCli;
			assertDefined(removeCli);
			await removeCli();

			expect(writeFileSyncMock).toHaveBeenCalled();
			const writtenJson = JSON.parse(
				writeFileSyncMock.mock.calls[0][1] as string
			) as { permissions: { allow: string[] } };
			expect(writtenJson.permissions.allow).not.toContain(permission);
			expect(writtenJson.permissions.allow).toContain('other-perm');
		});

		it('returns false when removal fails', async () => {
			execFileSyncMock.mockImplementation(() => {
				throw new Error('command failed');
			});

			const removeCli = MCP_CLIENTS['claude-code'].removeCli;
			assertDefined(removeCli);
			const result = await removeCli();

			expect(result).toBe(false);
		});
	});

	describe('detectInstalledClients', () => {
		it('returns an entry for claude-code', () => {
			existsSyncMock.mockReturnValue(false);
			execSyncMock.mockImplementation(() => {
				throw new Error('not found');
			});

			const clients = detectInstalledClients();

			expect(clients).toHaveLength(1);
			expect(clients[0].type).toBe('claude-code');
		});

		it('marks detected clients correctly', () => {
			existsSyncMock.mockReturnValue(true);
			execSyncMock.mockReturnValue(Buffer.from('/usr/local/bin/claude'));

			const clients = detectInstalledClients();
			expect(clients[0].detected).toBe(true);
		});

		it('marks undetected clients correctly', () => {
			existsSyncMock.mockReturnValue(false);
			execSyncMock.mockImplementation(() => {
				throw new Error('not found');
			});

			const clients = detectInstalledClients();

			for (const client of clients) {
				expect(client.detected).toBe(false);
			}
		});

		it('includes the config object for each client', () => {
			existsSyncMock.mockReturnValue(false);
			execSyncMock.mockImplementation(() => {
				throw new Error('not found');
			});

			const clients = detectInstalledClients();

			for (const client of clients) {
				expect(client.config).toBe(MCP_CLIENTS[client.type]);
			}
		});
	});

	describe('isOnPath', () => {
		it('returns true when executable is found', () => {
			execSyncMock.mockReturnValue(Buffer.from('/usr/local/bin/claude'));
			expect(isOnPath('claude')).toBe(true);
		});

		it('returns false when executable is not found', () => {
			execSyncMock.mockImplementation(() => {
				throw new Error('not found');
			});
			expect(isOnPath('claude')).toBe(false);
		});

		it('uses "where" on Windows and "which" on other platforms', () => {
			platformMock.mockReturnValue('win32');
			execSyncMock.mockReturnValue(Buffer.from(''));
			isOnPath('claude');
			expect(execSyncMock).toHaveBeenCalledWith(
				'where claude',
				expect.anything()
			);

			execSyncMock.mockClear();
			platformMock.mockReturnValue('darwin');
			execSyncMock.mockReturnValue(Buffer.from(''));
			isOnPath('claude');
			expect(execSyncMock).toHaveBeenCalledWith(
				'which claude',
				expect.anything()
			);
		});
	});
});
