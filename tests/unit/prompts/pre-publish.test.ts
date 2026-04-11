import { describe, it, expect } from 'vitest';
import { createMockServer, createMockSession, fakePost } from './helpers.js';
import { prePublishPrompts } from '../../../src/prompts/pre-publish.js';
import { registerPromptDefinitions } from '../../../src/prompts/registry.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../../../src/session/session-manager.js';
import type { RegisteredPrompt } from './helpers.js';
import { assertDefined } from '../../test-utils.js';

describe('pre-publish-check', () => {
	describe('when disconnected', () => {
		it('instructs to connect first', async () => {
			const server = createMockServer();
			const session = createMockSession({ state: 'disconnected' });
			registerPromptDefinitions(
				server as unknown as McpServer,
				session,
				prePublishPrompts
			);

			const prompt = server.registeredPrompts.get('pre-publish-check');
			assertDefined(prompt);
			const result = await prompt.handler({});

			expect(result.messages[0].content.text).toContain('wp_connect');
		});
	});

	describe('when connected', () => {
		it('instructs to open a post first', async () => {
			const server = createMockServer();
			const session = createMockSession({ state: 'connected' });
			registerPromptDefinitions(
				server as unknown as McpServer,
				session,
				prePublishPrompts
			);

			const prompt = server.registeredPrompts.get('pre-publish-check');
			assertDefined(prompt);
			const result = await prompt.handler({});

			expect(result.messages[0].content.text).toContain('wp_open_post');
		});
	});

	describe('when editing', () => {
		let server: ReturnType<typeof createMockServer>;
		let session: SessionManager;
		let prompt: RegisteredPrompt;
		const postContent =
			'Title: "My Great Post"\n\n[0] core/paragraph\n  "Hello world"';

		function setup() {
			server = createMockServer();
			session = createMockSession({
				state: 'editing',
				post: fakePost,
				postContent,
			});
			registerPromptDefinitions(
				server as unknown as McpServer,
				session,
				prePublishPrompts
			);
			const prePublishPrompt =
				server.registeredPrompts.get('pre-publish-check');
			assertDefined(prePublishPrompt);
			prompt = prePublishPrompt;
		}

		it('embeds post content', async () => {
			setup();
			const result = await prompt.handler({});

			expect(result.messages[0].content.text).toContain(postContent);
			expect(result.description).toContain(fakePost.title.raw);
		});

		it('instructs to check all metadata areas', async () => {
			setup();
			const result = await prompt.handler({});
			const text = result.messages[0].content.text;

			expect(text).toContain('Excerpt');
			expect(text).toContain('Categories');
			expect(text).toContain('Tags');
			expect(text).toContain('Slug');
		});

		it('instructs to use wp_update_command_status with resultData', async () => {
			setup();
			const result = await prompt.handler({});
			const text = result.messages[0].content.text;

			expect(text).toContain('wp_update_command_status');
			expect(text).toContain('resultData');
		});

		it('instructs not to make edits', async () => {
			setup();
			const result = await prompt.handler({});

			expect(result.messages[0].content.text).toContain('READ-ONLY');
			expect(result.messages[0].content.text).toContain(
				'Do NOT add notes'
			);
		});

		it('does not instruct checking content quality', async () => {
			setup();
			const result = await prompt.handler({});
			const text = result.messages[0].content.text;

			expect(text).not.toContain('Content quality');
			expect(text).not.toContain('Structure');
			expect(text).not.toContain('heading hierarchy');
		});

		it('has no arguments schema', () => {
			setup();
			expect(prompt.schema).toBeUndefined();
		});
	});
});
