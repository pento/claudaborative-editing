/**
 * Prompt content builders: standalone functions that produce the instruction
 * text for each command type. Used by both the MCP prompt handlers (for manual
 * invocation) and the command handler (for channel notification embedding).
 *
 * Each builder exposes two shapes:
 *
 *  - build*Segments(...) returns `{ staticInstructions, dynamicContext }`.
 *    `staticInstructions` is byte-identical across invocations, so the
 *    hosted Anthropic orchestrator can attach a cache_control marker to
 *    it and benefit from prompt caching.
 *  - build*Content(...) is a thin wrapper that concatenates the two
 *    segments into a single string — used by the MCP prompt path and
 *    the channel-embedded notification path where a single blob is
 *    expected.
 *
 * The universal language rules (post language for content edits / notes,
 * user locale for status messages) live inside the static instruction
 * constants, so they stay part of the cacheable prefix. Only the locale
 * *values* appear in `dynamicContext`.
 */

import type { WPNote } from '../wordpress/types.js';

// --- Segment shape ---

/**
 * A prompt body split into a stable, cacheable prefix and a per-invocation
 * suffix. MCP callers concatenate the two; the hosted Anthropic orchestrator
 * keeps them separate and applies cache_control on `staticInstructions`.
 */
export interface PromptSegments {
	staticInstructions: string;
	dynamicContext: string;
}

/** Optional language context injected into `dynamicContext`. */
export interface LanguageContext {
	userLocale?: string;
	siteLocale?: string;
}

// --- Note formatting (shared by review prompts) ---

/**
 * Format an array of notes (with nested replies) into human-readable text.
 * The noteBlockMap maps note IDs to block index strings (e.g., "0", "1").
 */
export function formatNotes(
	notes: WPNote[],
	noteBlockMap: Partial<Record<number, string>>
): string {
	const topLevel = notes.filter((n) => n.parent === 0);
	const replyMap = new Map<number, WPNote[]>();
	for (const note of notes) {
		if (note.parent !== 0) {
			const list = replyMap.get(note.parent) ?? [];
			list.push(note);
			replyMap.set(note.parent, list);
		}
	}

	const lines: string[] = [];
	const stripHtml = (html: string) => html.replace(/<[^>]*>/g, '');
	const renderReplies = (parentId: number, depth: number) => {
		const replies = replyMap.get(parentId) ?? [];
		const indent = '  '.repeat(depth);
		for (const reply of replies) {
			lines.push(
				`${indent}Reply #${reply.id} by ${reply.author_name} — ${reply.date}`
			);
			const replyContent =
				reply.content.raw ?? stripHtml(reply.content.rendered);
			lines.push(`${indent}  "${replyContent}"`);
			renderReplies(reply.id, depth + 1);
		}
	};

	for (const note of topLevel) {
		const blockIdx = noteBlockMap[note.id];
		const blockInfo =
			blockIdx !== undefined ? ` (block [${blockIdx}])` : ' (unlinked)';
		lines.push(
			`Note #${note.id} by ${note.author_name}${blockInfo} — ${note.date}`
		);
		const rawContent = note.content.raw ?? stripHtml(note.content.rendered);
		lines.push(`  "${rawContent}"`);
		renderReplies(note.id, 1);
		lines.push('');
	}
	return lines.join('\n').trim();
}

// --- Shared static-instruction fragments ---

/**
 * Rule for prompts that produce user-facing content (edits, new text,
 * editorial notes, suggestions). Lives inside each prompt's static
 * instruction block so it stays part of the cacheable prefix.
 */
export const DOCUMENT_LANGUAGE_RULE = `## Language for content

Before producing any content (edits, new text, notes, or suggestions), detect the post's language from the existing content. The "Site locale hint" provided below is a weak signal only — the post's actual language always wins. If the post is empty, very short, or mixes languages and you are not confident, use wp_update_command_status with status "awaiting_input" to ask the user to confirm the language before proceeding. Write that clarification question in the user's locale (meta.user_locale); if the user locale is unknown, use the site locale hint as a fallback. All content edits, new text, and editorial notes MUST be written in the post's language.`;

// --- Helpers ---

function buildLocaleBlock(
	lang: LanguageContext | undefined,
	{ includeUser }: { includeUser: boolean }
): string {
	const userLocale = lang?.userLocale?.trim() || 'unknown';
	const siteLocale = lang?.siteLocale?.trim() || 'unknown';
	const lines: string[] = [];
	if (includeUser) {
		lines.push(`User locale: ${userLocale}`);
	}
	lines.push(`Site locale hint: ${siteLocale}`);
	return lines.join('\n');
}

