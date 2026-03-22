/**
 * Block model types for parsing and rendering.
 *
 * These types represent parsed Gutenberg blocks in a format suitable
 * for conversion to/from the Yjs document structure.
 */

/**
 * A parsed Gutenberg block from @wordpress/block-serialization-default-parser.
 * This is the raw parser output before we normalize it.
 */
export interface RawParsedBlock {
  blockName: string | null;
  attrs: Record<string, unknown> | null;
  innerBlocks: RawParsedBlock[];
  innerHTML: string;
  innerContent: (string | null)[];
}

/**
 * A normalized block ready for use in the application.
 * Null block names (freeform HTML) are converted to 'core/freeform'.
 */
export interface ParsedBlock {
  name: string;
  attributes: Record<string, unknown>;
  innerBlocks: ParsedBlock[];
  originalContent: string;
}

/**
 * A block as presented to Claude, with positional index.
 */
export interface DisplayBlock {
  /** Dot-notation index, e.g. "0", "2.1" for nested blocks */
  index: string;
  name: string;
  attributes: Record<string, unknown>;
  /** The primary text content of this block (extracted from content/text attribute) */
  textContent: string;
  innerBlocks: DisplayBlock[];
}
