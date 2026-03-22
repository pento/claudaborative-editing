/**
 * Dynamic block type registry built from the WordPress REST API.
 *
 * Replaces the hardcoded RICH_TEXT_ATTRIBUTES / DEFAULT_BLOCK_ATTRIBUTES / SUPPORTED_BLOCK_TYPES
 * with a registry populated from GET /wp/v2/block-types. This allows the MCP server to
 * support ALL block types registered on the WordPress site — core, third-party, and custom.
 */
import type { WPBlockType, WPBlockTypeAttribute } from '../wordpress/types.js';

/** Stored metadata for a single block type. */
interface BlockTypeEntry {
  name: string;
  title: string;
  /** All known attribute names and their schema definitions. */
  attributeSchemas: Map<string, WPBlockTypeAttribute>;
  richTextAttributes: Set<string>;
  defaults: Record<string, unknown>;
  /** Block types this block can be nested inside. Null = any parent. */
  parent: string[] | null;
  /** Ancestor blocks (looser than parent). Null = any ancestor. */
  ancestor: string[] | null;
  /** Block types allowed as direct children. Null = any. */
  allowedBlocks: string[] | null;
}

/**
 * Fallback rich-text attributes used when the API is unavailable.
 * Matches the previously hardcoded RICH_TEXT_ATTRIBUTES.
 */
const FALLBACK_RICH_TEXT_ATTRIBUTES: Record<string, Set<string>> = {
  'core/paragraph': new Set(['content']),
  'core/heading': new Set(['content']),
  'core/list-item': new Set(['content']),
  'core/quote': new Set(['value', 'citation']),
  'core/pullquote': new Set(['value', 'citation']),
  'core/verse': new Set(['content']),
  'core/preformatted': new Set(['content']),
  'core/freeform': new Set(['content']),
  'core/button': new Set(['text']),
  'core/table': new Set([]),
  'core/footnotes': new Set(['content']),
};

/**
 * Fallback default attributes used when the API is unavailable.
 * Matches the previously hardcoded DEFAULT_BLOCK_ATTRIBUTES.
 */
const FALLBACK_DEFAULT_ATTRIBUTES: Record<string, Record<string, unknown>> = {
  'core/paragraph': { dropCap: false },
  'core/heading': { level: 2 },
  'core/list': { ordered: false },
};

/** Information about a block type for display in the wp_block_types tool. */
export interface BlockTypeInfo {
  name: string;
  title: string;
  attributes: Array<{
    name: string;
    type: string;
    richText: boolean;
    default?: unknown;
  }>;
  parent: string[] | null;
  ancestor: string[] | null;
  allowedBlocks: string[] | null;
}

export class BlockTypeRegistry {
  /** Maps block name → full block type entry. */
  private entries: Map<string, BlockTypeEntry>;
  /** Whether this registry was built from the API or is a fallback. */
  private isFallback: boolean;

  private constructor(entries: Map<string, BlockTypeEntry>, isFallback: boolean) {
    this.entries = entries;
    this.isFallback = isFallback;
  }

  /**
   * Build a registry from the WordPress REST API response.
   * Detects rich-text attributes, extracts defaults, and stores nesting constraints.
   */
  static fromApiResponse(blockTypes: WPBlockType[]): BlockTypeRegistry {
    const entries = new Map<string, BlockTypeEntry>();

    for (const blockType of blockTypes) {
      const attributeSchemas = new Map<string, WPBlockTypeAttribute>();
      const richTextSet = new Set<string>();
      const defaults: Record<string, unknown> = {};

      if (blockType.attributes) {
        for (const [attrName, attrDef] of Object.entries(blockType.attributes)) {
          attributeSchemas.set(attrName, attrDef);

          // Rich-text detection: type === "rich-text" OR source === "rich-text" OR source === "html"
          if (
            attrDef.type === 'rich-text' ||
            attrDef.source === 'rich-text' ||
            attrDef.source === 'html'
          ) {
            richTextSet.add(attrName);
          }

          // Extract default values
          if ('default' in attrDef) {
            defaults[attrName] = attrDef.default;
          }
        }
      }

      // Normalize parent/ancestor/allowedBlocks: empty arrays and nulls both mean "no constraint"
      const parent = blockType.parent?.length ? blockType.parent : null;
      const ancestor = blockType.ancestor?.length ? blockType.ancestor : null;
      const allowedBlocks = blockType.allowed_blocks?.length ? blockType.allowed_blocks : null;

      entries.set(blockType.name, {
        name: blockType.name,
        title: blockType.title ?? blockType.name,
        attributeSchemas,
        richTextAttributes: richTextSet,
        defaults,
        parent,
        ancestor,
        allowedBlocks,
      });
    }

    return new BlockTypeRegistry(entries, false);
  }

