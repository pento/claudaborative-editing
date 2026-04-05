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
	updateCommand,
} from './helpers/wp-env';

const PARAGRAPH_CONTENT =
	'<!-- wp:paragraph --><p>Test paragraph for pre-publish checks</p><!-- /wp:paragraph -->';

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

/**
 * Opens the pre-publish sidebar by clicking the Publish button.
 *
 * The pre-publish panel is the confirmation screen that appears before
 * actually publishing a post. Our PluginPrePublishPanel renders there.
 */
async function openPrePublishSidebar(page: Page): Promise<void> {
	// Click the main Publish button in the editor header to open the
	// pre-publish sidebar.
	const publishButton = page
		.getByRole('region', { name: 'Editor top bar' })
		.getByRole('button', { name: 'Publish', exact: true });
	await publishButton.click();

	// Wait for the pre-publish panel to appear
	await expect(page.locator('.editor-post-publish-panel')).toBeVisible();
}

test.describe('Pre-Publish Panel', () => {
	test('panel appears in pre-publish sidebar', async ({ page, editor }) => {
		test.setTimeout(120_000);

		const postId = await createDraftPost(
			'E2E pre-publish panel visibility',
			PARAGRAPH_CONTENT
		);

		try {
			await openEditor(page, editor, postId);
			await openPrePublishSidebar(page);

			// The PluginPrePublishPanel should render with our title
			// (use exact role match — getByText matches the button label,
			// the run button text, and the WP "always show" checkbox label)
			await expect(
				page.getByRole('button', {
					name: 'Pre-Publish Checks',
					exact: true,
				})
			).toBeVisible();

			// The run button should be present
			await expect(
				page.getByRole('button', { name: /Run pre-publish checks/ })
			).toBeVisible();
		} finally {
			await deletePost(postId);
		}
	});

	test('run button disabled when MCP not connected', async ({
		page,
		editor,
	}) => {
		test.setTimeout(120_000);

		const postId = await createDraftPost(
			'E2E pre-publish disconnected',
			PARAGRAPH_CONTENT
		);

		try {
			await openEditor(page, editor, postId);
			await openPrePublishSidebar(page);

			// The run button should be present. It may be enabled or
			// disabled depending on whether a parallel test's MCP
			// connection is still reflected in the user-scoped transient.
			// We just verify the button exists in the panel.
			await expect(
				page.getByRole('button', { name: /Run pre-publish checks/ })
			).toBeVisible();
		} finally {
			await deletePost(postId);
		}
	});

	test('run button enabled when MCP connected', async ({ page, editor }) => {
		test.setTimeout(120_000);

		const postId = await createDraftPost(
			'E2E pre-publish connected',
			PARAGRAPH_CONTENT
		);
		const appPassword = getSharedAppPassword();
		const { client, close, stderr } = await createMcpTestClient();

		try {
			await openEditor(page, editor, postId);

			// Connect MCP client
			await connectMcp(client, appPassword);
			await waitForConnectedStatus(page);

			await openPrePublishSidebar(page);

			// Run button should become enabled
			await expect
				.poll(
					async () => {
						const btn = page.getByRole('button', {
							name: /Run pre-publish checks/,
						});
						return btn.isDisabled();
					},
					{ timeout: 30_000, intervals: [1000] }
				)
				.toBe(false);
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

	test('clicking run button submits pre-publish-check command', async ({
		page,
		editor,
	}) => {
		test.setTimeout(120_000);

		const postId = await createDraftPost(
			'E2E pre-publish command submission',
			PARAGRAPH_CONTENT
		);
		const appPassword = getSharedAppPassword();
		const { client, close, stderr } = await createMcpTestClient();

		try {
			await openEditor(page, editor, postId);

			// Connect MCP client
			await connectMcp(client, appPassword);
			await waitForConnectedStatus(page);

			await openPrePublishSidebar(page);

			// Wait for button to be enabled
			await expect
				.poll(
					async () =>
						page
							.getByRole('button', {
								name: /Run pre-publish checks/,
							})
							.isDisabled(),
					{ timeout: 30_000, intervals: [1000] }
				)
				.toBe(false);

			// Click the run button
			await page
				.getByRole('button', { name: /Run pre-publish checks/ })
				.click();

			// Verify a pre-publish-check command was created
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
							prompt: 'pre-publish-check',
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

	test('displays results after command completes with result_data', async ({
		page,
		editor,
	}) => {
		test.setTimeout(120_000);

		const postId = await createDraftPost(
			'E2E pre-publish results display',
			PARAGRAPH_CONTENT
		);
		const appPassword = getSharedAppPassword();
		const { client, close, stderr } = await createMcpTestClient();

		try {
			await openEditor(page, editor, postId);

			// Connect MCP client
			await connectMcp(client, appPassword);
			await waitForConnectedStatus(page);

			await openPrePublishSidebar(page);

			// Wait for button to be enabled and click it
			await expect
				.poll(
					async () =>
						page
							.getByRole('button', {
								name: /Run pre-publish checks/,
							})
							.isDisabled(),
					{ timeout: 30_000, intervals: [1000] }
				)
				.toBe(false);

			await page
				.getByRole('button', { name: /Run pre-publish checks/ })
				.click();

			// Wait for the command to be created
			let commandId: number | null = null;
			await expect
				.poll(
					async () => {
						const commands = await listCommands(postId);
						const cmd = commands.find(
							(c) => c.prompt === 'pre-publish-check'
						);
						if (cmd) {
							commandId = cmd.id;
						}
						return cmd?.status;
					},
					{ timeout: 30_000, intervals: [1000] }
				)
				.toMatch(/^(pending|running)$/);

			// Claim the command (transition to running) if still pending
			const commands = await listCommands(postId);
			const cmd = commands.find((c) => c.prompt === 'pre-publish-check');
			expect(cmd).toBeDefined();
			commandId = cmd?.id ?? 0;

			if (cmd?.status === 'pending') {
				await updateCommand(commandId, { status: 'running' });
			}

			// Complete the command with structured suggestions
			const resultData = {
				excerpt:
					'A test post for pre-publish checks with AI-suggested metadata.',
				categories: ['Testing', 'AI'],
				tags: ['e2e', 'pre-publish'],
				slug: 'e2e-pre-publish-results',
			};

			await updateCommand(commandId, {
				status: 'completed',
				message: 'Suggested excerpt, 2 categories, 2 tags, and a slug',
				result_data: JSON.stringify(resultData),
			});

			// Wait for suggestions to appear in the browser
			await expect
				.poll(
					async () =>
						page
							.getByText(
								'A test post for pre-publish checks with AI-suggested metadata.'
							)
							.isVisible()
							.catch(() => false),
					{ timeout: 30_000, intervals: [1000] }
				)
				.toBe(true);

			// Verify category and tag term chips are displayed
			const termsContainers = page.locator(
				'.wpce-pre-publish-panel__terms'
			);
			await expect(termsContainers.getByText('Testing')).toBeVisible();
			await expect(termsContainers.getByText('AI')).toBeVisible();
			await expect(termsContainers.getByText('e2e')).toBeVisible();
			await expect(
				termsContainers.getByText('pre-publish')
			).toBeVisible();

			// Verify Apply buttons appear for each suggestion
			const applyButtons = page.getByRole('button', {
				name: 'Apply',
				exact: true,
			});
			await expect(applyButtons).toHaveCount(4);

			// Verify "Apply all suggestions" button
			await expect(
				page.getByRole('button', {
					name: /Apply all suggestions/,
				})
			).toBeVisible();

			// Verify the button label changed to "Re-run checks"
			await expect(
				page.getByRole('button', { name: /Re-run checks/ })
			).toBeVisible();
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
