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
		// Notify observers with a mock YMapEvent containing the changed key.
		const event = {
			changes: { keys: new Map([[key, { action: 'update' }]]) },
		};
		for (const fn of this.observers) {
			fn(event);
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
	document: unknown;
	private listeners: Record<string, Array<() => void>> = {};
	private states: Map<number, Record<string, unknown>> = new Map();

	// Accept optional doc arg to match real Awareness constructor signature.
	constructor(_doc?: unknown) {
		this.document = _doc;
	}

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
const mockGetCurrentUser = jest.fn().mockResolvedValue({ id: 1 });

jest.mock('@wordpress/data', () => ({
	dispatch: jest.fn(() => ({ addEntities: mockAddEntities })),
	resolveSelect: jest.fn(() => ({
		getEntityRecords: mockGetEntityRecords,
		getCurrentUser: mockGetCurrentUser,
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

const mockAddFilter = jest.fn();
jest.mock('@wordpress/hooks', () => ({
	addFilter: (...args: unknown[]) => mockAddFilter(...args),
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
	user_id: 1,
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

	describe('connection limit filter', () => {
		it('registers a filter that raises the limit for the command room', () => {
			loadModule();

			expect(mockAddFilter).toHaveBeenCalledWith(
				'sync.pollingProvider.maxClientsPerRoom',
				'claudaborative-editing/command-room-limit',
				expect.any(Function)
			);

			const filterFn = mockAddFilter.mock.calls.find(
				(c: unknown[]) =>
					c[0] === 'sync.pollingProvider.maxClientsPerRoom'
			)![2] as (limit: number, room: string) => number;

			expect(filterFn(3, 'root/wpce_commands')).toBe(100);
		});

		it('passes through the default limit for other rooms', () => {
			loadModule();

			const filterFn = mockAddFilter.mock.calls.find(
				(c: unknown[]) =>
					c[0] === 'sync.pollingProvider.maxClientsPerRoom'
			)![2] as (limit: number, room: string) => number;

			expect(filterFn(3, 'postType/post:123')).toBe(3);
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

		it('warns and drops pending writes after max retries when Y.Doc never becomes available', () => {
			jest.useFakeTimers();
			const warnSpy = jest
				.spyOn(console, 'warn')
				.mockImplementation(() => {});

			try {
				const mod = loadModule();
				mod.initCommandSync();

				// Call writeCommandToSync BEFORE createAwareness provides the doc.
				// The Y.Doc never becomes available, so retries will exhaust.
				mod.writeCommandToSync(MOCK_COMMAND);

				// Advance past all 50 retries (50 × 200ms = 10_000ms).
				jest.advanceTimersByTime(10_000);

				expect(warnSpy).toHaveBeenCalledWith(
					expect.stringContaining('Dropping 1 pending command write')
				);
				expect(warnSpy).toHaveBeenCalledWith(
					expect.stringContaining('Y.Doc not ready after 50 retries')
				);
			} finally {
				warnSpy.mockRestore();
				jest.useRealTimers();
			}
		});

		it('retries writing when commandDoc becomes available after initial call', () => {
			jest.useFakeTimers();

			try {
				const mod = loadModule();
				mod.initCommandSync();

				// Call writeCommandToSync BEFORE createAwareness provides the doc.
				// The first attempt fails (stateMap is null), starting the retry interval.
				mod.writeCommandToSync(MOCK_COMMAND);

				// Now simulate the Y.Doc becoming available.
				const syncConfig =
					mockAddEntities.mock.calls[0][0][0].syncConfig;
				const doc = new MockYDoc();
				syncConfig.createAwareness(doc);

				// Advance timers to trigger the retry.
				jest.advanceTimersByTime(200);

				// The retry should have written the command.
				const stateMap = doc.getMap('state');
				const commands = stateMap.get('commands') as Record<
					string,
					unknown
				>;
				expect(commands['42']).toEqual(
					expect.objectContaining({ id: 42 })
				);
			} finally {
				jest.useRealTimers();
			}
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
		afterEach(() => {
			delete (window as any).wpceInitialState;
		});

		it('returns false when no awareness and no wpceInitialState', () => {
			const mod = loadModule();
			expect(mod.isMcpConnected()).toBe(false);
		});

		it('returns true when no awareness but wpceInitialState.mcpConnected is true', () => {
			(window as any).wpceInitialState = { mcpConnected: true };
			const mod = loadModule();
			expect(mod.isMcpConnected()).toBe(true);
		});

		it('returns false when no awareness and wpceInitialState.mcpConnected is false', () => {
			(window as any).wpceInitialState = { mcpConnected: false };
			const mod = loadModule();
			expect(mod.isMcpConnected()).toBe(false);
		});

		it('awareness takes precedence over wpceInitialState', () => {
			// Set the server-side hint to true…
			(window as any).wpceInitialState = { mcpConnected: true };

			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			syncConfig.createAwareness(doc);

			// …but awareness has no MCP client, so it should return false.
			capturedAwareness!._setRemoteState(99, {
				collaboratorInfo: { browserType: 'Chrome' },
			});

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

		it('times out and calls callback(false) when awareness never initializes', () => {
			jest.useFakeTimers();
			const mod = loadModule();
			// Do NOT create awareness — it stays null.

			const callback = jest.fn();
			mod.subscribeToMcpConnection(callback);

			// Advance past the 30-second timeout (300 retries × 100ms).
			jest.advanceTimersByTime(30_000);

			// Should have been called once with false on timeout.
			expect(callback).toHaveBeenCalledTimes(1);
			expect(callback).toHaveBeenCalledWith(false);

			// Advancing further should not cause additional calls.
			callback.mockClear();
			jest.advanceTimersByTime(10_000);
			expect(callback).not.toHaveBeenCalled();

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

	describe('fetch interceptor', () => {
		let originalFetch: typeof window.fetch;

		beforeEach(() => {
			originalFetch = window.fetch;
		});

		afterEach(() => {
			window.fetch = originalFetch;
		});

		it('injects compaction when command room has empty updates', async () => {
			// Set up a spy as the original fetch before the interceptor captures it.
			const fetchSpy = jest.fn().mockResolvedValue({
				ok: true,
				text: () => Promise.resolve('ok'),
			});
			window.fetch = fetchSpy;

			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			syncConfig.createAwareness(doc);
			// installFetchInterceptor ran inside createAwareness,
			// capturing fetchSpy as origFetch, and replacing window.fetch.

			// Put some data in the doc so it has state to encode.
			doc.getMap('state').set('commands', { '42': MOCK_COMMAND });

			// Build a wp-sync request body with the command room having empty updates.
			const body = JSON.stringify({
				rooms: [
					{
						room: 'postType/post:123',
						updates: [{ type: 'update', data: 'abc' }],
					},
					{ room: 'root/wpce_commands', updates: [] },
				],
			});

			await window.fetch(
				'https://example.com/wp-json/wp-sync/v1/updates',
				{
					method: 'POST',
					body,
				}
			);

			// The interceptor should have injected a compaction update.
			const passedBody = JSON.parse(
				fetchSpy.mock.calls[0][1].body as string
			) as {
				rooms: Array<{
					room: string;
					updates: Array<{ type: string; data: string }>;
				}>;
			};
			const cmdRoom = passedBody.rooms.find(
				(r) => r.room === 'root/wpce_commands'
			);
			expect(cmdRoom).toBeDefined();
			expect(cmdRoom!.updates).toHaveLength(1);
			expect(cmdRoom!.updates[0].type).toBe('compaction');
			expect(cmdRoom!.updates[0].data).toBeTruthy();
		});

		it('does not inject when command room already has updates', async () => {
			const fetchSpy = jest.fn().mockResolvedValue({
				ok: true,
				text: () => Promise.resolve('ok'),
			});
			window.fetch = fetchSpy;

			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			syncConfig.createAwareness(doc);

			const body = JSON.stringify({
				rooms: [
					{
						room: 'root/wpce_commands',
						updates: [{ type: 'update', data: 'existing' }],
					},
				],
			});

			await window.fetch(
				'https://example.com/wp-json/wp-sync/v1/updates',
				{
					method: 'POST',
					body,
				}
			);

			// The body should be passed through unchanged.
			const passedBody = JSON.parse(
				fetchSpy.mock.calls[0][1].body as string
			) as {
				rooms: Array<{
					room: string;
					updates: Array<{ type: string; data: string }>;
				}>;
			};
			const cmdRoom = passedBody.rooms.find(
				(r) => r.room === 'root/wpce_commands'
			);
			expect(cmdRoom!.updates).toHaveLength(1);
			expect(cmdRoom!.updates[0].type).toBe('update');
			expect(cmdRoom!.updates[0].data).toBe('existing');
		});

		it('does not double-wrap fetch when createAwareness is called twice', async () => {
			const fetchSpy = jest.fn().mockResolvedValue({
				ok: true,
				text: () => Promise.resolve('ok'),
			});
			window.fetch = fetchSpy;

			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc1 = new MockYDoc();
			syncConfig.createAwareness(doc1);

			// Capture the wrapped fetch after the first createAwareness call.
			const wrappedFetchAfterFirst = window.fetch;

			// Call createAwareness a second time (e.g., HMR re-init).
			const doc2 = new MockYDoc();
			syncConfig.createAwareness(doc2);

			// window.fetch should not have been wrapped again.
			expect(window.fetch).toBe(wrappedFetchAfterFirst);
		});

		it('passes non-wp-sync requests through unchanged', async () => {
			const fetchSpy = jest.fn().mockResolvedValue({
				ok: true,
				text: () => Promise.resolve('ok'),
			});
			window.fetch = fetchSpy;

			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			syncConfig.createAwareness(doc);

			const body = JSON.stringify({ data: 'test' });
			await window.fetch('https://example.com/wp-json/wp/v2/posts', {
				method: 'POST',
				body,
			});

			// Should pass through without modification.
			expect(fetchSpy.mock.calls[0][1].body).toBe(body);
		});
	});

	describe('stale command cleanup', () => {
		let originalFetch: typeof window.fetch;

		beforeEach(() => {
			originalFetch = window.fetch;
		});

		afterEach(() => {
			window.fetch = originalFetch;
		});

		it('removes stale commands from the state map', async () => {
			jest.useFakeTimers();

			// Set up a no-op fetch so the interceptor doesn't fail.
			window.fetch = jest.fn().mockResolvedValue({
				ok: true,
				text: () => Promise.resolve('ok'),
			});

			// Import apiFetch and configure it to return only command 43 as active.
			const apiFetchMock =
				// eslint-disable-next-line @typescript-eslint/no-require-imports
				require('@wordpress/api-fetch') as {
					default: jest.Mock;
				};
			apiFetchMock.default.mockResolvedValue([
				{ id: 43, status: 'running' },
			]);

			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			syncConfig.createAwareness(doc);

			// Add two commands to the state map — 42 and 43.
			const stateMap = doc.getMap('state');
			stateMap.set('commands', {
				'42': { ...MOCK_COMMAND, id: 42 },
				'43': { ...MOCK_COMMAND, id: 43 },
			});

			// The cleanup polls for the doc every 200ms. Advance to trigger it.
			jest.advanceTimersByTime(200);

			// Flush the getCurrentUser and apiFetch promises.
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();

			// Command 42 should have been removed (not in API response),
			// command 43 should remain (active in API response).
			const commands = stateMap.get('commands') as Record<
				string,
				unknown
			>;
			expect(commands['42']).toBeUndefined();
			expect(commands['43']).toBeDefined();

			jest.useRealTimers();
		});

		it('preserves commands belonging to other users', async () => {
			jest.useFakeTimers();

			window.fetch = jest.fn().mockResolvedValue({
				ok: true,
				text: () => Promise.resolve('ok'),
			});

			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const apiFetchMock = require('@wordpress/api-fetch') as {
				default: jest.Mock;
			};
			// The API returns no active commands for the current user.
			apiFetchMock.default.mockResolvedValue([]);

			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			syncConfig.createAwareness(doc);

			// Add commands from two users — 42 (current user) and 43 (other user).
			const stateMap = doc.getMap('state');
			stateMap.set('commands', {
				'42': { ...MOCK_COMMAND, id: 42, user_id: 1 },
				'43': { ...MOCK_COMMAND, id: 43, user_id: 99 },
			});

			jest.advanceTimersByTime(200);

			// Flush the getCurrentUser and apiFetch promises.
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();

			// Command 42 should be removed (current user, not active).
			// Command 43 should be preserved (belongs to another user).
			const commands = stateMap.get('commands') as Record<
				string,
				unknown
			>;
			expect(commands['42']).toBeUndefined();
			expect(commands['43']).toBeDefined();

			jest.useRealTimers();
		});
	});

	describe('stale command cleanup interval management', () => {
		let originalFetch: typeof window.fetch;

		beforeEach(() => {
			originalFetch = window.fetch;
		});

		afterEach(() => {
			window.fetch = originalFetch;
		});

		it('sets up periodic cleanup interval after initial run', async () => {
			jest.useFakeTimers();
			const setIntervalSpy = jest.spyOn(global, 'setInterval');

			window.fetch = jest.fn().mockResolvedValue({
				ok: true,
				text: () => Promise.resolve('ok'),
			});

			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const apiFetchMock = require('@wordpress/api-fetch') as {
				default: jest.Mock;
			};
			apiFetchMock.default.mockResolvedValue([]);

			const mod = loadModule();
			mod.initCommandSync();

			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			syncConfig.createAwareness(doc);

			// Advance timers so the doc-wait resolves and cleanup runs.
			jest.advanceTimersByTime(200);
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();

			// A 30-second interval should have been created for periodic cleanup.
			const intervalCalls = setIntervalSpy.mock.calls.filter(
				(call) => call[1] === 30_000
			);
			expect(intervalCalls.length).toBeGreaterThanOrEqual(1);

			setIntervalSpy.mockRestore();
			jest.useRealTimers();
		});

		it('bails out if doc never initializes within timeout', async () => {
			jest.useFakeTimers();

			window.fetch = jest.fn().mockResolvedValue({
				ok: true,
				text: () => Promise.resolve('ok'),
			});

			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const apiFetchMock = require('@wordpress/api-fetch') as {
				default: jest.Mock;
			};
			apiFetchMock.default.mockResolvedValue([]);

			const mod = loadModule();
			mod.initCommandSync();

			// Do NOT call createAwareness — the doc never becomes available.

			// Advance past the 30-second timeout (150 × 200ms).
			jest.advanceTimersByTime(31_000);
			await Promise.resolve();
			await Promise.resolve();

			// apiFetch should never have been called since the doc timed out.
			expect(apiFetchMock.default).not.toHaveBeenCalled();

			jest.useRealTimers();
		});
	});

	describe('subscribeToMcpConnection (polling fallback unsubscribe)', () => {
		let originalFetch: typeof window.fetch;

		beforeEach(() => {
			originalFetch = window.fetch;
		});

		afterEach(() => {
			window.fetch = originalFetch;
		});

		it('removes awareness change handler on unsubscribe after polling attaches', () => {
			jest.useFakeTimers();

			window.fetch = jest.fn().mockResolvedValue({
				ok: true,
				text: () => Promise.resolve('ok'),
			});

			const mod = loadModule();
			mod.initCommandSync();

			// Subscribe BEFORE awareness is created — enters the polling fallback.
			const callback = jest.fn();
			const unsubscribe = mod.subscribeToMcpConnection(callback);

			// Create awareness so the polling can attach.
			const syncConfig = mockAddEntities.mock.calls[0][0][0].syncConfig;
			const doc = new MockYDoc();
			syncConfig.createAwareness(doc);

			// Advance timers so the polling interval finds awareness.
			jest.advanceTimersByTime(200);

			// The callback should have been called with initial state.
			expect(callback).toHaveBeenCalledWith(false);

			// Unsubscribe — this should call off('change', handler).
			unsubscribe();

			// Trigger a change — callback should NOT be called again.
			callback.mockClear();
			capturedAwareness!._triggerChange();
			expect(callback).not.toHaveBeenCalled();

			jest.useRealTimers();
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

		it('stops polling after timeout when doc never initializes', () => {
			jest.useFakeTimers();
			const mod = loadModule();
			// Do NOT call initCommandSync or createAwareness — the doc never exists.

			const callback = jest.fn();
			mod.subscribeToCommandSync(callback);

			// Advance past the 30-second timeout (300 retries × 100ms).
			jest.advanceTimersByTime(30_000);

			// Callback should never have been called.
			expect(callback).not.toHaveBeenCalled();

			// Advancing further should not cause errors (interval is cleared).
			jest.advanceTimersByTime(10_000);
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
