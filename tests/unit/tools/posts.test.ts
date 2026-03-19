import { describe, it, expect, beforeEach } from 'vitest';
import { registerPostTools } from '../../../src/tools/posts.js';
import { createMockServer, createMockSession, fakeUser, fakePost } from './helpers.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../../../src/session/session-manager.js';

describe('post tools', () => {
  let server: ReturnType<typeof createMockServer>;
  let session: SessionManager;

  beforeEach(() => {
    server = createMockServer();
    session = createMockSession({
      state: 'connected',
      user: fakeUser,
      post: fakePost,
    });
    registerPostTools(server as unknown as McpServer, session);
  });

  it('registers wp_list_posts, wp_open_post, and wp_create_post', () => {
    expect(server.registeredTools.has('wp_list_posts')).toBe(true);
    expect(server.registeredTools.has('wp_open_post')).toBe(true);
    expect(server.registeredTools.has('wp_create_post')).toBe(true);
  });

  describe('wp_list_posts', () => {
    it('returns formatted list of posts', async () => {
      const tool = server.registeredTools.get('wp_list_posts')!;
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('Found 1 posts');
      expect(result.content[0].text).toContain('[42]');
      expect(result.content[0].text).toContain('My Great Post');
      expect(result.content[0].text).toContain('publish');
    });

    it('passes filter options to session', async () => {
      const tool = server.registeredTools.get('wp_list_posts')!;
      await tool.handler({ status: 'draft', search: 'test', perPage: 5 });

      expect(session.listPosts).toHaveBeenCalledWith({
        status: 'draft',
        search: 'test',
        perPage: 5,
      });
    });

    it('shows message when no posts found', async () => {
      (session.listPosts as ReturnType<typeof import('vitest').vi.fn>).mockResolvedValue([]);

      const tool = server.registeredTools.get('wp_list_posts')!;
      const result = await tool.handler({});

      expect(result.content[0].text).toBe('No posts found.');
    });

    it('returns error on failure', async () => {
      (session.listPosts as ReturnType<typeof import('vitest').vi.fn>).mockRejectedValue(
        new Error('API error'),
      );

      const tool = server.registeredTools.get('wp_list_posts')!;
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to list posts');
    });
  });

  describe('wp_open_post', () => {
    it('opens post and returns rendered content', async () => {
      const tool = server.registeredTools.get('wp_open_post')!;
      const result = await tool.handler({ postId: 42 });

      expect(session.openPost).toHaveBeenCalledWith(42);
      expect(result.content[0].text).toContain('Opened post 42 for editing');
      expect(result.content[0].text).toContain('Title:');
    });

    it('returns error on failure', async () => {
      (session.openPost as ReturnType<typeof import('vitest').vi.fn>).mockRejectedValue(
        new Error('Post not found'),
      );

      const tool = server.registeredTools.get('wp_open_post')!;
      const result = await tool.handler({ postId: 999 });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to open post');
    });
  });

  describe('wp_create_post', () => {
    it('creates post and returns rendered content', async () => {
      const tool = server.registeredTools.get('wp_create_post')!;
      const result = await tool.handler({ title: 'New Post' });

      expect(session.createPost).toHaveBeenCalledWith({ title: 'New Post', content: undefined });
      expect(result.content[0].text).toContain('Created and opened post 42');
    });

    it('returns error on failure', async () => {
      (session.createPost as ReturnType<typeof import('vitest').vi.fn>).mockRejectedValue(
        new Error('Permission denied'),
      );

      const tool = server.registeredTools.get('wp_create_post')!;
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to create post');
    });
  });
});
