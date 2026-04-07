/**
 * Session manager: orchestrates the full connection lifecycle for
 * collaborative editing of WordPress posts via the Gutenberg sync protocol.
 *
 * Lifecycle: connect → openPost → edit/read → closePost → disconnect
 */

import { readFile } from 'node:fs/promises';
import { debugLog } from '../debug-log.js';
import { basename } from 'node:path';
import * as Y from 'yjs';
import { DocumentManager } from '../yjs/document-manager.js';
import {
	WordPressApiClient,
	WordPressApiError,
} from '../wordpress/api-client.js';
import { SyncClient } from '../wordpress/sync-client.js';
import {
	createSyncStep1,
	processIncomingUpdate,
	createCompactionUpdate,
	createUpdateFromChange,
} from '../yjs/sync-protocol.js';
import {
	computeTextDelta,
	findHtmlSafeChunkEnd,
} from '../yjs/block-converter.js';
import { parseBlocks, parsedBlockToBlock } from '../blocks/parser.js';
import {
	renderPost,
	renderBlock,
	type PostMetadata,
} from '../blocks/renderer.js';
import { buildAwarenessState, parseCollaborators } from './awareness.js';
import type { CommandStatus } from '../../shared/commands.js';
import { CommandHandler } from './command-handler.js';
import type { ChannelNotifier } from './command-handler.js';
import { DEFAULT_SYNC_CONFIG } from '../wordpress/types.js';
import {
	CRDT_DOC_VERSION,
	CRDT_STATE_MAP_KEY,
	CRDT_STATE_MAP_SAVED_AT_KEY,
	CRDT_STATE_MAP_SAVED_BY_KEY,
	CRDT_STATE_MAP_VERSION_KEY,
} from '../yjs/types.js';
import type {
	Block,
	CollaboratorInfo,
	AwarenessLocalState,
} from '../yjs/types.js';
import { BlockTypeRegistry } from '../yjs/block-type-registry.js';
import { getMimeType } from '../wordpress/mime-types.js';
import type {
	WordPressConfig,
	WPMediaItem,
	WPNote,
	WPTerm,
	WPUser,
	WPPost,
} from '../wordpress/types.js';

export type SessionState = 'disconnected' | 'connected' | 'editing';

/**
 * Origin marker for local edits made through the session manager.
 * Used to distinguish local changes from sync updates when observing Y.Doc events.
 */
const LOCAL_ORIGIN = 'local';

/** Streaming chunk size range in characters. Randomized for a natural feel. */
const STREAM_CHUNK_SIZE_MIN = 2;
const STREAM_CHUNK_SIZE_MAX = 6;

/** Delay between streaming chunks in milliseconds. */
const STREAM_CHUNK_DELAY_MS = 100;

/** Minimum text length to trigger streaming (short text is applied atomically). */
const STREAM_THRESHOLD = 20;

/** Input shape for blocks with optional recursive inner blocks. */
export interface BlockInput {
	name: string;
	content?: string;
	attributes?: Record<string, unknown>;
	innerBlocks?: BlockInput[];
}

/** A streaming target: a specific attribute in a block that needs progressive insertion. */
interface StreamTarget {
	blockIndex: string;
	attrName: string;
	value: string;
}

/** Result of a single find-and-replace edit operation. */
export interface TextEditResult {
	find: string;
	replace: string;
	applied: boolean;
	/** Error message if the edit was not applied. */
	error?: string;
}

/** Result of editBlockText(). */
export interface EditBlockTextResult {
	edits: TextEditResult[];
	appliedCount: number;
	failedCount: number;
	/** The updated text content of the attribute after all edits. */
	updatedText: string;
}

/**
 * Find the Nth occurrence (1-indexed) of `search` within `text`.
 * Returns the character index, or -1 if fewer than N occurrences exist.
 */
function findNthOccurrence(text: string, search: string, n: number): number {
	let pos = -1;
	for (let i = 0; i < n; i++) {
		pos = text.indexOf(search, pos + 1);
		if (pos === -1) return -1;
	}
	return pos;
}

/**
 * Recursively prepare a block tree for insertion.
 * Applies default attributes, sets isValid/clientId, and separates
 * streamable rich-text content from atomic structure.
 *
 * @returns The Block (with empty placeholders for streamable content)
 *          and a flat list of StreamTargets for progressive insertion.
 */
function prepareBlockTree(
	input: BlockInput,
	indexPrefix: string,
	registry: BlockTypeRegistry,
	parentName?: string
): { block: Block; streamTargets: StreamTarget[] } {
	// When using the API-sourced registry, validate block type existence.
	// Skip all validation for the fallback registry — it only knows a subset.
	if (!registry.isUsingFallback()) {
		if (!registry.isKnownBlockType(input.name)) {
			throw new Error(
				`Unknown block type: ${input.name}. This block type is not registered on the WordPress site.`
			);
		}

		// Auto-wrap content into inner core/paragraph for blocks that use InnerBlocks
		// for their primary content. The `supports.allowedBlocks` API flag (exposed as
		// supportsInnerBlocks) is the canonical signal — e.g., core/quote has it (inner
		// paragraphs), while core/pullquote doesn't (uses `value` directly).
		if (
			input.content !== undefined &&
			!registry.hasAttribute(input.name, 'content')
		) {
			const usesInnerBlocks = registry.supportsInnerBlocks(input.name);
			const allowedBlocks = registry.getAllowedBlocks(input.name);
			const paragraphAllowed =
				usesInnerBlocks &&
				(allowedBlocks === null ||
					allowedBlocks.includes('core/paragraph')) &&
				registry.isKnownBlockType('core/paragraph');

			if (paragraphAllowed) {
				const wrappedContent = input.content;
				const existingInnerBlocks = input.innerBlocks;
				input = {
					...input,
					content: undefined,
					innerBlocks: [
						{ name: 'core/paragraph', content: wrappedContent },
						...(existingInnerBlocks ?? []),
					],
				};
			} else {
				const info = registry.getBlockTypeInfo(input.name);
				const richTextAttrs =
					info?.attributes
						.filter((a) => a.richText)
						.map((a) => a.name) ?? [];
				const richTextHint =
					richTextAttrs.length > 0
						? ` This block's rich-text attributes are: ${richTextAttrs.join(', ')}. Pass text via the "attributes" parameter instead.`
						: '';
				const innerBlocksHint = usesInnerBlocks
					? ' Alternatively, pass content via the "innerBlocks" parameter.'
					: '';
				throw new Error(
					`Block type ${input.name} does not have a "content" attribute.${richTextHint}${innerBlocksHint}`
				);
			}
		}

		// Validate provided attributes exist in the block schema
		if (input.attributes) {
			const knownAttrs = registry.getAttributeNames(input.name);
			if (knownAttrs) {
				const unknownAttrs = Object.keys(input.attributes).filter(
					(k) => !knownAttrs.has(k)
				);
				if (unknownAttrs.length > 0) {
					throw new Error(
						`Unknown attribute${unknownAttrs.length > 1 ? 's' : ''} for ${input.name}: ${unknownAttrs.join(', ')}. ` +
							`Known attributes: ${[...knownAttrs].sort().join(', ')}`
					);
				}
			}
		}

		// Validate parent constraint
		const parentConstraint = registry.getParent(input.name);
		if (parentConstraint) {
			if (!parentName) {
				throw new Error(
					`Block type ${input.name} cannot be inserted at the top level. It must be nested inside: ${parentConstraint.join(', ')}`
				);
			}
			if (!parentConstraint.includes(parentName)) {
				throw new Error(
					`Block type ${input.name} can only be nested inside: ${parentConstraint.join(', ')} (got ${parentName})`
				);
			}
		}
	}

	const defaults = registry.getDefaultAttributes(input.name);
	const attrs = { ...defaults, ...input.attributes };
	const streamTargets: StreamTarget[] = [];

	// Handle 'content' field
	if (input.content !== undefined) {
		if (
			registry.isRichTextAttribute(input.name, 'content') &&
			input.content.length >= STREAM_THRESHOLD
		) {
			streamTargets.push({
				blockIndex: indexPrefix,
				attrName: 'content',
				value: input.content,
			});
			attrs.content = '';
		} else {
			attrs.content = input.content;
		}
	}

	// Check other attributes for streaming
	for (const [key, value] of Object.entries(attrs)) {
		if (
			key !== 'content' &&
			registry.isRichTextAttribute(input.name, key) &&
			typeof value === 'string' &&
			value.length >= STREAM_THRESHOLD
		) {
			streamTargets.push({
				blockIndex: indexPrefix,
				attrName: key,
				value,
			});
			attrs[key] = '';
		}
	}

	// Recurse into inner blocks with parent/allowedBlocks validation
	const innerBlocks: Block[] = [];
	if (input.innerBlocks) {
		// Validate parent's allowedBlocks constraint
		if (!registry.isUsingFallback()) {
			const allowedBlocks = registry.getAllowedBlocks(input.name);
			if (allowedBlocks) {
				for (const inner of input.innerBlocks) {
					if (!allowedBlocks.includes(inner.name)) {
						throw new Error(
							`Block type ${input.name} only allows these inner blocks: ${allowedBlocks.join(', ')} (got ${inner.name})`
						);
					}
				}
			}
		}

		for (let i = 0; i < input.innerBlocks.length; i++) {
			const childIndex = `${indexPrefix}.${i}`;
			const prepared = prepareBlockTree(
				input.innerBlocks[i],
				childIndex,
				registry,
				input.name
			);
			innerBlocks.push(prepared.block);
			streamTargets.push(...prepared.streamTargets);
		}
	}

	const block: Block = {
		name: input.name,
		clientId: crypto.randomUUID(),
		attributes: attrs,
		innerBlocks,
		isValid: true,
	};

	return { block, streamTargets };
}

