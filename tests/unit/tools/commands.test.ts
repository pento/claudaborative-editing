import { describe, it, expect, beforeEach } from 'vitest';
import type { ZodType } from 'zod';
import { registerCommandTools } from '../../../src/tools/commands.js';
import { createMockServer, createMockSession } from './helpers.js';
import { assertDefined } from '../../test-utils.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

describe('command tools', () => {
	let server: ReturnType<typeof createMockServer>;

	beforeEach(() => {
		server = createMockServer();
	});

	it('registers wp_update_command_status', () => {
		const session = createMockSession();
		registerCommandTools(server as unknown as McpServer, session);

		expect(server.registeredTools.has('wp_update_command_status')).toBe(
			true
		);
	});

	describe('wp_update_command_status', () => {
		it('updates command status and returns confirmation', async () => {
			const session = createMockSession();
			registerCommandTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_update_command_status');
			assertDefined(tool);
			const result = await tool.handler({
				commandId: 7,
				status: 'completed',
				message: 'Done editing',
			});

			expect(session.updateCommandStatus).toHaveBeenCalledWith(
				7,
				'completed',
				'Done editing',
				undefined
			);
			expect(result.content[0].text).toContain(
				'Command 7 status updated to "completed".'
			);
			expect(result.isError).toBeUndefined();
		});

		it('passes resultData parameter when provided', async () => {
			const session = createMockSession();
			registerCommandTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_update_command_status');
			assertDefined(tool);
			const resultData = JSON.stringify({
				checks: [
					{
						check: 'excerpt',
						status: 'warning',
						message: 'No excerpt',
						fixable: true,
					},
				],
				summary: 'One issue found',
			});
			await tool.handler({
				commandId: 10,
				status: 'completed',
				message: '1 issue found',
				resultData,
			});

			expect(session.updateCommandStatus).toHaveBeenCalledWith(
				10,
				'completed',
				'1 issue found',
				resultData
			);
		});

		it('returns error when updateCommandStatus throws', async () => {
			const session = createMockSession();
			(
				session.updateCommandStatus as ReturnType<
					typeof import('vitest').vi.fn
				>
			).mockRejectedValue(new Error('Network timeout'));
			registerCommandTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_update_command_status');
			assertDefined(tool);
			const result = await tool.handler({
				commandId: 3,
				status: 'failed',
				message: 'Something went wrong',
			});

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain(
				'Failed to update command status: Network timeout'
			);
		});

		it('returns error when error thrown is a string', async () => {
			const session = createMockSession();
			(
				session.updateCommandStatus as ReturnType<
					typeof import('vitest').vi.fn
				>
			).mockRejectedValue('What a weird error');
			registerCommandTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_update_command_status');
			assertDefined(tool);
			const result = await tool.handler({
				commandId: 3,
				status: 'failed',
				message: 'Something went wrong',
			});

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain(
				'Failed to update command status: What a weird error'
			);
		});

		describe('resultData schema validation', () => {
			function getResultDataSchema(): ZodType {
				const session = createMockSession();
				registerCommandTools(server as unknown as McpServer, session);
				const tool = server.registeredTools.get(
					'wp_update_command_status'
				);
				assertDefined(tool);
				return tool.schema.resultData as ZodType;
			}

			it('accepts a valid JSON object string', () => {
				const schema = getResultDataSchema();
				const result = schema.safeParse('{"excerpt":"test"}');
				expect(result.success).toBe(true);
			});

			it('accepts undefined (optional)', () => {
				const schema = getResultDataSchema();
				const result = schema.safeParse(undefined);
				expect(result.success).toBe(true);
			});

			it('rejects invalid JSON', () => {
				const schema = getResultDataSchema();
				const result = schema.safeParse('not json');
				expect(result.success).toBe(false);
			});

			it('rejects a JSON array', () => {
				const schema = getResultDataSchema();
				const result = schema.safeParse('["a","b"]');
				expect(result.success).toBe(false);
			});

			it('rejects a JSON scalar', () => {
				const schema = getResultDataSchema();
				const result = schema.safeParse('"just a string"');
				expect(result.success).toBe(false);
			});
		});

		it('returns descriptive error when plugin is not connected', async () => {
			const session = createMockSession();
			(
				session.updateCommandStatus as ReturnType<
					typeof import('vitest').vi.fn
				>
			).mockRejectedValue(
				new Error('WordPress editor plugin is not connected')
			);
			registerCommandTools(server as unknown as McpServer, session);

			const tool = server.registeredTools.get('wp_update_command_status');
			assertDefined(tool);
			const result = await tool.handler({
				commandId: 5,
				status: 'running',
			});

			expect(result.isError).toBe(true);
			expect(result.content[0].text).toContain(
				'WordPress editor plugin is not connected'
			);
		});
	});
});
