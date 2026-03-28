import { describe, it, expect, beforeEach } from 'vitest';
import { registerConnectTools } from '../../../src/tools/connect.js';
import { createMockServer, createMockSession, fakeUser } from './helpers.js';
import { assertDefined } from '../../test-utils.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../../../src/session/session-manager.js';

describe('connect tools', () => {
  let server: ReturnType<typeof createMockServer>;
  let session: SessionManager;

  beforeEach(() => {
    server = createMockServer();
    session = createMockSession({ user: fakeUser });
    registerConnectTools(server as unknown as McpServer, session);
  });

  it('registers wp_connect and wp_disconnect', () => {
    expect(server.registeredTools.has('wp_connect')).toBe(true);
    expect(server.registeredTools.has('wp_disconnect')).toBe(true);
  });

  describe('wp_connect', () => {
    it('returns success message on connect', async () => {
      const tool = server.registeredTools.get('wp_connect');
      assertDefined(tool);
      const result = await tool.handler({
        siteUrl: 'https://example.com',
        username: 'gary',
        appPassword: 'xxxx yyyy',
      });

      expect(result.content[0].text).toContain('Connected to https://example.com');
      expect(result.content[0].text).toContain('Gary');
      expect(result.content[0].text).toContain('ID: 1');
      expect(result.isError).toBeUndefined();
    });

    it('returns error on connection failure', async () => {
      (session.connect as ReturnType<typeof import('vitest').vi.fn>).mockRejectedValue(
        new Error('Invalid credentials'),
      );

      const tool = server.registeredTools.get('wp_connect');
      assertDefined(tool);
      const result = await tool.handler({
        siteUrl: 'https://example.com',
        username: 'bad',
        appPassword: 'bad',
      });

      expect(result.content[0].text).toContain('Connection failed');
      expect(result.content[0].text).toContain('Invalid credentials');
      expect(result.isError).toBe(true);
    });

    it('returns guidance when already connected', async () => {
      const connectedSession = createMockSession({ state: 'connected', user: fakeUser });
      const connectedServer = createMockServer();
      registerConnectTools(connectedServer as unknown as McpServer, connectedSession);

      const tool = connectedServer.registeredTools.get('wp_connect');
      assertDefined(tool);
      const result = await tool.handler({
        siteUrl: 'https://other.com',
        username: 'other',
        appPassword: 'xxxx',
      });

      expect(result.content[0].text).toContain('Already connected as Gary');
      expect(result.content[0].text).toContain('wp_disconnect');
      expect(result.isError).toBeUndefined();
      expect(connectedSession.connect).not.toHaveBeenCalled();
    });

    it('returns guidance when editing a post', async () => {
      const editingSession = createMockSession({ state: 'editing', user: fakeUser });
      const editingServer = createMockServer();
      registerConnectTools(editingServer as unknown as McpServer, editingSession);

      const tool = editingServer.registeredTools.get('wp_connect');
      assertDefined(tool);
      const result = await tool.handler({
        siteUrl: 'https://other.com',
        username: 'other',
        appPassword: 'xxxx',
      });

      expect(result.content[0].text).toContain('Already connected as Gary');
      expect(result.content[0].text).toContain('wp_disconnect');
      expect(result.isError).toBeUndefined();
      expect(editingSession.connect).not.toHaveBeenCalled();
    });
  });

  describe('wp_disconnect', () => {
    it('calls session.disconnect and returns confirmation', async () => {
      const tool = server.registeredTools.get('wp_disconnect');
      assertDefined(tool);
      const result = await tool.handler({});

      expect(session.disconnect).toHaveBeenCalled();
      expect(result.content[0].text).toBe('Disconnected from WordPress.');
    });
  });
});
