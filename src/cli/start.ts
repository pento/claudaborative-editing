/**
 * `start` command — checks prerequisites, runs setup if needed,
 * then spawns Claude Code with channels enabled.
 */

import { spawn as nodeSpawn } from 'child_process';
import { constants } from 'os';

import { isOnPath, MCP_CLIENTS, SERVER_NAME } from './clients.js';
import { hasServerInConfig } from './config-writer.js';

export interface StartDeps {
	log: (message: string) => void;
	error: (message: string) => void;
	exit: (code: number) => never;
	/** Override PATH check for testing */
	isClaudeOnPath?: () => boolean;
	/** Override config check for testing */
	hasConfig?: () => boolean;
	/** Override setup for testing */
	runSetup?: () => Promise<void>;
	/** Override spawn for testing — returns exit code (128+N for signals) */
	spawn?: (command: string, args: string[]) => Promise<number>;
}

/* v8 ignore start -- default deps use real child_process/readline */
function defaultDeps(): StartDeps {
	return {
		log: (msg) => {
			console.log(msg);
		},
		error: (msg) => {
			console.error(`Error: ${msg}`);
		},
		exit: (code) => process.exit(code),
		isClaudeOnPath: () => isOnPath('claude'),
		hasConfig: () => {
			const config = MCP_CLIENTS['claude-code'];
			return hasServerInConfig(
				config.configPath(),
				config.configKey,
				SERVER_NAME
			);
		},
		runSetup: async () => {
			const { runSetup: realSetup } = await import('./setup.js');
			await realSetup();
		},
		spawn: (command: string, args: string[]) =>
			new Promise((resolve) => {
				const child = nodeSpawn(command, args, { stdio: 'inherit' });

				const signals: NodeJS.Signals[] = [
					'SIGINT',
					'SIGTERM',
					'SIGHUP',
				];
				const handlers = new Map<NodeJS.Signals, () => void>();

				for (const signal of signals) {
					const handler = () => {
						child.kill(signal);
					};
					handlers.set(signal, handler);
					process.on(signal, handler);
				}

				function cleanup(): void {
					for (const [sig, handler] of handlers) {
						process.removeListener(sig, handler);
					}
				}

				child.on('error', (err) => {
					cleanup();
					// ENOENT = command not found, EACCES = permission denied
					console.error(`Failed to start claude: ${err.message}`);
					resolve(1);
				});

				child.on('close', (code, sig) => {
					cleanup();
					if (sig) {
						const num = constants.signals[sig];
						resolve(num ? 128 + num : 143);
					} else {
						resolve(code ?? 0);
					}
				});
			}),
	};
}
/* v8 ignore stop */

const CLAUDE_ARGS = [
	'--dangerously-load-development-channels',
	`server:${SERVER_NAME}`,
	'--permission-mode',
	'acceptEdits',
];

export async function runStart(deps: StartDeps = defaultDeps()): Promise<void> {
	const checkPath = deps.isClaudeOnPath ?? (() => isOnPath('claude'));
	if (!checkPath()) {
		deps.error(
			'Claude Code is not installed or not on PATH.\n' +
				'  Install it from https://claude.ai/download'
		);
		deps.exit(1);
	}

	const checkConfig =
		deps.hasConfig ??
		/* v8 ignore next 9 -- inline fallback only used without injected deps */
		(() => {
			try {
				const config = MCP_CLIENTS['claude-code'];
				return hasServerInConfig(
					config.configPath(),
					config.configKey,
					SERVER_NAME
				);
			} catch {
				return false;
			}
		});

	if (!checkConfig()) {
		deps.log('MCP server not configured. Running setup...');
		deps.log('');
		const doSetup =
			deps.runSetup ??
			/* v8 ignore next 3 -- inline fallback only used without injected deps */
			(async () => {
				const { runSetup: realSetup } = await import('./setup.js');
				await realSetup();
			});
		await doSetup();
	}

	deps.log('Starting Claude Code...');
	deps.log('');

	const doSpawn =
		deps.spawn ??
		/* v8 ignore next 5 -- inline fallback only used without injected deps */
		((command: string, args: string[]) =>
			new Promise<number>((resolve) => {
				const child = nodeSpawn(command, args, { stdio: 'inherit' });
				child.on('close', (code) => {
					resolve(code ?? 0);
				});
			}));

	const exitCode = await doSpawn('claude', CLAUDE_ARGS);
	deps.exit(exitCode);
}
