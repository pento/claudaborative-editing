/**
 * E2E test covering the "agent asks for language clarification" flow.
 *
 * The prompt-content refactor added a universal rule telling the model
 * to detect the post's language from its content and, if uncertain, to
 * use wp_update_command_status with status "awaiting_input" to confirm
 * with the user. This test exercises that full round-trip:
 *
 * 1. Browser triggers a proofread command.
 * 2. MCP server emits a channel notification carrying the embedded
 *    prompt content. The test captures it and asserts:
 *      - the static instructions contain the document-language rule,
 *      - the dynamic context carries User locale / Site locale hint,
 *      - meta.user_locale is set from the command arguments.
 * 3. Playing the agent, the test calls wp_update_command_status with
 *    status "awaiting_input" to ask a language-clarification question.
 * 4. The browser's conversation panel opens and shows the question.
 * 5. The user types a response and clicks Send.
 * 6. The MCP server fires a response-event channel notification. The
 *    test asserts the user's response is carried through and that
 *    meta.user_locale is still present so the model can answer in the
 *    user's language.
 * 7. The test completes the command to unwind state.
 */
import { test, expect } from './test';
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { openEditor } from './helpers/editor';
import { listCommands } from './helpers/playground';
import { callToolOrThrow, waitForMCPReady } from './helpers/mcp';

interface ChannelNotification {
	method: string;
	params: {
		content: string;
		meta: Record<string, string>;
	};
}

/**
 * Install a capturing fallback handler on the MCP client so the test
 * can await specific notifications/claude/channel events.
 */
function captureChannelNotifications(client: Client): ChannelNotification[] {
	const captured: ChannelNotification[] = [];
	// fallbackNotificationHandler fires for any notification method that
	// doesn't have a dedicated handler registered. The channel method is
	// experimental, so it always falls through.
	(
		client as unknown as {
			fallbackNotificationHandler: (
				notification: ChannelNotification
			) => Promise<void>;
		}
	).fallbackNotificationHandler = (notification) => {
		if (notification.method === 'notifications/claude/channel') {
			captured.push(notification);
		}
		return Promise.resolve();
	};
	return captured;
}

function findEmbeddedProofread(
	notifications: ChannelNotification[]
): ChannelNotification | undefined {
	return notifications.find(
		(n) =>
			n.params.meta.prompt === 'proofread' &&
			n.params.meta.content_embedded === 'true'
	);
}

function findResponseFor(
	notifications: ChannelNotification[],
	commandId: number
): ChannelNotification | undefined {
	return notifications.find(
		(n) =>
			n.params.meta.event_type === 'response' &&
			n.params.meta.command_id === String(commandId)
	);
}

