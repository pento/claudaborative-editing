import { z } from 'zod';
import type { ToolDefinition } from './definitions.js';

interface ListPostsInput {
	status?: string;
	search?: string;
	perPage?: number;
}

export const postTools: ToolDefinition[] = [
	{
		name: 'wp_list_posts',
		description:
			'List WordPress posts with optional filters. By default, this shows published posts; specify a status filter if you want to see drafts or other non-published posts.',
		inputSchema: {
			status: z
				.string()
				.optional()
				.describe(
					'Filter by post status (e.g., publish, draft, pending)'
				),
			search: z.string().optional().describe('Search posts by keyword'),
			perPage: z
				.number()
				.optional()
				.describe('Number of posts to return (default 10)'),
		},
		availableIn: ['connected', 'editing'],
		tags: ['posts'],
		execute: async (
			session,
			{ status, search, perPage }: ListPostsInput
		) => {
			const posts = await session.listPosts({
				status,
				search,
				perPage,
			});
			if (posts.length === 0) {
				return 'No posts found.';
			}

			const lines = posts.map(
				(post, i) =>
					`${i + 1}. [${post.id}] ${post.title.raw ?? post.title.rendered} (${post.status})`
			);

			return `Found ${posts.length} posts:\n\n${lines.join('\n')}`;
		},
	},
	{
		name: 'wp_open_post',
		description: 'Open a WordPress post for collaborative editing',
		inputSchema: {
			postId: z.number().describe('The post ID to open'),
		},
		availableIn: ['connected'],
		tags: ['posts'],
		execute: async (session, { postId }: { postId: number }) => {
			await session.openPost(postId);
			const content = session.readPost();
			return `Opened post ${postId} for editing.\n\n${content}`;
		},
	},
	{
		name: 'wp_close_post',
		description:
			'Close the current post and stop syncing, without disconnecting from WordPress',
		availableIn: ['editing'],
		tags: ['posts'],
		execute: async (session) => {
			await session.closePost();
			return 'Post closed. You can now open another post with wp_open_post or wp_create_post.';
		},
	},
	{
		name: 'wp_create_post',
		description: 'Create a new WordPress post and open it for editing',
		inputSchema: {
			title: z.string().optional().describe('Post title'),
			content: z
				.string()
				.optional()
				.describe('Initial post content (Gutenberg HTML)'),
		},
		availableIn: ['connected'],
		tags: ['posts'],
		execute: async (
			session,
			{ title, content }: { title?: string; content?: string }
		) => {
			const post = await session.createPost({ title, content });
			const rendered = session.readPost();
			return `Created and opened post ${post.id}.\n\n${rendered}`;
		},
	},
];
