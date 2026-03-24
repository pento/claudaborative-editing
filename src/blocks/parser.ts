/**
 * Block parser: wraps @wordpress/block-serialization-default-parser to produce
 * normalised ParsedBlock[] from Gutenberg HTML, then converts to Block[].
 */

import { parse as wpParse } from '@wordpress/block-serialization-default-parser';
import type { RawParsedBlock, ParsedBlock } from './types.js';
import type { Block } from '../yjs/types.js';

/**
 * Parse Gutenberg HTML content into normalised blocks.
 * - Null blockNames (freeform HTML) become 'core/freeform'
 * - Attributes are extracted from the block comment delimiters (attrs field)
 * - innerHTML is preserved as originalContent
 * - For common blocks, extract text content from innerHTML into attributes
 */
export function parseBlocks(html: string): ParsedBlock[] {
  const raw = wpParse(html) as RawParsedBlock[];
  return raw
    .filter((block) => block.blockName !== null || block.innerHTML.trim() !== '')
    .map(normaliseParsedBlock);
}

/**
 * Convert a ParsedBlock to a Block (adding clientId, mapping innerBlocks).
 */
export function parsedBlockToBlock(parsed: ParsedBlock): Block {
  return {
    name: parsed.name,
    clientId: crypto.randomUUID(),
    attributes: { ...parsed.attributes },
    innerBlocks: parsed.innerBlocks.map(parsedBlockToBlock),
    originalContent: parsed.originalContent,
  };
}

function normaliseParsedBlock(raw: RawParsedBlock): ParsedBlock {
  const blockName = raw.blockName ?? 'core/freeform';
  const commentAttrs = raw.attrs ?? {};
  const extractedAttrs = extractAttributesFromHTML(blockName, raw.innerHTML, commentAttrs);

  return {
    name: blockName,
    attributes: { ...commentAttrs, ...extractedAttrs },
    innerBlocks: raw.innerBlocks
      .filter((block) => block.blockName !== null || block.innerHTML.trim() !== '')
      .map(normaliseParsedBlock),
    originalContent: raw.innerHTML,
  };
}

/**
 * Extract content/text attributes from a block's innerHTML.
 * For core/paragraph: extract text between <p> tags -> attributes.content
 * For core/heading: extract text between <h1>-<h6> tags -> attributes.content
 * For core/list-item: extract text between <li> tags -> attributes.content
 * For core/image: extract src, alt from <img> tag -> attributes.url, attributes.alt
 * For core/button: extract text from <a> tag -> attributes.text
 */
function extractAttributesFromHTML(
  blockName: string,
  innerHTML: string,
  attrs: Record<string, unknown>,
): Record<string, unknown> {
  const extracted: Record<string, unknown> = {};

  switch (blockName) {
    case 'core/paragraph': {
      const match = innerHTML.match(/<p[^>]*>([\s\S]*?)<\/p>/);
      if (match) {
        extracted.content = match[1].trim();
      }
      break;
    }
    case 'core/heading': {
      const match = innerHTML.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/);
      if (match) {
        extracted.content = match[1].trim();
      }
      // Preserve the level from comment attrs if present
      if (attrs.level !== undefined) {
        extracted.level = attrs.level;
      }
      break;
    }
    case 'core/list-item': {
      const match = innerHTML.match(/<li[^>]*>([\s\S]*?)<\/li>/);
      if (match) {
        extracted.content = match[1].trim();
      }
      break;
    }
    case 'core/image': {
      const imgMatch = innerHTML.match(/<img[^>]*>/);
      if (imgMatch) {
        const srcMatch = imgMatch[0].match(/src="([^"]*)"/);
        if (srcMatch) {
          extracted.url = srcMatch[1];
        }
        const altMatch = imgMatch[0].match(/alt="([^"]*)"/);
        if (altMatch) {
          extracted.alt = altMatch[1];
        }
      }
      break;
    }
    case 'core/button': {
      const match = innerHTML.match(/<a[^>]*>([\s\S]*?)<\/a>/);
      if (match) {
        extracted.text = match[1].trim();
      }
      // Also extract the href as url
      const hrefMatch = innerHTML.match(/<a[^>]*href="([^"]*)"[^>]*>/);
      if (hrefMatch) {
        extracted.url = hrefMatch[1];
      }
      break;
    }
  }

  return extracted;
}
