import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/session-manager.js';

export function registerPostTools(server: McpServer, session: SessionManager): void {
  server.registerTool(
    'wp_list_posts',
    {
      description:
        'List WordPress posts with optional filters. By default, this shows published posts; specify a status filter if you want to see drafts or other non-published posts.',
      inputSchema: {
        status: z
          .string()
          .optional()
          .describe('Filter by post status (e.g., publish, draft, pending)'),
        search: z.string().optional().describe('Search posts by keyword'),
        perPage: z.number().optional().describe('Number of posts to return (default 10)'),
      },
    },
    async ({ status, search, perPage }) => {
      try {
        const posts = await session.listPosts({ status, search, perPage });
        if (posts.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No posts found.' }],
          };
        }

        const lines = posts.map(
          (post, i) =>
            `${i + 1}. [${post.id}] ${post.title.raw ?? post.title.rendered} (${post.status})`,
        );

        return {
          content: [
            {
              type: 'text' as const,
              text: `Found ${posts.length} posts:\n\n${lines.join('\n')}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to list posts: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'wp_open_post',
    {
      description: 'Open a WordPress post for collaborative editing',
      inputSchema: {
        postId: z.number().describe('The post ID to open'),
      },
    },
    async ({ postId }) => {
      try {
        await session.openPost(postId);
        const content = session.readPost();
        return {
          content: [
            {
              type: 'text' as const,
              text: `Opened post ${postId} for editing.\n\n${content}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to open post: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'wp_close_post',
    {
      description: 'Close the current post and stop syncing, without disconnecting from WordPress',
    },
    async () => {
      try {
        await session.closePost();
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Post closed. You can now open another post with wp_open_post or wp_create_post.',
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to close post: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    'wp_create_post',
    {
      description: 'Create a new WordPress post and open it for editing',
      inputSchema: {
        title: z.string().optional().describe('Post title'),
        content: z.string().optional().describe('Initial post content (Gutenberg HTML)'),
      },
    },
    async ({ title, content }) => {
      try {
        const post = await session.createPost({ title, content });
        const rendered = session.readPost();
        return {
          content: [
            {
              type: 'text' as const,
              text: `Created and opened post ${post.id}.\n\n${rendered}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Failed to create post: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