  /**
   * Create a fallback registry using the hardcoded block type maps.
   * Used when the API call fails (graceful degradation).
   */
  static createFallback(): BlockTypeRegistry {
    const entries = new Map<string, BlockTypeEntry>();

    // Collect all known block names from both maps
    const allNames = new Set([
      ...Object.keys(FALLBACK_RICH_TEXT_ATTRIBUTES),
      ...Object.keys(FALLBACK_DEFAULT_ATTRIBUTES),
    ]);

    for (const name of allNames) {
      entries.set(name, {
        name,
        title: name,
        attributeSchemas: new Map(),
        richTextAttributes: FALLBACK_RICH_TEXT_ATTRIBUTES[name] ?? new Set(),
        defaults: FALLBACK_DEFAULT_ATTRIBUTES[name] ?? {},
        parent: null,
        ancestor: null,
        allowedBlocks: null,
      });
    }

    return new BlockTypeRegistry(entries, true);
  }

  /**
   * Check if a block attribute is rich-text typed.
   */
  isRichTextAttribute(blockName: string, attrName: string): boolean {
    return this.entries.get(blockName)?.richTextAttributes.has(attrName) ?? false;
  }

  /**
   * Get default attributes for a block type.
   * Returns an empty object if no defaults are defined.
   */
  getDefaultAttributes(blockName: string): Record<string, unknown> {
    return this.entries.get(blockName)?.defaults ?? {};
  }

  /**
   * Check if a block type is known to the registry.
   */
  isKnownBlockType(blockName: string): boolean {
    return this.entries.has(blockName);
  }

  /**
   * Whether this registry was built from the fallback hardcoded data.
   */
  isUsingFallback(): boolean {
    return this.isFallback;
  }

  /**
   * Get a sorted list of known block type names.
   */
  getKnownBlockTypeNames(): string[] {
    return [...this.entries.keys()].sort();
  }

  /**
   * Check if a block type has a specific attribute in its schema.
   * Only meaningful for API-sourced registries (fallback has no attribute schemas).
   */
  hasAttribute(blockName: string, attrName: string): boolean {
    const entry = this.entries.get(blockName);
    if (!entry) return false;
    return entry.attributeSchemas.has(attrName);
  }

  /**
   * Get all known attribute names for a block type.
   * Returns null if the block type is unknown or if using the fallback registry
   * (which has no attribute schemas). For API-sourced registries, returns an
   * empty Set for blocks with zero attributes so validation remains strict.
   */
  getAttributeNames(blockName: string): Set<string> | null {
    const entry = this.entries.get(blockName);
    if (!entry) return null;
    // Fallback registry has no attribute schemas — return null to skip validation
    if (this.isFallback && entry.attributeSchemas.size === 0) return null;
    return new Set(entry.attributeSchemas.keys());
  }

  /**
   * Get the parent constraint for a block type.
   * Returns null if the block can be placed anywhere.
   */
  getParent(blockName: string): string[] | null {
    return this.entries.get(blockName)?.parent ?? null;
  }

  /**
   * Get the ancestor constraint for a block type.
   * Returns null if the block has no ancestor constraint.
   */
  getAncestor(blockName: string): string[] | null {
    return this.entries.get(blockName)?.ancestor ?? null;
  }

  /**
   * Get the allowed inner block types for a block type.
   * Returns null if any block type is allowed as a child.
   */
  getAllowedBlocks(blockName: string): string[] | null {
    return this.entries.get(blockName)?.allowedBlocks ?? null;
  }

  /**
   * Get detailed info for a single block type (for the wp_block_types tool).
   * Returns null if the block type is unknown.
   */
  getBlockTypeInfo(blockName: string): BlockTypeInfo | null {
    const entry = this.entries.get(blockName);
    if (!entry) return null;

    const attributes: BlockTypeInfo['attributes'] = [];
    for (const [attrName, schema] of entry.attributeSchemas) {
      const attr: BlockTypeInfo['attributes'][0] = {
        name: attrName,
        type: schema.type,
        richText: entry.richTextAttributes.has(attrName),
      };
      if ('default' in schema) {
        attr.default = schema.default;
      }
      attributes.push(attr);
    }

    return {
      name: entry.name,
      title: entry.title,
      attributes,
      parent: entry.parent,
      ancestor: entry.ancestor,
      allowedBlocks: entry.allowedBlocks,
    };
  }

  /**
   * Search block types by name substring.
   * Returns basic info (name + title) for matching blocks.
   */
  searchBlockTypes(query: string): Array<{ name: string; title: string }> {
    const lowerQuery = query.toLowerCase();
    const results: Array<{ name: string; title: string }> = [];
    for (const entry of this.entries.values()) {
      if (
        entry.name.toLowerCase().includes(lowerQuery) ||
        entry.title.toLowerCase().includes(lowerQuery)
      ) {
        results.push({ name: entry.name, title: entry.title });
      }
    }
    return results.sort((a, b) => a.name.localeCompare(b.name));
  }
}
