# claudaborative-editing

MCP server enabling Claude Code to collaboratively edit WordPress posts via Gutenberg's real-time collaborative editing (Yjs CRDT) protocol.

## Build & Test

```bash
npm install
npm run build        # Build with tsup → dist/
npm test             # Run vitest
npm run typecheck    # TypeScript type check
npm run lint         # ESLint + markdownlint
npm run lint:fix     # Auto-fix lint issues
npm run format       # Format with Prettier
npm run format:check # Check formatting without writing
npm run dev          # Watch mode build
```

## Git Hooks

Pre-commit hook auto-formats (Prettier) and lints (ESLint, markdownlint) staged files.

```bash
git config core.hooksPath .githooks   # One-time setup
```

The test suite verifies this is configured (skipped in CI).

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
- `src/server.ts` — MCP server setup, tool/prompt registration, version export
- `src/cli/setup.ts` — Interactive setup wizard (browser-based auth, multi-client config writing)
- `src/cli/types.ts` — Shared CLI types (McpClientType, McpClientConfig, WpCredentials, SetupOptions)
- `src/cli/clients.ts` — MCP client registry, detection, platform path resolution
- `src/cli/config-writer.ts` — JSON config read/merge/write for MCP client settings files
- `src/cli/auth-server.ts` — WordPress Application Password auth with localhost HTTP callback (WP 7.0+) and fallback to non-callback auth page on older versions
- `src/wordpress/` — REST API client, HTTP polling sync client, MIME type detection
- `src/yjs/` — Y.Doc management, block ↔ Yjs conversion, sync protocol encoding
- `src/session/` — Connection lifecycle, awareness/presence
- `src/tools/` — MCP tool handlers (connect, posts, read, edit, media, metadata, notes, status)
- `src/prompts/` — MCP prompt handlers (editing, review, authoring)
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

- **Mixed V1/V2 encoding**: Gutenberg 22.8+ uses a mixed encoding approach. Sync step1/step2 use y-protocols' standard encoding (V1 internally — `syncProtocol.readSyncMessage` hardcodes `Y.encodeStateAsUpdate`/`Y.applyUpdate`). Regular updates and compactions use V2 encoding (`encodeStateAsUpdateV2`/`applyUpdateV2`, captured via `doc.on('updateV2')`). This split exists because Gutenberg switched updates/compactions to V2 (PR #76304) but still uses y-protocols for the sync handshake. Minimum compatible Gutenberg version: 22.8.
- **Version discovery**: During setup, `getWordPressVersion()` fetches `GET /wp-json/` to display the site's WordPress version. This is informational only — actual compatibility is gated by the sync endpoint check (`validateSyncEndpoint()`). If the sync endpoint is unavailable and the version is known, the error message includes the detected version and suggests upgrading to WordPress 7.0+ or Gutenberg plugin 22.8+.
- **yjs pinned to 13.6.29**: Must match the version Gutenberg uses. Different versions can produce incompatible binary updates.
- **Rich-text attributes**: Block attributes whose type is `rich-text` in the block schema (e.g., `core/paragraph` `content`) are stored as `Y.Text` in the Y.Doc. Other attributes are plain values. Rich-text detection is handled by `BlockTypeRegistry` in `src/yjs/block-type-registry.ts`.
- **Room format**: `postType/{type}:{id}` (e.g., `postType/post:123`)
- **Block-level editing**: Claude edits at block granularity to preserve CRDT merge semantics. Full-content replacement would lose concurrent edits.
- **Surgical text editing**: `wp_edit_block_text` applies find-and-replace operations directly on Y.Text using position-based deltas. All edits are atomic (no streaming). The Y.Text is re-read between each edit to get correct positions after previous edits. Preferred over `wp_update_block` for small corrections (typos, grammar) because it only touches the targeted text, preserving concurrent edits from other collaborators.
- **Dynamic block type registry**: During `connect()`, all block types are fetched from `GET /wp/v2/block-types` and a `BlockTypeRegistry` is built. This registry maps every block type to its rich-text attributes, default values, attribute schemas, nesting constraints (`parent`, `ancestor`, `allowedBlocks`), and InnerBlocks capability (`supports.allowedBlocks`). Any block type registered on the WordPress site (core, third-party plugin, or custom) can be inserted — there is no hardcoded allowlist. If the API call fails, the registry falls back to a small hardcoded subset of core block types (with validation skipped for unknown types).
- **Block insertion validation**: When inserting blocks (with an API-sourced registry), `prepareBlockTree()` validates: (1) block type exists, (2) `content` parameter is handled correctly (see content auto-wrapping below), (3) all provided attributes exist in the block schema, (4) inner blocks satisfy their `parent` constraint, (5) inner blocks are in the parent's `allowedBlocks` list. Use the `wp_block_types` tool to look up a block's schema before inserting unfamiliar block types.
- **Content auto-wrapping**: When `content` is provided for a block without a `content` attribute (e.g., `core/quote`), `prepareBlockTree()` auto-wraps it into an inner `core/paragraph`, provided the block declares InnerBlocks support via `supports.allowedBlocks === true` in the REST API and allows `core/paragraph` as a child. Blocks without InnerBlocks support (e.g., `core/pullquote`) use their own rich-text attributes directly (`value`, `citation`) and are not auto-wrapped. Only applies with the API-sourced registry.
- **Delta-based text updates**: Rich-text updates use `Y.Text.applyDelta()` with a common-prefix/common-suffix diff algorithm. Delta operations are position-based (retain/delete/insert), not CRDT-item-ID-based, so they work regardless of which client created the underlying items. This is critical for live sync with Gutenberg, which creates local Y.Text items via `applyChangesToCRDTDoc` alongside remote items.

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
- `STREAM_CHUNK_DELAY_MS = 100` — delay between chunks
- `STREAM_THRESHOLD = 20` — minimum text length to trigger streaming; shorter text is applied atomically

