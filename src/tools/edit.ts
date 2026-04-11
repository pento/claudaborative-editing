import { z } from 'zod';
import type { BlockInput } from '../session/session-manager.js';
import type { ToolDefinition, ToolResult } from './definitions.js';

interface UpdateBlockInput {
	index: string;
	content?: string;
	attributes?: Record<string, unknown>;
}

interface InsertBlockInput {
	position: number;
	name: string;
	content?: string;
	attributes?: Record<string, unknown>;
	innerBlocks?: BlockInput[];
}

interface InsertInnerBlockInput {
	parentIndex: string;
	position: number;
	name: string;
	content?: string;
	attributes?: Record<string, unknown>;
	innerBlocks?: BlockInput[];
}

interface RemoveBlocksInput {
	startIndex: number;
	count?: number;
}

interface RemoveInnerBlocksInput {
	parentIndex: string;
	startIndex: number;
	count?: number;
}

interface MoveBlockInput {
	fromIndex: number;
	toIndex: number;
}

interface ReplaceBlocksInput {
	startIndex: number;
	count: number;
	blocks: BlockInput[];
}

interface EditBlockTextInput {
	index: string;
	attribute?: string;
	edits: Array<{ find: string; replace: string; occurrence?: number }>;
}

const blockTypeDescription =
	'Block type name (e.g., "core/paragraph", "core/heading", "core/separator")';

export const blockInputSchema: z.ZodType<BlockInput> = z.object({
	name: z.string().describe(blockTypeDescription),
	content: z.string().optional().describe('Text content for the block'),
	attributes: z
		.record(z.string(), z.unknown())
		.optional()
		.describe('Block attributes (key-value pairs)'),
	innerBlocks: z
		.lazy(() => z.array(blockInputSchema))
		.optional()
		.describe('Nested child blocks (e.g., list-items inside a list)'),
});

