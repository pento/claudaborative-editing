import { describe, it, expect } from 'vitest';
import { renderPost, renderBlock } from '../../src/blocks/renderer.js';
import type { Block } from '../../src/yjs/types.js';

function makeBlock(overrides: Partial<Block> & { name: string }): Block {
  return {
    clientId: crypto.randomUUID(),
    attributes: {},
    innerBlocks: [],
    ...overrides,
  };
}

describe('renderPost', () => {
  it('should render a simple post with heading and paragraphs', () => {
    const blocks: Block[] = [
      makeBlock({
        name: 'core/heading',
        attributes: { content: 'What Are Widgets?', level: 2 },
      }),
      makeBlock({
        name: 'core/paragraph',
        attributes: {
          content: 'Widgets are fundamental building blocks.',
        },
      }),
    ];

    const output = renderPost('My Post', blocks);

    expect(output).toContain('Title: "My Post"');
    expect(output).toContain('[0] core/heading (level=2)');
    expect(output).toContain('"What Are Widgets?"');
    expect(output).toContain('[1] core/paragraph');
    expect(output).toContain('"Widgets are fundamental building blocks."');
  });

  it('should render nested blocks with dot notation indices', () => {
    const blocks: Block[] = [
      makeBlock({
        name: 'core/list',
        innerBlocks: [
          makeBlock({
            name: 'core/list-item',
            attributes: { content: 'First item' },
          }),
          makeBlock({
            name: 'core/list-item',
            attributes: { content: 'Second item' },
          }),
          makeBlock({
            name: 'core/list-item',
            attributes: { content: 'Third item' },
          }),
        ],
      }),
    ];

    const output = renderPost('List Post', blocks);

    expect(output).toContain('[0] core/list');
    expect(output).toContain('[0.0] core/list-item');
    expect(output).toContain('"First item"');
    expect(output).toContain('[0.1] core/list-item');
    expect(output).toContain('"Second item"');
    expect(output).toContain('[0.2] core/list-item');
    expect(output).toContain('"Third item"');
  });

  it('should render image block with url and alt attributes', () => {
    const blocks: Block[] = [
      makeBlock({
        name: 'core/image',
        attributes: {
          url: 'https://example.com/photo.jpg',
          alt: 'Widget diagram',
          id: 42,
          sizeSlug: 'large',
        },
      }),
    ];

    const output = renderPost('Image Post', blocks);

    expect(output).toContain('[0] core/image');
    expect(output).toContain('url="https://example.com/photo.jpg"');
    expect(output).toContain('alt="Widget diagram"');
    expect(output).toContain('id=42');
    expect(output).toContain('sizeSlug="large"');
  });

  it('should render empty post with no blocks', () => {
    const output = renderPost('Empty Post', []);

    expect(output).toBe('Title: "Empty Post"');
    expect(output).not.toContain('[');
  });
});

describe('renderBlock', () => {
  it('should render a heading block with level attribute and content', () => {
    const block = makeBlock({
      name: 'core/heading',
      attributes: { content: 'Hello World', level: 3 },
    });

    const output = renderBlock(block, '0');

    expect(output).toBe('[0] core/heading (level=3)\n  "Hello World"');
  });

  it('should render a paragraph block with content only', () => {
    const block = makeBlock({
      name: 'core/paragraph',
      attributes: { content: 'Some text here.' },
    });

    const output = renderBlock(block, '1');

    expect(output).toBe('[1] core/paragraph\n  "Some text here."');
  });

  it('should render a block with no attributes and no content', () => {
    const block = makeBlock({
      name: 'core/separator',
    });

    const output = renderBlock(block, '5');

    expect(output).toBe('[5] core/separator');
  });

  it('should render a button block with text and url', () => {
    const block = makeBlock({
      name: 'core/button',
      attributes: { text: 'Click Me', url: 'https://example.com' },
    });

    const output = renderBlock(block, '2');

    expect(output).toContain('[2] core/button (url="https://example.com")');
    expect(output).toContain('"Click Me"');
  });

  it('should not display content/text/value/citation as display attributes', () => {
    const block = makeBlock({
      name: 'core/quote',
      attributes: {
        value: 'A wise quote',
        citation: 'Someone',
        className: 'fancy',
      },
    });

    const output = renderBlock(block, '3');

    // value is shown as text content, not as attribute
    expect(output).toContain('"A wise quote"');
    // citation and value should not be in the attribute parentheses
    expect(output).toContain('className="fancy"');
    expect(output).not.toMatch(/\(.*value=/);
    expect(output).not.toMatch(/\(.*citation=/);
  });

  it('should skip complex object/array attributes', () => {
    const block = makeBlock({
      name: 'core/table',
      attributes: {
        hasFixedLayout: true,
        body: [{ cells: [] }],
      },
    });

    const output = renderBlock(block, '0');

    expect(output).toContain('hasFixedLayout=true');
    // body is an array, should be skipped
    expect(output).not.toContain('body=');
  });
});
