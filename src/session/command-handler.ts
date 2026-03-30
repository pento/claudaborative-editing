/**
 * Command handler: manages the lifecycle of the command listener
 * and dispatches channel notifications to Claude Code when commands
 * arrive from the WordPress editor plugin.
 *
 * Lifecycle:
 *   start(apiClient) → detect plugin → create CommandClient → listen
 *   stop()           → stop CommandClient → clean up
 */

import {
	CommandClient,
	DEFAULT_COMMAND_CLIENT_CONFIG,
} from '../wordpress/command-client.js';
import { WordPressApiError } from '../wordpress/api-client.js';
import type { WordPressApiClient } from '../wordpress/api-client.js';
import type {
	Command,
	CommandClientConfig,
	PluginStatus,
	CommandTransport,
} from '../wordpress/command-client.js';

/** Callback for sending channel notifications to Claude Code. */
export type ChannelNotifier = (params: {
	content: string;
	meta: Record<string, string>;
}) => Promise<void>;

export class CommandHandler {
	private commandClient: CommandClient | null = null;
	private _pluginStatus: PluginStatus | null = null;
	private pendingNotifications: Array<{
		content: string;
		meta: Record<string, string>;
	}> = [];
	private notifier: ChannelNotifier | null = null;
	private commandClientConfig: CommandClientConfig;

	constructor(config?: Partial<CommandClientConfig>) {
		this.commandClientConfig = {
			...DEFAULT_COMMAND_CLIENT_CONFIG,
			...config,
		};
	}

	/**
	 * Set the channel notifier callback. Flushes any buffered notifications.
	 */
	setNotifier(notifier: ChannelNotifier): void {
		this.notifier = notifier;

		// Flush any notifications that were buffered before the notifier was set
		const pending = this.pendingNotifications.splice(0);
		for (const params of pending) {
			void notifier(params).catch((error: unknown) => {
				console.error(
					'Failed to deliver buffered channel notification:',
					error
				);
			});
		}
	}

	/**
	 * Detect the WordPress editor plugin and start listening for commands.
	 *
	 * @returns true if the plugin was detected and listening started.
	 * @throws if the plugin status request fails for reasons other than 404.
	 */
	async start(apiClient: WordPressApiClient): Promise<boolean> {
		const client = new CommandClient(
			apiClient,
			(command) => void this.handleCommand(command),
			this.commandClientConfig
		);

		// Probe the plugin status endpoint
		try {
			this._pluginStatus = await client.getPluginStatus();
		} catch (error) {
			if (error instanceof WordPressApiError && error.status === 404) {
				// Plugin not installed — not an error
				return false;
			}
			throw error;
		}

		this.commandClient = client;

		// Start listening (SSE with polling fallback) — don't await,
		// it runs in the background.
		void client.start();

		return true;
	}

	/**
	 * Stop listening for commands and clean up.
	 */
	stop(): void {
		if (this.commandClient) {
			this.commandClient.stop();
			this.commandClient = null;
		}
		this._pluginStatus = null;
		this.pendingNotifications = [];
	}

	/**
	 * Update a command's status (called by the wp_update_command_status tool).
	 */
	async updateCommandStatus(
		id: number,
		status: string,
		message?: string
	): Promise<void> {
		if (!this.commandClient) {
			throw new Error(
				'WordPress editor plugin is not connected. Command features are not available.'
			);
		}
		await this.commandClient.updateCommandStatus(id, status, message);
	}

	/**
	 * Plugin status info for wp_status reporting.
	 */
	getPluginStatus(): PluginStatus | null {
		return this._pluginStatus;
	}

	/**
	 * Current transport mode for wp_status reporting.
	 */
	getTransport(): CommandTransport | 'disabled' {
		if (!this.commandClient) return 'disabled';
		return this.commandClient.getTransport();
	}

	// --- Internal ---

	/**
	 * Handle an incoming command: claim it and send a channel notification.
	 */
	private async handleCommand(command: Command): Promise<void> {
		if (!this.commandClient) return;

		// Attempt to claim the command
		try {
			await this.commandClient.claimCommand(command.id);
		} catch (error) {
			// Claim failed — another instance may have claimed it, or it
			// was cancelled/expired. Skip silently.
			if (
				error instanceof WordPressApiError &&
				(error.status === 409 || error.status === 404)
			) {
				return;
			}
			// Other errors — log and skip
			console.error(`Failed to claim command ${command.id}:`, error);
			return;
		}

		// Build the notification
		const argsEntries = Object.entries(command.arguments);
		let argsDescription = '';
		if (argsEntries.length > 0) {
			const parts = argsEntries.map(
				([key, value]) => `${key}: ${String(value)}`
			);
			argsDescription = ` Arguments: ${parts.join(', ')}.`;
		}

		const meta: Record<string, string> = {
			command_id: String(command.id),
			prompt: command.prompt,
			post_id: String(command.post_id),
		};

		if (argsEntries.length > 0) {
			meta.arguments = JSON.stringify(command.arguments);
		}

		const notification = {
			content: `User requested: ${command.prompt} on post #${command.post_id}.${argsDescription}`,
			meta,
		};

		// Send or buffer the notification
		if (this.notifier) {
			try {
				await this.notifier(notification);
			} catch {
				// Notification delivery failed — not much we can do
				console.error(
					`Failed to send channel notification for command ${command.id}`
				);
			}
		} else {
			this.pendingNotifications.push(notification);
		}
	}
}
