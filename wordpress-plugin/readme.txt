=== Claudaborative Editing ===
Contributors: pento
Donate link: https://github.com/sponsors/pento
Tags: ai, collaborative-editing, gutenberg, claude
Requires at least: 6.9
Tested up to: 7.0
Stable tag: 0.3.0
Requires PHP: 7.4
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Adds AI action controls to the Gutenberg editor for use with the Claudaborative Editing MCP server.

== Description ==

Claudaborative Editing adds controls to the WordPress block editor that let you trigger AI-powered actions, including proofreading, reviewing, translating, and more, directly from within WordPress. Commands are sent to a running Claude Code session via the Claudaborative Editing MCP server.

**Requires:** The [Claudaborative Editing MCP server](https://www.npmjs.com/package/claudaborative-editing) must be running in a Claude Code session connected to the same WordPress site.

**How it works:** This plugin adds REST API endpoints (`/wpce/v1/`) to your WordPress site that the MCP server (running locally on your machine) uses to send and receive commands. The data is not sent to any third-party service along the way; all communication happens between your browser, your WordPress site, and the MCP server running on your local machine. The data then may be shared with Anthropic, depending on how you have Claude Code configured.

The MCP server connects to the same WordPress collaborative editing infrastructure that powers multi-user editing in the block editor.

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

= 0.3.1 =
* Toolbar dropdown with Proofread and Review actions.
* Connection status indicator in the editor footer bar.
* Notes sidebar integration with per-note and address-all-notes buttons.
* Command queue via custom post type with REST API and SSE streaming.
* Real-time MCP connection status tracking.
