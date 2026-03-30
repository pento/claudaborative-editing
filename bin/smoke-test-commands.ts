#!/usr/bin/env npx tsx
/**
 * Smoke test: verify the MCP server detects the WordPress plugin and
 * successfully receives + claims commands via the command listener.
 *
 * Prerequisites:
 *   npx wp-env start          # or use .wp-env.test.json
 *
 * Usage:
 *   npx tsx bin/smoke-test-commands.ts [base-url]
 *
 * Default base URL is http://localhost:8888 (wp-env dev environment).
 * Pass http://localhost:8889 for the test environment.
 */

import { SessionManager } from '../src/session/session-manager.js';
import type { ChannelNotifier } from '../src/session/command-handler.js';

// --- Configuration ---

const WP_BASE_URL = process.argv[2] ?? 'http://localhost:8888';
const WP_USER = 'admin';

// --- Helpers ---

function log(msg: string): void {
	const ts = new Date().toISOString().slice(11, 23);
	console.log(`[${ts}] ${msg}`);
}

function fail(msg: string): never {
	console.error(`\n  FAIL: ${msg}\n`);
	process.exit(1);
}

async function apiFetch<T>(
	path: string,
	appPassword: string,
	options: RequestInit = {}
): Promise<T> {
	const url = `${WP_BASE_URL}/wp-json${path}`;
	const auth = `Basic ${btoa(`${WP_USER}:${appPassword}`)}`;
	const headers: Record<string, string> = {
		Authorization: auth,
		'Content-Type': 'application/json',
	};
	const response = await fetch(url, { ...options, headers });
	if (!response.ok) {
		const body = await response.text();
		throw new Error(
			`API ${options.method ?? 'GET'} ${path} → ${response.status}: ${body}`
		);
	}
	return (await response.json()) as T;
}

// --- Main ---

