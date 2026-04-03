import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerStatusTools } from '../../../src/tools/status.js';
import {
	createMockServer,
	createMockSession,
	fakeUser,
	fakePost,
	fakeCollaborator,
} from './helpers.js';
import { assertDefined } from '../../test-utils.js';
import { WordPressApiError } from '../../../src/wordpress/api-client.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

vi.mock('../../../src/version.js', () => ({
	VERSION: '1.2.3',
}));

vi.mock('../../../src/wordpress/api-client.js', () => {
	// eslint-disable-next-line @typescript-eslint/no-shadow -- must match the real export name
	class WordPressApiError extends Error {
		constructor(
			message: string,
			public readonly status: number,
			public readonly body: string
		) {
			super(message);
			this.name = 'WordPressApiError';
		}
	}

	return {
		WordPressApiClient: vi.fn(),
		WordPressApiError,
	};
});

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

		it('shows protocol warning when present', async () => {
			const session = createMockSession({
				state: 'connected',
				user: fakeUser,
				pluginInfo: {
					version: '2.0.0',
					protocolVersion: 99,
					transport: 'disabled',
					protocolWarning:
						'Plugin protocol v99 is not compatible with this MCP server (supports v1). Update the MCP server.',
				},
			});
			registerStatusTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_status');
			assertDefined(tool);
			const result = await tool.handler({});
			const text = result.content[0].text;

			expect(text).toContain('Plugin: v2.0.0');
			expect(text).toContain('listener: disabled');
			expect(text).toContain('WARNING:');
			expect(text).toContain('Update the MCP server.');
		});

		it('does not show warning when protocolWarning is null', async () => {
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

			expect(result.content[0].text).not.toContain('WARNING');
		});

		it('detects plugin on re-probe without install attempt', async () => {
			const session = createMockSession({
				state: 'connected',
				user: fakeUser,
				pluginInfo: null,
			});
			// Re-probe succeeds on first try
			(
				session.detectEditorPlugin as ReturnType<typeof vi.fn>
			).mockResolvedValueOnce(true);
			(session.getPluginInfo as ReturnType<typeof vi.fn>)
				.mockReturnValueOnce(null)
				.mockReturnValue({
					version: '1.0.0',
					protocolVersion: 1,
					transport: 'sse',
					protocolWarning: null,
				});
			registerStatusTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_status');
			assertDefined(tool);
			const result = await tool.handler({});

			expect(session.getEditorPluginInstallStatus).not.toHaveBeenCalled();
			expect(result.content[0].text).toContain('Plugin: v1.0.0');
		});

		it('does not attempt install when plugin is already detected', async () => {
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
			await tool.handler({});

			expect(session.detectEditorPlugin).not.toHaveBeenCalled();
		});

		it('shows download URL when plugin cannot be detected or installed', async () => {
			const session = createMockSession({
				state: 'connected',
				user: fakeUser,
				pluginInfo: null,
			});
			registerStatusTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_status');
			assertDefined(tool);
			const result = await tool.handler({});

			expect(result.content[0].text).toContain('Plugin: not installed');
			expect(result.content[0].text).toContain(
				'github.com/pento/claudaborative-editing/releases/download/v1.2.3/claudaborative-editing-plugin.zip'
			);
		});

		it('activates installed-but-inactive plugin and detects it', async () => {
			const session = createMockSession({
				state: 'connected',
				user: fakeUser,
				pluginInfo: null,
			});
			// detectEditorPlugin: first call returns false, second (after activate) returns true
			const detectMock = session.detectEditorPlugin as ReturnType<
				typeof vi.fn
			>;
			detectMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
			// Plugin is installed but inactive
			(
				session.getEditorPluginInstallStatus as ReturnType<typeof vi.fn>
			).mockResolvedValue({
				installed: true,
				active: false,
				version: '1.0.0',
				pluginFile: 'claudaborative-editing/claudaborative-editing',
			});
			// After activation + detection, getPluginInfo returns data
			(session.getPluginInfo as ReturnType<typeof vi.fn>)
				.mockReturnValueOnce(null) // first check
				.mockReturnValue({
					version: '1.0.0',
					protocolVersion: 1,
					transport: 'sse',
					protocolWarning: null,
				}); // after detection
			registerStatusTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_status');
			assertDefined(tool);
			const result = await tool.handler({});
			const text = result.content[0].text;

			expect(session.activateEditorPlugin).toHaveBeenCalledWith(
				'claudaborative-editing/claudaborative-editing'
			);
			expect(text).toContain('Plugin: v1.0.0');
			expect(text).not.toContain('not installed');
		});

		it('shows inactive message when activation fails', async () => {
			const session = createMockSession({
				state: 'connected',
				user: fakeUser,
				pluginInfo: null,
			});
			(
				session.getEditorPluginInstallStatus as ReturnType<typeof vi.fn>
			).mockResolvedValue({
				installed: true,
				active: false,
				version: '1.0.0',
				pluginFile: 'claudaborative-editing/claudaborative-editing',
			});
			(
				session.activateEditorPlugin as ReturnType<typeof vi.fn>
			).mockRejectedValue(new WordPressApiError('Forbidden', 403, ''));
			registerStatusTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_status');
			assertDefined(tool);
			const result = await tool.handler({});

			expect(result.content[0].text).toContain(
				'Plugin: installed but inactive'
			);
		});

		it('shows incompatible message when plugin is active but detection fails', async () => {
			const session = createMockSession({
				state: 'connected',
				user: fakeUser,
				pluginInfo: null,
			});
			(
				session.getEditorPluginInstallStatus as ReturnType<typeof vi.fn>
			).mockResolvedValue({
				installed: true,
				active: true,
				version: '0.0.1',
				pluginFile: 'claudaborative-editing/claudaborative-editing',
			});
			registerStatusTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_status');
			assertDefined(tool);
			const result = await tool.handler({});
			const text = result.content[0].text;

			expect(text).toContain('Plugin: installed (v0.0.1)');
			expect(text).toContain('not compatible');
			expect(text).not.toContain('not installed');
		});

		it('installs plugin from wordpress.org when not installed', async () => {
			const session = createMockSession({
				state: 'connected',
				user: fakeUser,
				pluginInfo: null,
			});
			const detectMock = session.detectEditorPlugin as ReturnType<
				typeof vi.fn
			>;
			// First detect fails, second (after install) succeeds
			detectMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
			(
				session.getEditorPluginInstallStatus as ReturnType<typeof vi.fn>
			).mockResolvedValue({
				installed: false,
				active: false,
				version: null,
				pluginFile: null,
			});
			(session.getPluginInfo as ReturnType<typeof vi.fn>)
				.mockReturnValueOnce(null)
				.mockReturnValue({
					version: '1.0.0',
					protocolVersion: 1,
					transport: 'sse',
					protocolWarning: null,
				});
			registerStatusTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_status');
			assertDefined(tool);
			const result = await tool.handler({});
			const text = result.content[0].text;

			expect(session.installEditorPlugin).toHaveBeenCalledOnce();
			expect(text).toContain('Plugin: v1.0.0');
			expect(text).not.toContain('not installed');
		});

		it('falls back to download URL when wordpress.org install returns 404', async () => {
			const session = createMockSession({
				state: 'connected',
				user: fakeUser,
				pluginInfo: null,
			});
			(
				session.getEditorPluginInstallStatus as ReturnType<typeof vi.fn>
			).mockResolvedValue({
				installed: false,
				active: false,
				version: null,
				pluginFile: null,
			});
			(
				session.installEditorPlugin as ReturnType<typeof vi.fn>
			).mockRejectedValue(new WordPressApiError('Not Found', 404, ''));
			registerStatusTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_status');
			assertDefined(tool);
			const result = await tool.handler({});

			expect(result.content[0].text).toContain('Plugin: not installed');
			expect(result.content[0].text).toContain('Download from');
		});

		it('falls back to download URL when plugin list check fails (403)', async () => {
			const session = createMockSession({
				state: 'connected',
				user: fakeUser,
				pluginInfo: null,
			});
			(
				session.getEditorPluginInstallStatus as ReturnType<typeof vi.fn>
			).mockRejectedValue(new WordPressApiError('Forbidden', 403, ''));
			registerStatusTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_status');
			assertDefined(tool);
			const result = await tool.handler({});

			expect(result.content[0].text).toContain('Plugin: not installed');
			expect(result.content[0].text).toContain('Download from');
		});

		it('falls back to download URL on non-404 install error', async () => {
			const session = createMockSession({
				state: 'connected',
				user: fakeUser,
				pluginInfo: null,
			});
			(
				session.getEditorPluginInstallStatus as ReturnType<typeof vi.fn>
			).mockResolvedValue({
				installed: false,
				active: false,
				version: null,
				pluginFile: null,
			});
			(
				session.installEditorPlugin as ReturnType<typeof vi.fn>
			).mockRejectedValue(
				new WordPressApiError('Internal Server Error', 500, '')
			);
			registerStatusTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_status');
			assertDefined(tool);
			const result = await tool.handler({});

			expect(result.content[0].text).toContain('Plugin: not installed');
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
