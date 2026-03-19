import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  blockToYMap,
  yMapToBlock,
  updateYText,
  deltaUpdateYText,
} from '#yjs/block-converter';
import type { Block } from '#yjs/types';

/**
 * Helper: create a Y.Map from a block and integrate it into a Y.Doc
 * so that Yjs allows reading its contents.
 */
function integratedBlockToYMap(block: Block): Y.Map<unknown> {
  const doc = new Y.Doc();
  const arr = doc.getArray<Y.Map<unknown>>('blocks');
  const ymap = blockToYMap(block);
  arr.push([ymap]);
  return arr.get(0);
}

describe('blockToYMap', () => {
  it('converts a plain paragraph block to a Y.Map', () => {
    const block: Block = {
      name: 'core/paragraph',
      clientId: 'abc-123',
      attributes: { content: 'Hello world' },
      innerBlocks: [],
    };

    const ymap = integratedBlockToYMap(block);

    expect(ymap.get('name')).toBe('core/paragraph');
    expect(ymap.get('clientId')).toBe('abc-123');

    const attrs = ymap.get('attributes') as Y.Map<unknown>;
    // content is a rich-text attribute for core/paragraph, so it should be Y.Text
    const content = attrs.get('content');
    expect(content).toBeInstanceOf(Y.Text);
    expect((content as Y.Text).toString()).toBe('Hello world');

    const innerBlocks = ymap.get('innerBlocks') as Y.Array<unknown>;
    expect(innerBlocks.length).toBe(0);
  });

  it('stores non-rich-text attributes as plain values', () => {
    const block: Block = {
      name: 'core/image',
      clientId: 'img-1',
      attributes: { url: 'https://example.com/img.png', alt: 'An image' },
      innerBlocks: [],
    };

    const ymap = integratedBlockToYMap(block);
    const attrs = ymap.get('attributes') as Y.Map<unknown>;

    // core/image is not in RICH_TEXT_ATTRIBUTES, so attributes are plain
    expect(attrs.get('url')).toBe('https://example.com/img.png');
    expect(attrs.get('alt')).toBe('An image');
    expect(attrs.get('url')).not.toBeInstanceOf(Y.Text);
  });

  it('handles blocks with no attributes', () => {
    const block: Block = {
      name: 'core/separator',
      clientId: 'sep-1',
      attributes: {},
      innerBlocks: [],
    };

    const ymap = integratedBlockToYMap(block);
    const attrs = ymap.get('attributes') as Y.Map<unknown>;
    expect(attrs.size).toBe(0);
  });

  it('handles nested blocks (list with list-items)', () => {
    const block: Block = {
      name: 'core/list',
      clientId: 'list-1',
      attributes: {},
      innerBlocks: [
        {
          name: 'core/list-item',
          clientId: 'item-1',
          attributes: { content: 'First item' },
          innerBlocks: [],
        },
        {
          name: 'core/list-item',
          clientId: 'item-2',
          attributes: { content: 'Second item' },
          innerBlocks: [],
        },
      ],
    };

    const ymap = integratedBlockToYMap(block);
    const innerBlocks = ymap.get('innerBlocks') as Y.Array<Y.Map<unknown>>;
    expect(innerBlocks.length).toBe(2);

    const firstItem = innerBlocks.get(0);
    expect(firstItem.get('name')).toBe('core/list-item');

    const firstAttrs = firstItem.get('attributes') as Y.Map<unknown>;
    const firstContent = firstAttrs.get('content');
    expect(firstContent).toBeInstanceOf(Y.Text);
    expect((firstContent as Y.Text).toString()).toBe('First item');
  });

  it('preserves isValid and originalContent', () => {
    const block: Block = {
      name: 'core/paragraph',
      clientId: 'p-1',
      attributes: { content: 'test' },
      innerBlocks: [],
      isValid: true,
      originalContent: '<p>test</p>',
    };

    const ymap = integratedBlockToYMap(block);
    expect(ymap.get('isValid')).toBe(true);
    expect(ymap.get('originalContent')).toBe('<p>test</p>');
  });
});

describe('yMapToBlock', () => {
  it('converts a Y.Map back to a plain Block', () => {
    const block: Block = {
      name: 'core/heading',
      clientId: 'h-1',
      attributes: { content: 'My Heading', level: 2 },
      innerBlocks: [],
    };

    const ymap = integratedBlockToYMap(block);
    const result = yMapToBlock(ymap);

    expect(result.name).toBe('core/heading');
    expect(result.clientId).toBe('h-1');
    expect(result.attributes.content).toBe('My Heading');
    expect(result.attributes.level).toBe(2);
    expect(result.innerBlocks).toEqual([]);
  });

  it('round-trips a block with nested inner blocks', () => {
    const original: Block = {
      name: 'core/list',
      clientId: 'list-1',
      attributes: {},
      innerBlocks: [
        {
          name: 'core/list-item',
          clientId: 'item-1',
          attributes: { content: 'Item A' },
          innerBlocks: [],
        },
      ],
    };

    const ymap = integratedBlockToYMap(original);
    const roundTripped = yMapToBlock(ymap);

    expect(roundTripped.name).toBe('core/list');
    expect(roundTripped.innerBlocks).toHaveLength(1);
    expect(roundTripped.innerBlocks[0].name).toBe('core/list-item');
    expect(roundTripped.innerBlocks[0].attributes.content).toBe('Item A');
  });

  it('preserves optional fields only when present', () => {
    const blockWithout: Block = {
      name: 'core/paragraph',
      clientId: 'p-1',
      attributes: { content: 'text' },
      innerBlocks: [],
    };

    const result = yMapToBlock(integratedBlockToYMap(blockWithout));
    expect(result.isValid).toBeUndefined();
    expect(result.originalContent).toBeUndefined();

    const blockWith: Block = {
      name: 'core/paragraph',
      clientId: 'p-2',
      attributes: { content: 'text' },
      innerBlocks: [],
      isValid: false,
      originalContent: '<p>text</p>',
    };

    const result2 = yMapToBlock(integratedBlockToYMap(blockWith));
    expect(result2.isValid).toBe(false);
    expect(result2.originalContent).toBe('<p>text</p>');
  });
});

