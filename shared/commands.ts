/**
 * Shared command definitions.
 *
 * Single source of truth for command slugs, arguments, statuses, and metadata.
 * Consumed by: MCP server (TS), WP plugin (TS), WP plugin (PHP via generated file).
 */

// --- Command types ---

export type CommandSlug =
	| 'proofread'
	| 'review'
	| 'respond-to-notes'
	| 'respond-to-note'
	| 'edit'
	| 'translate'
	| 'pre-publish-check';

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
}

// --- Command definitions ---

export const COMMANDS: Record<CommandSlug, CommandDefinition> = {
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
	| 'cancelled';

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
	running: ['completed', 'failed'],
} as const;