export class SessionManager {
	private _apiClient: WordPressApiClient | null = null;
	private _syncClient: SyncClient | null = null;
	private documentManager: DocumentManager;
	private registry: BlockTypeRegistry;
	private _doc: Y.Doc | null = null;
	private _user: WPUser | null = null;
	private _currentPost: WPPost | null = null;
	private state: SessionState = 'disconnected';
	private awarenessState: AwarenessLocalState | null = null;
	private collaborators: CollaboratorInfo[] = [];
	private notesSupported = false;
	private updateHandler:
		| ((update: Uint8Array, origin: unknown) => void)
		| null = null;
	private commentDoc: Y.Doc | null = null;
	private commentUpdateHandler:
		| ((update: Uint8Array, origin: unknown) => void)
		| null = null;

	/** Cached resolved category names (populated in openPost, updated in setCategories). */
	private _cachedCategories: string[] = [];
	/** Cached resolved tag names (populated in openPost, updated in setTags). */
	private _cachedTags: string[] = [];

	/** True when the post has been deleted or trashed externally. */
	private postGone = false;
	/** Human-readable reason for why the post is gone. */
	private postGoneReason: string | null = null;
	/** In-flight post-existence check promise, used as a lock. */
	private postGoneCheck: Promise<void> | null = null;
	/** Timer for periodic post health checks (detects trashing via REST API). */
	private postHealthCheckTimer: ReturnType<typeof setInterval> | null = null;

	/** Background streaming queue — closures that call streamTargets/streamTextToYText. */
	private streamQueue: Array<() => Promise<void>> = [];
	/** Promise for the currently running queue processor, or null if idle. */
	private streamProcessor: Promise<void> | null = null;

	/** Command handler for WordPress editor plugin integration. */
	private commandHandler: CommandHandler | null = null;
	/** Stored channel notifier for reconnection scenarios. */
	private _channelNotifier: ChannelNotifier | null = null;

	/** Room name for the comment sync room. */
	private static readonly COMMENT_ROOM = 'root/comment';
	/** Room name for the command sync room (collection format, no ID). */
	private static readonly COMMAND_ROOM = 'root/wpce_commands';
	/** Y.Doc for the command room (created on connect, destroyed on disconnect). */
	private commandDoc: Y.Doc | null = null;
	/** Update handler for the command doc. */
	private commandUpdateHandler:
		| ((update: Uint8Array, origin: unknown) => void)
		| null = null;
	/** The post room name (stored for removeRoom in closePost). */
	private postRoom: string | null = null;

	/**
	 * Max time (ms) to wait for sync to populate the doc before loading from REST API.
	 * Must be long enough for the step1/step2 handshake round-trip:
	 * Gutenberg 22.8+ polls at 4s solo / 1s with collaborators, so the handshake
	 * can take up to ~8s (step1 waits for browser poll, step2 waits for MCP poll).
	 * Set to 0 in tests to skip sync wait.
	 */
	syncWaitTimeout = 15_000;

	/**
	 * Interval (ms) for periodic post health checks via REST API.
	 * Detects trashing (which bypasses the Y.Doc) even when sync keeps working.
	 * Set to 0 in tests to disable.
	 */
	postHealthCheckInterval = 30_000;

	// --- Throwing getters for state-dependent fields ---

	get apiClient(): WordPressApiClient {
		if (!this._apiClient) throw new Error('No API client (not connected)');
		return this._apiClient;
	}

	private get user(): WPUser {
		if (!this._user) throw new Error('No user (not connected)');
		return this._user;
	}

	private get doc(): Y.Doc {
		if (!this._doc) throw new Error('No Y.Doc (no post open)');
		return this._doc;
	}

	private get syncClient(): SyncClient {
		if (!this._syncClient)
			throw new Error('No sync client (not connected)');
		return this._syncClient;
	}

	private get currentPost(): WPPost {
		if (!this._currentPost)
			throw new Error('No current post (no post open)');
		return this._currentPost;
	}

	constructor() {
		this.registry = BlockTypeRegistry.createFallback();
		this.documentManager = new DocumentManager(this.registry);
	}

	// --- Connection ---

	/**
	 * Connect to a WordPress site.
	 * Validates credentials and sync endpoint availability.
	 */
	async connect(config: WordPressConfig): Promise<WPUser> {
		if (this.state === 'editing') {
			throw new Error(
				'Cannot connect while a post is open. Call closePost() first.'
			);
		}
		if (this.state === 'connected') {
			await this.disconnect();
		}

		this._apiClient = new WordPressApiClient(config);

		// Validate credentials
		const user = await this.apiClient.validateConnection();
		this._user = user;

		// Validate sync endpoint is available (the real gate for collaborative editing)
		await this.apiClient.validateSyncEndpoint();

		// Fetch block type registry from the API; fall back to hardcoded if unavailable
		try {
			const blockTypes = await this.apiClient.getBlockTypes();
			this.registry = BlockTypeRegistry.fromApiResponse(blockTypes);
		} catch {
			this.registry = BlockTypeRegistry.createFallback();
		}
		this.documentManager.setRegistry(this.registry);

		// Check if the site supports notes (block comments)
		try {
			this.notesSupported = await this.apiClient.checkNotesSupport();
		} catch {
			this.notesSupported = false;
		}

		// Build awareness state from user info
		this.awarenessState = buildAwarenessState(user);

		// Create the SyncClient with the command room.
		// The SyncClient lives for the entire connection and is reused for
		// post + comment rooms when a post is opened.
		const syncClient = new SyncClient(this.apiClient, {
			...DEFAULT_SYNC_CONFIG,
		});
		this._syncClient = syncClient;

		// Create command Y.Doc and join the command room
		debugLog(
			'session',
			'Creating command doc and joining room',
			SessionManager.COMMAND_ROOM
		);
		this.commandDoc = new Y.Doc();
		this.commandUpdateHandler = (update: Uint8Array, origin: unknown) => {
			if (origin === LOCAL_ORIGIN) {
				const syncUpdate = createUpdateFromChange(update);
				syncClient.queueUpdate(SessionManager.COMMAND_ROOM, syncUpdate);
			}
		};
		this.commandDoc.on('updateV2', this.commandUpdateHandler);

		const cmdDoc = this.commandDoc;
		syncClient.start(
			SessionManager.COMMAND_ROOM,
			cmdDoc.clientID,
			[createSyncStep1(cmdDoc)],
			{
				onUpdate: (update) => {
					try {
						return processIncomingUpdate(cmdDoc, update);
					} catch {
						return null;
					}
				},
				onAwareness: () => {},
				onStatusChange: (_status, error) => {
					// Sync errors while editing may indicate the post was
					// deleted/trashed. Check via REST to confirm.
					if (
						this.state === 'editing' &&
						_status === 'error' &&
						error instanceof WordPressApiError &&
						(error.status === 403 ||
							error.status === 404 ||
							error.status === 410)
					) {
						this.checkPostStillExists();
					}
				},
				onCompactionRequested: () => createCompactionUpdate(cmdDoc),
				getAwarenessState: () => this.awarenessState,
			}
		);

		// Detect WordPress editor plugin and start command listener
		await this.probeEditorPlugin();

		this.state = 'connected';
		return user;
	}

	/**
	 * Disconnect from the WordPress site.
	 */
	async disconnect(): Promise<void> {
		try {
			if (this.state === 'editing') {
				await this.closePost();
			}
		} finally {
			if (this.commandHandler) {
				this.commandHandler.stop();
				this.commandHandler = null;
			}

			// Stop the SyncClient (stops all rooms including the command room).
			if (this._syncClient) {
				this._syncClient.stop();
				this._syncClient = null;
			}

			// Clean up command doc.
			if (this.commandDoc && this.commandUpdateHandler) {
				this.commandDoc.off('updateV2', this.commandUpdateHandler);
				this.commandUpdateHandler = null;
			}
			this.commandDoc = null;
			this.postRoom = null;

			this._apiClient = null;
			this._user = null;
			this.awarenessState = null;
			this.collaborators = [];
			this.notesSupported = false;
			this.state = 'disconnected';
		}
	}

	// --- Posts ---

	/**
	 * List posts (delegates to API client).
	 */
	async listPosts(options?: {
		status?: string;
		search?: string;
		perPage?: number;
	}): Promise<WPPost[]> {
		this.requireState('connected', 'editing');
		return this.apiClient.listPosts(options);
	}