export const editTools: ToolDefinition[] = [
	{
		name: 'wp_update_block',
		description: "Update a block's content and/or attributes",
		inputSchema: {
			index: z
				.string()
				.describe('Block index (e.g., "0", "2.1" for nested blocks)'),
			content: z
				.string()
				.optional()
				.describe('New text content for the block'),
			attributes: z
				.record(z.string(), z.unknown())
				.optional()
				.describe('Attributes to update (key-value pairs)'),
		},
		execute: (
			session,
			{ index, content, attributes }: UpdateBlockInput
		) => {
			session.updateBlock(index, { content, attributes });
			return `Updated block ${index}.`;
		},
		tags: ['editing'],
		availableIn: ['editing'],
	},
	{
		name: 'wp_insert_block',
		description:
			'Insert a new block at a position in the post. Supports nested blocks via innerBlocks.',
		inputSchema: {
			position: z
				.number()
				.describe('Position to insert the block (0-based index)'),
			name: z.string().describe(blockTypeDescription),
			content: z
				.string()
				.optional()
				.describe('Text content for the block'),
			attributes: z
				.record(z.string(), z.unknown())
				.optional()
				.describe('Block attributes (key-value pairs)'),
			innerBlocks: z
				.array(blockInputSchema)
				.optional()
				.describe(
					'Nested child blocks (e.g., list-items inside a list)'
				),
		},
		execute: (
			session,
			{
				position,
				name,
				content,
				attributes,
				innerBlocks,
			}: InsertBlockInput
		) => {
			session.insertBlock(position, {
				name,
				content,
				attributes,
				innerBlocks,
			});
			return `Inserted ${name} block at position ${position}.`;
		},
		tags: ['editing'],
		availableIn: ['editing'],
	},
	{
		name: 'wp_insert_inner_block',
		description:
			'Insert a block as a child of an existing block (e.g., add a list-item to a list)',
		inputSchema: {
			parentIndex: z
				.string()
				.describe(
					'Dot-notation index of the parent block (e.g., "0", "2.1")'
				),
			position: z
				.number()
				.describe(
					"Position within the parent's inner blocks (0-based)"
				),
			name: z.string().describe(blockTypeDescription),
			content: z
				.string()
				.optional()
				.describe('Text content for the block'),
			attributes: z
				.record(z.string(), z.unknown())
				.optional()
				.describe('Block attributes (key-value pairs)'),
			innerBlocks: z
				.array(blockInputSchema)
				.optional()
				.describe('Nested child blocks'),
		},
		execute: (
			session,
			{
				parentIndex,
				position,
				name,
				content,
				attributes,
				innerBlocks,
			}: InsertInnerBlockInput
		) => {
			session.insertInnerBlock(parentIndex, position, {
				name,
				content,
				attributes,
				innerBlocks,
			});
			return `Inserted ${name} as inner block at ${parentIndex}.${position}.`;
		},
		tags: ['editing'],
		availableIn: ['editing'],
	},
	{
		name: 'wp_remove_blocks',
		description: 'Remove one or more blocks from the post',
		inputSchema: {
			startIndex: z
				.number()
				.describe('Index of the first block to remove'),
			count: z
				.number()
				.optional()
				.describe('Number of blocks to remove (default 1)'),
		},
		execute: (session, { startIndex, count }: RemoveBlocksInput) => {
			const removeCount = count ?? 1;
			session.removeBlocks(startIndex, removeCount);
			return `Removed ${removeCount} block${removeCount !== 1 ? 's' : ''} starting at index ${startIndex}.`;
		},
		tags: ['editing'],
		availableIn: ['editing'],
	},
	{
		name: 'wp_remove_inner_blocks',
		description: 'Remove inner blocks from a parent block',
		inputSchema: {
			parentIndex: z
				.string()
				.describe('Dot-notation index of the parent block (e.g., "0")'),
			startIndex: z
				.number()
				.describe('Index of the first inner block to remove'),
			count: z
				.number()
				.optional()
				.describe('Number of inner blocks to remove (default 1)'),
		},
		execute: (
			session,
			{ parentIndex, startIndex, count }: RemoveInnerBlocksInput
		) => {
			const removeCount = count ?? 1;
			session.removeInnerBlocks(parentIndex, startIndex, removeCount);
			return `Removed ${removeCount} inner block${removeCount !== 1 ? 's' : ''} from block ${parentIndex}.`;
		},
		tags: ['editing'],
		availableIn: ['editing'],
	},
	{
		name: 'wp_move_block',
		description: 'Move a block from one position to another',
		inputSchema: {
			fromIndex: z.number().describe('Current position of the block'),
			toIndex: z.number().describe('Target position for the block'),
		},
		execute: (session, { fromIndex, toIndex }: MoveBlockInput) => {
			session.moveBlock(fromIndex, toIndex);
			return `Moved block from position ${fromIndex} to ${toIndex}.`;
		},
		tags: ['editing'],
		availableIn: ['editing'],
	},
	{
		name: 'wp_replace_blocks',
		description:
			'Replace a range of blocks with new blocks. Supports nested blocks via innerBlocks.',
		inputSchema: {
			startIndex: z
				.number()
				.describe('Index of the first block to replace'),
			count: z.number().describe('Number of blocks to replace'),
			blocks: z
				.array(blockInputSchema)
				.describe('New blocks to insert in place of the removed ones'),
		},
		execute: (
			session,
			{ startIndex, count, blocks }: ReplaceBlocksInput
		) => {
			session.replaceBlocks(startIndex, count, blocks);
			return `Replaced ${count} block${count !== 1 ? 's' : ''} at index ${startIndex} with ${blocks.length} new block${blocks.length !== 1 ? 's' : ''}.`;
		},
		tags: ['editing'],
		availableIn: ['editing'],
	},
	{
		name: 'wp_edit_block_text',
		description:
			'Make surgical find-and-replace text edits within a block. ' +
			'More efficient than wp_update_block for small corrections (typos, ' +
			'grammar fixes) — only the targeted text is changed, preserving concurrent edits.',
		inputSchema: {
			index: z
				.string()
				.describe('Block index (e.g., "0", "2.1" for nested blocks)'),
			attribute: z
				.string()
				.optional()
				.describe(
					'Rich-text attribute to edit (default: "content"). ' +
						'Use "citation" for quote/pullquote citations, "value" for pullquote text, etc.'
				),
			edits: z
				.array(
					z.object({
						find: z
							.string()
							.min(1)
							.describe(
								'Exact text to find in the current content (may include HTML tags like <strong>, <a href="...">)'
							),
						replace: z
							.string()
							.describe(
								'Replacement text (empty string to delete the found text)'
							),
						occurrence: z
							.number()
							.int()
							.min(1)
							.optional()
							.describe(
								'Which occurrence to replace (1-indexed, default 1). Use when the same text appears multiple times.'
							),
					})
				)
				.min(1)
				.describe(
					'List of find-and-replace operations applied sequentially'
				),
		},
		execute: (
			session,
			{ index, attribute, edits }: EditBlockTextInput
		): ToolResult => {
			const result = session.editBlockText(index, edits, attribute);

			const lines: string[] = [];
			if (result.failedCount > 0) {
				lines.push(
					`Applied ${result.appliedCount}/${result.edits.length} edit${result.edits.length !== 1 ? 's' : ''}.`
				);
				for (const edit of result.edits) {
					if (!edit.applied) {
						lines.push(
							`  FAILED: find "${edit.find}" — ${edit.error}`
						);
					}
				}
			} else {
				lines.push(
					`Applied ${result.appliedCount} edit${result.appliedCount !== 1 ? 's' : ''}.`
				);
			}

			const updated = session.readBlock(index);
			lines.push('');
			lines.push(updated);

			return {
				text: lines.join('\n'),
				isError: result.appliedCount === 0 && result.failedCount > 0,
			};
		},
		tags: ['editing'],
		availableIn: ['editing'],
	},
	{
		name: 'wp_set_title',
		description: 'Set the post title',
		inputSchema: {
			title: z.string().describe('New post title'),
		},
		execute: (session, { title }: { title: string }) => {
			session.setTitle(title);
			return `Title set to "${title}".`;
		},
		tags: ['editing'],
		availableIn: ['editing'],
	},
];
