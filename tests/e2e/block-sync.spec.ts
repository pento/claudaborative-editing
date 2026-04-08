import { test, expect } from './test';
import type { Editor } from '@wordpress/e2e-test-utils-playwright';
import type { Page } from '@playwright/test';
import {
	createMcpTestClient,
	callToolOrThrow,
	getToolText,
} from './helpers/mcp';
import { WP_BASE_URL, createDraftPost, deletePost } from './helpers/wp-env';

const HEADING_CONTENT =
	'<!-- wp:heading {"level":2} --><h2 class="wp-block-heading">Original heading</h2><!-- /wp:heading -->';
const TWO_PARAGRAPHS =
	'<!-- wp:paragraph --><p>First paragraph</p><!-- /wp:paragraph --><!-- wp:paragraph --><p>Second paragraph</p><!-- /wp:paragraph -->';

interface BrowserBlock {
	name: string;
	attributes: Record<string, unknown>;
}

interface EditorBlock {
	name: string;
	attributes: Record<string, unknown>;
	innerBlocks?: EditorBlock[];
}

async function openEditor(
	page: Page,
	editor: Editor,
	postId: number
): Promise<void> {
	await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`);
	await editor.setPreferences('core/edit-post', {
		welcomeGuide: false,
		fullscreenMode: false,
	});
	await expect
		.poll(async () => {
			return page.evaluate(() => {
				const wpGlobal = globalThis as typeof globalThis & {
					wp?: {
						data?: {
							select: (store: string) => {
								getBlocks: () => Array<unknown>;
							};
						};
					};
				};
				const blockEditor =
					wpGlobal.wp?.data?.select('core/block-editor');
				return blockEditor ? blockEditor.getBlocks().length : 0;
			});
		})
		.toBeGreaterThan(0);
}

async function getBrowserBlocks(page: Page): Promise<BrowserBlock[]> {
	return page.evaluate(() => {
		const wpGlobal = globalThis as typeof globalThis & {
			wp?: {
				data?: {
					select: (store: string) => {
						getBlocks: () => EditorBlock[];
					};
				};
			};
		};
		const blockEditor = wpGlobal.wp?.data?.select('core/block-editor');
		if (!blockEditor) return [];
		return blockEditor.getBlocks().map((b) => ({
			name: b.name,
			attributes: { ...b.attributes },
		}));
	});
}

async function waitForQueueToDrain(
	client: Awaited<ReturnType<typeof createMcpTestClient>>['client']
): Promise<void> {
	await expect
		.poll(
			async () => {
				const status = await callToolOrThrow(client, 'wp_status');
				return getToolText(status);
			},
			{ timeout: 30_000, intervals: [1000] }
		)
		.toContain('Queue: 0 pending updates');
}

test.describe('block sync', () => {
	test('MCP inserts blocks visible in browser', async ({
		page,
		editor,
		testUser,
	}) => {
		test.setTimeout(120_000);

		const auth = {
			username: testUser.username,
			appPassword: testUser.appPassword,
		};
		const postId = await createDraftPost(
			'E2E block-sync insert',
			HEADING_CONTENT,
			auth
		);
		const { client, close, stderr } = await createMcpTestClient();

		try {
			// Connect MCP
			await callToolOrThrow(client, 'wp_connect', {
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
			await expect
				.poll(
					async () => {
						const status = await callToolOrThrow(
							client,
							'wp_status'
						);
						return getToolText(status);
					},
					{ timeout: 30_000, intervals: [1000] }
				)
				.toContain('(2 collaborators)');

			// Insert a heading and a paragraph via MCP
			await callToolOrThrow(client, 'wp_insert_block', {
				position: 1,
				name: 'core/heading',
				content: 'Inserted heading',
				attributes: { level: 3 },
			});

			await callToolOrThrow(client, 'wp_insert_block', {
				position: 2,
				name: 'core/paragraph',
				content: 'Inserted paragraph',
			});

			await waitForQueueToDrain(client);

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
		} catch (error) {
			const stderrOutput = stderr.join('').trim();
			throw new Error(
				`${error instanceof Error ? error.message : String(error)}${stderrOutput ? `\n\nMCP stderr:\n${stderrOutput}` : ''}`,
				{ cause: error }
			);
		} finally {
			await close();
			await deletePost(postId, auth);
		}
	});

	test('MCP edits block content visible in browser', async ({
		page,
		editor,
		testUser,
	}) => {
		test.setTimeout(120_000);

		const auth = {
			username: testUser.username,
			appPassword: testUser.appPassword,
		};
		const postId = await createDraftPost(
			'E2E block-sync edit',
			HEADING_CONTENT,
			auth
		);
		const { client, close, stderr } = await createMcpTestClient();

		try {
			// Connect MCP
			await callToolOrThrow(client, 'wp_connect', {
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
			await expect
				.poll(
					async () => {
						const status = await callToolOrThrow(
							client,
							'wp_status'
						);
						return getToolText(status);
					},
					{ timeout: 30_000, intervals: [1000] }
				)
				.toContain('(2 collaborators)');

			// Update heading content via MCP
			await callToolOrThrow(client, 'wp_update_block', {
				index: '0',
				content: 'Updated heading from MCP',
			});

			await waitForQueueToDrain(client);

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
		} catch (error) {
			const stderrOutput = stderr.join('').trim();
			throw new Error(
				`${error instanceof Error ? error.message : String(error)}${stderrOutput ? `\n\nMCP stderr:\n${stderrOutput}` : ''}`,
				{ cause: error }
			);
		} finally {
			await close();
			await deletePost(postId, auth);
		}
	});

	test('MCP changes block attributes visible in browser', async ({
		page,
		editor,
		testUser,
	}) => {
		test.setTimeout(120_000);

		const auth = {
			username: testUser.username,
			appPassword: testUser.appPassword,
		};
		const postId = await createDraftPost(
			'E2E block-sync attrs',
			HEADING_CONTENT,
			auth
		);
		const { client, close, stderr } = await createMcpTestClient();

		try {
			// Connect MCP
			await callToolOrThrow(client, 'wp_connect', {
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
			await expect
				.poll(
					async () => {
						const status = await callToolOrThrow(
							client,
							'wp_status'
						);
						return getToolText(status);
					},
					{ timeout: 30_000, intervals: [1000] }
				)
				.toContain('(2 collaborators)');

			// Change heading level from 2 to 4
			await callToolOrThrow(client, 'wp_update_block', {
				index: '0',
				attributes: { level: 4 },
			});

			await waitForQueueToDrain(client);

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
		} catch (error) {
			const stderrOutput = stderr.join('').trim();
			throw new Error(
				`${error instanceof Error ? error.message : String(error)}${stderrOutput ? `\n\nMCP stderr:\n${stderrOutput}` : ''}`,
				{ cause: error }
			);
		} finally {
			await close();
			await deletePost(postId, auth);
		}
	});

	test('MCP removes blocks visible in browser', async ({
		page,
		editor,
		testUser,
	}) => {
		test.setTimeout(120_000);

		const auth = {
			username: testUser.username,
			appPassword: testUser.appPassword,
		};
		const postId = await createDraftPost(
			'E2E block-sync remove',
			TWO_PARAGRAPHS,
			auth
		);
		const { client, close, stderr } = await createMcpTestClient();

		try {
			// Connect MCP
			await callToolOrThrow(client, 'wp_connect', {
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
			await expect
				.poll(
					async () => {
						const status = await callToolOrThrow(
							client,
							'wp_status'
						);
						return getToolText(status);
					},
					{ timeout: 30_000, intervals: [1000] }
				)
				.toContain('(2 collaborators)');

			// Remove the first paragraph
			await callToolOrThrow(client, 'wp_remove_blocks', {
				startIndex: 0,
				count: 1,
			});

			await waitForQueueToDrain(client);

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
		} catch (error) {
			const stderrOutput = stderr.join('').trim();
			throw new Error(
				`${error instanceof Error ? error.message : String(error)}${stderrOutput ? `\n\nMCP stderr:\n${stderrOutput}` : ''}`,
				{ cause: error }
			);
		} finally {
			await close();
			await deletePost(postId, auth);
		}
	});

	test('browser edits visible in MCP', async ({ page, editor, testUser }) => {
		test.setTimeout(120_000);

		const auth = {
			username: testUser.username,
			appPassword: testUser.appPassword,
		};
		const initialContent =
			'<!-- wp:paragraph --><p>Browser editable paragraph</p><!-- /wp:paragraph -->';
		const postId = await createDraftPost(
			'E2E block-sync browser-to-mcp',
			initialContent,
			auth
		);
		const { client, close, stderr } = await createMcpTestClient();

		try {
			// Connect MCP
			await callToolOrThrow(client, 'wp_connect', {
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
			await expect
				.poll(
					async () => {
						const status = await callToolOrThrow(
							client,
							'wp_status'
						);
						return getToolText(status);
					},
					{ timeout: 30_000, intervals: [1000] }
				)
				.toContain('(2 collaborators)');

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
				const blockEditor =
					wpGlobal.wp?.data?.select('core/block-editor');
				if (!blockEditor) throw new Error('block editor not available');
				const blocks = blockEditor.getBlocks();
				const blockId = blocks[0].clientId;
				const dispatcher =
					wpGlobal.wp?.data?.dispatch('core/block-editor');
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
							client,
							'wp_read_post'
						);
						return getToolText(post);
					},
					{ timeout: 30_000, intervals: [1000] }
				)
				.toContain(newContent);
		} catch (error) {
			const stderrOutput = stderr.join('').trim();
			throw new Error(
				`${error instanceof Error ? error.message : String(error)}${stderrOutput ? `\n\nMCP stderr:\n${stderrOutput}` : ''}`,
				{ cause: error }
			);
		} finally {
			await close();
			await deletePost(postId, auth);
		}
	});

	test('multiple sequential edits in a single session', async ({
		page,
		editor,
		testUser,
	}) => {
		test.setTimeout(180_000);

		const auth = {
			username: testUser.username,
			appPassword: testUser.appPassword,
		};
		const postId = await createDraftPost(
			'E2E block-sync workflow',
			HEADING_CONTENT,
			auth
		);
		const { client, close, stderr } = await createMcpTestClient();

		try {
			// Connect MCP
			await callToolOrThrow(client, 'wp_connect', {
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

			await expect
				.poll(
					async () => {
						const status = await callToolOrThrow(
							client,
							'wp_status'
						);
						return getToolText(status);
					},
					{ timeout: 30_000, intervals: [1000] }
				)
				.toContain('(2 collaborators)');

			// Step 1: Update heading content and level in one call
			await callToolOrThrow(client, 'wp_update_block', {
				index: '0',
				content: 'Refined heading',
				attributes: { level: 3 },
			});

			await waitForQueueToDrain(client);

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
			await callToolOrThrow(client, 'wp_insert_block', {
				position: 1,
				name: 'core/paragraph',
				content: 'A collaborative paragraph inserted mid-session.',
			});

			await waitForQueueToDrain(client);

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
			await callToolOrThrow(client, 'wp_insert_block', {
				position: 2,
				name: 'core/list',
				innerBlocks: [
					{ name: 'core/list-item', content: 'First item' },
					{ name: 'core/list-item', content: 'Second item' },
					{ name: 'core/list-item', content: 'Third item' },
				],
			});

			await waitForQueueToDrain(client);

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
		} catch (error) {
			const stderrOutput = stderr.join('').trim();
			throw new Error(
				`${error instanceof Error ? error.message : String(error)}${stderrOutput ? `\n\nMCP stderr:\n${stderrOutput}` : ''}`,
				{ cause: error }
			);
		} finally {
			await close();
			await deletePost(postId, auth);
		}
	});
});
