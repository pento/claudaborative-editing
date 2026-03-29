=== Claudaborative Editing ===
Contributors: pento
Donate link: https://github.com/sponsors/pento
Tags: ai, collaborative-editing, gutenberg, claude
Requires at least: 6.9
Tested up to: 7.0
Stable tag: 0.1.0
Requires PHP: 7.4
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Adds AI action controls to the Gutenberg editor for use with the Claudaborative Editing MCP server.

== Description ==

Claudaborative Editing adds a sidebar panel to the WordPress block editor that lets you trigger AI-powered actions — proofreading, reviewing, translating, and more — directly from within WordPress. Commands are sent to a running Claude Code session via the Claudaborative Editing MCP server.

**Requires:** The [Claudaborative Editing MCP server](https://www.npmjs.com/package/claudaborative-editing) must be running in a Claude Code session connected to the same WordPress site.

== Frequently Asked Questions ==

= Does this work without Claude Code? =

No. The plugin provides the browser-side UI, but all AI processing happens through a Claude Code session running the Claudaborative Editing MCP server.

= What version of WordPress is required? =

WordPress 7.0 or later for a standalone block editor experience, or Gutenberg 22.8+ if using the block editor plugin. Collaborative editing must be enabled in WordPress settings.

== Development ==

The source code is available on GitHub:

[Claudaborative Editing on GitHub](https://github.com/pento/claudaborative-editing)

Source files are in the `wordpress-plugin/src/` directory. See the repository `README.md` for build instructions.

== Changelog ==

= 0.1.0 =
* Initial scaffold: plugin bootstrap, wpce_command CPT, build tooling.
