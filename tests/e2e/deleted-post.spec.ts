import { test, expect } from './test';
import { callToolOrThrow, callTool, getToolText } from './helpers/mcp';
import {
	WP_BASE_URL,
	createTestUser,
	deleteTestUser,
	deletePost,
	trashPost,
} from './helpers/wp-env';

const PARAGRAPH_CONTENT =
	'<!-- wp:paragraph --><p>Test paragraph</p><!-- /wp:paragraph -->';

test.describe('deleted post detection', () => {
	test('detects permanently deleted post and errors on editing operations', async ({
		mcpClient,
		draftPost,
	}) => {
		const user = await createTestUser();
		try {
			const auth = {
				username: user.username,
				appPassword: user.appPassword,
			};
			const postId = await draftPost(
				'E2E deleted-post permanent',
				PARAGRAPH_CONTENT,
				auth
			);

			// Connect and open the post
			await callToolOrThrow(mcpClient.client, 'wp_connect', {
				siteUrl: WP_BASE_URL,
				username: user.username,
				appPassword: user.appPassword,
			});
			await callToolOrThrow(mcpClient.client, 'wp_open_post', { postId });

			// Verify editing works initially
			const readResult = await callToolOrThrow(
				mcpClient.client,
				'wp_read_post'
			);
			expect(getToolText(readResult)).toContain('Test paragraph');

			// Permanently delete the post via REST API
			// (draftPost fixture will silently handle the 404 on teardown)
			await deletePost(postId, auth);

			// Poll until MCP detects the post is gone
			// The sync client will get an error on next poll, triggering checkPostStillExists
			await expect
				.poll(
					async () => {
						const result = await callTool(
							mcpClient.client,
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
			const readAfterDelete = await callTool(
				mcpClient.client,
				'wp_read_post'
			);
			expect(readAfterDelete.isError).toBe(true);
			expect(readAfterDelete.text).toContain('deleted');
			expect(readAfterDelete.text).toContain('wp_close_post');

			// wp_status should show a warning
			const statusResult = await callTool(mcpClient.client, 'wp_status');
			expect(statusResult.text).toContain('WARNING');
			expect(statusResult.text).toContain('deleted');

			// wp_close_post should still work
			await callToolOrThrow(mcpClient.client, 'wp_close_post');

			// After closing, state should be connected
			const statusAfterClose = await callTool(
				mcpClient.client,
				'wp_status'
			);
			expect(statusAfterClose.text).toContain('Post: none open');
		} finally {
			await deleteTestUser(user.userId);
		}
	});

	test('detects trashed post and errors on editing operations', async ({
		mcpClient,
		draftPost,
	}) => {
		const user = await createTestUser();
		try {
			const auth = {
				username: user.username,
				appPassword: user.appPassword,
			};
			const postId = await draftPost(
				'E2E deleted-post trash',
				PARAGRAPH_CONTENT,
				auth
			);

			// Connect and open the post
			await callToolOrThrow(mcpClient.client, 'wp_connect', {
				siteUrl: WP_BASE_URL,
				username: user.username,
				appPassword: user.appPassword,
			});
			await callToolOrThrow(mcpClient.client, 'wp_open_post', { postId });

			// Verify editing works initially
			const readResult = await callToolOrThrow(
				mcpClient.client,
				'wp_read_post'
			);
			expect(getToolText(readResult)).toContain('Test paragraph');

			// Trash the post via REST API (not permanent delete)
			// (draftPost fixture will delete the trashed post on teardown)
			await trashPost(postId, auth);

			// Poll until MCP detects the post is gone
			await expect
				.poll(
					async () => {
						const result = await callTool(
							mcpClient.client,
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
			await callToolOrThrow(mcpClient.client, 'wp_close_post');
		} finally {
			await deleteTestUser(user.userId);
		}
	});
});