	/**
	 * Open a post for collaborative editing.
	 * Creates Y.Doc, loads initial content, starts sync.
	 */
	async openPost(postId: number): Promise<void> {
		this.requireState('connected');

		// Fetch post from API
		const post = await this.apiClient.getPost(postId);
		this._currentPost = post;

		// Create an EMPTY Y.Doc — don't load content yet.
		// We first sync with the server to receive any existing CRDT state.
		// Loading content independently would create divergent CRDT histories,
		// causing duplicate blocks when two clients sync.
		const doc = this.documentManager.createDoc();
		this._doc = doc;

		// Use the existing SyncClient (created in connect()) and add the post room.
		const syncClient = this.syncClient;
		const room = `postType/${post.type}:${postId}`;
		this.postRoom = room;
		const initialUpdates = [createSyncStep1(doc)];

		syncClient.addRoom(room, doc.clientID, initialUpdates, {
			onUpdate: (update) => {
				try {
					return processIncomingUpdate(doc, update);
				} catch {
					return null;
				}
			},
			onAwareness: (awarenessState) => {
				this.collaborators = parseCollaborators(
					awarenessState,
					doc.clientID
				);
			},
			onCompactionRequested: () => {
				return createCompactionUpdate(doc);
			},
			getAwarenessState: () => {
				return this.awarenessState;
			},
		});

		// Wait for the sync handshake to populate the doc with remote content.
		// The handshake takes multiple poll cycles:
		//   Poll 1: We send sync_step1 → receive peer's sync_step1
		//   Poll 2: We send sync_step2 → receive peer's sync_step2 (their full state)
		// So we wait until the doc has blocks (meaning remote state arrived),
		// or timeout (meaning no peers are editing this post).
		if (this.syncWaitTimeout > 0) {
			await new Promise<void>((resolve) => {
				let resolved = false;
				const done = () => {
					if (!resolved) {
						resolved = true;
						doc.off('updateV2', onDocUpdate);
						resolve();
					}
				};

				const timeout = setTimeout(done, this.syncWaitTimeout);

				const onDocUpdate = () => {
					const blocks = this.documentManager.getBlocks(doc);
					const title = this.documentManager.getTitle(doc);
					if (blocks.length > 0 || title.length > 0) {
						clearTimeout(timeout);
						done();
					}
				};

				doc.on('updateV2', onDocUpdate);
			});
		}

		// If the doc is still empty after sync, load content from the REST API.
		// This means we're the first CRDT client for this post.
		const existingBlocks = this.documentManager.getBlocks(doc);
		if (existingBlocks.length === 0) {
			doc.transact(() => {
				// Set title
				if (post.title.raw) {
					this.documentManager.setTitle(doc, post.title.raw);
				}

				// Parse content into blocks
				if (post.content.raw) {
					const parsedBlocks = parseBlocks(post.content.raw);
					const blocks = parsedBlocks.map(parsedBlockToBlock);
					this.documentManager.setBlocks(doc, blocks);
					this.documentManager.setContent(doc, post.content.raw);
				}

				// Set excerpt
				if (post.excerpt.raw) {
					this.documentManager.setProperty(
						doc,
						'excerpt',
						post.excerpt.raw
					);
				}

				// Set other post properties
				this.documentManager.setProperty(doc, 'status', post.status);
				this.documentManager.setProperty(doc, 'slug', post.slug);
				this.documentManager.setProperty(doc, 'author', post.author);

				// Set additional synced post properties
				if (post.categories) {
					this.documentManager.setProperty(
						doc,
						'categories',
						post.categories
					);
				}
				if (post.tags) {
					this.documentManager.setProperty(doc, 'tags', post.tags);
				}
				if (post.featured_media !== undefined) {
					this.documentManager.setProperty(
						doc,
						'featured_media',
						post.featured_media
					);
				}
				if (post.comment_status) {
					this.documentManager.setProperty(
						doc,
						'comment_status',
						post.comment_status
					);
				}
				if (post.sticky !== undefined) {
					this.documentManager.setProperty(
						doc,
						'sticky',
						post.sticky
					);
				}
				if (post.date) {
					this.documentManager.setProperty(doc, 'date', post.date);
				}
			}, LOCAL_ORIGIN);
		}

		// Set up Y.Doc observer to queue updates for local changes
		this.updateHandler = (update: Uint8Array, origin: unknown) => {
			// Only queue updates from local edits, not from sync
			if (origin === LOCAL_ORIGIN) {
				const syncUpdate = createUpdateFromChange(update);
				syncClient.queueUpdate(room, syncUpdate);
			}
		};
		doc.on('updateV2', this.updateHandler);

		// Join the root/comment room for real-time note sync.
		// This room's state map acts as a change signal: when savedAt/savedBy
		// are updated, other clients re-fetch notes from the REST API.
		if (this.notesSupported) {
			const commentDoc = new Y.Doc();
			this.commentDoc = commentDoc;

			// Initialise the state map (same pattern as the post doc)
			commentDoc.transact(() => {
				const stateMap = commentDoc.getMap(CRDT_STATE_MAP_KEY);
				stateMap.set(CRDT_STATE_MAP_VERSION_KEY, CRDT_DOC_VERSION);
			});

			this.commentUpdateHandler = (
				update: Uint8Array,
				origin: unknown
			) => {
				if (origin === LOCAL_ORIGIN) {
					const syncUpdate = createUpdateFromChange(update);
					syncClient.queueUpdate(
						SessionManager.COMMENT_ROOM,
						syncUpdate
					);
				}
			};
			commentDoc.on('updateV2', this.commentUpdateHandler);

			syncClient.addRoom(
				SessionManager.COMMENT_ROOM,
				commentDoc.clientID,
				[createSyncStep1(commentDoc)],
				{
					onUpdate: (update) => {
						try {
							return processIncomingUpdate(commentDoc, update);
						} catch {
							return null;
						}
					},
					onAwareness: () => {},
					onCompactionRequested: () =>
						createCompactionUpdate(commentDoc),
					getAwarenessState: () => null,
				}
			);
		}

		// Periodic health check via REST API to detect trashing.
		// Trashing bypasses the Y.Doc (it's a direct DB status change),
		// so we poll getPost() to catch it.
		if (this.postHealthCheckInterval > 0) {
			this.postHealthCheckTimer = setInterval(() => {
				this.checkPostStillExists();
			}, this.postHealthCheckInterval);
		}

		this.state = 'editing';

		// Resolve category/tag IDs to names for display in readPost().
		// Runs after state is set so it doesn't block the editing transition.
		// Errors are swallowed — term names are informational, not critical.
		try {
			const catIds = post.categories ?? [];
			if (catIds.length > 0) {
				const cats = await this.apiClient.getTerms(
					'categories',
					catIds
				);
				this._cachedCategories = cats.map((t) => t.name);
			}
		} catch {
			// Non-critical: readPost() will omit categories
		}
		try {
			const tagIds = post.tags ?? [];
			if (tagIds.length > 0) {
				const tags = await this.apiClient.getTerms('tags', tagIds);
				this._cachedTags = tags.map((t) => t.name);
			}
		} catch {
			// Non-critical: readPost() will omit tags
		}
	}

	/**
	 * Create a new post and open it for editing.
	 */
	async createPost(data: {
		title?: string;
		content?: string;
	}): Promise<WPPost> {
		this.requireState('connected');

		const post = await this.apiClient.createPost({
			title: data.title,
			content: data.content,
			status: 'draft',
		});

		await this.openPost(post.id);

		return post;
	}

	/**
	 * Close the currently open post (stop sync).
	 * Drains the streaming queue first to ensure all content is delivered.
	 */
	async closePost(): Promise<void> {
		this.requireState('editing');
		await this.drainStreamQueue();

		// Remove post and comment rooms from the SyncClient (it stays alive
		// with the command room for the duration of the connection).
		if (this._syncClient && this.postRoom) {
			this._syncClient.removeRoom(this.postRoom);
		}
		if (this._syncClient && this.commentDoc) {
			this._syncClient.removeRoom(SessionManager.COMMENT_ROOM);
		}

		if (this._doc && this.updateHandler) {
			this._doc.off('updateV2', this.updateHandler);
			this.updateHandler = null;
		}

		if (this.commentDoc && this.commentUpdateHandler) {
			this.commentDoc.off('updateV2', this.commentUpdateHandler);
			this.commentUpdateHandler = null;
		}

		if (this.postHealthCheckTimer !== null) {
			clearInterval(this.postHealthCheckTimer);
			this.postHealthCheckTimer = null;
		}

		// Wait for any in-flight post-existence check to complete before
		// clearing state, so it doesn't mutate a subsequent session.
		if (this.postGoneCheck) {
			await this.postGoneCheck;
		}

		this._doc = null;
		this.commentDoc = null;
		this.postRoom = null;
		this._currentPost = null;
		this.collaborators = [];
		this._cachedCategories = [];
		this._cachedTags = [];
		this._cachedNotes = null;
		this.postGone = false;
		this.postGoneReason = null;
		this.postGoneCheck = null;
		this.state = 'connected';
	}

	// --- Reading ---

