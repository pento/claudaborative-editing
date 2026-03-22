import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { SessionManager } from '../session/session-manager.js';

export function registerAuthoringPrompts(server: McpServer, session: SessionManager): void {
  server.registerPrompt(
    'draft',
    {
      description: 'Draft a new WordPress post from a topic or brief.',
      argsSchema: {
        topic: z.string().optional().describe('Topic or brief for the new post'),
        tone: z
          .string()
          .optional()
          .describe('Writing tone (e.g., "professional", "casual", "academic", "conversational")'),
        audience: z
          .string()
          .optional()
          .describe('Target audience (e.g., "developers", "beginners", "general public")'),
      },
    },
    async ({ topic, tone, audience }) => {
      const state = session.getState();

      if (state === 'disconnected') {
        return {
          description: 'Draft a new WordPress post',
          messages: [
            {
              role: 'user' as const,
              content: {
                type: 'text' as const,
                text: 'I want to draft a new WordPress post. Please connect to WordPress first using wp_connect.',
              },
            },
          ],
        };
      }

      if (!topic?.trim()) {
        return {
          description: 'Draft a new WordPress post',
          messages: [
            {
              role: 'user' as const,
              content: {
                type: 'text' as const,
                text: "I want to draft a new WordPress post. Ask me what topic I'd like to write about.",
              },
            },
          ],
        };
      }

      const contextLines = [
        `Topic: ${topic}`,
        tone ? `Tone: ${tone}` : null,
        audience ? `Audience: ${audience}` : null,
      ]
        .filter(Boolean)
        .join('\n');

      const preamble =
        state === 'editing'
          ? 'Note: A post is currently open. Use wp_close_post first, then create the new post.\n\n'
          : '';

      return {
        description: `Draft a new post about: ${topic}`,
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `${preamble}Draft a new WordPress post with the following details:

${contextLines}

Instructions:
- Use wp_create_post to create a new draft post with an appropriate title.
- Build the post using wp_insert_block to add blocks one at a time.
- Use a variety of block types as appropriate: core/heading, core/paragraph, core/list, core/quote, core/separator, etc.
- Use wp_block_types to look up unfamiliar block types before using them.
- Structure the post with a clear introduction, body sections with headings, and a conclusion.
- Write substantive, well-developed paragraphs — not placeholder text.
- After writing the content, set up post metadata:
  - Use wp_set_categories and wp_set_tags to categorize the post.
  - Use wp_set_excerpt to write a concise summary for feeds and search results.
- Use wp_read_post to review the final result, then wp_save to save.`,
            },
          },
        ],
      };
    },
  );

  server.registerPrompt(
    'translate',
    {
      description: 'Translate a WordPress post into another language.',
      argsSchema: {
        language: z
          .string()
          .optional()
          .describe('Target language (e.g., "Spanish", "French", "Japanese", "zh-CN")'),
      },
    },
    async ({ language }) => {
      const state = session.getState();

      if (state === 'disconnected') {
        return {
          description: 'Translate a WordPress post',
          messages: [
            {
              role: 'user' as const,
              content: {
                type: 'text' as const,
                text: 'I want to translate a WordPress post. Please connect to WordPress first using wp_connect, then open a post with wp_open_post.',
              },
            },
          ],
        };
      }

      if (!language?.trim()) {
        return {
          description: 'Translate a WordPress post',
          messages: [
            {
              role: 'user' as const,
              content: {
                type: 'text' as const,
                text: "I want to translate a WordPress post. Ask me what language I'd like to translate it into.",
              },
            },
          ],
        };
      }

      if (state === 'connected') {
        return {
          description: 'Translate a WordPress post',
          messages: [
            {
              role: 'user' as const,
              content: {
                type: 'text' as const,
                text: 'I want to translate a WordPress post. Please open a post with wp_open_post first.',
              },
            },
          ],
        };
      }

      // state === 'editing'
      const postContent = session.readPost();

      return {
        description: `Translate "${session.getTitle()}" into ${language}`,
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: `Translate the following WordPress post into ${language}.

Here is the current post content:

${postContent}

Instructions:
- Translate the title using wp_set_title.
- Translate each block's content using wp_update_block, working through blocks in order.
- If the post has an excerpt, translate it using wp_set_excerpt.
- Preserve all HTML formatting, links, and block structure exactly.
- Do NOT add, remove, or reorder blocks.
- Do NOT change non-text attributes (images, URLs, etc.) unless they contain translatable alt text or captions.
- Adapt idioms and cultural references naturally rather than translating literally.
- After completing the translation, use wp_read_post to verify, then wp_save to save.`,
            },
          },
        ],
      };
    },
  );
}
