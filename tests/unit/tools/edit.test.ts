import { describe, it, expect, beforeEach } from 'vitest';
import { registerEditTools } from '../../../src/tools/edit.js';
import {
	createMockServer,
	createMockSession,
	fakeUser,
	fakePost,
} from './helpers.js';
import { assertDefined } from '../../test-utils.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../../../src/session/session-manager.js';

describe('edit tools', () => {
	let server: ReturnType<typeof createMockServer>;
	let session: SessionManager;

	beforeEach(() => {
		server = createMockServer();
		session = createMockSession({
			state: 'editing',
			user: fakeUser,
			post: fakePost,
			blockContent: '[0] core/paragraph\n  "Updated content"',
		});
		registerEditTools(server as unknown as McpServer, session);
	});

	it('registers all edit tools', () => {
		expect(server.registeredTools.has('wp_update_block')).toBe(true);
		expect(server.registeredTools.has('wp_edit_block_text')).toBe(true);
		expect(server.registeredTools.has('wp_insert_block')).toBe(true);
		expect(server.registeredTools.has('wp_remove_blocks')).toBe(true);
		expect(server.registeredTools.has('wp_move_block')).toBe(true);
		expect(server.registeredTools.has('wp_replace_blocks')).toBe(true);
		expect(server.registeredTools.has('wp_set_title')).toBe(true);
		expect(server.registeredTools.has('wp_insert_inner_block')).toBe(true);
		expect(server.registeredTools.has('wp_remove_inner_blocks')).toBe(true);
	});

	describe('wp_update_block', () => {
		it('updates block and returns confirmation', async () => {
			const tool = server.registeredTools.get('wp_update_block');
			assertDefined(tool);
			const result = await tool.handler({
				index: '0',
				content: 'New content',
			});

			expect(session.updateBlock).toHaveBeenCalledWith('0', {
				content: 'New content',
				attributes: undefined,
			});
			expect(result.content[0].text).toContain('Updated block 0');
		});

		it('passes attributes to updateBlock', async () => {
			const tool = server.registeredTools.get('wp_update_block');
			assertDefined(tool);
			await tool.handler({
				index: '1',
				attributes: { level: 3 },
			});

			expect(session.updateBlock).toHaveBeenCalledWith('1', {
				content: undefined,
				attributes: { level: 3 },
			});
		});

		it('returns error when not editing', async () => {
			(
				session.updateBlock as ReturnType<typeof import('vitest').vi.fn>
			).mockImplementation(() => {
				throw new Error(
					"Operation requires state editing, but current state is 'connected'"
				);
			});

			const tool = server.registeredTools.get('wp_update_block');
			assertDefined(tool);
			const result = await tool.handler({ index: '0', content: 'test' });

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain('Failed to update block');
		});
	});

	describe('wp_edit_block_text', () => {
		it('calls editBlockText and returns success message', async () => {
			const tool = server.registeredTools.get('wp_edit_block_text');
			assertDefined(tool);
			const result = await tool.handler({
				index: '0',
				edits: [{ find: 'old', replace: 'new' }],
			});

			expect(session.editBlockText).toHaveBeenCalledWith(
				'0',
				[{ find: 'old', replace: 'new' }],
				undefined
			);
			expect(result.content[0].text).toContain('Applied 1 edit.');
			expect(result.isError).toBeFalsy();
		});

		it('passes attribute parameter through', async () => {
			const tool = server.registeredTools.get('wp_edit_block_text');
			assertDefined(tool);
			await tool.handler({
				index: '2',
				attribute: 'citation',
				edits: [{ find: 'Someone', replace: 'Nobody' }],
			});

			expect(session.editBlockText).toHaveBeenCalledWith(
				'2',
				[{ find: 'Someone', replace: 'Nobody' }],
				'citation'
			);
		});

		it('passes occurrence parameter through', async () => {
			const tool = server.registeredTools.get('wp_edit_block_text');
			assertDefined(tool);
			await tool.handler({
				index: '0',
				edits: [{ find: 'the', replace: 'a', occurrence: 2 }],
			});

			expect(session.editBlockText).toHaveBeenCalledWith(
				'0',
				[{ find: 'the', replace: 'a', occurrence: 2 }],
				undefined
			);
		});

		it('reports partial failures with detail', async () => {
			const partialSession = createMockSession({
				state: 'editing',
				user: fakeUser,
				post: fakePost,
				editBlockTextResult: {
					edits: [
						{ find: 'good', replace: 'great', applied: true },
						{
							find: 'missing',
							replace: 'found',
							applied: false,
							error: '"missing" not found in current content.',
						},
					],
					appliedCount: 1,
					failedCount: 1,
					updatedText: 'great text',
				},
			});
			const partialServer = createMockServer();
			registerEditTools(
				partialServer as unknown as McpServer,
				partialSession
			);

			const tool =
				partialServer.registeredTools.get('wp_edit_block_text');
			assertDefined(tool);
			const result = await tool.handler({
				index: '0',
				edits: [
					{ find: 'good', replace: 'great' },
					{ find: 'missing', replace: 'found' },
				],
			});

			expect(result.content[0].text).toContain('Applied 1/2 edits.');
			expect(result.content[0].text).toContain('FAILED: find "missing"');
			// Partial success is not isError
			expect(result.isError).toBeFalsy();
		});

		it('sets isError when all edits fail', async () => {
			const failSession = createMockSession({
				state: 'editing',
				user: fakeUser,
				post: fakePost,
				editBlockTextResult: {
					edits: [
						{
							find: 'missing',
							replace: 'found',
							applied: false,
							error: '"missing" not found in current content.',
						},
					],
					appliedCount: 0,
					failedCount: 1,
					updatedText: 'unchanged text',
				},
			});
			const failServer = createMockServer();
			registerEditTools(failServer as unknown as McpServer, failSession);

			const tool = failServer.registeredTools.get('wp_edit_block_text');
			assertDefined(tool);
			const result = await tool.handler({
				index: '0',
				edits: [{ find: 'missing', replace: 'found' }],
			});

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain('Applied 0/1 edit.');
		});

		it('returns error when editBlockText throws', async () => {
			(
				session.editBlockText as ReturnType<
					typeof import('vitest').vi.fn
				>
			).mockImplementation(() => {
				throw new Error('Block 999 not found.');
			});

			const tool = server.registeredTools.get('wp_edit_block_text');
			assertDefined(tool);
			const result = await tool.handler({
				index: '999',
				edits: [{ find: 'test', replace: 'test2' }],
			});

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain(
				'Failed to edit block text'
			);
			expect(result.content[0].text).toContain('Block 999 not found');
		});

		it('includes updated block content in response', async () => {
			const tool = server.registeredTools.get('wp_edit_block_text');
			assertDefined(tool);
			const result = await tool.handler({
				index: '0',
				edits: [{ find: 'old', replace: 'new' }],
			});

			expect(session.readBlock).toHaveBeenCalledWith('0');
			// The blockContent from the mock is included in the response
			expect(result.content[0].text).toContain('Updated content');
		});

		it('pluralizes edit count correctly for multiple edits', async () => {
			const multiSession = createMockSession({
				state: 'editing',
				user: fakeUser,
				post: fakePost,
				editBlockTextResult: {
					edits: [
						{ find: 'a', replace: 'b', applied: true },
						{ find: 'c', replace: 'd', applied: true },
					],
					appliedCount: 2,
					failedCount: 0,
					updatedText: 'updated',
				},
			});
			const multiServer = createMockServer();
			registerEditTools(
				multiServer as unknown as McpServer,
				multiSession
			);

			const tool = multiServer.registeredTools.get('wp_edit_block_text');
			assertDefined(tool);
			const result = await tool.handler({
				index: '0',
				edits: [
					{ find: 'a', replace: 'b' },
					{ find: 'c', replace: 'd' },
				],
			});

			expect(result.content[0].text).toContain('Applied 2 edits.');
		});
	});

	describe('wp_insert_block', () => {
		it('inserts block and returns confirmation', async () => {
			const tool = server.registeredTools.get('wp_insert_block');
			assertDefined(tool);
			const result = await tool.handler({
				position: 1,
				name: 'core/paragraph',
				content: 'New paragraph',
			});

			expect(session.insertBlock).toHaveBeenCalledWith(1, {
				name: 'core/paragraph',
				content: 'New paragraph',
				attributes: undefined,
			});
			expect(result.content[0].text).toContain(
				'Inserted core/paragraph block at position 1'
			);
		});

		it('returns error on failure', async () => {
			(
				session.insertBlock as ReturnType<typeof import('vitest').vi.fn>
			).mockImplementation(() => {
				throw new Error(
					"Operation requires state editing, but current state is 'disconnected'"
				);
			});

			const tool = server.registeredTools.get('wp_insert_block');
			assertDefined(tool);
			const result = await tool.handler({
				position: 0,
				name: 'core/paragraph',
			});

			expect(result.isError).toBe(true);
		});
	});

	describe('wp_remove_blocks', () => {
		it('removes blocks with default count of 1', async () => {
			const tool = server.registeredTools.get('wp_remove_blocks');
			assertDefined(tool);
			const result = await tool.handler({ startIndex: 2 });

			expect(session.removeBlocks).toHaveBeenCalledWith(2, 1);
			expect(result.content[0].text).toContain(
				'Removed 1 block starting at index 2'
			);
		});

		it('removes multiple blocks', async () => {
			const tool = server.registeredTools.get('wp_remove_blocks');
			assertDefined(tool);
			const result = await tool.handler({ startIndex: 0, count: 3 });

			expect(session.removeBlocks).toHaveBeenCalledWith(0, 3);
			expect(result.content[0].text).toContain('Removed 3 blocks');
		});

		it('returns error on failure', async () => {
			(
				session.removeBlocks as ReturnType<
					typeof import('vitest').vi.fn
				>
			).mockImplementation(() => {
				throw new Error('Index out of bounds');
			});

			const tool = server.registeredTools.get('wp_remove_blocks');
			assertDefined(tool);
			const result = await tool.handler({ startIndex: 99 });

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain('Failed to remove blocks');
		});
	});

	describe('wp_move_block', () => {
		it('moves block and returns confirmation', async () => {
			const tool = server.registeredTools.get('wp_move_block');
			assertDefined(tool);
			const result = await tool.handler({ fromIndex: 0, toIndex: 3 });

			expect(session.moveBlock).toHaveBeenCalledWith(0, 3);
			expect(result.content[0].text).toContain(
				'Moved block from position 0 to 3'
			);
		});

		it('returns error on failure', async () => {
			(
				session.moveBlock as ReturnType<typeof import('vitest').vi.fn>
			).mockImplementation(() => {
				throw new Error('Index out of bounds');
			});

			const tool = server.registeredTools.get('wp_move_block');
			assertDefined(tool);
			const result = await tool.handler({ fromIndex: 99, toIndex: 0 });

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain('Failed to move block');
		});
	});

	describe('wp_replace_blocks', () => {
		it('replaces blocks and returns confirmation', async () => {
			const tool = server.registeredTools.get('wp_replace_blocks');
			assertDefined(tool);
			const result = await tool.handler({
				startIndex: 1,
				count: 2,
				blocks: [
					{
						name: 'core/heading',
						content: 'New Heading',
						attributes: { level: 2 },
					},
					{ name: 'core/paragraph', content: 'New paragraph' },
				],
			});

			expect(session.replaceBlocks).toHaveBeenCalledWith(1, 2, [
				{
					name: 'core/heading',
					content: 'New Heading',
					attributes: { level: 2 },
				},
				{ name: 'core/paragraph', content: 'New paragraph' },
			]);
			expect(result.content[0].text).toContain(
				'Replaced 2 blocks at index 1 with 2 new blocks'
			);
		});

		it('returns error on failure', async () => {
			(
				session.replaceBlocks as ReturnType<
					typeof import('vitest').vi.fn
				>
			).mockImplementation(() => {
				throw new Error('Index out of bounds');
			});

			const tool = server.registeredTools.get('wp_replace_blocks');
			assertDefined(tool);
			const result = await tool.handler({
				startIndex: 99,
				count: 1,
				blocks: [{ name: 'core/paragraph', content: 'test' }],
			});

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain(
				'Failed to replace blocks'
			);
		});
	});

	describe('wp_insert_block with innerBlocks', () => {
		it('passes innerBlocks through to session.insertBlock', async () => {
			const tool = server.registeredTools.get('wp_insert_block');
			assertDefined(tool);
			const result = await tool.handler({
				position: 0,
				name: 'core/list',
				innerBlocks: [
					{ name: 'core/list-item', content: 'Item 1' },
					{ name: 'core/list-item', content: 'Item 2' },
				],
			});

			expect(session.insertBlock).toHaveBeenCalledWith(0, {
				name: 'core/list',
				content: undefined,
				attributes: undefined,
				innerBlocks: [
					{ name: 'core/list-item', content: 'Item 1' },
					{ name: 'core/list-item', content: 'Item 2' },
				],
			});
			expect(result.content[0].text).toContain(
				'Inserted core/list block at position 0'
			);
		});
	});

	describe('wp_insert_inner_block', () => {
		it('calls session.insertInnerBlock with correct args', async () => {
			const tool = server.registeredTools.get('wp_insert_inner_block');
			assertDefined(tool);
			const result = await tool.handler({
				parentIndex: '0',
				position: 1,
				name: 'core/list-item',
				content: 'New list item',
			});

			expect(session.insertInnerBlock).toHaveBeenCalledWith('0', 1, {
				name: 'core/list-item',
				content: 'New list item',
				attributes: undefined,
				innerBlocks: undefined,
			});
			expect(result.content[0].text).toContain(
				'Inserted core/list-item as inner block at 0.1'
			);
		});

		it('returns error on failure', async () => {
			(
				session.insertInnerBlock as ReturnType<
					typeof import('vitest').vi.fn
				>
			).mockImplementation(() => {
				throw new Error('Block not found at index 99');
			});

			const tool = server.registeredTools.get('wp_insert_inner_block');
			assertDefined(tool);
			const result = await tool.handler({
				parentIndex: '99',
				position: 0,
				name: 'core/list-item',
			});

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain(
				'Failed to insert inner block'
			);
		});
	});

	describe('wp_remove_inner_blocks', () => {
		it('calls session.removeInnerBlocks with default count of 1', async () => {
			const tool = server.registeredTools.get('wp_remove_inner_blocks');
			assertDefined(tool);
			const result = await tool.handler({
				parentIndex: '0',
				startIndex: 1,
			});

			expect(session.removeInnerBlocks).toHaveBeenCalledWith('0', 1, 1);
			expect(result.content[0].text).toContain(
				'Removed 1 inner block from block 0'
			);
		});

		it('calls session.removeInnerBlocks with explicit count', async () => {
			const tool = server.registeredTools.get('wp_remove_inner_blocks');
			assertDefined(tool);
			const result = await tool.handler({
				parentIndex: '2',
				startIndex: 0,
				count: 3,
			});

			expect(session.removeInnerBlocks).toHaveBeenCalledWith('2', 0, 3);
			expect(result.content[0].text).toContain(
				'Removed 3 inner blocks from block 2'
			);
		});

		it('returns error on failure', async () => {
			(
				session.removeInnerBlocks as ReturnType<
					typeof import('vitest').vi.fn
				>
			).mockImplementation(() => {
				throw new Error('Block at 0 has no inner blocks');
			});

			const tool = server.registeredTools.get('wp_remove_inner_blocks');
			assertDefined(tool);
			const result = await tool.handler({
				parentIndex: '0',
				startIndex: 0,
			});

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain(
				'Failed to remove inner blocks'
			);
		});
	});

	describe('wp_replace_blocks with innerBlocks', () => {
		it('passes innerBlocks through to session.replaceBlocks', async () => {
			const tool = server.registeredTools.get('wp_replace_blocks');
			assertDefined(tool);
			const result = await tool.handler({
				startIndex: 0,
				count: 1,
				blocks: [
					{
						name: 'core/list',
						innerBlocks: [
							{
								name: 'core/list-item',
								content: 'Replaced item',
							},
						],
					},
				],
			});

			expect(session.replaceBlocks).toHaveBeenCalledWith(0, 1, [
				{
					name: 'core/list',
					innerBlocks: [
						{ name: 'core/list-item', content: 'Replaced item' },
					],
				},
			]);
			expect(result.content[0].text).toContain(
				'Replaced 1 block at index 0 with 1 new block'
			);
		});
	});

	describe('wp_set_title', () => {
		it('sets title and returns confirmation', async () => {
			const tool = server.registeredTools.get('wp_set_title');
			assertDefined(tool);
			const result = await tool.handler({ title: 'New Title' });

			expect(session.setTitle).toHaveBeenCalledWith('New Title');
			expect(result.content[0].text).toContain(
				'Title set to "New Title"'
			);
		});

		it('returns error when not editing', async () => {
			(
				session.setTitle as ReturnType<typeof import('vitest').vi.fn>
			).mockImplementation(() => {
				throw new Error(
					"Operation requires state editing, but current state is 'disconnected'"
				);
			});

			const tool = server.registeredTools.get('wp_set_title');
			assertDefined(tool);
			const result = await tool.handler({ title: 'Test' });

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain('Failed to set title');
		});
	});
});
