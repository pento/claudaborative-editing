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

/**
 * HTTP polling sync client that maintains the Gutenberg sync loop.
 *
 * Uses chained setTimeout (not setInterval) so polling interval
 * can adapt dynamically to collaborator presence and errors.
 */
export class SyncClient {
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private endCursor: number = 0;
  private updateQueue: SyncUpdate[] = [];
  private queuePaused: boolean = true;
  private hasCollaborators: boolean = false;
  private currentBackoff: number;
  private isPolling: boolean = false;
  private room: string = '';
  private clientId: number = 0;

  private callbacks: SyncCallbacks | null = null;
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
    this.room = room;
    this.clientId = clientId;
    this.callbacks = callbacks;
    this.endCursor = 0;
    this.queuePaused = true;
    this.hasCollaborators = false;
    this.currentBackoff = this.config.pollingInterval;
    this.isPolling = true;

    // Seed queue with initial updates (e.g. sync_step1)
    this.updateQueue = [...initialUpdates];

    this.callbacks.onStatusChange('connecting');

    // Kick off the first poll immediately
    this.pollTimer = setTimeout(() => this.poll(), 0);
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
    this.callbacks?.onStatusChange('disconnected');
    this.callbacks = null;
  }

  /**
   * Add an update to the outgoing queue.
   */
  queueUpdate(update: SyncUpdate): void {
    this.updateQueue.push(update);
  }

  /**
   * Get sync status info.
   */
  getStatus(): {
    isPolling: boolean;
    hasCollaborators: boolean;
    queuePaused: boolean;
    endCursor: number;
    queueSize: number;
  } {
    return {
      isPolling: this.isPolling,
      hasCollaborators: this.hasCollaborators,
      queuePaused: this.queuePaused,
      endCursor: this.endCursor,
      queueSize: this.updateQueue.length,
    };
  }

  /**
   * Execute one poll cycle.
   */
  private async poll(): Promise<void> {
    if (!this.isPolling || !this.callbacks) {
      return;
    }

    // Drain the queue: take all pending updates.
    // When paused, only initial/sync updates are sent (queue is drained regardless);
    // the distinction is that new edits are only queued when unpaused.
    const updates = this.updateQueue.splice(0);

    const awareness = this.callbacks.getAwarenessState();

    try {
      const payload = {
        rooms: [
          {
            room: this.room,
            client_id: this.clientId,
            after: this.endCursor,
            awareness,
            updates,
          },
        ],
      };

      const response = await this.apiClient.sendSyncUpdate(payload);

      // Success — reset backoff
      this.currentBackoff = this.hasCollaborators
        ? this.config.pollingIntervalWithCollaborators
        : this.config.pollingInterval;

      this.callbacks.onStatusChange('connected');

      this.processResponse(response);

      // Resolve the first-poll promise after processing the response
      if (this.firstPollResolve) {
        this.firstPollResolve();
        this.firstPollResolve = null;
      }
    } catch (error) {
      // Restore un-sent updates to front of queue,
      // excluding compaction updates (which are stale after an error).
      const restorable = updates.filter(
        (u) => (u.type as SyncUpdateType) !== ('compaction' as SyncUpdateType),
      );
      this.updateQueue.unshift(...restorable);

      this.callbacks.onStatusChange('error');

      // Exponential backoff: double current, cap at max
      this.currentBackoff = Math.min(
        this.currentBackoff * 2,
        this.config.maxErrorBackoff,
      );
    }

    this.scheduleNextPoll();
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
    if (!this.callbacks) {
      return;
    }

    const roomData = response.rooms.find((r) => r.room === this.room);
    if (!roomData) {
      return;
    }

    // 1. Update end cursor
    this.endCursor = roomData.end_cursor;

    // 2. Process awareness — detect collaborators
    this.callbacks.onAwareness(roomData.awareness);

    const otherClients = Object.keys(roomData.awareness).filter(
      (id) => Number(id) !== this.clientId && roomData.awareness[id] !== null,
    );
    const hadCollaborators = this.hasCollaborators;
    this.hasCollaborators = otherClients.length > 0;

    // If we just gained collaborators, unpause the queue
    if (this.hasCollaborators && !hadCollaborators) {
      this.queuePaused = false;
    }

    // Adjust backoff/interval for collaborator presence
    this.currentBackoff = this.hasCollaborators
      ? this.config.pollingIntervalWithCollaborators
      : this.config.pollingInterval;

    // 3. Process incoming updates
    for (const update of roomData.updates) {
      const reply = this.callbacks.onUpdate(update);
      if (reply) {
        this.updateQueue.push(reply);
      }
    }

    // 4. Handle compaction request
    if (roomData.should_compact) {
      const compactionUpdate = this.callbacks.onCompactionRequested();
      this.updateQueue.push(compactionUpdate);
    }
  }
}
