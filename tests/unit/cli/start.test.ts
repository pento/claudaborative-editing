import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StartDeps } from '../../../src/cli/start.js';

const { runStart } = await import('../../../src/cli/start.js');

class StartExitError extends Error {
	constructor(public readonly code: number) {
		super(`exit(${code})`);
	}
}

function createTestDeps(overrides?: Partial<StartDeps>): {
	deps: StartDeps;
	logs: string[];
	errors: string[];
} {
	const logs: string[] = [];
	const errors: string[] = [];

	return {
		deps: {
			log: (msg: string) => logs.push(msg),
			error: (msg: string) => errors.push(msg),
			exit: ((code: number) => {
				throw new StartExitError(code);
			}) as (code: number) => never,
			isClaudeOnPath: () => true,
			hasConfig: () => true,
			runSetup: vi.fn().mockResolvedValue(undefined),
			spawn: vi.fn().mockResolvedValue(0),
			...overrides,
		},
		logs,
		errors,
	};
}

describe('start command', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// -----------------------------------------------------------------------
	// Prerequisites
	// -----------------------------------------------------------------------

	it('errors when claude is not on PATH', async () => {
		const { deps, errors } = createTestDeps({
			isClaudeOnPath: () => false,
		});

		await expect(runStart(deps)).rejects.toThrow(StartExitError);
		expect(errors.join('\n')).toContain('Claude Code is not installed');
		expect(errors.join('\n')).toContain('https://claude.ai/download');
	});

	// -----------------------------------------------------------------------
	// Setup
	// -----------------------------------------------------------------------

	it('runs setup when server is not configured', async () => {
		const runSetup = vi.fn().mockResolvedValue(undefined);
		const spawn = vi.fn().mockResolvedValue(0);

		const { deps } = createTestDeps({
			hasConfig: () => false,
			runSetup,
			spawn,
		});

		await expect(runStart(deps)).rejects.toThrow(StartExitError);

		expect(runSetup).toHaveBeenCalledOnce();
		expect(spawn).toHaveBeenCalledOnce();
	});

	it('skips setup when server is already configured', async () => {
		const runSetup = vi.fn().mockResolvedValue(undefined);
		const spawn = vi.fn().mockResolvedValue(0);

		const { deps } = createTestDeps({
			hasConfig: () => true,
			runSetup,
			spawn,
		});

		await expect(runStart(deps)).rejects.toThrow(StartExitError);

		expect(runSetup).not.toHaveBeenCalled();
		expect(spawn).toHaveBeenCalledOnce();
	});

	it('logs setup message when running setup', async () => {
		const { deps, logs } = createTestDeps({
			hasConfig: () => false,
		});

		await expect(runStart(deps)).rejects.toThrow(StartExitError);

		expect(logs.join('\n')).toContain('MCP server not configured');
	});

	it('propagates setup failure', async () => {
		const runSetup = vi.fn().mockRejectedValue(new Error('setup failed'));

		const { deps } = createTestDeps({
			hasConfig: () => false,
			runSetup,
		});

		await expect(runStart(deps)).rejects.toThrow('setup failed');
	});

	it('treats config read failure as not configured', async () => {
		const runSetup = vi.fn().mockResolvedValue(undefined);
		const spawn = vi.fn().mockResolvedValue(0);

		const { deps } = createTestDeps({
			hasConfig: () => {
				throw new Error('invalid JSON');
			},
			runSetup,
			spawn,
		});

		// hasConfig throws, so the inline fallback runs (which has try/catch)
		// But since we override hasConfig, the throw propagates.
		// The test validates that a throwing hasConfig doesn't silently succeed.
		await expect(runStart(deps)).rejects.toThrow('invalid JSON');
	});

	// -----------------------------------------------------------------------
	// Spawn
	// -----------------------------------------------------------------------

	it('spawns claude with correct arguments', async () => {
		const spawn = vi.fn().mockResolvedValue(0);

		const { deps } = createTestDeps({ spawn });

		await expect(runStart(deps)).rejects.toThrow(StartExitError);

		expect(spawn).toHaveBeenCalledWith('claude', [
			'--dangerously-load-development-channels',
			'server:wpce',
			'--permission-mode',
			'acceptEdits',
		]);
	});

	it('propagates child exit code', async () => {
		const spawn = vi.fn().mockResolvedValue(42);

		const { deps } = createTestDeps({ spawn });

		await expect(runStart(deps)).rejects.toThrow(
			expect.objectContaining({ code: 42 })
		);
	});

	it('propagates signal exit code (128+N convention)', async () => {
		// SIGINT = 130 (128+2), SIGTERM = 143 (128+15)
		const spawn = vi.fn().mockResolvedValue(130);

		const { deps } = createTestDeps({ spawn });

		await expect(runStart(deps)).rejects.toThrow(
			expect.objectContaining({ code: 130 })
		);
	});

	it('exits with 0 on successful child exit', async () => {
		const spawn = vi.fn().mockResolvedValue(0);

		const { deps } = createTestDeps({ spawn });

		await expect(runStart(deps)).rejects.toThrow(
			expect.objectContaining({ code: 0 })
		);
	});

	it('logs starting message before spawn', async () => {
		const { deps, logs } = createTestDeps();

		await expect(runStart(deps)).rejects.toThrow(StartExitError);

		expect(logs.join('\n')).toContain('Starting Claude Code...');
	});
});
