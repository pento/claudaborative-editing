import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as Y from 'yjs';
import {
	CommandClient,
	SUPPORTED_PROTOCOL_VERSIONS,
	isProtocolCompatible,
} from '../../src/wordpress/command-client.js';
import type { Command } from '../../src/wordpress/command-client.js';
import type { WordPressApiClient } from '../../src/wordpress/api-client.js';
import * as debugLogModule from '../../src/debug-log.js';

// --- Helpers ---

function createMockApiClient() {
	return {
		request: vi.fn(),
	} as unknown as WordPressApiClient & {
		request: ReturnType<typeof vi.fn>;
	};
}

function fakeCommand(overrides?: Partial<Command>): Command {
	return {
		id: 1,
		post_id: 42,
		prompt: 'proofread',
		arguments: {},
		status: 'pending',
		user_id: 1,
		claimed_by: null,
		message: null,
		created_at: '2026-01-01T00:00:00',
		updated_at: '2026-01-01T00:00:00',
		expires_at: '2026-01-01T01:00:00',
		...overrides,
	};
}

/**
 * Creates a pair of Y.Docs that simulate remote/local sync.
 * Changes on `remoteDoc` can be synced to `localDoc` via `syncToLocal()`.
 */
function createSyncedDocs() {
	const remoteDoc = new Y.Doc();
	const localDoc = new Y.Doc();

	function syncToLocal() {
		const update = Y.encodeStateAsUpdate(remoteDoc);
		Y.applyUpdate(localDoc, update);
	}

	function syncToRemote() {
		const update = Y.encodeStateAsUpdate(localDoc);
		Y.applyUpdate(remoteDoc, update);
	}

	return { remoteDoc, localDoc, syncToLocal, syncToRemote };
}

// --- Tests ---

