import { describe, it, expect, vi } from 'vitest';
import { createMockServer, createMockSession, fakePost } from './helpers.js';
import { registerComposePrompts } from '../../../src/prompts/compose.js';
import { assertDefined } from '../../test-utils.js';

describe('compose', () => {
	describe('when disconnected', () => {
		it('instructs to connect first', async () => {
			const server = createMockServer();
			const session = createMockSession({ state: 'disconnected' });
			registerComposePrompts(server, session);

			const prompt = server.registeredPrompts.get('compose');
			assertDefined(prompt);
			const result = await prompt.handler({});

			expect(result.messages[0].content.text).toContain('wp_connect');
		});
	});

	describe('when connected', () => {
		it('instructs to open a post first', async () => {
			const server = createMockServer();
			const session = createMockSession({ state: 'connected' });
			registerComposePrompts(server, session);

			const prompt = server.registeredPrompts.get('compose');
			assertDefined(prompt);
			const result = await prompt.handler({});

			expect(result.messages[0].content.text).toContain('wp_open_post');
		});
	});

	describe('when editing', () => {
		it('embeds post content and compose instructions', async () => {
			const postContent =
				'Title: "My Great Post"\n\n[0] core/paragraph\n  "Hello world"';
			const server = createMockServer();
			const session = createMockSession({
				state: 'editing',
				post: fakePost,
				postContent,
			});
			registerComposePrompts(server, session);

			const prompt = server.registeredPrompts.get('compose');
			assertDefined(prompt);
			const result = await prompt.handler({});

			const text = result.messages[0].content.text;
			expect(text).toContain(postContent);
			expect(text).toContain('awaiting_input');
			expect(text).toContain('outline');
			expect(result.description).toContain(fakePost.title.raw);
		});

		it('includes note-based scaffolding when notes are supported', async () => {
			const server = createMockServer();
			const session = createMockSession({
				state: 'editing',
				post: fakePost,
			});
			registerComposePrompts(server, session);

			const prompt = server.registeredPrompts.get('compose');
			assertDefined(prompt);
			const result = await prompt.handler({});

			const text = result.messages[0].content.text;
			expect(text).toContain('wp_add_note');
			expect(text).not.toContain('does not support editorial notes');
		});

		it('uses placeholder paragraphs when notes not supported', async () => {
			const server = createMockServer();
			const session = createMockSession({
				state: 'editing',
				post: fakePost,
			});
			vi.mocked(session.getNotesSupported).mockReturnValue(false);
			registerComposePrompts(server, session);

			const prompt = server.registeredPrompts.get('compose');
			assertDefined(prompt);
			const result = await prompt.handler({});

			const text = result.messages[0].content.text;
			expect(text).toContain('does not support editorial notes');
			expect(text).toContain('placeholder paragraphs');
			expect(text).not.toContain('wp_add_note');
		});

		it('shows new/empty post message when post content is empty', async () => {
			const server = createMockServer();
			const session = createMockSession({
				state: 'editing',
				post: fakePost,
				postContent: '',
			});
			registerComposePrompts(server, session);

			const prompt = server.registeredPrompts.get('compose');
			assertDefined(prompt);
			const result = await prompt.handler({});

			const text = result.messages[0].content.text;
			expect(text).toContain('new/empty post');
		});

		it('includes conversation protocol instructions', async () => {
			const server = createMockServer();
			const session = createMockSession({
				state: 'editing',
				post: fakePost,
			});
			registerComposePrompts(server, session);

			const prompt = server.registeredPrompts.get('compose');
			assertDefined(prompt);
			const result = await prompt.handler({});

			const text = result.messages[0].content.text;
			expect(text).toContain('wp_update_command_status');
			expect(text).toContain('awaiting_input');
			expect(text).toContain('planReady');
		});
	});

	it('has the correct description', () => {
		const server = createMockServer();
		const session = createMockSession({ state: 'disconnected' });
		registerComposePrompts(server, session);

		const prompt = server.registeredPrompts.get('compose');
		assertDefined(prompt);
		expect(prompt.description).toBe(
			'Plan and outline a WordPress post through guided conversation.'
		);
	});
});
