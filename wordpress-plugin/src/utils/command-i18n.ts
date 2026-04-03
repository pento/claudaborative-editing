/**
 * Command i18n helpers.
 *
 * Wraps shared command metadata with WordPress i18n functions.
 * All __() calls use string literals so makepot can extract them.
 */

import { __ } from '@wordpress/i18n';
import type { CommandSlug } from '#shared/commands';

interface CommandStrings {
	label: string;
	description: string;
	progressLabel: string;
}

/**
 * Translated command strings, keyed by command slug.
 *
 * Each string is wrapped in `__()` with a literal so that
 * the WordPress makepot babel plugin can extract them for translation.
 */
function getStrings(): Record<CommandSlug, CommandStrings> {
	return {
		proofread: {
			label: __('Proofread', 'claudaborative-editing'),
			description: __(
				'Fix grammar, spelling, and punctuation',
				'claudaborative-editing'
			),
			progressLabel: __('Proofreading\u2026', 'claudaborative-editing'),
		},
		review: {
			label: __('Review', 'claudaborative-editing'),
			description: __(
				'Leave editorial notes on the post',
				'claudaborative-editing'
			),
			progressLabel: __('Reviewing\u2026', 'claudaborative-editing'),
		},
		'respond-to-notes': {
			label: __('Address All Notes', 'claudaborative-editing'),
			description: __(
				'Address existing editorial notes',
				'claudaborative-editing'
			),
			progressLabel: __(
				'Responding to notes\u2026',
				'claudaborative-editing'
			),
		},
		'respond-to-note': {
			label: __('Address This Note', 'claudaborative-editing'),
			description: __(
				'Address a single editorial note',
				'claudaborative-editing'
			),
			progressLabel: __(
				'Responding to note\u2026',
				'claudaborative-editing'
			),
		},
		edit: {
			label: __('Edit', 'claudaborative-editing'),
			description: __(
				'Edit with an optional editing focus',
				'claudaborative-editing'
			),
			progressLabel: __('Editing\u2026', 'claudaborative-editing'),
		},
		translate: {
			label: __('Translate', 'claudaborative-editing'),
			description: __(
				'Translate post content into another language',
				'claudaborative-editing'
			),
			progressLabel: __('Translating\u2026', 'claudaborative-editing'),
		},
	};
}

/**
 * Get the translated label for a command slug.
 *
 * @param slug Command slug.
 */
export function getCommandLabel(slug: CommandSlug): string {
	return getStrings()[slug]?.label ?? slug;
}

/**
 * Get the translated description for a command slug.
 *
 * @param slug Command slug.
 */
export function getCommandDescription(slug: CommandSlug): string {
	return getStrings()[slug]?.description ?? '';
}

/**
 * Get the translated progress label for a command slug.
 *
 * @param slug Command slug.
 */
export function getCommandProgressLabel(slug: CommandSlug): string {
	return (
		getStrings()[slug]?.progressLabel ??
		__('Working\u2026', 'claudaborative-editing')
	);
}