/**
 * Concatenate a static/dynamic segment pair into the single-string form
 * used by the MCP prompt path and channel-embedded notifications.
 * Exported so prompt handlers and tests can share the exact separator
 * semantics and don't drift by rebuilding the template literal inline.
 */
export function joinSegments(segments: PromptSegments): string {
	return `${segments.staticInstructions}\n\n${segments.dynamicContext}`;
}

// --- Static instruction constants ---

export const PROOFREAD_INSTRUCTIONS = `Proofread a WordPress post. Fix any grammar, spelling, punctuation, and style issues directly.

Instructions:
- Use wp_edit_block_text for targeted corrections (typos, spelling, grammar fixes). This is faster and safer for concurrent editing than replacing the full block text.
- Use wp_update_block only when rewriting a significant portion of a block.
- Fix grammar, spelling, and punctuation errors.
- Fix inconsistent capitalization, hyphenation, and number formatting.
- Fix awkward phrasing or unclear sentences.
- Any obvious fixes can be performed without asking for clarification, but ask if you're unsure about a change.
- Do NOT change the meaning, tone, or structure of the content.
- Do NOT add or remove blocks — only update existing text.
- Do NOT change the title unless it has a clear error.
- Work through every block systematically — do not skip any.
- After completing all fixes, use wp_save to save the post.

${DOCUMENT_LANGUAGE_RULE}`;

export const EDIT_INSTRUCTIONS = `Edit a WordPress post according to the editing focus provided in the dynamic context.

Available tools:
- wp_edit_block_text — make targeted find-and-replace corrections within a block (preferred for small edits)
- wp_update_block — modify an existing block by index (for larger rewrites)
- wp_insert_block — add a new block
- wp_remove_blocks — remove blocks
- wp_replace_blocks — replace a range of blocks
- wp_move_block — reorder blocks
- wp_set_title — change the post title
- wp_set_categories, wp_set_tags — update taxonomy
- wp_set_excerpt — update the post excerpt
- wp_read_post — re-read the post after making changes
- wp_view_post — read another post on the site for reference, without closing the current one

Work block by block. Do not try to replace the entire post at once. Preserve the overall structure unless restructuring was requested. After completing edits, use wp_save to save the post.

${DOCUMENT_LANGUAGE_RULE}`;

export const REVIEW_INSTRUCTIONS_NO_NOTES = `Review a WordPress post and provide editorial feedback.

Note: This WordPress site does not support notes (requires WordPress 6.9+). Please provide your feedback as a text summary instead.

Please review for:
- Clarity and readability
- Logical flow and structure
- Factual accuracy concerns
- Missing information or gaps
- Tone and audience appropriateness
- Heading hierarchy and paragraph length
- Post metadata: are categories, tags, and excerpt set appropriately?

Provide your feedback as a structured summary.

${DOCUMENT_LANGUAGE_RULE}`;

export const REVIEW_INSTRUCTIONS_WITH_NOTES = `Review a WordPress post and leave editorial notes on individual blocks.

Instructions:
- Use wp_add_note to attach feedback to specific blocks by their index.
- Each block can have one note. If a block already has a note (marked [has note]), use wp_list_notes to read existing notes and wp_reply_to_note to add your feedback as a reply.
- Review for: clarity, logical flow, factual accuracy, missing information, tone, audience fit, heading hierarchy, and paragraph length.
- Also review post metadata: are categories, tags, and excerpt set appropriately?
- Be specific and actionable in your notes — explain what should change and why.
- Not every block needs a note — only flag issues worth addressing.
- After leaving all notes, provide a brief summary of your overall assessment.

${DOCUMENT_LANGUAGE_RULE}`;

export const RESPOND_TO_NOTES_INSTRUCTIONS = `Address the editorial notes on a WordPress post. Read each note, make the requested changes, and resolve notes when done.

Instructions:
- Work through each note one at a time.
- For each note:
  1. Read the feedback carefully.
  2. Use wp_update_block to make the requested changes to the referenced block.
  3. If the note requires a response or clarification, use wp_reply_to_note.
  4. Once the note is fully addressed, use wp_resolve_note to mark it done.
- If a note's feedback doesn't apply or you disagree, use wp_reply_to_note to explain why, then move on without resolving.
- Use wp_read_post to verify your changes after editing.
- After addressing all notes, use wp_save to save the post.

${DOCUMENT_LANGUAGE_RULE}`;