describe('CommandClient', () => {
	let apiClient: ReturnType<typeof createMockApiClient>;
	let onCommand: ReturnType<typeof vi.fn<(command: Command) => void>>;
	let onResponse: ReturnType<typeof vi.fn<(command: Command) => void>>;
	let client: CommandClient;

	beforeEach(() => {
		apiClient = createMockApiClient();
		onCommand = vi.fn();
		onResponse = vi.fn();
		client = new CommandClient(apiClient, onCommand, onResponse);
	});

	afterEach(() => {
		client.stop();
	});

	// -------------------------------------------------------
	// Protocol version constants
	// -------------------------------------------------------

	describe('protocol version', () => {
		it('SUPPORTED_PROTOCOL_VERSIONS includes 1', () => {
			expect(SUPPORTED_PROTOCOL_VERSIONS).toContain(1);
		});

		it('isProtocolCompatible returns true for supported version', () => {
			expect(isProtocolCompatible(1)).toBe(true);
		});

		it('isProtocolCompatible returns false for unsupported version', () => {
			expect(isProtocolCompatible(99)).toBe(false);
			expect(isProtocolCompatible(0)).toBe(false);
		});
	});

	// -------------------------------------------------------
	// REST methods
	// -------------------------------------------------------

	describe('getPluginStatus()', () => {
		it('calls apiClient.request with the correct path', async () => {
			const status = {
				version: '1.0.0',
				protocol_version: 1,
				mcp_connected: true,
				mcp_last_seen_at: '2026-01-01T00:00:00',
			};
			apiClient.request.mockResolvedValue(status);

			const result = await client.getPluginStatus();

			expect(apiClient.request).toHaveBeenCalledWith('/wpce/v1/status');
			expect(result).toEqual(status);
		});
	});

	describe('updateCommandStatus()', () => {
		it('sends PATCH with status only', async () => {
			const updated = fakeCommand({ id: 3, status: 'running' });
			apiClient.request.mockResolvedValue(updated);

			const result = await client.updateCommandStatus(3, 'running');

			expect(apiClient.request).toHaveBeenCalledWith(
				'/wpce/v1/commands/3',
				{
					method: 'PATCH',
					body: JSON.stringify({ status: 'running' }),
				}
			);
			expect(result).toEqual(updated);
		});

		it('sends PATCH with status and message', async () => {
			const updated = fakeCommand({
				id: 5,
				status: 'completed',
				message: 'All done',
			});
			apiClient.request.mockResolvedValue(updated);

			const result = await client.updateCommandStatus(
				5,
				'completed',
				'All done'
			);

			expect(apiClient.request).toHaveBeenCalledWith(
				'/wpce/v1/commands/5',
				{
					method: 'PATCH',
					body: JSON.stringify({
						status: 'completed',
						message: 'All done',
					}),
				}
			);
			expect(result).toEqual(updated);
		});

		it('sends PATCH with status, message, and resultData', async () => {
			const updated = fakeCommand({ id: 6, status: 'completed' });
			apiClient.request.mockResolvedValue(updated);

			await client.updateCommandStatus(
				6,
				'completed',
				'Done',
				'{"foo":"bar"}'
			);

			expect(apiClient.request).toHaveBeenCalledWith(
				'/wpce/v1/commands/6',
				{
					method: 'PATCH',
					body: JSON.stringify({
						status: 'completed',
						message: 'Done',
						result_data: '{"foo":"bar"}',
					}),
				}
			);
		});

		it('keeps terminal commands in Y.Map for browser-side cleanup', async () => {
			const { localDoc } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			const completed = fakeCommand({ id: 7, status: 'completed' });
			apiClient.request.mockResolvedValue(completed);

			await client.updateCommandStatus(7, 'completed');

			// Terminal command should persist in the Y.Map (browser-side
			// stale cleanup handles removal after processing).
			const commands = documentMap.get('commands') as Record<
				string,
				unknown
			>;
			expect(commands['7']).toBeDefined();
			expect((commands['7'] as { status: string }).status).toBe(
				'completed'
			);
		});

		it('does not schedule removal for non-terminal statuses', async () => {
			vi.useFakeTimers();

			const { localDoc } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			const running = fakeCommand({ id: 8, status: 'running' });
			apiClient.request.mockResolvedValue(running);

			await client.updateCommandStatus(8, 'running');

			// Command should be in the Y.Map
			let commands = documentMap.get('commands') as Record<
				string,
				unknown
			>;
			expect(commands['8']).toBeDefined();

			// Even after 5s, it should still be there
			vi.advanceTimersByTime(5000);

			commands = documentMap.get('commands') as Record<string, unknown>;
			expect(commands['8']).toBeDefined();

			vi.useRealTimers();
		});

		it('keeps failed commands in Y.Map for browser-side cleanup', async () => {
			const { localDoc } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			const failed = fakeCommand({ id: 9, status: 'failed' });
			apiClient.request.mockResolvedValue(failed);

			await client.updateCommandStatus(9, 'failed', 'Something broke');

			const commands = documentMap.get('commands') as Record<
				string,
				unknown
			>;
			expect(commands['9']).toBeDefined();
			expect((commands['9'] as { status: string }).status).toBe('failed');
		});

		it('writes the updated command to the Y.Map', async () => {
			const { localDoc } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			const updated = fakeCommand({ id: 3, status: 'running' });
			apiClient.request.mockResolvedValue(updated);

			await client.updateCommandStatus(3, 'running');

			const commands = documentMap.get('commands') as Record<
				string,
				unknown
			>;
			expect(commands).toBeDefined();
			expect(commands['3']).toBeDefined();
			expect((commands['3'] as Record<string, unknown>).status).toBe(
				'running'
			);
		});

		it('does not write to Y.Map when not observing', async () => {
			// Client is not observing any map, so updateCommandStatus
			// should still succeed (REST call) without crashing.
			const updated = fakeCommand({ id: 3, status: 'running' });
			apiClient.request.mockResolvedValue(updated);

			const result = await client.updateCommandStatus(3, 'running');
			expect(result).toEqual(updated);
		});
	});

	// -------------------------------------------------------
	// startObserving
	// -------------------------------------------------------

	describe('startObserving()', () => {
		it('sets transport to yjs', () => {
			const { localDoc } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');

			expect(client.getTransport()).toBe('none');

			client.startObserving(documentMap);

			expect(client.getTransport()).toBe('yjs');
		});

		it('processes commands already in the map on start', () => {
			const { remoteDoc, localDoc, syncToLocal } = createSyncedDocs();

			// Write a pending command to the remote doc before observing
			const remoteMap = remoteDoc.getMap('document');
			remoteMap.set('commands', {
				'10': fakeCommand({ id: 10, status: 'pending' }),
			});
			syncToLocal();

			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			expect(onCommand).toHaveBeenCalledOnce();
			expect(onCommand).toHaveBeenCalledWith(
				expect.objectContaining({ id: 10, status: 'pending' })
			);
		});
	});

	// -------------------------------------------------------
	// stop
	// -------------------------------------------------------

	describe('stop()', () => {
		it('sets transport back to none', () => {
			const { localDoc } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');

			client.startObserving(documentMap);
			expect(client.getTransport()).toBe('yjs');

			client.stop();
			expect(client.getTransport()).toBe('none');
		});

		it('unobserves the Y.Map so future changes do not trigger callbacks', () => {
			const { remoteDoc, localDoc, syncToLocal } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			client.stop();

			// Write a command after stop
			const remoteMap = remoteDoc.getMap('document');
			remoteMap.set('commands', {
				'20': fakeCommand({ id: 20, status: 'pending' }),
			});
			syncToLocal();

			expect(onCommand).not.toHaveBeenCalled();
		});

		it('clears tracked pending IDs so re-observing detects them again', () => {
			const { remoteDoc, localDoc, syncToLocal } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');

			// Write a command and observe
			const remoteMap = remoteDoc.getMap('document');
			remoteMap.set('commands', {
				'30': fakeCommand({ id: 30, status: 'pending' }),
			});
			syncToLocal();

			client.startObserving(documentMap);
			expect(onCommand).toHaveBeenCalledOnce();
			onCommand.mockClear();

			// Stop and re-observe — the same command should be detected again
			client.stop();
			client.startObserving(documentMap);
			expect(onCommand).toHaveBeenCalledOnce();
		});

		it('is safe to call without startObserving', () => {
			expect(() => {
				client.stop();
			}).not.toThrow();
		});

		it('is safe to call multiple times', () => {
			const { localDoc } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			expect(() => {
				client.stop();
				client.stop();
			}).not.toThrow();
		});
	});

	// -------------------------------------------------------
	// New pending command detection
	// -------------------------------------------------------

	describe('new pending command detection', () => {
		it('calls onCommand when a pending command arrives via remote sync', () => {
			const { remoteDoc, localDoc, syncToLocal } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			// Remote browser writes a pending command
			const remoteMap = remoteDoc.getMap('document');
			remoteMap.set('commands', {
				'50': fakeCommand({
					id: 50,
					status: 'pending',
					prompt: 'review',
				}),
			});
			syncToLocal();

			expect(onCommand).toHaveBeenCalledOnce();
			expect(onCommand).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 50,
					status: 'pending',
					prompt: 'review',
				})
			);
		});

		it('calls onCommand for each new pending command', () => {
			const { remoteDoc, localDoc, syncToLocal } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			const remoteMap = remoteDoc.getMap('document');
			remoteMap.set('commands', {
				'51': fakeCommand({ id: 51, status: 'pending' }),
				'52': fakeCommand({ id: 52, status: 'pending' }),
			});
			syncToLocal();

			expect(onCommand).toHaveBeenCalledTimes(2);
		});

		it('does not call onCommand for non-pending commands', () => {
			const { remoteDoc, localDoc, syncToLocal } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			const remoteMap = remoteDoc.getMap('document');
			remoteMap.set('commands', {
				'60': fakeCommand({ id: 60, status: 'running' }),
			});
			syncToLocal();

			expect(onCommand).not.toHaveBeenCalled();
		});

		it('does not call onCommand for local transactions', () => {
			const { localDoc } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			// Local write (e.g., status update written by MCP server)
			documentMap.set('commands', {
				'70': fakeCommand({ id: 70, status: 'pending' }),
			});

			// The initial processAllCommands in startObserving would
			// have seen the empty map, so onCommand should only be
			// called if the observer fires — and local transactions
			// should be skipped.
			// Note: the observer skips local transactions, but the
			// local set above happens AFTER startObserving, so the
			// observer fires but skips it.
			// However, no pending command was in the map at startObserving
			// time, so onCommand should not have been called at all initially.
			expect(onCommand).not.toHaveBeenCalled();
		});

		it('skips commands with no id', () => {
			const { remoteDoc, localDoc, syncToLocal } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			const remoteMap = remoteDoc.getMap('document');
			remoteMap.set('commands', {
				bad: { status: 'pending', prompt: 'proofread' },
			});
			syncToLocal();

			expect(onCommand).not.toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------
	// Duplicate pending command detection
	// -------------------------------------------------------

	describe('duplicate pending command detection', () => {
		it('does not call onCommand twice for the same pending command', () => {
			const { remoteDoc, localDoc, syncToLocal } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			const remoteMap = remoteDoc.getMap('document');
			const cmd = fakeCommand({ id: 80, status: 'pending' });

			// First sync
			remoteMap.set('commands', { '80': cmd });
			syncToLocal();
			expect(onCommand).toHaveBeenCalledOnce();

			onCommand.mockClear();

			// Second sync with same command (e.g., another field in the map changes)
			remoteMap.set('commands', { '80': cmd });
			syncToLocal();
			expect(onCommand).not.toHaveBeenCalled();
		});

		it('does not re-notify pending commands already seen during initial sync', () => {
			const { remoteDoc, localDoc, syncToLocal } = createSyncedDocs();

			// Pre-populate
			const remoteMap = remoteDoc.getMap('document');
			remoteMap.set('commands', {
				'81': fakeCommand({ id: 81, status: 'pending' }),
			});
			syncToLocal();

			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);
			expect(onCommand).toHaveBeenCalledOnce();
			onCommand.mockClear();

			// Sync again with same data — should not re-notify
			remoteMap.set('commands', {
				'81': fakeCommand({ id: 81, status: 'pending' }),
			});
			syncToLocal();
			expect(onCommand).not.toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------
	// Tracking state pruning
	// -------------------------------------------------------

	describe('tracking state pruning', () => {
		it('prunes notifiedPendingIds when command is removed from Y.Map', () => {
			const { remoteDoc, localDoc, syncToLocal } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			const remoteMap = remoteDoc.getMap('document');

			// Add a pending command — it gets tracked in notifiedPendingIds.
			remoteMap.set('commands', {
				'90': fakeCommand({ id: 90, status: 'pending' }),
			});
			syncToLocal();
			expect(onCommand).toHaveBeenCalledOnce();
			onCommand.mockClear();

			// Remove the command from the Y.Map (simulates terminal cleanup).
			remoteMap.set('commands', {});
			syncToLocal();

			// Re-add the same command — should be notified again because
			// the pruning cleared the tracked ID.
			remoteMap.set('commands', {
				'90': fakeCommand({ id: 90, status: 'pending' }),
			});
			syncToLocal();
			expect(onCommand).toHaveBeenCalledOnce();
		});

		it('prunes lastSeenUserMsgCounts when command is removed from Y.Map', () => {
			const { remoteDoc, localDoc, syncToLocal } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			const remoteMap = remoteDoc.getMap('document');

			// Add a running command with user messages — gets tracked.
			const cmd = fakeCommand({
				id: 91,
				status: 'running',
				result_data: {
					messages: [
						{ role: 'assistant', content: 'hi' },
						{ role: 'user', content: 'hello' },
					],
				},
			});
			remoteMap.set('commands', { '91': cmd });
			syncToLocal();
			expect(onResponse).toHaveBeenCalledOnce();
			onResponse.mockClear();

			// Remove the command.
			remoteMap.set('commands', {});
			syncToLocal();

			// Re-add with same message count — should trigger onResponse
			// again because the pruning cleared the tracked count.
			remoteMap.set('commands', { '91': cmd });
			syncToLocal();
			expect(onResponse).toHaveBeenCalledOnce();
		});
	});

	// -------------------------------------------------------
	// Initial scan priming (initialScanComplete guard)
	// -------------------------------------------------------

	describe('initial scan priming', () => {
		it('does not call onResponse for running commands with messages already in the map', () => {
			const { remoteDoc, localDoc, syncToLocal } = createSyncedDocs();

			// Pre-populate a running command with user messages BEFORE observing
			const remoteMap = remoteDoc.getMap('document');
			remoteMap.set('commands', {
				'200': fakeCommand({
					id: 200,
					status: 'running',
					result_data: {
						messages: [
							{ role: 'user', content: 'Do something' },
							{ role: 'assistant', content: 'Working on it' },
						],
					},
				}),
			});
			syncToLocal();

			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			// onResponse should NOT be called — counts are primed during initial scan
			expect(onResponse).not.toHaveBeenCalled();
		});

		it('calls onResponse for new messages arriving after initial scan', () => {
			const { remoteDoc, localDoc, syncToLocal } = createSyncedDocs();

			// Pre-populate a running command with one user message
			const remoteMap = remoteDoc.getMap('document');
			remoteMap.set('commands', {
				'201': fakeCommand({
					id: 201,
					status: 'running',
					result_data: {
						messages: [
							{ role: 'user', content: 'First message' },
							{ role: 'assistant', content: 'Got it' },
						],
					},
				}),
			});
			syncToLocal();

			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);
			expect(onResponse).not.toHaveBeenCalled();

			// Now a NEW user message arrives via remote sync
			remoteMap.set('commands', {
				'201': fakeCommand({
					id: 201,
					status: 'running',
					result_data: {
						messages: [
							{ role: 'user', content: 'First message' },
							{ role: 'assistant', content: 'Got it' },
							{ role: 'user', content: 'Second message' },
						],
					},
				}),
			});
			syncToLocal();

			expect(onResponse).toHaveBeenCalledOnce();
			expect(onResponse).toHaveBeenCalledWith(
				expect.objectContaining({ id: 201, status: 'running' })
			);
		});

		it('primes counts for multiple running commands during initial scan', () => {
			const { remoteDoc, localDoc, syncToLocal } = createSyncedDocs();

			// Pre-populate multiple running commands with messages
			const remoteMap = remoteDoc.getMap('document');
			remoteMap.set('commands', {
				'202': fakeCommand({
					id: 202,
					status: 'running',
					result_data: {
						messages: [{ role: 'user', content: 'Message A' }],
					},
				}),
				'203': fakeCommand({
					id: 203,
					status: 'running',
					result_data: {
						messages: [
							{ role: 'user', content: 'Message B' },
							{ role: 'user', content: 'Message C' },
						],
					},
				}),
			});
			syncToLocal();

			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			// Neither command should trigger onResponse
			expect(onResponse).not.toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------
	// Response detection
	// -------------------------------------------------------

	describe('response detection', () => {
		it('calls onResponse when a running command gets new user messages', () => {
			const { remoteDoc, localDoc, syncToLocal } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			const remoteMap = remoteDoc.getMap('document');

			// First: command arrives as running (claimed by MCP)
			remoteMap.set('commands', {
				'90': fakeCommand({
					id: 90,
					status: 'running',
					result_data: {
						messages: [
							{ role: 'assistant', content: 'Working on it...' },
						],
					},
				}),
			});
			syncToLocal();
			expect(onResponse).not.toHaveBeenCalled();

			// User sends a message
			remoteMap.set('commands', {
				'90': fakeCommand({
					id: 90,
					status: 'running',
					result_data: {
						messages: [
							{ role: 'assistant', content: 'Working on it...' },
							{
								role: 'user',
								content: 'Please also fix paragraph 3',
							},
						],
					},
				}),
			});
			syncToLocal();
			expect(onResponse).toHaveBeenCalledOnce();
			expect(onResponse).toHaveBeenCalledWith(
				expect.objectContaining({
					id: 90,
					status: 'running',
				})
			);
		});

		it('does not call onResponse when user message count has not changed', () => {
			const { remoteDoc, localDoc, syncToLocal } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			const remoteMap = remoteDoc.getMap('document');

			const cmdData = {
				'91': fakeCommand({
					id: 91,
					status: 'running',
					result_data: {
						messages: [
							{ role: 'user', content: 'Fix this' },
							{ role: 'assistant', content: 'Done.' },
						],
					},
				}),
			};

			remoteMap.set('commands', cmdData);
			syncToLocal();
			expect(onResponse).toHaveBeenCalledOnce();
			onResponse.mockClear();

			// Sync again with same message count — no new notification
			remoteMap.set('commands', {
				'91': fakeCommand({
					id: 91,
					status: 'running',
					result_data: {
						messages: [
							{ role: 'user', content: 'Fix this' },
							{ role: 'assistant', content: 'Done, updated.' },
						],
					},
				}),
			});
			syncToLocal();
			expect(onResponse).not.toHaveBeenCalled();
		});

		it('does not call onResponse for non-running commands', () => {
			const { remoteDoc, localDoc, syncToLocal } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			const remoteMap = remoteDoc.getMap('document');

			// Completed command with messages — should not trigger response
			remoteMap.set('commands', {
				'92': fakeCommand({
					id: 92,
					status: 'completed',
					result_data: {
						messages: [{ role: 'user', content: 'Thanks' }],
					},
				}),
			});
			syncToLocal();
			expect(onResponse).not.toHaveBeenCalled();
		});

		it('does not call onResponse for running command without messages', () => {
			const { remoteDoc, localDoc, syncToLocal } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			const remoteMap = remoteDoc.getMap('document');

			remoteMap.set('commands', {
				'93': fakeCommand({
					id: 93,
					status: 'running',
					result_data: { some_other_field: true },
				}),
			});
			syncToLocal();
			expect(onResponse).not.toHaveBeenCalled();
		});

		it('calls onResponse again when additional user messages arrive', () => {
			const { remoteDoc, localDoc, syncToLocal } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			const remoteMap = remoteDoc.getMap('document');

			// First user message
			remoteMap.set('commands', {
				'94': fakeCommand({
					id: 94,
					status: 'running',
					result_data: {
						messages: [{ role: 'user', content: 'First question' }],
					},
				}),
			});
			syncToLocal();
			expect(onResponse).toHaveBeenCalledOnce();
			onResponse.mockClear();

			// Second user message
			remoteMap.set('commands', {
				'94': fakeCommand({
					id: 94,
					status: 'running',
					result_data: {
						messages: [
							{ role: 'user', content: 'First question' },
							{ role: 'assistant', content: 'Answer.' },
							{ role: 'user', content: 'Follow-up question' },
						],
					},
				}),
			});
			syncToLocal();
			expect(onResponse).toHaveBeenCalledOnce();
		});
	});

	// -------------------------------------------------------
	// writeCommandToDoc
	// -------------------------------------------------------

	describe('writeCommandToDoc()', () => {
		it('sets the command under the commands key in the Y.Map', () => {
			const { localDoc } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			const cmd = fakeCommand({ id: 100, status: 'running' });
			client.writeCommandToDoc(cmd);

			const commands = documentMap.get('commands') as Record<
				string,
				unknown
			>;
			expect(commands).toBeDefined();
			expect(commands['100']).toBeDefined();
			expect((commands['100'] as Command).id).toBe(100);
			expect((commands['100'] as Command).status).toBe('running');
		});

		it('uses LOCAL_ORIGIN so updates are queued for sync', () => {
			const { localDoc } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			const origins: unknown[] = [];
			localDoc.on('updateV2', (_update: Uint8Array, origin: unknown) => {
				origins.push(origin);
			});

			client.writeCommandToDoc(
				fakeCommand({ id: 104, status: 'running' })
			);

			expect(origins).toContain('local');
		});

		it('preserves existing commands when writing a new one', () => {
			const { localDoc } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			client.writeCommandToDoc(
				fakeCommand({ id: 101, status: 'pending' })
			);
			client.writeCommandToDoc(
				fakeCommand({ id: 102, status: 'running' })
			);

			const commands = documentMap.get('commands') as Record<
				string,
				unknown
			>;
			expect(commands['101']).toBeDefined();
			expect(commands['102']).toBeDefined();
		});

		it('is a no-op when not observing', () => {
			// No startObserving called
			expect(() => {
				client.writeCommandToDoc(fakeCommand({ id: 103 }));
			}).not.toThrow();
		});
	});

	// -------------------------------------------------------
	// removeCommandFromDoc
	// -------------------------------------------------------

	describe('removeCommandFromDoc()', () => {
		it('removes a command from the commands key in the Y.Map', () => {
			const { localDoc } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			client.writeCommandToDoc(
				fakeCommand({ id: 110, status: 'completed' })
			);
			client.writeCommandToDoc(
				fakeCommand({ id: 111, status: 'running' })
			);

			client.removeCommandFromDoc(110);

			const commands = documentMap.get('commands') as Record<
				string,
				unknown
			>;
			expect(commands['110']).toBeUndefined();
			expect(commands['111']).toBeDefined();
		});

		it('uses LOCAL_ORIGIN so updates are queued for sync', () => {
			const { localDoc } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			// Write a command first
			client.writeCommandToDoc(
				fakeCommand({ id: 112, status: 'completed' })
			);

			const origins: unknown[] = [];
			localDoc.on('updateV2', (_update: Uint8Array, origin: unknown) => {
				origins.push(origin);
			});

			client.removeCommandFromDoc(112);

			expect(origins).toContain('local');
		});

		it('is a no-op when the command does not exist', () => {
			const { localDoc } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			expect(() => {
				client.removeCommandFromDoc(999);
			}).not.toThrow();
		});

		it('is a no-op when not observing', () => {
			expect(() => {
				client.removeCommandFromDoc(999);
			}).not.toThrow();
		});
	});

	// -------------------------------------------------------
	// getTransport
	// -------------------------------------------------------

	describe('getTransport()', () => {
		it('returns none before observing', () => {
			expect(client.getTransport()).toBe('none');
		});

		it('returns yjs while observing', () => {
			const { localDoc } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			expect(client.getTransport()).toBe('yjs');
		});

		it('returns none after stop', () => {
			const { localDoc } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);
			client.stop();

			expect(client.getTransport()).toBe('none');
		});
	});

	// -------------------------------------------------------
	// Debug logging branches
	// -------------------------------------------------------

	describe('debug logging when enabled', () => {
		let debugSpy: ReturnType<typeof vi.fn>;

		beforeEach(() => {
			vi.spyOn(debugLogModule, 'isDebugEnabled').mockReturnValue(true);
			debugSpy = vi
				.spyOn(debugLogModule, 'debugLog')
				.mockImplementation(() => {}) as unknown as ReturnType<
				typeof vi.fn
			>;
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		it('logs in startObserving when debug is enabled', () => {
			const { localDoc } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			expect(debugSpy).toHaveBeenCalledWith(
				'cmd-client',
				'startObserving, map size:',
				expect.any(Number),
				'keys:',
				expect.any(Array)
			);
		});

		it('logs Y.Map change events when debug is enabled', () => {
			const { remoteDoc, localDoc, syncToLocal } = createSyncedDocs();
			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);
			debugSpy.mockClear();

			const remoteMap = remoteDoc.getMap('document');
			remoteMap.set('commands', {
				'300': fakeCommand({ id: 300, status: 'pending' }),
			});
			syncToLocal();

			expect(debugSpy).toHaveBeenCalledWith(
				'cmd-client',
				'Y.Map change event, local:',
				expect.any(Boolean),
				'changed keys:',
				expect.any(Array)
			);
		});

		it('logs processAllCommands details when debug is enabled', () => {
			const { remoteDoc, localDoc, syncToLocal } = createSyncedDocs();
			const remoteMap = remoteDoc.getMap('document');
			remoteMap.set('commands', {
				'301': fakeCommand({ id: 301, status: 'pending' }),
			});
			syncToLocal();

			const documentMap = localDoc.getMap('document');
			client.startObserving(documentMap);

			expect(debugSpy).toHaveBeenCalledWith(
				'cmd-client',
				'processAllCommands, raw type:',
				'object',
				'value:',
				expect.any(String)
			);
			expect(debugSpy).toHaveBeenCalledWith(
				'cmd-client',
				'Found',
				1,
				'commands:',
				['301']
			);
		});
	});
});
