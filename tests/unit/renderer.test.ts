import { describe, it, expect } from 'vitest';
import { renderPost, renderBlock } from '../../src/blocks/renderer.js';
import type { PostMetadata } from '../../src/blocks/renderer.js';
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

describe('renderPost with metadata', () => {
	const sampleBlocks: Block[] = [
		makeBlock({
			name: 'core/paragraph',
			attributes: { content: 'Hello world.' },
		}),
	];

	it('should render all metadata fields', () => {
		const metadata: PostMetadata = {
			status: 'draft',
			date: '2026-03-22T10:00:00',
			slug: 'my-post',
			sticky: true,
			commentStatus: 'closed',
			excerpt: 'A brief summary.',
			categories: ['Tech', 'News'],
			tags: ['JavaScript', 'Rust'],
			featuredImage: 42,
		};

		const output = renderPost('Full Meta', sampleBlocks, metadata);

		expect(output).toContain('Title: "Full Meta"');
		expect(output).toContain('Status: draft');
		expect(output).toContain('Date: 2026-03-22T10:00:00');
		expect(output).toContain('Slug: my-post');
		expect(output).toContain('Sticky: yes');
		expect(output).toContain('Comments: closed');
		expect(output).toContain('Excerpt: "A brief summary."');
		expect(output).toContain('Categories: Tech, News');
		expect(output).toContain('Tags: JavaScript, Rust');
		expect(output).toContain('Featured image: set (ID: 42)');
	});

	it('should render only the provided metadata fields (partial)', () => {
		const metadata: PostMetadata = {
			status: 'publish',
		};

		const output = renderPost('Partial Meta', sampleBlocks, metadata);

		expect(output).toContain('Status: publish');
		expect(output).not.toContain('Date:');
		expect(output).not.toContain('Slug:');
		expect(output).not.toContain('Sticky:');
		expect(output).not.toContain('Comments:');
		expect(output).not.toContain('Excerpt:');
		expect(output).not.toContain('Categories:');
		expect(output).not.toContain('Tags:');
		expect(output).not.toContain('Featured image:');
	});

	it('should not render extra lines for empty/falsy metadata values', () => {
		const metadata: PostMetadata = {
			status: '',
			date: null,
			slug: '',
			sticky: false,
			commentStatus: 'open',
			excerpt: '',
			categories: [],
			tags: [],
		};

		const output = renderPost('Falsy Meta', sampleBlocks, metadata);

		expect(output).toContain('Title: "Falsy Meta"');
		expect(output).not.toContain('Status:');
		expect(output).not.toContain('Date:');
		expect(output).not.toContain('Slug:');
		expect(output).not.toContain('Sticky:');
		expect(output).not.toContain('Comments:');
		expect(output).not.toContain('Excerpt:');
		expect(output).not.toContain('Categories:');
		expect(output).not.toContain('Tags:');
	});

	it('should be backward compatible when metadata is omitted', () => {
		const output = renderPost('No Meta', sampleBlocks);

		expect(output).toContain('Title: "No Meta"');
		expect(output).toContain('[0] core/paragraph');
		expect(output).not.toContain('Status:');
		expect(output).not.toContain('Date:');
		expect(output).not.toContain('Slug:');
		expect(output).not.toContain('Sticky:');
		expect(output).not.toContain('Comments:');
		expect(output).not.toContain('Excerpt:');
		expect(output).not.toContain('Categories:');
		expect(output).not.toContain('Tags:');
		expect(output).not.toContain('Featured image:');
	});

	it('should show "Comments: closed" when commentStatus is closed', () => {
		const metadata: PostMetadata = {
			commentStatus: 'closed',
		};

		const output = renderPost('Closed Comments', [], metadata);

		expect(output).toContain('Comments: closed');
	});

	it('should not show Comments line when commentStatus is open', () => {
		const metadata: PostMetadata = {
			commentStatus: 'open',
		};

		const output = renderPost('Open Comments', [], metadata);

		expect(output).not.toContain('Comments:');
	});

	it('should render categories as comma-separated names', () => {
		const metadata: PostMetadata = {
			categories: ['Tech', 'News', 'Tutorials'],
		};

		const output = renderPost('With Categories', [], metadata);

		expect(output).toContain('Categories: Tech, News, Tutorials');
	});

	it('should render a single category', () => {
		const metadata: PostMetadata = {
			categories: ['Uncategorized'],
		};

		const output = renderPost('Single Cat', [], metadata);

		expect(output).toContain('Categories: Uncategorized');
	});

	it('should render tags as comma-separated names', () => {
		const metadata: PostMetadata = {
			tags: ['JavaScript', 'Rust'],
		};

		const output = renderPost('With Tags', [], metadata);

		expect(output).toContain('Tags: JavaScript, Rust');
	});

	it('should render featured image as set with ID', () => {
		const metadata: PostMetadata = {
			featuredImage: 42,
		};

		const output = renderPost('With Featured', [], metadata);

		expect(output).toContain('Featured image: set (ID: 42)');
	});

	it('should render featured image as not set when 0', () => {
		const metadata: PostMetadata = {
			featuredImage: 0,
		};

		const output = renderPost('No Featured', [], metadata);

		expect(output).toContain('Featured image: not set');
	});

	it('should omit featured image line when undefined', () => {
		const metadata: PostMetadata = {
			status: 'draft',
		};

		const output = renderPost('No Featured Prop', [], metadata);

		expect(output).not.toContain('Featured image:');
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

describe('note indicators', () => {
	it('should show [has note] for a block with metadata.noteId', () => {
		const block: Block = {
			name: 'core/paragraph',
			clientId: 'test-id',
			attributes: { content: 'Hello', metadata: { noteId: 42 } },
			innerBlocks: [],
		};

		const output = renderBlock(block, '0');

		expect(output).toContain('[0] core/paragraph [has note]');
	});

	it('should show [has note] after display attributes', () => {
		const block: Block = {
			name: 'core/heading',
			clientId: 'test-id',
			attributes: {
				content: 'Title',
				level: 2,
				metadata: { noteId: 42 },
			},
			innerBlocks: [],
		};

		const output = renderBlock(block, '0');

		expect(output).toContain('[0] core/heading (level=2) [has note]');
	});

	it('should not show [has note] when there is no metadata', () => {
		const block: Block = {
			name: 'core/paragraph',
			clientId: 'test-id',
			attributes: { content: 'Hello' },
			innerBlocks: [],
		};

		const output = renderBlock(block, '0');

		expect(output).not.toContain('[has note]');
	});

	it('should not show [has note] when metadata has no noteId', () => {
		const block: Block = {
			name: 'core/paragraph',
			clientId: 'test-id',
			attributes: { content: 'Hello', metadata: {} },
			innerBlocks: [],
		};

		const output = renderBlock(block, '0');

		expect(output).not.toContain('[has note]');
	});

	it('should not show metadata as a display attribute', () => {
		const block: Block = {
			name: 'core/paragraph',
			clientId: 'test-id',
			attributes: { content: 'Hello', metadata: { noteId: 42 } },
			innerBlocks: [],
		};

		const output = renderBlock(block, '0');

		expect(output).not.toContain('metadata=');
	});
});
