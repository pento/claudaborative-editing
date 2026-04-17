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
npm run dev:wp       # Start a local WordPress on http://127.0.0.1:9400 via wp-playground-cli (ephemeral, Gutenberg latest, collab enabled)
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
                           └─ Command listener (Yjs room)              root/wpce_commands_{userId}
```

### Source Layout

- `shared/` — Shared command definitions consumed by MCP server, WP plugin TS, and WP plugin PHP
- `src/cli/` — CLI commands: setup wizard, start command, auth, config writing
- `src/wordpress/` — REST API client, HTTP polling sync client, command client, MIME types
- `src/yjs/` — Y.Doc management, block ↔ Yjs conversion, sync protocol encoding
- `src/session/` — Connection lifecycle, awareness/presence, command handler
- `src/tools/` — Portable tool definitions (`ToolDefinition[]` arrays), registry, and MCP wiring
- `src/prompts/` — Portable prompt definitions (`PromptDefinition[]` arrays), registry, content builders, and MCP wiring
- `src/blocks/` — Gutenberg HTML parser, Claude-friendly renderer
- `tests/` — Unit and integration tests

### Session State Machine

```txt
disconnected ──connect──→ connected ──openPost/createPost──→ editing
                  ↑            ↑                                 │
                  │            └────────closePost─────────────────┘
                  └──────────────────disconnect───────────────────┘
```

`wp_close_post` returns to `connected` state. `wp_disconnect` tears down the entire connection.

### Key Design Decisions

- **yjs pinned to 13.6.29**: Must match the version Gutenberg uses. Different versions produce incompatible binary updates.
- **Mixed V1/V2 encoding**: Sync step1/step2 use y-protocols V1 encoding. Regular updates and compactions use V2 encoding. This split exists because Gutenberg switched updates/compactions to V2 (PR #76304) but still uses y-protocols for the sync handshake. Minimum compatible Gutenberg version: 22.8.
- **Room format**: `postType/{type}:{id}` (e.g., `postType/post:123`)
- **Block-level editing**: Claude edits at block granularity to preserve CRDT merge semantics. Full-content replacement would lose concurrent edits.
- **Rich-text attributes**: Block attributes with `type === "rich-text"` OR `source === "rich-text"` OR `source === "html"` are stored as `Y.Text`. Others are plain values. Handled by `BlockTypeRegistry`.
- **Content auto-wrapping**: When `content` is provided for a block without a `content` attribute (e.g., `core/quote`), `prepareBlockTree()` auto-wraps it into an inner `core/paragraph`, provided the block supports InnerBlocks and allows `core/paragraph` as a child.
- **Delta-based text updates**: Rich-text updates use `Y.Text.applyDelta()` with position-based ops (retain/delete/insert), not CRDT-item-IDs. Critical for live sync with Gutenberg.
- **Metadata dual-update**: All post metadata updates write to both the REST API (persistence) and the Y.Doc (collaborative sync). The Y.Doc only reflects committed state.

### Sync Protocol

Endpoint: `POST /wp-sync/v1/updates`. Each request sends local updates + awareness, receives remote updates + awareness + end_cursor. Update types: `sync_step1`, `sync_step2`, `update`, `compaction`.

### Portable Tool & Prompt Definitions

Tool and prompt definitions are decoupled from the MCP SDK so they can be consumed by both the MCP server and an external hosted orchestrator.

- **`src/tools/definitions.ts`** — `ToolDefinition` interface. Each tool file exports a `ToolDefinition[]` array. `execute(session, input)` returns `string` (success), `ToolResult` (expected error with `isError`), or throws (unexpected error).
- **`src/prompts/definitions.ts`** — `PromptDefinition` interface. Each prompt file exports a `PromptDefinition[]` array. `buildMessages(session, args)` returns simplified `{ role, content: string }` messages.
- **`src/tools/registry.ts`** — Aggregates all tools into `allTools`, provides `registerAllTools(server, session)` for MCP wiring and lookup helpers (`getToolByName`, `getToolsForState`, `getToolsByTag`).
- **`src/prompts/registry.ts`** — Same pattern for prompts. The MCP wrapper converts `PromptMessage.content` to `{ type: 'text', text }`.
- **`src/server-instructions.ts`** — Extracted channel/base instructions as pure functions.
- **Subpath exports** — `package.json` exports `./tools/definitions`, `./tools/registry`, `./prompts/definitions`, `./prompts/registry`, `./prompts/prompt-content`, `./session/session-manager`, `./server-instructions`, `./shared/commands`.

### Adding a New Tool

1. Add a `ToolDefinition` to the appropriate file in `src/tools/` (or create a new file)
2. If new file: import and spread into `allTools` in `src/tools/registry.ts`
3. Set `availableIn` (session states) and `tags` for hosted-server filtering

## Adding a New Command

1. Add the definition to `shared/commands.ts`
2. Run `npm run generate:defs` (generates PHP and i18n wrappers)
3. Add the corresponding MCP prompt handler in `src/prompts/`

## CLI

- `--version` / `-v` — prints version
- `--help` / `-h` — prints usage
- `start` — checks prerequisites, runs setup if needed, spawns Claude Code with channels
- `setup` — interactive setup wizard (browser-based auth on WP 7.0+, fallback on older)
- `setup --manual` — skip browser auth, prompt for credentials manually
- `setup --remove` — remove config from Claude Code
- No args — starts the MCP server (stdio transport)

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

## WordPress Plugin

The `wordpress-plugin/` directory contains a companion WordPress plugin that adds AI action controls to the Gutenberg editor. It has its own `@wordpress/scripts` build chain.

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

```bash
cd wordpress-plugin && npm run test     # TypeScript tests
npm run test:plugin-php                 # PHPUnit tests (runs in wp-playground-cli, from repo root)
```

PHPUnit runs inside `@wp-playground/cli` (PHP-WASM + SQLite). The first run
clones `tests/phpunit` from `wordpress-develop` into
`wordpress-plugin/.wp-tests-lib/` (gitignored). Activation is handled by
`playground/phpunit.blueprint.json`; config is in
`wordpress-plugin/tests/wp-tests-config.php`. The test library's default install
path (which forks a PHP subprocess via `system()`) is skipped with
`WP_TESTS_SKIP_INSTALL=1` because Playground already provides a fresh SQLite DB
per boot.

Run `npm run lint` from the repo root to lint everything (ESLint + stylelint + markdownlint + Prettier).
