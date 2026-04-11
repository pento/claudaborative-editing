import { z } from 'zod';
import type { ToolDefinition } from './definitions.js';

interface SetStatusInput {
	status: string;
}
interface SetCategoriesInput {
	categories: string[];
}
interface SetTagsInput {
	tags: string[];
}
interface SetExcerptInput {
	excerpt: string;
}
interface SetFeaturedImageInput {
	attachmentId: number;
}
interface SetDateInput {
	date: string;
}
interface SetSlugInput {
	slug: string;
}
interface SetStickyInput {
	sticky: boolean;
}
interface SetCommentStatusInput {
	status: string;
}

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

export const metadataTools: ToolDefinition[] = [
	{
		name: 'wp_list_categories',
		description:
			'List existing categories on the WordPress site. Use this before wp_set_categories to find appropriate existing categories.',
		inputSchema: {
			search: z.string().optional().describe('Filter categories by name'),
		},
		execute: async (session, { search }: { search?: string }) => {
			const terms = await session.listCategories({ search });
			return `Categories:\n${formatTermList(terms)}`;
		},
		tags: ['metadata'],
		availableIn: ['connected', 'editing'],
	},
	{
		name: 'wp_list_tags',
		description:
			'List existing tags on the WordPress site. Use this before wp_set_tags to find appropriate existing tags.',
		inputSchema: {
			search: z.string().optional().describe('Filter tags by name'),
		},
		execute: async (session, { search }: { search?: string }) => {
			const terms = await session.listTags({ search });
			return `Tags:\n${formatTermList(terms)}`;
		},
		tags: ['metadata'],
		availableIn: ['connected', 'editing'],
	},
	{
		name: 'wp_set_status',
		description:
			'Change the post publication status. Use "future" with wp_set_date to schedule a post.',
		inputSchema: {
			status: z.enum(validStatuses).describe('New post status'),
		},
		execute: async (session, { status }: SetStatusInput) => {
			const oldStatus = session.getCurrentPost()?.status ?? 'unknown';
			await session.setPostStatus(status);
			return `Status changed from "${oldStatus}" to "${status}".`;
		},
		tags: ['metadata'],
		availableIn: ['editing'],
	},
	{
		name: 'wp_set_categories',
		description:
			"Set the post categories by name (replaces all existing categories). Creates categories that don't exist yet. WordPress requires at least one category.",
		inputSchema: {
			categories: z
				.array(z.string())
				.min(1)
				.describe('Category names to assign (e.g., ["Tech", "News"])'),
		},
		execute: async (session, { categories }: SetCategoriesInput) => {
			const { resolved } = await session.setCategories(categories);
			const parts = resolved.map((r) =>
				r.created ? `${r.name} (created)` : r.name
			);
			return `Categories set: ${parts.join(', ')}.`;
		},
		tags: ['metadata'],
		availableIn: ['editing'],
	},
	{
		name: 'wp_set_tags',
		description:
			"Set the post tags by name (replaces all existing tags). Creates tags that don't exist yet. Pass an empty array to remove all tags.",
		inputSchema: {
			tags: z
				.array(z.string())
				.describe(
					'Tag names to assign (e.g., ["tutorial", "beginner"])'
				),
		},
		execute: async (session, { tags }: SetTagsInput) => {
			if (tags.length === 0) {
				await session.setTags([]);
				return 'All tags removed.';
			}
			const { resolved } = await session.setTags(tags);
			const parts = resolved.map((r) =>
				r.created ? `${r.name} (created)` : r.name
			);
			return `Tags set: ${parts.join(', ')}.`;
		},
		tags: ['metadata'],
		availableIn: ['editing'],
	},
	{
		name: 'wp_set_excerpt',
		description:
			'Set the post excerpt (short summary shown in feeds and search results). Pass an empty string to clear.',
		inputSchema: {
			excerpt: z.string().describe('Post excerpt text'),
		},
		execute: async (session, { excerpt }: SetExcerptInput) => {
			await session.setExcerpt(excerpt);
			if (!excerpt) {
				return 'Excerpt cleared.';
			}
			return 'Excerpt set.';
		},
		tags: ['metadata'],
		availableIn: ['editing'],
	},
	{
		name: 'wp_set_featured_image',
		description:
			'Set the post featured image by media attachment ID. Use wp_upload_media first to upload an image and get its ID. Pass 0 to remove the featured image.',
		inputSchema: {
			attachmentId: z
				.number()
				.describe(
					'Media attachment ID (from wp_upload_media), or 0 to remove'
				),
		},
		execute: async (session, { attachmentId }: SetFeaturedImageInput) => {
			await session.setFeaturedImage(attachmentId);
			if (attachmentId === 0) {
				return 'Featured image removed.';
			}
			return `Featured image set to attachment ${attachmentId}.`;
		},
		tags: ['metadata'],
		availableIn: ['editing'],
	},
	{
		name: 'wp_set_date',
		description:
			'Set the post publication date. Use with wp_set_status("future") to schedule a post. Pass an empty string to reset to the current date.',
		inputSchema: {
			date: z
				.string()
				.describe(
					'Publication date in ISO 8601 format (e.g., "2026-04-01T09:00:00"), or empty string to clear'
				),
		},
		execute: async (session, { date }: SetDateInput) => {
			const updated = await session.setDate(date);
			if (!date) {
				return 'Publication date reset to default.';
			}
			return `Publication date set to ${updated.date}.`;
		},
		tags: ['metadata'],
		availableIn: ['editing'],
	},
	{
		name: 'wp_set_slug',
		description:
			'Set the post URL slug. WordPress may auto-modify the slug to ensure uniqueness.',
		inputSchema: {
			slug: z.string().describe('URL slug (e.g., "my-custom-url")'),
		},
		execute: async (session, { slug }: SetSlugInput) => {
			const updated = await session.setSlug(slug);
			const actualSlug = updated.slug;
			if (actualSlug !== slug) {
				return `Slug set to "${actualSlug}" (adjusted from "${slug}" for uniqueness).`;
			}
			return `Slug set to "${actualSlug}".`;
		},
		tags: ['metadata'],
		availableIn: ['editing'],
	},
	{
		name: 'wp_set_sticky',
		description: 'Pin or unpin the post on the front page.',
		inputSchema: {
			sticky: z.boolean().describe('true to pin, false to unpin'),
		},
		execute: async (session, { sticky }: SetStickyInput) => {
			await session.setSticky(sticky);
			return sticky ? 'Post pinned to front page.' : 'Post unpinned.';
		},
		tags: ['metadata'],
		availableIn: ['editing'],
	},
	{
		name: 'wp_set_comment_status',
		description: 'Enable or disable comments on the post.',
		inputSchema: {
			status: z
				.enum(['open', 'closed'])
				.describe('"open" to enable comments, "closed" to disable'),
		},
		execute: async (session, { status }: SetCommentStatusInput) => {
			await session.setCommentStatus(status);
			return status === 'open'
				? 'Comments enabled.'
				: 'Comments disabled.';
		},
		tags: ['metadata'],
		availableIn: ['editing'],
	},
];
