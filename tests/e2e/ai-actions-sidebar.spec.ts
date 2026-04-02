import { test, expect } from './test';
import type { Editor } from '@wordpress/e2e-test-utils-playwright';
import type { Page } from '@playwright/test';
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

/**
 * Returns the AI Actions dropdown toggle button in the toolbar.
 */
function getDropdownToggle(page: Page) {
	return page.getByRole('button', {
		name: 'Claudaborative Editing',
		exact: true,
	});
}

/**
 * Opens the AI Actions dropdown menu and waits for it to be visible.
 */
async function openDropdown(page: Page): Promise<void> {
	await getDropdownToggle(page).click();
	await expect(
		page.getByRole('menu', { name: 'Claudaborative Editing' })
	).toBeVisible();
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

/**
 * Returns the footer status sparkle indicator.
 */
function getFooterStatus(page: Page) {
	return page.locator('.wpce-footer-status');
}

async function waitForConnectedStatus(page: Page): Promise<void> {
	await expect
		.poll(
			async () => {
				return getFooterStatus(page)
					.locator('svg path')
					.first()
					.getAttribute('fill');
			},
			{ timeout: 30_000, intervals: [1000] }
		)
		.toBe('#D97706');
}

test.describe('AI Actions', () => {
	test('dropdown opens and closes', async ({ page, editor }) => {
		test.setTimeout(120_000);

		const postId = await createDraftPost(
			'E2E dropdown open-close',
			PARAGRAPH_CONTENT
		);

		try {
			await openEditor(page, editor, postId);

			const toggle = getDropdownToggle(page);
			await expect(toggle).toBeVisible();

			// Open the dropdown
			await toggle.click();
			const menu = page.getByRole('menu', {
				name: 'Claudaborative Editing',
			});
			await expect(menu).toBeVisible();

			// Verify Proofread and Review menu items appear
			await expect(
				page.getByRole('menuitem', { name: /Proofread/ })
			).toBeVisible();
			await expect(
				page.getByRole('menuitem', { name: /Review/ })
			).toBeVisible();

			// Close the dropdown
			await toggle.click();
			await expect(menu).not.toBeVisible();
		} finally {
			await deletePost(postId);
		}
	});

	test('footer shows disconnected status without MCP', async ({
		page,
		editor,
	}) => {
		test.setTimeout(120_000);

		const postId = await createDraftPost(
			'E2E disconnected status',
			PARAGRAPH_CONTENT
		);

		try {
			await openEditor(page, editor, postId);

			// Wait for footer sparkle to be grey (disconnected).
			// Uses polling because a parallel test's MCP connection
			// may briefly set the user-scoped mcp_connected transient
			// (30s TTL) — we wait for it to expire.
			await expect
				.poll(
					async () =>
						getFooterStatus(page)
							.locator('svg path')
							.first()
							.getAttribute('fill'),
					{ timeout: 45_000, intervals: [1000] }
				)
				.toBe('#949494');

			// Verify menu items are disabled in dropdown
			await openDropdown(page);

			await expect
				.poll(
					async () =>
						page
							.getByRole('menuitem', { name: /Proofread/ })
							.isDisabled(),
					{ timeout: 10_000, intervals: [500] }
				)
				.toBe(true);
			await expect(
				page.getByRole('menuitem', { name: /Review/ })
			).toBeDisabled();
		} finally {
			await deletePost(postId);
		}
	});

	test('footer shows connected status with MCP', async ({ page, editor }) => {
		test.setTimeout(120_000);

		const postId = await createDraftPost(
			'E2E connected status',
			PARAGRAPH_CONTENT
		);
		const appPassword = getSharedAppPassword();
		const { client, close, stderr } = await createMcpTestClient();

		try {
			await openEditor(page, editor, postId);

			// Connect MCP client
			await connectMcp(client, appPassword);

			// Wait for connected status (orange sparkle)
			await waitForConnectedStatus(page);

			// Verify menu items become enabled
			await openDropdown(page);

			await expect
				.poll(
					async () => {
						return page
							.getByRole('menuitem', { name: /Proofread/ })
							.isDisabled();
					},
					{ timeout: 30_000, intervals: [1000] }
				)
				.toBe(false);

			await expect(
				page.getByRole('menuitem', { name: /Review/ })
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

	test('Proofread submits command', async ({ page, editor }) => {
		test.setTimeout(120_000);

		const postId = await createDraftPost(
			'E2E proofread command',
			PARAGRAPH_CONTENT
		);
		const appPassword = getSharedAppPassword();
		const { client, close, stderr } = await createMcpTestClient();

		try {
			await openEditor(page, editor, postId);

			// Connect MCP client
			await connectMcp(client, appPassword);

			// Wait for connected status
			await waitForConnectedStatus(page);

			// Open dropdown and wait for Proofread to be enabled
			await openDropdown(page);

			await expect
				.poll(
					async () => {
						return page
							.getByRole('menuitem', { name: /Proofread/ })
							.isDisabled();
					},
					{ timeout: 30_000, intervals: [1000] }
				)
				.toBe(false);

			// Click Proofread (dropdown auto-closes)
			await page.getByRole('menuitem', { name: /Proofread/ }).click();

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
								/^(pending|running)$/
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

	test('Review submits command', async ({ page, editor }) => {
		test.setTimeout(120_000);

		const postId = await createDraftPost(
			'E2E review command',
			PARAGRAPH_CONTENT
		);
		const appPassword = getSharedAppPassword();
		const { client, close, stderr } = await createMcpTestClient();

		try {
			await openEditor(page, editor, postId);

			// Connect MCP client
			await connectMcp(client, appPassword);

			// Wait for connected status
			await waitForConnectedStatus(page);

			// Open dropdown and wait for Review to be enabled
			await openDropdown(page);

			await expect
				.poll(
					async () => {
						return page
							.getByRole('menuitem', { name: /Review/ })
							.isDisabled();
					},
					{ timeout: 30_000, intervals: [1000] }
				)
				.toBe(false);

			// Click Review (dropdown auto-closes)
			await page.getByRole('menuitem', { name: /Review/ }).click();

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
								/^(pending|running)$/
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

	test('menu items disabled while command is active', async ({
		page,
		editor,
	}) => {
		test.setTimeout(120_000);

		const postId = await createDraftPost(
			'E2E items disabled',
			PARAGRAPH_CONTENT
		);
		const appPassword = getSharedAppPassword();
		const { client, close, stderr } = await createMcpTestClient();

		try {
			await openEditor(page, editor, postId);

			// Connect MCP client
			await connectMcp(client, appPassword);

			// Wait for connected status
			await waitForConnectedStatus(page);

			// Open dropdown and wait for items to be enabled
			await openDropdown(page);

			await expect
				.poll(
					async () => {
						return page
							.getByRole('menuitem', { name: /Proofread/ })
							.isDisabled();
					},
					{ timeout: 30_000, intervals: [1000] }
				)
				.toBe(false);

			// Click Proofread to submit a command (dropdown auto-closes)
			await page.getByRole('menuitem', { name: /Proofread/ }).click();

			// Wait for dropdown to close
			await expect(
				page.getByRole('menu', { name: 'Claudaborative Editing' })
			).not.toBeVisible();

			// Reopen dropdown to check disabled state
			await openDropdown(page);

			// Verify items become disabled
			await expect
				.poll(
					async () => {
						return page
							.getByRole('menuitem', { name: /Review/ })
							.isDisabled();
					},
					{ timeout: 30_000, intervals: [1000] }
				)
				.toBe(true);

			await expect(
				page.getByRole('menuitem', { name: /Proofread/ })
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
});
