import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { DocumentManager } from '#yjs/document-manager';
import { BlockTypeRegistry } from '#yjs/block-type-registry';
import type { Block } from '#yjs/types';
import { assertDefined } from '../test-utils.js';
import {
	CRDT_RECORD_MAP_KEY,
	CRDT_STATE_MAP_KEY,
	CRDT_STATE_MAP_VERSION_KEY,
	CRDT_DOC_VERSION,
} from '#yjs/types';

function createManager(): { manager: DocumentManager; doc: Y.Doc } {
	const manager = new DocumentManager();
	const doc = manager.createDoc();
	return { manager, doc };
}

function makeParagraph(content: string, clientId?: string): Block {
	return {
		name: 'core/paragraph',
		clientId: clientId ?? crypto.randomUUID(),
		attributes: { content },
		innerBlocks: [],
	};
}

function makeHeading(content: string, level: number): Block {
	return {
		name: 'core/heading',
		clientId: crypto.randomUUID(),
		attributes: { content, level },
		innerBlocks: [],
	};
}

function makeList(items: string[]): Block {
	return {
		name: 'core/list',
		clientId: crypto.randomUUID(),
		attributes: {},
		innerBlocks: items.map((text) => ({
			name: 'core/list-item',
			clientId: crypto.randomUUID(),
			attributes: { content: text },
			innerBlocks: [],
		})),
	};
}

