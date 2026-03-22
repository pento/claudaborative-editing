/**
 * Block renderer: converts Block[] to Claude-friendly text representation.
 */

import type { Block } from '../yjs/types.js';

/** Post metadata to display in the rendered output. */
export interface PostMetadata {
  status?: string;
  date?: string | null;
  slug?: string;
  sticky?: boolean;
  commentStatus?: string;
  excerpt?: string;
}

/**
 * Render a post's blocks as Claude-friendly text.
 *
 * Output format:
 * Title: "Post Title Here"
 * Status: draft
 *
 * [0] core/heading (level=2)
 *   "What Are Widgets?"
 *
 * [1] core/paragraph
 *   "Widgets are fundamental building blocks..."
 */
export function renderPost(title: string, blocks: Block[], metadata?: PostMetadata): string {
  const parts: string[] = [];
  parts.push(`Title: "${title}"`);

  if (metadata) {
    if (metadata.status) {
      parts.push(`Status: ${metadata.status}`);
    }
    if (metadata.date) {
      parts.push(`Date: ${metadata.date}`);
    }
    if (metadata.slug) {
      parts.push(`Slug: ${metadata.slug}`);
    }
    if (metadata.sticky) {
      parts.push('Sticky: yes');
    }
    if (metadata.commentStatus === 'closed') {
      parts.push('Comments: closed');
    }
    if (metadata.excerpt) {
      parts.push(`Excerpt: "${metadata.excerpt}"`);
    }
  }

  if (blocks.length > 0) {
    parts.push('');
    parts.push(renderBlockList(blocks));
  }

  return parts.join('\n');
}

/**
 * Render a single block with its details.
 */
export function renderBlock(block: Block, index: string): string {
  const displayAttrs = getDisplayAttributes(block);
  const attrStr = Object.entries(displayAttrs)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? `"${v}"` : v}`)
    .join(', ');

  const metadata = block.attributes.metadata as Record<string, unknown> | undefined;
  const hasNote = metadata?.noteId !== null && metadata?.noteId !== undefined;

  const header = attrStr
    ? `[${index}] ${block.name} (${attrStr})${hasNote ? ' [has note]' : ''}`
    : `[${index}] ${block.name}${hasNote ? ' [has note]' : ''}`;

  const lines: string[] = [header];

  const textContent = getBlockTextContent(block);
  if (textContent) {
    lines.push(`  "${textContent}"`);
  }

  if (block.innerBlocks.length > 0) {
    const innerRendered = renderBlockList(block.innerBlocks, index, 1);
    lines.push(innerRendered);
  }

  return lines.join('\n');
}

/**
 * Render blocks as a list with indices.
 * @param blocks - The blocks to render
 * @param parentIndex - Parent index prefix for nested blocks (e.g., "2" -> "2.0", "2.1")
 * @param indent - Current indentation level
 */
function renderBlockList(blocks: Block[], parentIndex?: string, indent: number = 0): string {
  const indentStr = '  '.repeat(indent);

  return blocks
    .map((block, i) => {
      const index = parentIndex !== undefined ? `${parentIndex}.${i}` : String(i);
      const rendered = renderBlock(block, index);
      // Indent each line of the rendered block
      if (indent > 0) {
        return rendered
          .split('\n')
          .map((line) => indentStr + line)
          .join('\n');
      }
      return rendered;
    })
    .join('\n\n');
}

/**
 * Get the primary text content of a block from its attributes.
 * Checks 'content' first, then 'text', then 'value', then 'citation'.
 */
function getBlockTextContent(block: Block): string {
  for (const key of ['content', 'text', 'value', 'citation']) {
    const val = block.attributes[key];
    if (typeof val === 'string' && val.length > 0) {
      return val;
    }
  }
  return '';
}

/**
 * Get display-worthy attributes (non-content attributes that are useful to show).
 * For headings: show level
 * For images: show url, alt
 * For buttons: show url
 * For columns: show verticalAlignment
 * Skip 'content', 'text', 'value' (shown separately as text content)
 * Skip complex objects/arrays
 */
function getDisplayAttributes(block: Block): Record<string, string | number | boolean> {
  const skipKeys = new Set(['content', 'text', 'value', 'citation', 'metadata']);
  const result: Record<string, string | number | boolean> = {};

  for (const [key, val] of Object.entries(block.attributes)) {
    if (skipKeys.has(key)) continue;
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      result[key] = val;
    }
  }

  return result;
}
