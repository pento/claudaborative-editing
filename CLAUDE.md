# claudaborative-editing

MCP server enabling Claude Code to collaboratively edit WordPress posts via Gutenberg's real-time collaborative editing (Yjs CRDT) protocol.

## Build & Test

```bash
npm install
npm run build        # Build with tsup → dist/
npm test             # Run vitest
npm run typecheck    # TypeScript type check
npm run dev          # Watch mode build
```

## Architecture

```txt
Claude Code  <--stdio-->  MCP Server (Node.js)  <--HTTP polling-->  WordPress
                           ├─ Yjs Y.Doc (in memory)                  /wp-sync/v1/updates
                           ├─ Sync client (polling loop)
                           ├─ Block converter (Y.Doc ↔ Block model)
                           └─ Awareness (presence as "Claude")
```

### Source Layout

- `src/index.ts` — Entry point: CLI flags (`--version`, `--help`, `setup`) then MCP server
- `src/server.ts` — MCP server setup, tool registration, version export
- `src/cli/setup.ts` — Interactive setup wizard (credential validation, outputs `claude mcp add` command)
- `src/wordpress/` — REST API client, HTTP polling sync client, MIME type detection
- `src/yjs/` — Y.Doc management, block ↔ Yjs conversion, sync protocol encoding
- `src/session/` — Connection lifecycle, awareness/presence
- `src/tools/` — MCP tool handlers (connect, posts [open/close/create], read, edit, media, metadata, notes, status)
- `src/blocks/` — Gutenberg HTML parser, Claude-friendly renderer
- `tests/` — Unit and integration tests

### Session State Machine

```txt
disconnected ──connect──→ connected ──openPost/createPost──→ editing
                  ↑            ↑                                 │
                  │            └────────closePost─────────────────┘
                  └──────────────────disconnect───────────────────┘
```

`wp_close_post` returns to `connected` state (can open another post). `wp_disconnect` tears down the entire connection.

### Key Design Decisions

- **V1 encoding**: All Yjs updates use `encodeStateAsUpdate`/`applyUpdate` (V1). This matches Gutenberg's encoding. The sync_step1/step2 handshake uses y-protocols standard encoding (also V1 internally).
- **yjs pinned to 13.6.29**: Must match the version Gutenberg uses. Different versions can produce incompatible binary updates.
- **Rich-text attributes**: Block attributes whose type is `rich-text` in the block schema (e.g., `core/paragraph` `content`) are stored as `Y.Text` in the Y.Doc. Other attributes are plain values. Rich-text detection is handled by `BlockTypeRegistry` in `src/yjs/block-type-registry.ts`.
- **Room format**: `postType/{type}:{id}` (e.g., `postType/post:123`)
- **Block-level editing**: Claude edits at block granularity to preserve CRDT merge semantics. Full-content replacement would lose concurrent edits.
- **Dynamic block type registry**: During `connect()`, all block types are fetched from `GET /wp/v2/block-types` and a `BlockTypeRegistry` is built. This registry maps every block type to its rich-text attributes, default values, attribute schemas, and nesting constraints (`parent`, `ancestor`, `allowedBlocks`). Any block type registered on the WordPress site (core, third-party plugin, or custom) can be inserted — there is no hardcoded allowlist. If the API call fails, the registry falls back to a small hardcoded subset of core block types (with validation skipped for unknown types).
- **Block insertion validation**: When inserting blocks (with an API-sourced registry), `prepareBlockTree()` validates: (1) block type exists, (2) `content` parameter is only used for blocks with a `content` attribute, (3) all provided attributes exist in the block schema, (4) inner blocks satisfy their `parent` constraint, (5) inner blocks are in the parent's `allowedBlocks` list. Use the `wp_block_types` tool to look up a block's schema before inserting unfamiliar block types.
- **Delta-based text updates**: Rich-text updates use `Y.Text.applyDelta()` with a common-prefix/common-suffix diff algorithm. Delta operations are position-based (retain/delete/insert), not CRDT-item-ID-based, so they work regardless of which client created the underlying items. This is critical for live sync with Gutenberg, which creates local Y.Text items via `applyChangesToCRDTDoc` alongside remote items. The legacy `updateYText()` (full replacement) is preserved but not used in editing paths.

### Sync Protocol

The WordPress sync endpoint is `POST /wp-sync/v1/updates`. Each request:

1. Sends local updates + awareness state
2. Receives remote updates + awareness + end_cursor
3. Tracks cursor for at-most-once delivery

Update types: `sync_step1` (state vector), `sync_step2` (missing updates response), `update` (regular change), `compaction` (full state merge).

### Multi-Room Sync