	/**
	 * Render the current post as Claude-friendly text, including metadata.
	 */
	readPost(): string {
		this.requireEditablePost();

		const title = this.documentManager.getTitle(this.doc);
		const blocks = this.documentManager.getBlocks(this.doc);

		// Gather metadata from Y.Doc (preferred, reflects collaborative state) and currentPost (fallback)
		const metadata: PostMetadata = {
			status:
				(this.documentManager.getProperty(this.doc, 'status') as
					| string
					| undefined) ?? this._currentPost?.status,
			date:
				(this.documentManager.getProperty(this.doc, 'date') as
					| string
					| undefined) ??
				this._currentPost?.date ??
				undefined,
			slug:
				(this.documentManager.getProperty(this.doc, 'slug') as
					| string
					| undefined) ?? this._currentPost?.slug,
			sticky:
				(this.documentManager.getProperty(this.doc, 'sticky') as
					| boolean
					| undefined) ?? this._currentPost?.sticky,
			commentStatus:
				(this.documentManager.getProperty(
					this.doc,
					'comment_status'
				) as string | undefined) ?? this._currentPost?.comment_status,
			excerpt:
				(this.documentManager.getProperty(this.doc, 'excerpt') as
					| string
					| undefined) || undefined,
			categories:
				this._cachedCategories.length > 0
					? this._cachedCategories
					: undefined,
			tags: this._cachedTags.length > 0 ? this._cachedTags : undefined,
			featuredImage:
				(this.documentManager.getProperty(
					this.doc,
					'featured_media'
				) as number | undefined) ?? this._currentPost?.featured_media,
		};

		return renderPost(title, blocks, metadata);
	}

	/**
	 * Read a specific block by index (dot notation).
	 */
	readBlock(index: string): string {
		this.requireEditablePost();

		const block = this.documentManager.getBlockByIndex(this.doc, index);
		if (!block) {
			throw new Error(`Block not found at index ${index}`);
		}
		return renderBlock(block, index);
	}

	// --- Editing ---

	/**
	 * Update a block's content and/or attributes.
	 *
	 * Rich-text attributes that exceed the streaming threshold are streamed
	 * in chunks so the browser sees progressive updates (like fast typing).
	 * Non-rich-text and short changes are applied atomically.
	 */
	updateBlock(
		index: string,
		changes: { content?: string; attributes?: Record<string, unknown> }
	): void {
		this.requireEditablePost();

		// Set cursor position BEFORE the edit — pointing to existing items
		// the browser already has. Gutenberg requires a real cursor position
		// to process remote edits, but if we set it AFTER the edit, the cursor
		// references new items the browser doesn't have yet (causing a crash).
		this.updateCursorPosition(index);

		// Identify which changes should be streamed vs applied atomically.
		// Look up the block name to determine rich-text attributes.
		const block = this.documentManager.getBlockByIndex(this.doc, index);
		if (!block) return;

		const streamTargets: Array<{ attrName: string; newValue: string }> = [];
		const atomicChanges: {
			content?: string;
			attributes?: Record<string, unknown>;
		} = {};

		// Check 'content' field
		if (changes.content !== undefined) {
			if (
				this.registry.isRichTextAttribute(block.name, 'content') &&
				changes.content.length >= STREAM_THRESHOLD
			) {
				streamTargets.push({
					attrName: 'content',
					newValue: changes.content,
				});
			} else {
				atomicChanges.content = changes.content;
			}
		}

		// Check explicit attributes
		if (changes.attributes) {
			const atomicAttrs: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(changes.attributes)) {
				if (
					this.registry.isRichTextAttribute(block.name, key) &&
					typeof value === 'string' &&
					value.length >= STREAM_THRESHOLD
				) {
					streamTargets.push({ attrName: key, newValue: value });
				} else {
					atomicAttrs[key] = value;
				}
			}
			if (Object.keys(atomicAttrs).length > 0) {
				atomicChanges.attributes = atomicAttrs;
			}
		}

		// Apply atomic changes (non-streaming) in one transaction
		if (atomicChanges.content !== undefined || atomicChanges.attributes) {
			this.doc.transact(() => {
				this.documentManager.updateBlock(
					this.doc,
					index,
					atomicChanges
				);
			}, LOCAL_ORIGIN);
		}

		// Push atomic changes to browser immediately
		this.syncClient.flushQueue();

