import { describe, it, expect, vi } from 'vitest';
import type { WPNote } from '../../../src/wordpress/types.js';
import {
	createMockServer,
	createMockSession,
	fakePost,
	fakeNote,
} from './helpers.js';
import { registerReviewPrompts } from '../../../src/prompts/review.js';
import { assertDefined } from '../../test-utils.js';

describe('review', () => {
	describe('when disconnected', () => {
		it('instructs to connect first', async () => {
			const server = createMockServer();
			const session = createMockSession({ state: 'disconnected' });
			registerReviewPrompts(server, session);

			const prompt = server.registeredPrompts.get('review');
			assertDefined(prompt);
			const result = await prompt.handler({});

			const text = result.messages[0].content.text;
			expect(text).toContain('wp_connect');
		});
	});

	describe('when connected', () => {
		it('instructs to open a post first', async () => {
			const server = createMockServer();
			const session = createMockSession({ state: 'connected' });
			registerReviewPrompts(server, session);

			const prompt = server.registeredPrompts.get('review');
			assertDefined(prompt);
			const result = await prompt.handler({});

			const text = result.messages[0].content.text;
			expect(text).toContain('wp_open_post');
		});
	});

	describe('when editing', () => {
		it('embeds post content and note instructions', async () => {
			const server = createMockServer();
			const session = createMockSession({
				state: 'editing',
				post: fakePost,
			});
			registerReviewPrompts(server, session);

			const prompt = server.registeredPrompts.get('review');
			assertDefined(prompt);
			const result = await prompt.handler({});

			const text = result.messages[0].content.text;
			const postContent = session.readPost();
			expect(text).toContain(postContent);
			expect(text).toContain('wp_add_note');
			expect(result.description).toContain(fakePost.title.raw);
		});

		it('falls back to text summary when notes not supported', async () => {
			const server = createMockServer();
			const session = createMockSession({
				state: 'editing',
				post: fakePost,
			});
			vi.mocked(session.getNotesSupported).mockReturnValue(false);
			registerReviewPrompts(server, session);

			const prompt = server.registeredPrompts.get('review');
			assertDefined(prompt);
			const result = await prompt.handler({});

			const text = result.messages[0].content.text;
			expect(text).toContain('does not support notes');
			expect(text).toContain('text summary');
			expect(text).not.toContain('wp_add_note');
		});

		it('includes metadata review guidance', async () => {
			const server = createMockServer();
			const session = createMockSession({
				state: 'editing',
				post: fakePost,
			});
			registerReviewPrompts(server, session);

			const prompt = server.registeredPrompts.get('review');
			assertDefined(prompt);
			const result = await prompt.handler({});

			const text = result.messages[0].content.text;
			expect(text).toMatch(/categories|tags|metadata/i);
		});

		it('instructs to write notes in the same language as the post', async () => {
			const server = createMockServer();
			const session = createMockSession({
				state: 'editing',
				post: fakePost,
			});
			registerReviewPrompts(server, session);

			const prompt = server.registeredPrompts.get('review');
			assertDefined(prompt);
			const result = await prompt.handler({});

			const text = result.messages[0].content.text;
			expect(text).toContain('same language as the post content');
		});
	});
});

describe('respond-to-notes', () => {
	describe('when disconnected', () => {
		it('instructs to connect first', async () => {
			const server = createMockServer();
			const session = createMockSession({ state: 'disconnected' });
			registerReviewPrompts(server, session);

			const prompt = server.registeredPrompts.get('respond-to-notes');
			assertDefined(prompt);
			const result = await prompt.handler({});

			const text = result.messages[0].content.text;
			expect(text).toContain('wp_connect');
		});
	});

	describe('when connected', () => {
		it('instructs to open a post first', async () => {
			const server = createMockServer();
			const session = createMockSession({ state: 'connected' });
			registerReviewPrompts(server, session);

			const prompt = server.registeredPrompts.get('respond-to-notes');
			assertDefined(prompt);
			const result = await prompt.handler({});

			const text = result.messages[0].content.text;
			expect(text).toContain('wp_open_post');
		});
	});

	describe('when editing', () => {
		it('reports notes not supported on older WordPress', async () => {
			const server = createMockServer();
			const session = createMockSession({
				state: 'editing',
				post: fakePost,
			});
			vi.mocked(session.getNotesSupported).mockReturnValue(false);
			registerReviewPrompts(server, session);

			const prompt = server.registeredPrompts.get('respond-to-notes');
			assertDefined(prompt);
			const result = await prompt.handler({});

			const text = result.messages[0].content.text;
			expect(text).toContain('does not support notes');
		});

		it('reports no notes when list is empty', async () => {
			const server = createMockServer();
			const session = createMockSession({
				state: 'editing',
				post: fakePost,
			});
			registerReviewPrompts(server, session);

			const prompt = server.registeredPrompts.get('respond-to-notes');
			assertDefined(prompt);
			const result = await prompt.handler({});

			const text = result.messages[0].content.text;
			expect(text.toLowerCase()).toContain('no notes');
		});

		it('embeds post content and formatted notes', async () => {
			const server = createMockServer();
			const session = createMockSession({
				state: 'editing',
				post: fakePost,
			});
			vi.mocked(session.listNotes).mockResolvedValue({
				notes: [fakeNote],
				noteBlockMap: { 1: '0' },
			});
			registerReviewPrompts(server, session);

			const prompt = server.registeredPrompts.get('respond-to-notes');
			assertDefined(prompt);
			const result = await prompt.handler({});

			const text = result.messages[0].content.text;
			const postContent = session.readPost();
			expect(text).toContain(postContent);
			expect(text).toContain('Note #1');
			expect(text).toContain('Gary');
			expect(text).toContain('Test note');
			expect(text).toContain('block [0]');
			expect(text).toContain('wp_resolve_note');
			expect(result.description).toContain(fakePost.title.raw);
		});

		it('includes replies in formatted notes', async () => {
			const replyNote: WPNote = {
				...fakeNote,
				id: 2,
				parent: 1,
				author_name: 'Alice',
				content: { rendered: '<p>Reply text</p>', raw: 'Reply text' },
			};
			const server = createMockServer();
			const session = createMockSession({
				state: 'editing',
				post: fakePost,
			});
			vi.mocked(session.listNotes).mockResolvedValue({
				notes: [fakeNote, replyNote],
				noteBlockMap: { 1: '0' },
			});
			registerReviewPrompts(server, session);

			const prompt = server.registeredPrompts.get('respond-to-notes');
			assertDefined(prompt);
			const result = await prompt.handler({});

			const text = result.messages[0].content.text;
			expect(text).toContain('Reply #2');
			expect(text).toContain('Alice');
			expect(text).toContain('Reply text');
		});
	});
});

