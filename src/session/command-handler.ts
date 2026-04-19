/**
 * Command handler: manages the lifecycle of the command listener
 * and dispatches channel notifications to Claude Code when commands
 * arrive from the WordPress editor plugin.
 *
 * Lifecycle:
 *   start(apiClient, commandMap) → detect plugin → observe Y.Map
 *   stop()                       → stop observation → clean up
 */

import * as Y from 'yjs';
import {
	CommandClient,
	SUPPORTED_PROTOCOL_VERSIONS,
	isProtocolCompatible,
} from '../wordpress/command-client.js';
import { WordPressApiError } from '../wordpress/api-client.js';
import type { WordPressApiClient } from '../wordpress/api-client.js';
import { COMMANDS } from '../../shared/commands.js';
import type { CommandStatus } from '../../shared/commands.js';
import type {
	Command,
	PluginStatus,
	CommandTransport,
} from '../wordpress/command-client.js';
import type { WPNote } from '../wordpress/types.js';
import {
	formatNotes,
	buildProofreadContent,
	buildEditContent,
	buildReviewContent,
	buildRespondToNotesContent,
	buildRespondToNoteContent,
	buildTranslateContent,
	buildComposeContent,
	buildPrePublishCheckContent,
	type LanguageContext,
} from '../prompts/prompt-content.js';

/** Callback for sending channel notifications to Claude Code. */
export type ChannelNotifier = (params: {
	content: string;
	meta: Record<string, string>;
}) => Promise<void>;

/** Callback to pre-open a post before notification dispatch. */
export type PreOpenHandler = (postId: number) => Promise<void>;

/** Snapshot of post content and metadata for embedding in notifications. */
export interface ContentSnapshot {
	postId: number;
	postContent: string;
	notes?: { notes: WPNote[]; noteBlockMap: Partial<Record<number, string>> };
	notesSupported: boolean;
	/**
	 * Confirmed document language for this post, if the agent has
	 * previously clarified it (either this session or a prior one —
	 * the value lives in post meta). Injected into prompt content so
	 * the agent can skip language clarification on repeat commands.
	 */
	confirmedLanguage?: string;
}

/**
 * Provider that returns a content snapshot for the currently-open post,
 * or null if the post is not ready (not pre-opened).
 */
export type ContentProvider = () => Promise<ContentSnapshot | null>;

