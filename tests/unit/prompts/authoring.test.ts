import { describe, it, expect } from 'vitest';
import { createMockServer, createMockSession, fakePost } from './helpers.js';
import { registerAuthoringPrompts } from '../../../src/prompts/authoring.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { assertDefined } from '../../test-utils.js';

describe('translate', () => {
	describe('when language is empty', () => {
		it('asks the user what language they want', async () => {
			const server = createMockServer();
			const session = createMockSession({ state: 'connected' });
			registerAuthoringPrompts(server as unknown as McpServer, session);

			const prompt = server.registeredPrompts.get('translate');
			assertDefined(prompt);
			const result = await prompt.handler({ language: '' });

			expect(result.messages[0].content.text).toContain(
				'Ask me what language'
			);
		});
	});

	describe('when disconnected', () => {
		it('instructs to connect first', async () => {
			const server = createMockServer();
			const session = createMockSession({ state: 'disconnected' });
			registerAuthoringPrompts(server as unknown as McpServer, session);

			const prompt = server.registeredPrompts.get('translate');
			assertDefined(prompt);
			const result = await prompt.handler({ language: 'Spanish' });

			expect(result.messages[0].content.text).toContain('wp_connect');
		});
	});

	describe('when connected', () => {
		it('instructs to open a post first', async () => {
			const server = createMockServer();
			const session = createMockSession({ state: 'connected' });
			registerAuthoringPrompts(server as unknown as McpServer, session);

			const prompt = server.registeredPrompts.get('translate');
			assertDefined(prompt);
			const result = await prompt.handler({ language: 'French' });

			expect(result.messages[0].content.text).toContain('wp_open_post');
		});
	});

	describe('when editing', () => {
		const postContent =
			'Title: "My Great Post"\n\n[0] core/paragraph\n  "Hello world"';

		it('embeds post content with translation instructions', async () => {
			const server = createMockServer();
			const session = createMockSession({
				state: 'editing',
				post: fakePost,
				postContent,
			});
			registerAuthoringPrompts(server as unknown as McpServer, session);

			const prompt = server.registeredPrompts.get('translate');
			assertDefined(prompt);
			const result = await prompt.handler({ language: 'Japanese' });

			expect(result.messages[0].content.text).toContain(postContent);
			expect(result.messages[0].content.text).toContain('Japanese');
			expect(result.messages[0].content.text).toContain('wp_set_title');
			expect(result.description).toContain(fakePost.title.raw);
			expect(result.description).toContain('Japanese');
		});

		it('includes excerpt translation instruction', async () => {
			const server = createMockServer();
			const session = createMockSession({
				state: 'editing',
				post: fakePost,
				postContent,
			});
			registerAuthoringPrompts(server as unknown as McpServer, session);

			const prompt = server.registeredPrompts.get('translate');
			assertDefined(prompt);
			const result = await prompt.handler({ language: 'Spanish' });

			expect(result.messages[0].content.text).toContain('wp_set_excerpt');
		});

		it('instructs to preserve block structure', async () => {
			const server = createMockServer();
			const session = createMockSession({
				state: 'editing',
				post: fakePost,
				postContent,
			});
			registerAuthoringPrompts(server as unknown as McpServer, session);

			const prompt = server.registeredPrompts.get('translate');
			assertDefined(prompt);
			const result = await prompt.handler({ language: 'French' });

			expect(result.messages[0].content.text).toContain(
				'Do NOT add, remove, or reorder blocks'
			);
		});
	});
});