describe('DocumentManager', () => {
	describe('registry', () => {
		it('uses fallback registry by default', () => {
			const manager = new DocumentManager();
			expect(manager.getRegistry().isUsingFallback()).toBe(true);
		});

		it('accepts a registry in constructor', () => {
			const registry = BlockTypeRegistry.fromApiResponse([
				{
					name: 'core/paragraph',
					attributes: { content: { type: 'rich-text' } },
				},
			]);
			const manager = new DocumentManager(registry);
			expect(manager.getRegistry()).toBe(registry);
			expect(manager.getRegistry().isUsingFallback()).toBe(false);
		});

		it('updates registry via setRegistry', () => {
			const manager = new DocumentManager();
			expect(manager.getRegistry().isUsingFallback()).toBe(true);

			const registry = BlockTypeRegistry.fromApiResponse([
				{
					name: 'core/paragraph',
					attributes: { content: { type: 'rich-text' } },
				},
			]);
			manager.setRegistry(registry);
			expect(manager.getRegistry()).toBe(registry);
			expect(manager.getRegistry().isUsingFallback()).toBe(false);
		});
	});

	describe('createDoc', () => {
		it('creates a doc with two root maps', () => {
			const { doc } = createManager();

			const docMap = doc.getMap(CRDT_RECORD_MAP_KEY);
			const stateMap = doc.getMap(CRDT_STATE_MAP_KEY);

			expect(docMap).toBeInstanceOf(Y.Map);
			expect(stateMap).toBeInstanceOf(Y.Map);
		});

		it('initialises state map with version=1', () => {
			const { manager, doc } = createManager();
			const stateMap = manager.getStateMap(doc);
			expect(stateMap.get(CRDT_STATE_MAP_VERSION_KEY)).toBe(
				CRDT_DOC_VERSION
			);
		});

		it('does not pre-populate the document map (avoids CRDT merge conflicts)', () => {
			const { manager, doc } = createManager();
			const docMap = manager.getDocumentMap(doc);

			// Document map keys are created on demand, not during createDoc
			expect(docMap.get('title')).toBeUndefined();
			expect(docMap.get('content')).toBeUndefined();
			expect(docMap.get('blocks')).toBeUndefined();
		});
	});

	describe('title', () => {
		it('starts with empty title', () => {
			const { manager, doc } = createManager();
			expect(manager.getTitle(doc)).toBe('');
		});

		it('sets and gets title', () => {
			const { manager, doc } = createManager();
			manager.setTitle(doc, 'Hello World');
			expect(manager.getTitle(doc)).toBe('Hello World');
		});

		it('replaces existing title', () => {
			const { manager, doc } = createManager();
			manager.setTitle(doc, 'First');
			manager.setTitle(doc, 'Second');
			expect(manager.getTitle(doc)).toBe('Second');
		});
	});

	describe('blocks', () => {
		it('starts with empty blocks', () => {
			const { manager, doc } = createManager();
			expect(manager.getBlocks(doc)).toEqual([]);
		});

		it('sets and gets paragraph blocks', () => {
			const { manager, doc } = createManager();
			const blocks = [
				makeParagraph('First paragraph'),
				makeParagraph('Second paragraph'),
			];

			manager.setBlocks(doc, blocks);
			const result = manager.getBlocks(doc);

			expect(result).toHaveLength(2);
			expect(result[0].name).toBe('core/paragraph');
			expect(result[0].attributes.content).toBe('First paragraph');
			expect(result[1].attributes.content).toBe('Second paragraph');
		});

		it('handles heading blocks with non-rich-text attributes', () => {
			const { manager, doc } = createManager();
			const blocks = [makeHeading('My Title', 2)];

			manager.setBlocks(doc, blocks);
			const result = manager.getBlocks(doc);

			expect(result[0].attributes.content).toBe('My Title');
			expect(result[0].attributes.level).toBe(2);
		});

		it('handles nested blocks (list with list-items)', () => {
			const { manager, doc } = createManager();
			const blocks = [makeList(['Item A', 'Item B', 'Item C'])];

			manager.setBlocks(doc, blocks);
			const result = manager.getBlocks(doc);

			expect(result[0].name).toBe('core/list');
			expect(result[0].innerBlocks).toHaveLength(3);
			expect(result[0].innerBlocks[0].attributes.content).toBe('Item A');
			expect(result[0].innerBlocks[2].attributes.content).toBe('Item C');
		});

		it('replaces all blocks when setBlocks is called again', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeParagraph('Old')]);
			manager.setBlocks(doc, [makeParagraph('New')]);

			const result = manager.getBlocks(doc);
			expect(result).toHaveLength(1);
			expect(result[0].attributes.content).toBe('New');
		});
	});

	describe('insertBlock', () => {
		it('inserts a block at the beginning', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeParagraph('B')]);
			manager.insertBlock(doc, 0, makeParagraph('A'));

			const result = manager.getBlocks(doc);
			expect(result).toHaveLength(2);
			expect(result[0].attributes.content).toBe('A');
			expect(result[1].attributes.content).toBe('B');
		});

		it('inserts a block at the end', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeParagraph('A')]);
			manager.insertBlock(doc, 1, makeParagraph('B'));

			const result = manager.getBlocks(doc);
			expect(result).toHaveLength(2);
			expect(result[0].attributes.content).toBe('A');
			expect(result[1].attributes.content).toBe('B');
		});

		it('inserts a block in the middle', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeParagraph('A'), makeParagraph('C')]);
			manager.insertBlock(doc, 1, makeParagraph('B'));

			const result = manager.getBlocks(doc);
			expect(result).toHaveLength(3);
			expect(result[1].attributes.content).toBe('B');
		});
	});

	describe('removeBlocks', () => {
		it('removes a single block', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [
				makeParagraph('A'),
				makeParagraph('B'),
				makeParagraph('C'),
			]);
			manager.removeBlocks(doc, 1, 1);

			const result = manager.getBlocks(doc);
			expect(result).toHaveLength(2);
			expect(result[0].attributes.content).toBe('A');
			expect(result[1].attributes.content).toBe('C');
		});

		it('removes multiple consecutive blocks', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [
				makeParagraph('A'),
				makeParagraph('B'),
				makeParagraph('C'),
				makeParagraph('D'),
			]);
			manager.removeBlocks(doc, 1, 2);

			const result = manager.getBlocks(doc);
			expect(result).toHaveLength(2);
			expect(result[0].attributes.content).toBe('A');
			expect(result[1].attributes.content).toBe('D');
		});
	});

	describe('moveBlock', () => {
		it('moves a block forward', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [
				makeParagraph('A'),
				makeParagraph('B'),
				makeParagraph('C'),
			]);
			// Move block 0 (A) to position 2
			manager.moveBlock(doc, 0, 2);

			const result = manager.getBlocks(doc);
			expect(result[0].attributes.content).toBe('B');
			expect(result[1].attributes.content).toBe('A');
			expect(result[2].attributes.content).toBe('C');
		});

		it('moves a block backward', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [
				makeParagraph('A'),
				makeParagraph('B'),
				makeParagraph('C'),
			]);
			// Move block 2 (C) to position 0
			manager.moveBlock(doc, 2, 0);

			const result = manager.getBlocks(doc);
			expect(result[0].attributes.content).toBe('C');
			expect(result[1].attributes.content).toBe('A');
			expect(result[2].attributes.content).toBe('B');
		});
	});

	describe('getBlockByIndex', () => {
		it('gets a top-level block by index', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [
				makeParagraph('First'),
				makeParagraph('Second'),
			]);

			const block = manager.getBlockByIndex(doc, '1');
			assertDefined(block);
			expect(block.attributes.content).toBe('Second');
		});

		it('gets a nested block by dot notation', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeList(['Alpha', 'Beta', 'Gamma'])]);

			const block = manager.getBlockByIndex(doc, '0.1');
			assertDefined(block);
			expect(block.name).toBe('core/list-item');
			expect(block.attributes.content).toBe('Beta');
		});

		it('returns null for out-of-range index', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeParagraph('Only one')]);

			expect(manager.getBlockByIndex(doc, '5')).toBeNull();
		});

		it('returns null for out-of-range nested index', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeList(['Only one item'])]);

			expect(manager.getBlockByIndex(doc, '0.5')).toBeNull();
		});
	});

	describe('insertInnerBlock', () => {
		it('inserts a child block at the beginning of innerBlocks', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeList(['Item A', 'Item B'])]);

			const newItem: Block = {
				name: 'core/list-item',
				clientId: crypto.randomUUID(),
				attributes: { content: 'Item Z' },
				innerBlocks: [],
			};

			manager.insertInnerBlock(doc, '0', 0, newItem);

			const result = manager.getBlocks(doc);
			expect(result[0].innerBlocks).toHaveLength(3);
			expect(result[0].innerBlocks[0].attributes.content).toBe('Item Z');
			expect(result[0].innerBlocks[1].attributes.content).toBe('Item A');
			expect(result[0].innerBlocks[2].attributes.content).toBe('Item B');
		});

		it('inserts a child block at the end of innerBlocks', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeList(['Item A', 'Item B'])]);

			const newItem: Block = {
				name: 'core/list-item',
				clientId: crypto.randomUUID(),
				attributes: { content: 'Item C' },
				innerBlocks: [],
			};

			manager.insertInnerBlock(doc, '0', 2, newItem);

			const result = manager.getBlocks(doc);
			expect(result[0].innerBlocks).toHaveLength(3);
			expect(result[0].innerBlocks[2].attributes.content).toBe('Item C');
		});

		it('inserts a child block in the middle of innerBlocks', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeList(['Item A', 'Item C'])]);

			const newItem: Block = {
				name: 'core/list-item',
				clientId: crypto.randomUUID(),
				attributes: { content: 'Item B' },
				innerBlocks: [],
			};

			manager.insertInnerBlock(doc, '0', 1, newItem);

			const result = manager.getBlocks(doc);
			expect(result[0].innerBlocks).toHaveLength(3);
			expect(result[0].innerBlocks[0].attributes.content).toBe('Item A');
			expect(result[0].innerBlocks[1].attributes.content).toBe('Item B');
			expect(result[0].innerBlocks[2].attributes.content).toBe('Item C');
		});

		it('creates innerBlocks array if the parent has none', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeParagraph('A standalone paragraph')]);

			const newChild: Block = {
				name: 'core/paragraph',
				clientId: crypto.randomUUID(),
				attributes: { content: 'Nested child' },
				innerBlocks: [],
			};

			manager.insertInnerBlock(doc, '0', 0, newChild);

			const result = manager.getBlocks(doc);
			expect(result[0].innerBlocks).toHaveLength(1);
			expect(result[0].innerBlocks[0].attributes.content).toBe(
				'Nested child'
			);
		});

		it('throws when parent index is invalid', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeParagraph('Only one')]);

			const newChild: Block = {
				name: 'core/paragraph',
				clientId: crypto.randomUUID(),
				attributes: { content: 'Child' },
				innerBlocks: [],
			};

			expect(() => {
				manager.insertInnerBlock(doc, '5', 0, newChild);
			}).toThrow('Block not found at index 5');
		});
	});

	describe('removeInnerBlocks', () => {
		it('removes a single inner block', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeList(['Item A', 'Item B', 'Item C'])]);

			manager.removeInnerBlocks(doc, '0', 1, 1);

			const result = manager.getBlocks(doc);
			expect(result[0].innerBlocks).toHaveLength(2);
			expect(result[0].innerBlocks[0].attributes.content).toBe('Item A');
			expect(result[0].innerBlocks[1].attributes.content).toBe('Item C');
		});

		it('removes multiple inner blocks', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [
				makeList(['Item A', 'Item B', 'Item C', 'Item D']),
			]);

			manager.removeInnerBlocks(doc, '0', 1, 2);

			const result = manager.getBlocks(doc);
			expect(result[0].innerBlocks).toHaveLength(2);
			expect(result[0].innerBlocks[0].attributes.content).toBe('Item A');
			expect(result[0].innerBlocks[1].attributes.content).toBe('Item D');
		});

		it('throws when parent index is invalid', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeParagraph('Only one')]);

			expect(() => {
				manager.removeInnerBlocks(doc, '5', 0, 1);
			}).toThrow('Block not found at index 5');
		});

		it('throws when removing from a block with empty inner blocks', () => {
			const { manager, doc } = createManager();
			// makeParagraph creates a block with innerBlocks: [], which becomes
			// an empty Y.Array. Attempting to delete from it throws from Yjs.
			manager.setBlocks(doc, [makeParagraph('No children')]);

			expect(() => {
				manager.removeInnerBlocks(doc, '0', 0, 1);
			}).toThrow();
		});
	});

	describe('updateBlock', () => {
		it('updates block content', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeParagraph('Original')]);

			manager.updateBlock(doc, '0', { content: 'Updated' });
			const block = manager.getBlockByIndex(doc, '0');
			assertDefined(block);
			expect(block.attributes.content).toBe('Updated');
		});

		it('updates block attributes', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeHeading('Title', 2)]);

			manager.updateBlock(doc, '0', { attributes: { level: 3 } });
			const block = manager.getBlockByIndex(doc, '0');
			assertDefined(block);
			expect(block.attributes.level).toBe(3);
			// content should remain unchanged
			expect(block.attributes.content).toBe('Title');
		});

		it('updates both content and attributes at once', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeHeading('Old Title', 1)]);

			manager.updateBlock(doc, '0', {
				content: 'New Title',
				attributes: { level: 3 },
			});

			const block = manager.getBlockByIndex(doc, '0');
			assertDefined(block);
			expect(block.attributes.content).toBe('New Title');
			expect(block.attributes.level).toBe(3);
		});

		it('updates a nested block via dot notation', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeList(['First', 'Second'])]);

			manager.updateBlock(doc, '0.0', { content: 'Updated First' });
			const block = manager.getBlockByIndex(doc, '0.0');
			assertDefined(block);
			expect(block.attributes.content).toBe('Updated First');
		});

		it('does nothing for an out-of-range index', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeParagraph('Only one')]);

			// Should not throw
			manager.updateBlock(doc, '5', { content: 'Nope' });
			expect(manager.getBlocks(doc)).toHaveLength(1);
		});
	});

	describe('markSaved', () => {
		it('updates savedAt and savedBy in the state map', () => {
			const { manager, doc } = createManager();

			const before = Date.now();
			manager.markSaved(doc);
			const after = Date.now();

			const stateMap = manager.getStateMap(doc);
			const savedAt = stateMap.get('savedAt') as number;
			const savedBy = stateMap.get('savedBy') as number;

			expect(savedAt).toBeGreaterThanOrEqual(before);
			expect(savedAt).toBeLessThanOrEqual(after);
			expect(savedBy).toBe(doc.clientID);
		});
	});

	describe('content', () => {
		it('gets and sets content', () => {
			const { manager, doc } = createManager();
			expect(manager.getContent(doc)).toBe('');

			manager.setContent(
				doc,
				'<!-- wp:paragraph --><p>Hello</p><!-- /wp:paragraph -->'
			);
			expect(manager.getContent(doc)).toBe(
				'<!-- wp:paragraph --><p>Hello</p><!-- /wp:paragraph -->'
			);
		});
	});

	describe('getBlockAttributeYText', () => {
		it('returns Y.Text for rich-text attributes', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeParagraph('Hello')]);

			const ytext = manager.getBlockAttributeYText(doc, '0', 'content');
			assertDefined(ytext);
			expect(ytext).toBeInstanceOf(Y.Text);
			expect(ytext.toJSON()).toBe('Hello');
		});

		it('returns null for non-rich-text attributes', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeHeading('Title', 2)]);

			const ytext = manager.getBlockAttributeYText(doc, '0', 'level');
			expect(ytext).toBeNull();
		});

		it('returns null for invalid block index', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeParagraph('Only')]);

			const ytext = manager.getBlockAttributeYText(doc, '5', 'content');
			expect(ytext).toBeNull();
		});

		it('returns null for non-existent attribute', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeParagraph('Hello')]);

			const ytext = manager.getBlockAttributeYText(
				doc,
				'0',
				'nonexistent'
			);
			expect(ytext).toBeNull();
		});

		it('works for nested block attributes', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeList(['Item A', 'Item B'])]);

			const ytext = manager.getBlockAttributeYText(doc, '0.1', 'content');
			assertDefined(ytext);
			expect(ytext).toBeInstanceOf(Y.Text);
			expect(ytext.toJSON()).toBe('Item B');
		});

		it('delegates correctly from getBlockContentYText', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeParagraph('Hello')]);

			const viaContent = manager.getBlockContentYText(doc, '0');
			const viaAttr = manager.getBlockAttributeYText(doc, '0', 'content');
			expect(viaContent).toBe(viaAttr);
		});
	});

	describe('block metadata', () => {
		it('setBlockNoteId sets noteId on a block that has no metadata', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeParagraph('Hello')]);

			manager.setBlockNoteId(doc, '0', 42);

			const block = manager.getBlockByIndex(doc, '0');
			assertDefined(block);
			expect(block.attributes.metadata).toEqual({ noteId: 42 });
		});

		it('setBlockNoteId preserves existing metadata keys when adding noteId', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeParagraph('Hello')]);

			// Manually set some existing metadata
			const documentMap = manager.getDocumentMap(doc);
			const blocksArray = documentMap.get('blocks') as Y.Array<
				Y.Map<unknown>
			>;
			const attrMap = blocksArray
				.get(0)
				.get('attributes') as Y.Map<unknown>;
			attrMap.set('metadata', { customKey: 'customValue', priority: 1 });

			manager.setBlockNoteId(doc, '0', 99);

			const block = manager.getBlockByIndex(doc, '0');
			assertDefined(block);
			expect(block.attributes.metadata).toEqual({
				customKey: 'customValue',
				priority: 1,
				noteId: 99,
			});
		});

		it('setBlockNoteId throws when block index is invalid', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeParagraph('Only one')]);

			expect(() => {
				manager.setBlockNoteId(doc, '5', 42);
			}).toThrow('Block not found at index 5');
		});

		it('removeBlockNoteId removes noteId from block metadata', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeParagraph('Hello')]);

			// Set metadata with noteId and another key
			const documentMap = manager.getDocumentMap(doc);
			const blocksArray = documentMap.get('blocks') as Y.Array<
				Y.Map<unknown>
			>;
			const attrMap = blocksArray
				.get(0)
				.get('attributes') as Y.Map<unknown>;
			attrMap.set('metadata', { noteId: 42, otherKey: 'keep' });

			manager.removeBlockNoteId(doc, '0');

			const block = manager.getBlockByIndex(doc, '0');
			assertDefined(block);
			expect(block.attributes.metadata).toEqual({ otherKey: 'keep' });
		});

		it('removeBlockNoteId removes entire metadata key when noteId was the only key', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeParagraph('Hello')]);

			manager.setBlockNoteId(doc, '0', 42);
			manager.removeBlockNoteId(doc, '0');

			const block = manager.getBlockByIndex(doc, '0');
			assertDefined(block);
			expect(block.attributes.metadata).toBeUndefined();
		});

		it('removeBlockNoteId preserves other metadata keys when removing noteId', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeParagraph('Hello')]);

			const documentMap = manager.getDocumentMap(doc);
			const blocksArray = documentMap.get('blocks') as Y.Array<
				Y.Map<unknown>
			>;
			const attrMap = blocksArray
				.get(0)
				.get('attributes') as Y.Map<unknown>;
			attrMap.set('metadata', {
				noteId: 7,
				author: 'claude',
				version: 3,
			});

			manager.removeBlockNoteId(doc, '0');

			const block = manager.getBlockByIndex(doc, '0');
			assertDefined(block);
			expect(block.attributes.metadata).toEqual({
				author: 'claude',
				version: 3,
			});
		});

		it('removeBlockNoteId is a no-op when block has no metadata', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeParagraph('Hello')]);

			// Should not throw
			manager.removeBlockNoteId(doc, '0');

			const block = manager.getBlockByIndex(doc, '0');
			assertDefined(block);
			expect(block.attributes.metadata).toBeUndefined();
		});

		it('removeBlockNoteId throws when block index is invalid', () => {
			const { manager, doc } = createManager();
			manager.setBlocks(doc, [makeParagraph('Only one')]);

			expect(() => {
				manager.removeBlockNoteId(doc, '5');
			}).toThrow('Block not found at index 5');
		});
	});

	describe('properties', () => {
		it('gets and sets scalar properties', () => {
			const { manager, doc } = createManager();

			manager.setProperty(doc, 'status', 'publish');
			expect(manager.getProperty(doc, 'status')).toBe('publish');

			manager.setProperty(doc, 'author', 42);
			expect(manager.getProperty(doc, 'author')).toBe(42);

			manager.setProperty(doc, 'slug', 'my-post');
			expect(manager.getProperty(doc, 'slug')).toBe('my-post');
		});

		it('handles Y.Text properties via getProperty/setProperty', () => {
			const { manager, doc } = createManager();

			// title is a Y.Text field initialised in createDoc
			manager.setProperty(doc, 'title', 'My Post Title');
			expect(manager.getProperty(doc, 'title')).toBe('My Post Title');

			// excerpt too
			manager.setProperty(doc, 'excerpt', 'A summary');
			expect(manager.getProperty(doc, 'excerpt')).toBe('A summary');
		});

		it('returns undefined for unset properties', () => {
			const { manager, doc } = createManager();
			expect(manager.getProperty(doc, 'nonexistent')).toBeUndefined();
		});
	});
});
