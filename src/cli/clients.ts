/**
 * MCP client registry — defines supported MCP clients and their configuration paths,
 * detection logic, and optional CLI integration.
 */

import { execFileSync, execSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir, platform } from 'os';
import { dirname, join } from 'path';

import type { McpClientConfig, McpClientType, WpCredentials } from './types.js';

/** The server name used in MCP config files and CLI commands. */
export const SERVER_NAME = 'wpce';

/**
 * Returns the command to check if an executable exists on PATH,
 * appropriate for the current platform.
 */
function whichCommand(executable: string): string {
  return platform() === 'win32' ? `where ${executable}` : `which ${executable}`;
}

/** Returns true if the given executable is found on PATH. */
function isOnPath(executable: string): boolean {
  try {
    execSync(whichCommand(executable), { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the appropriate application data directory base path for the current platform.
 * macOS: ~/Library/Application Support
 * Windows: %APPDATA%
 * Linux: ~/.config
 */
function appDataDir(): string {
  const p = platform();
  const home = homedir();

  if (p === 'darwin') {
    return join(home, 'Library', 'Application Support');
  }
  if (p === 'win32') {
    return process.env.APPDATA ?? join(home, 'AppData', 'Roaming');
  }
  return join(home, '.config');
}

/** Claude Code CLI integration: register the MCP server via `claude mcp add`. */
async function claudeCodeUseCli(credentials: WpCredentials): Promise<boolean> {
  if (!isOnPath('claude')) {
    return false;
  }
  try {
    // Use execFileSync with an args array to avoid shell injection.
    // Credential values may contain spaces, quotes, dollar signs, etc.
    execFileSync(
      'claude',
      [
        'mcp',
        'add',
        '--scope',
        'user',
        '-e',
        `WP_SITE_URL=${credentials.siteUrl}`,
        '-e',
        `WP_USERNAME=${credentials.username}`,
        '-e',
        `WP_APP_PASSWORD=${credentials.appPassword}`,
        SERVER_NAME,
        '--',
        'npx',
        'claudaborative-editing',
      ],
      { stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  }
}

/** Claude Code CLI integration: remove the MCP server via `claude mcp remove`. */
async function claudeCodeRemoveCli(): Promise<boolean> {
  try {
    execFileSync('claude', ['mcp', 'remove', '--scope', 'user', SERVER_NAME], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Registry of all supported MCP clients. */
export const MCP_CLIENTS: Record<McpClientType, McpClientConfig> = {
  'claude-code': {
    name: 'claude-code',
    displayName: 'Claude Code',
    configPath: () => join(homedir(), '.claude.json'),
    configKey: 'mcpServers',
    detectInstall: () => {
      const configDir = dirname(join(homedir(), '.claude.json'));
      return existsSync(configDir) && isOnPath('claude');
    },
    useCli: claudeCodeUseCli,
    removeCli: claudeCodeRemoveCli,
  },

  'claude-desktop': {
    name: 'claude-desktop',
    displayName: 'Claude Desktop',
    configPath: () => join(appDataDir(), 'Claude', 'claude_desktop_config.json'),
    configKey: 'mcpServers',
    detectInstall: () =>
      existsSync(dirname(join(appDataDir(), 'Claude', 'claude_desktop_config.json'))),
  },

  vscode: {
    name: 'vscode',
    displayName: 'VS Code',
    configPath: () => join(appDataDir(), 'Code', 'User', 'mcp.json'),
    configKey: 'servers',
    detectInstall: () => existsSync(dirname(join(appDataDir(), 'Code', 'User', 'mcp.json'))),
  },

  'vscode-insiders': {
    name: 'vscode-insiders',
    displayName: 'VS Code Insiders',
    configPath: () => join(appDataDir(), 'Code - Insiders', 'User', 'mcp.json'),
    configKey: 'servers',
    detectInstall: () =>
      existsSync(dirname(join(appDataDir(), 'Code - Insiders', 'User', 'mcp.json'))),
  },

  cursor: {
    name: 'cursor',
    displayName: 'Cursor',
    configPath: () => join(homedir(), '.cursor', 'mcp.json'),
    configKey: 'mcpServers',
    detectInstall: () => existsSync(dirname(join(homedir(), '.cursor', 'mcp.json'))),
  },

  windsurf: {
    name: 'windsurf',
    displayName: 'Windsurf',
    configPath: () => join(homedir(), '.codeium', 'windsurf', 'mcp_config.json'),
    configKey: 'mcpServers',
    detectInstall: () =>
      existsSync(dirname(join(homedir(), '.codeium', 'windsurf', 'mcp_config.json'))),
  },
};

/** Detect which MCP clients are installed on this system. */
export function detectInstalledClients(): Array<{
  type: McpClientType;
  config: McpClientConfig;
  detected: boolean;
}> {
  return (Object.entries(MCP_CLIENTS) as Array<[McpClientType, McpClientConfig]>).map(
    ([type, config]) => ({
      type,
      config,
      detected: config.detectInstall(),
    }),
  );
}
