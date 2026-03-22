/**
 * Manages Y.Doc lifecycle for WordPress post collaborative editing.
 *
 * Each Y.Doc mirrors the structure Gutenberg expects:
 * - Root map 'document': holds post fields (title, content, blocks, etc.)
 * - Root map 'state': holds sync metadata (version, savedAt, savedBy)
 */
import * as Y from 'yjs';
import {
  type Block,
  CRDT_DOC_VERSION,
  CRDT_RECORD_MAP_KEY,
  CRDT_STATE_MAP_KEY,
  CRDT_STATE_MAP_SAVED_AT_KEY,
  CRDT_STATE_MAP_SAVED_BY_KEY,
  CRDT_STATE_MAP_VERSION_KEY,
} from './types.js';
import {
  blockToYMap,
  deltaUpdateYText,
  yMapToBlock,
} from './block-converter.js';
import { BlockTypeRegistry } from './block-type-registry.js';

export class DocumentManager {
  private registry: BlockTypeRegistry;

  constructor(registry?: BlockTypeRegistry) {
    this.registry = registry ?? BlockTypeRegistry.createFallback();
  }

  /**
   * Update the registry (e.g., after fetching block types from the API).
   */
  setRegistry(registry: BlockTypeRegistry): void {
    this.registry = registry;
  }

  /**
   * Get the current block type registry.
   */
  getRegistry(): BlockTypeRegistry {
    return this.registry;
  }

  /**
   * Create a new Y.Doc initialized with Gutenberg's expected structure.
   */
  createDoc(): Y.Doc {
    const doc = new Y.Doc();

    doc.transact(() => {
      // Initialize state map only — matches Gutenberg's initializeYjsDoc.
      // Do NOT pre-populate the document map with empty Y.Text/Y.Array.
      // Those keys will be created on demand when content is first set,
      // or populated from a remote peer's state via sync.
      // Pre-creating them would cause CRDT merge conflicts during sync
      // (two competing values for the same Y.Map key).
      const stateMap = doc.getMap(CRDT_STATE_MAP_KEY);
      stateMap.set(CRDT_STATE_MAP_VERSION_KEY, CRDT_DOC_VERSION);
    });

    return doc;
  }

  /**
   * Get the root 'document' Y.Map.
   */
  getDocumentMap(doc: Y.Doc): Y.Map<unknown> {
    return doc.getMap(CRDT_RECORD_MAP_KEY);
  }

  /**
   * Get the root 'state' Y.Map.
   */
  getStateMap(doc: Y.Doc): Y.Map<unknown> {
    return doc.getMap(CRDT_STATE_MAP_KEY);
  }

  /**
   * Read the title as a plain string.
   */
  getTitle(doc: Y.Doc): string {
    const documentMap = this.getDocumentMap(doc);
    const title = documentMap.get('title');
    if (title instanceof Y.Text) {
      return title.toString();
    }
    return '';
  }

  /**
   * Set the title (replaces full Y.Text content).
   */
  setTitle(doc: Y.Doc, title: string): void {
    doc.transact(() => {
      const documentMap = this.getDocumentMap(doc);
      const ytext = documentMap.get('title');
      if (ytext instanceof Y.Text) {
        deltaUpdateYText(ytext, title);
      } else {
        const newYText = new Y.Text();
        newYText.insert(0, title);
        documentMap.set('title', newYText);
      }
    });
  }

  /**
   * Get all blocks as plain Block[] objects.
   */
  getBlocks(doc: Y.Doc): Block[] {
    const documentMap = this.getDocumentMap(doc);
    const blocksArray = documentMap.get('blocks') as
      | Y.Array<Y.Map<unknown>>
      | undefined;
    if (!blocksArray) {
      return [];
    }

    const blocks: Block[] = [];
    for (let i = 0; i < blocksArray.length; i++) {
      blocks.push(yMapToBlock(blocksArray.get(i)));
    }
    return blocks;
  }

