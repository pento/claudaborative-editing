import { describe, it, expect } from 'vitest';
import {
	getBaseInstructions,
	getChannelInstructions,
} from '../../src/server-instructions.js';

describe('getBaseInstructions', () => {
	it('steers toward wp_connect when not already connected', () => {
		expect(getBaseInstructions(false)).toContain('wp_connect');
	});

	it('tells the model not to call wp_connect when auto-connected', () => {
		expect(getBaseInstructions(true)).toContain('Do NOT call wp_connect');
	});
});

describe('getChannelInstructions', () => {
	const channel = getChannelInstructions();

	it('documents both the content-embedded and new-command branches', () => {
		expect(channel).toContain('content_embedded');
		expect(channel).toContain('wp_update_command_status');
	});

	it('includes the universal status-message-locale rule', () => {
		expect(channel).toContain('Language for status messages');
		expect(channel).toContain('meta.user_locale');
		expect(channel).toContain("user's locale");
	});

	it('specifies the full fallback chain (user → document → site locale)', () => {
		// The fallback chain has to carve out the case where the
		// document language is itself what's being asked about — a
		// clarification question can't sensibly be written in the
		// language we're asking the user to confirm.
		expect(channel).toContain("document's language");
		expect(channel).toContain('site locale hint');
		expect(channel).toMatch(/document.{0,40}(unknown|clarify)/i);
	});
});
