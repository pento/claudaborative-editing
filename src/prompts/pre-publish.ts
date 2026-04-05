import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/session-manager.js';

export function registerPrePublishPrompts(
	server: McpServer,
	session: SessionManager
): void {
	server.registerPrompt(
		'pre-publish-check',
		{
			description:
				'Suggest metadata improvements before publishing — excerpt, categories, tags, and slug.',
		},
		() => {
			const state = session.getState();

			if (state === 'disconnected') {
				return {
					description: 'Pre-publish check',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: 'I want to run a pre-publish check on a WordPress post. Please connect to WordPress first using wp_connect, then open a post with wp_open_post.',
							},
						},
					],
				};
			}

			if (state === 'connected') {
				return {
					description: 'Pre-publish check',
					messages: [
						{
							role: 'user' as const,
							content: {
								type: 'text' as const,
								text: 'I want to run a pre-publish check on a WordPress post. Please open a post with wp_open_post first.',
							},
						},
					],
				};
			}

			// state === 'editing'
			const postContent = session.readPost();

			return {
				description: `Pre-publish check for "${session.getTitle()}"`,
				messages: [
					{
						role: 'user' as const,
						content: {
							type: 'text' as const,
							text: `The author is about to publish this WordPress post. Review the metadata and suggest improvements for the fields listed below. Do NOT comment on the post content, title, structure, or quality — assume the author is happy with those.

Here is the current post content:

${postContent}

## What to suggest

Only include a field in your response if you have a suggestion. Omit fields that are already fine.

1. **Excerpt**: If no excerpt is set (or it's poor), write a compelling 1-2 sentence excerpt that summarizes the post for search results and social sharing. If the current excerpt is adequate, omit this field.

2. **Categories**: If the post only has "Uncategorized" or the categories don't fit the content, suggest appropriate category names. For sub-categories, use the format "Parent > Child" (e.g., "Technology > Artificial Intelligence"). These will be created if they don't already exist. If the current categories are appropriate, omit this field.

3. **Tags**: If no tags are set or they could be improved, suggest relevant tags. These will be created if they don't already exist. If the current tags are appropriate, omit this field.

4. **Slug**: If the current slug is auto-generated (e.g., "post-123"), too long, or doesn't match the content, suggest a better one. Do NOT suggest the same slug that is already set — only include this field if the slug would actually change.

## How to respond

Call wp_update_command_status with:
- commandId: the command_id from the channel notification metadata
- status: "completed"
- message: A brief summary of what was suggested (e.g., "Suggested excerpt, 2 categories, and 3 tags")
- resultData: A JSON string with ONLY the fields that need suggestions:

Example with all fields:
{
  "excerpt": "A concise summary of the post for search results and social sharing.",
  "categories": ["Technology", "Updates"],
  "tags": ["release", "new-features", "performance"],
  "slug": "my-better-slug"
}

Example when only excerpt is needed:
{
  "excerpt": "A concise summary of the post."
}

Example when everything looks good (empty object):
{}

Important:
- This is a READ-ONLY check. Do NOT call any tool except wp_update_command_status. Do NOT add notes, edit blocks, update metadata, or make any changes to the post.
- Your ONLY output must be a single wp_update_command_status call with the structured resultData JSON.
- Write suggestions in the same language as the post content.
- For the excerpt, write actual excerpt text, not a description of what the excerpt should be.
- For categories and tags, suggest specific names, not descriptions.`,
						},
					},
				],
			};
		}
	);
}
