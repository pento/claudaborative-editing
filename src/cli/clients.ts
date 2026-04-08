/**
 * MCP client registry — defines supported MCP clients and their configuration paths,
 * detection logic, and optional CLI integration.
 */

import { execFileSync, execSync } from 'child_process';
import { existsSync } from 'fs';
import { homedir, platform } from 'os';
import { dirname, join } from 'path';

import { readJsonConfig, writeJsonConfig } from './config-writer.js';
import type { McpClientConfig, McpClientType, WpCredentials } from './types.js';

/** The server name used in MCP config files and CLI commands. */
export const SERVER_NAME = 'wpce';

/**
 * Returns the command to check if an executable exists on PATH,
 * appropriate for the current platform.
 */
function whichCommand(executable: string): string {
	return platform() === 'win32'
		? `where ${executable}`
		: `which ${executable}`;
}

/** Returns true if the given executable is found on PATH. */
export function isOnPath(executable: string): boolean {
	try {
		execSync(whichCommand(executable), { stdio: 'ignore' });
		return true;
	} catch {
		return false;
	}
}

/** The tool permission pattern that auto-allows all wpce MCP tools. */
const TOOL_PERMISSION = `mcp__${SERVER_NAME}__*`;

/**
 * Add `mcp__wpce__*` to Claude Code's `permissions.allow` in `~/.claude/settings.json`.
 * This lets channel-triggered tool calls execute without prompting.
 */
function addClaudeCodeToolPermission(): void {
	const settingsPath = join(homedir(), '.claude', 'settings.json');
	const config = readJsonConfig(settingsPath);

	if (
		typeof config.permissions !== 'object' ||
		config.permissions === null ||
		Array.isArray(config.permissions)
	) {
		config.permissions = {};
	}
	const perms = config.permissions as Record<string, unknown>;

	if (!Array.isArray(perms.allow)) {
		perms.allow = [];
	}
	const allow = perms.allow as string[];

	if (!allow.includes(TOOL_PERMISSION)) {
		allow.push(TOOL_PERMISSION);
		writeJsonConfig(settingsPath, config);
	}
}

/**
 * Remove `mcp__wpce__*` from Claude Code's `permissions.allow` in `~/.claude/settings.json`.
 */
function removeClaudeCodeToolPermission(): void {
	const settingsPath = join(homedir(), '.claude', 'settings.json');
	const config = readJsonConfig(settingsPath);

	const perms = config.permissions as Record<string, unknown> | undefined;
	if (!perms || !Array.isArray(perms.allow)) {
		return;
	}
	const allow = perms.allow as string[];
	const idx = allow.indexOf(TOOL_PERMISSION);
	if (idx !== -1) {
		allow.splice(idx, 1);
		writeJsonConfig(settingsPath, config);
	}
}

/** Claude Code CLI integration: register the MCP server via `claude mcp add`. */
function claudeCodeUseCli(credentials: WpCredentials): boolean {
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
			{ stdio: 'ignore' }
		);
		addClaudeCodeToolPermission();
		return true;
	} catch {
		return false;
	}
}

/** Claude Code CLI integration: remove the MCP server via `claude mcp remove`. */
function claudeCodeRemoveCli(): boolean {
	try {
		execFileSync(
			'claude',
			['mcp', 'remove', '--scope', 'user', SERVER_NAME],
			{ stdio: 'ignore' }
		);
		removeClaudeCodeToolPermission();
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
};

/** Detect which MCP clients are installed on this system. */
export function detectInstalledClients(): Array<{
	type: McpClientType;
	config: McpClientConfig;
	detected: boolean;
}> {
	return (
		Object.entries(MCP_CLIENTS) as Array<[McpClientType, McpClientConfig]>
	).map(([type, config]) => ({
		type,
		config,
		detected: config.detectInstall(),
	}));
}
