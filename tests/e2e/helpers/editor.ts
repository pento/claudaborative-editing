/**
 * Shared browser-interaction helpers for e2e tests.
 *
 * These are stateless functions that operate on Playwright Page/Editor
 * objects — they don't manage lifecycle and don't need to be fixtures.
 */
import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export interface BrowserBlock {
	name: string;
	attributes: Record<string, unknown>;
}

/**
 * Navigate to the post editor and wait until at least one block is loaded.
 */
export async function openEditor(page: Page, postId: number): Promise<void> {
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
 * Read the current blocks from the WordPress block editor store.
 */
export async function getBrowserBlocks(page: Page): Promise<BrowserBlock[]> {
	return page.evaluate(() => {
		const wpGlobal = globalThis as typeof globalThis & {
			wp?: {
				data?: {
					select: (store: string) => {
						getBlocks: () => Array<{
							name: string;
							attributes: Record<string, unknown>;
							innerBlocks?: unknown[];
						}>;
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

/**
 * Returns the footer status sparkle indicator locator.
 */
export function getFooterStatus(page: Page) {
	return page.locator('.wpce-footer-status');
}
