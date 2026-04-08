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

	it('errors when claude is not on PATH', async () => {
		const { deps, errors } = createTestDeps({
			isClaudeOnPath: () => false,
		});

		await expect(runStart(deps)).rejects.toThrow(StartExitError);
		expect(errors.join('\n')).toContain('Claude Code is not installed');
		expect(errors.join('\n')).toContain('https://claude.ai/download');
	});

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

	it('exits with 143 on signal termination', async () => {
		const spawn = vi.fn().mockResolvedValue(null);

		const { deps } = createTestDeps({ spawn });

		await expect(runStart(deps)).rejects.toThrow(
			expect.objectContaining({ code: 143 })
		);
	});

	it('propagates setup failure', async () => {
		const runSetup = vi.fn().mockRejectedValue(new Error('setup failed'));

		const { deps } = createTestDeps({
			hasConfig: () => false,
			runSetup,
		});

		await expect(runStart(deps)).rejects.toThrow('setup failed');
	});

	it('logs setup message when running setup', async () => {
		const { deps, logs } = createTestDeps({
			hasConfig: () => false,
		});

		await expect(runStart(deps)).rejects.toThrow(StartExitError);

		expect(logs.join('\n')).toContain('MCP server not configured');
	});
});
