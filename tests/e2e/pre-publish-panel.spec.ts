import { test, expect } from './test';
import type { Page } from '@playwright/test';
import { callToolOrThrow, waitForMCPReady } from './helpers/mcp';
import { openEditor } from './helpers/editor';
import { listCommands } from './helpers/wp-env';

/**
 * Opens the pre-publish sidebar by clicking the Publish button.
 *
 * The pre-publish panel is the confirmation screen that appears before
 * actually publishing a post. Our PluginPrePublishPanel renders there.
 */
async function openPrePublishSidebar(page: Page): Promise<void> {
	const publishButton = page
		.getByRole('region', { name: 'Editor top bar' })
		.getByRole('button', { name: 'Publish', exact: true });
	await publishButton.click();
	await expect(page.locator('.editor-post-publish-panel')).toBeVisible();
}

test.describe('Pre-Publish Panel', () => {
	test('panel appears in pre-publish sidebar', async ({
		page,
		editor,
		draftPost,
	}) => {
		await openEditor(page, editor, draftPost);
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
	});

	test('run button disabled when MCP not connected', async ({
		page,
		editor,
		draftPost,
	}) => {
		await openEditor(page, editor, draftPost);
		await openPrePublishSidebar(page);

		// Per-test user isolation ensures no MCP connection exists,
		// so the button should be disabled.
		await expect(
			page.getByRole('button', { name: /Run pre-publish checks/ })
		).toBeDisabled();
	});

	test('run button enabled when MCP connected', async ({
		page,
		editor,
		draftPost,
		mcpClient,
	}) => {
		await openEditor(page, editor, draftPost);

		// Wait for MCP connection to be reflected in the browser
		await waitForMCPReady(mcpClient.client);

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
	});

	test('clicking run button submits pre-publish-check command', async ({
		page,
		editor,
		draftPost,
		mcpClient,
	}) => {
		await openEditor(page, editor, draftPost);

		// Wait for MCP connection to be reflected in the browser
		await waitForMCPReady(mcpClient.client);

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
					const commands = await listCommands(draftPost);
					return commands;
				},
				{ timeout: 30_000, intervals: [1000] }
			)
			.toEqual(
				expect.arrayContaining([
					expect.objectContaining({
						prompt: 'pre-publish-check',
						post_id: draftPost,
						status: expect.stringMatching(/^(pending|running)$/),
					}),
				])
			);
	});

	test('displays results after command completes with result_data', async ({
		page,
		editor,
		draftPost,
		mcpClient,
	}) => {
		await openEditor(page, editor, draftPost);

		// Wait for MCP connection to be reflected in the browser
		await waitForMCPReady(mcpClient.client);

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
					const commands = await listCommands(draftPost);
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

		// Claim the command (transition to running) if still pending.
		// Use the MCP tool (not direct REST) so the status change is
		// written to the Y.Doc and syncs to the browser.
		const commands = await listCommands(draftPost);
		const cmd = commands.find((c) => c.prompt === 'pre-publish-check');
		expect(cmd).toBeDefined();
		commandId = cmd?.id ?? 0;

		if (cmd?.status === 'pending') {
			await callToolOrThrow(
				mcpClient.client,
				'wp_update_command_status',
				{
					commandId,
					status: 'running',
				}
			);
		}

		// Complete the command with structured suggestions
		const resultData = {
			excerpt:
				'A test post for pre-publish checks with AI-suggested metadata.',
			categories: ['Testing', 'AI'],
			tags: ['e2e', 'pre-publish'],
			slug: 'e2e-pre-publish-results',
		};

		await callToolOrThrow(mcpClient.client, 'wp_update_command_status', {
			commandId,
			status: 'completed',
			message: 'Suggested excerpt, 2 categories, 2 tags, and a slug',
			resultData: JSON.stringify(resultData),
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
		const termsContainers = page.locator('.wpce-pre-publish-panel__terms');
		await expect(termsContainers.getByText('Testing')).toBeVisible();
		await expect(termsContainers.getByText('AI')).toBeVisible();
		await expect(termsContainers.getByText('e2e')).toBeVisible();
		await expect(termsContainers.getByText('pre-publish')).toBeVisible();

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
	});
});
