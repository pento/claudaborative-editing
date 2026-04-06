import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock node:fs so we can observe appendFileSync calls ---
const mockAppendFileSync = vi.fn();
vi.mock('node:fs', () => ({
	appendFileSync: (...args: unknown[]): void => {
		mockAppendFileSync(...args);
	},
}));

describe('debugLog', () => {
	const originalEnv = process.env.WPCE_DEBUG_LOG;

	beforeEach(() => {
		vi.clearAllMocks();
		// Reset module registry so each test gets a fresh `logFile` binding
		vi.resetModules();
	});

	afterEach(() => {
		// Restore original env
		if (originalEnv === undefined) {
			delete process.env.WPCE_DEBUG_LOG;
		} else {
			process.env.WPCE_DEBUG_LOG = originalEnv;
		}
	});

	it('does nothing when WPCE_DEBUG_LOG is not set', async () => {
		delete process.env.WPCE_DEBUG_LOG;

		const { debugLog } = await import('../../src/debug-log.js');
		debugLog('test', 'hello');

		expect(mockAppendFileSync).not.toHaveBeenCalled();
	});

	it('writes formatted log lines when WPCE_DEBUG_LOG is set', async () => {
		process.env.WPCE_DEBUG_LOG = '/tmp/test-debug.log';

		const { debugLog } = await import('../../src/debug-log.js');
		debugLog('mycat', 'some message');

		expect(mockAppendFileSync).toHaveBeenCalledOnce();
		const [filePath, content] = mockAppendFileSync.mock.calls[0] as [
			string,
			string,
		];
		expect(filePath).toBe('/tmp/test-debug.log');
		// Format: [ISO timestamp] [category] message\n
		expect(content).toMatch(
			/^\[\d{4}-\d{2}-\d{2}T.+\] \[mycat\] some message\n$/
		);
	});

	it('handles string arguments', async () => {
		process.env.WPCE_DEBUG_LOG = '/tmp/test-debug.log';

		const { debugLog } = await import('../../src/debug-log.js');
		debugLog('cat', 'hello', 'world');

		const [, content] = mockAppendFileSync.mock.calls[0] as [
			string,
			string,
		];
		expect(content).toContain('hello world');
	});

	it('handles number arguments via String()', async () => {
		process.env.WPCE_DEBUG_LOG = '/tmp/test-debug.log';

		const { debugLog } = await import('../../src/debug-log.js');
		debugLog('cat', 42, 3.14);

		const [, content] = mockAppendFileSync.mock.calls[0] as [
			string,
			string,
		];
		expect(content).toContain('42 3.14');
	});

	it('handles object arguments via JSON.stringify', async () => {
		process.env.WPCE_DEBUG_LOG = '/tmp/test-debug.log';

		const { debugLog } = await import('../../src/debug-log.js');
		debugLog('cat', { foo: 'bar', n: 1 });

		const [, content] = mockAppendFileSync.mock.calls[0] as [
			string,
			string,
		];
		expect(content).toContain('{"foo":"bar","n":1}');
	});

	it('handles null and undefined as empty strings', async () => {
		process.env.WPCE_DEBUG_LOG = '/tmp/test-debug.log';

		const { debugLog } = await import('../../src/debug-log.js');
		debugLog('cat', null, undefined);

		expect(mockAppendFileSync).toHaveBeenCalledOnce();
		// null and undefined map to '' so joined with space: ' '
		const [, content] = mockAppendFileSync.mock.calls[0] as [
			string,
			string,
		];
		expect(content).toMatch(/\[cat\] {2}\n$/);
	});

	it('handles boolean arguments via String()', async () => {
		process.env.WPCE_DEBUG_LOG = '/tmp/test-debug.log';

		const { debugLog } = await import('../../src/debug-log.js');
		debugLog('cat', true, false);

		const [, content] = mockAppendFileSync.mock.calls[0] as [
			string,
			string,
		];
		expect(content).toContain('true false');
	});

	it('handles mixed argument types', async () => {
		process.env.WPCE_DEBUG_LOG = '/tmp/test-debug.log';

		const { debugLog } = await import('../../src/debug-log.js');
		debugLog('cat', 'msg', 42, { key: 'val' }, null);

		const [, content] = mockAppendFileSync.mock.calls[0] as [
			string,
			string,
		];
		expect(content).toContain('msg 42 {"key":"val"} ');
	});

	it('silently ignores write errors', async () => {
		process.env.WPCE_DEBUG_LOG = '/tmp/test-debug.log';
		mockAppendFileSync.mockImplementation(() => {
			throw new Error('EACCES: permission denied');
		});

		const { debugLog } = await import('../../src/debug-log.js');

		// Should not throw
		expect(() => {
			debugLog('cat', 'will fail');
		}).not.toThrow();

		expect(mockAppendFileSync).toHaveBeenCalledOnce();
	});

	it('handles array arguments via JSON.stringify', async () => {
		process.env.WPCE_DEBUG_LOG = '/tmp/test-debug.log';

		const { debugLog } = await import('../../src/debug-log.js');
		debugLog('cat', [1, 2, 3]);

		const [, content] = mockAppendFileSync.mock.calls[0] as [
			string,
			string,
		];
		expect(content).toContain('[1,2,3]');
	});
});
