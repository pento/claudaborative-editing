/**
 * WordPress REST API and sync protocol types.
 *
 * These types match the wire format used by the Gutenberg HTTP polling
 * sync provider at POST /wp-sync/v1/updates.
 */

// --- Sync Protocol Types ---

export enum SyncUpdateType {
  SYNC_STEP_1 = 'sync_step1',
  SYNC_STEP_2 = 'sync_step2',
  UPDATE = 'update',
  COMPACTION = 'compaction',
}

/** A single typed update with base64-encoded Yjs binary data. */
export interface SyncUpdate {
  type: SyncUpdateType;
  data: string; // base64-encoded Yjs V2 update
}

/** Awareness state: null means disconnected. */
export type LocalAwarenessState = object | null;

/** Server-side awareness: map of clientId (as string) → state object. */
export type AwarenessState = Record<string, LocalAwarenessState>;

// --- Client → Server ---

export interface SyncEnvelopeFromClient {
  room: string;
  client_id: number;
  after: number;
  awareness: LocalAwarenessState;
  updates: SyncUpdate[];
}

export interface SyncPayload {
  rooms: SyncEnvelopeFromClient[];
}

// --- Server → Client ---

export interface SyncEnvelopeFromServer {
  room: string;
  end_cursor: number;
  awareness: AwarenessState;
  updates: SyncUpdate[];
  should_compact?: boolean;
  compaction_request?: SyncUpdate[]; // deprecated
}

export interface SyncResponse {
  rooms: SyncEnvelopeFromServer[];
}

// --- WordPress REST API Types ---

/** WordPress post as returned by the REST API (subset of fields we care about). */
export interface WPPost {
  id: number;
  title: { rendered: string; raw?: string };
  content: { rendered: string; raw?: string };
  excerpt: { rendered: string; raw?: string };
  status: string;
  type: string;
  slug: string;
  author: number;
  date: string | null;
  modified: string;
  categories?: number[];
  tags?: number[];
  featured_media?: number;
  comment_status?: string;
  ping_status?: string;
  sticky?: boolean;
  format?: string;
  meta?: Record<string, unknown>;
}

/** WordPress taxonomy term (category or tag) as returned by the REST API. */
export interface WPTerm {
  id: number;
  name: string;
  slug: string;
  taxonomy: string;
  count?: number;
  parent?: number;
}

/** WordPress user as returned by /wp/v2/users/me. */
export interface WPUser {
  id: number;
  name: string | null;
  slug: string;
  avatar_urls: Record<string, string> | null;
}

// --- Block Type API Types ---

/** A single attribute definition from the block type schema. */
export interface WPBlockTypeAttribute {
  type: string; // "rich-text", "string", "boolean", "number", "integer", "array", "object"
  source?: string; // "rich-text", "html", "attribute", "text", "query"
  default?: unknown;
  role?: string;
}

/** A block type as returned by GET /wp/v2/block-types. */
export interface WPBlockType {
  name: string;
  title?: string;
  attributes: Record<string, WPBlockTypeAttribute> | null;
  /** Block types this block can be nested inside. Null/empty = any parent. */
  parent?: string[] | null;
  /** Ancestor blocks (more flexible than parent — any ancestor, not just direct). */
  ancestor?: string[] | null;
  /** Block types allowed as direct children. Null = any, string[] = restricted list. */
  allowed_blocks?: string[] | null;
}

// --- Media API Types ---

/** WordPress media item as returned by POST /wp/v2/media. */
export interface WPMediaItem {
  id: number;
  source_url: string;
  title: { rendered: string; raw?: string };
  caption: { rendered: string; raw?: string };
  alt_text: string;
  mime_type: string;
  media_details: {
    width?: number;
    height?: number;
    sizes?: Record<string, { source_url: string; width: number; height: number }>;
  };
}

// --- Notes (Block Comments) API Types ---

/** WordPress note (comment_type = 'note') as returned by /wp/v2/comments. */
export interface WPNote {
  id: number;
  post: number;
  parent: number; // 0 = top-level, >0 = reply to that note ID
  author: number;
  author_name: string;
  date: string;
  content: { rendered: string; raw?: string };
  status: string; // 'hold', 'approved', etc.
  type: string; // always 'note'
}

// --- Connection Config ---

export interface WordPressConfig {
  siteUrl: string;
  username: string;
  appPassword: string;
}

// --- Sync Client Config ---

export interface SyncClientConfig {
  /** Polling interval in ms when editing solo. */
  pollingInterval: number;
  /** Polling interval in ms when collaborators are present. */
  pollingIntervalWithCollaborators: number;
  /** Max exponential backoff in ms on error. */
  maxErrorBackoff: number;
}

export const DEFAULT_SYNC_CONFIG: SyncClientConfig = {
  pollingInterval: 1000,
  pollingIntervalWithCollaborators: 250,
  maxErrorBackoff: 30_000,
};
