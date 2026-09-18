# claudaborative-editing

MCP server enabling Claude Code to collaboratively edit WordPress posts via Gutenberg's real-time collaborative editing (Yjs CRDT) protocol.

## Build & Test

```bash
npm install
npm run build        # Build with tsup → dist/
npm test             # Run vitest
npm run typecheck    # TypeScript type check
npm run lint         # ESLint + stylelint + markdownlint + Prettier + knip check
npm run lint:fix     # Auto-fix all lint and formatting issues
npm run knip         # Find unused files, dependencies & exports (knip.jsonc)
npm run dev          # Watch mode build
npm run dev:wp       # Start a local WordPress on http://127.0.0.1:9400 via wp-playground-cli (ephemeral, Gutenberg latest, collab enabled)
```

## Package Manager

The repo pins `"packageManager": "npm@12.0.2"` (corepack requires an exact version) and expresses the real floor as a range in `devEngines.packageManager` (`>=12.0.0`, `onFail: "error"`). `devEngines` is dev-only — unlike `engines`, it is not applied to people installing the published package. npm 11 and npm 12 build different trees from the same lockfile, so the floor is a hard requirement, not a preference.

GitHub Actions ships its own bundled npm and `corepack enable` does not override it (Node's bundled `npm` shadows the corepack shim), so every CI job that runs `npm ci` must first `npm install -g npm@12.0.2`. When bumping the pin, update `packageManager`, `devEngines`, and every `npm install -g npm@...` line in `.github/workflows/` together.

`wordpress-plugin` carries its own `devEngines.packageManager` because it is installed with a separate `npm ci` (its own lockfile, its own CI steps) — the root entry does not apply to it.

npm 12 blocks dependency lifecycle scripts by default. Both workspaces record explicit decisions in an `allowScripts` map in `package.json`; every entry is currently denied. Two reasons cover the whole list: `esbuild`, `fsevents`, `unrs-resolver`, `fs-ext-extra-prebuilt` and `@parcel/watcher` are node-gyp/postinstall fallbacks for packages that ship prebuilt platform binaries as optional dependencies, so the fallback is dead weight; `core-js` and `core-js-pure` only print a funding banner. Review new entries with `npm install-scripts ls` and record the decision with `npm install-scripts approve|deny <pkg>` rather than leaving them unreviewed. A blocked script only surfaces when it is actually reached, so re-check after every lockfile refresh — `npm install --package-lock-only` prints the uncovered packages.

`engines.node` (`>=22.13`) is the floor for people _installing the published package_; it is deliberately lower than the dev toolchain's floor, which is recorded separately in `devEngines.runtime`. Bump `devEngines.runtime` when a dev dependency raises its own `engines.node` — currently `eslint-plugin-package-json` (`^22.22.2 || >=24.15.0`) sets it.

### Prettier must not skew across workspaces

Root and `wordpress-plugin` have separate lockfiles, so they can resolve different Prettier builds and fight over formatting. `wordpress-plugin` pins `overrides.prettier` to an **exact** version (which also evicts the stale `wp-prettier` fork that `@wordpress/scripts` pulls in). That version must match what the root lockfile resolves — bump both together, and re-run `npm install --package-lock-only` in `wordpress-plugin` afterwards.

## Git Hooks

Pre-commit hook (via husky + lint-staged) auto-formats and lints staged files — Prettier, ESLint, and markdownlint on JS/TS/Markdown/JSON; stylelint on `wordpress-plugin/src/**/*.scss`; and phpcbf + PHPStan on `wordpress-plugin/**/*.php` — then runs `knip` (a full-project unused files/dependencies/exports check). Hooks are installed automatically by `npm install` (husky's `prepare` script).

`knip` is configured in `knip.jsonc` (root + `wordpress-plugin` as separate workspaces) and runs as the last step of `npm run lint`, so CI covers it too.

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

- **yjs and lib0 pinned to exact versions** (currently `yjs` 13.6.32, `lib0` 0.2.117): the binary update format must stay compatible with what Gutenberg ships. Gutenberg declares carets (`yjs: ^13.6.29`, `lib0: ^0.2.99`) and currently resolves to yjs 13.6.29 / lib0 0.2.117. Before bumping either, check the diff for changes to the encoder/decoder, struct `read`/`write`, or the sync protocol — patch releases so far have only been behavioural bugfixes, which is why running a slightly newer yjs than Gutenberg is safe.
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
- CI: `.github/workflows/ci.yml` runs on push/PR with Node 22+24 matrix

## Environment Variables

- `WP_SITE_URL` — WordPress site URL (optional, can use `wp_connect` tool instead)
- `WP_USERNAME` — WordPress username
- `WP_APP_PASSWORD` — WordPress Application Password

## MCP Server Usage

The MCP server reconnects to WordPress automatically on restart using stored credentials/environment variables. You generally do **not** need to call `wp_connect` — check `wp_status` first. Only use `wp_connect` if the status shows disconnected and the user explicitly provides credentials.

## WordPress Plugin

The `wordpress-plugin/` directory contains a companion WordPress plugin that adds AI action controls to the Gutenberg editor. It has its own `@wordpress/scripts` build chain.

### `@wordpress/*` version policy

`wp-scripts` marks the runtime `@wordpress/*` packages as webpack externals mapped to the `wp.*` globals WordPress provides, so they are **never bundled**. Their installed versions only drive TypeScript types and Jest — which means installing newer than the target WordPress lets code typecheck green against APIs that do not exist at runtime.

The 14 runtime packages (`api-fetch`, `components`, `compose`, `core-data`, `data`, `editor`, `element`, `hooks`, `i18n`, `icons`, `interface`, `notices`, `plugins`, `sync`) are therefore declared with a caret at the version set that **WordPress 7.1** ships, i.e. Gutenberg 23.6. Find the set for a given WP release via Gutenberg's `docs/contributors/versions-in-wordpress.md`, then read `packages/<name>/package.json` at that Gutenberg tag.

This constrains the **top-level** resolution, which is what the plugin's own `import` statements resolve against — each package stays on WP 7.1's major and takes only later minors. It does **not** give a WP-7.1-exact type graph, and no top-level pinning can: Gutenberg's packages depend on their own siblings with carets, so `core-data@7.51.0` pulls `block-editor` → `dataviews` → `@wordpress/components@40`, and `node_modules` ends up with nested copies several majors ahead. Verified: switching all 14 from caret to exact WP 7.1 pins changes the number of nested `components@40` copies from 19 to 16 — i.e. it is not the caret that causes them. Treat the version policy as governing direct imports only; for anything reached through a re-exported type, check the API against WP 7.1 by hand.

`react`/`react-dom` are pinned to `^18.3.1` because WordPress 7.1 ships React 18.3 — and that pin is now the _only_ thing holding the tree there. `@wordpress/element` 8.3.0 (the WP 7.1 version) carried `react`/`react-dom` as regular dependencies at `^18.3.1`, but later 8.x minors moved them to peer dependencies with a `^18 || ^19` range, so the caret has already drifted past the version that enforced React 18. Relaxing the `react`/`react-dom` pin would silently resolve React 19 against a React 18 runtime. `@types/react`/`@types/react-dom` must stay on the matching React major.

`@wordpress/scripts` and `@wordpress/stylelint-config` are **build** tooling, not runtime externals, so they deliberately run ahead of the WP 7.1 set.

Note that WP 7.1's own `@wordpress/data` 10.51 / `core-data` 7.51 have a typings regression that resolves `select(storeDescriptor)` to `unknown`; it is fixed later in the same major, which the caret picks up. The underlying runtime APIs exist in 7.1 either way.

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

Run `npm run lint` from the repo root to lint everything (ESLint + stylelint + markdownlint + Prettier + knip).