The `SyncClient` supports multiple Yjs rooms in a single HTTP polling loop. WordPress Gutenberg uses separate rooms for different data types (e.g., `postType/post:{id}` for block content, `root/comment` for notes). All rooms are sent/received in a single HTTP request for efficiency.

- **`start(room, clientId, initialUpdates, callbacks)`** — Starts polling with one room (backward-compatible).
- **`addRoom(room, clientId, initialUpdates, callbacks)`** — Adds an additional room to the polling loop. The room joins the next poll cycle.
- **`removeRoom(room)`** — Removes a room. Stops polling if no rooms remain.
- **`queueUpdate(room, update)`** — Queues an update for a specific room.
- Each room has its own `endCursor`, `updateQueue`, `queuePaused`, `hasCollaborators`, and `RoomCallbacks`.
- `onStatusChange` is global (HTTP-level), not per-room.
- Collaborator-aware polling interval: if ANY room has collaborators, all rooms poll faster.

### Streaming Text Effect

Rich-text edits (inserts and updates) are streamed to the browser in small chunks so changes appear progressively, like fast typing. This is implemented in `SessionManager.streamTextToYText()`.

**Constants** (defined in `src/session/session-manager.ts`):

- `STREAM_CHUNK_SIZE_MIN = 2` / `STREAM_CHUNK_SIZE_MAX = 6` — randomized chunk size per iteration for a natural typing feel
- `STREAM_CHUNK_DELAY_MS = 200` — delay between chunks
- `STREAM_THRESHOLD = 20` — minimum text length to trigger streaming; shorter text is applied atomically

**Behavior**:

- Deletions are applied atomically (old text disappears immediately)
- Insertions are split into HTML-safe chunks (~20 chars) to avoid malformed intermediate states
- Each chunk is applied in its own `doc.transact()` and flushed via `SyncClient.flushQueue()`
- `flushQueue()` cancels the scheduled poll timer and triggers an immediate poll, with re-entrancy protection to prevent concurrent HTTP requests
- `removeBlocks()`, `moveBlock()`, and `save()` are not streamed (no text content)
- Default block attributes (e.g., `dropCap: false` for `core/paragraph`) are applied automatically from the block type schema to prevent Gutenberg from marking blocks as invalid

## Block Type Support

Block types are auto-discovered from the WordPress REST API (`GET /wp/v2/block-types`) during `connect()`. No code changes are needed to support new core blocks, third-party plugin blocks, or custom blocks — they are automatically available once registered on the WordPress site.

The `BlockTypeRegistry` (`src/yjs/block-type-registry.ts`) handles:

- **Rich-text detection**: `type === "rich-text"` OR `source === "rich-text"` OR `source === "html"`
- **Default extraction**: Every attribute with a `"default"` field in the schema
- **Attribute schema storage**: Full attribute schemas for validating attribute names on insertion
- **Nesting constraints**: `parent`, `ancestor`, and `allowedBlocks` from the API for validating block hierarchy
- **Block type lookup**: `wp_block_types` tool exposes the registry for schema inspection before inserting blocks

If the API call fails (e.g., insufficient permissions), a hardcoded fallback covering ~12 core block types is used, with all validation skipped.

## CLI

The entry point (`src/index.ts`) handles CLI flags before starting the MCP server:

- `--version` / `-v` — prints version from `package.json` (injected at build time via tsup `define`)
- `--help` / `-h` — prints usage
- `setup` — runs interactive setup wizard (`src/cli/setup.ts`)
- No args — starts the MCP server (stdio transport)

The version is injected at build time: `tsup.config.ts` reads `package.json` and defines `__PKG_VERSION__`, which `src/server.ts` exports as `VERSION`.

## npm Publishing

- `package.json` has `"files": ["dist"]` — only `dist/` ships in the tarball
- `prepublishOnly` runs typecheck, tests, and build
- GitHub Actions: `.github/workflows/publish.yml` publishes on GitHub release creation
- CI: `.github/workflows/ci.yml` runs on push/PR with Node 20+22 matrix

## Environment Variables

- `WP_SITE_URL` — WordPress site URL (optional, can use `wp_connect` tool instead)
- `WP_USERNAME` — WordPress username
- `WP_APP_PASSWORD` — WordPress Application Password

## Media Upload

The `wp_upload_media` tool uploads a local file to the WordPress media library via `POST /wp/v2/media`. It returns the attachment ID, URL, MIME type, and dimensions, along with block insertion hints.

Different media block types use different attribute names for the media reference:

