/**
 * Config file reader/writer for MCP client JSON configuration.
 *
 * Handles reading, writing, and merging MCP server entries into
 * JSON config files used by various MCP clients (Claude Desktop,
 * VS Code, Cursor, etc.).
 */

import { readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, existsSync } from 'fs';
import { dirname } from 'path';
import type { WpCredentials } from './types.js';

/**
 * Read and parse a JSON config file.
 * Returns `{}` if the file doesn't exist (ENOENT).
 * Re-throws all other errors.
 */
export function readJsonConfig(filePath: string): Record<string, unknown> {
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Record<string, unknown>;
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {};
    }
    throw err;
  }
}

/**
 * Detect the indentation used in a JSON string.
 * Looks at the first indented line to determine tab vs spaces and count.
 * Defaults to 2 spaces if unable to detect.
 */
export function detectIndent(content: string): string {
  const lines = content.split('\n');
  for (const line of lines) {
    // Find the first line that starts with whitespace (indented)
    const match = /^(\s+)\S/.exec(line);
    if (match) {
      const whitespace = match[1];
      if (whitespace.includes('\t')) {
        return '\t';
      }
      return whitespace;
    }
  }
  return '  ';
}

/**
 * Atomically write a JSON config file.
 *
 * Writes to a temp file first, then renames to the final path.
 * Creates parent directories if needed.
 * If `indent` is not provided, tries to detect from existing file content,
 * falling back to 2 spaces.
 */
export function writeJsonConfig(
  filePath: string,
  config: Record<string, unknown>,
  indent?: string,
): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let resolvedIndent = indent;
  if (resolvedIndent === undefined) {
    try {
      const existing = readFileSync(filePath, 'utf-8');
      resolvedIndent = detectIndent(existing);
    } catch {
      resolvedIndent = '  ';
    }
  }

  const json = JSON.stringify(config, null, resolvedIndent) + '\n';
  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, json, 'utf-8');
  try {
    renameSync(tmpPath, filePath);
  } catch (err: unknown) {
    // On Windows, renameSync fails when destination exists. Fall back to unlink + rename.
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'EPERM') {
      unlinkSync(filePath);
      renameSync(tmpPath, filePath);
    } else {
      throw err;
    }
  }
}

/**
 * Add an MCP server entry to a config file.
 *
 * Reads the existing config (or starts with `{}`), ensures the
 * `configKey` object exists, sets `serverName` within it, and
 * writes back preserving existing indentation.
 */
export function addServerToConfig(
  configPath: string,
  configKey: string,
  serverName: string,
  serverEntry: Record<string, unknown>,
): void {
  const config = readJsonConfig(configPath);

  if (
    typeof config[configKey] !== 'object' ||
    config[configKey] === null ||
    Array.isArray(config[configKey])
  ) {
    config[configKey] = {};
  }

  const servers = config[configKey] as Record<string, unknown>;
  servers[serverName] = serverEntry;

  writeJsonConfig(configPath, config);
}

/**
 * Remove an MCP server entry from a config file.
 *
 * Returns true if the entry was found and removed, false otherwise.
 */
export function removeServerFromConfig(
  configPath: string,
  configKey: string,
  serverName: string,
): boolean {
  const config = readJsonConfig(configPath);

  const servers = config[configKey];
  if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) {
    return false;
  }

  const serversObj = servers as Record<string, unknown>;
  if (!(serverName in serversObj)) {
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete serversObj[serverName];
  writeJsonConfig(configPath, config);
  return true;
}

/**
 * Check if an MCP server entry exists in a config file.
 */
export function hasServerInConfig(
  configPath: string,
  configKey: string,
  serverName: string,
): boolean {
  const config = readJsonConfig(configPath);

  const servers = config[configKey];
  if (typeof servers !== 'object' || servers === null || Array.isArray(servers)) {
    return false;
  }

  return serverName in (servers as Record<string, unknown>);
}

/**
 * Build the standard MCP server config entry from WordPress credentials.
 */
export function buildServerEntry(credentials: WpCredentials): Record<string, unknown> {
  return {
    command: 'npx',
    args: ['claudaborative-editing'],
    env: {
      WP_SITE_URL: credentials.siteUrl,
      WP_USERNAME: credentials.username,
      WP_APP_PASSWORD: credentials.appPassword,
    },
  };
}