**Background streaming queue**: Streaming is queued for background processing so that tool calls return immediately. This eliminates the pause between paragraphs when writing multi-block content — Claude can think about the next block while the current one is still "typing."

- `insertBlock()`, `updateBlock()`, `replaceBlocks()`, `insertInnerBlock()`, and `setTitle()` commit block structures atomically (via `doc.transact()`), flush to the browser immediately, then enqueue the text streaming for background processing.
- `save()` and `closePost()` call `drainStreamQueue()` to wait for all queued streaming to complete before proceeding.
- `drainStreamQueue()` is the public API for waiting on all background streaming to finish.
- Queue entries are processed sequentially (FIFO). Errors in one entry are logged but don't block subsequent entries.

**Behavior**:

- Deletions are applied atomically (old text disappears immediately)
- Insertions are split into HTML-safe chunks (2–6 chars, randomized) to avoid malformed intermediate states
- Each chunk is applied in its own `doc.transact()` and flushed via `SyncClient.flushQueue()`
- `flushQueue()` cancels the scheduled poll timer and triggers an immediate poll, with re-entrancy protection to prevent concurrent HTTP requests
- `removeBlocks()`, `moveBlock()`, and `editBlockText()` are not streamed (no text content)
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
- `setup` — interactive setup wizard with localhost callback auth (WP 7.0+, falls back to non-callback auth page on older versions) and multi-client config writing
- `setup --manual` — skip browser auth, prompt for credentials manually
- `setup --remove` — remove claudaborative-editing config from MCP clients
- `setup --client <name>` — configure a specific client only (valid: `claude-code`, `claude-desktop`, `vscode`, `vscode-insiders`, `cursor`, `windsurf`)
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

All metadata updates write to both the REST API (for persistence) and the Y.Doc (for collaborative sync):

1. The REST API is called via `apiClient.updatePost()` to persist the change — fail fast before touching collaborative state. `currentPost` is refreshed from the response.
2. Y.Doc properties are set via `documentManager.setProperty()` within a `LOCAL_ORIGIN` transaction, using WordPress-returned canonical values where applicable, then flushed via `syncClient.flushQueue()` so Gutenberg browser sessions see the committed state.

This ensures the Y.Doc only reflects committed state — if the API call fails, neither the collaborative doc nor `currentPost` are modified.

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

## Prompts

MCP prompts are user-invokable templates that pre-populate conversation context for common workflows. They are registered via `server.prompt()` in `src/prompts/`, following the same pattern as tool registration.

### Dynamic content

Prompt handlers check `session.getState()` at invocation time:

- **`editing`**: Post content (and notes where relevant) is embedded directly in the prompt messages to avoid extra tool-call round-trips.
- **`connected`** or **`disconnected`**: Returns instructions to open a post or connect first.

### Available prompts

| Prompt             | Description                                                                       | Arguments                                                    |
| ------------------ | --------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `edit`             | Edit a post with an optional editing focus                                        | `editingFocus` (optional)                                    |
| `proofread`        | Fix grammar, spelling, and punctuation                                            | None                                                         |
| `review`           | Leave editorial notes on blocks (falls back to text summary if notes unsupported) | None                                                         |
| `respond-to-notes` | Address existing notes: edit blocks, reply, resolve                               | None                                                         |
| `draft`            | Create a new post from a topic/brief                                              | `topic` (required), `tone` (optional), `audience` (optional) |
| `translate`        | Translate post content into another language                                      | `language` (required)                                        |

## MCP Server Usage

The MCP server reconnects to WordPress automatically on restart using stored credentials/environment variables. You generally do **not** need to call `wp_connect` — check `wp_status` first. Only use `wp_connect` if the status shows disconnected and the user explicitly provides credentials.
