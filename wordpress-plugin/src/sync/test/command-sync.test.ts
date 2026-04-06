/**
 * Unit tests for the command-sync module.
 *
 * The module relies heavily on wordpress/data, wordpress/core-data,
 * wordpress/sync (Yjs + Awareness), and wordpress/api-fetch. All
 * dependencies are mocked to test the public API in isolation.
 */

// ---------------------------------------------------------------------------
// Mock state — shared between the mock implementations and the test body.
// ---------------------------------------------------------------------------

/** Simulated Y.Map backed by a plain object. */
class MockYMap {
	private data: Record<string, unknown> = {};
	private observers: Array<(event: unknown) => void> = [];

	get(key: string): unknown {
		return this.data[key];
	}

	set(key: string, value: unknown): void {
		this.data[key] = value;
		// Notify observers after set
		for (const fn of this.observers) {
			fn({});
		}
	}

	observe(fn: (event: unknown) => void): void {
		this.observers.push(fn);
	}

	unobserve(fn: (event: unknown) => void): void {
		this.observers = this.observers.filter((o) => o !== fn);
	}
}

/** Simulated Y.Doc backed by a map of named Y.Maps. */
class MockYDoc {
	private maps: Record<string, MockYMap> = {};

	getMap(name: string): MockYMap {
		if (!this.maps[name]) {
			this.maps[name] = new MockYMap();
		}
		return this.maps[name];
	}

	transact(fn: () => void): void {
		fn();
	}
}

/** Simulated Awareness. */
class MockAwareness {
	clientID = 1;
	private listeners: Record<string, Array<() => void>> = {};
	private states: Map<number, Record<string, unknown>> = new Map();

	getStates(): Map<number, Record<string, unknown>> {
		return this.states;
	}

	on(event: string, fn: () => void): void {
		(this.listeners[event] ??= []).push(fn);
	}

	off(event: string, fn: () => void): void {
		this.listeners[event] = (this.listeners[event] ?? []).filter(
			(f) => f !== fn
		);
	}

	// Test helper: set a remote awareness state.
	_setRemoteState(clientId: number, state: Record<string, unknown>): void {
		this.states.set(clientId, state);
	}

	// Test helper: trigger a change event.
	_triggerChange(): void {
		for (const fn of this.listeners.change ?? []) {
			fn();
		}
	}
}

// Keep references so we can inspect them from tests.
let capturedAwareness: MockAwareness | null = null;

const mockAddEntities = jest.fn();
const mockGetEntityRecords = jest.fn().mockResolvedValue([]);

jest.mock('@wordpress/data', () => ({
	dispatch: jest.fn(() => ({ addEntities: mockAddEntities })),
	resolveSelect: jest.fn(() => ({
		getEntityRecords: mockGetEntityRecords,
	})),
}));

jest.mock('@wordpress/core-data', () => ({
	store: { name: 'core' },
}));

jest.mock('@wordpress/api-fetch', () => ({
	__esModule: true,
	default: jest.fn().mockResolvedValue([]),
}));

jest.mock('@wordpress/sync', () => ({
	Y: {
		Doc: MockYDoc,
		encodeStateVector: jest.fn(() => new Uint8Array([1, 2, 3])),
		encodeStateAsUpdateV2: jest.fn(() => new Uint8Array([4, 5, 6])),
	},
	Awareness: class extends MockAwareness {
		constructor(doc: unknown) {
			super(doc);
			capturedAwareness = this as unknown as MockAwareness;
		}
	},
}));

// ---------------------------------------------------------------------------
// Imports (AFTER mocks)
// ---------------------------------------------------------------------------

import type { Command } from '../../store/types';

// Force a fresh module for each test by using dynamic import through require.
// The module has module-level state (initialized, commandDoc, etc.) that we
// need to reset between tests. Jest's module registry handles this when we
// use jest.isolateModules or re-require.
function loadModule() {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	return require('../command-sync') as typeof import('../command-sync');
}

