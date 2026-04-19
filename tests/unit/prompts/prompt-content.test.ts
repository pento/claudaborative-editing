import { describe, it, expect } from 'vitest';
import type { WPNote } from '../../../src/wordpress/types.js';
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
	buildProofreadSegments,
	buildEditSegments,
	buildReviewSegments,
	buildRespondToNotesSegments,
	buildRespondToNoteSegments,
	buildTranslateSegments,
	buildComposeSegments,
	buildPrePublishCheckSegments,
	DOCUMENT_LANGUAGE_RULE,
	joinSegments,
} from '../../../src/prompts/prompt-content.js';

// --- formatNotes ---

describe('formatNotes', () => {
	const fakeNote: WPNote = {
		id: 1,
		post: 42,
		parent: 0,
		author: 1,
		author_name: 'Gary',
		date: '2025-01-01T00:00:00',
		content: { rendered: '<p>Test note</p>', raw: 'Test note' },
		status: 'approved',
		type: 'note',
	};

	it('formats a top-level note with block mapping', () => {
		const result = formatNotes([fakeNote], { 1: '0' });
		expect(result).toContain('Note #1 by Gary (block [0])');
		expect(result).toContain('"Test note"');
	});

	it('marks unlinked notes', () => {
		const result = formatNotes([fakeNote], {});
		expect(result).toContain('(unlinked)');
	});

	it('formats nested replies', () => {
		const reply: WPNote = {
			...fakeNote,
			id: 2,
			parent: 1,
			author_name: 'Alice',
			content: { rendered: '<p>Reply text</p>', raw: 'Reply text' },
		};
		const result = formatNotes([fakeNote, reply], { 1: '0' });
		expect(result).toContain('Reply #2 by Alice');
		expect(result).toContain('"Reply text"');
	});

	it('strips HTML when raw is not available', () => {
		const noteNoRaw: WPNote = {
			...fakeNote,
			content: { rendered: '<p>Rendered <strong>text</strong></p>' },
		};
		const result = formatNotes([noteNoRaw], { 1: '0' });
		expect(result).toContain('"Rendered text"');
	});
});

// --- Builder functions (string form) ---

describe('buildProofreadContent', () => {
	it('includes post content and proofreading instructions', () => {
		const result = buildProofreadContent('Hello world');
		expect(result).toContain('Hello world');
		expect(result).toContain('grammar');
		expect(result).toContain('wp_edit_block_text');
		expect(result).toContain('Do NOT change the meaning');
		expect(result).toContain('Do NOT add or remove blocks');
		expect(result).toContain('wp_save');
	});
});

describe('buildEditContent', () => {
	it('includes post content, focus, and tool list', () => {
		const result = buildEditContent('Hello world', 'improve clarity');
		expect(result).toContain('Hello world');
		expect(result).toContain('Focus on: improve clarity');
		expect(result).toContain('wp_update_block');
		expect(result).toContain('wp_insert_block');
		expect(result).toContain('wp_save');
	});

	it('mentions wp_view_post for cross-post research', () => {
		const result = buildEditContent('Hello world', 'improve clarity');
		expect(result).toContain('wp_view_post');
	});
});

describe('buildReviewContent', () => {
	it('returns notes-based instructions when notes supported', () => {
		const result = buildReviewContent('Hello world', true);
		expect(result).toContain('Hello world');
		expect(result).toContain('wp_add_note');
		expect(result).toContain(DOCUMENT_LANGUAGE_RULE);
		expect(result).not.toContain('does not support notes');
	});

	it('returns text summary fallback when notes not supported', () => {
		const result = buildReviewContent('Hello world', false);
		expect(result).toContain('Hello world');
		expect(result).toContain('does not support notes');
		expect(result).toContain('text summary');
		expect(result).not.toContain('wp_add_note');
	});
});

describe('buildRespondToNotesContent', () => {
	it('includes post content, notes, and resolution instructions', () => {
		const result = buildRespondToNotesContent(
			'Hello world',
			'Note #1 by Gary (block [0])\n  "Fix typo"'
		);
		expect(result).toContain('Hello world');
		expect(result).toContain('Note #1 by Gary');
		expect(result).toContain('wp_resolve_note');
		expect(result).toContain('wp_save');
	});
});

