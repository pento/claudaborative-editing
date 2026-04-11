import { describe, it, expect } from 'vitest';
import {
	allTools,
	getToolByName,
	getToolsForState,
	getToolsByTag,
	registerAllTools,
	registerToolDefinitions,
} from '../../../src/tools/registry.js';
import { createMockServer, createMockSession } from './helpers.js';
import { assertDefined } from '../../test-utils.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDefinition } from '../../../src/tools/definitions.js';

describe('tools/registry', () => {
	describe('allTools', () => {
		it('aggregates all 39 tool definitions', () => {
			expect(allTools.length).toBe(39);
		});

		it('contains known tools from different files', () => {
			const names = allTools.map((t) => t.name);
			expect(names).toContain('wp_connect');
			expect(names).toContain('wp_read_post');
			expect(names).toContain('wp_update_block');
			expect(names).toContain('wp_status');
			expect(names).toContain('wp_upload_media');
			expect(names).toContain('wp_list_notes');
			expect(names).toContain('wp_set_categories');
			expect(names).toContain('wp_update_command_status');
		});
	});

	describe('getToolByName', () => {
		it('returns a tool definition by name', () => {
			const tool = getToolByName('wp_read_post');
			assertDefined(tool);
			expect(tool.name).toBe('wp_read_post');
			expect(tool.description).toContain('block listing');
		});

		it('returns undefined for unknown names', () => {
			expect(getToolByName('wp_nonexistent')).toBeUndefined();
		});
	});

	describe('getToolsForState', () => {
		it('returns tools available in disconnected state', () => {
			const tools = getToolsForState('disconnected');
			const names = tools.map((t) => t.name);
			expect(names).toContain('wp_connect');
			expect(names).toContain('wp_status'); // no availableIn restriction
			expect(names).not.toContain('wp_read_post'); // editing only
			expect(names).not.toContain('wp_open_post'); // connected only
		});

		it('returns tools available in connected state', () => {
			const tools = getToolsForState('connected');
			const names = tools.map((t) => t.name);
			expect(names).toContain('wp_open_post');
			expect(names).toContain('wp_list_posts');
			expect(names).toContain('wp_status');
			expect(names).not.toContain('wp_connect'); // disconnected only
			expect(names).not.toContain('wp_read_post'); // editing only
		});

		it('returns tools available in editing state', () => {
			const tools = getToolsForState('editing');
			const names = tools.map((t) => t.name);
			expect(names).toContain('wp_read_post');
			expect(names).toContain('wp_update_block');
			expect(names).toContain('wp_status');
			expect(names).toContain('wp_disconnect');
			expect(names).not.toContain('wp_connect'); // disconnected only
		});
	});

	describe('getToolsByTag', () => {
		it('returns tools with the editing tag', () => {
			const tools = getToolsByTag('editing');
			const names = tools.map((t) => t.name);
			expect(names).toContain('wp_update_block');
			expect(names).toContain('wp_insert_block');
			expect(names).toContain('wp_set_title');
			expect(names).not.toContain('wp_read_post');
		});

		it('returns tools with the connection tag', () => {
			const tools = getToolsByTag('connection');
			const names = tools.map((t) => t.name);
			expect(names).toContain('wp_connect');
			expect(names).toContain('wp_disconnect');
			expect(names).toHaveLength(2);
		});

		it('returns empty array for unknown tags', () => {
			expect(getToolsByTag('nonexistent')).toHaveLength(0);
		});
	});

	describe('registerToolDefinitions', () => {
		it('wraps execute returning string as success content', async () => {
			const server = createMockServer();
			const session = createMockSession();

			const tools: ToolDefinition[] = [
				{
					name: 'test_tool',
					description: 'A test tool',
					execute: () => 'Success!',
				},
			];

			registerToolDefinitions(
				server as unknown as McpServer,
				session,
				tools
			);

			const registered = server.registeredTools.get('test_tool');
			assertDefined(registered);

			const result = await registered.handler({});
			expect(result.content[0].text).toBe('Success!');
			expect(result.isError).toBeUndefined();
		});

		it('wraps execute returning ToolResult with isError', async () => {
			const server = createMockServer();
			const session = createMockSession();

			const tools: ToolDefinition[] = [
				{
					name: 'test_tool',
					description: 'A test tool',
					execute: () => ({
						text: 'Not allowed',
						isError: true,
					}),
				},
			];

			registerToolDefinitions(
				server as unknown as McpServer,
				session,
				tools
			);

			const registered = server.registeredTools.get('test_tool');
			assertDefined(registered);
			const result = await registered.handler({});
			expect(result.content[0].text).toBe('Not allowed');
			expect(result.isError).toBe(true);
		});

		it('catches thrown Error and formats with tool name', async () => {
			const server = createMockServer();
			const session = createMockSession();

			const tools: ToolDefinition[] = [
				{
					name: 'test_tool',
					description: 'A test tool',
					execute: () => {
						throw new Error('Something broke');
					},
				},
			];

			registerToolDefinitions(
				server as unknown as McpServer,
				session,
				tools
			);

			const registered = server.registeredTools.get('test_tool');
			assertDefined(registered);
			const result = await registered.handler({});
			expect(result.content[0].text).toBe(
				'test_tool failed: Something broke'
			);
			expect(result.isError).toBe(true);
		});

		it('catches thrown strings and passes them through', async () => {
			const server = createMockServer();
			const session = createMockSession();

			const tools: ToolDefinition[] = [
				{
					name: 'test_tool',
					description: 'A test tool',
					execute: () => {
						// eslint-disable-next-line @typescript-eslint/only-throw-error
						throw 'raw string error';
					},
				},
			];

			registerToolDefinitions(
				server as unknown as McpServer,
				session,
				tools
			);

			const registered = server.registeredTools.get('test_tool');
			assertDefined(registered);
			const result = await registered.handler({});
			expect(result.content[0].text).toBe(
				'test_tool failed: raw string error'
			);
			expect(result.isError).toBe(true);
		});

		it('catches thrown objects and JSON-serializes them', async () => {
			const server = createMockServer();
			const session = createMockSession();

			const tools: ToolDefinition[] = [
				{
					name: 'test_tool',
					description: 'A test tool',
					execute: () => {
						// eslint-disable-next-line @typescript-eslint/only-throw-error
						throw { code: 'ENOENT', path: '/tmp/missing' };
					},
				},
			];

			registerToolDefinitions(
				server as unknown as McpServer,
				session,
				tools
			);

			const registered = server.registeredTools.get('test_tool');
			assertDefined(registered);
			const result = await registered.handler({});
			expect(result.content[0].text).toBe(
				'test_tool failed: {"code":"ENOENT","path":"/tmp/missing"}'
			);
			expect(result.isError).toBe(true);
		});
	});

	describe('registerAllTools', () => {
		it('registers all tools on the MCP server', () => {
			const server = createMockServer();
			const session = createMockSession();
			registerAllTools(server as unknown as McpServer, session);
			expect(server.registeredTools.size).toBe(39);
		});
	});
});
