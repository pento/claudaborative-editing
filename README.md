# Claudaborative Editing

![Claudaborative Editing](wordpress-plugin/.wordpress-org/banner.svg)

AI editing assistance directly in the WordPress block editor. Claude joins as a real-time collaborator to proofread, review, edit, translate, compose, and prepare your posts for publishing.

## Getting Started

1. Install the [Claudaborative Editing](https://wordpress.org/plugins/claudaborative-editing/) WordPress plugin and activate it.
2. Run the following in your terminal:

```bash
npx claudaborative-editing start
```

This checks that [Claude Code](https://claude.ai/download) is installed, runs a setup wizard on first use (opens your browser to authorize with WordPress), and starts a Claude Code session connected to your site.

Open any post in the block editor and use the **AI Actions** menu in the toolbar.

## Features

### AI Actions menu

A sparkle icon in the editor toolbar opens a dropdown with actions you can trigger on the current post:

- **Proofread**: Fix grammar, spelling, and punctuation.
- **Review**: Leave editorial notes on the post.
- **Edit**: Make broad editorial changes with a custom focus prompt (e.g., "make the tone more conversational").
- **Translate**: Translate content into another language.
- **Compose**: Plan and outline a post through a guided back-and-forth conversation.

### Pre-publish checks

When you publish, an AI-powered panel suggests improvements to your post's excerpt, categories, tags, and slug. Apply suggestions individually or all at once.

### Editorial notes

Sparkle buttons appear on editorial notes in the collaboration sidebar. Address a single note or all open notes at once: Claude reads the note, understands the feedback, and makes the requested changes.

### Conversation panel

A side panel opens for interactive commands like Compose. Chat back and forth with Claude to refine an outline, then approve it to generate the post structure.

### Real-time collaboration

Claude appears as a named collaborator in the editor, using the same collaborative editing infrastructure as human editors. Edits from Claude and humans merge automatically: you can both work on the same post at the same time.

### Connection status

A sparkle icon in the editor footer shows whether Claude is connected. Click it to see which post Claude is editing and whether a command is in progress.

## Prerequisites

- [Claude Code](https://claude.ai/download) installed
- WordPress 7.0+, or WordPress 6.9 with [Gutenberg 22.8+](https://wordpress.org/plugins/gutenberg/), with collaborative editing enabled (Settings → Writing)
- A WordPress user with `edit_posts` capability

## Configuration

### Setup wizard

```bash
npx claudaborative-editing setup           # Interactive setup (browser-based auth)
npx claudaborative-editing setup --manual   # Skip browser auth, enter credentials manually
npx claudaborative-editing setup --remove   # Remove configuration from Claude Code
```

### Environment variables

If you prefer to configure credentials manually:

| Variable          | Description                    |
| ----------------- | ------------------------------ |
| `WP_SITE_URL`     | WordPress site URL             |
| `WP_USERNAME`     | WordPress username             |
| `WP_APP_PASSWORD` | WordPress Application Password |

## How It Works

The project has two parts: a WordPress plugin and an MCP server.

The **WordPress plugin** adds the AI Actions UI to the block editor and manages a command queue. When you trigger an action (like "Proofread"), the plugin sends the command to the MCP server via WordPress REST API endpoints and real-time Yjs sync.

The **MCP server** (the npm package) runs locally on your machine and bridges Claude Code with WordPress. It connects to the same Yjs CRDT-based collaborative editing infrastructure that powers multi-user editing in the block editor, so Claude's edits merge seamlessly with human edits.

See [CLAUDE.md](CLAUDE.md) for architecture details, sync protocol documentation, and key design decisions.

## Development

### MCP server

```bash
npm install
npm run build        # Build with tsup → dist/
npm test             # Run vitest
npm run typecheck    # TypeScript type check
npm run lint         # ESLint + markdownlint + Prettier check
npm run dev          # Watch mode build
```

### WordPress plugin

```bash
cd wordpress-plugin
npm install
npm run build        # Build with @wordpress/scripts → build/
npm run typecheck    # TypeScript type check
npm run test         # TypeScript tests
composer install
composer phpcs       # PHP CodeSniffer
composer phpstan     # PHPStan static analysis
```

Run `npm run lint` from the repo root to lint everything (ESLint + stylelint + markdownlint + Prettier).

## License

[GPL-2.0-or-later](LICENSE)
