import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SyncClient } from '../../src/wordpress/sync-client.js';
import type { SyncCallbacks, RoomCallbacks } from '../../src/wordpress/sync-client.js';
import type { WordPressApiClient } from '../../src/wordpress/api-client.js';
import {
  SyncUpdateType,
  DEFAULT_SYNC_CONFIG,
} from '../../src/wordpress/types.js';
import type {
  SyncPayload,
  SyncResponse,
  SyncUpdate,
  SyncClientConfig,
  AwarenessState,
} from '../../src/wordpress/types.js';

function createMockApiClient() {
  return {
    sendSyncUpdate: vi.fn<(payload: SyncPayload) => Promise<SyncResponse>>(),
  } as unknown as WordPressApiClient & { sendSyncUpdate: ReturnType<typeof vi.fn> };
}

function createMockCallbacks(overrides?: Partial<SyncCallbacks>): SyncCallbacks {
  return {
    onUpdate: vi.fn<(update: SyncUpdate) => SyncUpdate | null>().mockReturnValue(null),
    onAwareness: vi.fn<(state: AwarenessState) => void>(),
    onStatusChange: vi.fn<(status: string) => void>(),
    onCompactionRequested: vi.fn<() => SyncUpdate>().mockReturnValue({
      type: SyncUpdateType.COMPACTION,
      data: 'compacted-data',
    }),
    getAwarenessState: vi.fn().mockReturnValue({ cursor: { x: 0, y: 0 } }),
    ...overrides,
  };
}

function createMockRoomCallbacks(overrides?: Partial<RoomCallbacks>): RoomCallbacks {
  return {
    onUpdate: vi.fn<(update: SyncUpdate) => SyncUpdate | null>().mockReturnValue(null),
    onAwareness: vi.fn<(state: AwarenessState) => void>(),
    onCompactionRequested: vi.fn<() => SyncUpdate>().mockReturnValue({
      type: SyncUpdateType.COMPACTION,
      data: 'compacted-data',
    }),
    getAwarenessState: vi.fn().mockReturnValue(null),
    ...overrides,
  };
}

function emptyRoomResponse(
  room: string,
  endCursor: number,
  awareness: AwarenessState = {},
  updates: SyncUpdate[] = [],
  shouldCompact = false,
): SyncResponse {
  return {
    rooms: [
      {
        room,
        end_cursor: endCursor,
        awareness,
        updates,
        should_compact: shouldCompact,
      },
    ],
  };
}

function multiRoomResponse(
  roomEntries: Array<{
    room: string;
    end_cursor: number;
    awareness?: AwarenessState;
    updates?: SyncUpdate[];
    should_compact?: boolean;
  }>,
): SyncResponse {
  return {
    rooms: roomEntries.map((entry) => ({
      room: entry.room,
      end_cursor: entry.end_cursor,
      awareness: entry.awareness ?? {},
      updates: entry.updates ?? [],
      should_compact: entry.should_compact ?? false,
    })),
  };
}