export const RESPOND_TO_NOTE_INSTRUCTIONS = `Address a specific editorial note on a WordPress post.

Instructions:
1. Read the feedback carefully.
2. Use wp_update_block to make the requested changes to the referenced block.
3. If the note requires a response or clarification, use wp_reply_to_note.
4. Once the note is fully addressed, use wp_resolve_note to mark it done.
- If the feedback doesn't apply or you disagree, use wp_reply_to_note to explain why, then move on without resolving.
- Use wp_read_post to verify your changes after editing.
- After addressing the note, use wp_save to save the post.

${DOCUMENT_LANGUAGE_RULE}`;

export const TRANSLATE_INSTRUCTIONS = `Translate a WordPress post into the target language provided in the dynamic context.

Instructions:
- Translate the title using wp_set_title.
- Translate each block's content using wp_update_block, working through blocks in order.
- If the post has an excerpt, translate it using wp_set_excerpt.
- Preserve all HTML formatting, links, and block structure exactly.
- Do NOT add, remove, or reorder blocks.
- Do NOT change non-text attributes (images, URLs, etc.) unless they contain translatable alt text or captions.
- Adapt idioms and cultural references naturally rather than translating literally.
- After completing the translation, use wp_read_post to verify, then wp_save to save.

## Language for content

If the post's source language isn't obvious from reading the content, use wp_update_command_status with status "awaiting_input" to confirm the source language with the user before translating. The target language is specified in the dynamic context and is authoritative.`;

export const COMPOSE_INSTRUCTIONS_WITH_NOTES = `Help the user plan and outline a WordPress post through a guided conversation. You are an assistant helping the user organize their ideas — you will NOT write the actual post content. Your job is to help the user clarify their thinking and produce a structured outline with writing notes.

## Process

### Phase 1: Discovery
Ask the user 2-3 focused questions to understand what they want to write about. Ask one question at a time using wp_update_command_status with status "awaiting_input". Topics to explore:
- What is the main purpose or thesis of this post?
- Who is the target audience?
- What are the key points or ideas to cover?
- What tone or style should it have?

Do NOT ask all questions at once — ask one, wait for the user's response, then ask the next based on what they said. Skip questions if the answer is already obvious from context or prior answers.

If it would help inform your questions or the outline, you can research existing posts on this site without leaving the current draft: use wp_list_posts to browse and wp_view_post to read any post by ID. The current post stays open and unaffected.

### Phase 2: Outlining
Based on the user's answers, propose an outline with 4-8 sections. For each section, include:
- A clear section title
- 2-4 bullet points describing what should be covered

Present the outline in your message and set status to "awaiting_input". Also send resultData with {"planReady": true} — this adds an "Approve outline" button in the editor sidebar so the user doesn't have to type "approve" manually.

### Phase 3: Refining
If the user requests changes (instead of approving), update the outline and re-propose with planReady: true again. If the user asks a question that needs clarification before you can update the outline, respond WITHOUT planReady (omit resultData) until the outline is ready again.

### Phase 4: Scaffolding
When the user approves the outline, scaffold the post:
1. Set the post title with wp_set_title.
2. Insert a core/heading block (level 2) for each section with wp_insert_block.
3. Insert an empty core/paragraph block after each heading as a writing placeholder.
4. Save the post with wp_save — this flushes all block changes to the browser so that notes can be attached to the correct blocks.
5. After saving, add a Note on each heading block with wp_add_note describing what to write in that section — include key points, suggested angle, relevant details from the conversation, and approximate length guidance.
6. Save the post again with wp_save.

Important: You MUST save (step 4) between inserting blocks and adding notes. Notes reference blocks by index, so the blocks must be synced to the browser first.

The author will then write each section in their own voice, guided by the notes.

## Message formatting

Your messages are displayed in a WordPress sidebar panel. Format them as simple HTML:
- Use <p> tags for paragraphs (not literal newline characters).
- Use <strong> for emphasis, <ol>/<ul>/<li> for lists.
- Use plain colons instead of em dashes for labels (e.g., "Audience: ..." not "Audience — ...").
- Do NOT use markdown syntax — it will not be rendered.

${DOCUMENT_LANGUAGE_RULE}`;

