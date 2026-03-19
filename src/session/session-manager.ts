/**
 * Session manager: orchestrates the full connection lifecycle for
 * collaborative editing of WordPress posts via the Gutenberg sync protocol.
 *
 * Lifecycle: connect → openPost → edit/read → closePost → disconnect
 */

import * as Y from 'yjs';
import { DocumentManager } from '../yjs/document-manager.js';
import { WordPressApiClient } from '../wordpress/api-client.js';
import { SyncClient } from '../wordpress/sync-client.js';
import {
  createSyncStep1,
  processIncomingUpdate,
  createCompactionUpdate,
  createUpdateFromChange,
} from '../yjs/sync-protocol.js';
import { parseBlocks, parsedBlockToBlock } from '../blocks/parser.js';
import { renderPost, renderBlock } from '../blocks/renderer.js';
import { buildAwarenessState, parseCollaborators } from './awareness.js';
import { DEFAULT_SYNC_CONFIG } from '../wordpress/types.js';
import type { Block, CollaboratorInfo, AwarenessLocalState } from '../yjs/types.js';
import type {
  WordPressConfig,
  WPUser,
  WPPost,
} from '../wordpress/types.js';

export type SessionState = 'disconnected' | 'connected' | 'editing';

/**
 * Origin marker for local edits made through the session manager.
 * Used to distinguish local changes from sync updates when observing Y.Doc events.
 */
const LOCAL_ORIGIN = 'local';

export class SessionManager {
  private apiClient: WordPressApiClient | null = null;
  private syncClient: SyncClient | null = null;
  private documentManager: DocumentManager;
  private doc: Y.Doc | null = null;
  private user: WPUser | null = null;
  private currentPost: WPPost | null = null;
  private state: SessionState = 'disconnected';
  private awarenessState: AwarenessLocalState | null = null;
  private collaborators: CollaboratorInfo[] = [];
  private updateHandler: ((update: Uint8Array, origin: unknown) => void) | null = null;

  /** Max time (ms) to wait for sync to populate the doc before loading from REST API. Set to 0 in tests. */
  syncWaitTimeout = 5000;

  constructor() {
    this.documentManager = new DocumentManager();
  }

  // --- Connection ---

  /**
   * Connect to a WordPress site.
   * Validates credentials and sync endpoint availability.
   */
  async connect(config: WordPressConfig): Promise<WPUser> {
    this.apiClient = new WordPressApiClient(config);

    // Validate credentials
    const user = await this.apiClient.validateConnection();
    this.user = user;

    // Validate sync endpoint is available
    await this.apiClient.validateSyncEndpoint();

    // Build awareness state from user info
    this.awarenessState = buildAwarenessState(user);

    this.state = 'connected';
    return user;
  }

  /**
   * Disconnect from the WordPress site.
   */
  disconnect(): void {
    if (this.state === 'editing') {
      this.closePost();
    }

    this.apiClient = null;
    this.user = null;
    this.awarenessState = null;
    this.collaborators = [];
    this.state = 'disconnected';
  }

  // --- Posts ---

  /**
   * List posts (delegates to API client).
   */
  async listPosts(options?: {
    status?: string;
    search?: string;
    perPage?: number;
  }): Promise<WPPost[]> {
    this.requireState('connected', 'editing');
    return this.apiClient!.listPosts(options);
  }