  /**
   * Set blocks from plain Block[] objects (replaces all existing blocks).
   */
  setBlocks(doc: Y.Doc, blocks: Block[]): void {
    doc.transact(() => {
      const documentMap = this.getDocumentMap(doc);
      let blocksArray = documentMap.get('blocks') as Y.Array<
        Y.Map<unknown>
      > | undefined;

      if (!blocksArray) {
        blocksArray = new Y.Array<Y.Map<unknown>>();
        documentMap.set('blocks', blocksArray);
      }

      // Clear existing blocks
      if (blocksArray.length > 0) {
        blocksArray.delete(0, blocksArray.length);
      }

      // Insert new blocks
      const ymaps = blocks.map((block) => blockToYMap(block, this.registry));
      blocksArray.push(ymaps);
    });
  }

  /**
   * Get a single block by index. Supports dot notation for nested blocks
   * (e.g., "2.1" means inner block at index 1 of top-level block at index 2).
   */
  getBlockByIndex(doc: Y.Doc, index: string): Block | null {
    const ymap = this._resolveBlockYMap(doc, index);
    if (!ymap) {
      return null;
    }
    return yMapToBlock(ymap);
  }

  /**
   * Update a block's content and/or attributes at a given index.
   */
  updateBlock(
    doc: Y.Doc,
    index: string,
    changes: { content?: string; attributes?: Record<string, unknown> },
  ): void {
    doc.transact(() => {
      const ymap = this._resolveBlockYMap(doc, index);
      if (!ymap) {
        return;
      }

      const blockName = ymap.get('name') as string;
      const attrMap = ymap.get('attributes') as Y.Map<unknown>;

      if (changes.content !== undefined) {
        // 'content' is the primary rich-text attribute for most blocks
        if (this.registry.isRichTextAttribute(blockName, 'content')) {
          const ytext = attrMap.get('content');
          if (ytext instanceof Y.Text) {
            deltaUpdateYText(ytext, changes.content);
          } else {
            // Create Y.Text if it doesn't exist yet
            const newYText = new Y.Text();
            newYText.insert(0, changes.content);
            attrMap.set('content', newYText);
          }
        } else {
          attrMap.set('content', changes.content);
        }
      }

      if (changes.attributes) {
        for (const [key, value] of Object.entries(changes.attributes)) {
          if (
            this.registry.isRichTextAttribute(blockName, key) &&
            typeof value === 'string'
          ) {
            const existing = attrMap.get(key);
            if (existing instanceof Y.Text) {
              deltaUpdateYText(existing, value);
            } else {
              const newYText = new Y.Text();
              newYText.insert(0, value);
              attrMap.set(key, newYText);
            }
          } else {
            attrMap.set(key, value);
          }
        }
      }
    });
  }

  /**
   * Insert a block at the given position in the top-level blocks array.
   */
  insertBlock(doc: Y.Doc, position: number, block: Block): void {
    doc.transact(() => {
      const documentMap = this.getDocumentMap(doc);
      let blocksArray = documentMap.get('blocks') as Y.Array<
        Y.Map<unknown>
      > | undefined;
      if (!blocksArray) {
        blocksArray = new Y.Array<Y.Map<unknown>>();
        documentMap.set('blocks', blocksArray);
      }
      const ymap = blockToYMap(block, this.registry);
      blocksArray.insert(position, [ymap]);
    });
  }

  /**
   * Remove `count` blocks starting at `startIndex`.
   */
  removeBlocks(doc: Y.Doc, startIndex: number, count: number): void {
    doc.transact(() => {
      const documentMap = this.getDocumentMap(doc);
      const blocksArray = documentMap.get('blocks') as Y.Array<
        Y.Map<unknown>
      >;
      blocksArray.delete(startIndex, count);
    });
  }

