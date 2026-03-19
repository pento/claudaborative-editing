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

- `src/index.ts` — Entry point (stdio MCP server)
- `src/server.ts` — MCP server setup, tool registration
- `src/wordpress/` — REST API client, HTTP polling sync client
- `src/yjs/` — Y.Doc management, block ↔ Yjs conversion, sync protocol encoding
- `src/session/` — Connection lifecycle, awareness/presence
- `src/tools/` — MCP tool handlers (connect, posts, read, edit, status)
- `src/blocks/` — Gutenberg HTML parser, Claude-friendly renderer
- `tests/` — Unit and integration tests

### Key Design Decisions

- **V1 encoding**: All Yjs updates use `encodeStateAsUpdate`/`applyUpdate` (V1). This matches Gutenberg's encoding. The sync_step1/step2 handshake uses y-protocols standard encoding (also V1 internally).
- **yjs pinned to 13.6.29**: Must match the version Gutenberg uses. Different versions can produce incompatible binary updates.
- **Rich-text attributes**: Block attributes whose type is `rich-text` in the block schema (e.g., `core/paragraph` `content`) are stored as `Y.Text` in the Y.Doc. Other attributes are plain values. The known mapping is in `src/yjs/types.ts` `RICH_TEXT_ATTRIBUTES`.
- **Room format**: `postType/{type}:{id}` (e.g., `postType/post:123`)
- **Block-level editing**: Claude edits at block granularity to preserve CRDT merge semantics. Full-content replacement would lose concurrent edits.
- **Delta-based text updates**: Rich-text updates use `Y.Text.applyDelta()` with a common-prefix/common-suffix diff algorithm. Delta operations are position-based (retain/delete/insert), not CRDT-item-ID-based, so they work regardless of which client created the underlying items. This is critical for live sync with Gutenberg, which creates local Y.Text items via `applyChangesToCRDTDoc` alongside remote items. The legacy `updateYText()` (full replacement) is preserved but not used in editing paths.

### Sync Protocol

The WordPress sync endpoint is `POST /wp-sync/v1/updates`. Each request:

1. Sends local updates + awareness state
2. Receives remote updates + awareness + end_cursor
3. Tracks cursor for at-most-once delivery

Update types: `sync_step1` (state vector), `sync_step2` (missing updates response), `update` (regular change), `compaction` (full state merge).

## Adding New Block Types

To add rich-text support for a new block type, add it to `RICH_TEXT_ATTRIBUTES` in `src/yjs/types.ts`. The key is the block name, value is a `Set` of attribute names that are rich-text.

## Environment Variables

- `WP_SITE_URL` — WordPress site URL (optional, can use `wp_connect` tool instead)
- `WP_USERNAME` — WordPress username
- `WP_APP_PASSWORD` — WordPress Application Password
