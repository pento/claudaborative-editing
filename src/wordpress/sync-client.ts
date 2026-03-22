import type {
  SyncUpdate,
  SyncClientConfig,
  SyncUpdateType,
  AwarenessState,
  LocalAwarenessState,
} from './types.js';
import type { WordPressApiClient } from './api-client.js';

export type SyncStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface SyncCallbacks {
  /** Process an incoming update. Return a SyncUpdate to queue (e.g. sync_step2), or null. */
  onUpdate: (update: SyncUpdate) => SyncUpdate | null;
  /** Called when awareness state changes. */
  onAwareness: (state: AwarenessState) => void;
  /** Called when connection status changes. */
  onStatusChange: (status: SyncStatus) => void;
  /** Called when the server requests compaction; must return a compaction update. */
  onCompactionRequested: () => SyncUpdate;
  /** Return the current local awareness state, or null if disconnected. */
  getAwarenessState: () => LocalAwarenessState;
}

/** Room-specific callbacks (everything except the global onStatusChange). */
export type RoomCallbacks = Omit<SyncCallbacks, 'onStatusChange'>;

interface RoomState {
  room: string;
  clientId: number;
  endCursor: number;
  updateQueue: SyncUpdate[];
  queuePaused: boolean;
  hasCollaborators: boolean;
  callbacks: RoomCallbacks;
}

/**
 * HTTP polling sync client that maintains the Gutenberg sync loop.
 *
 * Supports multiple rooms, each with their own state, while sending
 * all rooms in a single HTTP request per poll cycle.
 *
 * Uses chained setTimeout (not setInterval) so polling interval
 * can adapt dynamically to collaborator presence and errors.
 */
export class SyncClient {
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private currentBackoff: number;
  private isPolling: boolean = false;
  private pollInProgress: boolean = false;
  private flushRequested: boolean = false;

  private rooms = new Map<string, RoomState>();
  private onStatusChange: ((status: SyncStatus) => void) | null = null;
  private firstPollResolve: (() => void) | null = null;

  constructor(
    private apiClient: WordPressApiClient,
    private config: SyncClientConfig,
  ) {
    this.currentBackoff = config.pollingInterval;
  }