describe('SyncClient', () => {
  let apiClient: ReturnType<typeof createMockApiClient>;
  let config: SyncClientConfig;
  let syncClient: SyncClient;

  beforeEach(() => {
    vi.useFakeTimers();
    apiClient = createMockApiClient();
    config = { ...DEFAULT_SYNC_CONFIG };
    syncClient = new SyncClient(apiClient, config);
  });

  afterEach(() => {
    syncClient.stop();
    vi.useRealTimers();
  });

  describe('start()', () => {
    it('begins polling immediately', async () => {
      apiClient.sendSyncUpdate.mockResolvedValue(emptyRoomResponse('postType/post:1', 0));
      const callbacks = createMockCallbacks();

      syncClient.start('postType/post:1', 100, [], callbacks);
      expect(callbacks.onStatusChange).toHaveBeenCalledWith('connecting');

      // First poll fires at setTimeout(0)
      await vi.advanceTimersByTimeAsync(0);

      expect(apiClient.sendSyncUpdate).toHaveBeenCalledTimes(1);
      expect(callbacks.onStatusChange).toHaveBeenCalledWith('connected');
    });

    it('sends initial updates in first poll', async () => {
      apiClient.sendSyncUpdate.mockResolvedValue(emptyRoomResponse('postType/post:1', 1));
      const callbacks = createMockCallbacks();
      const initialUpdates: SyncUpdate[] = [
        { type: SyncUpdateType.SYNC_STEP_1, data: 'sync-data' },
      ];

      syncClient.start('postType/post:1', 100, initialUpdates, callbacks);
      await vi.advanceTimersByTimeAsync(0);

      const payload = apiClient.sendSyncUpdate.mock.calls[0][0] as SyncPayload;
      expect(payload.rooms[0].updates).toEqual(initialUpdates);
      expect(payload.rooms[0].room).toBe('postType/post:1');
      expect(payload.rooms[0].client_id).toBe(100);
      expect(payload.rooms[0].after).toBe(0);
    });
  });

  describe('stop()', () => {
    it('clears timer and sets status to disconnected', async () => {
      apiClient.sendSyncUpdate.mockResolvedValue(emptyRoomResponse('postType/post:1', 0));
      const callbacks = createMockCallbacks();

      syncClient.start('postType/post:1', 100, [], callbacks);
      await vi.advanceTimersByTimeAsync(0);

      syncClient.stop();

      expect(callbacks.onStatusChange).toHaveBeenCalledWith('disconnected');
      expect(syncClient.getStatus().isPolling).toBe(false);

      // Ensure no more polls happen
      apiClient.sendSyncUpdate.mockClear();
      await vi.advanceTimersByTimeAsync(5000);
      expect(apiClient.sendSyncUpdate).not.toHaveBeenCalled();
    });
  });

  describe('poll payload', () => {
    it('sends correct room, client_id, after, and awareness', async () => {
      apiClient.sendSyncUpdate.mockResolvedValue(emptyRoomResponse('postType/post:42', 5));
      const awarenessState = { cursor: { x: 10, y: 20 } };
      const callbacks = createMockCallbacks({
        getAwarenessState: vi.fn().mockReturnValue(awarenessState),
      });

      syncClient.start('postType/post:42', 200, [], callbacks);
      await vi.advanceTimersByTimeAsync(0);

      const payload = apiClient.sendSyncUpdate.mock.calls[0][0] as SyncPayload;
      expect(payload.rooms).toHaveLength(1);
      expect(payload.rooms[0]).toEqual({
        room: 'postType/post:42',
        client_id: 200,
        after: 0,
        awareness: awarenessState,
        updates: [],
      });
    });

    it('uses updated end_cursor in subsequent polls', async () => {
      apiClient.sendSyncUpdate
        .mockResolvedValueOnce(emptyRoomResponse('postType/post:1', 10))
        .mockResolvedValueOnce(emptyRoomResponse('postType/post:1', 20));

      const callbacks = createMockCallbacks();
      syncClient.start('postType/post:1', 100, [], callbacks);

      // First poll
      await vi.advanceTimersByTimeAsync(0);
      expect((apiClient.sendSyncUpdate.mock.calls[0][0] as SyncPayload).rooms[0].after).toBe(0);

      // Second poll
      await vi.advanceTimersByTimeAsync(config.pollingInterval);
      expect((apiClient.sendSyncUpdate.mock.calls[1][0] as SyncPayload).rooms[0].after).toBe(10);
    });
  });

  describe('response processing', () => {
    it('updates end_cursor from response', async () => {
      apiClient.sendSyncUpdate.mockResolvedValue(emptyRoomResponse('postType/post:1', 42));
      const callbacks = createMockCallbacks();

      syncClient.start('postType/post:1', 100, [], callbacks);
      await vi.advanceTimersByTimeAsync(0);

      expect(syncClient.getStatus().endCursor).toBe(42);
    });

    it('calls onAwareness with awareness state', async () => {
      const awareness: AwarenessState = { '200': { cursor: { x: 1, y: 2 } } };
      apiClient.sendSyncUpdate.mockResolvedValue(
        emptyRoomResponse('postType/post:1', 0, awareness),
      );
      const callbacks = createMockCallbacks();

      syncClient.start('postType/post:1', 100, [], callbacks);
      await vi.advanceTimersByTimeAsync(0);

      expect(callbacks.onAwareness).toHaveBeenCalledWith(awareness);
    });

    it('calls onUpdate for each incoming update', async () => {
      const updates: SyncUpdate[] = [
        { type: SyncUpdateType.SYNC_STEP_1, data: 'data1' },
        { type: SyncUpdateType.UPDATE, data: 'data2' },
      ];
      apiClient.sendSyncUpdate.mockResolvedValue(
        emptyRoomResponse('postType/post:1', 0, {}, updates),
      );
      const callbacks = createMockCallbacks();

      syncClient.start('postType/post:1', 100, [], callbacks);
      await vi.advanceTimersByTimeAsync(0);

      expect(callbacks.onUpdate).toHaveBeenCalledTimes(2);
      expect(callbacks.onUpdate).toHaveBeenCalledWith(updates[0]);
      expect(callbacks.onUpdate).toHaveBeenCalledWith(updates[1]);
    });

    it('queues reply from onUpdate callback', async () => {
      const serverUpdate: SyncUpdate = { type: SyncUpdateType.SYNC_STEP_1, data: 'sync1' };
      const replyUpdate: SyncUpdate = { type: SyncUpdateType.SYNC_STEP_2, data: 'sync2' };

      apiClient.sendSyncUpdate
        .mockResolvedValueOnce(emptyRoomResponse('postType/post:1', 1, {}, [serverUpdate]))
        .mockResolvedValueOnce(emptyRoomResponse('postType/post:1', 2));

      const callbacks = createMockCallbacks({
        onUpdate: vi.fn<(u: SyncUpdate) => SyncUpdate | null>().mockReturnValue(replyUpdate),
      });

      syncClient.start('postType/post:1', 100, [], callbacks);
      await vi.advanceTimersByTimeAsync(0);

      // The reply should be queued and sent in next poll
      await vi.advanceTimersByTimeAsync(config.pollingInterval);

      const secondPayload = apiClient.sendSyncUpdate.mock.calls[1][0] as SyncPayload;
      expect(secondPayload.rooms[0].updates).toContainEqual(replyUpdate);
    });
  });

  describe('collaborator detection', () => {
    it('detects collaborators from awareness and increases poll frequency', async () => {
      // First poll: no collaborators
      apiClient.sendSyncUpdate
        .mockResolvedValueOnce(emptyRoomResponse('postType/post:1', 1, { '100': { cursor: null } }))
        // Second poll: collaborator appears
        .mockResolvedValueOnce(
          emptyRoomResponse('postType/post:1', 2, {
            '100': { cursor: null },
            '200': { cursor: { x: 1, y: 1 } },
          }),
        )
        .mockResolvedValue(emptyRoomResponse('postType/post:1', 3, {
          '100': { cursor: null },
          '200': { cursor: { x: 1, y: 1 } },
        }));

      const callbacks = createMockCallbacks();
      syncClient.start('postType/post:1', 100, [], callbacks);

      // First poll — solo
      await vi.advanceTimersByTimeAsync(0);
      expect(syncClient.getStatus().hasCollaborators).toBe(false);

      // Second poll — collaborator detected
      await vi.advanceTimersByTimeAsync(config.pollingInterval);
      expect(syncClient.getStatus().hasCollaborators).toBe(true);

      // Third poll should happen at faster interval
      apiClient.sendSyncUpdate.mockClear();
      await vi.advanceTimersByTimeAsync(config.pollingIntervalWithCollaborators);
      expect(apiClient.sendSyncUpdate).toHaveBeenCalledTimes(1);
    });

    it('does not count own clientId as collaborator', async () => {
      apiClient.sendSyncUpdate.mockResolvedValue(
        emptyRoomResponse('postType/post:1', 1, { '100': { cursor: { x: 0, y: 0 } } }),
      );
      const callbacks = createMockCallbacks();

      syncClient.start('postType/post:1', 100, [], callbacks);
      await vi.advanceTimersByTimeAsync(0);

      expect(syncClient.getStatus().hasCollaborators).toBe(false);
    });

    it('does not count null awareness entries as collaborators', async () => {
      apiClient.sendSyncUpdate.mockResolvedValue(
        emptyRoomResponse('postType/post:1', 1, { '100': { cursor: null }, '200': null }),
      );
      const callbacks = createMockCallbacks();

      syncClient.start('postType/post:1', 100, [], callbacks);
      await vi.advanceTimersByTimeAsync(0);

      expect(syncClient.getStatus().hasCollaborators).toBe(false);
    });
  });

  describe('error handling', () => {
    it('triggers exponential backoff on error', async () => {
      apiClient.sendSyncUpdate
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue(emptyRoomResponse('postType/post:1', 0));

      const callbacks = createMockCallbacks();
      syncClient.start('postType/post:1', 100, [], callbacks);

      // First poll fails
      await vi.advanceTimersByTimeAsync(0);
      expect(callbacks.onStatusChange).toHaveBeenCalledWith('error');

      // Backoff: initial interval * 2 = 2000ms
      apiClient.sendSyncUpdate.mockClear();
      await vi.advanceTimersByTimeAsync(1999);
      expect(apiClient.sendSyncUpdate).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(apiClient.sendSyncUpdate).toHaveBeenCalledTimes(1);

      // Second failure: backoff doubles to 4000ms
      apiClient.sendSyncUpdate.mockClear();
      await vi.advanceTimersByTimeAsync(3999);
      expect(apiClient.sendSyncUpdate).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(apiClient.sendSyncUpdate).toHaveBeenCalledTimes(1);
    });

    it('caps backoff at maxErrorBackoff', async () => {
      const shortConfig: SyncClientConfig = {
        pollingInterval: 100,
        pollingIntervalWithCollaborators: 50,
        maxErrorBackoff: 500,
      };
      const client = new SyncClient(apiClient, shortConfig);

      apiClient.sendSyncUpdate
        .mockRejectedValueOnce(new Error('err')) // backoff: 200
        .mockRejectedValueOnce(new Error('err')) // backoff: 400
        .mockRejectedValueOnce(new Error('err')) // backoff: 500 (capped)
        .mockRejectedValueOnce(new Error('err')) // backoff: 500 (still capped)
        .mockResolvedValue(emptyRoomResponse('postType/post:1', 0));

      const callbacks = createMockCallbacks();
      client.start('postType/post:1', 100, [], callbacks);

      // First poll fails
      await vi.advanceTimersByTimeAsync(0);

      // After 3 failures the backoff should be at the cap
      await vi.advanceTimersByTimeAsync(200); // 2nd poll
      await vi.advanceTimersByTimeAsync(400); // 3rd poll

      // 4th poll should happen at 500ms (capped), not 800ms
      apiClient.sendSyncUpdate.mockClear();
      await vi.advanceTimersByTimeAsync(500);
      expect(apiClient.sendSyncUpdate).toHaveBeenCalledTimes(1);

      client.stop();
    });

    it('restores failed updates to front of queue (excluding compaction)', async () => {
      const update1: SyncUpdate = { type: SyncUpdateType.UPDATE, data: 'u1' };
      const compaction: SyncUpdate = { type: SyncUpdateType.COMPACTION, data: 'c1' };

      apiClient.sendSyncUpdate
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue(emptyRoomResponse('postType/post:1', 1));

      const callbacks = createMockCallbacks();
      syncClient.start('postType/post:1', 100, [update1, compaction], callbacks);

      // First poll drains queue and fails
      await vi.advanceTimersByTimeAsync(0);

      // Check queue: compaction should be excluded, update1 should be restored
      expect(syncClient.getStatus().queueSize).toBe(1);

      // Next poll should send the restored update
      await vi.advanceTimersByTimeAsync(config.pollingInterval * 2);
      const payload = apiClient.sendSyncUpdate.mock.calls[1][0] as SyncPayload;
      expect(payload.rooms[0].updates).toContainEqual(update1);
      expect(payload.rooms[0].updates).not.toContainEqual(compaction);
    });

    it('resets backoff on successful poll', async () => {
      apiClient.sendSyncUpdate
        .mockRejectedValueOnce(new Error('err'))
        .mockResolvedValueOnce(emptyRoomResponse('postType/post:1', 1))
        .mockResolvedValue(emptyRoomResponse('postType/post:1', 2));

      const callbacks = createMockCallbacks();
      syncClient.start('postType/post:1', 100, [], callbacks);

      // First poll fails — backoff to 2000ms
      await vi.advanceTimersByTimeAsync(0);

      // Second poll succeeds
      await vi.advanceTimersByTimeAsync(2000);

      // Third poll should happen at normal interval (1000ms), not backoff
      apiClient.sendSyncUpdate.mockClear();
      await vi.advanceTimersByTimeAsync(config.pollingInterval);
      expect(apiClient.sendSyncUpdate).toHaveBeenCalledTimes(1);
    });
  });

  describe('compaction', () => {
    it('calls onCompactionRequested when should_compact is true', async () => {
      apiClient.sendSyncUpdate
        .mockResolvedValueOnce(emptyRoomResponse('postType/post:1', 1, {}, [], true))
        .mockResolvedValue(emptyRoomResponse('postType/post:1', 2));

      const compactionUpdate: SyncUpdate = { type: SyncUpdateType.COMPACTION, data: 'compacted' };
      const callbacks = createMockCallbacks({
        onCompactionRequested: vi.fn<() => SyncUpdate>().mockReturnValue(compactionUpdate),
      });

      syncClient.start('postType/post:1', 100, [], callbacks);
      await vi.advanceTimersByTimeAsync(0);

      expect(callbacks.onCompactionRequested).toHaveBeenCalledTimes(1);

      // Compaction update should be sent in next poll
      await vi.advanceTimersByTimeAsync(config.pollingInterval);
      const payload = apiClient.sendSyncUpdate.mock.calls[1][0] as SyncPayload;
      expect(payload.rooms[0].updates).toContainEqual(compactionUpdate);
    });
  });

  describe('queueUpdate()', () => {
    it('adds update to queue', () => {
      const callbacks = createMockCallbacks();
      syncClient.start('postType/post:1', 100, [], callbacks);

      const update: SyncUpdate = { type: SyncUpdateType.UPDATE, data: 'test' };
      syncClient.queueUpdate('postType/post:1', update);
      expect(syncClient.getStatus().queueSize).toBe(1);
    });

    it('queued updates are sent in next poll', async () => {
      apiClient.sendSyncUpdate
        .mockResolvedValueOnce(emptyRoomResponse('postType/post:1', 1))
        .mockResolvedValue(emptyRoomResponse('postType/post:1', 2));

      const callbacks = createMockCallbacks();
      syncClient.start('postType/post:1', 100, [], callbacks);
      await vi.advanceTimersByTimeAsync(0);

      const update: SyncUpdate = { type: SyncUpdateType.UPDATE, data: 'queued-update' };
      syncClient.queueUpdate('postType/post:1', update);

      await vi.advanceTimersByTimeAsync(config.pollingInterval);
      const payload = apiClient.sendSyncUpdate.mock.calls[1][0] as SyncPayload;
      expect(payload.rooms[0].updates).toContainEqual(update);
    });

    it('throws for unknown room', () => {
      const callbacks = createMockCallbacks();
      syncClient.start('postType/post:1', 100, [], callbacks);

      const update: SyncUpdate = { type: SyncUpdateType.UPDATE, data: 'test' };
      expect(() => syncClient.queueUpdate('unknown-room', update)).toThrow(
        "Room 'unknown-room' is not registered",
      );
    });
  });

  describe('flushQueue()', () => {
    it('triggers an immediate poll', async () => {
      apiClient.sendSyncUpdate
        .mockResolvedValueOnce(emptyRoomResponse('postType/post:1', 1))
        .mockResolvedValue(emptyRoomResponse('postType/post:1', 2));

      const callbacks = createMockCallbacks();
      syncClient.start('postType/post:1', 100, [], callbacks);
      await vi.advanceTimersByTimeAsync(0); // First poll

      // Queue an update and flush
      syncClient.queueUpdate('postType/post:1', { type: SyncUpdateType.UPDATE, data: 'flush-me' });
      apiClient.sendSyncUpdate.mockClear();
      syncClient.flushQueue();

      // The flush schedules a setTimeout(0), so advance to fire it
      await vi.advanceTimersByTimeAsync(0);

      expect(apiClient.sendSyncUpdate).toHaveBeenCalledTimes(1);
      const payload = apiClient.sendSyncUpdate.mock.calls[0][0] as SyncPayload;
      expect(payload.rooms[0].updates).toContainEqual({
        type: SyncUpdateType.UPDATE,
        data: 'flush-me',
      });
    });

    it('is a no-op when stopped', () => {
      const callbacks = createMockCallbacks();
      apiClient.sendSyncUpdate.mockResolvedValue(emptyRoomResponse('postType/post:1', 0));

      syncClient.start('postType/post:1', 100, [], callbacks);
      syncClient.stop();

      // Should not throw
      syncClient.flushQueue();
    });

    it('sets flushRequested during active poll for follow-up', async () => {
      // Use a delayed mock to simulate a slow poll
      let resolvePoll!: (value: SyncResponse) => void;
      apiClient.sendSyncUpdate
        .mockReturnValueOnce(new Promise<SyncResponse>((resolve) => { resolvePoll = resolve; }))
        .mockResolvedValue(emptyRoomResponse('postType/post:1', 2));

      const callbacks = createMockCallbacks();
      syncClient.start('postType/post:1', 100, [], callbacks);

      // Trigger first poll (it will be pending because of the unresolved promise)
      await vi.advanceTimersByTimeAsync(0);

      // Now call flushQueue while poll is in progress
      syncClient.queueUpdate('postType/post:1', { type: SyncUpdateType.UPDATE, data: 'during-poll' });
      syncClient.flushQueue();

      // Resolve the pending poll
      resolvePoll(emptyRoomResponse('postType/post:1', 1));
      await vi.advanceTimersByTimeAsync(0);

      // A follow-up poll should have been triggered
      await vi.advanceTimersByTimeAsync(0);
      expect(apiClient.sendSyncUpdate).toHaveBeenCalledTimes(2);
    });

    it('re-entrancy guard prevents concurrent polls', async () => {
      let resolvePoll!: (value: SyncResponse) => void;
      apiClient.sendSyncUpdate
        .mockReturnValueOnce(new Promise<SyncResponse>((resolve) => { resolvePoll = resolve; }))
        .mockResolvedValue(emptyRoomResponse('postType/post:1', 2));

      const callbacks = createMockCallbacks();
      syncClient.start('postType/post:1', 100, [], callbacks);

      // Trigger first poll (pending)
      await vi.advanceTimersByTimeAsync(0);

      // Multiple flushes during active poll should not cause multiple concurrent polls
      syncClient.flushQueue();
      syncClient.flushQueue();
      syncClient.flushQueue();

      // Still only one call to sendSyncUpdate
      expect(apiClient.sendSyncUpdate).toHaveBeenCalledTimes(1);

      // Resolve the pending poll
      resolvePoll(emptyRoomResponse('postType/post:1', 1));
      await vi.advanceTimersByTimeAsync(0);

      // One follow-up poll should fire
      await vi.advanceTimersByTimeAsync(0);
      expect(apiClient.sendSyncUpdate).toHaveBeenCalledTimes(2);
    });
  });

  describe('getStatus()', () => {
    it('reports initial state', () => {
      const status = syncClient.getStatus();
      expect(status.isPolling).toBe(false);
      expect(status.hasCollaborators).toBe(false);
      expect(status.endCursor).toBe(0);
      expect(status.queueSize).toBe(0);
    });

    it('reports active state after start', async () => {
      apiClient.sendSyncUpdate.mockResolvedValue(emptyRoomResponse('postType/post:1', 5));
      const callbacks = createMockCallbacks();

      syncClient.start('postType/post:1', 100, [], callbacks);
      await vi.advanceTimersByTimeAsync(0);

      const status = syncClient.getStatus();
      expect(status.isPolling).toBe(true);
      expect(status.endCursor).toBe(5);
    });
  });

  describe('multi-room', () => {
    const ROOM_A = 'postType/post:1';
    const ROOM_B = 'root/comment';

    it('addRoom sends both rooms in poll payload', async () => {
      apiClient.sendSyncUpdate.mockResolvedValue(
        multiRoomResponse([
          { room: ROOM_A, end_cursor: 1 },
          { room: ROOM_B, end_cursor: 2 },
        ]),
      );

      const callbacks = createMockCallbacks();
      syncClient.start(ROOM_A, 100, [], callbacks);

      const roomBCallbacks = createMockRoomCallbacks();
      syncClient.addRoom(ROOM_B, 200, [], roomBCallbacks);

      await vi.advanceTimersByTimeAsync(0);

      const payload = apiClient.sendSyncUpdate.mock.calls[0][0] as SyncPayload;
      expect(payload.rooms).toHaveLength(2);

      const roomNames = payload.rooms.map((r) => r.room);
      expect(roomNames).toContain(ROOM_A);
      expect(roomNames).toContain(ROOM_B);
    });

    it('removeRoom removes a room from poll payload', async () => {
      apiClient.sendSyncUpdate.mockResolvedValue(
        emptyRoomResponse(ROOM_A, 1),
      );

      const callbacks = createMockCallbacks();
      syncClient.start(ROOM_A, 100, [], callbacks);

      const roomBCallbacks = createMockRoomCallbacks();
      syncClient.addRoom(ROOM_B, 200, [], roomBCallbacks);
      syncClient.removeRoom(ROOM_B);

      await vi.advanceTimersByTimeAsync(0);

      const payload = apiClient.sendSyncUpdate.mock.calls[0][0] as SyncPayload;
      expect(payload.rooms).toHaveLength(1);
      expect(payload.rooms[0].room).toBe(ROOM_A);
    });

    it('removeRoom on last room stops polling', () => {
      const callbacks = createMockCallbacks();
      syncClient.start(ROOM_A, 100, [], callbacks);

      syncClient.removeRoom(ROOM_A);

      expect(syncClient.getStatus().isPolling).toBe(false);
    });

    it('addRoom throws on duplicate room', () => {
      const callbacks = createMockCallbacks();
      syncClient.start(ROOM_A, 100, [], callbacks);

      const roomCallbacks = createMockRoomCallbacks();
      expect(() => syncClient.addRoom(ROOM_A, 200, [], roomCallbacks)).toThrow(
        `Room '${ROOM_A}' is already registered`,
      );
    });

    it('per-room cursor tracking', async () => {
      apiClient.sendSyncUpdate
        .mockResolvedValueOnce(
          multiRoomResponse([
            { room: ROOM_A, end_cursor: 10 },
            { room: ROOM_B, end_cursor: 5 },
          ]),
        )
        .mockResolvedValue(
          multiRoomResponse([
            { room: ROOM_A, end_cursor: 20 },
            { room: ROOM_B, end_cursor: 15 },
          ]),
        );

      const callbacks = createMockCallbacks();
      syncClient.start(ROOM_A, 100, [], callbacks);

      const roomBCallbacks = createMockRoomCallbacks();
      syncClient.addRoom(ROOM_B, 200, [], roomBCallbacks);

      // First poll
      await vi.advanceTimersByTimeAsync(0);

      // Second poll
      await vi.advanceTimersByTimeAsync(config.pollingInterval);

      const secondPayload = apiClient.sendSyncUpdate.mock.calls[1][0] as SyncPayload;
      const roomAPayload = secondPayload.rooms.find((r) => r.room === ROOM_A);
      const roomBPayload = secondPayload.rooms.find((r) => r.room === ROOM_B);

      expect(roomAPayload?.after).toBe(10);
      expect(roomBPayload?.after).toBe(5);
    });

    it('per-room update dispatch', async () => {
      const roomAUpdate: SyncUpdate = { type: SyncUpdateType.UPDATE, data: 'update-for-A' };
      const roomBUpdate: SyncUpdate = { type: SyncUpdateType.UPDATE, data: 'update-for-B' };

      apiClient.sendSyncUpdate.mockResolvedValue(
        multiRoomResponse([
          { room: ROOM_A, end_cursor: 1, updates: [roomAUpdate] },
          { room: ROOM_B, end_cursor: 1, updates: [roomBUpdate] },
        ]),
      );

      const callbacksA = createMockCallbacks();
      syncClient.start(ROOM_A, 100, [], callbacksA);

      const callbacksB = createMockRoomCallbacks();
      syncClient.addRoom(ROOM_B, 200, [], callbacksB);

      await vi.advanceTimersByTimeAsync(0);

      // Room A's onUpdate should only receive room A's update
      expect(callbacksA.onUpdate).toHaveBeenCalledTimes(1);
      expect(callbacksA.onUpdate).toHaveBeenCalledWith(roomAUpdate);

      // Room B's onUpdate should only receive room B's update
      expect(callbacksB.onUpdate).toHaveBeenCalledTimes(1);
      expect(callbacksB.onUpdate).toHaveBeenCalledWith(roomBUpdate);
    });

    it('per-room awareness', async () => {
      const roomAAwareness: AwarenessState = {
        '100': { cursor: null },
        '300': { cursor: { x: 1, y: 1 } },
      };

      apiClient.sendSyncUpdate.mockResolvedValue(
        multiRoomResponse([
          { room: ROOM_A, end_cursor: 1, awareness: roomAAwareness },
          { room: ROOM_B, end_cursor: 1, awareness: {} },
        ]),
      );

      const callbacksA = createMockCallbacks();
      syncClient.start(ROOM_A, 100, [], callbacksA);

      const callbacksB = createMockRoomCallbacks();
      syncClient.addRoom(ROOM_B, 200, [], callbacksB);

      await vi.advanceTimersByTimeAsync(0);

      expect(callbacksA.onAwareness).toHaveBeenCalledWith(roomAAwareness);
      expect(callbacksB.onAwareness).toHaveBeenCalledWith({});
    });

    it('error recovery restores all rooms\' queues', async () => {
      apiClient.sendSyncUpdate
        .mockResolvedValueOnce(
          multiRoomResponse([
            { room: ROOM_A, end_cursor: 1 },
            { room: ROOM_B, end_cursor: 1 },
          ]),
        )
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue(
          multiRoomResponse([
            { room: ROOM_A, end_cursor: 2 },
            { room: ROOM_B, end_cursor: 2 },
          ]),
        );

      const callbacksA = createMockCallbacks();
      syncClient.start(ROOM_A, 100, [], callbacksA);

      const callbacksB = createMockRoomCallbacks();
      syncClient.addRoom(ROOM_B, 200, [], callbacksB);

      // First poll succeeds — establishes rooms
      await vi.advanceTimersByTimeAsync(0);

      // Queue updates for both rooms
      const updateA: SyncUpdate = { type: SyncUpdateType.UPDATE, data: 'update-A' };
      const updateB: SyncUpdate = { type: SyncUpdateType.UPDATE, data: 'update-B' };
      syncClient.queueUpdate(ROOM_A, updateA);
      syncClient.queueUpdate(ROOM_B, updateB);

      // Second poll fails — updates should be restored
      await vi.advanceTimersByTimeAsync(config.pollingInterval);

      // Both rooms' updates should be restored
      expect(syncClient.getStatus().queueSize).toBe(2);

      // Next successful poll should send both restored updates
      await vi.advanceTimersByTimeAsync(config.pollingInterval * 2);

      const retryPayload = apiClient.sendSyncUpdate.mock.calls[2][0] as SyncPayload;
      const retryRoomA = retryPayload.rooms.find((r) => r.room === ROOM_A);
      const retryRoomB = retryPayload.rooms.find((r) => r.room === ROOM_B);

      expect(retryRoomA?.updates).toContainEqual(updateA);
      expect(retryRoomB?.updates).toContainEqual(updateB);
    });
  });
});
