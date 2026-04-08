import { test, expect } from './test';
import type { Page } from '@playwright/test';
import {
	openEditor,
	getFooterStatus,
	waitForConnectedStatus,
} from './helpers/editor';
import { listCommands } from './helpers/wp-env';

const PARAGRAPH_CONTENT =
	'<!-- wp:paragraph --><p>Test paragraph for AI Actions</p><!-- /wp:paragraph -->';

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

test.describe('AI Actions', () => {
	test('dropdown opens and closes', async ({
		page,
		editor,
		testUser,
		draftPost,
	}) => {
		const auth = {
			username: testUser.username,
			appPassword: testUser.appPassword,
		};
		const postId = await draftPost(
			'E2E dropdown open-close',
			PARAGRAPH_CONTENT,
			auth
		);
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
	});

	test('footer shows disconnected status without MCP', async ({
		page,
		editor,
		testUser,
		draftPost,
	}) => {
		const auth = {
			username: testUser.username,
			appPassword: testUser.appPassword,
		};
		const postId = await draftPost(
			'E2E disconnected status',
			PARAGRAPH_CONTENT,
			auth
		);
		await openEditor(page, editor, postId);

		// Footer sparkle should be grey (disconnected). Per-test user
		// isolation ensures no parallel test can affect this user's
		// mcp_connected transient.
		await expect
			.poll(
				async () =>
					getFooterStatus(page)
						.locator('svg path')
						.first()
						.getAttribute('fill'),
				{ timeout: 30_000, intervals: [1000] }
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
	});

	test('footer shows connected status with MCP', async ({
		page,
		editor,
		testUser,
		connectedMcpClient,
		draftPost,
	}) => {
		void connectedMcpClient;

		const auth = {
			username: testUser.username,
			appPassword: testUser.appPassword,
		};
		const postId = await draftPost(
			'E2E connected status',
			PARAGRAPH_CONTENT,
			auth
		);
		await openEditor(page, editor, postId);

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
	});

	test('Proofread submits command', async ({
		page,
		editor,
		testUser,
		connectedMcpClient,
		draftPost,
	}) => {
		void connectedMcpClient;

		const auth = {
			username: testUser.username,
			appPassword: testUser.appPassword,
		};
		const postId = await draftPost(
			'E2E proofread command',
			PARAGRAPH_CONTENT,
			auth
		);
		await openEditor(page, editor, postId);

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
						status: expect.stringMatching(/^(pending|running)$/),
					}),
				])
			);
	});

	test('Review submits command', async ({
		page,
		editor,
		testUser,
		connectedMcpClient,
		draftPost,
	}) => {
		void connectedMcpClient;

		const auth = {
			username: testUser.username,
			appPassword: testUser.appPassword,
		};
		const postId = await draftPost(
			'E2E review command',
			PARAGRAPH_CONTENT,
			auth
		);
		await openEditor(page, editor, postId);

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
						status: expect.stringMatching(/^(pending|running)$/),
					}),
				])
			);
	});

	test('menu items disabled while command is active', async ({
		page,
		editor,
		testUser,
		connectedMcpClient,
		draftPost,
	}) => {
		void connectedMcpClient;

		const auth = {
			username: testUser.username,
			appPassword: testUser.appPassword,
		};
		const postId = await draftPost(
			'E2E items disabled',
			PARAGRAPH_CONTENT,
			auth
		);
		await openEditor(page, editor, postId);

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
	});
});
