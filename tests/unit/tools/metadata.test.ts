import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerMetadataTools } from '../../../src/tools/metadata.js';
import { createMockServer, createMockSession, fakeUser, fakePost } from './helpers.js';
import { assertDefined } from '../../test-utils.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../../../src/session/session-manager.js';

describe('metadata tools', () => {
  let server: ReturnType<typeof createMockServer>;
  let session: SessionManager;

  beforeEach(() => {
    server = createMockServer();
    session = createMockSession({
      state: 'editing',
      user: fakeUser,
      post: fakePost,
    });

    // Override defaults from createMockSession where tests need non-empty return values
    (session.setCategories as ReturnType<typeof vi.fn>).mockResolvedValue({
      post: fakePost,
      resolved: [{ name: 'Uncategorized', id: 1, created: false }],
    });
    (session.listCategories as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 1, name: 'Uncategorized', slug: 'uncategorized', taxonomy: 'category', count: 5 },
    ]);

    registerMetadataTools(server as unknown as McpServer, session);
  });

  it('registers all 11 metadata tools', () => {
    expect(server.registeredTools.has('wp_list_categories')).toBe(true);
    expect(server.registeredTools.has('wp_list_tags')).toBe(true);
    expect(server.registeredTools.has('wp_set_status')).toBe(true);
    expect(server.registeredTools.has('wp_set_categories')).toBe(true);
    expect(server.registeredTools.has('wp_set_tags')).toBe(true);
    expect(server.registeredTools.has('wp_set_excerpt')).toBe(true);
    expect(server.registeredTools.has('wp_set_featured_image')).toBe(true);
    expect(server.registeredTools.has('wp_set_date')).toBe(true);
    expect(server.registeredTools.has('wp_set_slug')).toBe(true);
    expect(server.registeredTools.has('wp_set_sticky')).toBe(true);
    expect(server.registeredTools.has('wp_set_comment_status')).toBe(true);
    expect(server.registeredTools.size).toBe(11);
  });

  describe('wp_list_categories', () => {
    it('lists categories with counts', async () => {
      const tool = server.registeredTools.get('wp_list_categories');
      assertDefined(tool);
      const result = await tool.handler({});

      expect(session.listCategories as ReturnType<typeof vi.fn>).toHaveBeenCalledWith({
        search: undefined,
      });
      expect(result.content[0].text).toContain('Uncategorized');
      expect(result.content[0].text).toContain('5 posts');
    });

    it('passes search filter', async () => {
      const tool = server.registeredTools.get('wp_list_categories');
      assertDefined(tool);
      await tool.handler({ search: 'tech' });

      expect(session.listCategories as ReturnType<typeof vi.fn>).toHaveBeenCalledWith({
        search: 'tech',
      });
    });

    it('returns error on failure', async () => {
      (session.listCategories as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('API error'),
      );
      const tool = server.registeredTools.get('wp_list_categories');
      assertDefined(tool);
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to list categories');
    });
  });

  describe('wp_list_tags', () => {
    it('returns none found for empty list', async () => {
      const tool = server.registeredTools.get('wp_list_tags');
      assertDefined(tool);
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('None found.');
    });

    it('lists tags when present', async () => {
      (session.listTags as ReturnType<typeof vi.fn>).mockResolvedValue([
        { id: 1, name: 'tutorial', slug: 'tutorial', taxonomy: 'post_tag', count: 3 },
      ]);
      const tool = server.registeredTools.get('wp_list_tags');
      assertDefined(tool);
      const result = await tool.handler({});

      expect(result.content[0].text).toContain('tutorial');
      expect(result.content[0].text).toContain('3 posts');
    });

    it('returns error on failure', async () => {
      (session.listTags as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API error'));
      const tool = server.registeredTools.get('wp_list_tags');
      assertDefined(tool);
      const result = await tool.handler({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to list tags');
    });
  });

  describe('wp_set_status', () => {
    it('changes status and returns confirmation', async () => {
      const tool = server.registeredTools.get('wp_set_status');
      assertDefined(tool);
      const result = await tool.handler({ status: 'draft' });

      expect(session.setPostStatus).toHaveBeenCalledWith('draft');
      expect(result.content[0].text).toBe('Status changed from "publish" to "draft".');
    });

    it('shows old status from current post', async () => {
      const tool = server.registeredTools.get('wp_set_status');
      assertDefined(tool);
      const result = await tool.handler({ status: 'publish' });

      expect(result.content[0].text).toBe('Status changed from "publish" to "publish".');
    });

    it('returns error on failure', async () => {
      (session.setPostStatus as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Insufficient permissions'),
      );

      const tool = server.registeredTools.get('wp_set_status');
      assertDefined(tool);
      const result = await tool.handler({ status: 'publish' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to set status');
      expect(result.content[0].text).toContain('Insufficient permissions');
    });
  });

  describe('wp_set_categories', () => {
    it('sets existing categories', async () => {
      (session.setCategories as ReturnType<typeof vi.fn>).mockResolvedValue({
        post: fakePost,
        resolved: [{ name: 'Tech', id: 1, created: false }],
      });

      const tool = server.registeredTools.get('wp_set_categories');
      assertDefined(tool);
      const result = await tool.handler({ categories: ['Tech'] });

      expect(session.setCategories).toHaveBeenCalledWith(['Tech']);
      expect(result.content[0].text).toBe('Categories set: Tech.');
    });

    it('indicates newly created categories', async () => {
      (session.setCategories as ReturnType<typeof vi.fn>).mockResolvedValue({
        post: fakePost,
        resolved: [{ name: 'AI', id: 2, created: true }],
      });

      const tool = server.registeredTools.get('wp_set_categories');
      assertDefined(tool);
      const result = await tool.handler({ categories: ['AI'] });

      expect(result.content[0].text).toBe('Categories set: AI (created).');
    });

    it('handles mix of existing and created categories', async () => {
      (session.setCategories as ReturnType<typeof vi.fn>).mockResolvedValue({
        post: fakePost,
        resolved: [
          { name: 'Tech', id: 1, created: false },
          { name: 'AI', id: 2, created: true },
        ],
      });

      const tool = server.registeredTools.get('wp_set_categories');
      assertDefined(tool);
      const result = await tool.handler({ categories: ['Tech', 'AI'] });

      expect(result.content[0].text).toBe('Categories set: Tech, AI (created).');
    });

    it('returns error on failure', async () => {
      (session.setCategories as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Not editing'),
      );

      const tool = server.registeredTools.get('wp_set_categories');
      assertDefined(tool);
      const result = await tool.handler({ categories: ['Tech'] });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to set categories');
      expect(result.content[0].text).toContain('Not editing');
    });
  });

  describe('wp_set_tags', () => {
    it('sets tags and returns confirmation', async () => {
      (session.setTags as ReturnType<typeof vi.fn>).mockResolvedValue({
        post: fakePost,
        resolved: [
          { name: 'tutorial', id: 5, created: false },
          { name: 'beginner', id: 6, created: true },
        ],
      });

      const tool = server.registeredTools.get('wp_set_tags');
      assertDefined(tool);
      const result = await tool.handler({ tags: ['tutorial', 'beginner'] });

      expect(session.setTags).toHaveBeenCalledWith(['tutorial', 'beginner']);
      expect(result.content[0].text).toBe('Tags set: tutorial, beginner (created).');
    });

    it('removes all tags when passed empty array', async () => {
      const tool = server.registeredTools.get('wp_set_tags');
      assertDefined(tool);
      const result = await tool.handler({ tags: [] });

      expect(session.setTags).toHaveBeenCalledWith([]);
      expect(result.content[0].text).toBe('All tags removed.');
    });

    it('returns error on failure', async () => {
      (session.setTags as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API error'));

      const tool = server.registeredTools.get('wp_set_tags');
      assertDefined(tool);
      const result = await tool.handler({ tags: ['fail'] });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to set tags');
      expect(result.content[0].text).toContain('API error');
    });
  });

  describe('wp_set_excerpt', () => {
    it('sets excerpt and returns confirmation', async () => {
      const tool = server.registeredTools.get('wp_set_excerpt');
      assertDefined(tool);
      const result = await tool.handler({ excerpt: 'A brief summary of the post.' });

      expect(session.setExcerpt).toHaveBeenCalledWith('A brief summary of the post.');
      expect(result.content[0].text).toBe('Excerpt set.');
    });

    it('clears excerpt when passed empty string', async () => {
      const tool = server.registeredTools.get('wp_set_excerpt');
      assertDefined(tool);
      const result = await tool.handler({ excerpt: '' });

      expect(session.setExcerpt).toHaveBeenCalledWith('');
      expect(result.content[0].text).toBe('Excerpt cleared.');
    });

    it('returns error on failure', async () => {
      (session.setExcerpt as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Not editing'));

      const tool = server.registeredTools.get('wp_set_excerpt');
      assertDefined(tool);
      const result = await tool.handler({ excerpt: 'test' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to set excerpt');
      expect(result.content[0].text).toContain('Not editing');
    });
  });

  describe('wp_set_featured_image', () => {
    it('sets featured image and returns confirmation', async () => {
      const tool = server.registeredTools.get('wp_set_featured_image');
      assertDefined(tool);
      const result = await tool.handler({ attachmentId: 42 });

      expect(session.setFeaturedImage).toHaveBeenCalledWith(42);
      expect(result.content[0].text).toBe('Featured image set to attachment 42.');
    });

    it('removes featured image when passed 0', async () => {
      const tool = server.registeredTools.get('wp_set_featured_image');
      assertDefined(tool);
      const result = await tool.handler({ attachmentId: 0 });

      expect(session.setFeaturedImage).toHaveBeenCalledWith(0);
      expect(result.content[0].text).toBe('Featured image removed.');
    });

    it('returns error on failure', async () => {
      (session.setFeaturedImage as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Invalid attachment ID'),
      );

      const tool = server.registeredTools.get('wp_set_featured_image');
      assertDefined(tool);
      const result = await tool.handler({ attachmentId: 999 });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to set featured image');
      expect(result.content[0].text).toContain('Invalid attachment ID');
    });
  });

  describe('wp_set_date', () => {
    it('sets date and returns confirmation with the date', async () => {
      (session.setDate as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...fakePost,
        date: '2026-04-01T09:00:00',
      });

      const tool = server.registeredTools.get('wp_set_date');
      assertDefined(tool);
      const result = await tool.handler({ date: '2026-04-01T09:00:00' });

      expect(session.setDate).toHaveBeenCalledWith('2026-04-01T09:00:00');
      expect(result.content[0].text).toBe('Publication date set to 2026-04-01T09:00:00.');
    });

    it('resets date when passed empty string', async () => {
      const tool = server.registeredTools.get('wp_set_date');
      assertDefined(tool);
      const result = await tool.handler({ date: '' });

      expect(session.setDate).toHaveBeenCalledWith('');
      expect(result.content[0].text).toBe('Publication date reset to default.');
    });

    it('returns error on failure', async () => {
      (session.setDate as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Invalid date format'),
      );

      const tool = server.registeredTools.get('wp_set_date');
      assertDefined(tool);
      const result = await tool.handler({ date: 'not-a-date' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to set date');
      expect(result.content[0].text).toContain('Invalid date format');
    });
  });

  describe('wp_set_slug', () => {
    it('sets slug and returns confirmation', async () => {
      (session.setSlug as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...fakePost,
        slug: 'my-custom-url',
      });

      const tool = server.registeredTools.get('wp_set_slug');
      assertDefined(tool);
      const result = await tool.handler({ slug: 'my-custom-url' });

      expect(session.setSlug).toHaveBeenCalledWith('my-custom-url');
      expect(result.content[0].text).toBe('Slug set to "my-custom-url".');
    });

    it('indicates when slug was adjusted for uniqueness', async () => {
      (session.setSlug as ReturnType<typeof vi.fn>).mockResolvedValue({
        ...fakePost,
        slug: 'my-url-2',
      });

      const tool = server.registeredTools.get('wp_set_slug');
      assertDefined(tool);
      const result = await tool.handler({ slug: 'my-url' });

      expect(session.setSlug).toHaveBeenCalledWith('my-url');
      expect(result.content[0].text).toBe(
        'Slug set to "my-url-2" (adjusted from "my-url" for uniqueness).',
      );
    });

    it('returns error on failure', async () => {
      (session.setSlug as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Invalid slug'));

      const tool = server.registeredTools.get('wp_set_slug');
      assertDefined(tool);
      const result = await tool.handler({ slug: '' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to set slug');
      expect(result.content[0].text).toContain('Invalid slug');
    });
  });

  describe('wp_set_sticky', () => {
    it('pins post to front page', async () => {
      const tool = server.registeredTools.get('wp_set_sticky');
      assertDefined(tool);
      const result = await tool.handler({ sticky: true });

      expect(session.setSticky).toHaveBeenCalledWith(true);
      expect(result.content[0].text).toBe('Post pinned to front page.');
    });

    it('unpins post', async () => {
      const tool = server.registeredTools.get('wp_set_sticky');
      assertDefined(tool);
      const result = await tool.handler({ sticky: false });

      expect(session.setSticky).toHaveBeenCalledWith(false);
      expect(result.content[0].text).toBe('Post unpinned.');
    });

    it('returns error on failure', async () => {
      (session.setSticky as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('Not editing'));

      const tool = server.registeredTools.get('wp_set_sticky');
      assertDefined(tool);
      const result = await tool.handler({ sticky: true });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to set sticky');
      expect(result.content[0].text).toContain('Not editing');
    });
  });

  describe('wp_set_comment_status', () => {
    it('enables comments', async () => {
      const tool = server.registeredTools.get('wp_set_comment_status');
      assertDefined(tool);
      const result = await tool.handler({ status: 'open' });

      expect(session.setCommentStatus).toHaveBeenCalledWith('open');
      expect(result.content[0].text).toBe('Comments enabled.');
    });

    it('disables comments', async () => {
      const tool = server.registeredTools.get('wp_set_comment_status');
      assertDefined(tool);
      const result = await tool.handler({ status: 'closed' });

      expect(session.setCommentStatus).toHaveBeenCalledWith('closed');
      expect(result.content[0].text).toBe('Comments disabled.');
    });

    it('returns error on failure', async () => {
      (session.setCommentStatus as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error('Permission denied'),
      );

      const tool = server.registeredTools.get('wp_set_comment_status');
      assertDefined(tool);
      const result = await tool.handler({ status: 'open' });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Failed to set comment status');
      expect(result.content[0].text).toContain('Permission denied');
    });
  });
});
