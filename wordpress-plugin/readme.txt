=== Claudaborative Editing ===
Contributors: pento
Donate link: https://github.com/sponsors/pento
Tags: ai, collaborative-editing, gutenberg, claude
Requires at least: 6.9
Tested up to: 7.0
Stable tag: 0.4.1
Requires PHP: 7.4
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Adds AI action controls to the Gutenberg editor for use with [Claudaborative Cloud](https://claudaborative.cloud), or the Claudaborative Editing MCP server.

== Description ==

Claudaborative Editing adds controls to the WordPress block editor that let you trigger AI-powered actions, including proofreading, reviewing, translating, and more, directly from within WordPress.

It can be run for free with the [Claudaborative Editing MCP server](https://www.npmjs.com/package/claudaborative-editing), which can be installed in your local copy of Claude Code.

For a complete seamless experience, we recommend a [Claudaborative Cloud](https://claudaborative.cloud) subscription, which does all of the hard work for you.

This plugin has no official affiliation with Anthropic or Claude.

== Frequently Asked Questions ==

= Does this work without Claude Code? =

The free version requires Claude Code. The plugin provides the browser-side UI, but all AI processing happens through a Claude Code session running the Claudaborative Editing MCP server.

If you don't want to use Claude Code, then a [Claudaborative Cloud](https://claudaborative.cloud) subscription is the way to go.

= What version of WordPress is required? =

WordPress 7.0 or later for a standalone block editor experience, or WordPress 6.9 and Gutenberg 22.8+ if you're using the Gutenberg plugin. Collaborative editing must be enabled in Writing settings.

= How do I set up the MCP server? =

1. Install [Claude Code](https://claude.ai/download) if you haven't already.
2. Run the following command in your terminal:

`npx claudaborative-editing start`

This will configure and launch Claude Code with the Claudaborative Editing MCP server. The setup wizard will open your browser to authorize with your WordPress site on the first run.

Alternatively, you can set up the credentials separately:

`npx claudaborative-editing setup`

Then start Claude Code with channels enabled:

`claude --dangerously-load-development-channels server:wpce --permission-mode acceptEdits`

== Screenshots ==

1. The toolbar dropdown menu with AI actions (Proofread, Review) in the block editor.
2. The connection status indicator in the editor footer bar.
3. Notes integration in the collaboration sidebar with per-note action buttons.

== Development ==

The source code is available on GitHub:

[Claudaborative Editing on GitHub](https://github.com/pento/claudaborative-editing)

Source files are in the `wordpress-plugin/` directory. See the repository `README.md` for build instructions.

== Changelog ==

= 0.4.1 =
* Added missing autoload handling.

= 0.4.0 =
* Added pre-publish checks panel with AI-powered metadata suggestions (excerpt, categories, tags, slug).
* Added compose tool for interactive post planning and outlining with two-way conversation support.
* Simplified installer to Claude Code only, added `npx claudaborative-editing start` command.
* Pre-open posts and auto-claim commands on editor load for faster response times.
* Server-side MCP connection detection reduces sync handshake from ~10-15s to ~2-3s.

= 0.3.1 =
* Toolbar dropdown with Proofread and Review actions.
* Connection status indicator in the editor footer bar.
* Notes sidebar integration with per-note and address-all-notes buttons.
* Command queue via custom post type with REST API and SSE streaming.
* Real-time MCP connection status tracking.