const MOCK_COMMAND: Command = {
	id: 42,
	post_id: 123,
	prompt: 'proofread',
	status: 'running',
	arguments: {},
	message: null,
	result_data: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('command-sync', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.resetModules();
		capturedAwareness = null;
	});

	describe('initCommandSync', () => {
		it('registers entity and triggers resolver', () => {
			const mod = loadModule();
			mod.initCommandSync();

			expect(mockAddEntities).toHaveBeenCalledWith([
				expect.objectContaining({
					kind: 'root',
					name: 'wpce_commands',
					baseURL: '/wpce/v1/sync-entity',
					plural: 'wpceCommands',
					syncConfig: expect.any(Object),
				}),
			]);

			expect(mockGetEntityRecords).toHaveBeenCalledWith(
				'root',
				'wpce_commands',
				{ per_page: -1 }
			);
		});

		it('only initializes once', () => {
			const mod = loadModule();
			mod.initCommandSync();
			mod.initCommandSync();

			expect(mockAddEntities).toHaveBeenCalledTimes(1);
			expect(mockGetEntityRecords).toHaveBeenCalledTimes(1);
		});
	});

	describe('syncConfig callbacks', () => {
		it('applyChangesToCRDTDoc is a no-op', () => {
			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			// Should not throw.
			expect(() => syncConfig.applyChangesToCRDTDoc()).not.toThrow();
		});

		it('getChangesFromCRDTDoc returns empty object', () => {
			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			expect(syncConfig.getChangesFromCRDTDoc()).toEqual({});
		});

		it('createAwareness captures doc and returns Awareness instance', () => {
			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			const awareness = syncConfig.createAwareness(doc);

			// The returned value should be an Awareness instance.
			expect(awareness).toBeDefined();
			expect(typeof awareness.on).toBe('function');

			// After createAwareness, the doc should be captured and commands readable.
			doc.getMap('state').set('commands', { '1': MOCK_COMMAND });
			expect(mod.getCommandsFromSync()['1']).toEqual(MOCK_COMMAND);
		});
	});

	describe('writeCommandToSync', () => {
		it('writes to state map when commandDoc is available', () => {
			const mod = loadModule();
			mod.initCommandSync();

			// Simulate the Y.Doc being captured by invoking the syncConfig.createAwareness callback.
			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			syncConfig.createAwareness(doc);

			mod.writeCommandToSync(MOCK_COMMAND);

			const stateMap = doc.getMap('state');
			const commands = stateMap.get('commands') as Record<
				string,
				unknown
			>;
			expect(commands['42']).toEqual(expect.objectContaining({ id: 42 }));
			expect(stateMap.get('savedAt')).toEqual(expect.any(Number));
		});

		it('removes terminal commands instead of writing them', () => {
			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			syncConfig.createAwareness(doc);

			// First, write a running command.
			mod.writeCommandToSync(MOCK_COMMAND);

			// Verify the command is written.
			const stateMap = doc.getMap('state');
			let commands = stateMap.get('commands') as Record<string, unknown>;
			expect(commands['42']).toBeDefined();

			// Now write a terminal version of the same command.
			const completedCommand: Command = {
				...MOCK_COMMAND,
				status: 'completed',
			};
			mod.writeCommandToSync(completedCommand);

			// The command should have been removed.
			commands = stateMap.get('commands') as Record<string, unknown>;
			expect(commands['42']).toBeUndefined();
		});

		it('does nothing when commandDoc is not available', () => {
			const mod = loadModule();
			// Don't call initCommandSync — doc is null
			// Should not throw.
			expect(() => mod.writeCommandToSync(MOCK_COMMAND)).not.toThrow();
		});
	});

	describe('getCommandsFromSync', () => {
		it('reads from state map', () => {
			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			syncConfig.createAwareness(doc);

			// Write a command manually.
			doc.getMap('state').set('commands', { '42': MOCK_COMMAND });

			const commands = mod.getCommandsFromSync();
			expect(commands['42']).toEqual(MOCK_COMMAND);
		});

		it('returns empty object when state map has no commands', () => {
			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			syncConfig.createAwareness(doc);

			const commands = mod.getCommandsFromSync();
			expect(commands).toEqual({});
		});

		it('returns empty object when commandDoc is not available', () => {
			const mod = loadModule();
			const commands = mod.getCommandsFromSync();
			expect(commands).toEqual({});
		});
	});

	describe('isMcpConnected', () => {
		it('returns false when no awareness', () => {
			const mod = loadModule();
			expect(mod.isMcpConnected()).toBe(false);
		});

		it('returns false when no remote clients have MCP browserType', () => {
			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			syncConfig.createAwareness(doc);

			// Add a non-MCP remote client.
			capturedAwareness!._setRemoteState(99, {
				collaboratorInfo: { browserType: 'Chrome' },
			});

			expect(mod.isMcpConnected()).toBe(false);
		});

		it('returns true when a remote client has MCP browserType', () => {
			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			syncConfig.createAwareness(doc);

			capturedAwareness!._setRemoteState(99, {
				collaboratorInfo: {
					browserType: 'Claudaborative Editing MCP',
				},
			});

			expect(mod.isMcpConnected()).toBe(true);
		});

		it('skips states with null or non-object values', () => {
			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			syncConfig.createAwareness(doc);

			// Set a null state and a non-object state.
			capturedAwareness!._setRemoteState(90, null as any);
			capturedAwareness!._setRemoteState(91, 'not-an-object' as any);

			expect(mod.isMcpConnected()).toBe(false);
		});

		it('ignores own client ID', () => {
			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			syncConfig.createAwareness(doc);

			// Set the MCP browserType on own client ID.
			const ownId = capturedAwareness!.clientID;
			capturedAwareness!._setRemoteState(ownId, {
				collaboratorInfo: {
					browserType: 'Claudaborative Editing MCP',
				},
			});

			expect(mod.isMcpConnected()).toBe(false);
		});
	});

	describe('subscribeToMcpConnection', () => {
		it('returns unsubscribe function', () => {
			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			syncConfig.createAwareness(doc);

			const callback = jest.fn();
			const unsubscribe = mod.subscribeToMcpConnection(callback);

			expect(typeof unsubscribe).toBe('function');

			// The callback should have been called once on subscribe
			// with the initial state.
			expect(callback).toHaveBeenCalledWith(false);
		});

		it('calls callback when awareness changes', () => {
			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			syncConfig.createAwareness(doc);

			const callback = jest.fn();
			mod.subscribeToMcpConnection(callback);

			// Initial call.
			expect(callback).toHaveBeenCalledWith(false);

			// Add MCP client and trigger change.
			capturedAwareness!._setRemoteState(99, {
				collaboratorInfo: {
					browserType: 'Claudaborative Editing MCP',
				},
			});
			capturedAwareness!._triggerChange();

			expect(callback).toHaveBeenCalledWith(true);
		});

		it('stops calling callback after unsubscribe', () => {
			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			syncConfig.createAwareness(doc);

			const callback = jest.fn();
			const unsubscribe = mod.subscribeToMcpConnection(callback);

			// Initial call.
			expect(callback).toHaveBeenCalledTimes(1);

			unsubscribe();

			// Trigger change — callback should NOT be called again.
			capturedAwareness!._triggerChange();
			expect(callback).toHaveBeenCalledTimes(1);
		});
	});

	describe('subscribeToMcpConnection (polling fallback)', () => {
		it('returns unsubscribe function when awareness is not yet initialized', () => {
			jest.useFakeTimers();
			const mod = loadModule();
			// Don't initialize awareness — test the polling fallback path.

			const callback = jest.fn();
			const unsubscribe = mod.subscribeToMcpConnection(callback);

			expect(typeof unsubscribe).toBe('function');

			// Callback should not be called yet (awareness is null).
			expect(callback).not.toHaveBeenCalled();

			// Clean up the polling interval.
			unsubscribe();
			jest.useRealTimers();
		});

		it('attaches to awareness once it becomes available', () => {
			jest.useFakeTimers();
			const mod = loadModule();
			mod.initCommandSync();

			// Subscribe before awareness is created.
			const callback = jest.fn();
			mod.subscribeToMcpConnection(callback);

			// Awareness is created by createAwareness callback.
			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			syncConfig.createAwareness(doc);

			// Advance timers to trigger the polling interval.
			jest.advanceTimersByTime(200);

			// The callback should have been called with the initial state.
			expect(callback).toHaveBeenCalledWith(false);

			jest.useRealTimers();
		});
	});

	describe('removeCommandFromSync', () => {
		it('removes a specific command from the state map', () => {
			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			syncConfig.createAwareness(doc);

			// Write two commands.
			mod.writeCommandToSync(MOCK_COMMAND);
			const secondCommand: Command = {
				...MOCK_COMMAND,
				id: 43,
			};
			mod.writeCommandToSync(secondCommand);

			const stateMap = doc.getMap('state');
			let commands = stateMap.get('commands') as Record<string, unknown>;
			expect(commands['42']).toBeDefined();
			expect(commands['43']).toBeDefined();

			// Remove command 42.
			mod.removeCommandFromSync(42);

			commands = stateMap.get('commands') as Record<string, unknown>;
			expect(commands['42']).toBeUndefined();
			expect(commands['43']).toBeDefined();
		});
	});

	describe('subscribeToCommandSync', () => {
		it('returns unsubscribe function', () => {
			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			syncConfig.createAwareness(doc);

			const callback = jest.fn();
			const unsubscribe = mod.subscribeToCommandSync(callback);

			expect(typeof unsubscribe).toBe('function');

			unsubscribe();
		});

		it('calls callback when state map commands change', () => {
			jest.useFakeTimers();
			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			syncConfig.createAwareness(doc);

			const callback = jest.fn();
			mod.subscribeToCommandSync(callback);

			// Advance timers so the setInterval in subscribeToCommandSync fires.
			jest.advanceTimersByTime(200);

			// Now change the commands in the state map — the observer should fire.
			const stateMap = doc.getMap('state');
			stateMap.set('commands', { '42': MOCK_COMMAND });

			expect(callback).toHaveBeenCalledWith({ '42': MOCK_COMMAND });

			jest.useRealTimers();
		});

		it('does not call callback when commands have not changed', () => {
			jest.useFakeTimers();
			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			syncConfig.createAwareness(doc);

			// Pre-populate commands.
			doc.getMap('state').set('commands', { '42': MOCK_COMMAND });

			const callback = jest.fn();
			mod.subscribeToCommandSync(callback);

			// Advance timers so the interval fires.
			jest.advanceTimersByTime(200);

			// Trigger another observe event with the same commands — should not call callback.
			callback.mockClear();
			doc.getMap('state').set('savedAt', Date.now());

			expect(callback).not.toHaveBeenCalled();

			jest.useRealTimers();
		});

		it('stops observing after unsubscribe', () => {
			jest.useFakeTimers();
			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			syncConfig.createAwareness(doc);

			const callback = jest.fn();
			const unsubscribe = mod.subscribeToCommandSync(callback);

			jest.advanceTimersByTime(200);

			unsubscribe();

			// Change commands after unsubscribe — should not fire.
			doc.getMap('state').set('commands', { '99': MOCK_COMMAND });
			expect(callback).not.toHaveBeenCalled();

			jest.useRealTimers();
		});
	});
});
