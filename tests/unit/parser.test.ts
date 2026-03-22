import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseBlocks, parsedBlockToBlock } from '../../src/blocks/parser.js';

function readFixture(name: string): string {
  return readFileSync(join(__dirname, '..', 'fixtures', name), 'utf-8');
}

describe('parseBlocks', () => {
  it('should parse simple-post.html into 3 blocks', () => {
    const html = readFixture('simple-post.html');
    const blocks = parseBlocks(html);

    expect(blocks).toHaveLength(3);
    expect(blocks[0].name).toBe('core/heading');
    expect(blocks[1].name).toBe('core/paragraph');
    expect(blocks[2].name).toBe('core/paragraph');
  });

  it('should extract heading level attribute from comment delimiter', () => {
    const html = readFixture('simple-post.html');
    const blocks = parseBlocks(html);

    expect(blocks[0].attributes.level).toBe(2);
  });

  it('should extract heading content from innerHTML', () => {
    const html = readFixture('simple-post.html');
    const blocks = parseBlocks(html);

    expect(blocks[0].attributes.content).toBe('What Are Widgets?');
  });

  it('should extract paragraph content from innerHTML', () => {
    const html = readFixture('simple-post.html');
    const blocks = parseBlocks(html);

    expect(blocks[1].attributes.content).toBe(
      'Widgets are fundamental building blocks of modern interfaces. They provide reusable UI components.',
    );
  });

  it('should preserve HTML formatting like <strong> in paragraph content', () => {
    const html = readFixture('simple-post.html');
    const blocks = parseBlocks(html);

    expect(blocks[2].attributes.content).toBe(
      'This post explores the <strong>basics of widget design</strong> and best practices.',
    );
  });

  it('should parse nested-blocks.html with heading, list, and image', () => {
    const html = readFixture('nested-blocks.html');
    const blocks = parseBlocks(html);

    expect(blocks).toHaveLength(3);
    expect(blocks[0].name).toBe('core/heading');
    expect(blocks[1].name).toBe('core/list');
    expect(blocks[2].name).toBe('core/image');
  });

  it('should extract heading level 1 from nested-blocks.html', () => {
    const html = readFixture('nested-blocks.html');
    const blocks = parseBlocks(html);

    expect(blocks[0].attributes.level).toBe(1);
    expect(blocks[0].attributes.content).toBe('Shopping List');
  });

  it('should parse list with 3 inner list-item blocks', () => {
    const html = readFixture('nested-blocks.html');
    const blocks = parseBlocks(html);

    const list = blocks[1];
    expect(list.innerBlocks).toHaveLength(3);
    expect(list.innerBlocks[0].name).toBe('core/list-item');
    expect(list.innerBlocks[1].name).toBe('core/list-item');
    expect(list.innerBlocks[2].name).toBe('core/list-item');
  });

  it('should extract list-item content', () => {
    const html = readFixture('nested-blocks.html');
    const blocks = parseBlocks(html);

    const list = blocks[1];
    expect(list.innerBlocks[0].attributes.content).toBe('Apples');
    expect(list.innerBlocks[1].attributes.content).toBe('Bananas');
    expect(list.innerBlocks[2].attributes.content).toBe('Cherries');
  });

  it('should extract image attributes (url, alt, id, sizeSlug)', () => {
    const html = readFixture('nested-blocks.html');
    const blocks = parseBlocks(html);

    const image = blocks[2];
    expect(image.attributes.url).toBe('https://example.com/photo.jpg');
    expect(image.attributes.alt).toBe('Shopping cart');
    expect(image.attributes.id).toBe(42);
    expect(image.attributes.sizeSlug).toBe('large');
  });

  it('should parse freeform-content.html as freeform blocks', () => {
    const html = readFixture('freeform-content.html');
    const blocks = parseBlocks(html);

    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      expect(block.name).toBe('core/freeform');
    }
  });

  it('should return empty array for empty string', () => {
    const blocks = parseBlocks('');
    expect(blocks).toEqual([]);
  });

  it('should preserve originalContent as innerHTML', () => {
    const html = readFixture('simple-post.html');
    const blocks = parseBlocks(html);

    expect(blocks[0].originalContent).toContain('<h2');
    expect(blocks[0].originalContent).toContain('What Are Widgets?');
  });
});

describe('parsedBlockToBlock', () => {
  it('should convert a ParsedBlock to a Block with clientId', () => {
    const html = readFixture('simple-post.html');
    const parsed = parseBlocks(html);
    const block = parsedBlockToBlock(parsed[0]);

    expect(block.name).toBe('core/heading');
    expect(block.clientId).toBeTruthy();
    // clientId should look like a UUID
    expect(block.clientId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(block.attributes).toEqual(parsed[0].attributes);
    expect(block.innerBlocks).toEqual([]);
    expect(block.originalContent).toBe(parsed[0].originalContent);
  });

  it('should recursively convert inner blocks', () => {
    const html = readFixture('nested-blocks.html');
    const parsed = parseBlocks(html);
    const block = parsedBlockToBlock(parsed[1]); // the list block

    expect(block.innerBlocks).toHaveLength(3);
    for (const inner of block.innerBlocks) {
      expect(inner.clientId).toBeTruthy();
      expect(inner.name).toBe('core/list-item');
    }
  });

  it('should generate unique clientIds for each block', () => {
    const html = readFixture('nested-blocks.html');
    const parsed = parseBlocks(html);
    const blocks = parsed.map(parsedBlockToBlock);

    const ids = new Set<string>();
    function collectIds(block: {
      clientId: string;
      innerBlocks: { clientId: string; innerBlocks: any[] }[];
    }) {
      ids.add(block.clientId);
      for (const inner of block.innerBlocks) {
        collectIds(inner);
      }
    }
    for (const b of blocks) {
      collectIds(b);
    }

    // All IDs should be unique (3 top-level + 3 list items = 6)
    expect(ids.size).toBe(6);
  });
});
