import { describe, it, expect, beforeEach } from 'vitest';
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
				'Done editing'
			);
			expect(result.content[0].text).toContain(
				'Command 7 status updated to "completed".'
			);
			expect(result.isError).toBeUndefined();
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
