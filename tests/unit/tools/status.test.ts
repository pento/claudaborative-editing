import { describe, it, expect, beforeEach } from 'vitest';
import { registerStatusTools } from '../../../src/tools/status.js';
import {
	createMockServer,
	createMockSession,
	fakeUser,
	fakePost,
	fakeCollaborator,
} from './helpers.js';
import { assertDefined } from '../../test-utils.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

describe('status tools', () => {
	let server: ReturnType<typeof createMockServer>;

	beforeEach(() => {
		server = createMockServer();
	});

	it('registers wp_status, wp_collaborators, and wp_save', () => {
		const session = createMockSession();
		registerStatusTools(server as unknown as McpServer, session);

		expect(server.registeredTools.has('wp_status')).toBe(true);
		expect(server.registeredTools.has('wp_collaborators')).toBe(true);
		expect(server.registeredTools.has('wp_save')).toBe(true);
	});

	describe('wp_status', () => {
		it('shows disconnected state', async () => {
			const session = createMockSession({ state: 'disconnected' });
			registerStatusTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_status');
			assertDefined(tool);
			const result = await tool.handler({});

			expect(result.content[0].text).toContain(
				'Connection: disconnected'
			);
			expect(result.content[0].text).toContain('wp_connect');
		});

		it('shows connected state without a post open', async () => {
			const session = createMockSession({
				state: 'connected',
				user: fakeUser,
			});
			registerStatusTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_status');
			assertDefined(tool);
			const result = await tool.handler({});

			expect(result.content[0].text).toContain('Connection: connected');
			expect(result.content[0].text).toContain('Gary');
			expect(result.content[0].text).toContain('Post: none open');
		});

		it('shows editing state with post and sync info', async () => {
			const session = createMockSession({
				state: 'editing',
				user: fakeUser,
				post: fakePost,
				syncStatus: {
					isPolling: true,
					hasCollaborators: true,
					queueSize: 0,
				},
				collaborators: [fakeCollaborator],
			});
			registerStatusTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_status');
			assertDefined(tool);
			const result = await tool.handler({});
			const text = result.content[0].text;

			expect(text).toContain('Connection: connected');
			expect(text).toContain('Gary (ID: 1)');
			expect(text).toContain('Sync: polling');
			expect(text).toContain('2 collaborators');
			expect(text).toContain('"My Great Post"');
			expect(text).toContain('ID: 42');
			expect(text).toContain('status: publish');
			expect(text).toContain('Queue: 0 pending updates');
		});

		it('shows warning when post is gone', async () => {
			const session = createMockSession({
				state: 'editing',
				user: fakeUser,
				post: fakePost,
				postGone: { gone: true, reason: 'This post has been deleted.' },
			});
			registerStatusTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_status');
			assertDefined(tool);
			const result = await tool.handler({});
			const text = result.content[0].text;

			expect(text).toContain('WARNING');
			expect(text).toContain('This post has been deleted.');
			expect(text).toContain('wp_close_post');
			expect(text).toContain('ID: 42');
			expect(text).not.toContain('Sync:');
			expect(text).not.toContain('Queue:');
		});

		it('shows plugin info when detected', async () => {
			const session = createMockSession({
				state: 'connected',
				user: fakeUser,
				pluginInfo: {
					version: '1.0.0',
					protocolVersion: 1,
					transport: 'sse',
				},
			});
			registerStatusTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_status');
			assertDefined(tool);
			const result = await tool.handler({});
			const text = result.content[0].text;

			expect(text).toContain('Plugin: v1.0.0');
			expect(text).toContain('protocol v1');
			expect(text).toContain('listener: sse');
		});

		it('shows plugin not detected when getPluginInfo returns null', async () => {
			const session = createMockSession({
				state: 'connected',
				user: fakeUser,
				pluginInfo: null,
			});
			registerStatusTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_status');
			assertDefined(tool);
			const result = await tool.handler({});

			expect(result.content[0].text).toContain('Plugin: not detected');
		});

		it('reads title from Y.Doc via getTitle(), not from getCurrentPost()', async () => {
			const session = createMockSession({
				state: 'editing',
				user: fakeUser,
				post: fakePost,
				syncStatus: {
					isPolling: true,
					hasCollaborators: false,
					queueSize: 0,
				},
			});
			// Simulate title changed in Y.Doc but not in currentPost
			(
				session.getTitle as ReturnType<typeof import('vitest').vi.fn>
			).mockReturnValue('Updated Title');
			registerStatusTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_status');
			assertDefined(tool);
			const result = await tool.handler({});
			const text = result.content[0].text;

			expect(text).toContain('"Updated Title"');
			expect(text).not.toContain('My Great Post');
			expect(session.getTitle).toHaveBeenCalled();
		});
	});

	describe('wp_collaborators', () => {
		it('lists collaborators when editing', async () => {
			const session = createMockSession({
				state: 'editing',
				user: fakeUser,
				post: fakePost,
				collaborators: [fakeCollaborator],
			});
			registerStatusTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_collaborators');
			assertDefined(tool);
			const result = await tool.handler({});
			const text = result.content[0].text;

			expect(text).toContain('Active collaborators:');
			expect(text).toContain('Gary (AI, Claude Code MCP)');
			expect(text).toContain('Alice (Human, Chrome)');
		});

		it('shows fallback when no user and no collaborators', async () => {
			const session = createMockSession({
				state: 'editing',
				user: null,
				post: fakePost,
				collaborators: [],
			});
			registerStatusTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_collaborators');
			assertDefined(tool);
			const result = await tool.handler({});

			expect(result.content[0].text).toContain(
				'No collaborators detected'
			);
		});

		it('returns error on unexpected failure', async () => {
			const session = createMockSession({
				state: 'editing',
				user: fakeUser,
				post: fakePost,
			});
			(
				session.getCollaborators as ReturnType<
					typeof import('vitest').vi.fn
				>
			).mockImplementation(() => {
				throw new Error('unexpected');
			});
			registerStatusTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_collaborators');
			assertDefined(tool);
			const result = await tool.handler({});

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain(
				'Failed to get collaborators: unexpected'
			);
		});

		it('returns error when not editing', async () => {
			const session = createMockSession({
				state: 'connected',
				user: fakeUser,
			});
			registerStatusTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_collaborators');
			assertDefined(tool);
			const result = await tool.handler({});

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain(
				'No post is currently open'
			);
		});
	});

	describe('wp_save', () => {
		it('saves and returns confirmation', async () => {
			const session = createMockSession({
				state: 'editing',
				user: fakeUser,
				post: fakePost,
			});
			registerStatusTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_save');
			assertDefined(tool);
			const result = await tool.handler({});

			expect(session.save).toHaveBeenCalled();
			expect(result.content[0].text).toContain(
				'Post "My Great Post" saved.'
			);
		});

		it('reads title from Y.Doc via getTitle()', async () => {
			const session = createMockSession({
				state: 'editing',
				user: fakeUser,
				post: fakePost,
			});
			(
				session.getTitle as ReturnType<typeof import('vitest').vi.fn>
			).mockReturnValue('Updated Title');
			registerStatusTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_save');
			assertDefined(tool);
			const result = await tool.handler({});

			expect(result.content[0].text).toContain(
				'Post "Updated Title" saved.'
			);
			expect(session.getTitle).toHaveBeenCalled();
		});

		it('returns error when not editing', async () => {
			const session = createMockSession({ state: 'disconnected' });
			(
				session.save as ReturnType<typeof import('vitest').vi.fn>
			).mockImplementation(() => {
				throw new Error(
					"Operation requires state editing, but current state is 'disconnected'"
				);
			});
			registerStatusTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_save');
			assertDefined(tool);
			const result = await tool.handler({});

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain('Failed to save');
		});
	});
});