async function main(): Promise<void> {
	log(`Smoke test: MCP ↔ WordPress plugin command flow`);
	log(`Target: ${WP_BASE_URL}`);

	// 1. Check WordPress is reachable
	log('Checking WordPress is reachable...');
	try {
		const resp = await fetch(`${WP_BASE_URL}/wp-login.php`, {
			redirect: 'manual',
		});
		if (!resp.ok && resp.status !== 302) {
			fail(`WordPress returned ${resp.status}. Is wp-env running?`);
		}
	} catch (e) {
		fail(
			`Cannot reach ${WP_BASE_URL}. Start wp-env first: npx wp-env start`
		);
	}

	// 2. Create an app password for this test run
	log('Creating app password...');
	const { execFileSync } = await import('node:child_process');

	let appPassword: string;
	try {
		appPassword = execFileSync(
			'npx',
			[
				'wp-env',
				'run',
				'cli',
				'wp',
				'user',
				'application-password',
				'create',
				WP_USER,
				`smoke-test-${Date.now()}`,
				'--porcelain',
			],
			{ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
		).trim();
	} catch {
		fail('Failed to create app password via wp-env CLI.');
	}
	log(`App password created.`);

	// 3. Pre-flight: check individual endpoints before full connect
	log('Pre-flight checks...');
	const authHeader = `Basic ${btoa(`${WP_USER}:${appPassword}`)}`;

	// Check auth
	try {
		const userResp = await fetch(`${WP_BASE_URL}/wp-json/wp/v2/users/me`, {
			headers: { Authorization: authHeader },
		});
		if (!userResp.ok) {
			fail(
				`Auth check failed (${userResp.status}): ${await userResp.text()}`
			);
		}
		log('  Auth: OK');
	} catch (e) {
		fail(
			`Auth check failed: ${e instanceof Error ? e.message : String(e)}`
		);
	}

	// Check sync endpoint
	try {
		const syncResp = await fetch(
			`${WP_BASE_URL}/wp-json/wp-sync/v1/updates`,
			{
				method: 'POST',
				headers: {
					Authorization: authHeader,
					'Content-Type': 'application/json',
					Accept: 'application/json',
				},
				body: JSON.stringify({ rooms: [] }),
			}
		);
		const syncBody = await syncResp.text();
		if (!syncResp.ok) {
			fail(
				`Sync endpoint check failed (${syncResp.status}): ${syncBody}\n` +
					'  Is collaborative editing enabled?\n' +
					'  Run: npx wp-env run cli wp option update wp_collaboration_enabled 1'
			);
		}
		if (!syncBody) {
			fail(
				'Sync endpoint returned empty body.\n' +
					'  The Gutenberg plugin may need rebuilding or the sync endpoint is not working.'
			);
		}
		log('  Sync endpoint: OK');
	} catch (e) {
		fail(
			`Sync endpoint check failed: ${e instanceof Error ? e.message : String(e)}`
		);
	}

	// Check plugin status endpoint
	try {
		const pluginResp = await fetch(
			`${WP_BASE_URL}/wp-json/wpce/v1/status`,
			{ headers: { Authorization: authHeader } }
		);
		if (!pluginResp.ok) {
			fail(
				`Plugin status check failed (${pluginResp.status}): ${await pluginResp.text()}\n` +
					'  Is the claudaborative-editing plugin activated?\n' +
					'  Run: npx wp-env run cli wp plugin activate claudaborative-editing'
			);
		}
		const pluginStatus = await pluginResp.json();
		log(
			`  Plugin endpoint: OK (v${(pluginStatus as { version: string }).version})`
		);
	} catch (e) {
		fail(
			`Plugin status check failed: ${e instanceof Error ? e.message : String(e)}`
		);
	}

	// 4. Connect the MCP session manager
	log('Connecting MCP session...');
	const session = new SessionManager();

	// Capture channel notifications
	const notifications: Array<{
		content: string;
		meta: Record<string, string>;
	}> = [];
	const notifier: ChannelNotifier = async (params) => {
		notifications.push(params);
	};
	session.setChannelNotifier(notifier);

	try {
		await session.connect({
			siteUrl: WP_BASE_URL,
			username: WP_USER,
			appPassword,
		});
	} catch (e) {
		fail(
			`MCP connect failed: ${e instanceof Error ? e.message : String(e)}`
		);
	}
	log('MCP connected.');

	// 5. Check plugin detection
	const pluginInfo = session.getPluginInfo();
	if (!pluginInfo) {
		fail(
			'Plugin not detected! The claudaborative-editing plugin may not be activated.\n' +
				'  Run: npx wp-env run cli wp plugin activate claudaborative-editing'
		);
	}
	log(
		`Plugin detected: v${pluginInfo.version}, protocol v${pluginInfo.protocolVersion}, transport: ${pluginInfo.transport}`
	);

	// 6. Create a draft post to target
	log('Creating draft post...');
	const post = await apiFetch<{ id: number; title: { raw: string } }>(
		'/wp/v2/posts',
		appPassword,
		{
			method: 'POST',
			body: JSON.stringify({
				title: `Smoke test ${new Date().toISOString()}`,
				status: 'draft',
			}),
		}
	);
	log(`Created post #${post.id}: "${post.title.raw}"`);

	// 7. Submit a command via the plugin REST API (simulating the browser)
	log('Submitting "review" command via plugin REST API...');
	const command = await apiFetch<{
		id: number;
		status: string;
		prompt: string;
	}>('/wpce/v1/commands', appPassword, {
		method: 'POST',
		body: JSON.stringify({
			post_id: post.id,
			prompt: 'review',
			arguments: {},
		}),
	});
	log(`Command #${command.id} created with status "${command.status}"`);

	if (command.status !== 'pending') {
		fail(`Expected status "pending", got "${command.status}"`);
	}

	// 8. Wait for the command to be claimed by the MCP listener
	log('Waiting for MCP to claim the command...');
	const deadline = Date.now() + 15_000;
	let claimed = false;

	while (Date.now() < deadline) {
		const updated = await apiFetch<{ id: number; status: string }>(
			`/wpce/v1/commands?post_id=${post.id}`,
			appPassword
		).then((cmds) => {
			const list = cmds as unknown as Array<{
				id: number;
				status: string;
			}>;
			return list.find((c) => c.id === command.id);
		});

		if (updated && updated.status === 'claimed') {
			claimed = true;
			break;
		}

		await new Promise((resolve) => setTimeout(resolve, 500));
	}

	if (!claimed) {
		fail(
			'Command was not claimed within 15 seconds.\n' +
				`  Transport: ${pluginInfo.transport}\n` +
				'  The command listener may not be receiving events.'
		);
	}
	log('Command claimed by MCP!');

	// 9. Check the channel notification was dispatched
	if (notifications.length === 0) {
		// Give it a moment — the notification is async
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}

	if (notifications.length > 0) {
		const n = notifications[0];
		log(`Channel notification received:`);
		log(`  content: ${n.content}`);
		log(`  meta: ${JSON.stringify(n.meta)}`);

		if (n.meta.command_id !== String(command.id)) {
			fail(
				`Notification command_id mismatch: expected "${command.id}", got "${n.meta.command_id}"`
			);
		}
		if (n.meta.prompt !== 'review') {
			fail(
				`Notification prompt mismatch: expected "review", got "${n.meta.prompt}"`
			);
		}
		if (n.meta.post_id !== String(post.id)) {
			fail(
				`Notification post_id mismatch: expected "${post.id}", got "${n.meta.post_id}"`
			);
		}
	} else {
		log(
			'WARNING: No channel notification received (may be a timing issue).'
		);
	}

	// 10. Test wp_update_command_status
	log('Testing status update (running → completed)...');
	try {
		await session.updateCommandStatus(command.id, 'running');
		log('  Set to "running".');
		await session.updateCommandStatus(
			command.id,
			'completed',
			'Smoke test passed!'
		);
		log('  Set to "completed".');
	} catch (e) {
		fail(
			`Status update failed: ${e instanceof Error ? e.message : String(e)}`
		);
	}

	// Verify final state
	const finalCmd = await apiFetch<
		Array<{ id: number; status: string; message: string }>
	>(`/wpce/v1/commands?post_id=${post.id}`, appPassword).then((cmds) =>
		cmds.find((c) => c.id === command.id)
	);

	if (finalCmd?.status !== 'completed') {
		fail(`Expected final status "completed", got "${finalCmd?.status}"`);
	}
	if (finalCmd?.message !== 'Smoke test passed!') {
		fail(
			`Expected message "Smoke test passed!", got "${finalCmd?.message}"`
		);
	}
	log('Status updates verified in WordPress.');

	// 11. Clean up
	log('Cleaning up...');
	await session.disconnect();
	await apiFetch(`/wp/v2/posts/${post.id}?force=true`, appPassword, {
		method: 'DELETE',
	});
	log('Done.');

	console.log('\n  ALL CHECKS PASSED\n');
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
