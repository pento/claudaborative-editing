import { describe, it, expect, vi, beforeEach } from 'vitest';
import { assertDefined } from '../../test-utils.js';

vi.mock('child_process', () => ({
	execSync: vi.fn(),
	execFileSync: vi.fn(),
}));

vi.mock('fs', () => ({
	existsSync: vi.fn(),
}));

vi.mock('os', () => ({
	homedir: vi.fn(() => '/mock/home'),
	platform: vi.fn(() => 'darwin'),
}));

const { execSync, execFileSync } = await import('child_process');
const { existsSync } = await import('fs');
const { homedir, platform } = await import('os');

const { MCP_CLIENTS, detectInstalledClients, SERVER_NAME } =
	await import('../../../src/cli/clients.js');

const execSyncMock = vi.mocked(execSync);
const execFileSyncMock = vi.mocked(execFileSync);
const existsSyncMock = vi.mocked(existsSync);
const homedirMock = vi.mocked(homedir);
const platformMock = vi.mocked(platform);

describe('clients registry', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		homedirMock.mockReturnValue('/mock/home');
		platformMock.mockReturnValue('darwin');
	});

	describe('SERVER_NAME', () => {
		it('is "wpce"', () => {
			expect(SERVER_NAME).toBe('wpce');
		});
	});

	describe('MCP_CLIENTS', () => {
		it('contains all expected client types', () => {
			const types = Object.keys(MCP_CLIENTS);
			expect(types).toEqual([
				'claude-code',
				'claude-desktop',
				'vscode',
				'vscode-insiders',
				'cursor',
				'windsurf',
			]);
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

		it('claude-desktop returns the Application Support path on macOS', () => {
			const path = MCP_CLIENTS['claude-desktop'].configPath();
			expect(path).toContain('Library/Application Support/Claude');
			expect(path).toContain('claude_desktop_config.json');
		});

		it('vscode returns the Code User path on macOS', () => {
			const path = MCP_CLIENTS.vscode.configPath();
			expect(path).toContain('Library/Application Support/Code/User');
			expect(path).toContain('mcp.json');
		});

		it('vscode-insiders returns the Code - Insiders User path on macOS', () => {
			const path = MCP_CLIENTS['vscode-insiders'].configPath();
			expect(path).toContain('Code - Insiders/User');
			expect(path).toContain('mcp.json');
		});

		it('cursor returns ~/.cursor/mcp.json', () => {
			const path = MCP_CLIENTS.cursor.configPath();
			expect(path).toBe('/mock/home/.cursor/mcp.json');
		});

		it('windsurf returns ~/.codeium/windsurf/mcp_config.json', () => {
			const path = MCP_CLIENTS.windsurf.configPath();
			expect(path).toBe('/mock/home/.codeium/windsurf/mcp_config.json');
		});

		it('uses .config on Linux for app-data-based clients', () => {
			platformMock.mockReturnValue('linux');
			const path = MCP_CLIENTS['claude-desktop'].configPath();
			expect(path).toContain('.config/Claude');
		});

		it('uses APPDATA on Windows for app-data-based clients', () => {
			platformMock.mockReturnValue('win32');
			const originalAppdata = process.env.APPDATA;
			process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';
			try {
				const path = MCP_CLIENTS['claude-desktop'].configPath();
				expect(path).toContain('AppData');
				expect(path).toContain('Claude');
			} finally {
				if (originalAppdata === undefined) {
					delete process.env.APPDATA;
				} else {
					process.env.APPDATA = originalAppdata;
				}
			}
		});
	});

	describe('configKey', () => {
		it('vscode and vscode-insiders use "servers"', () => {
			expect(MCP_CLIENTS.vscode.configKey).toBe('servers');
			expect(MCP_CLIENTS['vscode-insiders'].configKey).toBe('servers');
		});

		it('all other clients use "mcpServers"', () => {
			expect(MCP_CLIENTS['claude-code'].configKey).toBe('mcpServers');
			expect(MCP_CLIENTS['claude-desktop'].configKey).toBe('mcpServers');
			expect(MCP_CLIENTS.cursor.configKey).toBe('mcpServers');
			expect(MCP_CLIENTS.windsurf.configKey).toBe('mcpServers');
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

		it('directory-based clients detect via existsSync on parent directory', () => {
			existsSyncMock.mockReturnValue(true);

			expect(MCP_CLIENTS['claude-desktop'].detectInstall()).toBe(true);
			expect(MCP_CLIENTS.cursor.detectInstall()).toBe(true);
			expect(MCP_CLIENTS.windsurf.detectInstall()).toBe(true);
		});

		it('returns false when parent directory does not exist', () => {
			existsSyncMock.mockReturnValue(false);
			execSyncMock.mockImplementation(() => {
				throw new Error('not found');
			});

			expect(MCP_CLIENTS['claude-desktop'].detectInstall()).toBe(false);
			expect(MCP_CLIENTS.cursor.detectInstall()).toBe(false);
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
		it('returns an entry for each client type', () => {
			existsSyncMock.mockReturnValue(false);
			execSyncMock.mockImplementation(() => {
				throw new Error('not found');
			});

			const clients = detectInstalledClients();

			expect(clients).toHaveLength(6);
			const types = clients.map((c) => c.type);
			expect(types).toContain('claude-code');
			expect(types).toContain('claude-desktop');
			expect(types).toContain('vscode');
			expect(types).toContain('vscode-insiders');
			expect(types).toContain('cursor');
			expect(types).toContain('windsurf');
		});

		it('marks detected clients correctly', () => {
			existsSyncMock.mockReturnValue(true);
			execSyncMock.mockReturnValue(Buffer.from('/usr/local/bin/claude'));

			const clients = detectInstalledClients();
			const claudeCode = clients.find((c) => c.type === 'claude-code');
			assertDefined(claudeCode);
			expect(claudeCode.detected).toBe(true);
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
});
