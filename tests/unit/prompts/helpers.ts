/**
 * Shared test helpers for prompt tests.
 *
 * Provides a mock McpServer that captures prompt registrations and
 * re-exports mock session helpers from the tool test helpers.
 */

import { vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Re-export session helpers so prompt tests don't import from tools/
export { createMockSession, fakePost, fakeUser, fakeNote } from '../tools/helpers.js';

export interface RegisteredPrompt {
  name: string;
  description: string;
  schema: Record<string, unknown> | undefined;
  handler: (params: Record<string, unknown>) => Promise<{
    description?: string;
    messages: Array<{ role: 'user' | 'assistant'; content: { type: string; text: string } }>;
  }>;
}

/**
 * Create a mock McpServer that captures prompt registrations.
 *
 * Handles the SDK's overloaded prompt() signature:
 *   prompt(name, cb)
 *   prompt(name, description, cb)
 *   prompt(name, description, schema, cb)
 */
export function createMockServer(): McpServer & { registeredPrompts: Map<string, RegisteredPrompt> } {
  const registeredPrompts = new Map<string, RegisteredPrompt>();

  const server = {
    registeredPrompts,
    prompt: vi.fn((...args: unknown[]) => {
      const name = args[0] as string;
      const rest = args.slice(1);

      let description = '';
      let schema: Record<string, unknown> | undefined;
      let handler: RegisteredPrompt['handler'];

      if (typeof rest[0] === 'string') {
        description = rest.shift() as string;
      }
      if (typeof rest[0] === 'object' && rest[0] !== null && typeof rest[1] === 'function') {
        schema = rest.shift() as Record<string, unknown>;
      }
      handler = rest[0] as RegisteredPrompt['handler'];

      registeredPrompts.set(name, { name, description, schema, handler });
    }),
  };

  return server as unknown as McpServer & { registeredPrompts: Map<string, RegisteredPrompt> };
}
