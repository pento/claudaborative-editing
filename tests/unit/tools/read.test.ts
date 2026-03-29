import { describe, it, expect, beforeEach } from 'vitest';
import { registerReadTools } from '../../../src/tools/read.js';
import {
	createMockServer,
	createMockSession,
	fakeUser,
	fakePost,
} from './helpers.js';
import { assertDefined } from '../../test-utils.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../../../src/session/session-manager.js';

describe('read tools', () => {
	let server: ReturnType<typeof createMockServer>;
	let session: SessionManager;

	beforeEach(() => {
		server = createMockServer();
		session = createMockSession({
			state: 'editing',
			user: fakeUser,
			post: fakePost,
			postContent:
				'Title: "My Great Post"\n\n[0] core/paragraph\n  "Hello world"',
			blockContent: '[0] core/paragraph\n  "Hello world"',
		});
		registerReadTools(server as unknown as McpServer, session);
	});

	it('registers wp_read_post and wp_read_block', () => {
		expect(server.registeredTools.has('wp_read_post')).toBe(true);
		expect(server.registeredTools.has('wp_read_block')).toBe(true);
	});

	describe('wp_read_post', () => {
		it('returns rendered post content', async () => {
			const tool = server.registeredTools.get('wp_read_post');
			assertDefined(tool);
			const result = await tool.handler({});

			expect(result.content[0].text).toContain('Title: "My Great Post"');
			expect(result.content[0].text).toContain('core/paragraph');
		});

		it('returns error when not editing', async () => {
			(
				session.readPost as ReturnType<typeof import('vitest').vi.fn>
			).mockImplementation(() => {
				throw new Error(
					"Operation requires state editing, but current state is 'connected'"
				);
			});

			const tool = server.registeredTools.get('wp_read_post');
			assertDefined(tool);
			const result = await tool.handler({});

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain('Failed to read post');
		});
	});

	describe('wp_read_block', () => {
		it('returns specific block content', async () => {
			const tool = server.registeredTools.get('wp_read_block');
			assertDefined(tool);
			const result = await tool.handler({ index: '0' });

			expect(session.readBlock).toHaveBeenCalledWith('0');
			expect(result.content[0].text).toContain('core/paragraph');
			expect(result.content[0].text).toContain('Hello world');
		});

		it('supports dot notation for nested blocks', async () => {
			(
				session.readBlock as ReturnType<typeof import('vitest').vi.fn>
			).mockReturnValue('[2.1] core/list-item\n  "Nested item"');

			const tool = server.registeredTools.get('wp_read_block');
			assertDefined(tool);
			const result = await tool.handler({ index: '2.1' });

			expect(session.readBlock).toHaveBeenCalledWith('2.1');
			expect(result.content[0].text).toContain('Nested item');
		});

		it('returns error for invalid index', async () => {
			(
				session.readBlock as ReturnType<typeof import('vitest').vi.fn>
			).mockImplementation(() => {
				throw new Error('Block not found at index 99');
			});

			const tool = server.registeredTools.get('wp_read_block');
			assertDefined(tool);
			const result = await tool.handler({ index: '99' });

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain('Block not found');
		});
	});
});
