import { z } from 'zod';
import type { ToolDefinition } from './definitions.js';

export const readTools: ToolDefinition[] = [
	{
		name: 'wp_read_post',
		description: 'Read the current post content as a block listing',
		availableIn: ['editing'],
		tags: ['reading'],
		execute: (session) => session.readPost(),
	},
	{
		name: 'wp_read_block',
		description:
			'Read a specific block by index (supports dot notation for nested blocks, e.g., "2.1")',
		inputSchema: {
			index: z
				.string()
				.describe('Block index (e.g., "0", "2.1" for nested blocks)'),
		},
		availableIn: ['editing'],
		tags: ['reading'],
		execute: (session, { index }: { index: string }) =>
			session.readBlock(index),
	},
];