  /**
   * Open a post for collaborative editing.
   * Creates Y.Doc, loads initial content, starts sync.
   */
  async openPost(postId: number): Promise<void> {
    this.requireState('connected');

    // Fetch post from API
    const post = await this.apiClient!.getPost(postId);
    this.currentPost = post;

    // Create an EMPTY Y.Doc — don't load content yet.
    // We first sync with the server to receive any existing CRDT state.
    // Loading content independently would create divergent CRDT histories,
    // causing duplicate blocks when two clients sync.
    const doc = this.documentManager.createDoc();
    this.doc = doc;

    // Create sync client
    const syncClient = new SyncClient(this.apiClient!, { ...DEFAULT_SYNC_CONFIG });
    this.syncClient = syncClient;

    // Start sync with room = postType/${post.type}:${postId}
    const room = `postType/${post.type}:${postId}`;
    const initialUpdates = [createSyncStep1(doc)];

    syncClient.start(room, doc.clientID, initialUpdates, {
      onUpdate: (update) => {
        try {
          return processIncomingUpdate(doc, update);
        } catch {
          return null;
        }
      },
      onAwareness: (awarenessState) => {
        this.collaborators = parseCollaborators(awarenessState, doc.clientID);
      },
      onStatusChange: () => {
        // Status is read directly from syncClient.getStatus()
      },
      onCompactionRequested: () => {
        return createCompactionUpdate(doc);
      },
      getAwarenessState: () => {
        return this.awarenessState;
      },
    });

    // Wait for the sync handshake to populate the doc with remote content.
    // The handshake takes multiple poll cycles:
    //   Poll 1: We send sync_step1 → receive peer's sync_step1
    //   Poll 2: We send sync_step2 → receive peer's sync_step2 (their full state)
    // So we wait until the doc has blocks (meaning remote state arrived),
    // or timeout (meaning no peers are editing this post).
    if (this.syncWaitTimeout > 0) {
      await new Promise<void>((resolve) => {
        let resolved = false;
        const done = () => {
          if (!resolved) {
            resolved = true;
            doc.off('update', onDocUpdate);
            resolve();
          }
        };

        const timeout = setTimeout(done, this.syncWaitTimeout);

        const onDocUpdate = () => {
          const blocks = this.documentManager.getBlocks(doc);
          const title = this.documentManager.getTitle(doc);
          if (blocks.length > 0 || title.length > 0) {
            clearTimeout(timeout);
            done();
          }
        };

        doc.on('update', onDocUpdate);
      });
    }

    // If the doc is still empty after sync, load content from the REST API.
    // This means we're the first CRDT client for this post.
    const existingBlocks = this.documentManager.getBlocks(doc);
    if (existingBlocks.length === 0) {
      doc.transact(() => {
        // Set title
        if (post.title.raw) {
          this.documentManager.setTitle(doc, post.title.raw);
        }

        // Parse content into blocks
        if (post.content.raw) {
          const parsedBlocks = parseBlocks(post.content.raw);
          const blocks = parsedBlocks.map(parsedBlockToBlock);
          this.documentManager.setBlocks(doc, blocks);
          this.documentManager.setContent(doc, post.content.raw);
        }

        // Set excerpt
        if (post.excerpt.raw) {
          this.documentManager.setProperty(doc, 'excerpt', post.excerpt.raw);
        }

        // Set other post properties
        this.documentManager.setProperty(doc, 'status', post.status);
        this.documentManager.setProperty(doc, 'slug', post.slug);
        this.documentManager.setProperty(doc, 'author', post.author);
      }, LOCAL_ORIGIN);
    }

    // Set up Y.Doc observer to queue updates for local changes
    this.updateHandler = (update: Uint8Array, origin: unknown) => {
      // Only queue updates from local edits, not from sync
      if (origin === LOCAL_ORIGIN) {
        const syncUpdate = createUpdateFromChange(update);
        syncClient.queueUpdate(syncUpdate);
      }
    };
    doc.on('update', this.updateHandler);

    this.state = 'editing';
  }

  /**
   * Create a new post and open it for editing.
   */
  async createPost(data: {
    title?: string;
    content?: string;
  }): Promise<WPPost> {
    this.requireState('connected');

    const post = await this.apiClient!.createPost({
      title: data.title,
      content: data.content,
      status: 'draft',
    });

    await this.openPost(post.id);

    return post;
  }

  /**
   * Close the currently open post (stop sync).
   */
  closePost(): void {
    if (this.syncClient) {
      this.syncClient.stop();
      this.syncClient = null;
    }

    if (this.doc && this.updateHandler) {
      this.doc.off('update', this.updateHandler);
      this.updateHandler = null;
    }

    this.doc = null;
    this.currentPost = null;
    this.collaborators = [];
    this.state = 'connected';
  }

  // --- Reading ---

  /**
   * Render the current post as Claude-friendly text.
   */
  readPost(): string {
    this.requireState('editing');

    const title = this.documentManager.getTitle(this.doc!);
    const blocks = this.documentManager.getBlocks(this.doc!);
    return renderPost(title, blocks);
  }

  /**
   * Read a specific block by index (dot notation).
   */
  readBlock(index: string): string {
    this.requireState('editing');

    const block = this.documentManager.getBlockByIndex(this.doc!, index);
    if (!block) {
      throw new Error(`Block not found at index ${index}`);
    }
    return renderBlock(block, index);
  }

  // --- Editing ---

  /**
   * Update a block's content and/or attributes.
   */
  updateBlock(
    index: string,
    changes: { content?: string; attributes?: Record<string, unknown> },
  ): void {
    this.requireState('editing');

    // Set cursor position BEFORE the edit — pointing to existing items
    // the browser already has. Gutenberg requires a real cursor position
    // to process remote edits, but if we set it AFTER the edit, the cursor
    // references new items the browser doesn't have yet (causing a crash).
    this.updateCursorPosition(index);

    this.doc!.transact(() => {
      this.documentManager.updateBlock(this.doc!, index, changes);
    }, LOCAL_ORIGIN);
  }