  /**
   * Returns a promise that resolves after the first poll cycle completes.
   * Used to wait for initial sync state before loading content.
   */
  waitForFirstPoll(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.firstPollResolve = resolve;
    });
  }

  /**
   * Start the polling loop for a room.
   *
   * This is a backward-compatible wrapper that sets the global onStatusChange
   * callback and adds the room via addRoom(), then starts polling if not already active.
   *
   * @param room        Room identifier, e.g. 'postType/post:123'
   * @param clientId    Y.Doc clientID
   * @param initialUpdates  Initial sync updates to send (sync_step1)
   * @param callbacks   Event callbacks
   */
  start(
    room: string,
    clientId: number,
    initialUpdates: SyncUpdate[],
    callbacks: SyncCallbacks,
  ): void {
    this.onStatusChange = callbacks.onStatusChange;

    const roomCallbacks: RoomCallbacks = {
      onUpdate: callbacks.onUpdate,
      onAwareness: callbacks.onAwareness,
      onCompactionRequested: callbacks.onCompactionRequested,
      getAwarenessState: callbacks.getAwarenessState,
    };
    this.addRoom(room, clientId, initialUpdates, roomCallbacks);

    if (!this.isPolling) {
      this.currentBackoff = this.config.pollingInterval;
      this.isPolling = true;
      this.onStatusChange('connecting');
      this.pollTimer = setTimeout(() => this.poll(), 0);
    }
  }

  /**
   * Add a room to the sync loop.
   *
   * @param room        Room identifier
   * @param clientId    Y.Doc clientID for this room
   * @param initialUpdates  Initial sync updates to send (sync_step1)
   * @param callbacks   Room-specific event callbacks
   */
  addRoom(
    room: string,
    clientId: number,
    initialUpdates: SyncUpdate[],
    callbacks: RoomCallbacks,
  ): void {
    if (this.rooms.has(room)) {
      throw new Error(`Room '${room}' is already registered`);
    }
    this.rooms.set(room, {
      room,
      clientId,
      endCursor: 0,
      updateQueue: [...initialUpdates],
      queuePaused: true,
      hasCollaborators: false,
      callbacks,
    });
  }

  /**
   * Remove a room from the sync loop.
   * If this was the last room, stops polling entirely.
   */
  removeRoom(room: string): void {
    this.rooms.delete(room);
    if (this.rooms.size === 0) {
      this.stop();
    }
  }

  /**
   * Stop the polling loop.
   */
  stop(): void {
    this.isPolling = false;
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.rooms.clear();
    this.onStatusChange?.('disconnected');
    this.onStatusChange = null;
  }

  /**
   * Flush the outgoing queue by triggering an immediate poll.
   *
   * If a poll is already in progress, sets a flag so that another poll
   * is triggered immediately after the current one completes. This avoids
   * concurrent poll execution while ensuring the flush is honoured.
   */
  flushQueue(): void {
    if (!this.isPolling) return;

    if (this.pollInProgress) {
      // A poll is already running — request a follow-up poll when it finishes
      this.flushRequested = true;
      return;
    }

    // Cancel the scheduled timer and poll immediately
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    this.pollTimer = setTimeout(() => this.poll(), 0);
  }

  /**
   * Add an update to the outgoing queue for a specific room.
   */
  queueUpdate(room: string, update: SyncUpdate): void {
    const state = this.rooms.get(room);
    if (!state) {
      throw new Error(`Room '${room}' is not registered`);
    }
    state.updateQueue.push(update);
  }

  /**
   * Get sync status info, aggregated across all rooms.
   */
  getStatus(): {
    isPolling: boolean;
    hasCollaborators: boolean;
    queuePaused: boolean;
    endCursor: number;
    queueSize: number;
  } {
    let hasCollaborators = false;
    let queuePaused = false;
    let totalQueueSize = 0;
    let maxEndCursor = 0;

    for (const state of this.rooms.values()) {
      if (state.hasCollaborators) hasCollaborators = true;
      if (state.queuePaused) queuePaused = true;
      totalQueueSize += state.updateQueue.length;
      if (state.endCursor > maxEndCursor) maxEndCursor = state.endCursor;
    }

    return {
      isPolling: this.isPolling,
      hasCollaborators,
      queuePaused,
      endCursor: maxEndCursor,
      queueSize: totalQueueSize,
    };
  }

  /**
   * Execute one poll cycle.
   */
  private async poll(): Promise<void> {
    if (!this.isPolling || this.rooms.size === 0) return;
    if (this.pollInProgress) return;

    this.pollInProgress = true;
    this.flushRequested = false;

    // Drain all rooms' queues and build payload
    const drainedQueues = new Map<string, SyncUpdate[]>();
    const roomPayloads = [];

    for (const [name, state] of this.rooms) {
      const updates = state.updateQueue.splice(0);
      drainedQueues.set(name, updates);
      roomPayloads.push({
        room: name,
        client_id: state.clientId,
        after: state.endCursor,
        awareness: state.callbacks.getAwarenessState(),
        updates,
      });
    }

    try {
      const response = await this.apiClient.sendSyncUpdate({ rooms: roomPayloads });

      // Success — reset backoff based on collaborator presence
      this.currentBackoff = this.anyCollaborators()
        ? this.config.pollingIntervalWithCollaborators
        : this.config.pollingInterval;

      this.onStatusChange?.('connected');
      this.processResponse(response);

      // Re-check after processing (collaborators may have changed)
      this.currentBackoff = this.anyCollaborators()
        ? this.config.pollingIntervalWithCollaborators
        : this.config.pollingInterval;

      if (this.firstPollResolve) {
        this.firstPollResolve();
        this.firstPollResolve = null;
      }
    } catch (error) {
      // Restore un-sent updates for ALL rooms (excluding stale compaction updates)
      for (const [name, updates] of drainedQueues) {
        const state = this.rooms.get(name);
        if (state) {
          const restorable = updates.filter(
            (u) => (u.type as SyncUpdateType) !== ('compaction' as SyncUpdateType),
          );
          state.updateQueue.unshift(...restorable);
        }
      }

      this.onStatusChange?.('error');
      this.currentBackoff = Math.min(
        this.currentBackoff * 2,
        this.config.maxErrorBackoff,
      );
    }

    this.pollInProgress = false;

    if (this.flushRequested) {
      this.flushRequested = false;
      if (this.pollTimer !== null) {
        clearTimeout(this.pollTimer);
        this.pollTimer = null;
      }
      this.pollTimer = setTimeout(() => this.poll(), 0);
    } else {
      this.scheduleNextPoll();
    }
  }

  /**
   * Check if any room has collaborators.
   */
  private anyCollaborators(): boolean {
    for (const state of this.rooms.values()) {
      if (state.hasCollaborators) return true;
    }
    return false;
  }

  /**
   * Schedule the next poll using the current interval / backoff.
   */
  private scheduleNextPoll(): void {
    if (!this.isPolling) {
      return;
    }

    this.pollTimer = setTimeout(() => this.poll(), this.currentBackoff);
  }

  /**
   * Process a sync response from the server.
   */
  private processResponse(response: { rooms: Array<{
    room: string;
    end_cursor: number;
    awareness: AwarenessState;
    updates: SyncUpdate[];
    should_compact?: boolean;
  }> }): void {
    for (const roomData of response.rooms) {
      const state = this.rooms.get(roomData.room);
      if (!state) continue;

      // Update end cursor
      state.endCursor = roomData.end_cursor;

      // Process awareness — detect collaborators
      state.callbacks.onAwareness(roomData.awareness);

      const otherClients = Object.keys(roomData.awareness).filter(
        (id) => Number(id) !== state.clientId && roomData.awareness[id] !== null,
      );
      const hadCollaborators = state.hasCollaborators;
      state.hasCollaborators = otherClients.length > 0;

      if (state.hasCollaborators && !hadCollaborators) {
        state.queuePaused = false;
      }

      // Process incoming updates
      for (const update of roomData.updates) {
        const reply = state.callbacks.onUpdate(update);
        if (reply) {
          state.updateQueue.push(reply);
        }
      }

      // Handle compaction
      if (roomData.should_compact) {
        const compactionUpdate = state.callbacks.onCompactionRequested();
        state.updateQueue.push(compactionUpdate);
      }
    }
  }
}
