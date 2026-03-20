import { VERSION } from './server.js';

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
  await runSetup();
} else {
  const { startServer } = await import('./server.js');
  startServer().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}