| Block             | ID attr   | URL attr   | Extra required attrs              |
| ----------------- | --------- | ---------- | --------------------------------- |
| `core/image`      | `id`      | `url`      |                                   |
| `core/video`      | `id`      | `src`      |                                   |
| `core/audio`      | `id`      | `src`      |                                   |
| `core/cover`      | `id`      | `url`      | `backgroundType: "image"/"video"` |
| `core/media-text` | `mediaId` | `mediaUrl` | `mediaType: "image"/"video"`      |
| `core/file`       | `id`      | `href`     |                                   |
| `core/gallery`    | N/A       | N/A        | Uses inner `core/image` blocks    |

The tool response includes a context-appropriate insertion hint based on the uploaded file's MIME type. MIME type detection is handled by `src/wordpress/mime-types.ts` using a static extension-to-MIME map (no external dependencies). Supported formats include common image, video, audio, and document types.

## Notes (Block Comments)

Notes are editorial comments attached to individual blocks, visible in the WordPress editor but not shown to site visitors. They require WordPress 6.9 or later. Support is auto-detected during `connect()` via a probe to `GET /wp/v2/comments?type=note`.

### Architecture

Notes use a dual-path architecture — the WordPress REST API for note content CRUD, and Yjs for block metadata linkage and real-time sync:

- **REST API** (`/wp/v2/comments` with `type=note`): Create, read, update, and delete note content. Notes are stored as `wp_comments` with `comment_type = 'note'`.
- **Yjs post room** (`postType/post:{id}`): The `metadata.noteId` attribute on a block links it to a note. This metadata propagates via normal Yjs sync so all collaborators see note indicators in Gutenberg.
- **Yjs comment room** (`root/comment`): A separate Y.Doc whose `state` map (savedAt/savedBy) acts as a change signal. When updated, other clients re-fetch notes from the REST API, enabling real-time note visibility.

### Tools

- `wp_list_notes` — List all notes on the current post with author, date, content, and block association. Replies are nested under parent notes.
- `wp_add_note` — Add a note to a block. Creates the note via REST API and sets `metadata.noteId` on the block.
- `wp_reply_to_note` — Reply to an existing note (threaded replies).
- `wp_resolve_note` — Delete a note and its replies, removing the metadata linkage from the block.
- `wp_update_note` — Update note text content.

### Key details

- One note per block. To add feedback to a block that already has a note, reply to the existing note.
- `wp_read_post` shows `[has note]` markers on blocks that have notes. Use `wp_list_notes` to read note content.
- Resolving a note also deletes all its replies (cascade delete).
- The `notesSupported` flag on `SessionManager` gates all note operations — tools return a descriptive error on older WordPress versions.

## Post Metadata

Post metadata (status, categories, tags, excerpt, featured image, date, slug, sticky, comment status) can be managed via the `wp_set_*` tools. `wp_read_post` includes metadata in its output.

### Dual-Update Pattern

All metadata updates write to both the Y.Doc (for collaborative sync) and the REST API (for persistence):

1. Y.Doc properties are set via `documentManager.setProperty()` within a `LOCAL_ORIGIN` transaction, then flushed via `syncClient.flushQueue()` so Gutenberg browser sessions see the change immediately.
2. The REST API is called via `apiClient.updatePost()` to persist the change, and `currentPost` is refreshed from the response.

This ensures changes survive even if no save is triggered, and that collaborators see updates in real time.

### Category/Tag Resolution

`wp_set_categories` and `wp_set_tags` accept term names (not IDs). Resolution:

1. Search WordPress for an exact case-insensitive name match (`GET /wp/v2/{categories|tags}?search=...`, then filter for exact match since WordPress search is substring-based)
2. If not found, create the term (`POST /wp/v2/{categories|tags}`)
3. Collect IDs and update the post

Both tools replace all existing terms (not append).

### Tools

- `wp_list_categories` — List existing categories (with optional search filter)
- `wp_list_tags` — List existing tags (with optional search filter)
- `wp_set_status` — Change publication status (draft, pending, publish, private, future)
- `wp_set_categories` — Assign categories by name (creates if needed, replaces existing)
- `wp_set_tags` — Assign tags by name (creates if needed, replaces existing; empty array removes all)
- `wp_set_excerpt` — Set or clear the post excerpt
- `wp_set_featured_image` — Set featured image by attachment ID (0 to remove)
- `wp_set_date` — Set publication date (ISO 8601; empty string to reset)
- `wp_set_slug` — Set URL slug (WordPress may auto-modify for uniqueness)
- `wp_set_sticky` — Pin/unpin on front page
- `wp_set_comment_status` — Enable/disable comments (open/closed)

## MCP Server Usage

The MCP server reconnects to WordPress automatically on restart using stored credentials/environment variables. You generally do **not** need to call `wp_connect` — check `wp_status` first. Only use `wp_connect` if the status shows disconnected and the user explicitly provides credentials.
