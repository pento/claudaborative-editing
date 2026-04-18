/**
 * Canary e2e test for the ConversationPanel's resize handle.
 *
 * The resize hook reaches into Gutenberg's `InterfaceSkeleton` DOM
 * (`.interface-interface-skeleton__body`, `__sidebar`, and
 * `.interface-complementary-area`) to drive the sidebar's width. If any of
 * those class names or the nesting changes upstream, the unit tests keep
 * passing (they mock Gutenberg) but the feature silently breaks. This
 * test drives the real editor to catch that.
 */
import type { Page } from '@playwright/test';
import { test, expect } from './test';
import { openEditor } from './helpers/editor';

const STORAGE_KEY = 'wpce:conversation-sidebar-width';

/**
 * Dispatch a fake `compose` command into the AI-actions store so the
 * ConversationPanel mounts and the sidebar opens. No MCP server is
 * required — this exercises the purely-client resize flow.
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
						input_prompt: 'Respond\u2026',
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

test.describe('ConversationPanel resize', () => {
	test('dragging the handle resizes the skeleton sidebar', async ({
		page,
		draftPost,
	}) => {
		await openEditor(page, draftPost);

		// Reset any persisted width so the default (280) is what we see.
		await page.evaluate((key: string) => {
			type WinGlobal = typeof globalThis & {
				localStorage: { removeItem: (key: string) => void };
			};
			(globalThis as WinGlobal).localStorage.removeItem(key);
		}, STORAGE_KEY);

		await injectComposeCommand(page, draftPost);

		const handle = page.locator('.wpce-conversation-panel__resize-handle');
		await expect(handle).toBeVisible();

		// Ancestor chain canary: if Gutenberg renames any of these classes
		// or changes the nesting, one of these expectations fails and the
		// hook needs updating.
		const skeleton = page.locator('.interface-interface-skeleton__sidebar');
		const body = page.locator('.interface-interface-skeleton__body');
		await expect(
			body.locator(
				'> .wpce-conversation-panel__resize-handle-slot > .wpce-conversation-panel__resize-handle'
			)
		).toHaveCount(1);
		await expect(
			skeleton.locator('.interface-complementary-area')
		).toHaveCount(1);
		await expect(skeleton.locator('.wpce-conversation-panel')).toHaveCount(
			1
		);
		// The slot must sit immediately before the sidebar so keyboard tab
		// order reaches the handle first.
		const slotIsBeforeSidebar = await page.evaluate((): boolean => {
			type DocGlobal = typeof globalThis & {
				document: {
					querySelector: (selector: string) => {
						nextElementSibling?: {
							classList: { contains: (cls: string) => boolean };
						} | null;
					} | null;
				};
			};
			const wrapper = (globalThis as DocGlobal).document.querySelector(
				'.wpce-conversation-panel__resize-handle-slot'
			);
			const sibling = wrapper?.nextElementSibling;
			return (
				sibling?.classList.contains(
					'interface-interface-skeleton__sidebar'
				) ?? false
			);
		});
		expect(slotIsBeforeSidebar).toBe(true);

		// Default width (280) should be written to the skeleton's inline
		// style now that the sidebar is active.
		await expect
			.poll(async () => skeleton.getAttribute('style'))
			.toMatch(/width:\s*280px/);

		// Drag the handle 100px to the left; the sidebar lives on the
		// right, so dragging left grows it by the same amount.
		const box = await handle.boundingBox();
		if (!box) {
			throw new Error('resize handle missing bounding box');
		}
		const startX = box.x + box.width / 2;
		const startY = box.y + box.height / 2;
		await page.mouse.move(startX, startY);
		await page.mouse.down();
		await page.mouse.move(startX - 100, startY, { steps: 10 });
		await page.mouse.up();

		await expect
			.poll(async () => skeleton.getAttribute('style'))
			.toMatch(/width:\s*380px/);

		// Width is persisted so the preference survives reloads.
		const stored = await page.evaluate((key: string): string | null => {
			type WinGlobal = typeof globalThis & {
				localStorage: { getItem: (key: string) => string | null };
			};
			return (globalThis as WinGlobal).localStorage.getItem(key);
		}, STORAGE_KEY);
		expect(stored).toBe('380');
	});
});
