/**
 * Shared test helpers for tool tests.
 *
 * Provides a mock McpServer that captures tool registrations and a
 * mock SessionManager that returns predictable data.
 */

import { vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager, SessionState } from '../../../src/session/session-manager.js';
import type { WPMediaItem, WPPost, WPUser } from '../../../src/wordpress/types.js';
import type { CollaboratorInfo } from '../../../src/yjs/types.js';

export interface RegisteredTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  handler: (params: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>;
}

/**
 * Create a mock McpServer that captures tool registrations.
 */
export function createMockServer(): McpServer & { registeredTools: Map<string, RegisteredTool> } {
  const registeredTools = new Map<string, RegisteredTool>();

  const server = {
    registeredTools,
    tool: vi.fn(
      (name: string, description: string, schema: Record<string, unknown>, handler: RegisteredTool['handler']) => {
        registeredTools.set(name, { name, description, schema, handler });
      },
    ),
  };

  return server as unknown as McpServer & { registeredTools: Map<string, RegisteredTool> };
}

export const fakeUser: WPUser = {
  id: 1,
  name: 'Gary',
  slug: 'gary',
  avatar_urls: { '96': 'https://example.com/avatar.jpg' },
};

export const fakePost: WPPost = {
  id: 42,
  title: { rendered: 'My Great Post', raw: 'My Great Post' },
  content: {
    rendered: '<p>Hello world</p>',
    raw: '<!-- wp:paragraph -->\n<p>Hello world</p>\n<!-- /wp:paragraph -->',
  },
  excerpt: { rendered: '', raw: '' },
  status: 'publish',
  type: 'post',
  slug: 'my-great-post',
  author: 1,
  date: '2026-01-01T00:00:00',
  modified: '2026-01-01T00:00:00',
};

export const fakeMediaItem: WPMediaItem = {
  id: 101,
  source_url: 'https://example.com/wp-content/uploads/2026/03/test.jpg',
  title: { rendered: 'test', raw: 'test' },
  caption: { rendered: '', raw: '' },
  alt_text: 'A test image',
  mime_type: 'image/jpeg',
  media_details: { width: 800, height: 600, sizes: {} },
};

export const fakeCollaborator: CollaboratorInfo = {
  id: 2,
  name: 'Alice',
  slug: 'alice',
  avatar_urls: {},
  browserType: 'Chrome',
  enteredAt: Date.now(),
};

/**
 * Create a mock SessionManager with configurable state and return values.
 */
export function createMockSession(overrides: {
  state?: SessionState;
  user?: WPUser | null;
  post?: WPPost | null;
  collaborators?: CollaboratorInfo[];
  syncStatus?: { isPolling: boolean; hasCollaborators: boolean; queueSize: number } | null;
  postContent?: string;
  blockContent?: string;
} = {}): SessionManager {
  const state = overrides.state ?? 'disconnected';
  const user = overrides.user ?? null;
  const post = overrides.post ?? null;
  const collaborators = overrides.collaborators ?? [];
  const syncStatus = overrides.syncStatus ?? null;
  const postContent = overrides.postContent ?? 'Title: "Test"\n\n[0] core/paragraph\n  "Hello"';
  const blockContent = overrides.blockContent ?? '[0] core/paragraph\n  "Hello"';

  return {
    connect: vi.fn().mockResolvedValue(user ?? fakeUser),
    disconnect: vi.fn(),
    listPosts: vi.fn().mockResolvedValue([fakePost]),
    openPost: vi.fn().mockResolvedValue(undefined),
    createPost: vi.fn().mockResolvedValue(post ?? fakePost),
    closePost: vi.fn(),
    readPost: vi.fn().mockReturnValue(postContent),
    readBlock: vi.fn().mockReturnValue(blockContent),
    updateBlock: vi.fn().mockResolvedValue(undefined),
    insertBlock: vi.fn().mockResolvedValue(undefined),
    insertInnerBlock: vi.fn().mockResolvedValue(undefined),
    removeBlocks: vi.fn(),
    removeInnerBlocks: vi.fn(),
    moveBlock: vi.fn(),
    replaceBlocks: vi.fn().mockResolvedValue(undefined),
    setTitle: vi.fn().mockResolvedValue(undefined),
    uploadMedia: vi.fn().mockResolvedValue(fakeMediaItem),
    save: vi.fn(),
    getState: vi.fn().mockReturnValue(state),
    getSyncStatus: vi.fn().mockReturnValue(syncStatus),
    getCollaborators: vi.fn().mockReturnValue(collaborators),
    getCurrentPost: vi.fn().mockReturnValue(post),
    getUser: vi.fn().mockReturnValue(user),
  } as unknown as SessionManager;
}
