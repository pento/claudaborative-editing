/**
 * E2e test for resuming an in-progress compose session (issue #104).
 *
 * Closing the conversation sidebar (close button, viewport shrink below the
 * medium breakpoint) must not cancel the command — the session stays alive
 * and the AI Actions menu offers a "Resume composing" item that reopens the
 * panel with the conversation intact.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './test';
import { openEditor } from './helpers/editor';

/**
 * Dispatch a fake `compose` command into the AI-actions store so the
 * ConversationPanel mounts and the sidebar opens. No MCP server is
 * required — this exercises the purely-client close/resume flow.
 */
async function injectComposeCommand(page: Page, postId: number): Promise<void> {
	await page.evaluate((id) => {
		type WpGlobal = typeof globalThis & {
			wp: {
				data: {
					select: (store: string) => {
						getCurrentUser?: () => { id?: number } | undefined;
					};
					dispatch: (store: string) => {
						handleSyncUpdate: (
							commands: Record<string, unknown>,
							postId: number,
							userId: number
						) => void;
					};
				};
			};
		};
		const { data } = (globalThis as WpGlobal).wp;
		const userId = data.select('core').getCurrentUser?.()?.id ?? 1;
		data.dispatch('wpce/ai-actions').handleSyncUpdate(
			{
				9999: {
					id: 9999,
					post_id: id,
					prompt: 'compose',
					arguments: {},
					status: 'awaiting_input',
					user_id: userId,
					claimed_by: userId,
					message: 'canary',
					result_data: {
						messages: [
							{
								role: 'assistant',
								content: '<p>Canary message.</p>',
								timestamp: '2026-01-01T00:00:00Z',
							},
						],
						input_prompt: 'Respond…',
					},
					created_at: '2026-01-01T00:00:00Z',
					updated_at: '2026-01-01T00:00:00Z',
					expires_at: '2099-12-31 00:00:00',
				},
			},
			id,
			userId
		);
	}, postId);
}

test.describe('Compose resume', () => {
	test('closing the sidebar keeps the session and Resume reopens it', async ({
		page,
		draftPost,
	}) => {
		await openEditor(page, draftPost);

		// Track any command-cancelling requests — closing the sidebar must
		// not fire one.
		const deleteRequests: string[] = [];
		page.on('request', (request) => {
			if (
				request.method() === 'DELETE' &&
				request.url().includes('/wpce/v1/commands')
			) {
				deleteRequests.push(request.url());
			}
		});

		await injectComposeCommand(page, draftPost);

		const panel = page.locator('.wpce-conversation-panel');
		await expect(panel).toBeVisible();
		await expect(panel.getByText('Canary message.')).toBeVisible();

		// Close the sidebar via its close button — mimics the involuntary
		// close paths (viewport shrink, another sidebar taking the slot).
		await page
			.getByRole('button', { name: 'Close conversation panel' })
			.click();
		await expect(panel).toBeHidden();

		// The command survived: no cancel request was sent.
		expect(deleteRequests).toHaveLength(0);

		// The AI Actions menu now offers Resume in place of Compose.
		await page
			.getByRole('button', {
				name: 'Claudaborative Editing',
				exact: true,
			})
			.click();
		const resumeItem = page.getByRole('menuitem', {
			name: /Resume composing/,
		});
		await expect(resumeItem).toBeVisible();
		await expect(resumeItem).toBeEnabled();
		await resumeItem.click();

		// The panel is back with the conversation intact.
		await expect(panel).toBeVisible();
		await expect(panel.getByText('Canary message.')).toBeVisible();
		expect(deleteRequests).toHaveLength(0);
	});
});
