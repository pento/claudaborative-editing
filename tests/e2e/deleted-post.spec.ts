import { test, expect } from '@playwright/test';
import {
	createMcpTestClient,
	callToolOrThrow,
	getToolText,
} from './helpers/mcp';
import {
	WP_ADMIN_USER,
	WP_BASE_URL,
	getSharedAppPassword,
	createDraftPost,
	deletePost,
	trashPost,
} from './helpers/wp-env';

const PARAGRAPH_CONTENT =
	'<!-- wp:paragraph --><p>Test paragraph</p><!-- /wp:paragraph -->';

/**
 * Call a tool and return the result without throwing on error.
 * Returns { isError, text }.
 */
async function callTool(
	client: Awaited<ReturnType<typeof createMcpTestClient>>['client'],
	name: string,
	args: Record<string, unknown> = {}
): Promise<{ isError: boolean; text: string }> {
	const result = await client.callTool({ name, arguments: args });
	const content = result.content as Array<{ type: string; text?: string }>;
	const text = content
		.filter((item) => item.type === 'text')
		.map((item) => item.text ?? '')
		.join('\n');
	return { isError: !!result.isError, text };
}

test.describe('deleted post detection', () => {
	test('detects permanently deleted post and errors on editing operations', async () => {
		test.setTimeout(120_000);

		const postId = await createDraftPost(
			'E2E deleted-post permanent',
			PARAGRAPH_CONTENT
		);
		const appPassword = getSharedAppPassword();
		const { client, close, stderr } = await createMcpTestClient();

		try {
			// Connect and open the post
			await callToolOrThrow(client, 'wp_connect', {
				siteUrl: WP_BASE_URL,
				username: WP_ADMIN_USER,
				appPassword,
			});
			await callToolOrThrow(client, 'wp_open_post', { postId });

			// Verify editing works initially
			const readResult = await callToolOrThrow(client, 'wp_read_post');
			expect(getToolText(readResult)).toContain('Test paragraph');

			// Permanently delete the post via REST API
			await deletePost(postId);

			// Poll until MCP detects the post is gone
			// The sync client will get an error on next poll, triggering checkPostStillExists
			await expect
				.poll(
					async () => {
						const result = await callTool(
							client,
							'wp_update_block',
							{
								index: '0',
								content: 'This should fail',
							}
						);
						return result;
					},
					{ timeout: 60_000, intervals: [2000] }
				)
				.toMatchObject({
					isError: true,
					text: expect.stringContaining('deleted'),
				});

			// wp_read_post should also error
			const readAfterDelete = await callTool(client, 'wp_read_post');
			expect(readAfterDelete.isError).toBe(true);
			expect(readAfterDelete.text).toContain('deleted');
			expect(readAfterDelete.text).toContain('wp_close_post');

			// wp_status should show a warning
			const statusResult = await callTool(client, 'wp_status');
			expect(statusResult.text).toContain('WARNING');
			expect(statusResult.text).toContain('deleted');

			// wp_close_post should still work
			await callToolOrThrow(client, 'wp_close_post');

			// After closing, state should be connected
			const statusAfterClose = await callTool(client, 'wp_status');
			expect(statusAfterClose.text).toContain('Post: none open');
		} catch (error) {
			const stderrOutput = stderr.join('').trim();
			throw new Error(
				`${error instanceof Error ? error.message : String(error)}${stderrOutput ? `\n\nMCP stderr:\n${stderrOutput}` : ''}`,
				{ cause: error }
			);
		} finally {
			await close();
			// Post is already permanently deleted, no cleanup needed
		}
	});

	test('detects trashed post and errors on editing operations', async () => {
		test.setTimeout(120_000);

		const postId = await createDraftPost(
			'E2E deleted-post trash',
			PARAGRAPH_CONTENT
		);
		const appPassword = getSharedAppPassword();
		const { client, close, stderr } = await createMcpTestClient();

		try {
			// Connect and open the post
			await callToolOrThrow(client, 'wp_connect', {
				siteUrl: WP_BASE_URL,
				username: WP_ADMIN_USER,
				appPassword,
			});
			await callToolOrThrow(client, 'wp_open_post', { postId });

			// Verify editing works initially
			const readResult = await callToolOrThrow(client, 'wp_read_post');
			expect(getToolText(readResult)).toContain('Test paragraph');

			// Trash the post via REST API (not permanent delete)
			await trashPost(postId);

			// Poll until MCP detects the post is gone
			await expect
				.poll(
					async () => {
						const result = await callTool(
							client,
							'wp_update_block',
							{
								index: '0',
								content: 'This should fail',
							}
						);
						return result;
					},
					{ timeout: 60_000, intervals: [2000] }
				)
				.toMatchObject({
					isError: true,
					text: expect.stringContaining('trash'),
				});

			// wp_close_post should still work
			await callToolOrThrow(client, 'wp_close_post');
		} catch (error) {
			const stderrOutput = stderr.join('').trim();
			throw new Error(
				`${error instanceof Error ? error.message : String(error)}${stderrOutput ? `\n\nMCP stderr:\n${stderrOutput}` : ''}`,
				{ cause: error }
			);
		} finally {
			await close();
			// Clean up the trashed post
			try {
				await deletePost(postId);
			} catch {
				// Post may already be gone
			}
		}
	});
});