describe('updateYText', () => {
  it('replaces content of an empty Y.Text', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('test');
    updateYText(ytext, 'Hello');
    expect(ytext.toString()).toBe('Hello');
  });

  it('replaces existing content', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('test');
    ytext.insert(0, 'Old content');
    updateYText(ytext, 'New content');
    expect(ytext.toString()).toBe('New content');
  });

  it('clears content when given empty string', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('test');
    ytext.insert(0, 'Some content');
    updateYText(ytext, '');
    expect(ytext.toString()).toBe('');
  });

  it('handles replacing with the same content', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('test');
    ytext.insert(0, 'Same');
    updateYText(ytext, 'Same');
    expect(ytext.toString()).toBe('Same');
  });
});

describe('deltaUpdateYText', () => {
  it('is a no-op when text is the same', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('test');
    ytext.insert(0, 'Hello world');

    // Track if any delta is applied
    let updateCount = 0;
    doc.on('update', () => { updateCount++; });

    deltaUpdateYText(ytext, 'Hello world');
    expect(ytext.toString()).toBe('Hello world');
    expect(updateCount).toBe(0);
  });

  it('handles complete replacement', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('test');
    ytext.insert(0, 'Hello world');

    deltaUpdateYText(ytext, 'Goodbye universe');
    expect(ytext.toString()).toBe('Goodbye universe');
  });

  it('handles prefix change', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('test');
    ytext.insert(0, 'Hello world');

    deltaUpdateYText(ytext, 'Howdy world');
    expect(ytext.toString()).toBe('Howdy world');
  });

  it('handles suffix change', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('test');
    ytext.insert(0, 'Hello world');

    deltaUpdateYText(ytext, 'Hello there');
    expect(ytext.toString()).toBe('Hello there');
  });

  it('handles middle insertion', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('test');
    ytext.insert(0, 'Hello world');

    deltaUpdateYText(ytext, 'Hello beautiful world');
    expect(ytext.toString()).toBe('Hello beautiful world');
  });

  it('handles middle deletion', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('test');
    ytext.insert(0, 'Hello beautiful world');

    deltaUpdateYText(ytext, 'Hello world');
    expect(ytext.toString()).toBe('Hello world');
  });

  it('handles empty to non-empty', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('test');

    deltaUpdateYText(ytext, 'Hello');
    expect(ytext.toString()).toBe('Hello');
  });

  it('handles non-empty to empty', () => {
    const doc = new Y.Doc();
    const ytext = doc.getText('test');
    ytext.insert(0, 'Hello');

    deltaUpdateYText(ytext, '');
    expect(ytext.toString()).toBe('');
  });

  it('syncs delta edits between two clients', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    // Set up initial text on doc1 and sync to doc2
    const ytext1 = doc1.getText('test');
    ytext1.insert(0, 'Hello world');

    const updates1: Uint8Array[] = [];
    doc1.on('update', (update: Uint8Array) => { updates1.push(update); });
    const updates2: Uint8Array[] = [];
    doc2.on('update', (update: Uint8Array) => { updates2.push(update); });

    // Sync initial state
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));

    expect(doc2.getText('test').toString()).toBe('Hello world');

    // Apply delta edit on doc1
    updates1.length = 0;
    deltaUpdateYText(ytext1, 'Hello there');

    // Apply doc1's update to doc2
    for (const update of updates1) {
      Y.applyUpdate(doc2, update);
    }

    expect(doc2.getText('test').toString()).toBe('Hello there');
  });

  it('handles concurrent delta edits to different parts', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    // Set up initial text and sync
    const ytext1 = doc1.getText('test');
    ytext1.insert(0, 'AAABBBCCC');
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc1));

    const updates1: Uint8Array[] = [];
    doc1.on('update', (update: Uint8Array) => { updates1.push(update); });
    const updates2: Uint8Array[] = [];
    doc2.on('update', (update: Uint8Array) => { updates2.push(update); });

    // Doc1 changes prefix: "AAA" → "XXX"
    deltaUpdateYText(doc1.getText('test'), 'XXXBBBCCC');

    // Doc2 changes suffix: "CCC" → "ZZZ"
    deltaUpdateYText(doc2.getText('test'), 'AAABBBZZZ');

    // Exchange updates
    for (const update of updates1) {
      Y.applyUpdate(doc2, update);
    }
    for (const update of updates2) {
      Y.applyUpdate(doc1, update);
    }

    // Both should converge (exact result depends on CRDT resolution,
    // but both docs must agree)
    expect(doc1.getText('test').toString()).toBe(doc2.getText('test').toString());
    // With non-overlapping edits, both should be applied
    const result = doc1.getText('test').toString();
    expect(result).toContain('XXX');
    expect(result).toContain('BBB');
    expect(result).toContain('ZZZ');
  });
});
