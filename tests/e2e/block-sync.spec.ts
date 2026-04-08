import { test, expect } from './test';
import {
	callToolOrThrow,
	getToolText,
	waitForCollaborators,
	waitForQueueToDrain,
} from './helpers/mcp';
import { openEditor, getBrowserBlocks } from './helpers/editor';
import { WP_BASE_URL } from './helpers/wp-env';

const HEADING_CONTENT =
	'<!-- wp:heading {"level":2} --><h2 class="wp-block-heading">Original heading</h2><!-- /wp:heading -->';
const TWO_PARAGRAPHS =
	'<!-- wp:paragraph --><p>First paragraph</p><!-- /wp:paragraph --><!-- wp:paragraph --><p>Second paragraph</p><!-- /wp:paragraph -->';

test.describe('block sync', () => {
	test('MCP inserts blocks visible in browser', async ({
		page,
		editor,
		testUser,
		mcpClient,
		draftPost,
	}) => {
		const auth = {
			username: testUser.username,
			appPassword: testUser.appPassword,
		};
		const postId = await draftPost(
			'E2E block-sync insert',
			HEADING_CONTENT,
			auth
		);

		// Connect MCP
		await callToolOrThrow(mcpClient.client, 'wp_connect', {
			siteUrl: WP_BASE_URL,
			username: testUser.username,
			appPassword: testUser.appPassword,
		});

		await openEditor(page, editor, postId);

		// Verify initial content is loaded in the browser
		await expect
			.poll(() => getBrowserBlocks(page), {
				timeout: 30_000,
				intervals: [1000],
			})
			.toEqual(
				expect.arrayContaining([
					expect.objectContaining({ name: 'core/heading' }),
				])
			);

		// Wait for 2 collaborators
		await waitForCollaborators(mcpClient.client);

		// Insert a heading and a paragraph via MCP
		await callToolOrThrow(mcpClient.client, 'wp_insert_block', {
			position: 1,
			name: 'core/heading',
			content: 'Inserted heading',
			attributes: { level: 3 },
		});

		await callToolOrThrow(mcpClient.client, 'wp_insert_block', {
			position: 2,
			name: 'core/paragraph',
			content: 'Inserted paragraph',
		});

		await waitForQueueToDrain(mcpClient.client);

		// Verify the browser sees all three blocks
		await expect
			.poll(() => getBrowserBlocks(page), {
				timeout: 30_000,
				intervals: [1000],
			})
			.toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: 'core/heading',
						attributes: expect.objectContaining({
							content: 'Original heading',
						}),
					}),
					expect.objectContaining({
						name: 'core/heading',
						attributes: expect.objectContaining({
							content: 'Inserted heading',
							level: 3,
						}),
					}),
					expect.objectContaining({
						name: 'core/paragraph',
						attributes: expect.objectContaining({
							content: 'Inserted paragraph',
						}),
					}),
				])
			);

		// Also verify block count
		await expect
			.poll(
				async () => {
					const blocks = await getBrowserBlocks(page);
					return blocks.length;
				},
				{ timeout: 30_000, intervals: [1000] }
			)
			.toBe(3);
	});

	test('MCP edits block content visible in browser', async ({
		page,
		editor,
		testUser,
		mcpClient,
		draftPost,
	}) => {
		const auth = {
			username: testUser.username,
			appPassword: testUser.appPassword,
		};
		const postId = await draftPost(
			'E2E block-sync edit',
			HEADING_CONTENT,
			auth
		);

		// Connect MCP
		await callToolOrThrow(mcpClient.client, 'wp_connect', {
			siteUrl: WP_BASE_URL,
			username: testUser.username,
			appPassword: testUser.appPassword,
		});

		await openEditor(page, editor, postId);

		// Verify initial heading is present
		await expect
			.poll(() => getBrowserBlocks(page), {
				timeout: 30_000,
				intervals: [1000],
			})
			.toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						name: 'core/heading',
						attributes: expect.objectContaining({
							content: 'Original heading',
						}),
					}),
				])
			);

		// Wait for 2 collaborators
		await waitForCollaborators(mcpClient.client);

		// Update heading content via MCP
		await callToolOrThrow(mcpClient.client, 'wp_update_block', {
			index: '0',
			content: 'Updated heading from MCP',
		});

		await waitForQueueToDrain(mcpClient.client);

		// Verify the browser sees the updated content
		await expect
			.poll(
				async () => {
					const blocks = await getBrowserBlocks(page);
					return blocks[0]?.attributes?.content;
				},
				{ timeout: 30_000, intervals: [1000] }
			)
			.toBe('Updated heading from MCP');
	});

	test('MCP changes block attributes visible in browser', async ({
		page,
		editor,
		testUser,
		mcpClient,
		draftPost,
	}) => {
		const auth = {
			username: testUser.username,
			appPassword: testUser.appPassword,
		};
		const postId = await draftPost(
			'E2E block-sync attrs',
			HEADING_CONTENT,
			auth
		);

		// Connect MCP
		await callToolOrThrow(mcpClient.client, 'wp_connect', {
			siteUrl: WP_BASE_URL,
			username: testUser.username,
			appPassword: testUser.appPassword,
		});

		await openEditor(page, editor, postId);

		// Verify initial heading is level 2
		await expect
			.poll(
				async () => {
					const blocks = await getBrowserBlocks(page);
					return blocks[0]?.attributes?.level;
				},
				{ timeout: 30_000, intervals: [1000] }
			)
			.toBe(2);

		// Wait for 2 collaborators
		await waitForCollaborators(mcpClient.client);

		// Change heading level from 2 to 4
		await callToolOrThrow(mcpClient.client, 'wp_update_block', {
			index: '0',
			attributes: { level: 4 },
		});

		await waitForQueueToDrain(mcpClient.client);

		// Verify the browser sees level 4
		await expect
			.poll(
				async () => {
					const blocks = await getBrowserBlocks(page);
					return blocks[0]?.attributes?.level;
				},
				{ timeout: 30_000, intervals: [1000] }
			)
			.toBe(4);
	});

	test('MCP removes blocks visible in browser', async ({
		page,
		editor,
		testUser,
		mcpClient,
		draftPost,
	}) => {
		const auth = {
			username: testUser.username,
			appPassword: testUser.appPassword,
		};
		const postId = await draftPost(
			'E2E block-sync remove',
			TWO_PARAGRAPHS,
			auth
		);

		// Connect MCP
		await callToolOrThrow(mcpClient.client, 'wp_connect', {
			siteUrl: WP_BASE_URL,
			username: testUser.username,
			appPassword: testUser.appPassword,
		});

		await openEditor(page, editor, postId);

		// Verify initial two paragraphs are present
		await expect
			.poll(
				async () => {
					const blocks = await getBrowserBlocks(page);
					return blocks.length;
				},
				{ timeout: 30_000, intervals: [1000] }
			)
			.toBe(2);

		await expect
			.poll(() => getBrowserBlocks(page), {
				timeout: 30_000,
				intervals: [1000],
			})
			.toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						attributes: expect.objectContaining({
							content: 'First paragraph',
						}),
					}),
					expect.objectContaining({
						attributes: expect.objectContaining({
							content: 'Second paragraph',
						}),
					}),
				])
			);

		// Wait for 2 collaborators
		await waitForCollaborators(mcpClient.client);

		// Remove the first paragraph
		await callToolOrThrow(mcpClient.client, 'wp_remove_blocks', {
			startIndex: 0,
			count: 1,
		});

		await waitForQueueToDrain(mcpClient.client);

		// Verify the browser sees only the second paragraph
		await expect
			.poll(
				async () => {
					const blocks = await getBrowserBlocks(page);
					return blocks.length;
				},
				{ timeout: 30_000, intervals: [1000] }
			)
			.toBe(1);

		await expect
			.poll(
				async () => {
					const blocks = await getBrowserBlocks(page);
					return blocks[0]?.attributes?.content;
				},
				{ timeout: 30_000, intervals: [1000] }
			)
			.toBe('Second paragraph');
	});

	test('browser edits visible in MCP', async ({
		page,
		editor,
		testUser,
		mcpClient,
		draftPost,
	}) => {
		const auth = {
			username: testUser.username,
			appPassword: testUser.appPassword,
		};
		const initialContent =
			'<!-- wp:paragraph --><p>Browser editable paragraph</p><!-- /wp:paragraph -->';
		const postId = await draftPost(
			'E2E block-sync browser-to-mcp',
			initialContent,
			auth
		);

		// Connect MCP
		await callToolOrThrow(mcpClient.client, 'wp_connect', {
			siteUrl: WP_BASE_URL,
			username: testUser.username,
			appPassword: testUser.appPassword,
		});

		await openEditor(page, editor, postId);

		// Verify initial content in browser
		await expect
			.poll(
				async () => {
					const blocks = await getBrowserBlocks(page);
					return blocks[0]?.attributes?.content;
				},
				{ timeout: 30_000, intervals: [1000] }
			)
			.toBe('Browser editable paragraph');

		// Wait for 2 collaborators
		await waitForCollaborators(mcpClient.client);

		// Edit the paragraph content from the browser side
		const newContent = 'Content modified by the browser';
		await page.evaluate((content) => {
			const wpGlobal = globalThis as typeof globalThis & {
				wp?: {
					data?: {
						select: (store: string) => {
							getBlocks: () => Array<{ clientId: string }>;
						};
						dispatch: (store: string) => {
							updateBlockAttributes: (
								clientId: string,
								attributes: Record<string, unknown>
							) => void;
						};
					};
				};
			};
			const blockEditor = wpGlobal.wp?.data?.select('core/block-editor');
			if (!blockEditor) throw new Error('block editor not available');
			const blocks = blockEditor.getBlocks();
			const blockId = blocks[0].clientId;
			const dispatcher = wpGlobal.wp?.data?.dispatch('core/block-editor');
			if (!dispatcher)
				throw new Error('block editor dispatch not available');
			dispatcher.updateBlockAttributes(blockId, {
				content,
			});
		}, newContent);

		// Poll MCP's wp_read_post until it contains the new content
		await expect
			.poll(
				async () => {
					const post = await callToolOrThrow(
						mcpClient.client,
						'wp_read_post'
					);
					return getToolText(post);
				},
				{ timeout: 30_000, intervals: [1000] }
			)
			.toContain(newContent);
	});

	test('multiple sequential edits in a single session', async ({
		page,
		editor,
		testUser,
		mcpClient,
		draftPost,
	}) => {
		test.setTimeout(180_000);

		const auth = {
			username: testUser.username,
			appPassword: testUser.appPassword,
		};
		const postId = await draftPost(
			'E2E block-sync workflow',
			HEADING_CONTENT,
			auth
		);

		// Connect MCP
		await callToolOrThrow(mcpClient.client, 'wp_connect', {
			siteUrl: WP_BASE_URL,
			username: testUser.username,
			appPassword: testUser.appPassword,
		});

		await openEditor(page, editor, postId);

		await expect
			.poll(() => getBrowserBlocks(page), {
				timeout: 30_000,
				intervals: [1000],
			})
			.toEqual(
				expect.arrayContaining([
					expect.objectContaining({ name: 'core/heading' }),
				])
			);

		await waitForCollaborators(mcpClient.client);

		// Step 1: Update heading content and level in one call
		await callToolOrThrow(mcpClient.client, 'wp_update_block', {
			index: '0',
			content: 'Refined heading',
			attributes: { level: 3 },
		});

		await waitForQueueToDrain(mcpClient.client);

		await expect
			.poll(
				async () => {
					const blocks = await getBrowserBlocks(page);
					return {
						content: blocks[0]?.attributes?.content,
						level: blocks[0]?.attributes?.level,
					};
				},
				{ timeout: 30_000, intervals: [1000] }
			)
			.toEqual({ content: 'Refined heading', level: 3 });

		// Step 2: Insert a paragraph after the heading
		await callToolOrThrow(mcpClient.client, 'wp_insert_block', {
			position: 1,
			name: 'core/paragraph',
			content: 'A collaborative paragraph inserted mid-session.',
		});

		await waitForQueueToDrain(mcpClient.client);

		await expect
			.poll(
				async () => {
					const blocks = await getBrowserBlocks(page);
					return blocks.length;
				},
				{ timeout: 30_000, intervals: [1000] }
			)
			.toBe(2);

		// Step 3: Insert a list with inner blocks
		await callToolOrThrow(mcpClient.client, 'wp_insert_block', {
			position: 2,
			name: 'core/list',
			innerBlocks: [
				{ name: 'core/list-item', content: 'First item' },
				{ name: 'core/list-item', content: 'Second item' },
				{ name: 'core/list-item', content: 'Third item' },
			],
		});

		await waitForQueueToDrain(mcpClient.client);

		// Verify final state: heading + paragraph + list with 3 items
		await expect
			.poll(
				async () => {
					const blocks = await getBrowserBlocks(page);
					return blocks.length;
				},
				{ timeout: 30_000, intervals: [1000] }
			)
			.toBe(3);

		await expect
			.poll(
				async () => {
					const blocks = await getBrowserBlocks(page);
					return blocks[2]?.name;
				},
				{ timeout: 30_000, intervals: [1000] }
			)
			.toBe('core/list');
	});
});
