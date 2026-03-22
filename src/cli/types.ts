// Types shared across CLI modules

export type McpClientType =
  | 'claude-code'
  | 'claude-desktop'
  | 'vscode'
  | 'vscode-insiders'
  | 'cursor'
  | 'windsurf';

export interface McpClientConfig {
  /** Internal identifier */
  name: McpClientType;
  /** Human-readable name for display */
  displayName: string;
  /** Returns the absolute path to the client's global MCP config file */
  configPath: () => string;
  /** JSON key under which MCP servers are stored (e.g., "mcpServers" or "servers") */
  configKey: string;
  /** Check if this client appears to be installed */
  detectInstall: () => boolean;
  /** Optional: use CLI tool instead of direct file writing (e.g., Claude Code's `claude mcp add`) */
  useCli?: (credentials: WpCredentials) => Promise<boolean>;
  /** Optional: use CLI tool for removal */
  removeCli?: () => Promise<boolean>;
}

export interface WpCredentials {
  siteUrl: string;
  username: string;
  appPassword: string;
}

export interface SetupOptions {
  manual?: boolean;
  client?: McpClientType;
  remove?: boolean;
}