  /**
   * Insert a new block at position.
   */
  insertBlock(
    position: number,
    block: { name: string; content?: string; attributes?: Record<string, unknown> },
  ): void {
    this.requireState('editing');

    const fullBlock: Block = {
      name: block.name,
      clientId: crypto.randomUUID(),
      attributes: { ...block.attributes },
      innerBlocks: [],
    };

    // Set content as an attribute if provided
    if (block.content !== undefined) {
      fullBlock.attributes.content = block.content;
    }

    this.doc!.transact(() => {
      this.documentManager.insertBlock(this.doc!, position, fullBlock);
    }, LOCAL_ORIGIN);
  }

  /**
   * Remove blocks starting at index.
   */
  removeBlocks(startIndex: number, count: number): void {
    this.requireState('editing');
    this.doc!.transact(() => {
      this.documentManager.removeBlocks(this.doc!, startIndex, count);
    }, LOCAL_ORIGIN);
  }

  /**
   * Move a block from one position to another.
   */
  moveBlock(fromIndex: number, toIndex: number): void {
    this.requireState('editing');
    this.doc!.transact(() => {
      this.documentManager.moveBlock(this.doc!, fromIndex, toIndex);
    }, LOCAL_ORIGIN);
  }

  /**
   * Replace a range of blocks with new ones.
   */
  replaceBlocks(
    startIndex: number,
    count: number,
    newBlocks: Array<{
      name: string;
      content?: string;
      attributes?: Record<string, unknown>;
    }>,
  ): void {
    this.requireState('editing');

    const fullBlocks: Block[] = newBlocks.map((b) => {
      const attrs = { ...b.attributes };
      if (b.content !== undefined) {
        attrs.content = b.content;
      }
      return {
        name: b.name,
        clientId: crypto.randomUUID(),
        attributes: attrs,
        innerBlocks: [],
      };
    });

    this.doc!.transact(() => {
      this.documentManager.removeBlocks(this.doc!, startIndex, count);
      for (let i = 0; i < fullBlocks.length; i++) {
        this.documentManager.insertBlock(
          this.doc!,
          startIndex + i,
          fullBlocks[i],
        );
      }
    }, LOCAL_ORIGIN);
  }

  /**
   * Set the post title.
   */
  setTitle(title: string): void {
    this.requireState('editing');
    this.doc!.transact(() => {
      this.documentManager.setTitle(this.doc!, title);
    }, LOCAL_ORIGIN);
  }

  /**
   * Trigger a save.
   */
  save(): void {
    this.requireState('editing');
    this.doc!.transact(() => {
      this.documentManager.markSaved(this.doc!);
    }, LOCAL_ORIGIN);
  }

  // --- Status ---

  getState(): SessionState {
    return this.state;
  }

  getSyncStatus(): {
    isPolling: boolean;
    hasCollaborators: boolean;
    queueSize: number;
  } | null {
    if (!this.syncClient) {
      return null;
    }
    const status = this.syncClient.getStatus();
    return {
      isPolling: status.isPolling,
      hasCollaborators: status.hasCollaborators,
      queueSize: status.queueSize,
    };
  }

  getCollaborators(): CollaboratorInfo[] {
    return this.collaborators;
  }

  getCurrentPost(): WPPost | null {
    return this.currentPost;
  }

  getUser(): WPUser | null {
    return this.user;
  }

  /**
   * Update the awareness cursor to point to a block's Y.Text type.
   * References the Y.Text type itself (not items within it) so the
   * cursor always resolves — even after updateYText deletes all items.
   */
  private updateCursorPosition(blockIndex: string): void {
    if (!this.doc || !this.user) return;

    const ytext = this.documentManager.getBlockContentYText(this.doc, blockIndex);
    if (!ytext) return;

    // Get the Y.Text's internal item ID — this references the Y.Text TYPE,
    // not its content items. The type is never deleted, so this always resolves.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const typeItem = (ytext as any)._item;
    if (!typeItem?.id) return;

    const relPosJSON = {
      type: { client: typeItem.id.client, clock: typeItem.id.clock },
      tname: null,
      item: null,
      assoc: 0,
    };

    // Preserve enteredAt from existing awareness
    const enteredAt = this.awarenessState?.collaboratorInfo.enteredAt ?? Date.now();

    this.awarenessState = {
      collaboratorInfo: {
        id: this.user.id,
        name: `${this.user.name} (Claude)`,
        slug: this.user.slug,
        avatar_urls: this.user.avatar_urls ?? {},
        browserType: 'Claude Code MCP',
        enteredAt,
      },
      editorState: {
        selection: {
          type: 'cursor',
          cursorPosition: {
            relativePosition: relPosJSON,
            absoluteOffset: 0,
          },
        },
      },
    };
  }

  // --- Internal ---

  /**
   * Assert that the session is in one of the allowed states.
   */
  private requireState(...allowed: SessionState[]): void {
    if (!allowed.includes(this.state)) {
      throw new Error(
        `Operation requires state ${allowed.join(' or ')}, but current state is '${this.state}'`,
      );
    }
  }
}
