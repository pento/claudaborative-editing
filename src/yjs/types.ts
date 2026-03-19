/**
 * Yjs document types matching the Gutenberg CRDT structure.
 *
 * Verified from @wordpress/sync and @wordpress/core-data source code.
 * The Y.Doc has two root Y.Maps: 'document' and 'state'.
 */
import * as Y from 'yjs';

// --- Root-level keys ---

export const CRDT_RECORD_MAP_KEY = 'document';
export const CRDT_STATE_MAP_KEY = 'state';
export const CRDT_STATE_MAP_VERSION_KEY = 'version';
export const CRDT_STATE_MAP_SAVED_AT_KEY = 'savedAt';
export const CRDT_STATE_MAP_SAVED_BY_KEY = 'savedBy';
export const CRDT_DOC_VERSION = 1;

// --- Block types ---

/** Block attributes map: rich-text attributes are Y.Text, others are plain values. */
export type YBlockAttributes = Y.Map<Y.Text | unknown>;

/** A block as represented in the Yjs document. */
export interface YBlockFields {
  name: string;
  clientId: string;
  attributes: YBlockAttributes;
  innerBlocks: Y.Array<Y.Map<unknown>>;
  isValid?: boolean;
  originalContent?: string;
}

/** A plain-object block for reading/writing (not Yjs types). */
export interface Block {
  name: string;
  clientId: string;
  attributes: Record<string, unknown>;
  innerBlocks: Block[];
  isValid?: boolean;
  originalContent?: string;
}

/**
 * Block attribute schema used to determine if an attribute is rich-text.
 * Since we don't have access to @wordpress/blocks' getBlockTypes() registry,
 * we maintain our own mapping of known rich-text attributes.
 */
export interface BlockAttributeSchema {
  type: 'rich-text' | 'string' | 'number' | 'boolean' | 'array' | 'object';
  role?: 'content' | 'local';
}

/**
 * Known rich-text attributes by block type.
 * This must be kept in sync with core block definitions.
 * When a block type is not in this map, all string attributes are treated as plain strings.
 */
export const RICH_TEXT_ATTRIBUTES: Record<string, Set<string>> = {
  'core/paragraph': new Set(['content']),
  'core/heading': new Set(['content']),
  'core/list-item': new Set(['content']),
  'core/quote': new Set(['value', 'citation']),
  'core/pullquote': new Set(['value', 'citation']),
  'core/verse': new Set(['content']),
  'core/preformatted': new Set(['content']),
  'core/freeform': new Set(['content']),
  'core/button': new Set(['text']),
  'core/table': new Set([]), // table cells use rich-text but are nested in body array
  'core/footnotes': new Set(['content']),
};

/**
 * Default attribute values by block type.
 *
 * Gutenberg validates blocks against their schema and marks them as invalid
 * if expected attributes are missing. This map provides the default values
 * that Gutenberg would normally set when creating a block through the editor.
 */
export const DEFAULT_BLOCK_ATTRIBUTES: Record<string, Record<string, unknown>> = {
  'core/paragraph': { dropCap: false },
  'core/heading': { level: 2 },
  'core/list': { ordered: false },
};

/**
 * Get default attributes for a block type.
 * Returns an empty object if no defaults are defined.
 */
export function getDefaultAttributes(blockName: string): Record<string, unknown> {
  return DEFAULT_BLOCK_ATTRIBUTES[blockName] ?? {};
}

/**
 * Check if a block attribute is rich-text typed.
 */
export function isRichTextAttribute(
  blockName: string,
  attributeName: string,
): boolean {
  return RICH_TEXT_ATTRIBUTES[blockName]?.has(attributeName) ?? false;
}

// --- Post record in Y.Doc ---

/**
 * The synced post properties stored in the 'document' Y.Map.
 * Title, content, excerpt are Y.Text. Blocks is Y.Array<Y.Map>.
 */
export const SYNCED_POST_PROPERTIES = new Set([
  'author',
  'blocks',
  'content',
  'comment_status',
  'date',
  'excerpt',
  'featured_media',
  'format',
  'meta',
  'ping_status',
  'slug',
  'status',
  'sticky',
  'tags',
  'categories',
  'template',
  'title',
]);

// --- Collaborator awareness ---

export interface CollaboratorInfo {
  id: number;
  name: string;
  slug: string;
  avatar_urls: Record<string, string>;
  browserType: string;
  enteredAt: number;
}

export interface AwarenessCursorPosition {
  relativePosition: {
    type: { client: number; clock: number };
    tname: null;
    item: null;
    assoc: number;
  };
  absoluteOffset: number;
}

export interface AwarenessEditorState {
  selection:
    | { type: 'none' }
    | { type: 'cursor'; cursorPosition: AwarenessCursorPosition };
}

export interface AwarenessLocalState {
  collaboratorInfo: CollaboratorInfo;
  editorState?: AwarenessEditorState;
}
