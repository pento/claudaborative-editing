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

// --- Builder functions ---

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
});

describe('buildReviewContent', () => {
	it('returns notes-based instructions when notes supported', () => {
		const result = buildReviewContent('Hello world', true);
		expect(result).toContain('Hello world');
		expect(result).toContain('wp_add_note');
		expect(result).toContain('same language as the post content');
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
