/**
 * Type definitions for the AI Actions store.
 */

import type {
	CommandSlug,
	CommandStatus,
	ConversationMessage,
} from '#shared/commands';

export type { ConversationMessage } from '#shared/commands';

/** Structured suggestions returned by the pre-publish-check command. */
export interface PrePublishSuggestions {
	/** Suggested excerpt text (omitted if current excerpt is fine). */
	excerpt?: string;
	/** Suggested category names to assign (omitted if current categories are fine). */
	categories?: string[];
	/** Suggested tag names to assign (omitted if current tags are fine). */
	tags?: string[];
	/** Suggested slug (omitted if current slug is fine). */
	slug?: string;
}

export interface ConversationResultData {
	messages: ConversationMessage[];
	input_prompt?: string;
}

export interface Command {
	id: number;
	post_id: number;
	prompt: CommandSlug;
	status: CommandStatus;
	arguments: Record<string, unknown>;
	message: string | null;
	result_data: Record<string, unknown> | null;
}

export interface McpStatus {
	mcpConnected: boolean;
	mcpLastSeenAt: string | null;
	version: string | null;
	protocolVersion: number | null;
	isLoading: boolean;
	error: string | null;
}

export interface CommandsState {
	active: Command | null;
	history: Command[];
	isSubmitting: boolean;
	isResponding: boolean;
	error: string | null;
}

export interface StoreState {
	status: McpStatus;
	commands: CommandsState;
}

export interface StatusApiResponse {
	mcp_connected: boolean;
	mcp_last_seen_at: string | null;
	version: string | null;
	protocol_version: number | null;
}

// Discriminated union for all store actions
export type StoreAction =
	| {
			type: 'SET_STATUS';
			mcpConnected: boolean;
			mcpLastSeenAt: string | null;
			version: string | null;
			protocolVersion: number | null;
	  }
	| { type: 'SET_STATUS_LOADING'; isLoading: boolean }
	| { type: 'SET_STATUS_ERROR'; error: string }
	| { type: 'SUBMIT_COMMAND_START' }
	| { type: 'SUBMIT_COMMAND_SUCCESS'; command: Command }
	| { type: 'SUBMIT_COMMAND_ERROR'; error: string }
	| { type: 'UPDATE_ACTIVE_COMMAND'; command: Command }
	| { type: 'CLEAR_ACTIVE_COMMAND'; command?: Command }
	| { type: 'SET_COMMAND_HISTORY'; history: Command[] }
	| { type: 'RESPOND_START' }
	| { type: 'RESPOND_ERROR'; error: string };
