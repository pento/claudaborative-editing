import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import {
  readJsonConfig,
  detectIndent,
  writeJsonConfig,
  addServerToConfig,
  removeServerFromConfig,
  hasServerInConfig,
  buildServerEntry,
} from '../../../src/cli/config-writer.js';

interface McpConfig {
  otherKey?: string;
  mcpServers?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

let tempDir: string;

function freshDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), 'config-writer-'));
  return tempDir;
}

afterEach(() => {
  if (tempDir && existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

describe('readJsonConfig', () => {
  it('reads and parses a valid JSON file', () => {
    const dir = freshDir();
    const filePath = join(dir, 'config.json');
    writeFileSync(filePath, JSON.stringify({ mcpServers: { foo: { command: 'bar' } } }));

    const result = readJsonConfig(filePath);
    expect(result).toEqual({ mcpServers: { foo: { command: 'bar' } } });
  });

  it('returns empty object for missing file (ENOENT)', () => {
    const dir = freshDir();
    const filePath = join(dir, 'nonexistent.json');

    const result = readJsonConfig(filePath);
    expect(result).toEqual({});
  });

  it('re-throws non-ENOENT errors', () => {
    const dir = freshDir();
    // A directory path is not a valid JSON file — reading it throws EISDIR, not ENOENT
    expect(() => readJsonConfig(dir)).toThrow();
  });

  it('re-throws JSON parse errors', () => {
    const dir = freshDir();
    const filePath = join(dir, 'bad.json');
    writeFileSync(filePath, '{ not valid json }');

    expect(() => readJsonConfig(filePath)).toThrow();
  });
});

describe('detectIndent', () => {
  it('detects 2-space indentation', () => {
    const content = '{\n  "key": "value"\n}';
    expect(detectIndent(content)).toBe('  ');
  });

  it('detects 4-space indentation', () => {
    const content = '{\n    "key": "value"\n}';
    expect(detectIndent(content)).toBe('    ');
  });

  it('detects tab indentation', () => {
    const content = '{\n\t"key": "value"\n}';
    expect(detectIndent(content)).toBe('\t');
  });

  it('defaults to 2 spaces when unable to detect', () => {
    expect(detectIndent('{}')).toBe('  ');
    expect(detectIndent('')).toBe('  ');
  });

  it('defaults to 2 spaces for single-line content', () => {
    expect(detectIndent('{"key": "value"}')).toBe('  ');
  });
});

describe('writeJsonConfig', () => {
  it('writes valid JSON with specified indentation', () => {
    const dir = freshDir();
    const filePath = join(dir, 'out.json');

    writeJsonConfig(filePath, { key: 'value' }, '    ');

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toBe('{\n    "key": "value"\n}\n');
  });

  it('ends file with a newline', () => {
    const dir = freshDir();
    const filePath = join(dir, 'out.json');

    writeJsonConfig(filePath, {}, '  ');

    const content = readFileSync(filePath, 'utf-8');
    expect(content.endsWith('\n')).toBe(true);
  });

  it('creates parent directories if needed', () => {
    const dir = freshDir();
    const filePath = join(dir, 'deeply', 'nested', 'dir', 'config.json');

    writeJsonConfig(filePath, { hello: 'world' }, '  ');

    expect(existsSync(filePath)).toBe(true);
    const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as McpConfig;
    expect(parsed).toEqual({ hello: 'world' });
  });

  it('performs atomic write (temp file then rename)', () => {
    const dir = freshDir();
    const filePath = join(dir, 'atomic.json');

    writeJsonConfig(filePath, { atomic: true }, '  ');

    // After successful write, the .tmp file should not remain
    expect(existsSync(`${filePath}.tmp`)).toBe(false);
    expect(existsSync(filePath)).toBe(true);
  });

  it('detects indentation from existing file when indent not provided', () => {
    const dir = freshDir();
    const filePath = join(dir, 'existing.json');

    // Create an existing file with 4-space indent
    writeFileSync(filePath, '{\n    "old": true\n}\n');

    // Overwrite without specifying indent — should preserve 4-space
    writeJsonConfig(filePath, { new: true });

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toBe('{\n    "new": true\n}\n');
  });

  it('defaults to 2-space indent when no existing file and indent not provided', () => {
    const dir = freshDir();
    const filePath = join(dir, 'fresh.json');

    writeJsonConfig(filePath, { fresh: true });

    const content = readFileSync(filePath, 'utf-8');
    expect(content).toBe('{\n  "fresh": true\n}\n');
  });
});

describe('addServerToConfig', () => {
  it('adds a server entry to an empty config', () => {
    const dir = freshDir();
    const filePath = join(dir, 'config.json');

    addServerToConfig(filePath, 'mcpServers', 'wpce', { command: 'npx', args: ['test'] });

    const config = JSON.parse(readFileSync(filePath, 'utf-8')) as McpConfig;
    expect(config.mcpServers?.wpce).toEqual({ command: 'npx', args: ['test'] });
  });

  it('preserves existing servers when adding a new one', () => {
    const dir = freshDir();
    const filePath = join(dir, 'config.json');
    writeFileSync(
      filePath,
      JSON.stringify({ mcpServers: { existing: { command: 'other' } } }, null, 2) + '\n',
    );

    addServerToConfig(filePath, 'mcpServers', 'wpce', { command: 'npx' });

    const config = JSON.parse(readFileSync(filePath, 'utf-8')) as McpConfig;
    expect(config.mcpServers?.existing).toEqual({ command: 'other' });
    expect(config.mcpServers?.wpce).toEqual({ command: 'npx' });
  });

  it('creates the configKey object if missing', () => {
    const dir = freshDir();
    const filePath = join(dir, 'config.json');
    writeFileSync(filePath, JSON.stringify({ otherKey: 'value' }, null, 2) + '\n');

    addServerToConfig(filePath, 'mcpServers', 'wpce', { command: 'npx' });

    const config = JSON.parse(readFileSync(filePath, 'utf-8')) as McpConfig;
    expect(config.otherKey).toBe('value');
    expect(config.mcpServers?.wpce).toEqual({ command: 'npx' });
  });

  it('overwrites an existing server entry with the same name', () => {
    const dir = freshDir();
    const filePath = join(dir, 'config.json');
    writeFileSync(
      filePath,
      JSON.stringify({ mcpServers: { wpce: { command: 'old' } } }, null, 2) + '\n',
    );

    addServerToConfig(filePath, 'mcpServers', 'wpce', { command: 'new' });

    const config = JSON.parse(readFileSync(filePath, 'utf-8')) as McpConfig;
    expect(config.mcpServers?.wpce).toEqual({ command: 'new' });
  });

  it('preserves existing indentation', () => {
    const dir = freshDir();
    const filePath = join(dir, 'config.json');
    writeFileSync(filePath, '{\n\t"mcpServers": {}\n}\n');

    addServerToConfig(filePath, 'mcpServers', 'wpce', { command: 'npx' });

    const content = readFileSync(filePath, 'utf-8');
    // Should detect tab indentation from existing file
    expect(content).toContain('\t');
  });
});

describe('removeServerFromConfig', () => {
  it('removes an existing server entry and returns true', () => {
    const dir = freshDir();
    const filePath = join(dir, 'config.json');
    writeFileSync(
      filePath,
      JSON.stringify(
        { mcpServers: { wpce: { command: 'npx' }, other: { command: 'foo' } } },
        null,
        2,
      ) + '\n',
    );

    const result = removeServerFromConfig(filePath, 'mcpServers', 'wpce');

    expect(result).toBe(true);
    const config = JSON.parse(readFileSync(filePath, 'utf-8')) as McpConfig;
    expect(config.mcpServers?.wpce).toBeUndefined();
    expect(config.mcpServers?.other).toEqual({ command: 'foo' });
  });

  it('returns false when the server name does not exist', () => {
    const dir = freshDir();
    const filePath = join(dir, 'config.json');
    writeFileSync(
      filePath,
      JSON.stringify({ mcpServers: { other: { command: 'foo' } } }, null, 2) + '\n',
    );

    const result = removeServerFromConfig(filePath, 'mcpServers', 'wpce');

    expect(result).toBe(false);
  });

  it('returns false when the configKey does not exist', () => {
    const dir = freshDir();
    const filePath = join(dir, 'config.json');
    writeFileSync(filePath, JSON.stringify({ otherKey: 'value' }, null, 2) + '\n');

    const result = removeServerFromConfig(filePath, 'mcpServers', 'wpce');

    expect(result).toBe(false);
  });

  it('returns false when the config file does not exist', () => {
    const dir = freshDir();
    const filePath = join(dir, 'nonexistent.json');

    const result = removeServerFromConfig(filePath, 'mcpServers', 'wpce');

    expect(result).toBe(false);
  });
});

describe('hasServerInConfig', () => {
  it('returns true when the server entry exists', () => {
    const dir = freshDir();
    const filePath = join(dir, 'config.json');
    writeFileSync(filePath, JSON.stringify({ mcpServers: { wpce: { command: 'npx' } } }, null, 2));

    expect(hasServerInConfig(filePath, 'mcpServers', 'wpce')).toBe(true);
  });

  it('returns false when the server entry does not exist', () => {
    const dir = freshDir();
    const filePath = join(dir, 'config.json');
    writeFileSync(filePath, JSON.stringify({ mcpServers: {} }, null, 2));

    expect(hasServerInConfig(filePath, 'mcpServers', 'wpce')).toBe(false);
  });

  it('returns false when the configKey does not exist', () => {
    const dir = freshDir();
    const filePath = join(dir, 'config.json');
    writeFileSync(filePath, JSON.stringify({}, null, 2));

    expect(hasServerInConfig(filePath, 'mcpServers', 'wpce')).toBe(false);
  });

  it('returns false when the config file does not exist', () => {
    const dir = freshDir();
    const filePath = join(dir, 'nonexistent.json');

    expect(hasServerInConfig(filePath, 'mcpServers', 'wpce')).toBe(false);
  });
});

describe('buildServerEntry', () => {
  it('produces the correct MCP server config structure', () => {
    const entry = buildServerEntry({
      siteUrl: 'https://example.com',
      username: 'admin',
      appPassword: 'xxxx xxxx xxxx',
    });

    expect(entry).toEqual({
      command: 'npx',
      args: ['claudaborative-editing'],
      env: {
        WP_SITE_URL: 'https://example.com',
        WP_USERNAME: 'admin',
        WP_APP_PASSWORD: 'xxxx xxxx xxxx',
      },
    });
  });

  it('uses exact credential values without modification', () => {
    const entry = buildServerEntry({
      siteUrl: 'https://my-site.example.com/wp',
      username: 'My User',
      appPassword: 'aaaa bbbb cccc dddd',
    });

    const env = entry.env as Record<string, string>;
    expect(env.WP_SITE_URL).toBe('https://my-site.example.com/wp');
    expect(env.WP_USERNAME).toBe('My User');
    expect(env.WP_APP_PASSWORD).toBe('aaaa bbbb cccc dddd');
  });
});
