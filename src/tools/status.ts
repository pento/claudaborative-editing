import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/session-manager.js';

export function registerStatusTools(server: McpServer, session: SessionManager): void {
  server.tool(
    'wp_status',
    'Show current connection state, sync status, and post info',
    {},
    async () => {
      const state = session.getState();
      const lines: string[] = [];

      if (state === 'disconnected') {
        lines.push('Connection: disconnected');
        lines.push('');
        lines.push('Use wp_connect to connect to a WordPress site.');
      } else {
        const user = session.getUser();
        lines.push('Connection: connected');
        lines.push(`User: ${user?.name ?? 'unknown'} (ID: ${user?.id ?? '?'})`);

        lines.push(`Notes: ${session.getNotesSupported() ? 'supported' : 'not supported (requires WordPress 6.9+)'}`);

        const post = session.getCurrentPost();
        if (state === 'editing' && post) {
          const syncStatus = session.getSyncStatus();
          const collaboratorCount = session.getCollaborators().length;

          lines.push(`Sync: ${syncStatus?.isPolling ? 'polling' : 'stopped'} (${collaboratorCount + 1} collaborator${collaboratorCount + 1 !== 1 ? 's' : ''})`);
          lines.push(`Post: "${post.title.raw ?? post.title.rendered}" (ID: ${post.id}, status: ${post.status})`);
          lines.push(`Queue: ${syncStatus?.queueSize ?? 0} pending updates`);
        } else {
          lines.push('Post: none open');
          lines.push('');
          lines.push('Use wp_open_post or wp_create_post to start editing.');
        }
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    },
  );

  server.tool(
    'wp_collaborators',
    'List active collaborators on the current post',
    {},
    async () => {
      try {
        const state = session.getState();
        if (state !== 'editing') {
          return {
            content: [{ type: 'text' as const, text: 'No post is currently open for editing.' }],
            isError: true,
          };
        }

        const collaborators = session.getCollaborators();
        const user = session.getUser();

        const lines: string[] = ['Active collaborators:'];

        // Add ourselves first
        if (user) {
          lines.push(`- ${user.name} (AI, Claude Code MCP)`);
        }

        // Add remote collaborators
        for (const collab of collaborators) {
          lines.push(`- ${collab.name} (Human, ${collab.browserType})`);
        }

        if (collaborators.length === 0 && !user) {
          lines.push('- No collaborators detected');
        }

        return {
          content: [{ type: 'text' as const, text: lines.join('\n') }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Failed to get collaborators: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    'wp_save',
    'Save the current post',
    {},
    async () => {
      try {
        session.save();
        const post = session.getCurrentPost();
        return {
          content: [{
            type: 'text' as const,
            text: `Post "${post?.title.raw ?? post?.title.rendered ?? 'Untitled'}" saved.`,
          }],
        };
      } catch (error) {
        return {
          content: [{ type: 'text' as const, text: `Failed to save: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    },
  );
}