export const COMPOSE_INSTRUCTIONS_NO_NOTES = `Help the user plan and outline a WordPress post through a guided conversation. You are an assistant helping the user organize their ideas — you will NOT write the actual post content. Your job is to help the user clarify their thinking and produce a structured outline with writing notes.

## Process

### Phase 1: Discovery
Ask the user 2-3 focused questions to understand what they want to write about. Ask one question at a time using wp_update_command_status with status "awaiting_input". Topics to explore:
- What is the main purpose or thesis of this post?
- Who is the target audience?
- What are the key points or ideas to cover?
- What tone or style should it have?

Do NOT ask all questions at once — ask one, wait for the user's response, then ask the next based on what they said. Skip questions if the answer is already obvious from context or prior answers.

If it would help inform your questions or the outline, you can research existing posts on this site without leaving the current draft: use wp_list_posts to browse and wp_view_post to read any post by ID. The current post stays open and unaffected.

### Phase 2: Outlining
Based on the user's answers, propose an outline with 4-8 sections. For each section, include:
- A clear section title
- 2-4 bullet points describing what should be covered

Present the outline in your message and set status to "awaiting_input". Also send resultData with {"planReady": true} — this adds an "Approve outline" button in the editor sidebar so the user doesn't have to type "approve" manually.

### Phase 3: Refining
If the user requests changes (instead of approving), update the outline and re-propose with planReady: true again. If the user asks a question that needs clarification before you can update the outline, respond WITHOUT planReady (omit resultData) until the outline is ready again.

### Phase 4: Scaffolding
When the user approves the outline, scaffold the post:
- Set the post title with wp_set_title.
- Insert a core/heading block (level 2) for each section with wp_insert_block.
- Insert a core/paragraph block after each heading containing writing guidance in italics — key points, suggested angle, relevant details from the conversation, and approximate length guidance. The author will replace this with their own writing.
- Save the post with wp_save.

Note: This WordPress site does not support editorial notes (requires WordPress 6.9+), so writing guidance is included as placeholder paragraphs instead.

## Message formatting

Your messages are displayed in a WordPress sidebar panel. Format them as simple HTML:
- Use <p> tags for paragraphs (not literal newline characters).
- Use <strong> for emphasis, <ol>/<ul>/<li> for lists.
- Use plain colons instead of em dashes for labels (e.g., "Audience: ..." not "Audience — ...").
- Do NOT use markdown syntax — it will not be rendered.

${DOCUMENT_LANGUAGE_RULE}`;

export const PRE_PUBLISH_INSTRUCTIONS = `The author is about to publish a WordPress post. Review the metadata and suggest improvements for the fields listed below. Do NOT comment on the post content, title, structure, or quality — assume the author is happy with those.

## What to suggest

Only include a field in your response if you have a suggestion. Omit fields that are already fine.

1. **Excerpt**: If no excerpt is set (or it's poor), write a compelling 1-2 sentence excerpt that summarizes the post for search results and social sharing. If the current excerpt is adequate, omit this field.

2. **Categories**: If the post only has "Uncategorized" or the categories don't fit the content, suggest appropriate category names. For sub-categories, use the format "Parent > Child" (e.g., "Technology > Artificial Intelligence"). These will be created if they don't already exist. If the current categories are appropriate, omit this field.

3. **Tags**: If no tags are set or they could be improved, suggest relevant tags. These will be created if they don't already exist. If the current tags are appropriate, omit this field.

4. **Slug**: If the current slug is auto-generated (e.g., "post-123"), too long, or doesn't match the content, suggest a better one. Do NOT suggest the same slug that is already set — only include this field if the slug would actually change.

## How to respond

Call wp_update_command_status with:
- commandId: the command_id from the channel notification metadata
- status: "completed"
- message: A brief summary of what was suggested (e.g., "Suggested excerpt, 2 categories, and 3 tags")
- resultData: A JSON string with ONLY the fields that need suggestions:

Example with all fields:
{
  "excerpt": "A concise summary of the post for search results and social sharing.",
  "categories": ["Technology", "Updates"],
  "tags": ["release", "new-features", "performance"],
  "slug": "my-better-slug"
}

Example when only excerpt is needed:
{
  "excerpt": "A concise summary of the post."
}

Example when everything looks good (empty object):
{}

Important:
- This is a READ-ONLY check. Do NOT call any tool except wp_update_command_status. Do NOT add notes, edit blocks, update metadata, or make any changes to the post.
- Your ONLY output must be a single wp_update_command_status call with the structured resultData JSON.
- For the excerpt, write actual excerpt text, not a description of what the excerpt should be.
- For categories and tags, suggest specific names, not descriptions.

${DOCUMENT_LANGUAGE_RULE}`;

// --- Segment builders ---

export function buildProofreadSegments(
	postContent: string,
	lang?: LanguageContext
): PromptSegments {
	return {
		staticInstructions: PROOFREAD_INSTRUCTIONS,
		dynamicContext: `${buildLocaleBlock(lang, { includeUser: true })}

Here is the current post content:

${postContent}`,
	};
}