describe('respond-to-note', () => {
	describe('when disconnected', () => {
		it('instructs to connect first', async () => {
			const server = createMockServer();
			const session = createMockSession({ state: 'disconnected' });
			registerReviewPrompts(server, session);

			const prompt = server.registeredPrompts.get('respond-to-note');
			assertDefined(prompt);
			const result = await prompt.handler({ noteId: 1 });

			const text = result.messages[0].content.text;
			expect(text).toContain('wp_connect');
		});
	});

	describe('when connected', () => {
		it('instructs to open a post first', async () => {
			const server = createMockServer();
			const session = createMockSession({ state: 'connected' });
			registerReviewPrompts(server, session);

			const prompt = server.registeredPrompts.get('respond-to-note');
			assertDefined(prompt);
			const result = await prompt.handler({ noteId: 1 });

			const text = result.messages[0].content.text;
			expect(text).toContain('wp_open_post');
		});
	});

	describe('when editing', () => {
		it('reports notes not supported on older WordPress', async () => {
			const server = createMockServer();
			const session = createMockSession({
				state: 'editing',
				post: fakePost,
			});
			vi.mocked(session.getNotesSupported).mockReturnValue(false);
			registerReviewPrompts(server, session);

			const prompt = server.registeredPrompts.get('respond-to-note');
			assertDefined(prompt);
			const result = await prompt.handler({ noteId: 1 });

			const text = result.messages[0].content.text;
			expect(text).toContain('does not support notes');
		});

		it('reports note not found when ID does not match', async () => {
			const server = createMockServer();
			const session = createMockSession({
				state: 'editing',
				post: fakePost,
			});
			vi.mocked(session.listNotes).mockResolvedValue({
				notes: [fakeNote],
				noteBlockMap: { 1: '0' },
			});
			registerReviewPrompts(server, session);

			const prompt = server.registeredPrompts.get('respond-to-note');
			assertDefined(prompt);
			const result = await prompt.handler({ noteId: 999 });

			const text = result.messages[0].content.text;
			expect(text).toContain('999');
			expect(text).toContain('not found');
		});

		it('embeds only the targeted note and its replies', async () => {
			const otherNote: WPNote = {
				...fakeNote,
				id: 10,
				parent: 0,
				author_name: 'Bob',
				content: {
					rendered: '<p>Other note</p>',
					raw: 'Other note',
				},
			};
			const replyNote: WPNote = {
				...fakeNote,
				id: 2,
				parent: 1,
				author_name: 'Alice',
				content: { rendered: '<p>Reply text</p>', raw: 'Reply text' },
			};
			const server = createMockServer();
			const session = createMockSession({
				state: 'editing',
				post: fakePost,
			});
			vi.mocked(session.listNotes).mockResolvedValue({
				notes: [fakeNote, replyNote, otherNote],
				noteBlockMap: { 1: '0', 10: '1' },
			});
			registerReviewPrompts(server, session);

			const prompt = server.registeredPrompts.get('respond-to-note');
			assertDefined(prompt);
			const result = await prompt.handler({ noteId: 1 });

			const text = result.messages[0].content.text;
			// Should include the targeted note and its reply
			expect(text).toContain('Note #1');
			expect(text).toContain('Test note');
			expect(text).toContain('Reply #2');
			expect(text).toContain('Alice');
			// Should NOT include the other note
			expect(text).not.toContain('Note #10');
			expect(text).not.toContain('Other note');
			// Should include the post content
			const postContent = session.readPost();
			expect(text).toContain(postContent);
			// Should include block mapping
			expect(text).toContain('block [0]');
			expect(result.description).toContain('#1');
		});

		it('includes wp_resolve_note instruction', async () => {
			const server = createMockServer();
			const session = createMockSession({
				state: 'editing',
				post: fakePost,
			});
			vi.mocked(session.listNotes).mockResolvedValue({
				notes: [fakeNote],
				noteBlockMap: { 1: '0' },
			});
			registerReviewPrompts(server, session);

			const prompt = server.registeredPrompts.get('respond-to-note');
			assertDefined(prompt);
			const result = await prompt.handler({ noteId: 1 });

			const text = result.messages[0].content.text;
			expect(text).toContain('wp_resolve_note');
			expect(text).toContain('wp_save');
		});
	});
});
