import { test, expect, type Page } from '@playwright/test';
import { createMcpTestClient, callToolOrThrow } from './helpers/mcp';
import {
	WP_ADMIN_USER,
	WP_BASE_URL,
	getSharedAppPassword,
	createDraftPost,
	deletePost,
	listCommands,
} from './helpers/wp-env';

const PARAGRAPH_CONTENT =
	'<!-- wp:paragraph --><p>Test paragraph for AI Actions</p><!-- /wp:paragraph -->';

async function openEditor(page: Page, postId: number): Promise<void> {
	await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`);
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

/**
 * Returns a locator for the AI Actions sidebar panel.
 *
 * Gutenberg renders all plugin sidebars inside a shared
 * `region "Editor settings"`. We scope to the panel that
 * contains the "AI Actions" heading.
 */
function getSidebar(page: Page) {
	return page
		.getByRole('region', { name: 'Editor settings' })
		.filter({ has: page.getByRole('heading', { name: 'AI Actions' }) });
}

async function openSidebar(page: Page): Promise<void> {
	const sidebarButton = page.getByRole('button', { name: 'AI Actions' });
	await sidebarButton.click();
	await expect(getSidebar(page)).toBeVisible();
}

async function connectMcp(
	client: Awaited<ReturnType<typeof createMcpTestClient>>['client'],
	appPassword: string
): Promise<void> {
	await callToolOrThrow(client, 'wp_connect', {
		siteUrl: WP_BASE_URL,
		username: WP_ADMIN_USER,
		appPassword,
	});
}

async function waitForConnectedStatus(page: Page): Promise<void> {
	await expect
		.poll(
			async () => {
				return getSidebar(page).textContent();
			},
			{ timeout: 30_000, intervals: [1000] }
		)
		.toContain('Claude connected');
}

test.describe('AI Actions sidebar', () => {
	test('sidebar opens and closes', async ({ page }) => {
		test.setTimeout(120_000);

		const postId = await createDraftPost(
			'E2E sidebar open-close',
			PARAGRAPH_CONTENT
		);

		try {
			await openEditor(page, postId);

			const sidebarButton = page.getByRole('button', {
				name: 'AI Actions',
			});
			await expect(sidebarButton).toBeVisible();

			// Open the sidebar
			await sidebarButton.click();
			const sidebar = getSidebar(page);
			await expect(sidebar).toBeVisible();

			// Verify Quick Actions heading appears
			await expect(
				sidebar.getByRole('button', { name: 'Quick Actions' })
			).toBeVisible();

			// Close the sidebar
			await sidebarButton.click();
			await expect(sidebar).not.toBeVisible();
		} finally {
			await deletePost(postId);
		}
	});

	test('connection status shows disconnected without MCP', async ({
		page,
	}) => {
		test.setTimeout(120_000);

		const postId = await createDraftPost(
			'E2E sidebar disconnected',
			PARAGRAPH_CONTENT
		);

		try {
			await openEditor(page, postId);
			await openSidebar(page);

			const sidebar = getSidebar(page);

			// Verify disconnected status text
			await expect(
				sidebar.getByText('Claude not connected')
			).toBeVisible();

			// Verify action buttons are disabled
			await expect(
				sidebar.getByRole('button', { name: 'Proofread' })
			).toBeDisabled();
			await expect(
				sidebar.getByRole('button', { name: 'Review' })
			).toBeDisabled();
		} finally {
			await deletePost(postId);
		}
	});

	test('connection status shows connected with MCP', async ({ page }) => {
		test.setTimeout(120_000);

		const postId = await createDraftPost(
			'E2E sidebar connected',
			PARAGRAPH_CONTENT
		);
		const appPassword = getSharedAppPassword();
		const { client, close, stderr } = await createMcpTestClient();

		try {
			await openEditor(page, postId);
			await openSidebar(page);

			const sidebar = getSidebar(page);

			// Initially disconnected
			await expect(
				sidebar.getByText('Claude not connected')
			).toBeVisible();

			// Connect MCP client
			await connectMcp(client, appPassword);

			// Wait for connected status to appear (status polling is 5s)
			await waitForConnectedStatus(page);

			// Verify buttons become enabled
			await expect
				.poll(
					async () => {
						const proofread = sidebar.getByRole('button', {
							name: 'Proofread',
						});
						return proofread.isDisabled();
					},
					{ timeout: 30_000, intervals: [1000] }
				)
				.toBe(false);

			await expect(
				sidebar.getByRole('button', { name: 'Review' })
			).toBeEnabled();
		} catch (error) {
			const stderrOutput = stderr.join('').trim();
			throw new Error(
				`${error instanceof Error ? error.message : String(error)}${stderrOutput ? `\n\nMCP stderr:\n${stderrOutput}` : ''}`,
				{ cause: error }
			);
		} finally {
			await close();
			await deletePost(postId);
		}
	});

	test('Proofread button submits command', async ({ page }) => {
		test.setTimeout(120_000);

		const postId = await createDraftPost(
			'E2E sidebar proofread',
			PARAGRAPH_CONTENT
		);
		const appPassword = getSharedAppPassword();
		const { client, close, stderr } = await createMcpTestClient();

		try {
			await openEditor(page, postId);
			await openSidebar(page);

			// Connect MCP client
			await connectMcp(client, appPassword);

			// Wait for connected status
			await waitForConnectedStatus(page);

			const sidebar = getSidebar(page);

			// Wait for Proofread to be enabled
			await expect
				.poll(
					async () => {
						return sidebar
							.getByRole('button', { name: 'Proofread' })
							.isDisabled();
					},
					{ timeout: 30_000, intervals: [1000] }
				)
				.toBe(false);

			// Click Proofread
			await sidebar.getByRole('button', { name: 'Proofread' }).click();

			// Verify a command was created
			await expect
				.poll(
					async () => {
						const commands = await listCommands(postId);
						return commands;
					},
					{ timeout: 30_000, intervals: [1000] }
				)
				.toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							prompt: 'proofread',
							post_id: postId,
							status: expect.stringMatching(
								/^(pending|claimed|running)$/
							),
						}),
					])
				);
		} catch (error) {
			const stderrOutput = stderr.join('').trim();
			throw new Error(
				`${error instanceof Error ? error.message : String(error)}${stderrOutput ? `\n\nMCP stderr:\n${stderrOutput}` : ''}`,
				{ cause: error }
			);
		} finally {
			await close();
			await deletePost(postId);
		}
	});

	test('Review button submits command', async ({ page }) => {
		test.setTimeout(120_000);

		const postId = await createDraftPost(
			'E2E sidebar review',
			PARAGRAPH_CONTENT
		);
		const appPassword = getSharedAppPassword();
		const { client, close, stderr } = await createMcpTestClient();

		try {
			await openEditor(page, postId);
			await openSidebar(page);

			// Connect MCP client
			await connectMcp(client, appPassword);

			// Wait for connected status
			await waitForConnectedStatus(page);

			const sidebar = getSidebar(page);

			// Wait for Review to be enabled
			await expect
				.poll(
					async () => {
						return sidebar
							.getByRole('button', { name: 'Review' })
							.isDisabled();
					},
					{ timeout: 30_000, intervals: [1000] }
				)
				.toBe(false);

			// Click Review
			await sidebar.getByRole('button', { name: 'Review' }).click();

			// Verify a command was created
			await expect
				.poll(
					async () => {
						const commands = await listCommands(postId);
						return commands;
					},
					{ timeout: 30_000, intervals: [1000] }
				)
				.toEqual(
					expect.arrayContaining([
						expect.objectContaining({
							prompt: 'review',
							post_id: postId,
							status: expect.stringMatching(
								/^(pending|claimed|running)$/
							),
						}),
					])
				);
		} catch (error) {
			const stderrOutput = stderr.join('').trim();
			throw new Error(
				`${error instanceof Error ? error.message : String(error)}${stderrOutput ? `\n\nMCP stderr:\n${stderrOutput}` : ''}`,
				{ cause: error }
			);
		} finally {
			await close();
			await deletePost(postId);
		}
	});

	test('buttons disabled while command is active', async ({ page }) => {
		test.setTimeout(120_000);

		const postId = await createDraftPost(
			'E2E sidebar buttons disabled',
			PARAGRAPH_CONTENT
		);
		const appPassword = getSharedAppPassword();
		const { client, close, stderr } = await createMcpTestClient();

		try {
			await openEditor(page, postId);
			await openSidebar(page);

			// Connect MCP client
			await connectMcp(client, appPassword);

			// Wait for connected status
			await waitForConnectedStatus(page);

			const sidebar = getSidebar(page);

			// Wait for buttons to be enabled
			await expect
				.poll(
					async () => {
						return sidebar
							.getByRole('button', { name: 'Proofread' })
							.isDisabled();
					},
					{ timeout: 30_000, intervals: [1000] }
				)
				.toBe(false);

			// Click Proofread to submit a command
			await sidebar.getByRole('button', { name: 'Proofread' }).click();

			// Verify buttons become disabled (during submitting or active command)
			await expect
				.poll(
					async () => {
						return sidebar
							.getByRole('button', { name: 'Review' })
							.isDisabled();
					},
					{ timeout: 30_000, intervals: [1000] }
				)
				.toBe(true);

			await expect(
				sidebar.getByRole('button', { name: 'Proofread' })
			).toBeDisabled();
		} catch (error) {
			const stderrOutput = stderr.join('').trim();
			throw new Error(
				`${error instanceof Error ? error.message : String(error)}${stderrOutput ? `\n\nMCP stderr:\n${stderrOutput}` : ''}`,
				{ cause: error }
			);
		} finally {
			await close();
			await deletePost(postId);
		}
	});

	test('Respond to Notes button visibility', async ({ page }) => {
		test.setTimeout(120_000);

		const postId = await createDraftPost(
			'E2E sidebar respond-to-notes',
			PARAGRAPH_CONTENT
		);
		const appPassword = getSharedAppPassword();
		const { client, close, stderr } = await createMcpTestClient();

		try {
			await openEditor(page, postId);
			await openSidebar(page);

			const sidebar = getSidebar(page);

			// Verify "Respond to Notes" button is NOT visible (no notes)
			await expect(
				sidebar.getByRole('button', { name: 'Respond to Notes' })
			).not.toBeVisible();

			// Connect MCP client and open the post
			await connectMcp(client, appPassword);
			await callToolOrThrow(client, 'wp_open_post', { postId });

			// Wait for connected status
			await waitForConnectedStatus(page);

			// Add a note via MCP
			await callToolOrThrow(client, 'wp_add_note', {
				blockIndex: '0',
				content: 'Test note for sidebar visibility',
			});

			// Poll until "Respond to Notes" button appears
			await expect
				.poll(
					async () => {
						return sidebar
							.getByRole('button', { name: 'Respond to Notes' })
							.isVisible();
					},
					{ timeout: 30_000, intervals: [1000] }
				)
				.toBe(true);
		} catch (error) {
			const stderrOutput = stderr.join('').trim();
			throw new Error(
				`${error instanceof Error ? error.message : String(error)}${stderrOutput ? `\n\nMCP stderr:\n${stderrOutput}` : ''}`,
				{ cause: error }
			);
		} finally {
			await close();
			await deletePost(postId);
		}
	});
});