  /**
   * Insert a block as an inner block of a parent block.
   */
  insertInnerBlock(doc: Y.Doc, parentIndex: string, position: number, block: Block): void {
    doc.transact(() => {
      const parentYMap = this._resolveBlockYMap(doc, parentIndex);
      if (!parentYMap) {
        throw new Error(`Block not found at index ${parentIndex}`);
      }

      let innerBlocksArray = parentYMap.get('innerBlocks') as Y.Array<Y.Map<unknown>> | undefined;
      if (!innerBlocksArray) {
        innerBlocksArray = new Y.Array<Y.Map<unknown>>();
        parentYMap.set('innerBlocks', innerBlocksArray);
      }

      const ymap = blockToYMap(block, this.registry);
      innerBlocksArray.insert(position, [ymap]);
    });
  }

  /**
   * Remove inner blocks from a parent block.
   */
  removeInnerBlocks(doc: Y.Doc, parentIndex: string, startIndex: number, count: number): void {
    doc.transact(() => {
      const parentYMap = this._resolveBlockYMap(doc, parentIndex);
      if (!parentYMap) {
        throw new Error(`Block not found at index ${parentIndex}`);
      }

      const innerBlocksArray = parentYMap.get('innerBlocks') as Y.Array<Y.Map<unknown>> | undefined;
      if (!innerBlocksArray) {
        throw new Error(`Block at ${parentIndex} has no inner blocks`);
      }

      innerBlocksArray.delete(startIndex, count);
    });
  }

  /**
   * Move a block from one position to another.
   */
  moveBlock(doc: Y.Doc, fromIndex: number, toIndex: number): void {
    doc.transact(() => {
      const documentMap = this.getDocumentMap(doc);
      const blocksArray = documentMap.get('blocks') as Y.Array<
        Y.Map<unknown>
      >;

      // Read the block at fromIndex as a plain object, then re-insert
      const block = yMapToBlock(blocksArray.get(fromIndex));
      blocksArray.delete(fromIndex, 1);

      // Adjust target index if removing shifts it
      const adjustedIndex = fromIndex < toIndex ? toIndex - 1 : toIndex;
      const ymap = blockToYMap(block, this.registry);
      blocksArray.insert(adjustedIndex, [ymap]);
    });
  }

  /**
   * Mark the document as saved by updating the state map.
   */
  markSaved(doc: Y.Doc): void {
    doc.transact(() => {
      const stateMap = this.getStateMap(doc);
      stateMap.set(CRDT_STATE_MAP_SAVED_AT_KEY, Date.now());
      stateMap.set(CRDT_STATE_MAP_SAVED_BY_KEY, doc.clientID);
    });
  }

  /**
   * Get the content field as a string.
   */
  getContent(doc: Y.Doc): string {
    const documentMap = this.getDocumentMap(doc);
    const content = documentMap.get('content');
    if (content instanceof Y.Text) {
      return content.toString();
    }
    return '';
  }

  /**
   * Set the content field.
   */
  setContent(doc: Y.Doc, content: string): void {
    doc.transact(() => {
      const documentMap = this.getDocumentMap(doc);
      const ytext = documentMap.get('content');
      if (ytext instanceof Y.Text) {
        deltaUpdateYText(ytext, content);
      } else {
        const newYText = new Y.Text();
        newYText.insert(0, content);
        documentMap.set('content', newYText);
      }
    });
  }

  /**
   * Get a post property from the document map.
   */
  getProperty(doc: Y.Doc, key: string): unknown {
    const documentMap = this.getDocumentMap(doc);
    const value = documentMap.get(key);
    if (value instanceof Y.Text) {
      return value.toString();
    }
    return value;
  }

  /**
   * Set a post property in the document map.
   */
  setProperty(doc: Y.Doc, key: string, value: unknown): void {
    doc.transact(() => {
      const documentMap = this.getDocumentMap(doc);
      const existing = documentMap.get(key);
      if (existing instanceof Y.Text && typeof value === 'string') {
        deltaUpdateYText(existing, value);
      } else {
        documentMap.set(key, value);
      }
    });
  }

