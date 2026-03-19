/**
 * Converts between plain Block objects and Yjs Y.Map types.
 *
 * Handles the mapping of rich-text attributes to Y.Text instances
 * based on the block type's known schema.
 */
import * as Y from 'yjs';
import { type Block, isRichTextAttribute } from './types.js';

/**
 * Convert a plain Block object to a Y.Map suitable for insertion into the Y.Doc.
 *
 * Rich-text attributes (as determined by the block type) are stored as Y.Text.
 * All other attributes are stored as plain values.
 */
export function blockToYMap(block: Block): Y.Map<unknown> {
  const ymap = new Y.Map<unknown>();

  ymap.set('name', block.name);
  ymap.set('clientId', block.clientId);

  if (block.isValid !== undefined) {
    ymap.set('isValid', block.isValid);
  }
  if (block.originalContent !== undefined) {
    ymap.set('originalContent', block.originalContent);
  }

  // Attributes: rich-text ones become Y.Text, others stay as plain values
  const attrMap = new Y.Map<unknown>();
  if (block.attributes) {
    for (const [key, value] of Object.entries(block.attributes)) {
      if (isRichTextAttribute(block.name, key) && typeof value === 'string') {
        const ytext = new Y.Text();
        ytext.insert(0, value);
        attrMap.set(key, ytext);
      } else {
        attrMap.set(key, value);
      }
    }
  }
  ymap.set('attributes', attrMap);

  // Inner blocks: recurse
  const innerBlocksArray = new Y.Array<Y.Map<unknown>>();
  if (block.innerBlocks && block.innerBlocks.length > 0) {
    const innerMaps = block.innerBlocks.map((inner) => blockToYMap(inner));
    innerBlocksArray.push(innerMaps);
  }
  ymap.set('innerBlocks', innerBlocksArray);

  return ymap;
}

/**
 * Convert a Y.Map block from the Y.Doc to a plain Block object.
 *
 * Y.Text attributes are converted to their string representation.
 */
export function yMapToBlock(ymap: Y.Map<unknown>): Block {
  const name = ymap.get('name') as string;
  const clientId = ymap.get('clientId') as string;

  // Read attributes, converting Y.Text to strings
  const attrMap = ymap.get('attributes') as Y.Map<unknown> | undefined;
  const attributes: Record<string, unknown> = {};
  if (attrMap) {
    for (const [key, value] of attrMap.entries()) {
      if (value instanceof Y.Text) {
        attributes[key] = value.toString();
      } else {
        attributes[key] = value;
      }
    }
  }

  // Read inner blocks recursively
  const innerBlocksArray = ymap.get('innerBlocks') as
    | Y.Array<Y.Map<unknown>>
    | undefined;
  const innerBlocks: Block[] = [];
  if (innerBlocksArray) {
    for (let i = 0; i < innerBlocksArray.length; i++) {
      innerBlocks.push(yMapToBlock(innerBlocksArray.get(i)));
    }
  }

  const block: Block = {
    name,
    clientId,
    attributes,
    innerBlocks,
  };

  const isValid = ymap.get('isValid');
  if (isValid !== undefined) {
    block.isValid = isValid as boolean;
  }

  const originalContent = ymap.get('originalContent');
  if (originalContent !== undefined) {
    block.originalContent = originalContent as string;
  }

  return block;
}

/**
 * Update a Y.Text with a new string value using full replacement.
 *
 * WARNING: This uses delete-all + insert which targets specific CRDT items by ID.
 * In multi-client scenarios where the browser creates LOCAL Y.Text items alongside
 * REMOTE items (e.g. after `applyChangesToCRDTDoc`), the delete only removes our
 * items while the browser's survive — so the visible content doesn't change.
 *
 * For live collaborative editing, use `deltaUpdateYText()` instead.
 */
export function updateYText(ytext: Y.Text, newValue: string): void {
  if (ytext.length > 0) {
    ytext.delete(0, ytext.length);
  }
  if (newValue.length > 0) {
    ytext.insert(0, newValue);
  }
}

/**
 * Update a Y.Text using delta-based editing via `Y.Text.applyDelta()`.
 *
 * Uses a simple common-prefix/common-suffix diff to compute the minimal
 * retain/delete/insert operations. Delta operations are POSITION-BASED,
 * not item-ID-based, so they operate on whatever CRDT items exist at
 * those positions — whether created by the browser or by us.
 *
 * This is the correct approach for live collaborative editing where
 * Gutenberg's `applyChangesToCRDTDoc` creates local items alongside
 * remote items in Y.Text.
 */
export function deltaUpdateYText(ytext: Y.Text, newValue: string): void {
  const oldValue = ytext.toString();
  if (oldValue === newValue) return;

  // Find common prefix
  let prefixLen = 0;
  while (
    prefixLen < oldValue.length &&
    prefixLen < newValue.length &&
    oldValue[prefixLen] === newValue[prefixLen]
  ) {
    prefixLen++;
  }

  // Find common suffix (don't overlap with prefix)
  let suffixLen = 0;
  while (
    suffixLen < oldValue.length - prefixLen &&
    suffixLen < newValue.length - prefixLen &&
    oldValue[oldValue.length - 1 - suffixLen] ===
      newValue[newValue.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const deleteCount = oldValue.length - prefixLen - suffixLen;
  const insertText = newValue.slice(prefixLen, newValue.length - suffixLen);

  // Build delta ops
  const ops: Array<{ retain?: number; delete?: number; insert?: string }> = [];
  if (prefixLen > 0) ops.push({ retain: prefixLen });
  if (deleteCount > 0) ops.push({ delete: deleteCount });
  if (insertText.length > 0) ops.push({ insert: insertText });

  if (ops.length > 0) {
    ytext.applyDelta(ops);
  }
}