export function buildEditSegments(
	postContent: string,
	editingFocus: string,
	lang?: LanguageContext
): PromptSegments {
	return {
		staticInstructions: EDIT_INSTRUCTIONS,
		dynamicContext: `Focus on: ${editingFocus}

${buildLocaleBlock(lang, { includeUser: true })}

Here is the current post content:

${postContent}`,
	};
}

export function buildReviewSegments(
	postContent: string,
	notesSupported: boolean,
	lang?: LanguageContext
): PromptSegments {
	return {
		staticInstructions: notesSupported
			? REVIEW_INSTRUCTIONS_WITH_NOTES
			: REVIEW_INSTRUCTIONS_NO_NOTES,
		dynamicContext: `${buildLocaleBlock(lang, { includeUser: true })}

Here is the current post content:

${postContent}`,
	};
}

export function buildRespondToNotesSegments(
	postContent: string,
	formattedNotes: string,
	lang?: LanguageContext
): PromptSegments {
	return {
		staticInstructions: RESPOND_TO_NOTES_INSTRUCTIONS,
		dynamicContext: `${buildLocaleBlock(lang, { includeUser: true })}

Here is the current post content:

${postContent}

Here are the editorial notes:

${formattedNotes}`,
	};
}

export function buildRespondToNoteSegments(
	postContent: string,
	formattedNote: string,
	lang?: LanguageContext
): PromptSegments {
	return {
		staticInstructions: RESPOND_TO_NOTE_INSTRUCTIONS,
		dynamicContext: `${buildLocaleBlock(lang, { includeUser: true })}

Here is the current post content:

${postContent}

Here is the note to address:

${formattedNote}`,
	};
}

export function buildTranslateSegments(
	postContent: string,
	language: string,
	lang?: LanguageContext
): PromptSegments {
	return {
		staticInstructions: TRANSLATE_INSTRUCTIONS,
		dynamicContext: `Target language: ${language}

${buildLocaleBlock(lang, { includeUser: true })}

Here is the current post content:

${postContent}`,
	};
}

export function buildComposeSegments(
	postContent: string,
	notesSupported: boolean,
	lang?: LanguageContext
): PromptSegments {
	const trimmed = postContent.trim();
	const postBlock = trimmed
		? `Here is the current post content (which may be empty or a rough starting point):\n\n${postContent}`
		: 'This is a new/empty post.';

	return {
		staticInstructions: notesSupported
			? COMPOSE_INSTRUCTIONS_WITH_NOTES
			: COMPOSE_INSTRUCTIONS_NO_NOTES,
		dynamicContext: `${buildLocaleBlock(lang, { includeUser: true })}

${postBlock}`,
	};
}

export function buildPrePublishCheckSegments(
	postContent: string,
	lang?: LanguageContext
): PromptSegments {
	return {
		staticInstructions: PRE_PUBLISH_INSTRUCTIONS,
		dynamicContext: `${buildLocaleBlock(lang, { includeUser: true })}

Here is the current post content:

${postContent}`,
	};
}

// --- Backwards-compatible string builders ---

export function buildProofreadContent(
	postContent: string,
	lang?: LanguageContext
): string {
	return joinSegments(buildProofreadSegments(postContent, lang));
}

export function buildEditContent(
	postContent: string,
	editingFocus: string,
	lang?: LanguageContext
): string {
	return joinSegments(buildEditSegments(postContent, editingFocus, lang));
}

export function buildReviewContent(
	postContent: string,
	notesSupported: boolean,
	lang?: LanguageContext
): string {
	return joinSegments(buildReviewSegments(postContent, notesSupported, lang));
}

export function buildRespondToNotesContent(
	postContent: string,
	formattedNotes: string,
	lang?: LanguageContext
): string {
	return joinSegments(
		buildRespondToNotesSegments(postContent, formattedNotes, lang)
	);
}

export function buildRespondToNoteContent(
	postContent: string,
	formattedNote: string,
	lang?: LanguageContext
): string {
	return joinSegments(
		buildRespondToNoteSegments(postContent, formattedNote, lang)
	);
}

export function buildTranslateContent(
	postContent: string,
	language: string,
	lang?: LanguageContext
): string {
	return joinSegments(buildTranslateSegments(postContent, language, lang));
}

export function buildComposeContent(
	postContent: string,
	notesSupported: boolean,
	lang?: LanguageContext
): string {
	return joinSegments(
		buildComposeSegments(postContent, notesSupported, lang)
	);
}

export function buildPrePublishCheckContent(
	postContent: string,
	lang?: LanguageContext
): string {
	return joinSegments(buildPrePublishCheckSegments(postContent, lang));
}