  /**
   * Get the raw Y.Text for a block attribute.
   * Returns null if the block doesn't exist, the attribute doesn't exist,
   * or the attribute is not a Y.Text (i.e., not a rich-text attribute).
   */
  getBlockAttributeYText(doc: Y.Doc, index: string, attrName: string): Y.Text | null {
    const ymap = this._resolveBlockYMap(doc, index);
    if (!ymap) return null;
    const attrMap = ymap.get('attributes') as Y.Map<unknown> | undefined;
    if (!attrMap) return null;
    const attr = attrMap.get(attrName);
    return attr instanceof Y.Text ? attr : null;
  }

  /**
   * Get the raw Y.Text for a block's content attribute.
   * Returns null if the block or content attribute doesn't exist.
   */
  getBlockContentYText(doc: Y.Doc, index: string): Y.Text | null {
    return this.getBlockAttributeYText(doc, index, 'content');
  }

  /**
   * Set the noteId in a block's metadata attribute.
   * Metadata is a plain JS object stored in the block's attribute Y.Map.
   * Performs read-modify-write to preserve any existing metadata keys.
   */
  setBlockNoteId(doc: Y.Doc, index: string, noteId: number): void {
    doc.transact(() => {
      const ymap = this._resolveBlockYMap(doc, index);
      if (!ymap) {
        throw new Error(`Block not found at index ${index}`);
      }

      const attrMap = ymap.get('attributes') as Y.Map<unknown>;
      const currentMetadata =
        (attrMap.get('metadata') as Record<string, unknown> | undefined) ?? {};
      attrMap.set('metadata', { ...currentMetadata, noteId });
    });
  }

  /**
   * Remove the noteId from a block's metadata attribute.
   * If noteId was the only key, the metadata key is deleted entirely.
   * If the block has no metadata or no noteId, this is a no-op.
   */
  removeBlockNoteId(doc: Y.Doc, index: string): void {
    doc.transact(() => {
      const ymap = this._resolveBlockYMap(doc, index);
      if (!ymap) {
        throw new Error(`Block not found at index ${index}`);
      }

      const attrMap = ymap.get('attributes') as Y.Map<unknown>;
      const currentMetadata = attrMap.get('metadata') as
        | Record<string, unknown>
        | undefined;

      if (!currentMetadata || !('noteId' in currentMetadata)) {
        return;
      }

      const { noteId: _, ...rest } = currentMetadata;
      if (Object.keys(rest).length === 0) {
        attrMap.delete('metadata');
      } else {
        attrMap.set('metadata', rest);
      }
    });
  }

  /**
   * Resolve a dot-notation index to a Y.Map block reference.
   * E.g., "2" → top-level block 2, "2.1" → inner block 1 of block 2.
   */
  private _resolveBlockYMap(
    doc: Y.Doc,
    index: string,
  ): Y.Map<unknown> | null {
    const parts = index.split('.').map(Number);
    const documentMap = this.getDocumentMap(doc);
    const blocksArray = documentMap.get('blocks') as Y.Array<
      Y.Map<unknown>
    >;

    if (parts.length === 0 || isNaN(parts[0])) {
      return null;
    }

    let current: Y.Map<unknown> | null = null;
    let currentArray: Y.Array<Y.Map<unknown>> = blocksArray;

    for (const part of parts) {
      if (part < 0 || part >= currentArray.length) {
        return null;
      }
      current = currentArray.get(part);
      // For next iteration, if there are more parts, descend into innerBlocks
      const innerBlocks = current.get('innerBlocks') as
        | Y.Array<Y.Map<unknown>>
        | undefined;
      if (innerBlocks) {
        currentArray = innerBlocks;
      }
    }

    return current;
  }
}
