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

- Node.js 20+
- Composer
- Docker (for tests via wp-env)

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

From the repository root:

```bash
npm run test:php     # PHPUnit tests
```