test.describe('Language clarification flow', () => {
	test('agent asks for language clarification and user responds', async ({
		page,
		mcpClient,
		draftPost,
	}) => {
		const notifications = captureChannelNotifications(mcpClient.client);

		await openEditor(page, draftPost);
		await waitForMCPReady(mcpClient.client);

		// --- Step 1: Browser triggers Proofread ---

		const toggle = page.getByRole('button', {
			name: 'Claudaborative Editing',
			exact: true,
		});
		await toggle.click();
		await expect
			.poll(
				async () =>
					page
						.getByRole('menuitem', { name: /Proofread/ })
						.isDisabled(),
				{ timeout: 30_000, intervals: [1000] }
			)
			.toBe(false);
		await page.getByRole('menuitem', { name: /Proofread/ }).click();

		// --- Step 2: Wait for the embedded channel notification ---

		await expect
			.poll(() => findEmbeddedProofread(notifications) ?? null, {
				timeout: 30_000,
				intervals: [500],
			})
			.not.toBeNull();

		const embedded = findEmbeddedProofread(notifications);
		if (!embedded) {
			throw new Error('embedded proofread notification not captured');
		}

		// The static instruction block carries the document-language rule.
		expect(embedded.params.content).toContain('Language for content');
		expect(embedded.params.content).toContain("detect the post's language");
		expect(embedded.params.content).toContain('awaiting_input');

		// The dynamic context block carries the locale hints so the
		// model has something to work with beyond the post body.
		expect(embedded.params.content).toMatch(/User locale: \S+/);
		expect(embedded.params.content).toMatch(/Site locale hint: \S+/);

		// meta.user_locale is populated from command.arguments.userLocale
		// so the universal server-instructions rule can reference it.
		expect(embedded.params.meta.user_locale).toBeTruthy();

		const commandId = Number(embedded.params.meta.command_id);
		expect(commandId).toBeGreaterThan(0);

		// --- Step 3: Agent asks the language-clarification question ---

		// If auto-claim hasn't fired yet, claim it first. Tolerate 409 —
		// the server may have already transitioned the command to running.
		const beforeClaim = await listCommands(draftPost);
		const preClaim = beforeClaim.find((c) => c.id === commandId);
		if (preClaim?.status === 'pending') {
			try {
				await callToolOrThrow(
					mcpClient.client,
					'wp_update_command_status',
					{ commandId, status: 'running' }
				);
			} catch (e) {
				if (!(e instanceof Error) || !e.message.includes('409')) {
					throw e;
				}
			}
		}

		const question =
			'<p>The post is very short. What language should I proofread it in?</p>';
		await callToolOrThrow(mcpClient.client, 'wp_update_command_status', {
			commandId,
			status: 'awaiting_input',
			message: question,
		});

		// --- Step 4: Conversation panel shows the question ---

		await expect(
			page.locator('.wpce-conversation-panel__message--assistant', {
				hasText: 'What language should I proofread it in?',
			})
		).toBeVisible({ timeout: 30_000 });

		// --- Step 5: User types a response and clicks Send ---

		const textarea = page.locator(
			'.wpce-conversation-panel__input-area textarea'
		);
		await expect(textarea).toBeVisible();
		await textarea.fill('Please proofread it in English.');
		await page
			.locator('.wpce-conversation-panel__actions')
			.getByRole('button', { name: 'Send', exact: true })
			.click();

		// --- Step 6: Response-event channel notification arrives ---

		await expect
			.poll(() => findResponseFor(notifications, commandId) ?? null, {
				timeout: 30_000,
				intervals: [500],
			})
			.not.toBeNull();

		const response = findResponseFor(notifications, commandId);
		if (!response) {
			throw new Error('response notification not captured');
		}
		expect(response.params.content).toContain(
			'Please proofread it in English.'
		);
		// The user's locale must stick to the response notification too
		// so a subsequent status message lands in the correct language.
		expect(response.params.meta.user_locale).toBeTruthy();

		// --- Step 7: Finalise the command, persisting the confirmed language ---

		// Including documentLanguage in resultData tells the WP side to
		// write it to post meta, so future commands on this post skip
		// the clarification step entirely.
		await callToolOrThrow(mcpClient.client, 'wp_update_command_status', {
			commandId,
			status: 'completed',
			message: 'Proofread complete.',
			resultData: JSON.stringify({ documentLanguage: 'English' }),
		});

		await expect
			.poll(
				async () => {
					const cmds = await listCommands(draftPost);
					return cmds.find((c) => c.id === commandId)?.status;
				},
				{ timeout: 15_000, intervals: [500] }
			)
			.toBe('completed');

		// --- Step 8: Second command on the same post sees the confirmed language ---

		// Fire another Proofread. The embedded content should now carry
		// "Confirmed document language: English" so the agent skips the
		// detection / clarification path on this and all future commands.
		const notificationsBefore = notifications.length;

		await toggle.click();
		await page.getByRole('menuitem', { name: /Proofread/ }).click();

		await expect
			.poll(
				() =>
					notifications
						.slice(notificationsBefore)
						.find(
							(n) =>
								n.params.meta.prompt === 'proofread' &&
								n.params.meta.content_embedded === 'true'
						) ?? null,
				{ timeout: 30_000, intervals: [500] }
			)
			.not.toBeNull();

		const secondEmbedded = notifications
			.slice(notificationsBefore)
			.find(
				(n) =>
					n.params.meta.prompt === 'proofread' &&
					n.params.meta.content_embedded === 'true'
			);
		if (!secondEmbedded) {
			throw new Error('second proofread notification not captured');
		}
		expect(secondEmbedded.params.content).toContain(
			'Confirmed document language: English'
		);

		// Clean up the second command so the fixture teardown doesn't
		// trip over a lingering pending/running command.
		const secondCommandId = Number(secondEmbedded.params.meta.command_id);
		if (secondCommandId > 0) {
			const cmds = await listCommands(draftPost);
			const second = cmds.find((c) => c.id === secondCommandId);
			if (second && second.status === 'pending') {
				try {
					await callToolOrThrow(
						mcpClient.client,
						'wp_update_command_status',
						{ commandId: secondCommandId, status: 'running' }
					);
				} catch (e) {
					if (!(e instanceof Error) || !e.message.includes('409')) {
						throw e;
					}
				}
			}
			await callToolOrThrow(
				mcpClient.client,
				'wp_update_command_status',
				{
					commandId: secondCommandId,
					status: 'completed',
					message: 'done',
				}
			);
		}
	});
});
