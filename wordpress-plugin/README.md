# Claudaborative Editing

A WordPress plugin that adds AI action controls to the Gutenberg editor for use with the [Claudaborative Editing MCP server](https://www.npmjs.com/package/claudaborative-editing).

## Features

- **AI Actions sidebar** — trigger proofreading, reviewing, translating, and other AI actions directly from the WordPress editor.
- **Command queue** — commands are queued via a custom post type and delivered to a running Claude Code session.
- **Real-time status** — see connection state and command progress in the editor.

## Requirements

- WordPress 7.0+
- PHP 7.4+
- A running Claude Code session with the Claudaborative Editing MCP server

## Development

### Prerequisites

- Node.js 22+
- Composer

No Docker required. PHPUnit and end-to-end tests run against
[`@wp-playground/cli`](https://www.npmjs.com/package/@wp-playground/cli)
(PHP-WASM + SQLite), which `npm run test:plugin-php` launches for you.

### Setup

```bash
npm install
composer install
```

### Build

```bash
npm run build       # Production build
npm run start       # Development build with watch
```

### Lint

PHP coding standards are checked with PHPCS:

```bash
composer phpcs      # PHP coding standards
```

JavaScript linting is handled by the root project's ESLint config. Run `npm run lint` from the repository root.

### Test

Both scripts shell out to `wp-playground-cli` from the **repo root** `node_modules/`,
so run `npm install` at the repo root at least once before using either:

```bash
npm run test:php                 # from plugin directory (delegates to repo root)
npm run test:plugin-php          # from repo root
```

The first run clones the WordPress PHPUnit test library into
`wordpress-plugin/.wp-tests-lib/` (gitignored) via
`bin/fetch-wp-tests-lib.sh`, then boots Playground and executes the suite.
