import { VERSION } from './server.js';
import type { McpClientType, SetupOptions } from './cli/types.js';

const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  console.log(VERSION);
  process.exit(0);
}

if (args.includes('--help') || args.includes('-h')) {
  console.log(`claudaborative-editing v${VERSION}

MCP server for collaborative WordPress post editing via Yjs CRDT.

Usage:
  claudaborative-editing              Start the MCP server (stdio transport)
  claudaborative-editing setup        Interactive setup wizard
  claudaborative-editing setup --manual   Use manual credential entry
  claudaborative-editing setup --remove   Remove configuration from MCP clients
  claudaborative-editing setup --client <name>  Configure a specific client only
  claudaborative-editing --version    Print version
  claudaborative-editing --help       Show this help

Environment variables:
  WP_SITE_URL        WordPress site URL
  WP_USERNAME        WordPress username
  WP_APP_PASSWORD    WordPress Application Password

More info: https://github.com/pento/claudaborative-editing`);
  process.exit(0);
}

if (args[0] === 'setup') {
  const { runSetup } = await import('./cli/setup.js');
  const options: SetupOptions = {};
  if (args.includes('--manual')) {
    options.manual = true;
  }
  if (args.includes('--remove')) {
    options.remove = true;
  }
  const clientIdx = args.indexOf('--client');
  if (clientIdx !== -1) {
    if (args[clientIdx + 1]) {
      options.client = args[clientIdx + 1] as McpClientType;
    } else {
      console.error('Error: --client requires a client name. See --help for usage.');
      process.exit(1);
    }
  }
  await runSetup(undefined, options);
} else {
  const { startServer } = await import('./server.js');
  startServer().catch((error: unknown) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}
