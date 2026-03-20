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
import {
  computeTextDelta,
  findHtmlSafeChunkEnd,
} from '../yjs/block-converter.js';
import { parseBlocks, parsedBlockToBlock } from '../blocks/parser.js';
import { renderPost, renderBlock } from '../blocks/renderer.js';
import { buildAwarenessState, parseCollaborators } from './awareness.js';
import { DEFAULT_SYNC_CONFIG } from '../wordpress/types.js';
import type { Block, CollaboratorInfo, AwarenessLocalState } from '../yjs/types.js';
import { isRichTextAttribute, getDefaultAttributes } from '../yjs/types.js';
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

/** Streaming chunk size range in characters. Randomized for a natural feel. */
const STREAM_CHUNK_SIZE_MIN = 2;
const STREAM_CHUNK_SIZE_MAX = 6;

/** Delay between streaming chunks in milliseconds. */
const STREAM_CHUNK_DELAY_MS = 200;

/** Minimum text length to trigger streaming (short text is applied atomically). */
const STREAM_THRESHOLD = 20;

/** Input shape for blocks with optional recursive inner blocks. */
export interface BlockInput {
  name: string;
  content?: string;
  attributes?: Record<string, unknown>;
  innerBlocks?: BlockInput[];
}

/** A streaming target: a specific attribute in a block that needs progressive insertion. */
interface StreamTarget {
  blockIndex: string;
  attrName: string;
  value: string;
}

/**
 * Recursively prepare a block tree for insertion.
 * Applies default attributes, sets isValid/clientId, and separates
 * streamable rich-text content from atomic structure.
 *
 * @returns The Block (with empty placeholders for streamable content)
 *          and a flat list of StreamTargets for progressive insertion.
 */
