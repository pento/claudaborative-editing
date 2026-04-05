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
	SUPPORTED_PROTOCOL_VERSIONS,
	isProtocolCompatible,
} from '../wordpress/command-client.js';
import { WordPressApiError } from '../wordpress/api-client.js';
import type { WordPressApiClient } from '../wordpress/api-client.js';
import type { CommandStatus } from '../../shared/commands.js';
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
	private _protocolWarning: string | null = null;
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
	 * @returns true if the plugin was detected. When the protocol version is
	 *   incompatible, returns true (plugin detected) but does not start the
	 *   command listener — check `getProtocolWarning()` for details.
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

		// Check protocol version compatibility
		if (!isProtocolCompatible(this._pluginStatus.protocol_version)) {
			const pluginV = this._pluginStatus.protocol_version;
			const maxSupported = Math.max(...SUPPORTED_PROTOCOL_VERSIONS);
			const direction =
				pluginV > maxSupported
					? 'Update the MCP server.'
					: 'Update the WordPress plugin.';
			const supported = (SUPPORTED_PROTOCOL_VERSIONS as readonly number[])
				.map((v) => `v${v}`)
				.join(', ');
			this._protocolWarning =
				`Plugin protocol v${pluginV} is not compatible with this MCP server ` +
				`(supports ${supported}). ${direction}`;
			// Plugin is detected but incompatible — don't start the command listener
			return true;
		}

		this.commandClient = client;

		// Start listening (SSE with polling fallback). Await so that
		// transport initialization completes before we report success —
		// SSE resolves after headers arrive, polling resolves after the
		// first timer is scheduled.
		await client.start();

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
		this._protocolWarning = null;
		this.pendingNotifications = [];
	}

	/**
	 * Update a command's status (called by the wp_update_command_status tool).
	 */
	async updateCommandStatus(
		id: number,
		status: CommandStatus,
		message?: string,
		resultData?: string
	): Promise<void> {
		if (!this.commandClient) {
			throw new Error(
				'WordPress editor plugin is not connected. Command features are not available.'
			);
		}
		await this.commandClient.updateCommandStatus(
			id,
			status,
			message,
			resultData
		);
	}

	/**
	 * Plugin status info for wp_status reporting.
	 */
	getPluginStatus(): PluginStatus | null {
		return this._pluginStatus;
	}

	/**
	 * Protocol version incompatibility warning, if any.
	 */
	getProtocolWarning(): string | null {
		return this._protocolWarning;
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
	 * Handle an incoming command: send a channel notification without
	 * claiming. The claim happens when the client calls
	 * `wp_update_command_status("running")`, which performs an atomic
	 * pending→running transition on the WordPress side (409 on conflict).
	 * This way, instances whose clients ignore the notification (e.g.,
	 * channels not enabled) never claim the command.
	 */
	private async handleCommand(command: Command): Promise<void> {
		if (!this.commandClient) return;

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
