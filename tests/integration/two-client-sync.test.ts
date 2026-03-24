import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { DocumentManager } from '#yjs/document-manager';
import {
  createSyncStep1,
  createSyncStep2,
  processIncomingUpdate,
  createUpdateFromChange,
  createCompactionUpdate,
  base64ToUint8Array,
} from '#yjs/sync-protocol';
import type { Block } from '#yjs/types';
import type { SyncUpdate } from '#wordpress/types';

function makeParagraph(content: string): Block {
  return {
    name: 'core/paragraph',
    clientId: crypto.randomUUID(),
    attributes: { content },
    innerBlocks: [],
  };
}

/**
 * Helper: create a second client doc by syncing from a primary doc.
 * This mirrors real-world usage where a new client gets state from the server.
 */
function syncNewClient(sourceDoc: Y.Doc): Y.Doc {
  const newDoc = new Y.Doc();
  const compaction = createCompactionUpdate(sourceDoc);
  processIncomingUpdate(newDoc, compaction);
  return newDoc;
}

describe('Two-client sync integration', () => {
  it('syncs content from client A to client B via updates', () => {
    const manager = new DocumentManager();
    const docA = manager.createDoc();

    // Sync initial (empty) structure to B
    const docB = syncNewClient(docA);

    // Collect updates from docA
    const updatesFromA: Uint8Array[] = [];
    docA.on('update', (update: Uint8Array) => {
      updatesFromA.push(update);
    });

    // Client A creates content
    manager.setTitle(docA, 'My Post');
    manager.setBlocks(docA, [
      makeParagraph('Hello from client A'),
      makeParagraph('Second paragraph'),
    ]);

    // Apply all updates to client B
    for (const update of updatesFromA) {
      const syncUpdate = createUpdateFromChange(update);
      processIncomingUpdate(docB, syncUpdate);
    }

    // Both docs should converge
    expect(manager.getTitle(docB)).toBe('My Post');
    const blocksB = manager.getBlocks(docB);
    expect(blocksB).toHaveLength(2);
    expect(blocksB[0].attributes.content).toBe('Hello from client A');
    expect(blocksB[1].attributes.content).toBe('Second paragraph');
  });

  it('syncs via the full step1/step2 handshake', () => {
    const manager = new DocumentManager();
    const docA = manager.createDoc();

    // Client A adds content
    manager.setTitle(docA, 'Sync Test');
    manager.setBlocks(docA, [makeParagraph('Content from A')]);

    // Client B is brand new (no shared structure)
    const docB = new Y.Doc();

    // Step 1: Client B sends its state vector to Client A
    const step1FromB = createSyncStep1(docB);

    // Step 2: Client A processes step1 and generates step2 with missing updates
    const step2FromA = createSyncStep2(docA, base64ToUint8Array(step1FromB.data));

    // Client B applies step2
    processIncomingUpdate(docB, step2FromA);

    // Both docs should now have the same content
    expect(manager.getTitle(docB)).toBe('Sync Test');
    expect(manager.getBlocks(docB)).toHaveLength(1);
    expect(manager.getBlocks(docB)[0].attributes.content).toBe('Content from A');
  });

  it('handles bidirectional sync via step1/step2', () => {
    const manager = new DocumentManager();
    const docA = manager.createDoc();

    // Sync initial structure to B so they share the same Yjs items
    const docB = syncNewClient(docA);

    // Both clients add different content
    manager.setTitle(docA, 'Title from A');
    manager.setProperty(docA, 'status', 'draft');

    manager.setProperty(docB, 'slug', 'post-from-b');
    manager.setProperty(docB, 'author', 99);

    // A -> B sync
    const step1B = createSyncStep1(docB);
    const step2A = createSyncStep2(docA, base64ToUint8Array(step1B.data));
    processIncomingUpdate(docB, step2A);

    // B -> A sync
    const step1A = createSyncStep1(docA);
    const step2B = createSyncStep2(docB, base64ToUint8Array(step1A.data));
    processIncomingUpdate(docA, step2B);

    // Both should have all properties
    expect(manager.getTitle(docA)).toBe('Title from A');
    expect(manager.getTitle(docB)).toBe('Title from A');
    expect(manager.getProperty(docA, 'status')).toBe('draft');
    expect(manager.getProperty(docB, 'status')).toBe('draft');
    expect(manager.getProperty(docA, 'slug')).toBe('post-from-b');
    expect(manager.getProperty(docB, 'slug')).toBe('post-from-b');
    expect(manager.getProperty(docA, 'author')).toBe(99);
    expect(manager.getProperty(docB, 'author')).toBe(99);
  });

  it('handles concurrent edits to different blocks', () => {
    const manager = new DocumentManager();
    const docA = manager.createDoc();

    // Set initial content on A
    const initialBlocks = [
      makeParagraph('Block 1'),
      makeParagraph('Block 2'),
      makeParagraph('Block 3'),
    ];
    manager.setBlocks(docA, initialBlocks);

    // Sync initial state to B via compaction
    const docB = syncNewClient(docA);

    // Verify initial state is the same
    expect(manager.getBlocks(docB)).toHaveLength(3);

    // Collect updates from both clients
    const updatesFromA: SyncUpdate[] = [];
    const updatesFromB: SyncUpdate[] = [];

    docA.on('update', (update: Uint8Array) => {
      updatesFromA.push(createUpdateFromChange(update));
    });
    docB.on('update', (update: Uint8Array) => {
      updatesFromB.push(createUpdateFromChange(update));
    });

    // Client A edits block 0
    manager.updateBlock(docA, '0', { content: 'Block 1 edited by A' });

    // Client B edits block 2
    manager.updateBlock(docB, '2', { content: 'Block 3 edited by B' });

    // Exchange updates
    for (const update of updatesFromA) {
      processIncomingUpdate(docB, update);
    }
    for (const update of updatesFromB) {
      processIncomingUpdate(docA, update);
    }

    // Both docs should reflect both edits
    const blocksA = manager.getBlocks(docA);
    const blocksB = manager.getBlocks(docB);

    expect(blocksA[0].attributes.content).toBe('Block 1 edited by A');
    expect(blocksA[2].attributes.content).toBe('Block 3 edited by B');

    expect(blocksB[0].attributes.content).toBe('Block 1 edited by A');
    expect(blocksB[2].attributes.content).toBe('Block 3 edited by B');

    // Middle block should be unchanged
    expect(blocksA[1].attributes.content).toBe('Block 2');
    expect(blocksB[1].attributes.content).toBe('Block 2');
  });

  it('syncs delta-based text edits from one client to another', () => {
    const manager = new DocumentManager();
    const docA = manager.createDoc();

    // Set initial content
    manager.setBlocks(docA, [makeParagraph('Hello world')]);

    // Sync to client B
    const docB = syncNewClient(docA);
    expect(manager.getBlocks(docB)[0].attributes.content).toBe('Hello world');

    // Collect updates from A
    const updatesFromA: SyncUpdate[] = [];
    docA.on('update', (update: Uint8Array) => {
      updatesFromA.push(createUpdateFromChange(update));
    });

    // Client A edits using delta (via updateBlock which now uses deltaUpdateYText)
    manager.updateBlock(docA, '0', { content: 'Hello there' });

    // Apply updates to B
    for (const update of updatesFromA) {
      processIncomingUpdate(docB, update);
    }

    // B should see the delta edit
    expect(manager.getBlocks(docB)[0].attributes.content).toBe('Hello there');
  });

  it('syncs concurrent delta edits to different parts of same text', () => {
    const manager = new DocumentManager();
    const docA = manager.createDoc();

    // Set initial content with a longer paragraph
    manager.setBlocks(docA, [makeParagraph('The quick brown fox')]);

    const docB = syncNewClient(docA);

    const updatesFromA: SyncUpdate[] = [];
    const updatesFromB: SyncUpdate[] = [];

    docA.on('update', (update: Uint8Array) => {
      updatesFromA.push(createUpdateFromChange(update));
    });
    docB.on('update', (update: Uint8Array) => {
      updatesFromB.push(createUpdateFromChange(update));
    });

    // A changes "The" → "A" (prefix edit)
    manager.updateBlock(docA, '0', { content: 'A quick brown fox' });

    // B changes "fox" → "dog" (suffix edit)
    manager.updateBlock(docB, '0', { content: 'The quick brown dog' });

    // Exchange updates
    for (const update of updatesFromA) {
      processIncomingUpdate(docB, update);
    }
    for (const update of updatesFromB) {
      processIncomingUpdate(docA, update);
    }

    // Both docs should converge
    const contentA = manager.getBlocks(docA)[0].attributes.content;
    const contentB = manager.getBlocks(docB)[0].attributes.content;
    expect(contentA).toBe(contentB);
    // Non-overlapping edits should both be applied
    expect(contentA).toContain('quick brown');
  });

  it('syncs chunked delta inserts from one client to another', () => {
    const manager = new DocumentManager();
    const docA = manager.createDoc();

    // Set initial content
    manager.setBlocks(docA, [makeParagraph('Hello')]);

    // Sync to client B
    const docB = syncNewClient(docA);
    expect(manager.getBlocks(docB)[0].attributes.content).toBe('Hello');

    // Collect updates from A
    const updatesFromA: SyncUpdate[] = [];
    docA.on('update', (update: Uint8Array) => {
      updatesFromA.push(createUpdateFromChange(update));
    });

    // Simulate chunked insertion: apply delta in multiple transactions
    // (This is what streamTextToYText does internally)
    const blocksArray = docA.getMap('document').get('blocks') as Y.Array<Y.Map<unknown>>;
    const blockMap = blocksArray.get(0);
    const attrMap = blockMap.get('attributes') as Y.Map<unknown>;
    const ytext = attrMap.get('content') as Y.Text;

    // First, delete old content (retain "Hello" prefix isn't needed here, full replace)
    docA.transact(() => {
      ytext.applyDelta([{ retain: 5 }]); // retain "Hello"
    });

    // Chunk 1: insert " world, this is"
    docA.transact(() => {
      ytext.applyDelta([{ retain: 5 }, { insert: ' world, this is' }]);
    });

    // Chunk 2: insert " a test of chunked"
    docA.transact(() => {
      ytext.applyDelta([{ retain: 20 }, { insert: ' a test of chunked' }]);
    });

    // Chunk 3: insert " streaming"
    docA.transact(() => {
      ytext.applyDelta([{ retain: 38 }, { insert: ' streaming' }]);
    });

    // Apply all updates to B
    for (const update of updatesFromA) {
      processIncomingUpdate(docB, update);
    }

    // Both should have the full text
    const expectedText = 'Hello world, this is a test of chunked streaming';
    expect(manager.getBlocks(docA)[0].attributes.content).toBe(expectedText);
    expect(manager.getBlocks(docB)[0].attributes.content).toBe(expectedText);
  });

  it('compaction transfers full document state', () => {
    const manager = new DocumentManager();
    const docA = manager.createDoc();

    // Build up a complex document
    manager.setTitle(docA, 'Complex Post');
    manager.setContent(docA, '<p>Some serialised content</p>');
    manager.setProperty(docA, 'status', 'publish');
    manager.setProperty(docA, 'author', 1);
    manager.setBlocks(docA, [
      makeParagraph('Paragraph one'),
      {
        name: 'core/list',
        clientId: crypto.randomUUID(),
        attributes: {},
        innerBlocks: [
          {
            name: 'core/list-item',
            clientId: crypto.randomUUID(),
            attributes: { content: 'List item' },
            innerBlocks: [],
          },
        ],
      },
    ]);
    manager.markSaved(docA);

    // Compact and apply to fresh doc
    const compaction = createCompactionUpdate(docA);
    const docB = new Y.Doc();
    processIncomingUpdate(docB, compaction);

    expect(manager.getTitle(docB)).toBe('Complex Post');
    expect(manager.getContent(docB)).toBe('<p>Some serialised content</p>');
    expect(manager.getProperty(docB, 'status')).toBe('publish');
    expect(manager.getProperty(docB, 'author')).toBe(1);

    const blocksB = manager.getBlocks(docB);
    expect(blocksB).toHaveLength(2);
    expect(blocksB[0].attributes.content).toBe('Paragraph one');
    expect(blocksB[1].name).toBe('core/list');
    expect(blocksB[1].innerBlocks[0].attributes.content).toBe('List item');

    const stateMap = manager.getStateMap(docB);
    expect(stateMap.get('savedAt')).toBeTypeOf('number');
    expect(stateMap.get('savedBy')).toBeTypeOf('number');
  });
});