describe('buildRespondToNoteContent', () => {
	it('includes post content, note, and resolution instructions', () => {
		const result = buildRespondToNoteContent(
			'Hello world',
			'Note #5 by Alice (block [2])\n  "Clarify this"'
		);
		expect(result).toContain('Hello world');
		expect(result).toContain('Note #5 by Alice');
		expect(result).toContain('wp_resolve_note');
		expect(result).toContain('wp_save');
	});
});

describe('buildTranslateContent', () => {
	it('includes post content, language, and translation instructions', () => {
		const result = buildTranslateContent('Hello world', 'Japanese');
		expect(result).toContain('Hello world');
		expect(result).toContain('Japanese');
		expect(result).toContain('wp_set_title');
		expect(result).toContain('wp_set_excerpt');
		expect(result).toContain('Do NOT add, remove, or reorder blocks');
	});

	it("reminds the model to confirm the post's source language when ambiguous", () => {
		const result = buildTranslateContent('Hi', 'Japanese');
		expect(result).toContain("source language isn't obvious");
		expect(result).toContain('awaiting_input');
	});
});

describe('buildComposeContent', () => {
	it('includes compose workflow with notes when supported', () => {
		const result = buildComposeContent('Hello world', true);
		expect(result).toContain('Hello world');
		expect(result).toContain('awaiting_input');
		expect(result).toContain('outline');
		expect(result).toContain('wp_add_note');
		expect(result).not.toContain('does not support editorial notes');
	});

	it('uses placeholder paragraphs when notes not supported', () => {
		const result = buildComposeContent('Hello world', false);
		expect(result).toContain('does not support editorial notes');
		expect(result).toContain('placeholder paragraphs');
		expect(result).not.toContain('wp_add_note');
	});

	it('handles empty post content', () => {
		const result = buildComposeContent('', true);
		expect(result).toContain('new/empty post');
	});

	it('includes conversation protocol', () => {
		const result = buildComposeContent('Hello world', true);
		expect(result).toContain('wp_update_command_status');
		expect(result).toContain('planReady');
	});

	it('mentions cross-post research tools in discovery', () => {
		const result = buildComposeContent('Hello world', true);
		expect(result).toContain('wp_list_posts');
		expect(result).toContain('wp_view_post');
	});
});

describe('buildPrePublishCheckContent', () => {
	it('includes post content and metadata check instructions', () => {
		const result = buildPrePublishCheckContent('Hello world');
		expect(result).toContain('Hello world');
		expect(result).toContain('Excerpt');
		expect(result).toContain('Categories');
		expect(result).toContain('Tags');
		expect(result).toContain('Slug');
		expect(result).toContain('READ-ONLY');
		expect(result).toContain('wp_update_command_status');
		expect(result).toContain('resultData');
	});
});

// --- Segment builders: cache-stable static prefix ---

/**
 * The core guarantee of the segment API: the staticInstructions string
 * is byte-identical regardless of post content, arguments, or locale
 * context. This is what lets a hosted Anthropic orchestrator attach a
 * cache_control marker to the static block and get cache hits across
 * invocations that only differ in the dynamic context.
 */