function prepareBlockTree(
  input: BlockInput,
  indexPrefix: string,
): { block: Block; streamTargets: StreamTarget[] } {
  const defaults = getDefaultAttributes(input.name);
  const attrs = { ...defaults, ...input.attributes };
  const streamTargets: StreamTarget[] = [];

  // Handle 'content' field
  if (input.content !== undefined) {
    if (
      isRichTextAttribute(input.name, 'content') &&
      input.content.length >= STREAM_THRESHOLD
    ) {
      streamTargets.push({ blockIndex: indexPrefix, attrName: 'content', value: input.content });
      attrs.content = '';
    } else {
      attrs.content = input.content;
    }
  }

  // Check other attributes for streaming
  for (const [key, value] of Object.entries(attrs)) {
    if (
      key !== 'content' &&
      isRichTextAttribute(input.name, key) &&
      typeof value === 'string' &&
      value.length >= STREAM_THRESHOLD
    ) {
      streamTargets.push({ blockIndex: indexPrefix, attrName: key, value });
      attrs[key] = '';
    }
  }

  // Recurse into inner blocks
  const innerBlocks: Block[] = [];
  if (input.innerBlocks) {
    for (let i = 0; i < input.innerBlocks.length; i++) {
      const childIndex = `${indexPrefix}.${i}`;
      const prepared = prepareBlockTree(input.innerBlocks[i], childIndex);
      innerBlocks.push(prepared.block);
      streamTargets.push(...prepared.streamTargets);
    }
  }

  const block: Block = {
    name: input.name,
    clientId: crypto.randomUUID(),
    attributes: attrs,
    innerBlocks,
    isValid: true,
  };

  return { block, streamTargets };
}

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
   *
   * Rich-text attributes that exceed the streaming threshold are streamed
   * in chunks so the browser sees progressive updates (like fast typing).
   * Non-rich-text and short changes are applied atomically.
   */
  async updateBlock(
    index: string,
    changes: { content?: string; attributes?: Record<string, unknown> },
  ): Promise<void> {
    this.requireState('editing');

    // Set cursor position BEFORE the edit — pointing to existing items
    // the browser already has. Gutenberg requires a real cursor position
    // to process remote edits, but if we set it AFTER the edit, the cursor
    // references new items the browser doesn't have yet (causing a crash).
    this.updateCursorPosition(index);

    // Identify which changes should be streamed vs applied atomically.
    // Look up the block name to determine rich-text attributes.
    const block = this.documentManager.getBlockByIndex(this.doc!, index);
    if (!block) return;

    const streamTargets: Array<{ attrName: string; newValue: string }> = [];
    const atomicChanges: { content?: string; attributes?: Record<string, unknown> } = {};

    // Check 'content' field
    if (changes.content !== undefined) {
      if (isRichTextAttribute(block.name, 'content') && changes.content.length >= STREAM_THRESHOLD) {
        streamTargets.push({ attrName: 'content', newValue: changes.content });
      } else {
        atomicChanges.content = changes.content;
      }
    }

    // Check explicit attributes
    if (changes.attributes) {
      const atomicAttrs: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(changes.attributes)) {
        if (
          isRichTextAttribute(block.name, key) &&
          typeof value === 'string' &&
          value.length >= STREAM_THRESHOLD
        ) {
          streamTargets.push({ attrName: key, newValue: value });
        } else {
          atomicAttrs[key] = value;
        }
      }
      if (Object.keys(atomicAttrs).length > 0) {
        atomicChanges.attributes = atomicAttrs;
      }
    }

    // Apply atomic changes (non-streaming) in one transaction
    if (atomicChanges.content !== undefined || atomicChanges.attributes) {
      this.doc!.transact(() => {
        this.documentManager.updateBlock(this.doc!, index, atomicChanges);
      }, LOCAL_ORIGIN);
    }

    // Stream each rich-text attribute
    for (const target of streamTargets) {
      let ytext = this.documentManager.getBlockAttributeYText(this.doc!, index, target.attrName);
      if (!ytext) {
        // Y.Text doesn't exist yet — create it atomically before streaming
        this.doc!.transact(() => {
          this.documentManager.updateBlock(this.doc!, index, {
            ...(target.attrName === 'content' ? { content: '' } : { attributes: { [target.attrName]: '' } }),
          });
        }, LOCAL_ORIGIN);
        ytext = this.documentManager.getBlockAttributeYText(this.doc!, index, target.attrName);
      }
      if (ytext) {
        await this.streamTextToYText(ytext, target.newValue, index);
      }
    }
  }

  /**
   * Insert a new block at position.
   *
   * The block structure (with empty content) is inserted atomically,
   * then rich-text content is streamed in progressively.
   * Supports recursive inner blocks.
   */
  async insertBlock(
    position: number,
    block: BlockInput,
  ): Promise<void> {
    this.requireState('editing');

    const blockIndex = String(position);
    const { block: fullBlock, streamTargets } = prepareBlockTree(block, blockIndex);

    // Insert block structure atomically
    this.doc!.transact(() => {
      this.documentManager.insertBlock(this.doc!, position, fullBlock);
    }, LOCAL_ORIGIN);

    // Stream rich-text content (depth-first: parent first, then children)
    await this.streamTargets(streamTargets);
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
   *
   * Old blocks are removed and new block structures (with empty content)
   * are inserted atomically. Rich-text content is then streamed progressively.
   */
  async replaceBlocks(
    startIndex: number,
    count: number,
    newBlocks: BlockInput[],
  ): Promise<void> {
    this.requireState('editing');

    // Prepare all blocks recursively
    const allStreamTargets: StreamTarget[] = [];
    const fullBlocks: Block[] = newBlocks.map((b, i) => {
      const blockIndex = String(startIndex + i);
      const { block, streamTargets } = prepareBlockTree(b, blockIndex);
      allStreamTargets.push(...streamTargets);
      return block;
    });

    // Remove old blocks and insert new structures atomically
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

    // Stream content for all blocks (depth-first order)
    await this.streamTargets(allStreamTargets);
  }

  /**
   * Insert a block as an inner block of an existing block.
   */
  async insertInnerBlock(
    parentIndex: string,
    position: number,
    block: BlockInput,
  ): Promise<void> {
    this.requireState('editing');

    const blockIndex = `${parentIndex}.${position}`;
    const { block: fullBlock, streamTargets } = prepareBlockTree(block, blockIndex);

    this.doc!.transact(() => {
      this.documentManager.insertInnerBlock(this.doc!, parentIndex, position, fullBlock);
    }, LOCAL_ORIGIN);

    await this.streamTargets(streamTargets);
  }

  /**
   * Remove inner blocks from an existing block.
   */
  removeInnerBlocks(parentIndex: string, startIndex: number, count: number): void {
    this.requireState('editing');
    this.doc!.transact(() => {
      this.documentManager.removeInnerBlocks(this.doc!, parentIndex, startIndex, count);
    }, LOCAL_ORIGIN);
  }

  /**
   * Set the post title.
   *
   * Long titles are streamed progressively; short titles are applied atomically.
   */
  async setTitle(title: string): Promise<void> {
    this.requireState('editing');

    if (title.length < STREAM_THRESHOLD) {
      this.doc!.transact(() => {
        this.documentManager.setTitle(this.doc!, title);
      }, LOCAL_ORIGIN);
      return;
    }

    // Get the title Y.Text
    const documentMap = this.documentManager.getDocumentMap(this.doc!);
    let ytext = documentMap.get('title');
    if (!(ytext instanceof Y.Text)) {
      // Create Y.Text if it doesn't exist
      this.doc!.transact(() => {
        const newYText = new Y.Text();
        documentMap.set('title', newYText);
      }, LOCAL_ORIGIN);
      ytext = documentMap.get('title');
    }
    if (ytext instanceof Y.Text) {
      await this.streamTextToYText(ytext, title);
    }
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
   * Stream text into a Y.Text in chunks, flushing the sync client between
   * each chunk so the browser sees progressive updates (like fast typing).
   *
   * 1. Compute the delta between the current and target text.
   * 2. Apply retain + delete atomically (old text removed immediately).
   * 3. Split the insert text into HTML-safe chunks (~20 chars each).
   * 4. For each chunk: apply in its own transaction, flush, and delay.
   */
  /**
   * Stream a list of targets (from prepareBlockTree) into their Y.Text instances.
   */
  private async streamTargets(targets: StreamTarget[]): Promise<void> {
    for (const target of targets) {
      let ytext = this.documentManager.getBlockAttributeYText(this.doc!, target.blockIndex, target.attrName);
      if (!ytext) {
        // Y.Text doesn't exist yet — create it atomically before streaming
        this.doc!.transact(() => {
          this.documentManager.updateBlock(this.doc!, target.blockIndex, {
            ...(target.attrName === 'content' ? { content: '' } : { attributes: { [target.attrName]: '' } }),
          });
        }, LOCAL_ORIGIN);
        ytext = this.documentManager.getBlockAttributeYText(this.doc!, target.blockIndex, target.attrName);
      }
      if (ytext) {
        await this.streamTextToYText(ytext, target.value, target.blockIndex);
      }
    }
  }

  private async streamTextToYText(ytext: Y.Text, newValue: string, blockIndex?: string): Promise<void> {
    const oldValue = ytext.toString();
    const delta = computeTextDelta(oldValue, newValue);
    if (!delta) return;

    // Set cursor to the block being edited
    if (blockIndex !== undefined) {
      this.updateCursorPosition(blockIndex);
    }

    // Apply retain + delete atomically (remove old text immediately)
    if (delta.deleteCount > 0) {
      this.doc!.transact(() => {
        const ops: Array<{ retain?: number; delete?: number }> = [];
        if (delta.prefixLen > 0) ops.push({ retain: delta.prefixLen });
        ops.push({ delete: delta.deleteCount });
        ytext.applyDelta(ops);
      }, LOCAL_ORIGIN);

      if (this.syncClient) {
        this.syncClient.flushQueue();
      }
    }

    // If there's nothing to insert, we're done
    if (delta.insertText.length === 0) return;

    // For short inserts, apply atomically (no streaming overhead)
    if (delta.insertText.length < STREAM_THRESHOLD) {
      this.doc!.transact(() => {
        const ops: Array<{ retain?: number; insert?: string }> = [];
        if (delta.prefixLen > 0) ops.push({ retain: delta.prefixLen });
        ops.push({ insert: delta.insertText });
        ytext.applyDelta(ops);
      }, LOCAL_ORIGIN);
      return;
    }

    // Stream the insert text in chunks.
    // Use Yjs relative positions to track the insertion point so that
    // concurrent edits (e.g., user typing earlier in the block) don't
    // throw off our position. The relative position is created right after
    // inserting a chunk (anchored to a CRDT item), then resolved AFTER the
    // flush+delay when remote edits may have shifted absolute positions.
    let offset = 0;
    let insertPos = delta.prefixLen;
    let nextInsertRelPos: Y.RelativePosition | null = null;

    while (offset < delta.insertText.length) {
      // Early exit: bail if session is no longer active
      if (!this.doc || !this.syncClient) return;

      // If we have a relative position from the previous chunk, resolve it
      // now (after the delay, when remote edits may have been applied).
      if (nextInsertRelPos) {
        const absPos = Y.createAbsolutePositionFromRelativePosition(nextInsertRelPos, this.doc);
        if (absPos) {
          insertPos = absPos.index;
        }
        nextInsertRelPos = null;
      }

      const chunkSize = STREAM_CHUNK_SIZE_MIN + Math.floor(Math.random() * (STREAM_CHUNK_SIZE_MAX - STREAM_CHUNK_SIZE_MIN + 1));
      const chunkEnd = findHtmlSafeChunkEnd(delta.insertText, offset, chunkSize);
      const chunk = delta.insertText.slice(offset, chunkEnd);

      this.doc.transact(() => {
        const ops: Array<{ retain?: number; insert?: string }> = [];
        if (insertPos > 0) ops.push({ retain: insertPos });
        ops.push({ insert: chunk });
        ytext.applyDelta(ops);
      }, LOCAL_ORIGIN);

      // Anchor a relative position at the end of what we just inserted.
      // This tracks the CRDT item, not the absolute offset, so it survives
      // concurrent edits that shift positions.
      insertPos += chunk.length;
      nextInsertRelPos = Y.createRelativePositionFromTypeIndex(ytext, insertPos);

      offset = chunkEnd;

      // Update cursor to the end of the inserted text so far
      this.updateCursorOffset(insertPos);

      // Flush and delay between chunks (but not after the last one)
      if (offset < delta.insertText.length) {
        this.syncClient.flushQueue();
        await new Promise((resolve) => setTimeout(resolve, STREAM_CHUNK_DELAY_MS));
      }
    }
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

  /**
   * Update just the cursor offset within the current awareness position.
   * Used during streaming to move the cursor forward as text is typed.
   */
  private updateCursorOffset(offset: number): void {
    if (!this.awarenessState?.editorState?.selection) return;
    const selection = this.awarenessState.editorState.selection;
    if (selection.type === 'cursor') {
      selection.cursorPosition.absoluteOffset = offset;
    }
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
