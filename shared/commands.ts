/**
 * Shared command definitions.
 *
 * Single source of truth for command slugs, arguments, statuses, and metadata.
 * Consumed by: MCP server (TS), WP plugin (TS), WP plugin (PHP via generated file).
 */

// --- Command types ---

export type CommandSlug =
	| 'open-post'
	| 'proofread'
	| 'review'
	| 'respond-to-notes'
	| 'respond-to-note'
	| 'edit'
	| 'translate'
	| 'pre-publish-check'
	| 'compose';

export interface CommandArgDef {
	type: 'string' | 'number';
	required: boolean;
	description: string;
}

export interface CommandDefinition {
	slug: CommandSlug;
	label: string;
	description: string;
	progressLabel: string;
	args: Record<string, CommandArgDef>;
	/** Override the auto-generated channel instruction hint for this command. */
	channelHint?: string;
	/**
	 * Signal commands are internal lifecycle signals (e.g., open-post) that
	 * skip active command state in the UI, don't block user actions, and
	 * can transition directly from pending to completed.
	 */
	signal?: boolean;
}

// --- Command definitions ---

export const COMMANDS: Record<CommandSlug, CommandDefinition> = {
	'open-post': {
		slug: 'open-post',
		label: 'Open Post',
		description: 'Signal that a post was opened in the editor',
		progressLabel: 'Connecting\u2026',
		args: {},
		signal: true,
		channelHint:
			'"open-post" (Post opened in the editor — the post is already loaded. Just call wp_update_command_status with status "completed" to acknowledge.)',
	},
	proofread: {
		slug: 'proofread',
		label: 'Proofread',
		description: 'Fix grammar, spelling, and punctuation',
		progressLabel: 'Proofreading\u2026',
		args: {},
	},
	review: {
		slug: 'review',
		label: 'Review',
		description: 'Leave editorial notes on the post',
		progressLabel: 'Reviewing\u2026',
		args: {},
	},
	'respond-to-notes': {
		slug: 'respond-to-notes',
		label: 'Address All Notes',
		description: 'Address existing editorial notes',
		progressLabel: 'Responding to notes\u2026',
		args: {},
	},
	'respond-to-note': {
		slug: 'respond-to-note',
		label: 'Address This Note',
		description: 'Address a single editorial note',
		progressLabel: 'Responding to note\u2026',
		args: {
			noteId: {
				type: 'number',
				required: true,
				description: 'The ID of the note to address',
			},
		},
	},
	edit: {
		slug: 'edit',
		label: 'Edit',
		description: 'Make broad editorial changes to the post',
		progressLabel: 'Editing\u2026',
		args: {
			editingFocus: {
				type: 'string',
				required: true,
				description:
					'A brief description of the editing focus or intent (e.g. "Make it more formal", "Fix grammar and spelling", "Improve the flow"). This is used to guide the AI and provide context for human reviewers.',
			},
		},
	},
	translate: {
		slug: 'translate',
		label: 'Translate',
		description: 'Translate post content into another language',
		progressLabel: 'Translating\u2026',
		args: {
			language: {
				type: 'string',
				required: true,
				description: 'Target language',
			},
		},
	},
	'pre-publish-check': {
		slug: 'pre-publish-check',
		label: 'Pre-Publish Check',
		description: 'Suggest metadata improvements before publishing',
		progressLabel: 'Checking\u2026',
		args: {},
		channelHint:
			'"pre-publish-check" (Read-only metadata check — suggest excerpt, categories, tags, and slug. Do NOT add notes, edit blocks, or call any tool except wp_update_command_status. Return suggestions as JSON in the resultData parameter.)',
	},
	compose: {
		slug: 'compose',
		label: 'Compose',
		description: 'Plan and outline a post through guided conversation',
		progressLabel: 'Composing\u2026',
		args: {},
		channelHint:
			'"compose" (Multi-turn composing — ask questions to understand the post purpose, audience, and key points, then propose an outline. Use awaiting_input status to ask follow-up questions. When the user approves the outline, scaffold the post with section headings and editorial notes describing what to write in each section. Do NOT write the actual post content.)',
	},
};

export const COMMAND_SLUGS: CommandSlug[] = Object.keys(
	COMMANDS
) as CommandSlug[];

// --- Command statuses ---

export type CommandStatus =
	| 'pending'
	| 'running'
	| 'completed'
	| 'failed'
	| 'expired'
	| 'cancelled'
	| 'awaiting_input';

export const TERMINAL_STATUSES: readonly CommandStatus[] = [
	'completed',
	'failed',
	'cancelled',
	'expired',
] as const;

export const VALID_TRANSITIONS: Readonly<
	Partial<Record<CommandStatus, readonly CommandStatus[]>>
> = {
	pending: ['running'],
	running: ['completed', 'failed', 'awaiting_input'],
	awaiting_input: ['running', 'cancelled'],
} as const;

// --- Y.Doc schema ---

/**
 * Prefix for per-command keys in the shared command state map. Each
 * command lives at `cmd_${id}` as an individual Y.Map entry rather than
 * packed into a single `commands` object — Y.Map tiebreaks can otherwise
 * silently pick one client's write and discard another's when they both
 * set the same key.
 */
export const COMMAND_KEY_PREFIX = 'cmd_';
export const commandKey = (id: number | string): string =>
	`${COMMAND_KEY_PREFIX}${id}`;
export const isCommandKey = (key: string): boolean =>
	key.startsWith(COMMAND_KEY_PREFIX);

// --- Conversation types ---

/** A single message in a two-way command conversation. */
export interface ConversationMessage {
	role: 'assistant' | 'user';
	content: string;
	timestamp: string; // ISO 8601
}
