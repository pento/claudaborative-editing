import { VERSION } from './server.js';
import type { SetupOptions } from './cli/types.js';

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
  claudaborative-editing start        Start Claude Code with the MCP server
  claudaborative-editing setup        Interactive setup wizard
  claudaborative-editing setup --manual   Use manual credential entry
  claudaborative-editing setup --remove   Remove configuration from Claude Code
  claudaborative-editing --version    Print version
  claudaborative-editing --help       Show this help

Environment variables:
  WP_SITE_URL        WordPress site URL
  WP_USERNAME        WordPress username
  WP_APP_PASSWORD    WordPress Application Password

More info: https://github.com/pento/claudaborative-editing`);
	process.exit(0);
}

if (args[0] === 'start') {
	const { runStart } = await import('./cli/start.js');
	await runStart();
} else if (args[0] === 'setup') {
	const { runSetup } = await import('./cli/setup.js');
	const options: SetupOptions = {};
	if (args.includes('--manual')) {
		options.manual = true;
	}
	if (args.includes('--remove')) {
		options.remove = true;
	}
	await runSetup(undefined, options);
} else {
	const { startServer } = await import('./server.js');
	startServer().catch((error: unknown) => {
		console.error('Failed to start server:', error);
		process.exit(1);
	});
}