/** Strip HTML tags and normalize whitespace to produce plain text. */
function stripHtml(html: string): string {
	return html
		.replace(/<[^>]*>/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

export class CommandHandler {
	private commandClient: CommandClient | null = null;
	private _pluginStatus: PluginStatus | null = null;
	private _protocolWarning: string | null = null;
	private pendingNotifications: Array<{
		content: string;
		meta: Record<string, string>;
	}> = [];
	private notifier: ChannelNotifier | null = null;
	private preOpenHandler: PreOpenHandler | null = null;
	private contentProvider: ContentProvider | null = null;
	/** Connected user's ID — commands from other users are ignored. */
	private _userId: number | null = null;

	/**
	 * Whether the MCP client has been verified as channel-capable.
	 * Set to true after the first successful updateCommandStatus call
	 * (which can only happen in response to a channel notification).
	 * Once verified, commands are auto-claimed before notification.
	 */
	private _channelsVerified = false;

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
	 * Set the pre-open handler for open-post commands.
	 * Called to pre-open a post before sending the notification.
	 */
	setPreOpenHandler(handler: PreOpenHandler): void {
		this.preOpenHandler = handler;
	}

	/**
	 * Set the connected user's ID. Commands from other users are ignored.
	 */
	setUserId(userId: number): void {
		this._userId = userId;
	}

	/**
	 * Set the content provider for embedding post content in notifications.
	 * Called from the session manager to provide access to readPost/listNotes.
	 */
	setContentProvider(provider: ContentProvider): void {
		this.contentProvider = provider;
	}

	/**
	 * Detect the WordPress editor plugin and start observing the command Y.Map.
	 *
	 * @param apiClient  The WordPress API client.
	 * @param commandMap The commands Y.Map from the command Y.Doc.
	 * @returns true if the plugin was detected. When the protocol version is
	 *   incompatible, returns true (plugin detected) but does not start
	 *   observation — check `getProtocolWarning()` for details.
	 * @throws if the plugin status request fails for reasons other than 404.
	 */
	async start(
		apiClient: WordPressApiClient,
		commandMap: Y.Map<unknown>
	): Promise<boolean> {
		const client = new CommandClient(
			apiClient,
			(command) => void this.handleCommand(command),
			(command) => void this.handleResponse(command)
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
			// Plugin is detected but incompatible — don't start observation
			return true;
		}

		this.commandClient = client;

		// Start observing the Y.Map for commands from the browser.
		client.startObserving(commandMap);

		return true;
	}

	/**
	 * Stop observing commands and clean up.
	 */
	stop(): void {
		if (this.commandClient) {
			this.commandClient.stop();
			this.commandClient = null;
		}
		this._pluginStatus = null;
		this._protocolWarning = null;
		this._channelsVerified = false;
		this._userId = null;
		this.pendingNotifications = [];
	}

	/**
	 * Update a command's status (called by the wp_update_command_status tool).
	 * Also writes the updated command to the Y.Doc so the browser sees it.
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

		// If Claude called this, channels are working. Future commands
		// can be auto-claimed without waiting for Claude to claim them.
		if (!this._channelsVerified) {
			this._channelsVerified = true;
		}
	}

	/**
	 * Whether channels have been verified (for testing/status reporting).
	 */
	get channelsVerified(): boolean {
		return this._channelsVerified;
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
	 * Extract the universal locale metadata that the WP plugin merges into
	 * every command's arguments, plus the snapshot's confirmed language
	 * if the agent has already clarified it. Returns an empty object if
	 * nothing is known — prompt builders tolerate that.
	 */
	private extractLanguageContext(
		command: Command,
		snapshot: ContentSnapshot
	): LanguageContext {
		const lang: LanguageContext = {};
		const userLocale = command.arguments.userLocale;
		const siteLocale = command.arguments.siteLocale;
		if (typeof userLocale === 'string' && userLocale) {
			lang.userLocale = userLocale;
		}
		if (typeof siteLocale === 'string' && siteLocale) {
			lang.siteLocale = siteLocale;
		}
		if (snapshot.confirmedLanguage) {
			lang.confirmedLanguage = snapshot.confirmedLanguage;
		}
		return lang;
	}

	/**
	 * Build embedded notification content for a command, or return null
	 * if the content provider is not available or the post isn't ready.
	 */
	private async buildEmbeddedContent(
		command: Command
	): Promise<string | null> {
		if (!this.contentProvider) return null;

		const snapshot = await this.contentProvider();
		if (!snapshot) return null;

		// Verify the snapshot matches the command's target post.
		if (snapshot.postId !== command.post_id) return null;

		const { postContent, notes, notesSupported } = snapshot;
		const lang = this.extractLanguageContext(command, snapshot);

		switch (command.prompt) {
			case 'proofread':
				return buildProofreadContent(postContent, lang);
			case 'edit': {
				const editingFocus = command.arguments.editingFocus;
				if (typeof editingFocus !== 'string' || !editingFocus) {
					return null; // Required argument missing — fall back to non-embedded.
				}
				return buildEditContent(postContent, editingFocus, lang);
			}
			case 'review':
				return buildReviewContent(postContent, notesSupported, lang);
			case 'respond-to-notes': {
				if (!notes || notes.notes.length === 0) return null;
				const formatted = formatNotes(notes.notes, notes.noteBlockMap);
				return buildRespondToNotesContent(postContent, formatted, lang);
			}
			case 'respond-to-note': {
				if (!notes) return null;
				const noteId = Number(command.arguments.noteId);
				const targetNote = notes.notes.find((n) => n.id === noteId);
				if (!targetNote) return null;
				// Collect the target note and all descendants (not just
				// direct children) so formatNotes can render the full thread.
				const relevantIds = new Set<number>([noteId]);
				let changed = true;
				while (changed) {
					changed = false;
					for (const n of notes.notes) {
						if (
							!relevantIds.has(n.id) &&
							relevantIds.has(n.parent)
						) {
							relevantIds.add(n.id);
							changed = true;
						}
					}
				}
				const relevantNotes = notes.notes.filter((n) =>
					relevantIds.has(n.id)
				);
				const relevantMap: Partial<Record<number, string>> = {};
				const blockIdx = notes.noteBlockMap[noteId];
				if (blockIdx !== undefined) {
					relevantMap[noteId] = blockIdx;
				}
				const formatted = formatNotes(relevantNotes, relevantMap);
				return buildRespondToNoteContent(postContent, formatted, lang);
			}
			case 'translate': {
				const language = command.arguments.language;
				if (typeof language !== 'string' || !language) {
					return null; // Required argument missing — fall back to non-embedded.
				}
				return buildTranslateContent(postContent, language, lang);
			}
			case 'compose':
				return buildComposeContent(postContent, notesSupported, lang);
			case 'pre-publish-check':
				return buildPrePublishCheckContent(postContent, lang);
			default:
				return null;
		}
	}

	/**
	 * Handle a response from the user on an in-progress command.
	 * Extracts conversation messages from result_data and sends a
	 * channel notification so Claude Code can continue the conversation.
	 */
	private async handleResponse(command: Command): Promise<void> {
		if (!this.commandClient) return;
		if (this._userId !== null && command.user_id !== this._userId) return;

		// Extract conversation messages from result_data
		const messages = command.result_data?.messages;

		// Find the last user message from result_data, or fall back to
		// the command's message field (which the /respond endpoint sets).
		let userContent = '(no message)';
		if (Array.isArray(messages)) {
			const typed = messages as Array<{ role: string; content: string }>;
			for (let i = typed.length - 1; i >= 0; i--) {
				if (
					typed[i].role === 'user' &&
					typeof typed[i].content === 'string'
				) {
					userContent = typed[i].content;
					break;
				}
			}
		}
		if (userContent === '(no message)' && command.message) {
			userContent = command.message;
		}

		const meta: Record<string, string> = {
			command_id: String(command.id),
			prompt: command.prompt,
			post_id: String(command.post_id),
			event_type: 'response',
		};

		const userLocale = command.arguments.userLocale;
		if (typeof userLocale === 'string' && userLocale) {
			meta.user_locale = userLocale;
		}

		if (messages) {
			meta.messages = JSON.stringify(messages);
		}
		const notification = {
			content: `User responded to ${command.prompt} command #${command.id}: "${stripHtml(userContent)}"`,
			meta,
		};

		// Send or buffer the notification
		if (this.notifier) {
			try {
				await this.notifier(notification);
			} catch {
				console.error(
					`Failed to send response notification for command ${command.id}`
				);
			}
		} else {
			this.pendingNotifications.push(notification);
		}
	}

	/**
	 * Handle an incoming command. When channels have been verified,
	 * auto-claims the command (pending→running) before sending the
	 * notification so Claude can start immediately without calling
	 * wp_update_command_status. Otherwise, sends the notification
	 * without claiming (the legacy path).
	 */
	private async handleCommand(command: Command): Promise<void> {
		if (!this.commandClient) return;
		if (this._userId !== null && command.user_id !== this._userId) return;

		// For open-post commands, pre-open the post before sending the
		// notification so it's ready when a real command arrives.
		if (command.prompt === 'open-post' && this.preOpenHandler) {
			try {
				await this.preOpenHandler(command.post_id);
			} catch {
				// Pre-open failed — continue with notification anyway.
			}
		}

		// Auto-claim if channels are verified. Signal commands (e.g., open-post)
		// skip auto-claim since they can't transition pending → running.
		// Use `in` check to safely handle unknown prompts from Y.Map deserialization.
		const isSignal =
			command.prompt in COMMANDS &&
			COMMANDS[command.prompt].signal === true;
		let autoClaimed = false;
		if (this._channelsVerified && !isSignal) {
			try {
				await this.commandClient.updateCommandStatus(
					command.id,
					'running'
				);
				autoClaimed = true;
			} catch (error) {
				if (
					error instanceof WordPressApiError &&
					error.status === 409
				) {
					// Another instance already claimed it — skip notification.
					return;
				}
				// Other error — fall through to manual claim path.
			}
		}

		// Try to build embedded content (includes post content + instructions).
		let embeddedContent: string | null = null;
		try {
			embeddedContent = await this.buildEmbeddedContent(command);
		} catch {
			// Content building failed — fall back to minimal notification.
		}

		// Build the notification
		const argsEntries = Object.entries(command.arguments);

		const meta: Record<string, string> = {
			command_id: String(command.id),
			prompt: command.prompt,
			post_id: String(command.post_id),
		};

		const userLocale = command.arguments.userLocale;
		if (typeof userLocale === 'string' && userLocale) {
			meta.user_locale = userLocale;
		}

		if (argsEntries.length > 0) {
			meta.arguments = JSON.stringify(command.arguments);
		}

		if (autoClaimed) {
			meta.status = 'already_claimed';
		}

		let content: string;
		if (embeddedContent) {
			content = embeddedContent;
			meta.content_embedded = 'true';
		} else {
			let argsDescription = '';
			if (argsEntries.length > 0) {
				const parts = argsEntries.map(
					([key, value]) => `${key}: ${String(value)}`
				);
				argsDescription = ` Arguments: ${parts.join(', ')}.`;
			}
			content = `User requested: ${command.prompt} on post #${command.post_id}.${argsDescription}`;
		}

		const notification = { content, meta };

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
