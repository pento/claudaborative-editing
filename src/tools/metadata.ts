import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/session-manager.js';

const validStatuses = [
	'draft',
	'pending',
	'publish',
	'private',
	'future',
] as const;

function formatTermList(
	terms: Array<{ name: string; id: number; count?: number; parent?: number }>
): string {
	if (terms.length === 0) return 'None found.';
	return terms
		.map((t) => {
			const parts = [t.name];
			if (t.count !== undefined)
				parts.push(`${t.count} post${t.count !== 1 ? 's' : ''}`);
			return parts.join(' — ');
		})
		.join('\n');
}

export function registerMetadataTools(
	server: McpServer,
	session: SessionManager
): void {
	server.registerTool(
		'wp_list_categories',
		{
			description:
				'List existing categories on the WordPress site. Use this before wp_set_categories to find appropriate existing categories.',
			inputSchema: {
				search: z
					.string()
					.optional()
					.describe('Filter categories by name'),
			},
		},
		async ({ search }) => {
			try {
				const terms = await session.listCategories({ search });
				return {
					content: [
						{
							type: 'text' as const,
							text: `Categories:\n${formatTermList(terms)}`,
						},
					],
				};
			} catch (err) {
				return {
					content: [
						{
							type: 'text' as const,
							text: `Failed to list categories: ${(err as Error).message}`,
						},
					],
					isError: true,
				};
			}
		}
	);

	server.registerTool(
		'wp_list_tags',
		{
			description:
				'List existing tags on the WordPress site. Use this before wp_set_tags to find appropriate existing tags.',
			inputSchema: {
				search: z.string().optional().describe('Filter tags by name'),
			},
		},
		async ({ search }) => {
			try {
				const terms = await session.listTags({ search });
				return {
					content: [
						{
							type: 'text' as const,
							text: `Tags:\n${formatTermList(terms)}`,
						},
					],
				};
			} catch (err) {
				return {
					content: [
						{
							type: 'text' as const,
							text: `Failed to list tags: ${(err as Error).message}`,
						},
					],
					isError: true,
				};
			}
		}
	);

	server.registerTool(
		'wp_set_status',
		{
			description:
				'Change the post publication status. Use "future" with wp_set_date to schedule a post.',
			inputSchema: {
				status: z.enum(validStatuses).describe('New post status'),
			},
		},
		async ({ status }) => {
			try {
				const oldStatus = session.getCurrentPost()?.status ?? 'unknown';
				await session.setPostStatus(status);
				return {
					content: [
						{
							type: 'text' as const,
							text: `Status changed from "${oldStatus}" to "${status}".`,
						},
					],
				};
			} catch (err) {
				return {
					content: [
						{
							type: 'text' as const,
							text: `Failed to set status: ${(err as Error).message}`,
						},
					],
					isError: true,
				};
			}
		}
	);

	server.registerTool(
		'wp_set_categories',
		{
			description:
				"Set the post categories by name (replaces all existing categories). Creates categories that don't exist yet. WordPress requires at least one category.",
			inputSchema: {
				categories: z
					.array(z.string())
					.min(1)
					.describe(
						'Category names to assign (e.g., ["Tech", "News"])'
					),
			},
		},
		async ({ categories }) => {
			try {
				const { resolved } = await session.setCategories(categories);
				const parts = resolved.map((r) =>
					r.created ? `${r.name} (created)` : r.name
				);
				return {
					content: [
						{
							type: 'text' as const,
							text: `Categories set: ${parts.join(', ')}.`,
						},
					],
				};
			} catch (err) {
				return {
					content: [
						{
							type: 'text' as const,
							text: `Failed to set categories: ${(err as Error).message}`,
						},
					],
					isError: true,
				};
			}
		}
	);

	server.registerTool(
		'wp_set_tags',
		{
			description:
				"Set the post tags by name (replaces all existing tags). Creates tags that don't exist yet. Pass an empty array to remove all tags.",
			inputSchema: {
				tags: z
					.array(z.string())
					.describe(
						'Tag names to assign (e.g., ["tutorial", "beginner"])'
					),
			},
		},
		async ({ tags }) => {
			try {
				if (tags.length === 0) {
					await session.setTags([]);
					return {
						content: [
							{
								type: 'text' as const,
								text: 'All tags removed.',
							},
						],
					};
				}
				const { resolved } = await session.setTags(tags);
				const parts = resolved.map((r) =>
					r.created ? `${r.name} (created)` : r.name
				);
				return {
					content: [
						{
							type: 'text' as const,
							text: `Tags set: ${parts.join(', ')}.`,
						},
					],
				};
			} catch (err) {
				return {
					content: [
						{
							type: 'text' as const,
							text: `Failed to set tags: ${(err as Error).message}`,
						},
					],
					isError: true,
				};
			}
		}
	);

	server.registerTool(
		'wp_set_excerpt',
		{
			description:
				'Set the post excerpt (short summary shown in feeds and search results). Pass an empty string to clear.',
			inputSchema: {
				excerpt: z.string().describe('Post excerpt text'),
			},
		},
		async ({ excerpt }) => {
			try {
				await session.setExcerpt(excerpt);
				if (!excerpt) {
					return {
						content: [
							{ type: 'text' as const, text: 'Excerpt cleared.' },
						],
					};
				}
				return {
					content: [{ type: 'text' as const, text: `Excerpt set.` }],
				};
			} catch (err) {
				return {
					content: [
						{
							type: 'text' as const,
							text: `Failed to set excerpt: ${(err as Error).message}`,
						},
					],
					isError: true,
				};
			}
		}
	);

	server.registerTool(
		'wp_set_featured_image',
		{
			description:
				'Set the post featured image by media attachment ID. Use wp_upload_media first to upload an image and get its ID. Pass 0 to remove the featured image.',
			inputSchema: {
				attachmentId: z
					.number()
					.describe(
						'Media attachment ID (from wp_upload_media), or 0 to remove'
					),
			},
		},
		async ({ attachmentId }) => {
			try {
				await session.setFeaturedImage(attachmentId);
				if (attachmentId === 0) {
					return {
						content: [
							{
								type: 'text' as const,
								text: 'Featured image removed.',
							},
						],
					};
				}
				return {
					content: [
						{
							type: 'text' as const,
							text: `Featured image set to attachment ${attachmentId}.`,
						},
					],
				};
			} catch (err) {
				return {
					content: [
						{
							type: 'text' as const,
							text: `Failed to set featured image: ${(err as Error).message}`,
						},
					],
					isError: true,
				};
			}
		}
	);

	server.registerTool(
		'wp_set_date',
		{
			description:
				'Set the post publication date. Use with wp_set_status("future") to schedule a post. Pass an empty string to reset to the current date.',
			inputSchema: {
				date: z
					.string()
					.describe(
						'Publication date in ISO 8601 format (e.g., "2026-04-01T09:00:00"), or empty string to clear'
					),
			},
		},
		async ({ date }) => {
			try {
				const updated = await session.setDate(date);
				if (!date) {
					return {
						content: [
							{
								type: 'text' as const,
								text: 'Publication date reset to default.',
							},
						],
					};
				}
				return {
					content: [
						{
							type: 'text' as const,
							text: `Publication date set to ${updated.date}.`,
						},
					],
				};
			} catch (err) {
				return {
					content: [
						{
							type: 'text' as const,
							text: `Failed to set date: ${(err as Error).message}`,
						},
					],
					isError: true,
				};
			}
		}
	);

	server.registerTool(
		'wp_set_slug',
		{
			description:
				'Set the post URL slug. WordPress may auto-modify the slug to ensure uniqueness.',
			inputSchema: {
				slug: z.string().describe('URL slug (e.g., "my-custom-url")'),
			},
		},
		async ({ slug }) => {
			try {
				const updated = await session.setSlug(slug);
				const actualSlug = updated.slug;
				if (actualSlug !== slug) {
					return {
						content: [
							{
								type: 'text' as const,
								text: `Slug set to "${actualSlug}" (adjusted from "${slug}" for uniqueness).`,
							},
						],
					};
				}
				return {
					content: [
						{
							type: 'text' as const,
							text: `Slug set to "${actualSlug}".`,
						},
					],
				};
			} catch (err) {
				return {
					content: [
						{
							type: 'text' as const,
							text: `Failed to set slug: ${(err as Error).message}`,
						},
					],
					isError: true,
				};
			}
		}
	);

	server.registerTool(
		'wp_set_sticky',
		{
			description: 'Pin or unpin the post on the front page.',
			inputSchema: {
				sticky: z.boolean().describe('true to pin, false to unpin'),
			},
		},
		async ({ sticky }) => {
			try {
				await session.setSticky(sticky);
				return {
					content: [
						{
							type: 'text' as const,
							text: sticky
								? 'Post pinned to front page.'
								: 'Post unpinned.',
						},
					],
				};
			} catch (err) {
				return {
					content: [
						{
							type: 'text' as const,
							text: `Failed to set sticky: ${(err as Error).message}`,
						},
					],
					isError: true,
				};
			}
		}
	);

	server.registerTool(
		'wp_set_comment_status',
		{
			description: 'Enable or disable comments on the post.',
			inputSchema: {
				status: z
					.enum(['open', 'closed'])
					.describe('"open" to enable comments, "closed" to disable'),
			},
		},
		async ({ status }) => {
			try {
				await session.setCommentStatus(status);
				return {
					content: [
						{
							type: 'text' as const,
							text:
								status === 'open'
									? 'Comments enabled.'
									: 'Comments disabled.',
						},
					],
				};
			} catch (err) {
				return {
					content: [
						{
							type: 'text' as const,
							text: `Failed to set comment status: ${(err as Error).message}`,
						},
					],
					isError: true,
				};
			}
		}
	);
}