describe('segment builders produce byte-stable static prefixes', () => {
	it('buildProofreadSegments: static block is stable across varying post content and locale', () => {
		const a = buildProofreadSegments('Post A');
		const b = buildProofreadSegments(
			'Post B that is completely different',
			{
				userLocale: 'fr_FR',
				siteLocale: 'de_DE',
			}
		);
		expect(a.staticInstructions).toBe(b.staticInstructions);
		expect(a.dynamicContext).not.toBe(b.dynamicContext);
	});

	it('buildEditSegments: editingFocus lives in dynamic, not static', () => {
		const a = buildEditSegments('Post', 'tone up');
		const b = buildEditSegments('Post', 'condense intro');
		expect(a.staticInstructions).toBe(b.staticInstructions);
		expect(a.staticInstructions).not.toContain('tone up');
		expect(a.dynamicContext).toContain('tone up');
		expect(b.dynamicContext).toContain('condense intro');
	});

	it('buildReviewSegments: static prefix differs only by notes-support branch', () => {
		const withNotesA = buildReviewSegments('Post A', true);
		const withNotesB = buildReviewSegments('Post B', true);
		const withoutNotesA = buildReviewSegments('Post A', false);
		const withoutNotesB = buildReviewSegments('Post B', false);
		expect(withNotesA.staticInstructions).toBe(
			withNotesB.staticInstructions
		);
		expect(withoutNotesA.staticInstructions).toBe(
			withoutNotesB.staticInstructions
		);
		expect(withNotesA.staticInstructions).not.toBe(
			withoutNotesA.staticInstructions
		);
	});

	it('buildRespondToNotesSegments: formattedNotes lives in dynamic', () => {
		const a = buildRespondToNotesSegments('Post', 'Note #1 "Fix typo"');
		const b = buildRespondToNotesSegments(
			'Post',
			'Note #2 "Clarify this paragraph"'
		);
		expect(a.staticInstructions).toBe(b.staticInstructions);
		expect(a.staticInstructions).not.toContain('Note #1');
	});

	it('buildRespondToNoteSegments: formattedNote lives in dynamic', () => {
		const a = buildRespondToNoteSegments('Post', 'Note #5 "A"');
		const b = buildRespondToNoteSegments('Post', 'Note #7 "B"');
		expect(a.staticInstructions).toBe(b.staticInstructions);
		expect(a.staticInstructions).not.toContain('Note #5');
	});

	it('buildTranslateSegments: target language lives in dynamic, not static', () => {
		const a = buildTranslateSegments('Post', 'French');
		const b = buildTranslateSegments('Post', 'Japanese');
		expect(a.staticInstructions).toBe(b.staticInstructions);
		expect(a.staticInstructions).not.toContain('French');
		expect(a.staticInstructions).not.toContain('Japanese');
		expect(a.dynamicContext).toContain('Target language: French');
		expect(b.dynamicContext).toContain('Target language: Japanese');
	});

	it('buildComposeSegments: static prefix differs only by notes-support branch', () => {
		const a = buildComposeSegments('Post A', true);
		const b = buildComposeSegments('Post B', true);
		expect(a.staticInstructions).toBe(b.staticInstructions);
	});

	it('buildPrePublishCheckSegments: static block is stable across varying post content', () => {
		const a = buildPrePublishCheckSegments('Post A');
		const b = buildPrePublishCheckSegments(
			'Post B with a much longer body'
		);
		expect(a.staticInstructions).toBe(b.staticInstructions);
	});
});

// --- Segment builders: language rules in the static prefix ---

describe('segment builders embed language rules in the static prefix', () => {
	it('content-editing prompts embed the document-language rule in the static block', () => {
		const builders = [
			buildProofreadSegments('x'),
			buildEditSegments('x', 'focus'),
			buildReviewSegments('x', true),
			buildReviewSegments('x', false),
			buildRespondToNotesSegments('x', 'note'),
			buildRespondToNoteSegments('x', 'note'),
			buildComposeSegments('x', true),
			buildComposeSegments('x', false),
			buildPrePublishCheckSegments('x'),
		];
		for (const segments of builders) {
			expect(segments.staticInstructions).toContain(
				DOCUMENT_LANGUAGE_RULE
			);
		}
	});

	it('translate prompt does not embed the document-language rule verbatim (it has target-language-specific guidance instead)', () => {
		const segments = buildTranslateSegments('x', 'French');
		expect(segments.staticInstructions).not.toContain(
			DOCUMENT_LANGUAGE_RULE
		);
		expect(segments.staticInstructions).toContain(
			"source language isn't obvious"
		);
	});

	it('document-language rule tells the model to ask in the user locale', () => {
		// The clarification question is a status-message — it must follow
		// the same locale rule as other wp_update_command_status output.
		// Without this guidance the model might ask in the post's (possibly
		// unknown) language, which defeats the point of asking.
		expect(DOCUMENT_LANGUAGE_RULE).toContain(
			"in the user's locale (meta.user_locale)"
		);
		expect(DOCUMENT_LANGUAGE_RULE).toContain('fallback');
	});

	it('document-language rule treats a prior confirmed language as authoritative', () => {
		// Without this line the agent would re-detect (or worse,
		// re-ask) even though the WP side has already persisted a
		// confirmed language from a prior command.
		expect(DOCUMENT_LANGUAGE_RULE).toContain(
			'"Confirmed document language"'
		);
		expect(DOCUMENT_LANGUAGE_RULE).toContain('authoritative');
	});

	it('document-language rule documents the documentLanguage resultData convention', () => {
		// The persistence loop closes only if the agent actually writes
		// documentLanguage back in resultData after a clarification,
		// so the prompt has to spell this out.
		expect(DOCUMENT_LANGUAGE_RULE).toContain('"documentLanguage"');
		expect(DOCUMENT_LANGUAGE_RULE).toContain('resultData');
		expect(DOCUMENT_LANGUAGE_RULE).toContain('free-form string');
	});
});

