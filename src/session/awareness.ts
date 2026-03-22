/**
 * Awareness protocol helpers for Claude's presence in collaborative editing.
 *
 * Builds the local awareness state identifying Claude as a collaborator
 * and parses the server's awareness state into a list of other collaborators.
 */

import type { CollaboratorInfo, AwarenessLocalState } from '../yjs/types.js';
import type { AwarenessState } from '../wordpress/types.js';
import type { WPUser } from '../wordpress/types.js';

/**
 * Build the local awareness state that identifies Claude as a collaborator.
 * This state is sent with each sync request.
 */
export function buildAwarenessState(user: WPUser): AwarenessLocalState {
  return {
    collaboratorInfo: {
      id: user.id,
      name: `${user.name} (Claude)`,
      slug: user.slug,
      avatar_urls: user.avatar_urls ?? {},
      browserType: 'Claude Code MCP',
      enteredAt: Date.now(),
    },
    // editorState with selection is required for Gutenberg to recognize us
    // as an active editor and process our CRDT updates in the live session.
    editorState: {
      selection: { type: 'none' },
    },
  };
}

/**
 * Parse the server's awareness state into a list of collaborators.
 * Excludes our own client ID and null (disconnected) states.
 */
export function parseCollaborators(
  awarenessState: AwarenessState,
  ownClientId: number,
): CollaboratorInfo[] {
  const collaborators: CollaboratorInfo[] = [];

  for (const [clientIdStr, state] of Object.entries(awarenessState)) {
    const clientId = Number(clientIdStr);
    if (clientId === ownClientId) {
      continue;
    }
    if (state === null) {
      continue;
    }
    const info = (state as { collaboratorInfo?: CollaboratorInfo }).collaboratorInfo;
    if (info) {
      collaborators.push(info);
    }
  }

  return collaborators;
}
