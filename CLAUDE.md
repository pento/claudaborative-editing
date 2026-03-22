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
- `src/wordpress/` — REST API client, HTTP polling sync client
- `src/yjs/` — Y.Doc management, block ↔ Yjs conversion, sync protocol encoding
- `src/session/` — Connection lifecycle, awareness/presence
- `src/tools/` — MCP tool handlers (connect, posts [open/close/create], read, edit, status)
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

## MCP Server Usage

The MCP server reconnects to WordPress automatically on restart using stored credentials/environment variables. You generally do **not** need to call `wp_connect` — check `wp_status` first. Only use `wp_connect` if the status shows disconnected and the user explicitly provides credentials.