// --- Segment builders: locale context flows into dynamic segment ---

describe('segment builders inject locale context into dynamic segment', () => {
	it('injects userLocale and siteLocale when supplied', () => {
		const segments = buildProofreadSegments('Hello', {
			userLocale: 'fr_FR',
			siteLocale: 'en_US',
		});
		expect(segments.dynamicContext).toContain('User locale: fr_FR');
		expect(segments.dynamicContext).toContain('Site locale hint: en_US');
	});

	it('falls back to "unknown" when locale context is absent', () => {
		const segments = buildProofreadSegments('Hello');
		expect(segments.dynamicContext).toContain('User locale: unknown');
		expect(segments.dynamicContext).toContain('Site locale hint: unknown');
	});

	it('treats empty-string locale fields as unknown', () => {
		const segments = buildProofreadSegments('Hello', {
			userLocale: '',
			siteLocale: '   ',
		});
		expect(segments.dynamicContext).toContain('User locale: unknown');
		expect(segments.dynamicContext).toContain('Site locale hint: unknown');
	});

	it('injects the confirmed document language when supplied', () => {
		const segments = buildProofreadSegments('Hello', {
			userLocale: 'fr_FR',
			siteLocale: 'en_US',
			confirmedLanguage: 'Japanese',
		});
		expect(segments.dynamicContext).toContain(
			'Confirmed document language: Japanese'
		);
	});

	it('preserves free-form confirmed-language values', () => {
		const note =
			'Primary language is English, but reviews should cover all languages';
		const segments = buildProofreadSegments('Hello', {
			confirmedLanguage: note,
		});
		expect(segments.dynamicContext).toContain(
			`Confirmed document language: ${note}`
		);
	});

	it('omits the Confirmed document language line when the value is absent or blank', () => {
		const absent = buildProofreadSegments('Hello', { userLocale: 'en_US' });
		const blank = buildProofreadSegments('Hello', {
			userLocale: 'en_US',
			confirmedLanguage: '   ',
		});
		expect(absent.dynamicContext).not.toContain(
			'Confirmed document language'
		);
		expect(blank.dynamicContext).not.toContain(
			'Confirmed document language'
		);
	});

	it('still keeps the static prefix stable when confirmed-language is added', () => {
		// Cache guarantee: only dynamicContext varies across invocations.
		const without = buildProofreadSegments('Hello');
		const withConfirmed = buildProofreadSegments('Hello', {
			confirmedLanguage: 'Spanish',
		});
		expect(without.staticInstructions).toBe(
			withConfirmed.staticInstructions
		);
	});
});

// --- Content builders concatenate segments deterministically ---

describe('string builders concatenate segments deterministically', () => {
	it('buildProofreadContent equals segments joined via joinSegments', () => {
		const segments = buildProofreadSegments('Hello', {
			userLocale: 'fr_FR',
			siteLocale: 'en_US',
		});
		const content = buildProofreadContent('Hello', {
			userLocale: 'fr_FR',
			siteLocale: 'en_US',
		});
		expect(content).toBe(joinSegments(segments));
	});
});

// --- joinSegments ---

describe('joinSegments', () => {
	it('joins the static prefix and dynamic suffix with a blank line', () => {
		const result = joinSegments({
			staticInstructions: 'STATIC',
			dynamicContext: 'DYNAMIC',
		});
		expect(result).toBe('STATIC\n\nDYNAMIC');
	});
});
