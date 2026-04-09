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

Adds AI action controls to the Gutenberg editor for use with the Claudaborative Editing MCP server.

== Description ==

Claudaborative Editing adds controls to the WordPress block editor that let you trigger AI-powered actions, including proofreading, reviewing, translating, and more, directly from within WordPress. Commands are sent to a running Claude Code session via the Claudaborative Editing MCP server.

**Requires:** [Claude Code](https://claude.ai/download) with the [Claudaborative Editing MCP server](https://www.npmjs.com/package/claudaborative-editing) configured.

**How it works:** This plugin adds REST API endpoints (`/wpce/v1/`) to your WordPress site that the MCP server (running locally on your machine) uses to send and receive commands. The data is not sent to any third-party service along the way; all communication happens between your browser, your WordPress site, and the MCP server running on your local machine. The data then may be shared with Anthropic, depending on how you have Claude Code configured.

The MCP server connects to the same WordPress collaborative editing infrastructure that powers multi-user editing in the block editor.

= Setting up the MCP server =

1. Install [Claude Code](https://claude.ai/download) if you haven't already.
2. Run the following command in your terminal:

`npx claudaborative-editing start`

This will configure and launch Claude Code with the Claudaborative Editing MCP server. The setup wizard will open your browser to authorize with your WordPress site on the first run.

Alternatively, you can set up the credentials separately:

`npx claudaborative-editing setup`

Then start Claude Code with channels enabled:

`claude --dangerously-load-development-channels server:wpce --permission-mode acceptEdits`

== Frequently Asked Questions ==

= Does this work without Claude Code? =

No. The plugin provides the browser-side UI, but all AI processing happens through a Claude Code session running the Claudaborative Editing MCP server.

= What version of WordPress is required? =

WordPress 7.0 or later for a standalone block editor experience, or WordPress 6.9 and Gutenberg 22.8+ if using the block editor plugin. Collaborative editing must be enabled in WordPress settings.

== Screenshots ==

1. The toolbar dropdown menu with AI actions (Proofread, Review) in the block editor.
2. The connection status indicator in the editor footer bar.
3. Notes integration in the collaboration sidebar with per-note action buttons.

== Development ==

The source code is available on GitHub:

[Claudaborative Editing on GitHub](https://github.com/pento/claudaborative-editing)

Source files are in the `wordpress-plugin/src/` directory. See the repository `README.md` for build instructions.

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
