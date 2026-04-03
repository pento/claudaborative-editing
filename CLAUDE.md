# claudaborative-editing

MCP server enabling Claude Code to collaboratively edit WordPress posts via Gutenberg's real-time collaborative editing (Yjs CRDT) protocol.

## Build & Test

```bash
npm install
npm run build        # Build with tsup → dist/
npm test             # Run vitest
npm run typecheck    # TypeScript type check
npm run lint         # ESLint + markdownlint + Prettier check
npm run lint:fix     # Auto-fix all lint and formatting issues
npm run dev          # Watch mode build
```

## Git Hooks

Pre-commit hook (via husky + lint-staged) auto-formats with Prettier and lints with ESLint + markdownlint on staged files. Hooks are installed automatically by `npm install` (husky's `prepare` script).

## Architecture

```txt
Claude Code  <--stdio-->  MCP Server (Node.js)  <--HTTP polling-->  WordPress
                           ├─ Yjs Y.Doc (in memory)                  /wp-sync/v1/updates
                           ├─ Sync client (polling loop)
                           ├─ Block converter (Y.Doc ↔ Block model)
                           ├─ Awareness (presence as "Claude")
                           └─ Command listener (SSE/polling)          /wpce/v1/commands
```

### Source Layout

- `shared/commands.ts` — Shared command definitions (slugs, args, statuses, transitions) consumed by MCP server, WP plugin TS, and WP plugin PHP (via generated file)
- `bin/generate-php-defs.js` — Generates `wordpress-plugin/includes/class-command-defs.php` from `shared/commands.ts`. Requires Node 22.6+ (`--experimental-strip-types`). Run: `npm run generate:php-defs`
- `src/index.ts` — Entry point: CLI flags (`--version`, `--help`, `setup`) then MCP server
- `src/server.ts` — MCP server setup, tool/prompt registration, version export
- `src/cli/setup.ts` — Interactive setup wizard (browser-based auth, multi-client config writing)
- `src/cli/types.ts` — Shared CLI types (McpClientType, McpClientConfig, WpCredentials, SetupOptions)
- `src/cli/clients.ts` — MCP client registry, detection, platform path resolution
- `src/cli/config-writer.ts` — JSON config read/merge/write for MCP client settings files
- `src/cli/auth-server.ts` — WordPress Application Password auth with localhost HTTP callback (WP 7.0+) and fallback to non-callback auth page on older versions
- `src/wordpress/` — REST API client, HTTP polling sync client, command client, MIME type detection
- `src/wordpress/command-client.ts` — REST methods for plugin command endpoints + SSE/polling transport
- `src/yjs/` — Y.Doc management, block ↔ Yjs conversion, sync protocol encoding
- `src/session/` — Connection lifecycle, awareness/presence, command handler
- `src/session/command-handler.ts` — Command listener lifecycle, channel notification dispatch
- `src/tools/` — MCP tool handlers (connect, posts, read, edit, media, metadata, notes, commands, status)
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

### Channel Capability and Command Listener

The MCP server declares the `claude/channel` experimental capability and includes instructions telling Claude how to handle channel notifications from the WordPress editor plugin. This enables users in the WordPress Gutenberg editor to trigger actions (proofread, review, edit, translate) that are forwarded to Claude Code.

**Plugin detection**: During `connect()`, after validating the sync endpoint, the session manager probes `GET /wpce/v1/status`. If the plugin is detected, a `CommandHandler` is created and the command listener starts. If the plugin is not installed (404), command features are silently disabled.

**Command listener lifecycle**:

- Starts automatically after successful `connect()` if the WordPress editor plugin is detected
- Runs continuously in the `connected` state — independent of the sync loop, does not require a post to be open
- Stops on `disconnect()`
- Uses SSE as primary transport with REST polling as fallback

**Transport abstraction** (`CommandClient`):

- **SSE (primary)**: Opens `GET /wpce/v1/commands/stream` with Application Password auth. Parses Server-Sent Events from the response stream. Reconnects automatically when the connection drops (server closes after ~5 minutes). Uses exponential backoff on errors.
- **Polling (fallback)**: Falls back to `GET /wpce/v1/commands?status=pending` polling every 5 seconds after 3 failed SSE attempts. Periodically retries SSE (every 60 seconds) to recover when the connection issue was transient.

**Command flow**: When a command arrives (via SSE or polling), the handler pushes a channel notification to Claude Code via `server.server.notification()` **without claiming** the command. The claim happens when Claude calls `wp_update_command_status("running")`, which performs an atomic `pending → running` transition on the WordPress side (409 on conflict). This design ensures that instances whose clients ignore the notification (e.g., channels not enabled) never claim commands, leaving them available for channel-capable instances.

**Channel notification format**: The `notifications/claude/channel` notification includes a `content` field describing the request and `meta` fields with `command_id`, `prompt`, `post_id`, and optionally `arguments`. Claude Code wraps this as a `<channel source="wpce">` tag (source is set automatically from the server name).

**Notification buffering**: During auto-connect, the command handler may start before the `McpServer` is created and the notifier callback is wired. Notifications are buffered and flushed when `setChannelNotifier()` is called from `server.ts`.

### Post Deletion Detection

When a post is deleted or trashed externally while the MCP server has it open, the system detects this and blocks further editing operations. Two detection paths cover both scenarios:

- **Permanent deletion**: The sync endpoint returns a 403/404/410 error. The sync client passes the error to `onStatusChange`, and the session manager fires an async `checkPostStillExists()` via the REST API to confirm (guards against transient errors).
- **Trashing**: Trashing is a direct database status change that bypasses the Y.Doc, so it's not visible through sync. A periodic REST API health check (`postHealthCheckInterval`, default 30s) calls `checkPostStillExists()` which detects `status: 'trash'` on the response.

Both paths set the `postGone` flag. All editing operations use `requireEditablePost()` (not `requireState('editing')`) which checks this flag and throws a descriptive error suggesting `wp_close_post`. `closePost()` is exempt — it uses `requireState('editing')` directly so users can clean up. The flag is reset in `closePost()`.

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

## Shared Command Definitions

`shared/commands.ts` is the single source of truth for command-related data shared between the MCP server, WP plugin JS, and WP plugin PHP. It defines:

- `CommandSlug` type and `COMMANDS` record — all command definitions with slugs, labels, descriptions, progress labels, and argument schemas
- `CommandStatus` type, `TERMINAL_STATUSES`, and `VALID_TRANSITIONS` — command lifecycle constants

**Consumers:**

- **MCP server** imports directly from `shared/commands.ts`. The `Command` interface in `src/wordpress/command-client.ts` uses `CommandSlug` and `CommandStatus` types. Channel instructions in `src/server.ts` are generated dynamically from `COMMANDS`.
- **WP plugin TS** imports types and constants from `shared/commands.ts`. UI-facing strings go through `src/utils/command-i18n.ts` which wraps each string in `__()` for WordPress i18n extraction.
- **WP plugin PHP** uses `includes/class-command-defs.php` (auto-generated by `bin/generate-php-defs.js`). The `REST_Controller` references `Command_Defs::ALLOWED_PROMPTS` and `Command_Defs::VALID_TRANSITIONS`.

**Adding a new command:** Add the definition to `shared/commands.ts`, add its i18n strings to `wordpress-plugin/src/utils/command-i18n.ts`, run `npm run generate:php-defs`, then add the corresponding MCP prompt handler in `src/prompts/`.

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

## Command Status

- `wp_update_command_status` — Update the status of a command received from the WordPress editor via a channel notification. Parameters: `commandId` (number), `status` (`running` | `completed` | `failed`), `message` (optional string). Called by Claude during command execution to report progress back to the browser.

The `wp_status` tool reports plugin detection state, version, protocol version, and command listener transport (SSE/polling/disabled) when the WordPress editor plugin is connected.

## Prompts

MCP prompts are user-invokable templates that pre-populate conversation context for common workflows. They are registered via `server.prompt()` in `src/prompts/`, following the same pattern as tool registration.

### Dynamic content

Prompt handlers check `session.getState()` at invocation time:

- **`editing`**: Post content (and notes where relevant) is embedded directly in the prompt messages to avoid extra tool-call round-trips.
- **`connected`** or **`disconnected`**: Returns instructions to open a post or connect first.

### Available prompts

| Prompt             | Description                                                                       | Arguments                 |
| ------------------ | --------------------------------------------------------------------------------- | ------------------------- |
| `edit`             | Edit a post with an optional editing focus                                        | `editingFocus` (optional) |
| `proofread`        | Fix grammar, spelling, and punctuation                                            | None                      |
| `review`           | Leave editorial notes on blocks (falls back to text summary if notes unsupported) | None                      |
| `respond-to-notes` | Address existing notes: edit blocks, reply, resolve                               | None                      |
| `respond-to-note`  | Address a single note by ID: read, edit block, resolve                            | `noteId` (required)       |
| `translate`        | Translate post content into another language                                      | `language` (required)     |

## MCP Server Usage

The MCP server reconnects to WordPress automatically on restart using stored credentials/environment variables. You generally do **not** need to call `wp_connect` — check `wp_status` first. Only use `wp_connect` if the status shows disconnected and the user explicitly provides credentials.

## WordPress Plugin

The `wordpress-plugin/` directory contains a companion WordPress plugin that adds AI action controls to the Gutenberg editor. It has its own `@wordpress/scripts` build chain but shares linting configuration with the root project.

### Plugin Build & Test

```bash
cd wordpress-plugin
npm install
npm run build          # Build with @wordpress/scripts → build/
npm run typecheck      # TypeScript type check (tsc --noEmit)
composer install
composer phpcs         # PHP CodeSniffer (WordPress-Extra)
composer phpstan       # PHPStan static analysis (level 7)
```

JS/TS linting is handled by the root ESLint config (`eslint.config.mjs`) via `@wordpress/eslint-plugin` + FlatCompat, with `typescript-eslint` parser for `.ts/.tsx` files. SCSS linting uses `@wordpress/stylelint-config/scss` with `stylelint-config-prettier-scss`. Run `npm run lint` from the repo root to lint everything (ESLint + stylelint + markdownlint + Prettier).

PHPUnit tests require wp-env:

```bash
cd wordpress-plugin && npm run test     # Typescript tests
cd wordpress-plugin && npm run test:php # PHPUnit tests (requires wp-env)
```

### Plugin Structure

- `claudaborative-editing.php` — Plugin header, bootstrap, hook registration
- `includes/class-command-store.php` — `wpce_command` CPT registration and meta fields
- `includes/class-command-formatter.php` — Converts `wpce_command` posts to REST API response shape
- `includes/class-rest-controller.php` — `WP_REST_Controller` subclass for `wpce/v1` endpoints
- `includes/class-sse-handler.php` — SSE streaming logic for real-time command delivery
- `includes/class-command-defs.php` — Auto-generated PHP class with command slugs, status transitions, and terminal statuses (from `shared/commands.ts` via `bin/generate-php-defs.js`). Committed to git for standalone plugin distribution.
- `src/` — Gutenberg editor plugin source (TypeScript, compiled by `@wordpress/scripts`)
- `src/store/types.ts` — TypeScript interfaces (`Command`, `McpStatus`, `StoreState`, etc.) — `CommandPrompt` and `CommandStatus` re-exported from `shared/commands.ts`
- `src/utils/command-i18n.ts` — WordPress i18n wrapper for command labels/descriptions/progress strings. Uses literal `__()` calls for makepot extraction.
- `src/store/index.ts` — `@wordpress/data` store (`wpce/ai-actions`) for MCP status and command state
- `src/hooks/use-mcp-status.ts` — Hook for MCP connection status polling (5s interval)
- `src/hooks/use-commands.ts` — Hook for command lifecycle management (3s polling while active)
- `src/types/` — Type declarations for `@wordpress/interface` (no shipped types)
- `src/components/AiActionsMenu/` — `DropdownMenu` in toolbar pinned items with Proofread/Review menu items
- `src/components/ConnectionStatus/` — Footer sparkle icon indicating MCP connection and command state
- `src/components/NotesIntegration/` — Injects "Address All Notes" and per-note buttons into the Gutenberg notes sidebar
- `src/components/SparkleIcon/` — Shared animated sparkle SVG icon component
- `tests/` — PHPUnit tests (WordPress test framework)

### Custom Post Type: `wpce_command`

Non-public CPT for queuing commands from the WordPress editor to the MCP server. Post meta fields: `wpce_prompt`, `wpce_arguments` (JSON), `wpce_command_status`, `wpce_claimed_by`, `wpce_message`, `wpce_expires_at`. Scoped by `post_author` (requesting user) and `post_parent` (target post).

### Command REST API (namespace: `wpce/v1`)

REST endpoints for the command queue between the browser and the MCP server. All endpoints require `edit_posts` capability and are user-scoped (commands filtered by `post_author`).

| Method   | Endpoint                   | Purpose                                                   |
| -------- | -------------------------- | --------------------------------------------------------- |
| `POST`   | `/wpce/v1/commands`        | Browser queues a command (requires `edit_post` on target) |
| `GET`    | `/wpce/v1/commands`        | List commands (filter by `post_id`, `status`, `since`)    |
| `GET`    | `/wpce/v1/commands/stream` | SSE stream of pending commands for the MCP server         |
| `PATCH`  | `/wpce/v1/commands/{id}`   | MCP updates command status                                |
| `DELETE` | `/wpce/v1/commands/{id}`   | Browser cancels a command (author only)                   |
| `GET`    | `/wpce/v1/status`          | Plugin version, protocol version, MCP connection state    |

**Command status lifecycle**: `pending` → `running` → `completed` or `failed`. Also: `pending` → `cancelled` (user cancels), `pending` → `expired` (timeout). The `pending → running` transition uses an atomic conditional update (409 on conflict) so only one MCP instance can claim a command. Expired commands are transitioned lazily on query.

**SSE stream**: Polls the database every 2s for pending commands, sends `event: command` with JSON data, heartbeat every 30s. Supports `Last-Event-ID` for reconnection. Exits after ~5 minutes (client reconnects via EventSource retry).

**MCP connection tracking**: User-scoped transient (`wpce_mcp_last_seen_{user_id}`), updated when a command transitions to `running` and on SSE stream activity. Status endpoint reports `mcp_connected` (true if last seen < 30s ago).

**Prompt validation**: Commands accept only the slugs defined in `shared/commands.ts` (`Command_Defs::ALLOWED_PROMPTS` in PHP): `proofread`, `review`, `respond-to-notes`, `respond-to-note`, `edit`, `translate`.

### Editor UI

The plugin registers three always-mounted Gutenberg plugins via `registerPlugin()`:

1. **Toolbar Dropdown** (`AiActionsMenu`) — A `DropdownMenu` in the editor toolbar's `PinnedItems` area. Contains Proofread and Review menu items with info descriptions. Each submits a command via `POST /wpce/v1/commands`. Items are disabled when Claude is not connected, a command is active, or Claude is editing a different post. The dropdown closes after submitting an action. Submission errors are shown as snackbar toasts.

2. **Footer Status** (`ConnectionStatus`) — A sparkle icon button portaled into the editor footer bar. Orange when connected, grey when disconnected. Animates (pulse + twinkle) when a command is in progress. Click toggles a popover showing plugin name, connection status, active command label, and a cancel link for pending commands (cancel only shown when connected). Uses `MutationObserver` to re-attach when the footer DOM changes (distraction-free mode, resizing). Also owns command polling (`useCommands`) and snackbar toast notifications for command completion/failure.

3. **Notes Integration** (`NotesIntegration`) — Injects buttons into Gutenberg's collaboration/notes sidebar via DOM observation and `createPortal`. "Address All Notes" button is pinned at the top of the notes panel (sticky in floating mode, sticky below header in full mode). Per-note sparkle buttons appear on each root thread's action bar. Uses `respond-to-notes` and `respond-to-note` prompts respectively.

**Data layer:** `@wordpress/data` store `wpce/ai-actions` manages MCP status and command queue state. Custom hooks `useMcpStatus()` (5s polling) and `useCommands(postId)` (3s polling while command active) provide reactive access. Store actions use `@wordpress/api-fetch` thunks for REST API calls.

**Asset loading:** `enqueue_block_editor_assets` hook loads `build/index.js` + `style-index.css` with dependencies auto-detected from `index.asset.php` (generated by `@wordpress/scripts`).
