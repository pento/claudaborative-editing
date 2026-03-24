import { describe, it, expect } from 'vitest';
import { BlockTypeRegistry } from '#yjs/block-type-registry';
import type { WPBlockType } from '#wordpress/types';

describe('BlockTypeRegistry', () => {
  describe('createFallback()', () => {
    const registry = BlockTypeRegistry.createFallback();

    it('returns a registry where isUsingFallback() is true', () => {
      expect(registry.isUsingFallback()).toBe(true);
    });

    it('isRichTextAttribute("core/paragraph", "content") returns true', () => {
      expect(registry.isRichTextAttribute('core/paragraph', 'content')).toBe(true);
    });

    it('isRichTextAttribute("core/heading", "content") returns true', () => {
      expect(registry.isRichTextAttribute('core/heading', 'content')).toBe(true);
    });

    it('isRichTextAttribute("core/paragraph", "dropCap") returns false', () => {
      expect(registry.isRichTextAttribute('core/paragraph', 'dropCap')).toBe(false);
    });

    it('isRichTextAttribute("core/image", "url") returns false', () => {
      expect(registry.isRichTextAttribute('core/image', 'url')).toBe(false);
    });

    it('getDefaultAttributes("core/paragraph") returns { dropCap: false }', () => {
      expect(registry.getDefaultAttributes('core/paragraph')).toEqual({ dropCap: false });
    });

    it('getDefaultAttributes("core/heading") returns { level: 2 }', () => {
      expect(registry.getDefaultAttributes('core/heading')).toEqual({ level: 2 });
    });

    it('getDefaultAttributes("core/list") returns { ordered: false }', () => {
      expect(registry.getDefaultAttributes('core/list')).toEqual({ ordered: false });
    });

    it('getDefaultAttributes("core/unknown") returns {}', () => {
      expect(registry.getDefaultAttributes('core/unknown')).toEqual({});
    });

    it('isKnownBlockType("core/paragraph") returns true', () => {
      expect(registry.isKnownBlockType('core/paragraph')).toBe(true);
    });

    it('isKnownBlockType("core/list") returns true (from DEFAULT_BLOCK_ATTRIBUTES)', () => {
      expect(registry.isKnownBlockType('core/list')).toBe(true);
    });

    it('isKnownBlockType("core/unknown") returns false', () => {
      expect(registry.isKnownBlockType('core/unknown')).toBe(false);
    });
  });

  describe('fromApiResponse()', () => {
    it('isUsingFallback() returns false', () => {
      const registry = BlockTypeRegistry.fromApiResponse([]);
      expect(registry.isUsingFallback()).toBe(false);
    });

    it('detects rich-text via type === "rich-text"', () => {
      const blockTypes: WPBlockType[] = [
        {
          name: 'core/paragraph',
          attributes: {
            content: { type: 'rich-text' },
          },
        },
      ];
      const registry = BlockTypeRegistry.fromApiResponse(blockTypes);
      expect(registry.isRichTextAttribute('core/paragraph', 'content')).toBe(true);
    });

    it('detects rich-text via source === "rich-text"', () => {
      const blockTypes: WPBlockType[] = [
        {
          name: 'core/paragraph',
          attributes: {
            content: { type: 'string', source: 'rich-text' },
          },
        },
      ];
      const registry = BlockTypeRegistry.fromApiResponse(blockTypes);
      expect(registry.isRichTextAttribute('core/paragraph', 'content')).toBe(true);
    });

    it('detects rich-text via source === "html"', () => {
      const blockTypes: WPBlockType[] = [
        {
          name: 'core/heading',
          attributes: {
            content: { type: 'string', source: 'html' },
          },
        },
      ];
      const registry = BlockTypeRegistry.fromApiResponse(blockTypes);
      expect(registry.isRichTextAttribute('core/heading', 'content')).toBe(true);
    });

    it('does NOT mark as rich-text when source is "attribute"', () => {
      const blockTypes: WPBlockType[] = [
        {
          name: 'core/image',
          attributes: {
            url: { type: 'string', source: 'attribute' },
          },
        },
      ];
      const registry = BlockTypeRegistry.fromApiResponse(blockTypes);
      expect(registry.isRichTextAttribute('core/image', 'url')).toBe(false);
    });

    it('extracts default values', () => {
      const blockTypes: WPBlockType[] = [
        {
          name: 'core/paragraph',
          attributes: {
            dropCap: { type: 'boolean', default: false },
          },
        },
      ];
      const registry = BlockTypeRegistry.fromApiResponse(blockTypes);
      expect(registry.getDefaultAttributes('core/paragraph')).toEqual({ dropCap: false });
    });

    it('registers ALL block types from the response', () => {
      const blockTypes: WPBlockType[] = [
        {
          name: 'core/separator',
          attributes: {
            tagName: { type: 'string', default: 'hr' },
          },
        },
      ];
      const registry = BlockTypeRegistry.fromApiResponse(blockTypes);
      expect(registry.isKnownBlockType('core/separator')).toBe(true);
    });

    it('isKnownBlockType() returns false for block types NOT in the API response', () => {
      const blockTypes: WPBlockType[] = [
        {
          name: 'core/paragraph',
          attributes: {
            content: { type: 'rich-text' },
          },
        },
      ];
      const registry = BlockTypeRegistry.fromApiResponse(blockTypes);
      expect(registry.isKnownBlockType('core/heading')).toBe(false);
    });
  });

  describe('Edge cases', () => {
    it('handles empty input array', () => {
      const registry = BlockTypeRegistry.fromApiResponse([]);
      expect(registry.isKnownBlockType('anything')).toBe(false);
    });

    it('handles blocks with attributes: null', () => {
      const blockTypes: WPBlockType[] = [{ name: 'core/nextpage', attributes: null }];
      const registry = BlockTypeRegistry.fromApiResponse(blockTypes);
      expect(registry.isKnownBlockType('core/nextpage')).toBe(true);
      expect(registry.isRichTextAttribute('core/nextpage', 'anything')).toBe(false);
    });

    it('handles blocks with empty attributes', () => {
      const blockTypes: WPBlockType[] = [{ name: 'core/spacer', attributes: {} }];
      const registry = BlockTypeRegistry.fromApiResponse(blockTypes);
      expect(registry.isKnownBlockType('core/spacer')).toBe(true);
    });
  });

  describe('getKnownBlockTypeNames()', () => {
    it('returns sorted array', () => {
      const blockTypes: WPBlockType[] = [
        { name: 'core/paragraph', attributes: { content: { type: 'rich-text' } } },
        { name: 'core/heading', attributes: { content: { type: 'rich-text' } } },
        { name: 'core/button', attributes: { text: { type: 'rich-text' } } },
        { name: 'core/image', attributes: { url: { type: 'string' } } },
      ];
      const registry = BlockTypeRegistry.fromApiResponse(blockTypes);
      const names = registry.getKnownBlockTypeNames();

      expect(names).toEqual(['core/button', 'core/heading', 'core/image', 'core/paragraph']);
    });
  });

  describe('hasAttribute() and getAttributeNames()', () => {
    const registry = BlockTypeRegistry.fromApiResponse([
      {
        name: 'core/paragraph',
        attributes: {
          content: { type: 'rich-text' },
          dropCap: { type: 'boolean', default: false },
        },
      },
    ]);

    it('hasAttribute() returns true for a rich-text attribute', () => {
      expect(registry.hasAttribute('core/paragraph', 'content')).toBe(true);
    });

    it('hasAttribute() returns true for a non-rich-text attribute', () => {
      expect(registry.hasAttribute('core/paragraph', 'dropCap')).toBe(true);
    });

    it('hasAttribute() returns false for a nonexistent attribute', () => {
      expect(registry.hasAttribute('core/paragraph', 'nonexistent')).toBe(false);
    });

    it('hasAttribute() returns false for an unknown block type', () => {
      expect(registry.hasAttribute('unknown/block', 'foo')).toBe(false);
    });

    it('getAttributeNames() returns all attribute names as a Set', () => {
      const names = registry.getAttributeNames('core/paragraph');
      expect(names).toBeInstanceOf(Set);
      expect(names).toEqual(new Set(['content', 'dropCap']));
    });

    it('getAttributeNames() returns null for a fallback registry block', () => {
      const fallback = BlockTypeRegistry.createFallback();
      expect(fallback.getAttributeNames('core/paragraph')).toBeNull();
    });

    it('getAttributeNames() returns null for an unknown block type', () => {
      expect(registry.getAttributeNames('unknown/block')).toBeNull();
    });

    it('getAttributeNames() returns empty Set for API block with null attributes', () => {
      const reg = BlockTypeRegistry.fromApiResponse([{ name: 'core/nextpage', attributes: null }]);
      const names = reg.getAttributeNames('core/nextpage');
      expect(names).toBeInstanceOf(Set);
      expect(names!.size).toBe(0);
    });
  });

  describe('getParent(), getAncestor(), getAllowedBlocks()', () => {
    const registry = BlockTypeRegistry.fromApiResponse([
      { name: 'core/column', attributes: null, parent: ['core/columns'] },
      { name: 'core/columns', attributes: null },
      { name: 'core/list', attributes: null, allowed_blocks: ['core/list-item'] },
      {
        name: 'core/list-item',
        attributes: { content: { type: 'rich-text' } },
        parent: ['core/list'],
        ancestor: ['core/list'],
      },
    ]);

    it('getParent() returns the parent constraint array', () => {
      expect(registry.getParent('core/column')).toEqual(['core/columns']);
    });

    it('getParent() returns null when no parent constraint exists', () => {
      expect(registry.getParent('core/list')).toBeNull();
    });

    it('getAllowedBlocks() returns the allowed blocks array', () => {
      expect(registry.getAllowedBlocks('core/list')).toEqual(['core/list-item']);
    });

    it('getAllowedBlocks() returns null when any child is allowed', () => {
      expect(registry.getAllowedBlocks('core/column')).toBeNull();
    });

    it('getAncestor() returns the ancestor constraint array', () => {
      expect(registry.getAncestor('core/list-item')).toEqual(['core/list']);
    });

    it('getAncestor() returns null when no ancestor constraint exists', () => {
      expect(registry.getAncestor('core/column')).toBeNull();
    });

    it('normalises empty parent array to null', () => {
      const reg = BlockTypeRegistry.fromApiResponse([
        { name: 'core/test', attributes: null, parent: [] },
      ]);
      expect(reg.getParent('core/test')).toBeNull();
    });

    it('normalises empty ancestor array to null', () => {
      const reg = BlockTypeRegistry.fromApiResponse([
        { name: 'core/test', attributes: null, ancestor: [] },
      ]);
      expect(reg.getAncestor('core/test')).toBeNull();
    });

    it('normalises empty allowed_blocks array to null', () => {
      const reg = BlockTypeRegistry.fromApiResponse([
        { name: 'core/test', attributes: null, allowed_blocks: [] },
      ]);
      expect(reg.getAllowedBlocks('core/test')).toBeNull();
    });

    it('returns null for unknown block types', () => {
      expect(registry.getParent('unknown/block')).toBeNull();
      expect(registry.getAncestor('unknown/block')).toBeNull();
      expect(registry.getAllowedBlocks('unknown/block')).toBeNull();
    });
  });

  describe('getBlockTypeInfo()', () => {
    const registry = BlockTypeRegistry.fromApiResponse([
      {
        name: 'core/paragraph',
        title: 'Paragraph',
        attributes: {
          content: { type: 'rich-text' },
          dropCap: { type: 'boolean', default: false },
        },
        supports: { allowedBlocks: true },
        parent: ['core/group'],
        allowed_blocks: ['core/inline-image'],
      },
    ]);

    it('returns full info for a known block with attributes and constraints', () => {
      const info = registry.getBlockTypeInfo('core/paragraph');
      expect(info).not.toBeNull();
      expect(info!.name).toBe('core/paragraph');
      expect(info!.title).toBe('Paragraph');
      expect(info!.parent).toEqual(['core/group']);
      expect(info!.allowedBlocks).toEqual(['core/inline-image']);
      expect(info!.ancestor).toBeNull();
      expect(info!.supportsInnerBlocks).toBe(true);
      expect(info!.attributes).toEqual([
        { name: 'content', type: 'rich-text', richText: true },
        { name: 'dropCap', type: 'boolean', richText: false, default: false },
      ]);
    });

    it('returns null for an unknown block type', () => {
      expect(registry.getBlockTypeInfo('unknown/block')).toBeNull();
    });

    it('includes richText flag correctly for non-rich-text attributes', () => {
      const info = registry.getBlockTypeInfo('core/paragraph')!;
      const dropCapAttr = info.attributes.find((a) => a.name === 'dropCap');
      expect(dropCapAttr!.richText).toBe(false);
    });

    it('includes richText flag correctly for rich-text attributes', () => {
      const info = registry.getBlockTypeInfo('core/paragraph')!;
      const contentAttr = info.attributes.find((a) => a.name === 'content');
      expect(contentAttr!.richText).toBe(true);
    });

    it('omits default field when no default is defined', () => {
      const info = registry.getBlockTypeInfo('core/paragraph')!;
      const contentAttr = info.attributes.find((a) => a.name === 'content');
      expect('default' in contentAttr!).toBe(false);
    });
  });

  describe('supportsInnerBlocks()', () => {
    it('returns true when supports.allowedBlocks is true', () => {
      const registry = BlockTypeRegistry.fromApiResponse([
        {
          name: 'core/quote',
          attributes: { citation: { type: 'rich-text' } },
          supports: { allowedBlocks: true },
        },
      ] as WPBlockType[]);
      expect(registry.supportsInnerBlocks('core/quote')).toBe(true);
    });

    it('returns false when supports.allowedBlocks is absent', () => {
      const registry = BlockTypeRegistry.fromApiResponse([
        {
          name: 'core/pullquote',
          attributes: { value: { type: 'rich-text' } },
        },
      ] as WPBlockType[]);
      expect(registry.supportsInnerBlocks('core/pullquote')).toBe(false);
    });

    it('returns false when supports is null', () => {
      const registry = BlockTypeRegistry.fromApiResponse([
        {
          name: 'core/paragraph',
          attributes: { content: { type: 'rich-text' } },
          supports: null,
        },
      ] as WPBlockType[]);
      expect(registry.supportsInnerBlocks('core/paragraph')).toBe(false);
    });

    it('returns false for unknown block types', () => {
      const registry = BlockTypeRegistry.fromApiResponse([]);
      expect(registry.supportsInnerBlocks('unknown/block')).toBe(false);
    });

    it('returns false for fallback registry entries', () => {
      const fallback = BlockTypeRegistry.createFallback();
      expect(fallback.supportsInnerBlocks('core/quote')).toBe(false);
    });
  });

  describe('searchBlockTypes()', () => {
    const registry = BlockTypeRegistry.fromApiResponse([
      { name: 'core/paragraph', title: 'Paragraph', attributes: null },
      { name: 'core/heading', title: 'Heading', attributes: null },
      { name: 'core/image', title: 'Image', attributes: null },
      { name: 'core/gallery', title: 'Gallery', attributes: null },
      { name: 'myplugin/hero', title: 'Hero Banner', attributes: null },
    ]);

    it('matches by block name substring (case-insensitive)', () => {
      const results = registry.searchBlockTypes('PARA');
      expect(results).toEqual([{ name: 'core/paragraph', title: 'Paragraph' }]);
    });

    it('matches by title substring (case-insensitive)', () => {
      const results = registry.searchBlockTypes('banner');
      expect(results).toEqual([{ name: 'myplugin/hero', title: 'Hero Banner' }]);
    });

    it('returns multiple matches sorted by name', () => {
      // "a" matches gallery (name+title), heading (name+title), image (name+title), paragraph (name+title), hero banner (title)
      // Use "ll" which matches "gallery" and nothing else... use "er" which matches gallery + hero banner
      const results = registry.searchBlockTypes('er');
      expect(results).toEqual([
        { name: 'core/gallery', title: 'Gallery' },
        { name: 'myplugin/hero', title: 'Hero Banner' },
      ]);
    });

    it('returns empty array for no match', () => {
      const results = registry.searchBlockTypes('zzz-nonexistent');
      expect(results).toEqual([]);
    });

    it('matches all blocks with a broad query', () => {
      const results = registry.searchBlockTypes('core/');
      expect(results).toHaveLength(4);
      expect(results[0].name).toBe('core/gallery');
      expect(results[3].name).toBe('core/paragraph');
    });
  });
});
