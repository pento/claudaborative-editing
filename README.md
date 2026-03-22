# claudaborative-editing

An MCP server that lets Claude Code collaboratively edit WordPress posts in real time, alongside human editors in the Gutenberg block editor.

## Quickstart

```bash
npx claudaborative-editing setup
```

The setup wizard will:

1. Open your browser to authorize with your WordPress site (creates an Application Password automatically)
2. Auto-detect installed MCP clients (Claude Code, Claude Desktop, VS Code, Cursor, Windsurf)
3. Write the MCP server config directly to each client's settings file

That's it — no manual config editing required.

## Prerequisites

- **WordPress 7.0+** with collaborative editing enabled (Settings → Writing)
- A WordPress user with `edit_posts` capability

## Configuration

### Setup options

| Flag              | Description                                           |
| ----------------- | ----------------------------------------------------- |
| `--manual`        | Skip browser auth, prompt for credentials manually    |
| `--remove`        | Remove claudaborative-editing config from MCP clients |
| `--client <name>` | Configure a specific client only                      |

Supported `--client` values: `claude-code`, `claude-desktop`, `vscode`, `vscode-insiders`, `cursor`, `windsurf`.

### Manual configuration

If you prefer not to use the setup wizard, you can pass credentials as environment variables. Use the `wp_connect` MCP tool to connect at runtime, or configure your MCP client manually with these variables:

| Variable          | Description                    |
| ----------------- | ------------------------------ |
| `WP_SITE_URL`     | WordPress site URL             |
| `WP_USERNAME`     | WordPress username             |
| `WP_APP_PASSWORD` | WordPress Application Password |

## MCP Tools

### Connection

| Tool            | Description                                                           |
| --------------- | --------------------------------------------------------------------- |
| `wp_connect`    | Connect to a WordPress site (validates credentials and sync endpoint) |
| `wp_disconnect` | Stop sync and clear state                                             |

### Posts

| Tool             | Description                                                   |
| ---------------- | ------------------------------------------------------------- |
| `wp_list_posts`  | List posts (filterable by status, search)                     |
| `wp_open_post`   | Open a post for collaborative editing (starts real-time sync) |
| `wp_create_post` | Create a new draft post and open it                           |

### Reading

| Tool            | Description                                                         |
| --------------- | ------------------------------------------------------------------- |
| `wp_read_post`  | Read current post content as a numbered block listing               |
| `wp_read_block` | Read a specific block by index (supports `"2.1"` for nested blocks) |

### Editing

| Tool                | Description                                     |
| ------------------- | ----------------------------------------------- |
| `wp_update_block`   | Modify a block's text content and/or attributes |
| `wp_insert_block`   | Insert a new block at a position                |
| `wp_remove_blocks`  | Remove one or more consecutive blocks           |
| `wp_move_block`     | Move a block to a different position            |
| `wp_replace_blocks` | Replace a range of blocks with new ones         |
| `wp_set_title`      | Update the post title                           |

### Post Metadata

| Tool                    | Description                                            |
| ----------------------- | ------------------------------------------------------ |
| `wp_list_categories`    | List existing categories (with optional search)        |
| `wp_list_tags`          | List existing tags (with optional search)              |
| `wp_set_status`         | Change publication status (draft, pending, publish, …) |
| `wp_set_categories`     | Set categories by name (creates if needed)             |
| `wp_set_tags`           | Set tags by name (creates if needed)                   |
| `wp_set_excerpt`        | Set or clear the post excerpt                          |
| `wp_set_featured_image` | Set featured image by attachment ID (0 to remove)      |
| `wp_set_date`           | Set publication date (ISO 8601)                        |
| `wp_set_slug`           | Set URL slug                                           |
| `wp_set_sticky`         | Pin/unpin post on front page                           |
| `wp_set_comment_status` | Enable/disable comments                                |

### Status

| Tool               | Description                                    |
| ------------------ | ---------------------------------------------- |
| `wp_status`        | Connection state, sync status, pending updates |
| `wp_collaborators` | List active collaborators                      |
| `wp_save`          | Trigger a save of the current content          |

## Example Workflow

```txt
1. wp_connect → Connect to your WordPress site
2. wp_list_posts → See available posts
3. wp_open_post(postId: 42) → Open post for editing
4. wp_read_post → See current content and metadata
5. wp_update_block(index: "1", content: "Updated paragraph text") → Edit a block
6. wp_insert_block(position: 2, name: "core/heading", content: "New Section", attributes: {level: 3})
7. wp_set_categories(categories: ["Tech", "Tutorial"]) → Assign categories
8. wp_set_excerpt(excerpt: "A quick intro to widgets") → Set excerpt
9. wp_set_status(status: "publish") → Publish the post
10. wp_disconnect → Done
```

## How It Works

The server maintains a Yjs CRDT document that mirrors the WordPress post. Edits from Claude and human editors sync via HTTP polling and merge automatically — the CRDT ensures all clients converge to the same state. See [CLAUDE.md](CLAUDE.md) for architecture details.

## Development

```bash
npm install
npm run build        # Build with tsup → dist/
npm test             # Run vitest
npm run typecheck    # TypeScript type check
npm run dev          # Watch mode build
```

## License

[GPL-2.0-or-later](LICENSE)
