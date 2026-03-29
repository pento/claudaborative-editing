/**
 * Yjs document types matching the Gutenberg CRDT structure.
 *
 * Verified from @wordpress/sync and @wordpress/core-data source code.
 * The Y.Doc has two root Y.Maps: 'document' and 'state'.
 */
import * as Y from 'yjs';

// --- Root-level keys ---

export const CRDT_RECORD_MAP_KEY = 'document';
export const CRDT_STATE_MAP_KEY = 'state';
export const CRDT_STATE_MAP_VERSION_KEY = 'version';
export const CRDT_STATE_MAP_SAVED_AT_KEY = 'savedAt';
export const CRDT_STATE_MAP_SAVED_BY_KEY = 'savedBy';
export const CRDT_DOC_VERSION = 1;

// --- Block types ---

/** Block attributes map: rich-text attributes are Y.Text, others are plain values. */
export type YBlockAttributes = Y.Map<unknown>;

/** A plain-object block for reading/writing (not Yjs types). */
export interface Block {
	name: string;
	clientId: string;
	attributes: Record<string, unknown>;
	innerBlocks: Block[];
	isValid?: boolean;
	originalContent?: string;
}

// --- Collaborator awareness ---

export interface CollaboratorInfo {
	id: number;
	name: string;
	slug: string;
	avatar_urls: Record<string, string>;
	browserType: string;
	enteredAt: number;
}

export interface AwarenessCursorPosition {
	relativePosition: {
		type: { client: number; clock: number };
		tname: null;
		item: null;
		assoc: number;
	};
	absoluteOffset: number;
}

export interface AwarenessEditorState {
	selection:
		| { type: 'none' }
		| { type: 'cursor'; cursorPosition: AwarenessCursorPosition };
}

export interface AwarenessLocalState {
	collaboratorInfo: CollaboratorInfo;
	editorState?: AwarenessEditorState;
}
