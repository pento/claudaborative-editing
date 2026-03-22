import { describe, it, expect } from 'vitest';
import { createMockServer, createMockSession, fakePost } from './helpers.js';
import { registerEditingPrompts } from '../../../src/prompts/editing.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../../../src/session/session-manager.js';
import type { RegisteredPrompt } from './helpers.js';

describe('edit', () => {
  describe('when disconnected', () => {
    it('instructs to connect first', async () => {
      const server = createMockServer();
      const session = createMockSession({ state: 'disconnected' });
      registerEditingPrompts(server as unknown as McpServer, session);

      const prompt = server.registeredPrompts.get('edit')!;
      const result = await prompt.handler({});

      expect(result.messages[0].content.text).toContain('wp_connect');
    });
  });

  describe('when connected', () => {
    it('instructs to open a post first', async () => {
      const server = createMockServer();
      const session = createMockSession({ state: 'connected' });
      registerEditingPrompts(server as unknown as McpServer, session);

      const prompt = server.registeredPrompts.get('edit')!;
      const result = await prompt.handler({});

      expect(result.messages[0].content.text).toContain('wp_open_post');
    });
  });

  describe('when editing', () => {
    let server: ReturnType<typeof createMockServer>;
    let session: SessionManager;
    let prompt: RegisteredPrompt;
    const postContent = 'Title: "My Great Post"\n\n[0] core/paragraph\n  "Hello world"';

    function setup() {
      server = createMockServer();
      session = createMockSession({
        state: 'editing',
        post: fakePost,
        postContent,
      });
      registerEditingPrompts(server as unknown as McpServer, session);
      prompt = server.registeredPrompts.get('edit')!;
    }

    it('embeds post content and tool instructions', async () => {
      setup();
      const result = await prompt.handler({});

      expect(result.messages[0].content.text).toContain(postContent);
      expect(result.messages[0].content.text).toContain('wp_update_block');
      expect(result.description).toContain(fakePost.title.raw);
    });

    it('includes editing focus when provided', async () => {
      setup();
      const result = await prompt.handler({ editingFocus: 'tone' });

      expect(result.messages[0].content.text).toContain('Focus on: tone');
    });

    it('asks the user what kind of editing when no focus provided', async () => {
      setup();
      const result = await prompt.handler({});

      expect(result.messages[0].content.text).toContain('Ask me what kind of editing');
    });
  });
});

describe('proofread', () => {
  describe('when disconnected', () => {
    it('instructs to connect first', async () => {
      const server = createMockServer();
      const session = createMockSession({ state: 'disconnected' });
      registerEditingPrompts(server as unknown as McpServer, session);

      const prompt = server.registeredPrompts.get('proofread')!;
      const result = await prompt.handler({});

      expect(result.messages[0].content.text).toContain('wp_connect');
    });
  });

  describe('when connected', () => {
    it('instructs to open a post first', async () => {
      const server = createMockServer();
      const session = createMockSession({ state: 'connected' });
      registerEditingPrompts(server as unknown as McpServer, session);

      const prompt = server.registeredPrompts.get('proofread')!;
      const result = await prompt.handler({});

      expect(result.messages[0].content.text).toContain('wp_open_post');
    });
  });

  describe('when editing', () => {
    let server: ReturnType<typeof createMockServer>;
    let session: SessionManager;
    let prompt: RegisteredPrompt;
    const postContent = 'Title: "My Great Post"\n\n[0] core/paragraph\n  "Hello world"';

    function setup() {
      server = createMockServer();
      session = createMockSession({
        state: 'editing',
        post: fakePost,
        postContent,
      });
      registerEditingPrompts(server as unknown as McpServer, session);
      prompt = server.registeredPrompts.get('proofread')!;
    }

    it('embeds post content with proofreading instructions', async () => {
      setup();
      const result = await prompt.handler({});

      expect(result.messages[0].content.text).toContain(postContent);
      expect(result.messages[0].content.text).toContain('grammar');
      expect(result.description).toContain(fakePost.title.raw);
    });

    it('instructs not to change meaning or structure', async () => {
      setup();
      const result = await prompt.handler({});

      expect(result.messages[0].content.text).toContain('Do NOT change the meaning');
      expect(result.messages[0].content.text).toContain('Do NOT add or remove blocks');
    });
  });
});
