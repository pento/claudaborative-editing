import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../../..'
);

export interface McpTestClient {
	client: Client;
	close: () => Promise<void>;
	stderr: string[];
}

export async function createMcpTestClient(): Promise<McpTestClient> {
	const transport = new StdioClientTransport({
		command: 'node',
		args: ['./dist/index.js'],
		cwd: REPO_ROOT,
		stderr: 'pipe',
	});
	const stderr: string[] = [];

	transport.stderr?.on('data', (chunk: Buffer | string) => {
		stderr.push(chunk.toString());
	});

	const client = new Client({ name: 'e2e-test-client', version: '1.0.0' });
	await client.connect(transport);

	return {
		client,
		stderr,
		close: async () => {
			await transport.close();
		},
	};
}

interface ToolContent {
	type: string;
	text?: string;
}

type ToolResult = Awaited<ReturnType<Client['callTool']>>;

export async function callToolOrThrow(
	client: Client,
	name: string,
	args: Record<string, unknown> = {}
): Promise<ToolResult> {
	const result = await client.callTool({ name, arguments: args });
	if ('isError' in result && result.isError) {
		const content = result.content as ToolContent[];
		const text = content
			.filter((item) => item.type === 'text')
			.map((item) => item.text ?? '')
			.join('\n');
		throw new Error(`Tool ${name} failed: ${text}`);
	}
	return result;
}

export function getToolText(result: ToolResult): string {
	const content = result.content as ToolContent[];
	return content
		.filter((item) => item.type === 'text')
		.map((item) => item.text ?? '')
		.join('\n');
}

/**
 * Call a tool and return the result without throwing on error.
 */
export async function callTool(
	client: Client,
	name: string,
	args: Record<string, unknown> = {}
): Promise<{ isError: boolean; text: string }> {
	const result = await client.callTool({ name, arguments: args });
	const content = result.content as ToolContent[];
	const text = content
		.filter((item) => item.type === 'text')
		.map((item) => item.text ?? '')
		.join('\n');
	return { isError: !!result.isError, text };
}

/**
 * Poll wp_status until the expected number of collaborators are present.
 */
export async function waitForCollaborators(
	client: Client,
	count: number = 2
): Promise<void> {
	await expect
		.poll(
			async () => {
				const status = await callToolOrThrow(client, 'wp_status');
				return getToolText(status);
			},
			{ timeout: 30_000, intervals: [1000] }
		)
		.toContain(`(${count} collaborators)`);
}

/**
 * Poll wp_status until the sync queue is fully drained.
 */
export async function waitForQueueToDrain(client: Client): Promise<void> {
	await expect
		.poll(
			async () => {
				const status = await callToolOrThrow(client, 'wp_status');
				return getToolText(status);
			},
			{ timeout: 30_000, intervals: [1000] }
		)
		.toContain('Queue: 0 pending updates');
}
