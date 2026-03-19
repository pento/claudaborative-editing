# claudaborative-editing

An MCP server that lets Claude Code act as a Yjs client, connecting to a WordPress site and collaboratively editing posts alongside human editors using the Gutenberg block editor.

## Prerequisites

- **Node.js** 20+
- **WordPress** with Gutenberg real-time collaborative editing enabled (WordPress 7.0+)
- **Application Password** for a WordPress user with edit_posts capability

### Setting Up WordPress Application Passwords

1. In WordPress admin, go to **Users → Your Profile**
2. Scroll to **Application Passwords**
3. Enter a name (e.g., "Claude Code") and click **Add New Application Password**
4. Copy the generated password (it won't be shown again)

## Installation

```bash
npm install
npm run build
```

## Configuration

### Option 1: Environment Variables

Set these before starting the MCP server:

```bash
export WP_SITE_URL="https://your-wordpress-site.com"
export WP_USERNAME="your-username"
export WP_APP_PASSWORD="xxxx xxxx xxxx xxxx xxxx xxxx"
```

### Option 2: Claude Code MCP Config

Add to your Claude Code MCP settings (`.claude/settings.json` or project settings):

```json
{
  "mcpServers": {
    "claudaborative-editing": {
      "command": "node",
      "args": ["/path/to/claudaborative-editing/dist/index.js"],
      "env": {
        "WP_SITE_URL": "https://your-wordpress-site.com",
        "WP_USERNAME": "your-username",
        "WP_APP_PASSWORD": "xxxx xxxx xxxx xxxx xxxx xxxx"
      }
    }
  }
}
```

### Option 3: Connect at Runtime

If no env vars are set, use the `wp_connect` tool to connect manually.

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
4. wp_read_post → See the current content as blocks
5. wp_update_block(index: "1", content: "Updated paragraph text") → Edit a block
6. wp_insert_block(position: 2, name: "core/heading", content: "New Section", attributes: {level: 3})
7. wp_save → Save changes
8. wp_disconnect → Done
```

## How It Works

The server maintains a Yjs CRDT document in memory that mirrors the post being edited in WordPress. Changes made by Claude through the MCP tools are applied to the local Y.Doc and synced to WordPress via HTTP polling. Changes made by human editors in the browser are received through the same polling mechanism and applied to Claude's local Y.Doc.

This means edits from Claude and human editors can happen simultaneously without conflicts — the Yjs CRDT ensures all clients converge to the same state.

## Development

```bash
npm test             # Run tests
npm run typecheck    # Type check
npm run dev          # Watch mode build
```