		// Queue rich-text attributes for background streaming
		const queueTargets: StreamTarget[] = streamTargets.map((t) => ({
			blockIndex: index,
			attrName: t.attrName,
			value: t.newValue,
		}));
		this.enqueueStreamTargets(queueTargets);
	}

	/**
	 * Apply surgical find-and-replace edits to a block's rich-text attribute.
	 *
	 * Each edit is applied as an atomic Y.Text delta (retain + delete + insert).
	 * The Y.Text is re-read before each edit to get correct positions after
	 * previous edits and any concurrent remote changes.
	 *
	 * @param index Block index (e.g., "0", "2.1")
	 * @param edits Array of find/replace operations applied sequentially
	 * @param attribute Rich-text attribute name (default: "content")
	 * @returns Structured result with per-edit success/failure and updated text
	 */
	editBlockText(
		index: string,
		edits: Array<{ find: string; replace: string; occurrence?: number }>,
		attribute?: string
	): EditBlockTextResult {
		this.requireEditablePost();

		const attrName = attribute ?? 'content';

		const block = this.documentManager.getBlockByIndex(this.doc, index);
		if (!block) {
			throw new Error(`Block ${index} not found.`);
		}

		if (!this.registry.isRichTextAttribute(block.name, attrName)) {
			const richTextAttrs = this.registry
				.getRichTextAttributes(block.name)
				.join(', ');
			const hint = richTextAttrs
				? ` Rich-text attributes for ${block.name}: ${richTextAttrs}.`
				: ` ${block.name} has no rich-text attributes.`;
			throw new Error(
				`Attribute "${attrName}" on ${block.name} is not a rich-text attribute. Use wp_update_block to change non-text attributes.${hint}`
			);
		}

		const ytext = this.documentManager.getBlockAttributeYText(
			this.doc,
			index,
			attrName
		);
		if (!ytext) {
			throw new Error(
				`Attribute "${attrName}" is empty on block ${index}. Use wp_update_block to set initial content.`
			);
		}

		// Set cursor to the block being edited for collaborative awareness display.
		// This targets the block's content Y.Text (regardless of which attribute we're
		// actually editing) because that's what Gutenberg uses for cursor positioning.
		// For blocks without a content attribute, this is a no-op — harmless.
		this.updateCursorPosition(index);

		const results: TextEditResult[] = [];
		let appliedCount = 0;

		for (const edit of edits) {
			if (edit.find === '') {
				results.push({
					find: edit.find,
					replace: edit.replace,
					applied: false,
					error: 'Empty find string is not allowed.',
				});
				continue;
			}

			// Validate occurrence before searching
			const occurrence = edit.occurrence ?? 1;
			if (!Number.isInteger(occurrence) || occurrence < 1) {
				results.push({
					find: edit.find,
					replace: edit.replace,
					applied: false,
					error: `Invalid occurrence value: ${occurrence}. Must be a positive integer (>= 1).`,
				});
				continue;
			}

			// Re-read current text for each edit (previous edits shift positions)
			const currentText = ytext.toJSON();
			const pos = findNthOccurrence(currentText, edit.find, occurrence);

			if (pos === -1) {
				const reason =
					occurrence > 1
						? `Occurrence ${occurrence} of "${edit.find}" not found in current content.`
						: `"${edit.find}" not found in current content.`;
				results.push({
					find: edit.find,
					replace: edit.replace,
					applied: false,
					error: reason,
				});
				continue;
			}

			// Apply as a single atomic delta: retain + delete + insert
			this.doc.transact(() => {
				const ops: Array<{
					retain?: number;
					delete?: number;
					insert?: string;
				}> = [];
				if (pos > 0) ops.push({ retain: pos });
				if (edit.find.length > 0)
					ops.push({ delete: edit.find.length });
				if (edit.replace.length > 0) ops.push({ insert: edit.replace });
				ytext.applyDelta(ops);
			}, LOCAL_ORIGIN);

			results.push({
				find: edit.find,
				replace: edit.replace,
				applied: true,
			});
			appliedCount++;
		}

		// Flush once after all edits for prompt sync to browser
		if (appliedCount > 0) {
			this.syncClient.flushQueue();
		}

		return {
			edits: results,
			appliedCount,
			failedCount: results.length - appliedCount,
			updatedText: ytext.toJSON(),
		};
	}

	/**
	 * Insert a new block at position.
	 *
	 * The block structure (with empty content) is inserted atomically,
	 * then rich-text content is streamed in progressively.
	 * Supports recursive inner blocks.
	 */
	insertBlock(position: number, block: BlockInput): void {
		this.requireEditablePost();

		const blockIndex = String(position);
		const { block: fullBlock, streamTargets } = prepareBlockTree(
			block,
			blockIndex,
			this.registry
		);

		// Insert block structure atomically and push to browser immediately
		this.doc.transact(() => {
			this.documentManager.insertBlock(this.doc, position, fullBlock);
		}, LOCAL_ORIGIN);
		this.syncClient.flushQueue();

		// Queue rich-text content for background streaming
		this.enqueueStreamTargets(streamTargets);
	}

	/**
	 * Remove blocks starting at index.
	 */
	removeBlocks(startIndex: number, count: number): void {
		this.requireEditablePost();
		this.doc.transact(() => {
			this.documentManager.removeBlocks(this.doc, startIndex, count);
		}, LOCAL_ORIGIN);
	}

	/**
	 * Move a block from one position to another.
	 */
	moveBlock(fromIndex: number, toIndex: number): void {
		this.requireEditablePost();
		this.doc.transact(() => {
			this.documentManager.moveBlock(this.doc, fromIndex, toIndex);
		}, LOCAL_ORIGIN);
	}

	/**
	 * Replace a range of blocks with new ones.
	 *
	 * Old blocks are removed and new block structures (with empty content)
	 * are inserted atomically. Rich-text content is then streamed progressively.
	 */
	replaceBlocks(
		startIndex: number,
		count: number,
		newBlocks: BlockInput[]
	): void {
		this.requireEditablePost();

		// Prepare all blocks recursively
		const allStreamTargets: StreamTarget[] = [];
		const fullBlocks: Block[] = newBlocks.map((b, i) => {
			const blockIndex = String(startIndex + i);
			const { block, streamTargets } = prepareBlockTree(
				b,
				blockIndex,
				this.registry
			);
			allStreamTargets.push(...streamTargets);
			return block;
		});

		// Remove old blocks and insert new structures atomically
		this.doc.transact(() => {
			this.documentManager.removeBlocks(this.doc, startIndex, count);
			for (let i = 0; i < fullBlocks.length; i++) {
				this.documentManager.insertBlock(
					this.doc,
					startIndex + i,
					fullBlocks[i]
				);
			}
		}, LOCAL_ORIGIN);

		// Push block structures to browser immediately
		this.syncClient.flushQueue();

		// Queue rich-text content for background streaming
		this.enqueueStreamTargets(allStreamTargets);
	}

	/**
	 * Insert a block as an inner block of an existing block.
	 */
	insertInnerBlock(
		parentIndex: string,
		position: number,
		block: BlockInput
	): void {
		this.requireEditablePost();

		const blockIndex = `${parentIndex}.${position}`;
		const { block: fullBlock, streamTargets } = prepareBlockTree(
			block,
			blockIndex,
			this.registry
		);

		this.doc.transact(() => {
			this.documentManager.insertInnerBlock(
				this.doc,
				parentIndex,
				position,
				fullBlock
			);
		}, LOCAL_ORIGIN);
		this.syncClient.flushQueue();

		this.enqueueStreamTargets(streamTargets);
	}

	/**
	 * Remove inner blocks from an existing block.
	 */
	removeInnerBlocks(
		parentIndex: string,
		startIndex: number,
		count: number
	): void {
		this.requireEditablePost();
		this.doc.transact(() => {
			this.documentManager.removeInnerBlocks(
				this.doc,
				parentIndex,
				startIndex,
				count
			);
		}, LOCAL_ORIGIN);
	}

	/**
	 * Set the post title.
	 *
	 * Long titles are streamed progressively; short titles are applied atomically.
	 */
	setTitle(title: string): void {
		this.requireEditablePost();

		if (title.length < STREAM_THRESHOLD) {
			this.doc.transact(() => {
				this.documentManager.setTitle(this.doc, title);
			}, LOCAL_ORIGIN);
			this.syncClient.flushQueue();
			return;
		}

		// Get the title Y.Text
		const documentMap = this.documentManager.getDocumentMap(this.doc);
		let ytext = documentMap.get('title');
		if (!(ytext instanceof Y.Text)) {
			// Create Y.Text if it doesn't exist
			this.doc.transact(() => {
				const newYText = new Y.Text();
				documentMap.set('title', newYText);
			}, LOCAL_ORIGIN);
			ytext = documentMap.get('title');
		}
		if (ytext instanceof Y.Text) {
			const titleYText = ytext;
			this.syncClient.flushQueue();
			this.enqueueStreaming(() =>
				this.streamTextToYText(titleYText, title)
			);
		}
	}

	/**
	 * Trigger a save. Drains the streaming queue first to ensure
	 * all content is committed before marking saved.
	 */
	async save(): Promise<void> {
		this.requireEditablePost();
		await this.drainStreamQueue();
		this.doc.transact(() => {
			this.documentManager.markSaved(this.doc);
		}, LOCAL_ORIGIN);
	}

	// --- Post Metadata ---

	/**
	 * List categories, optionally filtered by search term.
	 */
	async listCategories(options?: {
		search?: string;
		perPage?: number;
	}): Promise<WPTerm[]> {
		this.requireState('connected', 'editing');
		return this.apiClient.listTerms('categories', options);
	}

	/**
	 * List tags, optionally filtered by search term.
	 */
	async listTags(options?: {
		search?: string;
		perPage?: number;
	}): Promise<WPTerm[]> {
		this.requireState('connected', 'editing');
		return this.apiClient.listTerms('tags', options);
	}

	/**
	 * Set the post publication status.
	 * Updates both the Y.Doc (for collaborative sync) and the REST API (for persistence).
	 */
	async setPostStatus(status: string): Promise<WPPost> {
		this.requireEditablePost();
		return this.updatePostMeta({ status });
	}

	/**
	 * Set the post excerpt.
	 * Updates both the Y.Doc and the REST API.
	 */
	async setExcerpt(excerpt: string): Promise<WPPost> {
		this.requireEditablePost();
		return this.updatePostMeta({ excerpt });
	}

	/**
	 * Set the post categories by name.
	 * Resolves names to IDs (creating categories that don't exist), then updates
	 * both the Y.Doc and the REST API.
	 */
	async setCategories(names: string[]): Promise<{
		post: WPPost;
		resolved: Array<{ name: string; id: number; created: boolean }>;
	}> {
		this.requireEditablePost();
		const resolved = await this.resolveTerms('categories', names);
		const ids = resolved.map((r) => r.id);

		const post = await this.updatePostMeta({ categories: ids });
		this._cachedCategories = resolved.map((r) => r.name);
		return { post, resolved };
	}

	/**
	 * Set the post tags by name.
	 * Resolves names to IDs (creating tags that don't exist), then updates
	 * both the Y.Doc and the REST API.
	 */
	async setTags(names: string[]): Promise<{
		post: WPPost;
		resolved: Array<{ name: string; id: number; created: boolean }>;
	}> {
		this.requireEditablePost();
		const resolved = await this.resolveTerms('tags', names);
		const ids = resolved.map((r) => r.id);

		const post = await this.updatePostMeta({ tags: ids });
		this._cachedTags = resolved.map((r) => r.name);
		return { post, resolved };
	}

	/**
	 * Set the post featured image by media attachment ID.
	 * Pass 0 to remove the featured image.
	 */
	async setFeaturedImage(attachmentId: number): Promise<WPPost> {
		this.requireEditablePost();
		return this.updatePostMeta({ featured_media: attachmentId });
	}

	/**
	 * Set the post publication date (ISO 8601 format).
	 * Pass an empty string to clear (WordPress will use the current date).
	 */
	async setDate(date: string): Promise<WPPost> {
		this.requireEditablePost();
		return this.updatePostMeta({ date: date || null });
	}

	/**
	 * Set the post URL slug.
	 * Note: WordPress may auto-modify the slug to ensure uniqueness (appending -2, -3, etc.).
	 */
	async setSlug(slug: string): Promise<WPPost> {
		this.requireEditablePost();
		return this.updatePostMeta({ slug });
	}

	/**
	 * Set whether the post is sticky (pinned to the front page).
	 */
	async setSticky(sticky: boolean): Promise<WPPost> {
		this.requireEditablePost();
		return this.updatePostMeta({ sticky });
	}

	/**
	 * Set the post comment status ('open' or 'closed').
	 */
	async setCommentStatus(commentStatus: string): Promise<WPPost> {
		this.requireEditablePost();
		return this.updatePostMeta({ comment_status: commentStatus });
	}

	// --- Media ---

	/**
	 * Upload a local file to the WordPress media library.
	 * Returns the created media item with ID, URL, and metadata.
	 */
	async uploadMedia(
		filePath: string,
		options?: { altText?: string; caption?: string; title?: string }
	): Promise<WPMediaItem> {
		this.requireState('connected', 'editing');

		const fileName = basename(filePath);
		const mimeType = getMimeType(fileName);
		const fileData = await readFile(filePath);

		return this.apiClient.uploadMedia(
			fileData,
			fileName,
			mimeType,
			options
		);
	}

	// --- Notes ---

	/**
	 * List all notes (block comments) on the current post, along with a map
	 * from noteId to the block index where the note is attached.
	 */
	async listNotes(): Promise<{
		notes: WPNote[];
		noteBlockMap: Partial<Record<number, string>>;
	}> {
		this.requireEditablePost();
		if (!this.notesSupported) {
			throw new Error(
				'Notes are not supported. This feature requires WordPress 6.9 or later.'
			);
		}

		const notes = await this.apiClient.listNotes(this.currentPost.id);

		// Build noteId-to-blockIndex map with a single pass over all blocks
		const noteBlockMap: Record<number, string> = {};
		const blocks = this.documentManager.getBlocks(this.doc);
		const scanBlocks = (blockList: Block[], prefix: string) => {
			for (let i = 0; i < blockList.length; i++) {
				const idx = prefix ? `${prefix}.${i}` : String(i);
				const metadata = blockList[i].attributes.metadata as
					| Record<string, unknown>
					| undefined;
				if (
					metadata?.noteId !== null &&
					metadata?.noteId !== undefined
				) {
					noteBlockMap[metadata.noteId as number] = idx;
				}
				if (blockList[i].innerBlocks.length > 0) {
					scanBlocks(blockList[i].innerBlocks, idx);
				}
			}
		};
		scanBlocks(blocks, '');

		return { notes, noteBlockMap };
	}

	/**
	 * Add a note (block comment) to a specific block.
	 * Creates the note via the REST API and sets `metadata.noteId` on the block.
	 */
	async addNote(blockIndex: string, content: string): Promise<WPNote> {
		this.requireEditablePost();
		if (!this.notesSupported) {
			throw new Error(
				'Notes are not supported. This feature requires WordPress 6.9 or later.'
			);
		}

		const block = this.documentManager.getBlockByIndex(
			this.doc,
			blockIndex
		);
		if (!block) {
			throw new Error(`Block not found at index ${blockIndex}`);
		}

		const existingNoteId = (
			block.attributes.metadata as Record<string, unknown> | undefined
		)?.noteId;
		if (
			typeof existingNoteId === 'number' ||
			typeof existingNoteId === 'string'
		) {
			throw new Error(
				`Block at index ${blockIndex} already has a note (ID: ${existingNoteId}). ` +
					`Your view may be stale — call wp_read_post and wp_list_notes to refresh, ` +
					`then use wp_reply_to_note to reply to the existing note.`
			);
		}

		const note = await this.apiClient.createNote({
			post: this.currentPost.id,
			content,
		});

		this.doc.transact(() => {
			this.documentManager.setBlockNoteId(this.doc, blockIndex, note.id);
		}, LOCAL_ORIGIN);

		this.notifyCommentChange();

		if (this._syncClient) {
			this._syncClient.flushQueue();
		}

		return note;
	}

	/**
	 * Reply to an existing note.
	 */
	async replyToNote(parentNoteId: number, content: string): Promise<WPNote> {
		this.requireEditablePost();
		if (!this.notesSupported) {
			throw new Error(
				'Notes are not supported. This feature requires WordPress 6.9 or later.'
			);
		}

		const reply = await this.apiClient.createNote({
			post: this.currentPost.id,
			content,
			parent: parentNoteId,
		});

		this.notifyCommentChange();
		if (this._syncClient) {
			this._syncClient.flushQueue();
		}

		return reply;
	}

	/**
	 * Resolve (delete) a note and remove its metadata linkage from the block.
	 */
	async resolveNote(noteId: number): Promise<void> {
		this.requireEditablePost();
		if (!this.notesSupported) {
			throw new Error(
				'Notes are not supported. This feature requires WordPress 6.9 or later.'
			);
		}

		// Delete all descendants (replies, replies-to-replies, etc.) then the note itself
		const allNotes = await this.apiClient.listNotes(this.currentPost.id);
		const childrenByParent = new Map<number, number[]>();
		for (const note of allNotes) {
			if (note.parent !== 0) {
				const siblings = childrenByParent.get(note.parent) ?? [];
				siblings.push(note.id);
				childrenByParent.set(note.parent, siblings);
			}
		}

		// Collect all descendant IDs via DFS
		const descendantIds: number[] = [];
		const stack = [noteId];
		for (
			let currentId = stack.pop();
			currentId !== undefined;
			currentId = stack.pop()
		) {
			const children = childrenByParent.get(currentId);
			if (children) {
				for (const childId of children) {
					descendantIds.push(childId);
					stack.push(childId);
				}
			}
		}

		// Delete descendants first (leaves before parents), then the root note
		for (const id of descendantIds.reverse()) {
			await this.apiClient.deleteNote(id);
		}
		await this.apiClient.deleteNote(noteId);

		// Find and remove the noteId from whichever block has it
		const blockIndex = this.findBlockIndexByNoteId(noteId);
		if (blockIndex) {
			this.doc.transact(() => {
				this.documentManager.removeBlockNoteId(this.doc, blockIndex);
			}, LOCAL_ORIGIN);
		}

		this.notifyCommentChange();
		this.syncClient.flushQueue();
	}

	/**
	 * Update an existing note's content.
	 */
	async updateNote(noteId: number, content: string): Promise<WPNote> {
		this.requireEditablePost();
		if (!this.notesSupported) {
			throw new Error(
				'Notes are not supported. This feature requires WordPress 6.9 or later.'
			);
		}

		const updated = await this.apiClient.updateNote(noteId, { content });

		this.notifyCommentChange();
		this.syncClient.flushQueue();

		return updated;
	}

	// --- Status ---

	getState(): SessionState {
		return this.state;
	}

	getSyncStatus(): {
		isPolling: boolean;
		hasCollaborators: boolean;
		queueSize: number;
	} | null {
		if (!this._syncClient) {
			return null;
		}
		const status = this._syncClient.getStatus();
		return {
			isPolling: status.isPolling,
			hasCollaborators: status.hasCollaborators,
			queueSize: status.queueSize,
		};
	}

	getCollaborators(): CollaboratorInfo[] {
		return this.collaborators;
	}

	getCurrentPost(): WPPost | null {
		return this._currentPost;
	}

	getUser(): WPUser | null {
		return this._user;
	}

	getRegistry(): BlockTypeRegistry {
		return this.registry;
	}

	getNotesSupported(): boolean {
		return this.notesSupported;
	}

	// --- Command handler (WordPress editor plugin) ---

	/**
	 * Set the channel notifier callback for forwarding commands to Claude Code.
	 * Called from server.ts after the McpServer is created.
	 * Stored for use on reconnection.
	 */
	setChannelNotifier(notifier: ChannelNotifier): void {
		this._channelNotifier = notifier;
		this.commandHandler?.setNotifier(notifier);
	}

	/**
	 * Update a command's status (delegated to the command handler).
	 * Used by the wp_update_command_status tool.
	 */
	async updateCommandStatus(
		commandId: number,
		status: CommandStatus,
		message?: string,
		resultData?: string
	): Promise<void> {
		if (!this.commandHandler) {
			throw new Error(
				'WordPress editor plugin is not connected. Command features are not available.'
			);
		}
		await this.commandHandler.updateCommandStatus(
			commandId,
			status,
			message,
			resultData
		);
	}

	/**
	 * Plugin and command listener status for wp_status reporting.
	 */
	getPluginInfo(): {
		version: string;
		protocolVersion: number;
		transport: string;
		protocolWarning: string | null;
	} | null {
		if (!this.commandHandler) return null;
		const ps = this.commandHandler.getPluginStatus();
		if (!ps) return null;
		return {
			version: ps.version,
			protocolVersion: ps.protocol_version,
			transport: this.commandHandler.getTransport(),
			protocolWarning: this.commandHandler.getProtocolWarning(),
		};
	}

	/** In-flight preOpenPost promise for serialization. */
	private _preOpenInProgress: Promise<void> | null = null;

	/**
	 * Pre-open a post in response to the browser's active_post signal.
	 * Called automatically when the user opens or switches posts in the editor.
	 *
	 * If the post is already open, this is a no-op. If a different post is
	 * open, the current post is closed first. Serialized: concurrent calls
	 * wait for the previous one to complete.
	 */
	async preOpenPost(postId: number): Promise<void> {
		// Serialize concurrent calls to prevent race conditions from
		// rapid post switching in the editor.
		if (this._preOpenInProgress) {
			await this._preOpenInProgress;
		}

		this._preOpenInProgress = this._doPreOpenPost(postId);
		try {
			await this._preOpenInProgress;
		} finally {
			this._preOpenInProgress = null;
		}
	}

	private async _doPreOpenPost(postId: number): Promise<void> {
		if (this.state === 'disconnected') return;

		// Already editing this post — nothing to do.
		if (this.state === 'editing' && this._currentPost?.id === postId) {
			return;
		}

		// Editing a different post — close it first.
		if (this.state === 'editing') {
			await this.closePost();
		}

		// Now in 'connected' state — open the requested post.
		await this.openPost(postId);

		// Pre-cache notes if supported (useful for review/respond-to-notes commands).
		if (this.notesSupported) {
			try {
				this._cachedNotes = await this.listNotes();
			} catch {
				// Best-effort — notes will be fetched on demand if needed.
			}
		}
	}

	/** Pre-cached notes from preOpenPost. Cleared on closePost. */
	private _cachedNotes: {
		notes: WPNote[];
		noteBlockMap: Partial<Record<number, string>>;
	} | null = null;

	/**
	 * Return the pre-cached notes if available, otherwise fetch fresh.
	 * Used by the content provider for embedding notes in notifications.
	 */
	async getCachedOrFreshNotes(): Promise<{
		notes: WPNote[];
		noteBlockMap: Partial<Record<number, string>>;
	}> {
		if (this._cachedNotes) return this._cachedNotes;
		return this.listNotes();
	}

	/**
	 * Detect the WordPress editor plugin and start the command listener.
	 * Stops any existing command handler first. Safe to call multiple times
	 * (e.g., after installing the plugin while already connected).
	 */
	async detectEditorPlugin(): Promise<boolean> {
		this.requireState('connected', 'editing');
		return this.probeEditorPlugin();
	}

	/**
	 * Core plugin detection logic, shared by connect() and detectEditorPlugin().
	 * Does not check session state — callers are responsible for that.
	 */
	private async probeEditorPlugin(): Promise<boolean> {
		// Stop existing handler if any
		if (this.commandHandler) {
			this.commandHandler.stop();
			this.commandHandler = null;
		}

		const handler = new CommandHandler();
		if (this._channelNotifier) {
			handler.setNotifier(this._channelNotifier);
		}
		handler.setPreOpenHandler(async (postId) => {
			await this.preOpenPost(postId);
		});
		handler.setContentProvider(async () => {
			if (this.state !== 'editing') return null;
			const postContent = this.readPost();
			const notesSupported = this.notesSupported;
			let notes:
				| {
						notes: WPNote[];
						noteBlockMap: Partial<Record<number, string>>;
				  }
				| undefined;
			if (notesSupported) {
				try {
					notes = await this.getCachedOrFreshNotes();
				} catch {
					// Notes unavailable — proceed without them.
				}
			}
			return { postContent, notes, notesSupported };
		});
		try {
			// Collection sync uses the 'state' map (not 'document').
			// Commands are stored under the 'commands' key in the state map.
			const commandMap = this.commandDoc?.getMap('state');
			if (!commandMap) {
				return false;
			}
			const detected = await handler.start(this.apiClient, commandMap);
			if (detected) {
				this.commandHandler = handler;
			}
			return detected;
		} catch {
			// Plugin detection failed — command features disabled
			return false;
		}
	}

	/**
	 * Check whether the editor plugin is installed on the connected WordPress site.
	 * Queries the WordPress plugins REST API.
	 */
	async getEditorPluginInstallStatus(): Promise<{
		installed: boolean;
		active: boolean;
		version: string | null;
		pluginFile: string | null;
	}> {
		this.requireState('connected', 'editing');

		interface WPPlugin {
			plugin: string;
			status: string;
			version: string;
		}

		const plugins =
			await this.apiClient.request<WPPlugin[]>('/wp/v2/plugins');
		const match = plugins.find(
			(p) =>
				p.plugin.startsWith('claudaborative-editing/') ||
				p.plugin === 'claudaborative-editing'
		);

		if (!match) {
			return {
				installed: false,
				active: false,
				version: null,
				pluginFile: null,
			};
		}

		return {
			installed: true,
			active: match.status === 'active',
			version: match.version,
			// REST API returns "folder/file.php" but the plugin endpoint
			// uses "folder/file" (without .php extension).
			pluginFile: match.plugin.replace(/\.php$/, ''),
		};
	}

	/**
	 * Install the editor plugin from wordpress.org.
	 * Requires install_plugins and activate_plugins capabilities.
	 */
	async installEditorPlugin(): Promise<{
		installed: boolean;
		activated: boolean;
		version: string;
	}> {
		this.requireState('connected', 'editing');

		interface WPPlugin {
			plugin: string;
			status: string;
			version: string;
		}

		const result = await this.apiClient.request<WPPlugin>(
			'/wp/v2/plugins',
			{
				method: 'POST',
				body: JSON.stringify({
					slug: 'claudaborative-editing',
					status: 'active',
				}),
			}
		);

		return {
			installed: true,
			activated: result.status === 'active',
			version: result.version,
		};
	}

	/**
	 * Activate an already-installed editor plugin.
	 * Requires activate_plugins capability.
	 */
	async activateEditorPlugin(pluginFile: string): Promise<void> {
		this.requireState('connected', 'editing');

		// WordPress REST API route uses the plugin identifier (folder/file,
		// without .php extension) as a path segment.
		await this.apiClient.request(`/wp/v2/plugins/${pluginFile}`, {
			method: 'POST',
			body: JSON.stringify({ status: 'active' }),
		});
	}

	getTitle(): string {
		this.requireEditablePost();
		return this.documentManager.getTitle(this.doc);
	}

	// --- Background streaming queue ---

	/**
	 * Enqueue a streaming function for background processing.
	 * The function will be called when all previously queued functions complete.
	 * This allows tool calls to return immediately while text streams progressively.
	 */
	private enqueueStreaming(fn: () => Promise<void>): void {
		this.streamQueue.push(fn);
		if (!this.streamProcessor) {
			this.streamProcessor = this.processStreamQueue();
		}
	}

	/**
	 * Process queued streaming functions sequentially.
	 * Errors are logged per-entry (block structure is already committed, so
	 * partial content is better than stopping the queue).
	 */
	private async processStreamQueue(): Promise<void> {
		try {
			while (this.streamQueue.length > 0) {
				const fn = this.streamQueue.shift();
				if (!fn) break;
				try {
					await fn();
				} catch (error) {
					// Block structure is already committed; log and continue
					console.error('Streaming error:', error);
				}
			}
			// Flush after completing all queued streaming to ensure the
			// last chunk of the last item is delivered promptly.
			if (this._syncClient) {
				this._syncClient.flushQueue();
			}
		} finally {
			this.streamProcessor = null;
		}
	}

	/**
	 * Resolve Y.Text references eagerly and enqueue for background streaming.
	 *
	 * Block indices are position-based and can shift when concurrent editors
	 * insert or remove blocks. By resolving Y.Text references NOW (while the
	 * index is known to be valid), the streaming closure writes to the correct
	 * Y.Text even if block positions change before it executes.
	 */
	private enqueueStreamTargets(targets: StreamTarget[]): void {
		if (targets.length === 0) return;

		const resolved: Array<{
			ytext: Y.Text;
			value: string;
			blockIndex: string;
		}> = [];
		for (const target of targets) {
			let ytext = this.documentManager.getBlockAttributeYText(
				this.doc,
				target.blockIndex,
				target.attrName
			);
			if (!ytext) {
				// Y.Text doesn't exist yet — create it atomically
				this.doc.transact(() => {
					this.documentManager.updateBlock(
						this.doc,
						target.blockIndex,
						{
							...(target.attrName === 'content'
								? { content: '' }
								: { attributes: { [target.attrName]: '' } }),
						}
					);
				}, LOCAL_ORIGIN);
				ytext = this.documentManager.getBlockAttributeYText(
					this.doc,
					target.blockIndex,
					target.attrName
				);
			}
			if (ytext) {
				resolved.push({
					ytext,
					value: target.value,
					blockIndex: target.blockIndex,
				});
			}
		}

		if (resolved.length > 0) {
			this.enqueueStreaming(async () => {
				for (const { ytext, value, blockIndex } of resolved) {
					await this.streamTextToYText(ytext, value, blockIndex);
				}
			});
		}
	}

	/**
	 * Wait for all queued streaming to complete.
	 * Called by save(), closePost(), and disconnect() to ensure content
	 * integrity before persisting or tearing down.
	 */
	async drainStreamQueue(): Promise<void> {
		while (this.streamProcessor) {
			await this.streamProcessor;
		}
	}

	// --- Streaming internals ---

	/**
	 * Stream text into a Y.Text in chunks, flushing the sync client between
	 * each chunk so the browser sees progressive updates (like fast typing).
	 *
	 * 1. Compute the delta between the current and target text.
	 * 2. Apply retain + delete atomically (old text removed immediately).
	 * 3. Split the insert text into HTML-safe chunks (2–6 chars, randomized).
	 * 4. For each chunk: apply in its own transaction, flush, and delay.
	 */
	private async streamTextToYText(
		ytext: Y.Text,
		newValue: string,
		blockIndex?: string
	): Promise<void> {
		const oldValue = ytext.toJSON();
		const delta = computeTextDelta(oldValue, newValue);
		if (!delta) return;

		// Set cursor to the block being edited
		if (blockIndex !== undefined) {
			this.updateCursorPosition(blockIndex);
		}

		// Apply retain + delete atomically (remove old text immediately)
		if (delta.deleteCount > 0) {
			this.doc.transact(() => {
				const ops: Array<{ retain?: number; delete?: number }> = [];
				if (delta.prefixLen > 0) ops.push({ retain: delta.prefixLen });
				ops.push({ delete: delta.deleteCount });
				ytext.applyDelta(ops);
			}, LOCAL_ORIGIN);

			this.syncClient.flushQueue();
		}

		// If there's nothing to insert, we're done
		if (delta.insertText.length === 0) return;

		// For short inserts, apply atomically (no streaming overhead)
		if (delta.insertText.length < STREAM_THRESHOLD) {
			this.doc.transact(() => {
				const ops: Array<{ retain?: number; insert?: string }> = [];
				if (delta.prefixLen > 0) ops.push({ retain: delta.prefixLen });
				ops.push({ insert: delta.insertText });
				ytext.applyDelta(ops);
			}, LOCAL_ORIGIN);
			return;
		}

		// Stream the insert text in chunks.
		// Use Yjs relative positions to track the insertion point so that
		// concurrent edits (e.g., user typing earlier in the block) don't
		// throw off our position. The relative position is created right after
		// inserting a chunk (anchored to a CRDT item), then resolved AFTER the
		// flush+delay when remote edits may have shifted absolute positions.
		let offset = 0;
		let insertPos = delta.prefixLen;
		let nextInsertRelPos: Y.RelativePosition | null = null;

		while (offset < delta.insertText.length) {
			// Early exit: bail if session is no longer active (may disconnect mid-stream)
			if (!this._doc || !this._syncClient) return;

			// If we have a relative position from the previous chunk, resolve it
			// now (after the delay, when remote edits may have been applied).
			if (nextInsertRelPos) {
				const absPos = Y.createAbsolutePositionFromRelativePosition(
					nextInsertRelPos,
					this.doc
				);
				if (absPos) {
					insertPos = absPos.index;
				}
			}

			const chunkSize =
				STREAM_CHUNK_SIZE_MIN +
				Math.floor(
					Math.random() *
						(STREAM_CHUNK_SIZE_MAX - STREAM_CHUNK_SIZE_MIN + 1)
				);
			const chunkEnd = findHtmlSafeChunkEnd(
				delta.insertText,
				offset,
				chunkSize
			);
			const chunk = delta.insertText.slice(offset, chunkEnd);

			this.doc.transact(() => {
				const ops: Array<{ retain?: number; insert?: string }> = [];
				if (insertPos > 0) ops.push({ retain: insertPos });
				ops.push({ insert: chunk });
				ytext.applyDelta(ops);
			}, LOCAL_ORIGIN);

			// Anchor a relative position at the end of what we just inserted.
			// This tracks the CRDT item, not the absolute offset, so it survives
			// concurrent edits that shift positions.
			insertPos += chunk.length;
			nextInsertRelPos = Y.createRelativePositionFromTypeIndex(
				ytext,
				insertPos
			);

			offset = chunkEnd;

			// Update cursor to the end of the inserted text so far
			this.updateCursorOffset(insertPos);

			// Flush and delay between chunks (but not after the last one)
			if (offset < delta.insertText.length) {
				this.syncClient.flushQueue();
				await new Promise((resolve) =>
					setTimeout(resolve, STREAM_CHUNK_DELAY_MS)
				);
			}
		}
	}

	/**
	 * Update the awareness cursor to point to a block's Y.Text type.
	 * References the Y.Text type itself (not items within it) so the
	 * cursor always resolves — even after all Y.Text items are deleted.
	 */
	private updateCursorPosition(blockIndex: string): void {
		const ytext = this.documentManager.getBlockContentYText(
			this.doc,
			blockIndex
		);
		if (!ytext) return;

		// Get the Y.Text's internal item ID — this references the Y.Text TYPE,
		// not its content items. The type is never deleted, so this always resolves.
		const typeItem = ytext._item;
		if (!typeItem?.id) return;

		const relPosJSON = {
			type: { client: typeItem.id.client, clock: typeItem.id.clock },
			tname: null,
			item: null,
			assoc: 0,
		};

		// Preserve enteredAt from existing awareness
		const enteredAt =
			this.awarenessState?.collaboratorInfo.enteredAt ?? Date.now();

		this.awarenessState = {
			collaboratorInfo: {
				id: this.user.id,
				name: `${this.user.name ?? this.user.slug} (Claude)`,
				slug: this.user.slug,
				avatar_urls: this.user.avatar_urls ?? {},
				browserType: 'Claudaborative Editing MCP',
				enteredAt,
			},
			editorState: {
				selection: {
					type: 'cursor',
					cursorPosition: {
						relativePosition: relPosJSON,
						absoluteOffset: 0,
					},
				},
			},
		};
	}

	/**
	 * Update just the cursor offset within the current awareness position.
	 * Used during streaming to move the cursor forward as text is typed.
	 */
	private updateCursorOffset(offset: number): void {
		if (!this.awarenessState?.editorState?.selection) return;
		const selection = this.awarenessState.editorState.selection;
		if (selection.type === 'cursor') {
			selection.cursorPosition.absoluteOffset = offset;
		}
	}

	// --- Internal ---

	/**
	 * Shared helper for metadata updates: call REST API first, then update Y.Doc.
	 * REST-first ensures the Y.Doc only reflects committed state — if the API call
	 * fails, neither the collaborative doc nor currentPost are modified.
	 */
	private async updatePostMeta(
		fields: Record<string, unknown>
	): Promise<WPPost> {
		// Persist via REST API first — fail fast before touching collaborative state
		const updated = await this.apiClient.updatePost(
			this.currentPost.id,
			fields
		);
		this._currentPost = updated;

		// Update Y.Doc properties to reflect the committed state.
		// Use WordPress-returned values for scalar fields (e.g., slug may be deduplicated),
		// but keep the caller's value for fields where the API returns a different shape
		// (e.g., excerpt returns { rendered, raw } but Y.Doc stores a plain string).
		this.doc.transact(() => {
			for (const [key, value] of Object.entries(fields)) {
				const canonical = (
					updated as unknown as Record<string, unknown>
				)[key];
				const useCanonical =
					canonical !== undefined &&
					typeof canonical === typeof value;
				this.documentManager.setProperty(
					this.doc,
					key,
					useCanonical ? canonical : value
				);
			}
		}, LOCAL_ORIGIN);

		// Flush sync queue so collaborators see the change
		this.syncClient.flushQueue();

		return updated;
	}

	/**
	 * Resolve taxonomy term names to IDs, creating any that don't exist.
	 * Uses exact case-insensitive matching (WordPress search is substring-based).
	 */
	private async resolveTerms(
		taxonomy: 'categories' | 'tags',
		names: string[]
	): Promise<Array<{ name: string; id: number; created: boolean }>> {
		const results: Array<{ name: string; id: number; created: boolean }> =
			[];

		for (const name of names) {
			const matches = await this.apiClient.searchTerms(taxonomy, name);
			const exact = matches.find(
				(t) => t.name.toLowerCase() === name.toLowerCase()
			);

			if (exact) {
				results.push({
					name: exact.name,
					id: exact.id,
					created: false,
				});
			} else {
				const created = await this.apiClient.createTerm(taxonomy, name);
				results.push({
					name: created.name,
					id: created.id,
					created: true,
				});
			}
		}

		return results;
	}

	/**
	 * Signal a note change to other collaborators via the root/comment room.
	 * Updates the comment doc's state map (savedAt/savedBy), which triggers
	 * other clients to re-fetch notes from the REST API.
	 */
	private notifyCommentChange(): void {
		const doc = this.commentDoc;
		if (!doc) return;

		doc.transact(() => {
			const stateMap = doc.getMap(CRDT_STATE_MAP_KEY);
			stateMap.set(CRDT_STATE_MAP_SAVED_AT_KEY, Date.now());
			stateMap.set(CRDT_STATE_MAP_SAVED_BY_KEY, doc.clientID);
		}, LOCAL_ORIGIN);
	}

	/**
	 * Assert that the session is in one of the allowed states.
	 */
	private requireState(...allowed: SessionState[]): void {
		if (!allowed.includes(this.state)) {
			throw new Error(
				`Operation requires state ${allowed.join(' or ')}, but current state is '${this.state}'`
			);
		}
	}

	/**
	 * Assert that we're in editing state AND the post hasn't been deleted/trashed.
	 * Use this instead of `requireState('editing')` for all operations except `closePost()`.
	 */
	private requireEditablePost(): void {
		this.requireState('editing');
		if (this.postGone) {
			throw new Error(
				`${this.postGoneReason ?? 'This post is no longer available.'} Use wp_close_post to close it, then open another post.`
			);
		}
	}

	/**
	 * Check if the currently open post still exists and is not trashed.
	 * Called asynchronously when the sync client reports a 403/404/410 error,
	 * or periodically by the health check timer.
	 *
	 * The in-flight promise is stored in `postGoneCheck` so that `closePost()`
	 * can await it before clearing state, preventing stale results from
	 * mutating a subsequent session.
	 */
	private checkPostStillExists(): void {
		if (
			this.postGone ||
			this.postGoneCheck ||
			!this._apiClient ||
			!this._currentPost
		) {
			return;
		}
		const apiClient = this._apiClient;
		const postId = this._currentPost.id;
		this.postGoneCheck = (async () => {
			try {
				const post = await apiClient.getPost(postId);
				if (post.status === 'trash') {
					this.postGone = true;
					this.postGoneReason =
						'This post has been moved to the trash.';
					this.stopBackgroundWork();
				}
			} catch (error) {
				if (
					error instanceof WordPressApiError &&
					(error.status === 404 || error.status === 410)
				) {
					this.postGone = true;
					this.postGoneReason = 'This post has been deleted.';
					this.stopBackgroundWork();
				}
			} finally {
				this.postGoneCheck = null;
			}
		})();
	}

	/**
	 * Stop sync polling and the health check timer.
	 * Called when `postGone` is confirmed — no point continuing background
	 * requests for a post that is known to be deleted/trashed.
	 */
	private stopBackgroundWork(): void {
		// Remove the post room from the SyncClient (keeps the command room alive).
		if (this._syncClient && this.postRoom) {
			this._syncClient.removeRoom(this.postRoom);
		}
		if (this._syncClient && this.commentDoc) {
			this._syncClient.removeRoom(SessionManager.COMMENT_ROOM);
		}
		if (this.postHealthCheckTimer !== null) {
			clearInterval(this.postHealthCheckTimer);
			this.postHealthCheckTimer = null;
		}
	}

	/**
	 * Returns whether the post has been detected as deleted or trashed.
	 */
	isPostGone(): { gone: boolean; reason: string | null } {
		return { gone: this.postGone, reason: this.postGoneReason };
	}

	/**
	 * Scan all blocks (including nested inner blocks) to find the block
	 * whose metadata.noteId matches the given noteId.
	 * Returns the block index (dot-notation) or null if not found.
	 */
	private findBlockIndexByNoteId(noteId: number): string | null {
		const blocks = this.documentManager.getBlocks(this.doc);
		const scan = (blockList: Block[], prefix: string): string | null => {
			for (let i = 0; i < blockList.length; i++) {
				const idx = prefix ? `${prefix}.${i}` : String(i);
				const metadata = blockList[i].attributes.metadata as
					| Record<string, unknown>
					| undefined;
				if (metadata?.noteId === noteId) return idx;
				if (blockList[i].innerBlocks.length > 0) {
					const found = scan(blockList[i].innerBlocks, idx);
					if (found) return found;
				}
			}
			return null;
		};
		return scan(blocks, '');
	}
}
