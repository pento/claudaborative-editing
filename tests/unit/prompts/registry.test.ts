import { describe, it, expect } from 'vitest';
import {
	allPrompts,
	getPromptByName,
	registerAllPrompts,
	registerPromptDefinitions,
} from '../../../src/prompts/registry.js';
import { createMockServer, createMockSession } from './helpers.js';
import { assertDefined } from '../../test-utils.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { PromptDefinition } from '../../../src/prompts/definitions.js';

describe('prompts/registry', () => {
	describe('allPrompts', () => {
		it('aggregates all 8 prompt definitions', () => {
			expect(allPrompts.length).toBe(8);
		});

		it('contains known prompts from different files', () => {
			const names = allPrompts.map((p) => p.name);
			expect(names).toContain('edit');
			expect(names).toContain('proofread');
			expect(names).toContain('review');
			expect(names).toContain('respond-to-notes');
			expect(names).toContain('respond-to-note');
			expect(names).toContain('translate');
			expect(names).toContain('compose');
			expect(names).toContain('pre-publish-check');
		});
	});

	describe('getPromptByName', () => {
		it('returns a prompt definition by name', () => {
			const prompt = getPromptByName('review');
			assertDefined(prompt);
			expect(prompt.name).toBe('review');
			expect(prompt.description).toContain('editorial feedback');
		});

		it('returns undefined for unknown names', () => {
			expect(getPromptByName('nonexistent')).toBeUndefined();
		});
	});

	describe('registerPromptDefinitions', () => {
		it('wraps buildMessages and converts content to MCP format', async () => {
			const server = createMockServer();
			const session = createMockSession({ state: 'disconnected' });

			const testPrompts: PromptDefinition[] = [
				{
					name: 'test-prompt',
					description: 'A test prompt',
					buildMessages: () => ({
						description: 'Test description',
						messages: [
							{ role: 'user', content: 'Hello from test' },
						],
					}),
				},
			];

			registerPromptDefinitions(
				server as unknown as McpServer,
				session,
				testPrompts
			);

			const registered = server.registeredPrompts.get('test-prompt');
			assertDefined(registered);

			const result = await registered.handler({});
			expect(result.description).toBe('Test description');
			expect(result.messages[0]).toEqual({
				role: 'user',
				content: { type: 'text', text: 'Hello from test' },
			});
		});
	});

	describe('registerAllPrompts', () => {
		it('registers all prompts on the MCP server', () => {
			const server = createMockServer();
			const session = createMockSession();
			registerAllPrompts(server as unknown as McpServer, session);
			expect(server.registeredPrompts.size).toBe(8);
		});
	});
});
