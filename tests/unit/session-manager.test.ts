import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../../src/session/session-manager.js';
import type {
	WordPressConfig,
	WPNote,
	WPPost,
	WPTerm,
	WPUser,
	SyncUpdate,
} from '../../src/wordpress/types.js';
import type { SyncCallbacks } from '../../src/wordpress/sync-client.js';
import { WordPressApiError } from '../../src/wordpress/api-client.js';
import { assertDefined } from '../test-utils.js';

// --- Mock the WordPress API client ---
const mockValidateConnection = vi.fn<() => Promise<WPUser>>();
const mockValidateSyncEndpoint = vi.fn<() => Promise<void>>();
const mockGetPost = vi.fn<(id: number) => Promise<WPPost>>();
const mockListPosts = vi.fn<() => Promise<WPPost[]>>();
const mockCreatePost = vi.fn<() => Promise<WPPost>>();
const mockSendSyncUpdate = vi.fn();
const mockGetBlockTypes = vi.fn<() => Promise<unknown[]>>();
const mockUpdatePost = vi.fn<() => Promise<WPPost>>();
const mockUploadMedia = vi.fn();
const mockListTerms = vi.fn<() => Promise<WPTerm[]>>();
const mockSearchTerms = vi.fn<() => Promise<WPTerm[]>>();
const mockCreateTerm = vi.fn<() => Promise<WPTerm>>();
const mockGetWordPressVersion = vi.fn<() => Promise<string>>();
const mockCheckNotesSupport = vi.fn<() => Promise<boolean>>();
const mockListNotes = vi.fn<() => Promise<WPNote[]>>();
const mockCreateNote = vi.fn<() => Promise<WPNote>>();
const mockUpdateNote = vi.fn<() => Promise<WPNote>>();
const mockDeleteNote = vi.fn<() => Promise<void>>();

vi.mock('../../src/wordpress/api-client.js', () => {
	// eslint-disable-next-line @typescript-eslint/no-shadow -- must match the real export name
	class WordPressApiError extends Error {
		constructor(
			message: string,
			public readonly status: number,
			public readonly body: string
		) {
			super(message);
			this.name = 'WordPressApiError';
		}
	}

	return {
		WordPressApiClient: vi.fn().mockImplementation(function (
			this: Record<string, unknown>
		) {
			this.validateConnection = mockValidateConnection;
			this.validateSyncEndpoint = mockValidateSyncEndpoint;
			this.getPost = mockGetPost;
			this.listPosts = mockListPosts;
			this.createPost = mockCreatePost;
			this.updatePost = mockUpdatePost;
			this.sendSyncUpdate = mockSendSyncUpdate;
			this.getBlockTypes = mockGetBlockTypes;
			this.uploadMedia = mockUploadMedia;
			this.listTerms = mockListTerms;
			this.searchTerms = mockSearchTerms;
			this.createTerm = mockCreateTerm;
			this.getWordPressVersion = mockGetWordPressVersion;
			this.checkNotesSupport = mockCheckNotesSupport;
			this.listNotes = mockListNotes;
			this.createNote = mockCreateNote;
			this.updateNote = mockUpdateNote;
			this.deleteNote = mockDeleteNote;
		}),
		WordPressApiError,
	};
});

// --- Mock node:fs/promises for uploadMedia tests ---
const mockReadFile = vi.fn<(...args: unknown[]) => Promise<Buffer>>();
vi.mock('node:fs/promises', () => ({
	readFile: (...args: unknown[]) => mockReadFile(...args),
}));

// --- Mock the sync client ---
const mockSyncStart =
	vi.fn<
		(
			room: string,
			clientId: number,
			initialUpdates: SyncUpdate[],
			callbacks: SyncCallbacks
		) => void
	>();
const mockSyncStop = vi.fn();
const mockSyncQueueUpdate = vi.fn();
const mockSyncFlushQueue = vi.fn();
const mockSyncAddRoom = vi.fn();
const mockSyncRemoveRoom = vi.fn();
const mockSyncGetStatus = vi.fn().mockReturnValue({
	isPolling: true,
	hasCollaborators: false,
	queuePaused: false,
	endCursor: 0,
	queueSize: 0,
});
const mockWaitForFirstPoll = vi.fn().mockResolvedValue(undefined);

vi.mock('../../src/wordpress/sync-client.js', () => {
	return {
		SyncClient: vi.fn().mockImplementation(function (
			this: Record<string, unknown>
		) {
			this.start = mockSyncStart;
			this.stop = mockSyncStop;
			this.queueUpdate = mockSyncQueueUpdate;
			this.flushQueue = mockSyncFlushQueue;
			this.addRoom = mockSyncAddRoom;
			this.removeRoom = mockSyncRemoveRoom;
			this.getStatus = mockSyncGetStatus;
			this.waitForFirstPoll = mockWaitForFirstPoll;
		}),
	};
});

// --- Mock the command handler ---
const mockCommandHandlerStart = vi.fn<() => Promise<boolean>>();
const mockCommandHandlerStop = vi.fn();
const mockCommandHandlerSetNotifier = vi.fn();
const mockCommandHandlerUpdateCommandStatus = vi.fn<() => Promise<void>>();
const mockCommandHandlerGetPluginStatus = vi.fn();
const mockCommandHandlerGetTransport = vi.fn();

vi.mock('../../src/session/command-handler.js', () => {
	return {
		CommandHandler: vi.fn().mockImplementation(function (
			this: Record<string, unknown>
		) {
			this.start = mockCommandHandlerStart;
			this.stop = mockCommandHandlerStop;
			this.setNotifier = mockCommandHandlerSetNotifier;
			this.updateCommandStatus = mockCommandHandlerUpdateCommandStatus;
			this.getPluginStatus = mockCommandHandlerGetPluginStatus;
			this.getTransport = mockCommandHandlerGetTransport;
		}),
	};
});

// --- Test data ---

const fakeUser: WPUser = {
	id: 1,
	name: 'admin',
	slug: 'admin',
	avatar_urls: { '96': 'https://example.com/avatar.jpg' },
};

const fakeConfig: WordPressConfig = {
	siteUrl: 'https://example.com',
	username: 'admin',
	appPassword: 'xxxx yyyy zzzz',
};

const fakePost: WPPost = {
	id: 42,
	title: { rendered: 'Hello World', raw: 'Hello World' },
	content: {
		rendered: '<p>First paragraph</p>',
		raw: '<!-- wp:paragraph -->\n<p>First paragraph</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:heading {"level":2} -->\n<h2 class="wp-block-heading">A Heading</h2>\n<!-- /wp:heading -->',
	},
	excerpt: { rendered: '', raw: 'An excerpt' },
	status: 'draft',
	type: 'post',
	slug: 'hello-world',
	author: 1,
	date: '2026-01-01T00:00:00',
	modified: '2026-01-01T00:00:00',
};

// --- Helpers ---

async function connectSession(session: SessionManager): Promise<void> {
	mockValidateConnection.mockResolvedValue(fakeUser);
	mockValidateSyncEndpoint.mockResolvedValue(undefined);
	await session.connect(fakeConfig);
}

async function connectAndOpen(session: SessionManager): Promise<void> {
	await connectSession(session);
	mockGetPost.mockResolvedValue(fakePost);
	await session.openPost(42);
}

// --- Tests ---

describe('SessionManager', () => {
	let session: SessionManager;

	beforeEach(() => {
		vi.clearAllMocks();
		mockSyncGetStatus.mockReturnValue({
			isPolling: true,
			hasCollaborators: false,
			queuePaused: false,
			endCursor: 0,
			queueSize: 0,
		});
		mockGetBlockTypes.mockRejectedValue(new Error('Not available'));
		mockGetWordPressVersion.mockResolvedValue('7.0');
		mockCheckNotesSupport.mockResolvedValue(false);
		mockCommandHandlerStart.mockResolvedValue(false);
		session = new SessionManager();
		session.syncWaitTimeout = 0; // Skip sync wait in tests
		session.postHealthCheckInterval = 0; // Disable periodic health checks in tests
	});

	afterEach(async () => {
		// Clean up any open sessions
		if (session.getState() !== 'disconnected') {
			await session.disconnect();
		}
	});

	describe('connect()', () => {
		it('validates credentials and sets state to connected', async () => {
			mockValidateConnection.mockResolvedValue(fakeUser);
			mockValidateSyncEndpoint.mockResolvedValue(undefined);

			const user = await session.connect(fakeConfig);

			expect(user).toEqual(fakeUser);
			expect(session.getState()).toBe('connected');
			expect(session.getUser()).toEqual(fakeUser);
			expect(mockValidateConnection).toHaveBeenCalledTimes(1);
			expect(mockValidateSyncEndpoint).toHaveBeenCalledTimes(1);
		});

		it('throws on bad credentials', async () => {
			mockValidateConnection.mockRejectedValue(
				new Error('401 Unauthorized')
			);

			await expect(session.connect(fakeConfig)).rejects.toThrow(
				'401 Unauthorized'
			);
			expect(session.getState()).toBe('disconnected');
		});

		it('throws if sync endpoint is unavailable', async () => {
			mockValidateConnection.mockResolvedValue(fakeUser);
			mockValidateSyncEndpoint.mockRejectedValue(
				new Error('404 Not Found')
			);

			await expect(session.connect(fakeConfig)).rejects.toThrow(
				'404 Not Found'
			);
		});

		it('fetches block types during connect', async () => {
			mockValidateConnection.mockResolvedValue(fakeUser);
			mockValidateSyncEndpoint.mockResolvedValue(undefined);
			mockGetBlockTypes.mockResolvedValueOnce([
				{
					name: 'core/paragraph',
					attributes: { content: { type: 'rich-text' } },
				},
			]);

			await session.connect(fakeConfig);

			expect(mockGetBlockTypes).toHaveBeenCalledTimes(1);
		});

		it('falls back to hardcoded registry on API error', async () => {
			mockValidateConnection.mockResolvedValue(fakeUser);
			mockValidateSyncEndpoint.mockResolvedValue(undefined);
			mockGetBlockTypes.mockRejectedValueOnce(new Error('fail'));

			await session.connect(fakeConfig);

			expect(session.getState()).toBe('connected');
		});

		it('throws when a post is open (editing state)', async () => {
			await connectAndOpen(session);

			await expect(session.connect(fakeConfig)).rejects.toThrow(
				/closePost/
			);
			expect(session.getState()).toBe('editing');
		});

		it('disconnects and reconnects when already connected', async () => {
			await connectSession(session);
			expect(session.getState()).toBe('connected');

			// Connect again with (potentially different) config
			mockValidateConnection.mockResolvedValue({
				...fakeUser,
				id: 2,
				name: 'other',
			});
			mockValidateSyncEndpoint.mockResolvedValue(undefined);

			const user = await session.connect(fakeConfig);

			expect(user.name).toBe('other');
			expect(session.getState()).toBe('connected');
		});
	});

	describe('openPost()', () => {
		it('creates Y.Doc, loads content, starts sync, sets state to editing', async () => {
			await connectSession(session);
			mockGetPost.mockResolvedValue(fakePost);

			await session.openPost(42);

			expect(session.getState()).toBe('editing');
			expect(session.getCurrentPost()).toEqual(fakePost);
			expect(mockGetPost).toHaveBeenCalledWith(42);
			expect(mockSyncStart).toHaveBeenCalledTimes(1);

			// Verify room format
			const [room] = mockSyncStart.mock.calls[0];
			expect(room).toBe('postType/post:42');
		});

		it('loads post title into Y.Doc', async () => {
			await connectAndOpen(session);

			const rendered = session.readPost();
			expect(rendered).toContain('Hello World');
		});

		it('loads post content blocks into Y.Doc', async () => {
			await connectAndOpen(session);

			const rendered = session.readPost();
			expect(rendered).toContain('core/paragraph');
			expect(rendered).toContain('First paragraph');
			expect(rendered).toContain('core/heading');
			expect(rendered).toContain('A Heading');
		});

		it('throws when not connected', async () => {
			await expect(session.openPost(42)).rejects.toThrow(
				/requires state/
			);
		});

		it('starts sync with sync_step1 initial update', async () => {
			await connectSession(session);
			mockGetPost.mockResolvedValue(fakePost);

			await session.openPost(42);

			const [, , initialUpdates] = mockSyncStart.mock.calls[0];
			expect(initialUpdates).toHaveLength(1);
			expect(initialUpdates[0].type).toBe('sync_step1');
			expect(initialUpdates[0].data).toBeTruthy();
		});
	});

	describe('closePost()', () => {
		it('stops sync and clears doc', async () => {
			await connectAndOpen(session);

			await session.closePost();

			expect(mockSyncStop).toHaveBeenCalledTimes(1);
			expect(session.getState()).toBe('connected');
			expect(session.getCurrentPost()).toBeNull();
		});

		it('throws when not in editing state', async () => {
			await connectSession(session);
			await expect(session.closePost()).rejects.toThrow(/requires state/);
		});

		it('throws when disconnected', async () => {
			await expect(session.closePost()).rejects.toThrow(/requires state/);
		});

		it('returns to connected state', async () => {
			await connectAndOpen(session);

			await session.closePost();

			expect(session.getState()).toBe('connected');
			// Can open another post
			mockGetPost.mockResolvedValue({ ...fakePost, id: 99 });
			await session.openPost(99);
			expect(session.getState()).toBe('editing');
		});
	});

	describe('readPost()', () => {
		it('returns rendered text', async () => {
			await connectAndOpen(session);

			const text = session.readPost();

			expect(text).toContain('Title: "Hello World"');
			expect(text).toContain('core/paragraph');
			expect(text).toContain('First paragraph');
		});

		it('throws when not editing', async () => {
			await connectSession(session);
			expect(() => session.readPost()).toThrow(/requires state/);
		});
	});

	describe('readBlock()', () => {
		it('returns rendered block text', async () => {
			await connectAndOpen(session);

			const text = session.readBlock('0');

			expect(text).toContain('core/paragraph');
			expect(text).toContain('First paragraph');
		});

		it('throws for invalid index', async () => {
			await connectAndOpen(session);

			expect(() => session.readBlock('999')).toThrow('Block not found');
		});
	});

	describe('updateBlock()', () => {
		it('modifies block content in doc', async () => {
			await connectAndOpen(session);

			session.updateBlock('0', { content: 'Updated paragraph' });

			const text = session.readPost();
			expect(text).toContain('Updated paragraph');
		});

		it('throws when not editing', async () => {
			await connectSession(session);
			expect(() => {
				session.updateBlock('0', { content: 'test' });
			}).toThrow(/requires state/);
		});

		it('streams long content in chunks', async () => {
			vi.useFakeTimers();
			await connectAndOpen(session);

			const longContent =
				'This is a long paragraph that should be streamed in chunks to the browser.';
			session.updateBlock('0', { content: longContent });

			// Advance through all streaming delays
			await vi.runAllTimersAsync();

			const text = session.readPost();
			expect(text).toContain(longContent);
			// flushQueue should have been called for streaming chunks
			expect(mockSyncFlushQueue).toHaveBeenCalled();

			vi.useRealTimers();
		});

		it('applies short content atomically and flushes once', async () => {
			await connectAndOpen(session);
			mockSyncFlushQueue.mockClear();

			session.updateBlock('0', { content: 'Short' });

			const text = session.readPost();
			expect(text).toContain('Short');
			// Atomic changes are flushed once to push to browser immediately
			expect(mockSyncFlushQueue).toHaveBeenCalledTimes(1);
		});
	});

	describe('streaming queue', () => {
		it('drainStreamQueue resolves immediately when queue is empty', async () => {
			await connectAndOpen(session);

			// Should resolve immediately — no-op when nothing is queued
			await session.drainStreamQueue();
		});

		it('insertBlock returns before streaming completes', async () => {
			vi.useFakeTimers();
			await connectAndOpen(session);
			mockSyncFlushQueue.mockClear();

			const longContent =
				'This is a long paragraph that will be streamed in the background.';
			session.insertBlock(0, {
				name: 'core/paragraph',
				content: longContent,
			});

			// Method returned, but content should NOT be fully in doc yet
			// (only structure + possibly first chunk are committed synchronously)
			const textBeforeDrain = session.readPost();
			// Block structure exists
			expect(textBeforeDrain).toContain('core/paragraph');

			// Now drain the queue (advance all timers for streaming)
			const drainPromise = session.drainStreamQueue();
			await vi.runAllTimersAsync();
			await drainPromise;

			// Content should now be fully streamed
			const textAfterDrain = session.readPost();
			expect(textAfterDrain).toContain(longContent);

			vi.useRealTimers();
		});

		it('multiple insertBlock calls queue and stream sequentially', async () => {
			vi.useFakeTimers();
			await connectAndOpen(session);

			const content1 =
				'First paragraph with enough text to trigger streaming.';
			const content2 =
				'Second paragraph with enough text to trigger streaming.';

			// Both return immediately
			session.insertBlock(0, {
				name: 'core/paragraph',
				content: content1,
			});
			session.insertBlock(1, {
				name: 'core/paragraph',
				content: content2,
			});

			// Drain both
			const drainPromise = session.drainStreamQueue();
			await vi.runAllTimersAsync();
			await drainPromise;

			const text = session.readPost();
			expect(text).toContain(content1);
			expect(text).toContain(content2);

			vi.useRealTimers();
		});

		it('applies short delta atomically when update changes few characters', async () => {
			vi.useFakeTimers();
			await connectAndOpen(session);

			// Insert a block with long content (>= STREAM_THRESHOLD)
			const original =
				'This is a long paragraph with enough text to stream.';
			session.insertBlock(0, {
				name: 'core/paragraph',
				content: original,
			});
			const drain1 = session.drainStreamQueue();
			await vi.runAllTimersAsync();
			await drain1;

			// Update with a small change — only "stream" → "work" differs.
			// The full string is >= STREAM_THRESHOLD so it's enqueued, but
			// streamTextToYText computes a short delta insert (< 20 chars).
			session.updateBlock('0', {
				content: 'This is a long paragraph with enough text to work.',
			});
			const drain2 = session.drainStreamQueue();
			await vi.runAllTimersAsync();
			await drain2;

			const text = session.readPost();
			expect(text).toContain('enough text to work');

			vi.useRealTimers();
		});

		it('save drains queue before marking saved', async () => {
			vi.useFakeTimers();
			await connectAndOpen(session);

			const longContent =
				'Content that needs to be fully streamed before save.';
			session.insertBlock(0, {
				name: 'core/paragraph',
				content: longContent,
			});

			// save() should drain the queue first
			const savePromise = session.save();
			await vi.runAllTimersAsync();
			await savePromise;

			// Content should be fully in doc after save completes
			const text = session.readPost();
			expect(text).toContain(longContent);

			vi.useRealTimers();
		});

		it('closePost drains queue before teardown', async () => {
			vi.useFakeTimers();
			await connectAndOpen(session);

			const longContent =
				'Content that needs to finish streaming before close.';
			session.insertBlock(0, {
				name: 'core/paragraph',
				content: longContent,
			});

			// closePost() should drain the queue first
			const closePromise = session.closePost();
			await vi.runAllTimersAsync();
			await closePromise;

			expect(session.getState()).toBe('connected');

			vi.useRealTimers();
		});

		it('flushes block structure to browser immediately on insert', async () => {
			await connectAndOpen(session);
			mockSyncFlushQueue.mockClear();

			session.insertBlock(0, {
				name: 'core/paragraph',
				content: 'short',
			});

			// flushQueue should be called synchronously after atomic insert
			expect(mockSyncFlushQueue).toHaveBeenCalled();
		});
	});

	describe('editBlockText()', () => {
		it('applies a single find-and-replace edit', async () => {
			await connectAndOpen(session);

			const result = session.editBlockText('0', [
				{ find: 'First', replace: 'Updated' },
			]);

			expect(result.appliedCount).toBe(1);
			expect(result.failedCount).toBe(0);
			expect(result.updatedText).toBe('Updated paragraph');
			expect(session.readBlock('0')).toContain('Updated paragraph');
		});

		it('applies multiple sequential edits with position adjustment', async () => {
			await connectAndOpen(session);

			const result = session.editBlockText('0', [
				{ find: 'First', replace: 'My' },
				{ find: 'paragraph', replace: 'text' },
			]);

			expect(result.appliedCount).toBe(2);
			expect(result.failedCount).toBe(0);
			expect(result.updatedText).toBe('My text');
		});

		it('reports failure when find text is not found', async () => {
			await connectAndOpen(session);

			const result = session.editBlockText('0', [
				{ find: 'nonexistent', replace: 'something' },
			]);

			expect(result.appliedCount).toBe(0);
			expect(result.failedCount).toBe(1);
			expect(result.edits[0].applied).toBe(false);
			expect(result.edits[0].error).toContain('not found');
			// Content unchanged
			expect(session.readBlock('0')).toContain('First paragraph');
		});

		it('handles partial success (one found, one not)', async () => {
			await connectAndOpen(session);

			const result = session.editBlockText('0', [
				{ find: 'First', replace: 'My' },
				{ find: 'nonexistent', replace: 'something' },
			]);

			expect(result.appliedCount).toBe(1);
			expect(result.failedCount).toBe(1);
			expect(result.edits[0].applied).toBe(true);
			expect(result.edits[1].applied).toBe(false);
			expect(result.updatedText).toBe('My paragraph');
		});

		it('deletes text when replace is empty', async () => {
			await connectAndOpen(session);

			const result = session.editBlockText('0', [
				{ find: 'First ', replace: '' },
			]);

			expect(result.appliedCount).toBe(1);
			expect(result.updatedText).toBe('paragraph');
		});

		it('replaces the Nth occurrence with occurrence parameter', async () => {
			await connectAndOpen(session);

			// Set up block with repeated text
			session.updateBlock('0', {
				content: 'the cat and the dog and the bird',
			});
			await session.drainStreamQueue();

			const result = session.editBlockText('0', [
				{ find: 'the', replace: 'a', occurrence: 2 },
			]);

			expect(result.appliedCount).toBe(1);
			expect(result.updatedText).toBe('the cat and a dog and the bird');
		});

		it('fails when requested occurrence exceeds actual count', async () => {
			await connectAndOpen(session);

			const result = session.editBlockText('0', [
				{ find: 'First', replace: 'My', occurrence: 5 },
			]);

			expect(result.appliedCount).toBe(0);
			expect(result.failedCount).toBe(1);
			expect(result.edits[0].error).toContain('Occurrence 5');
		});

		it('throws for non-rich-text attribute', async () => {
			await connectAndOpen(session);

			expect(() =>
				session.editBlockText(
					'1',
					[{ find: 'test', replace: 'test2' }],
					'level'
				)
			).toThrow('not a rich-text attribute');
		});

		it('throws when block not found', async () => {
			await connectAndOpen(session);

			expect(() =>
				session.editBlockText('999', [
					{ find: 'test', replace: 'test2' },
				])
			).toThrow('Block 999 not found');
		});

		it('throws when not in editing state', async () => {
			await connectSession(session);

			expect(() =>
				session.editBlockText('0', [{ find: 'test', replace: 'test2' }])
			).toThrow(/requires state/);
		});

		it('rejects invalid occurrence values', async () => {
			await connectAndOpen(session);

			const result = session.editBlockText('0', [
				{ find: 'First', replace: 'My', occurrence: 0 },
				{ find: 'paragraph', replace: 'text', occurrence: -1 },
				{ find: 'First', replace: 'My', occurrence: 1.5 },
			]);

			expect(result.appliedCount).toBe(0);
			expect(result.failedCount).toBe(3);
			expect(result.edits[0].error).toContain(
				'Invalid occurrence value: 0'
			);
			expect(result.edits[1].error).toContain(
				'Invalid occurrence value: -1'
			);
			expect(result.edits[2].error).toContain(
				'Invalid occurrence value: 1.5'
			);
			// Content should be unchanged
			expect(session.readBlock('0')).toContain('First paragraph');
		});

		it('rejects empty find string', async () => {
			await connectAndOpen(session);

			const result = session.editBlockText('0', [
				{ find: '', replace: 'something' },
			]);

			expect(result.appliedCount).toBe(0);
			expect(result.failedCount).toBe(1);
			expect(result.edits[0].error).toContain('Empty find string');
		});

		it('handles HTML-containing content', async () => {
			await connectAndOpen(session);

			session.updateBlock('0', {
				content: 'This is <strong>bold</strong> text',
			});
			await session.drainStreamQueue();

			const result = session.editBlockText('0', [
				{
					find: '<strong>bold</strong>',
					replace: '<strong>important</strong>',
				},
			]);

			expect(result.appliedCount).toBe(1);
			expect(result.updatedText).toBe(
				'This is <strong>important</strong> text'
			);
		});

		it('flushes sync queue when edits are applied', async () => {
			await connectAndOpen(session);

			session.editBlockText('0', [{ find: 'First', replace: 'Updated' }]);

			expect(mockSyncFlushQueue).toHaveBeenCalledTimes(1);
		});

		it('does not flush sync queue when all edits fail', async () => {
			await connectAndOpen(session);

			session.editBlockText('0', [
				{ find: 'nonexistent', replace: 'something' },
			]);

			expect(mockSyncFlushQueue).not.toHaveBeenCalled();
		});

		it('defaults attribute to content', async () => {
			await connectAndOpen(session);

			// Should work without specifying attribute (defaults to "content")
			const result = session.editBlockText('0', [
				{ find: 'First', replace: 'Default' },
			]);

			expect(result.appliedCount).toBe(1);
			expect(result.updatedText).toBe('Default paragraph');
		});

		it('edits a custom rich-text attribute', async () => {
			await connectAndOpen(session);

			// Insert a pullquote block which has 'value' and 'citation' as rich-text attributes
			session.insertBlock(2, {
				name: 'core/pullquote',
				attributes: {
					value: 'A wise saying',
					citation: 'Someone Famous',
				},
			});

			const result = session.editBlockText(
				'2',
				[{ find: 'Someone', replace: 'Nobody' }],
				'citation'
			);

			expect(result.appliedCount).toBe(1);
			expect(result.updatedText).toBe('Nobody Famous');
		});

		it('throws for empty Y.Text attribute', async () => {
			await connectAndOpen(session);

			// Insert a block with no content set
			session.insertBlock(2, {
				name: 'core/paragraph',
				attributes: {},
			});

			expect(() =>
				session.editBlockText('2', [{ find: 'test', replace: 'test2' }])
			).toThrow('empty');
		});

		it('gracefully handles edit 2 failing when edit 1 modified its target', async () => {
			await connectAndOpen(session);

			// Edit 1 replaces text that edit 2 targets
			const result = session.editBlockText('0', [
				{ find: 'First paragraph', replace: 'Rewritten' },
				{ find: 'paragraph', replace: 'text' },
			]);

			expect(result.appliedCount).toBe(1);
			expect(result.failedCount).toBe(1);
			expect(result.edits[0].applied).toBe(true);
			expect(result.edits[1].applied).toBe(false);
			expect(result.edits[1].error).toContain('not found');
			expect(result.updatedText).toBe('Rewritten');
		});

		it('is case-sensitive when matching find strings', async () => {
			await connectAndOpen(session);

			const result = session.editBlockText('0', [
				{ find: 'first', replace: 'Updated' },
			]);

			// "first" (lowercase) should not match "First" (capitalized)
			expect(result.appliedCount).toBe(0);
			expect(result.failedCount).toBe(1);
		});

		it('applies edit at position 0 without retain op', async () => {
			await connectAndOpen(session);

			// "First" is at position 0 — the delta should be [delete, insert] with no leading retain
			const result = session.editBlockText('0', [
				{ find: 'First', replace: 'The first' },
			]);

			expect(result.appliedCount).toBe(1);
			expect(result.updatedText).toBe('The first paragraph');
		});
	});

	describe('insertBlock()', () => {
		it('adds a new block to the doc', async () => {
			vi.useFakeTimers();
			await connectAndOpen(session);

			session.insertBlock(0, {
				name: 'core/paragraph',
				content: 'New first paragraph',
			});
			await vi.runAllTimersAsync();

			const text = session.readPost();
			expect(text).toContain('New first paragraph');

			vi.useRealTimers();
		});

		it('inserts at the correct position', async () => {
			await connectAndOpen(session);

			session.insertBlock(1, {
				name: 'core/paragraph',
				content: 'Inserted at 1',
			});

			// Read block at position 1
			const blockText = session.readBlock('1');
			expect(blockText).toContain('Inserted at 1');
		});

		it('streams content after block structure appears', async () => {
			vi.useFakeTimers();
			await connectAndOpen(session);

			const longContent =
				'This is a long paragraph that exceeds the streaming threshold for testing.';
			session.insertBlock(0, {
				name: 'core/paragraph',
				content: longContent,
			});
			await vi.runAllTimersAsync();

			// Block should exist with full content
			const block = session.readBlock('0');
			expect(block).toContain(longContent);
			// flushQueue should have been called for streaming
			expect(mockSyncFlushQueue).toHaveBeenCalled();

			vi.useRealTimers();
		});
	});

	describe('insertBlock() block type validation', () => {
		it('allows unknown block types with fallback registry (validation skipped)', async () => {
			await connectAndOpen(session);

			// core/separator is NOT in the fallback set, but the fallback registry
			// skips the unknown block type check, so insertion should succeed.
			session.insertBlock(0, { name: 'core/separator' });

			const text = session.readPost();
			expect(text).toContain('core/separator');
		});

		it('rejects unknown block types with API-sourced registry', async () => {
			// Set up mockGetBlockTypes to succeed so connect() builds an API-sourced registry
			mockGetBlockTypes.mockResolvedValueOnce([
				{
					name: 'core/paragraph',
					attributes: { content: { type: 'rich-text' } },
				},
				{
					name: 'core/heading',
					attributes: { content: { type: 'rich-text' } },
				},
				{
					name: 'core/list',
					attributes: {
						ordered: { type: 'boolean', default: false },
					},
				},
				{
					name: 'core/list-item',
					attributes: { content: { type: 'rich-text' } },
				},
			]);

			mockValidateConnection.mockResolvedValue(fakeUser);
			mockValidateSyncEndpoint.mockResolvedValue(undefined);
			await session.connect(fakeConfig);
			mockGetPost.mockResolvedValue(fakePost);
			await session.openPost(42);

			expect(() => {
				session.insertBlock(0, { name: 'custom/nonexistent-block' });
			}).toThrow(/Unknown block type: custom\/nonexistent-block/);
		});
	});

	describe('insertBlock() with innerBlocks', () => {
		it('inserts a list block with list-item inner blocks', async () => {
			vi.useFakeTimers();
			await connectAndOpen(session);

			session.insertBlock(0, {
				name: 'core/list',
				innerBlocks: [
					{ name: 'core/list-item', content: 'First item' },
					{ name: 'core/list-item', content: 'Second item' },
				],
			});
			await vi.runAllTimersAsync();

			const text = session.readPost();
			expect(text).toContain('core/list');
			expect(text).toContain('First item');
			expect(text).toContain('Second item');

			vi.useRealTimers();
		});
	});

	describe('insertInnerBlock()', () => {
		it('adds a list-item to an existing list', async () => {
			vi.useFakeTimers();
			await connectAndOpen(session);

			// First, insert a list with one item
			session.insertBlock(0, {
				name: 'core/list',
				innerBlocks: [
					{ name: 'core/list-item', content: 'Existing item' },
				],
			});
			await vi.runAllTimersAsync();

			// Now add an inner block to the list
			session.insertInnerBlock('0', 1, {
				name: 'core/list-item',
				content: 'New item',
			});
			await vi.runAllTimersAsync();

			const text = session.readPost();
			expect(text).toContain('Existing item');
			expect(text).toContain('New item');

			vi.useRealTimers();
		});
	});

	describe('removeInnerBlocks()', () => {
		it('removes inner blocks from an existing block', async () => {
			vi.useFakeTimers();
			await connectAndOpen(session);

			// Insert a list with three items
			session.insertBlock(0, {
				name: 'core/list',
				innerBlocks: [
					{ name: 'core/list-item', content: 'Keep' },
					{ name: 'core/list-item', content: 'Remove' },
					{ name: 'core/list-item', content: 'Also keep' },
				],
			});
			await vi.runAllTimersAsync();

			// Remove the middle inner block
			session.removeInnerBlocks('0', 1, 1);

			const text = session.readPost();
			expect(text).toContain('Keep');
			expect(text).not.toContain('Remove');
			expect(text).toContain('Also keep');

			vi.useRealTimers();
		});
	});

	describe('removeBlocks()', () => {
		it('removes blocks from the doc', async () => {
			await connectAndOpen(session);

			session.removeBlocks(0, 1);

			const text = session.readPost();
			expect(text).not.toContain('First paragraph');
			// The heading should now be at index 0
			expect(text).toContain('A Heading');
		});
	});

	describe('moveBlock()', () => {
		it('moves a block to a new position', async () => {
			await connectAndOpen(session);

			// Move block 0 (paragraph) to position 2 (after heading)
			session.moveBlock(0, 2);

			// Heading should now be first
			const block0 = session.readBlock('0');
			expect(block0).toContain('core/heading');
		});
	});

	describe('replaceBlocks()', () => {
		it('replaces a range of blocks', async () => {
			vi.useFakeTimers();
			await connectAndOpen(session);

			session.replaceBlocks(0, 1, [
				{ name: 'core/paragraph', content: 'Replacement paragraph' },
			]);
			await vi.runAllTimersAsync();

			const text = session.readPost();
			expect(text).toContain('Replacement paragraph');
			expect(text).not.toContain('First paragraph');
			// Heading should still be there
			expect(text).toContain('A Heading');

			vi.useRealTimers();
		});

		it('rejects unknown block types in replacement with API-sourced registry', async () => {
			// Set up mockGetBlockTypes to succeed so connect() builds an API-sourced registry
			mockGetBlockTypes.mockResolvedValueOnce([
				{
					name: 'core/paragraph',
					attributes: { content: { type: 'rich-text' } },
				},
				{
					name: 'core/heading',
					attributes: { content: { type: 'rich-text' } },
				},
			]);

			mockValidateConnection.mockResolvedValue(fakeUser);
			mockValidateSyncEndpoint.mockResolvedValue(undefined);
			await session.connect(fakeConfig);
			mockGetPost.mockResolvedValue(fakePost);
			await session.openPost(42);

			expect(() => {
				session.replaceBlocks(0, 1, [
					{ name: 'custom/nonexistent-block' },
				]);
			}).toThrow(/Unknown block type: custom\/nonexistent-block/);
		});
	});

	describe('setTitle()', () => {
		it('updates the title in the doc', async () => {
			await connectAndOpen(session);

			session.setTitle('New Title');

			const text = session.readPost();
			expect(text).toContain('Title: "New Title"');
		});

		it('throws when not editing', async () => {
			await connectSession(session);
			expect(() => {
				session.setTitle('test');
			}).toThrow(/requires state/);
		});

		it('streams long titles', async () => {
			vi.useFakeTimers();
			await connectAndOpen(session);

			const longTitle =
				'This Is A Very Long Title That Should Be Streamed';
			session.setTitle(longTitle);
			await vi.runAllTimersAsync();

			const text = session.readPost();
			expect(text).toContain(longTitle);
			expect(mockSyncFlushQueue).toHaveBeenCalled();

			vi.useRealTimers();
		});
	});

	describe('save()', () => {
		it('marks doc as saved', async () => {
			await connectAndOpen(session);

			// Should not throw
			await session.save();
		});

		it('throws when not editing', async () => {
			await connectSession(session);
			await expect(session.save()).rejects.toThrow(/requires state/);
		});
	});

	describe('listPosts()', () => {
		it('delegates to API client', async () => {
			await connectSession(session);
			mockListPosts.mockResolvedValue([fakePost]);

			const posts = await session.listPosts({ status: 'draft' });

			expect(posts).toEqual([fakePost]);
			expect(mockListPosts).toHaveBeenCalledWith({ status: 'draft' });
		});

		it('throws when disconnected', async () => {
			await expect(session.listPosts()).rejects.toThrow(/requires state/);
		});

		it('works while editing', async () => {
			await connectAndOpen(session);
			mockListPosts.mockResolvedValue([fakePost]);

			const posts = await session.listPosts();
			expect(posts).toEqual([fakePost]);
		});
	});

	describe('createPost()', () => {
		it('creates a post and opens it', async () => {
			await connectSession(session);
			const newPost = {
				...fakePost,
				id: 99,
				title: { rendered: 'New', raw: 'New' },
			};
			mockCreatePost.mockResolvedValue(newPost);
			mockGetPost.mockResolvedValue(newPost);

			const post = await session.createPost({ title: 'New' });

			expect(post).toEqual(newPost);
			expect(session.getState()).toBe('editing');
			expect(mockCreatePost).toHaveBeenCalledWith({
				title: 'New',
				content: undefined,
				status: 'draft',
			});
		});
	});

	describe('disconnect()', () => {
		it('cleans up everything from connected state', async () => {
			await connectSession(session);

			await session.disconnect();

			expect(session.getState()).toBe('disconnected');
			expect(session.getUser()).toBeNull();
			expect(session.getCurrentPost()).toBeNull();
			expect(session.getCollaborators()).toEqual([]);
		});

		it('cleans up everything from editing state', async () => {
			await connectAndOpen(session);

			await session.disconnect();

			expect(session.getState()).toBe('disconnected');
			expect(mockSyncStop).toHaveBeenCalledTimes(1);
			expect(session.getUser()).toBeNull();
			expect(session.getCurrentPost()).toBeNull();
		});

		it('is safe to call when already disconnected', async () => {
			await session.disconnect();
			expect(session.getState()).toBe('disconnected');
		});
	});

	describe('getState()', () => {
		it('starts as disconnected', () => {
			expect(session.getState()).toBe('disconnected');
		});
	});

	describe('getSyncStatus()', () => {
		it('returns null when not editing', () => {
			expect(session.getSyncStatus()).toBeNull();
		});

		it('returns sync status when editing', async () => {
			await connectAndOpen(session);

			const status = session.getSyncStatus();
			expect(status).toEqual({
				isPolling: true,
				hasCollaborators: false,
				queueSize: 0,
			});
		});
	});

	describe('getCollaborators()', () => {
		it('returns empty array when no collaborators', async () => {
			await connectAndOpen(session);
			expect(session.getCollaborators()).toEqual([]);
		});
	});

	describe('sync callbacks', () => {
		it('wires onUpdate to processIncomingUpdate', async () => {
			await connectSession(session);
			mockGetPost.mockResolvedValue(fakePost);
			await session.openPost(42);

			// The sync client start was called with callbacks
			const callbacks = mockSyncStart.mock.calls[0][3];
			expect(callbacks.onUpdate).toBeDefined();
			expect(typeof callbacks.onUpdate).toBe('function');
		});

		it('wires onAwareness callback', async () => {
			await connectSession(session);
			mockGetPost.mockResolvedValue(fakePost);
			await session.openPost(42);

			const callbacks = mockSyncStart.mock.calls[0][3];

			// Simulate awareness update with a collaborator
			callbacks.onAwareness({
				'200': {
					collaboratorInfo: {
						id: 2,
						name: 'Editor',
						slug: 'editor',
						avatar_urls: {},
						browserType: 'Chrome',
						enteredAt: Date.now(),
					},
				},
			});

			expect(session.getCollaborators()).toHaveLength(1);
			expect(session.getCollaborators()[0].name).toBe('Editor');
		});

		it('wires getAwarenessState callback', async () => {
			await connectSession(session);
			mockGetPost.mockResolvedValue(fakePost);
			await session.openPost(42);

			const callbacks = mockSyncStart.mock.calls[0][3];
			const state = callbacks.getAwarenessState();

			expect(state).toBeDefined();
			expect(state).toHaveProperty('collaboratorInfo');
		});

		it('passes doc clientID to sync start', async () => {
			await connectSession(session);
			mockGetPost.mockResolvedValue(fakePost);
			await session.openPost(42);

			const [, clientId] = mockSyncStart.mock.calls[0];
			expect(typeof clientId).toBe('number');
			expect(clientId).toBeGreaterThan(0);
		});
	});

	describe('insertBlock() schema validation', () => {
		async function connectWithBlockTypes(blockTypes: unknown[]) {
			const s = new SessionManager();
			s.syncWaitTimeout = 0;
			s.postHealthCheckInterval = 0;
			mockGetBlockTypes.mockResolvedValueOnce(blockTypes);
			mockValidateConnection.mockResolvedValue(fakeUser);
			mockValidateSyncEndpoint.mockResolvedValue(undefined);
			await s.connect(fakeConfig);
			mockGetPost.mockResolvedValue(fakePost);
			await s.openPost(42);
			return s;
		}

		it('auto-wraps content into inner core/paragraph for blocks with InnerBlocks support', async () => {
			vi.useFakeTimers();
			const s = await connectWithBlockTypes([
				{
					name: 'core/paragraph',
					attributes: { content: { type: 'rich-text' } },
				},
				{
					name: 'core/quote',
					attributes: {
						citation: { type: 'rich-text' },
					},
					supports: { allowedBlocks: true },
				},
			]);

			try {
				s.insertBlock(0, { name: 'core/quote', content: 'Quote text' });
				await vi.runAllTimersAsync();

				const text = s.readPost();
				expect(text).toContain('core/quote');
				expect(text).toContain('core/paragraph');
				expect(text).toContain('Quote text');
			} finally {
				await s.disconnect();
				vi.useRealTimers();
			}
		});

		it('rejects content for blocks without content attribute and without InnerBlocks support', async () => {
			const s = await connectWithBlockTypes([
				{
					name: 'core/paragraph',
					attributes: { content: { type: 'rich-text' } },
				},
				{
					name: 'core/pullquote',
					attributes: {
						value: { type: 'rich-text' },
						citation: { type: 'rich-text' },
					},
				},
			]);

			try {
				expect(() => {
					s.insertBlock(0, {
						name: 'core/pullquote',
						content: 'text',
					});
				}).toThrow(/does not have a "content" attribute/);

				// Error message should mention available rich-text attributes
				expect(() => {
					s.insertBlock(0, {
						name: 'core/pullquote',
						content: 'text',
					});
				}).toThrow(/value/);
			} finally {
				await s.disconnect();
			}
		});

		it('rejects content for blocks that do not allow core/paragraph as inner block', async () => {
			const s = await connectWithBlockTypes([
				{
					name: 'core/paragraph',
					attributes: { content: { type: 'rich-text' } },
				},
				{
					name: 'core/custom-block',
					attributes: {
						someAttr: { type: 'string' },
					},
					supports: { allowedBlocks: true },
					allowed_blocks: ['core/heading'],
				},
			]);

			try {
				expect(() => {
					s.insertBlock(0, {
						name: 'core/custom-block',
						content: 'text',
					});
				}).toThrow(/does not have a "content" attribute/);
			} finally {
				await s.disconnect();
			}
		});

		it('prepends content paragraph before existing innerBlocks', async () => {
			vi.useFakeTimers();
			const s = await connectWithBlockTypes([
				{
					name: 'core/paragraph',
					attributes: { content: { type: 'rich-text' } },
				},
				{
					name: 'core/quote',
					attributes: {
						citation: { type: 'rich-text' },
					},
					supports: { allowedBlocks: true },
				},
			]);

			try {
				s.insertBlock(0, {
					name: 'core/quote',
					content: 'Main quote',
					innerBlocks: [
						{ name: 'core/paragraph', content: 'Extra paragraph' },
					],
				});
				await vi.runAllTimersAsync();

				const text = s.readPost();
				expect(text).toContain('Main quote');
				expect(text).toContain('Extra paragraph');
				const mainIdx = text.indexOf('Main quote');
				const extraIdx = text.indexOf('Extra paragraph');
				expect(mainIdx).toBeLessThan(extraIdx);
			} finally {
				await s.disconnect();
				vi.useRealTimers();
			}
		});

		it('streams auto-wrapped content exceeding STREAM_THRESHOLD', async () => {
			vi.useFakeTimers();
			const longText =
				'This is a long quote that exceeds the streaming threshold for progressive insertion.';
			const s = await connectWithBlockTypes([
				{
					name: 'core/paragraph',
					attributes: { content: { type: 'rich-text' } },
				},
				{
					name: 'core/quote',
					attributes: {
						citation: { type: 'rich-text' },
					},
					supports: { allowedBlocks: true },
				},
			]);

			try {
				s.insertBlock(0, { name: 'core/quote', content: longText });
				await vi.runAllTimersAsync();

				const text = s.readPost();
				expect(text).toContain(longText);
			} finally {
				await s.disconnect();
				vi.useRealTimers();
			}
		});

		it('rejects unknown attributes', async () => {
			const s = await connectWithBlockTypes([
				{
					name: 'core/paragraph',
					attributes: {
						content: { type: 'rich-text' },
						dropCap: { type: 'boolean', default: false },
					},
				},
				{
					name: 'core/heading',
					attributes: { content: { type: 'rich-text' } },
				},
			]);

			try {
				expect(() => {
					s.insertBlock(0, {
						name: 'core/paragraph',
						attributes: { content: 'hello', unknownAttr: true },
					});
				}).toThrow(/Unknown attribute/);

				expect(() => {
					s.insertBlock(0, {
						name: 'core/paragraph',
						attributes: { content: 'hello', unknownAttr: true },
					});
				}).toThrow(/unknownAttr/);
			} finally {
				await s.disconnect();
			}
		});

		it('rejects inner block that violates parent constraint', async () => {
			const s = await connectWithBlockTypes([
				{
					name: 'core/paragraph',
					attributes: { content: { type: 'rich-text' } },
				},
				{
					name: 'core/heading',
					attributes: { content: { type: 'rich-text' } },
				},
				{ name: 'core/list', attributes: null },
				{
					name: 'core/column',
					attributes: null,
					parent: ['core/columns'],
				},
			]);

			try {
				expect(() => {
					s.insertBlock(0, {
						name: 'core/list',
						innerBlocks: [{ name: 'core/column' }],
					});
				}).toThrow(/can only be nested inside/);

				expect(() => {
					s.insertBlock(0, {
						name: 'core/list',
						innerBlocks: [{ name: 'core/column' }],
					});
				}).toThrow(/core\/columns/);
			} finally {
				await s.disconnect();
			}
		});

		it("rejects inner block not in parent's allowedBlocks", async () => {
			const s = await connectWithBlockTypes([
				{
					name: 'core/paragraph',
					attributes: { content: { type: 'rich-text' } },
				},
				{
					name: 'core/heading',
					attributes: { content: { type: 'rich-text' } },
				},
				{
					name: 'core/list',
					attributes: null,
					allowed_blocks: ['core/list-item'],
				},
				{
					name: 'core/list-item',
					attributes: { content: { type: 'rich-text' } },
				},
			]);

			try {
				expect(() => {
					s.insertBlock(0, {
						name: 'core/list',
						innerBlocks: [
							{ name: 'core/paragraph', content: 'text' },
						],
					});
				}).toThrow(/only allows these inner blocks/);

				expect(() => {
					s.insertBlock(0, {
						name: 'core/list',
						innerBlocks: [
							{ name: 'core/paragraph', content: 'text' },
						],
					});
				}).toThrow(/core\/list-item/);
			} finally {
				await s.disconnect();
			}
		});

		it('rejects top-level insertion of block with parent constraint', async () => {
			const s = await connectWithBlockTypes([
				{
					name: 'core/paragraph',
					attributes: { content: { type: 'rich-text' } },
				},
				{ name: 'core/columns', attributes: null },
				{
					name: 'core/column',
					attributes: null,
					parent: ['core/columns'],
				},
			]);

			try {
				expect(() => {
					s.insertBlock(0, { name: 'core/column' });
				}).toThrow(/cannot be inserted at the top level/);

				expect(() => {
					s.insertBlock(0, { name: 'core/column' });
				}).toThrow(/core\/columns/);
			} finally {
				await s.disconnect();
			}
		});

		it('auto-wraps content in replaceBlocks', async () => {
			vi.useFakeTimers();
			const s = await connectWithBlockTypes([
				{
					name: 'core/paragraph',
					attributes: { content: { type: 'rich-text' } },
				},
				{
					name: 'core/quote',
					attributes: {
						citation: { type: 'rich-text' },
					},
					supports: { allowedBlocks: true },
				},
			]);

			try {
				// Insert a placeholder block first
				s.insertBlock(0, {
					name: 'core/paragraph',
					content: 'placeholder',
				});
				await vi.runAllTimersAsync();

				// Replace it with a quote using content
				s.replaceBlocks(0, 1, [
					{ name: 'core/quote', content: 'Replaced quote' },
				]);
				await vi.runAllTimersAsync();

				const text = s.readPost();
				expect(text).toContain('core/quote');
				expect(text).toContain('Replaced quote');
				expect(text).not.toContain('placeholder');
			} finally {
				await s.disconnect();
				vi.useRealTimers();
			}
		});

		it('accepts valid attributes and inner blocks', async () => {
			vi.useFakeTimers();

			const s = await connectWithBlockTypes([
				{
					name: 'core/paragraph',
					attributes: { content: { type: 'rich-text' } },
				},
				{
					name: 'core/heading',
					attributes: { content: { type: 'rich-text' } },
				},
				{
					name: 'core/list',
					attributes: {
						ordered: { type: 'boolean', default: false },
					},
					allowed_blocks: ['core/list-item'],
				},
				{
					name: 'core/list-item',
					attributes: { content: { type: 'rich-text' } },
					parent: ['core/list'],
				},
			]);

			try {
				s.insertBlock(0, {
					name: 'core/list',
					innerBlocks: [
						{ name: 'core/list-item', content: 'Item one' },
						{ name: 'core/list-item', content: 'Item two' },
					],
				});
				await vi.runAllTimersAsync();

				const text = s.readPost();
				expect(text).toContain('core/list');
				expect(text).toContain('Item one');
				expect(text).toContain('Item two');
			} finally {
				await s.disconnect();
				vi.useRealTimers();
			}
		});
	});

	describe('uploadMedia()', () => {
		const fakeMediaResponse = {
			id: 101,
			source_url:
				'https://example.com/wp-content/uploads/2026/03/test.jpg',
			title: { rendered: 'test', raw: 'test' },
			caption: { rendered: '', raw: '' },
			alt_text: '',
			mime_type: 'image/jpeg',
			media_details: { width: 800, height: 600, sizes: {} },
		};

		beforeEach(() => {
			mockReadFile.mockResolvedValue(Buffer.from('fake image data'));
			mockUploadMedia.mockResolvedValue(fakeMediaResponse);
		});

		it('requires connected or editing state', async () => {
			await expect(
				session.uploadMedia('/path/to/file.jpg')
			).rejects.toThrow(/requires state connected or editing/);
		});

		it('works in connected state', async () => {
			await connectSession(session);

			const result = await session.uploadMedia('/path/to/photo.jpg');

			expect(result).toEqual(fakeMediaResponse);
			expect(mockReadFile).toHaveBeenCalledWith('/path/to/photo.jpg');
			expect(mockUploadMedia).toHaveBeenCalledWith(
				Buffer.from('fake image data'),
				'photo.jpg',
				'image/jpeg',
				undefined
			);
		});

		it('works in editing state', async () => {
			await connectAndOpen(session);

			const result = await session.uploadMedia('/path/to/photo.png');

			expect(result).toEqual(fakeMediaResponse);
			expect(mockUploadMedia).toHaveBeenCalledWith(
				expect.any(Buffer),
				'photo.png',
				'image/png',
				undefined
			);
		});

		it('passes optional metadata to API client', async () => {
			await connectSession(session);

			await session.uploadMedia('/path/to/photo.jpg', {
				altText: 'Scenic view',
				title: 'Sunset',
				caption: 'At dusk',
			});

			expect(mockUploadMedia).toHaveBeenCalledWith(
				expect.any(Buffer),
				'photo.jpg',
				'image/jpeg',
				{
					altText: 'Scenic view',
					title: 'Sunset',
					caption: 'At dusk',
				}
			);
		});

		it('detects MIME type from file extension', async () => {
			await connectSession(session);

			await session.uploadMedia('/path/to/clip.mp4');
			expect(mockUploadMedia).toHaveBeenCalledWith(
				expect.any(Buffer),
				'clip.mp4',
				'video/mp4',
				undefined
			);
		});

		it('throws for unsupported file types', async () => {
			await connectSession(session);

			await expect(
				session.uploadMedia('/path/to/file.xyz')
			).rejects.toThrow(/Unsupported file type/);
		});

		it('propagates file read errors', async () => {
			await connectSession(session);
			mockReadFile.mockRejectedValueOnce(
				new Error('ENOENT: no such file')
			);

			await expect(
				session.uploadMedia('/path/to/missing.jpg')
			).rejects.toThrow('ENOENT');
		});
	});

	describe('post metadata', () => {
		// A post with all metadata fields populated
		const fakePostWithMeta: WPPost = {
			...fakePost,
			categories: [1, 3],
			tags: [5],
			featured_media: 99,
			comment_status: 'open',
			sticky: false,
		};

		// Helper: returns a fresh copy with fields overridden by the update
		function updatedPost(fields: Partial<WPPost>): WPPost {
			return { ...fakePostWithMeta, ...fields };
		}

		/** Connect and open a post that has metadata fields. */
		async function connectAndOpenWithMeta(
			s: SessionManager
		): Promise<void> {
			mockValidateConnection.mockResolvedValue(fakeUser);
			mockValidateSyncEndpoint.mockResolvedValue(undefined);
			await s.connect(fakeConfig);
			mockGetPost.mockResolvedValue(fakePostWithMeta);
			await s.openPost(42);
		}

		describe('openPost() metadata loading', () => {
			it('loads categories into Y.Doc', async () => {
				await connectAndOpenWithMeta(session);
				session.readPost();
				// categories and tags IDs are stored in Y.Doc but rendered output
				// shows only the fields renderPost() exposes (status, date, slug, sticky, commentStatus, excerpt).
				// We verify via the internal state rather than rendered output for array properties.
				const postWithCats = session.getCurrentPost();
				assertDefined(postWithCats);
				expect(postWithCats.categories).toEqual([1, 3]);
			});

			it('loads tags into Y.Doc', async () => {
				await connectAndOpenWithMeta(session);
				const postWithTags = session.getCurrentPost();
				assertDefined(postWithTags);
				expect(postWithTags.tags).toEqual([5]);
			});

			it('loads featured_media into Y.Doc', async () => {
				await connectAndOpenWithMeta(session);
				const postWithMedia = session.getCurrentPost();
				assertDefined(postWithMedia);
				expect(postWithMedia.featured_media).toBe(99);
			});

			it('loads comment_status into Y.Doc', async () => {
				await connectAndOpenWithMeta(session);
				// comment_status=open means it should not show "Comments: closed"
				const text = session.readPost();
				expect(text).not.toContain('Comments: closed');
			});

			it('loads sticky into Y.Doc', async () => {
				await connectAndOpenWithMeta(session);
				// sticky=false means it should not show "Sticky: yes"
				const text = session.readPost();
				expect(text).not.toContain('Sticky: yes');
			});

			it('loads date into Y.Doc', async () => {
				await connectAndOpenWithMeta(session);
				const text = session.readPost();
				expect(text).toContain('Date: 2026-01-01T00:00:00');
			});

			it('skips categories when not present on post', async () => {
				await connectSession(session);
				const postWithoutMeta: WPPost = {
					...fakePost,
					// no categories field
				};
				mockGetPost.mockResolvedValue(postWithoutMeta);
				await session.openPost(42);
				// Should not throw, post opens normally
				expect(session.getState()).toBe('editing');
			});
		});

		describe('readPost() metadata rendering', () => {
			it('renders status', async () => {
				await connectAndOpenWithMeta(session);
				const text = session.readPost();
				expect(text).toContain('Status: draft');
			});

			it('renders slug', async () => {
				await connectAndOpenWithMeta(session);
				const text = session.readPost();
				expect(text).toContain('Slug: hello-world');
			});

			it('renders excerpt', async () => {
				await connectAndOpenWithMeta(session);
				const text = session.readPost();
				expect(text).toContain('Excerpt: "An excerpt"');
			});

			it('renders sticky when true', async () => {
				await connectSession(session);
				const stickyPost = { ...fakePostWithMeta, sticky: true };
				mockGetPost.mockResolvedValue(stickyPost);
				await session.openPost(42);

				const text = session.readPost();
				expect(text).toContain('Sticky: yes');
			});

			it('renders comments closed', async () => {
				await connectSession(session);
				const closedPost = {
					...fakePostWithMeta,
					comment_status: 'closed',
				};
				mockGetPost.mockResolvedValue(closedPost);
				await session.openPost(42);

				const text = session.readPost();
				expect(text).toContain('Comments: closed');
			});
		});

		describe('listCategories()', () => {
			const fakeTerms: WPTerm[] = [
				{
					id: 1,
					name: 'Uncategorized',
					slug: 'uncategorized',
					taxonomy: 'category',
				},
				{ id: 3, name: 'Tech', slug: 'tech', taxonomy: 'category' },
			];

			it('delegates to apiClient.listTerms with categories', async () => {
				await connectSession(session);
				mockListTerms.mockResolvedValue(fakeTerms);

				const result = await session.listCategories();

				expect(result).toEqual(fakeTerms);
				expect(mockListTerms).toHaveBeenCalledWith(
					'categories',
					undefined
				);
			});

			it('passes search and perPage options through', async () => {
				await connectSession(session);
				mockListTerms.mockResolvedValue([fakeTerms[1]]);

				const result = await session.listCategories({
					search: 'Tech',
					perPage: 10,
				});

				expect(result).toEqual([fakeTerms[1]]);
				expect(mockListTerms).toHaveBeenCalledWith('categories', {
					search: 'Tech',
					perPage: 10,
				});
			});

			it('works in editing state', async () => {
				await connectAndOpenWithMeta(session);
				mockListTerms.mockResolvedValue(fakeTerms);

				const result = await session.listCategories();
				expect(result).toEqual(fakeTerms);
			});

			it('throws when disconnected', async () => {
				await expect(session.listCategories()).rejects.toThrow(
					/requires state/
				);
			});
		});

		describe('listTags()', () => {
			const fakeTags: WPTerm[] = [
				{
					id: 5,
					name: 'JavaScript',
					slug: 'javascript',
					taxonomy: 'post_tag',
				},
			];

			it('delegates to apiClient.listTerms with tags', async () => {
				await connectSession(session);
				mockListTerms.mockResolvedValue(fakeTags);

				const result = await session.listTags();

				expect(result).toEqual(fakeTags);
				expect(mockListTerms).toHaveBeenCalledWith('tags', undefined);
			});

			it('passes options through', async () => {
				await connectSession(session);
				mockListTerms.mockResolvedValue(fakeTags);

				await session.listTags({ search: 'Java' });

				expect(mockListTerms).toHaveBeenCalledWith('tags', {
					search: 'Java',
				});
			});

			it('throws when disconnected', async () => {
				await expect(session.listTags()).rejects.toThrow(
					/requires state/
				);
			});
		});

		describe('setPostStatus()', () => {
			it('updates Y.Doc, calls REST API, and refreshes currentPost', async () => {
				await connectAndOpenWithMeta(session);
				const updated = updatedPost({ status: 'publish' });
				mockUpdatePost.mockResolvedValue(updated);

				const result = await session.setPostStatus('publish');

				expect(result).toEqual(updated);
				expect(mockUpdatePost).toHaveBeenCalledWith(42, {
					status: 'publish',
				});
				const postAfterUpdate = session.getCurrentPost();
				assertDefined(postAfterUpdate);
				expect(postAfterUpdate.status).toBe('publish');
				expect(mockSyncFlushQueue).toHaveBeenCalled();
			});

			it('reflects updated status in readPost()', async () => {
				await connectAndOpenWithMeta(session);
				mockUpdatePost.mockResolvedValue(
					updatedPost({ status: 'publish' })
				);

				await session.setPostStatus('publish');

				const text = session.readPost();
				expect(text).toContain('Status: publish');
			});

			it('throws when not editing', async () => {
				await connectSession(session);
				await expect(session.setPostStatus('publish')).rejects.toThrow(
					/requires state/
				);
			});
		});

		describe('setExcerpt()', () => {
			it('updates Y.Doc and REST API', async () => {
				await connectAndOpenWithMeta(session);
				const updated = updatedPost({
					excerpt: { rendered: '', raw: 'New excerpt' },
				});
				mockUpdatePost.mockResolvedValue(updated);

				const result = await session.setExcerpt('New excerpt');

				expect(result).toEqual(updated);
				expect(mockUpdatePost).toHaveBeenCalledWith(42, {
					excerpt: 'New excerpt',
				});
				expect(mockSyncFlushQueue).toHaveBeenCalled();
			});

			it('reflects updated excerpt in readPost()', async () => {
				await connectAndOpenWithMeta(session);
				mockUpdatePost.mockResolvedValue(updatedPost({}));

				await session.setExcerpt('Summary text');

				// The Y.Doc property was set, so readPost() should reflect it
				const text = session.readPost();
				expect(text).toContain('Excerpt: "Summary text"');
			});

			it('throws when not editing', async () => {
				await connectSession(session);
				await expect(session.setExcerpt('test')).rejects.toThrow(
					/requires state/
				);
			});
		});

		describe('setCategories()', () => {
			it('resolves existing categories by name and updates post', async () => {
				await connectAndOpenWithMeta(session);
				mockSearchTerms.mockResolvedValue([
					{ id: 3, name: 'Tech', slug: 'tech', taxonomy: 'category' },
				]);
				mockUpdatePost.mockResolvedValue(
					updatedPost({ categories: [3] })
				);

				const { post, resolved } = await session.setCategories([
					'Tech',
				]);

				expect(resolved).toEqual([
					{ name: 'Tech', id: 3, created: false },
				]);
				expect(mockUpdatePost).toHaveBeenCalledWith(42, {
					categories: [3],
				});
				expect(post.categories).toEqual([3]);
				expect(mockSyncFlushQueue).toHaveBeenCalled();
			});

			it('creates categories that do not exist', async () => {
				await connectAndOpenWithMeta(session);
				// Search returns no results
				mockSearchTerms.mockResolvedValue([]);
				mockCreateTerm.mockResolvedValue({
					id: 10,
					name: 'New Category',
					slug: 'new-category',
					taxonomy: 'category',
				});
				mockUpdatePost.mockResolvedValue(
					updatedPost({ categories: [10] })
				);

				const { resolved } = await session.setCategories([
					'New Category',
				]);

				expect(resolved).toEqual([
					{ name: 'New Category', id: 10, created: true },
				]);
				expect(mockCreateTerm).toHaveBeenCalledWith(
					'categories',
					'New Category'
				);
				expect(mockUpdatePost).toHaveBeenCalledWith(42, {
					categories: [10],
				});
			});

			it('creates when search returns only substring matches (not exact)', async () => {
				await connectAndOpenWithMeta(session);
				// Searching "AI" returns "Fair" (substring match, not exact)
				mockSearchTerms.mockResolvedValue([
					{ id: 7, name: 'Fair', slug: 'fair', taxonomy: 'category' },
				]);
				mockCreateTerm.mockResolvedValue({
					id: 11,
					name: 'AI',
					slug: 'ai',
					taxonomy: 'category',
				});
				mockUpdatePost.mockResolvedValue(
					updatedPost({ categories: [11] })
				);

				const { resolved } = await session.setCategories(['AI']);

				expect(resolved).toEqual([
					{ name: 'AI', id: 11, created: true },
				]);
				expect(mockCreateTerm).toHaveBeenCalledWith('categories', 'AI');
			});

			it('matches case-insensitively', async () => {
				await connectAndOpenWithMeta(session);
				mockSearchTerms.mockResolvedValue([
					{ id: 3, name: 'Tech', slug: 'tech', taxonomy: 'category' },
				]);
				mockUpdatePost.mockResolvedValue(
					updatedPost({ categories: [3] })
				);

				const { resolved } = await session.setCategories(['tech']);

				// Should match "Tech" despite lowercase input
				expect(resolved).toEqual([
					{ name: 'Tech', id: 3, created: false },
				]);
				expect(mockCreateTerm).not.toHaveBeenCalled();
			});

			it('resolves multiple categories (mix of existing and new)', async () => {
				await connectAndOpenWithMeta(session);
				// First call: "Tech" exists
				mockSearchTerms.mockResolvedValueOnce([
					{ id: 3, name: 'Tech', slug: 'tech', taxonomy: 'category' },
				]);
				// Second call: "Science" does not exist
				mockSearchTerms.mockResolvedValueOnce([]);
				mockCreateTerm.mockResolvedValue({
					id: 12,
					name: 'Science',
					slug: 'science',
					taxonomy: 'category',
				});
				mockUpdatePost.mockResolvedValue(
					updatedPost({ categories: [3, 12] })
				);

				const { resolved } = await session.setCategories([
					'Tech',
					'Science',
				]);

				expect(resolved).toEqual([
					{ name: 'Tech', id: 3, created: false },
					{ name: 'Science', id: 12, created: true },
				]);
				expect(mockUpdatePost).toHaveBeenCalledWith(42, {
					categories: [3, 12],
				});
			});

			it('throws when not editing', async () => {
				await connectSession(session);
				await expect(session.setCategories(['Tech'])).rejects.toThrow(
					/requires state/
				);
			});
		});

		describe('setTags()', () => {
			it('resolves existing tags by name and updates post', async () => {
				await connectAndOpenWithMeta(session);
				mockSearchTerms.mockResolvedValue([
					{
						id: 5,
						name: 'JavaScript',
						slug: 'javascript',
						taxonomy: 'post_tag',
					},
				]);
				mockUpdatePost.mockResolvedValue(updatedPost({ tags: [5] }));

				const { post, resolved } = await session.setTags([
					'JavaScript',
				]);

				expect(resolved).toEqual([
					{ name: 'JavaScript', id: 5, created: false },
				]);
				expect(mockUpdatePost).toHaveBeenCalledWith(42, { tags: [5] });
				expect(post.tags).toEqual([5]);
			});

			it('creates tags that do not exist', async () => {
				await connectAndOpenWithMeta(session);
				mockSearchTerms.mockResolvedValue([]);
				mockCreateTerm.mockResolvedValue({
					id: 20,
					name: 'Rust',
					slug: 'rust',
					taxonomy: 'post_tag',
				});
				mockUpdatePost.mockResolvedValue(updatedPost({ tags: [20] }));

				const { resolved } = await session.setTags(['Rust']);

				expect(resolved).toEqual([
					{ name: 'Rust', id: 20, created: true },
				]);
				expect(mockCreateTerm).toHaveBeenCalledWith('tags', 'Rust');
			});

			it('throws when not editing', async () => {
				await connectSession(session);
				await expect(session.setTags(['Rust'])).rejects.toThrow(
					/requires state/
				);
			});
		});

		describe('setFeaturedImage()', () => {
			it('updates featured_media in Y.Doc and REST API', async () => {
				await connectAndOpenWithMeta(session);
				const updated = updatedPost({ featured_media: 200 });
				mockUpdatePost.mockResolvedValue(updated);

				const result = await session.setFeaturedImage(200);

				expect(result).toEqual(updated);
				expect(mockUpdatePost).toHaveBeenCalledWith(42, {
					featured_media: 200,
				});
				expect(mockSyncFlushQueue).toHaveBeenCalled();
			});

			it('removes featured image when passing 0', async () => {
				await connectAndOpenWithMeta(session);
				const updated = updatedPost({ featured_media: 0 });
				mockUpdatePost.mockResolvedValue(updated);

				const result = await session.setFeaturedImage(0);

				expect(result).toEqual(updated);
				expect(mockUpdatePost).toHaveBeenCalledWith(42, {
					featured_media: 0,
				});
			});

			it('throws when not editing', async () => {
				await connectSession(session);
				await expect(session.setFeaturedImage(100)).rejects.toThrow(
					/requires state/
				);
			});
		});

		describe('setDate()', () => {
			it('updates date in Y.Doc and REST API', async () => {
				await connectAndOpenWithMeta(session);
				const updated = updatedPost({ date: '2026-06-15T12:00:00' });
				mockUpdatePost.mockResolvedValue(updated);

				const result = await session.setDate('2026-06-15T12:00:00');

				expect(result).toEqual(updated);
				expect(mockUpdatePost).toHaveBeenCalledWith(42, {
					date: '2026-06-15T12:00:00',
				});
				expect(mockSyncFlushQueue).toHaveBeenCalled();
			});

			it('sends null when given empty string (clears date)', async () => {
				await connectAndOpenWithMeta(session);
				const updated = updatedPost({ date: null });
				mockUpdatePost.mockResolvedValue(updated);

				await session.setDate('');

				expect(mockUpdatePost).toHaveBeenCalledWith(42, { date: null });
			});

			it('reflects updated date in readPost()', async () => {
				await connectAndOpenWithMeta(session);
				mockUpdatePost.mockResolvedValue(
					updatedPost({ date: '2026-06-15T12:00:00' })
				);

				await session.setDate('2026-06-15T12:00:00');

				const text = session.readPost();
				expect(text).toContain('Date: 2026-06-15T12:00:00');
			});

			it('throws when not editing', async () => {
				await connectSession(session);
				await expect(
					session.setDate('2026-06-15T12:00:00')
				).rejects.toThrow(/requires state/);
			});
		});

		describe('setSlug()', () => {
			it('updates slug in Y.Doc and REST API', async () => {
				await connectAndOpenWithMeta(session);
				const updated = updatedPost({ slug: 'new-slug' });
				mockUpdatePost.mockResolvedValue(updated);

				const result = await session.setSlug('new-slug');

				expect(result).toEqual(updated);
				expect(mockUpdatePost).toHaveBeenCalledWith(42, {
					slug: 'new-slug',
				});
				expect(mockSyncFlushQueue).toHaveBeenCalled();
			});

			it('reflects updated slug in readPost()', async () => {
				await connectAndOpenWithMeta(session);
				mockUpdatePost.mockResolvedValue(
					updatedPost({ slug: 'custom-slug' })
				);

				await session.setSlug('custom-slug');

				const text = session.readPost();
				expect(text).toContain('Slug: custom-slug');
			});

			it('throws when not editing', async () => {
				await connectSession(session);
				await expect(session.setSlug('test')).rejects.toThrow(
					/requires state/
				);
			});
		});

		describe('setSticky()', () => {
			it('updates sticky in Y.Doc and REST API', async () => {
				await connectAndOpenWithMeta(session);
				const updated = updatedPost({ sticky: true });
				mockUpdatePost.mockResolvedValue(updated);

				const result = await session.setSticky(true);

				expect(result).toEqual(updated);
				expect(mockUpdatePost).toHaveBeenCalledWith(42, {
					sticky: true,
				});
				expect(mockSyncFlushQueue).toHaveBeenCalled();
			});

			it('reflects sticky=true in readPost()', async () => {
				await connectAndOpenWithMeta(session);
				mockUpdatePost.mockResolvedValue(updatedPost({ sticky: true }));

				await session.setSticky(true);

				const text = session.readPost();
				expect(text).toContain('Sticky: yes');
			});

			it('reflects sticky=false in readPost()', async () => {
				await connectAndOpenWithMeta(session);
				mockUpdatePost.mockResolvedValue(
					updatedPost({ sticky: false })
				);

				await session.setSticky(false);

				const text = session.readPost();
				expect(text).not.toContain('Sticky: yes');
			});

			it('throws when not editing', async () => {
				await connectSession(session);
				await expect(session.setSticky(true)).rejects.toThrow(
					/requires state/
				);
			});
		});

		describe('setCommentStatus()', () => {
			it('updates comment_status in Y.Doc and REST API', async () => {
				await connectAndOpenWithMeta(session);
				const updated = updatedPost({ comment_status: 'closed' });
				mockUpdatePost.mockResolvedValue(updated);

				const result = await session.setCommentStatus('closed');

				expect(result).toEqual(updated);
				expect(mockUpdatePost).toHaveBeenCalledWith(42, {
					comment_status: 'closed',
				});
				expect(mockSyncFlushQueue).toHaveBeenCalled();
			});

			it('reflects closed comments in readPost()', async () => {
				await connectAndOpenWithMeta(session);
				mockUpdatePost.mockResolvedValue(
					updatedPost({ comment_status: 'closed' })
				);

				await session.setCommentStatus('closed');

				const text = session.readPost();
				expect(text).toContain('Comments: closed');
			});

			it('reflects open comments in readPost()', async () => {
				await connectAndOpenWithMeta(session);
				mockUpdatePost.mockResolvedValue(
					updatedPost({ comment_status: 'open' })
				);

				await session.setCommentStatus('open');

				const text = session.readPost();
				expect(text).not.toContain('Comments: closed');
			});

			it('throws when not editing', async () => {
				await connectSession(session);
				await expect(
					session.setCommentStatus('closed')
				).rejects.toThrow(/requires state/);
			});
		});

		describe('updatePostMeta() shared behavior', () => {
			it('flushes sync queue after updating Y.Doc', async () => {
				await connectAndOpenWithMeta(session);
				mockUpdatePost.mockResolvedValue(
					updatedPost({ status: 'private' })
				);

				await session.setPostStatus('private');

				expect(mockSyncFlushQueue).toHaveBeenCalled();
			});

			it('refreshes currentPost from API response', async () => {
				await connectAndOpenWithMeta(session);
				const updated = updatedPost({
					status: 'publish',
					slug: 'auto-modified-slug',
				});
				mockUpdatePost.mockResolvedValue(updated);

				await session.setPostStatus('publish');

				expect(session.getCurrentPost()).toEqual(updated);
			});
		});
	});

	describe('notes', () => {
		const fakeNote: WPNote = {
			id: 10,
			post: 42,
			parent: 0,
			author: 1,
			author_name: 'admin',
			date: '2026-03-22T00:00:00',
			content: { rendered: '<p>A note</p>', raw: 'A note' },
			status: 'hold',
			type: 'note',
		};

		const fakeReply: WPNote = {
			id: 11,
			post: 42,
			parent: 10,
			author: 1,
			author_name: 'admin',
			date: '2026-03-22T00:01:00',
			content: { rendered: '<p>Reply</p>', raw: 'Reply' },
			status: 'hold',
			type: 'note',
		};

		/** Connect and open a post with notes support enabled. */
		async function connectAndOpenWithNotes(
			s: SessionManager
		): Promise<void> {
			mockValidateConnection.mockResolvedValue(fakeUser);
			mockValidateSyncEndpoint.mockResolvedValue(undefined);
			mockCheckNotesSupport.mockResolvedValue(true);
			await s.connect(fakeConfig);
			mockGetPost.mockResolvedValue(fakePost);
			await s.openPost(42);
		}

		describe('getTitle()', () => {
			it('returns the live title from the Y.Doc', async () => {
				await connectAndOpen(session);

				expect(session.getTitle()).toBe('Hello World');
			});

			it('reflects title changes made via setTitle()', async () => {
				await connectAndOpen(session);
				session.setTitle('New Title');

				expect(session.getTitle()).toBe('New Title');
			});

			it('throws when not in editing state', () => {
				expect(() => session.getTitle()).toThrow();
			});
		});

		describe('getNotesSupported()', () => {
			it('returns false by default', () => {
				expect(session.getNotesSupported()).toBe(false);
			});

			it('returns true after connecting to a site that supports notes', async () => {
				mockValidateConnection.mockResolvedValue(fakeUser);
				mockValidateSyncEndpoint.mockResolvedValue(undefined);
				mockCheckNotesSupport.mockResolvedValue(true);

				await session.connect(fakeConfig);

				expect(session.getNotesSupported()).toBe(true);
			});

			it('returns false after connecting to a site that does not support notes', async () => {
				mockValidateConnection.mockResolvedValue(fakeUser);
				mockValidateSyncEndpoint.mockResolvedValue(undefined);
				mockCheckNotesSupport.mockResolvedValue(false);

				await session.connect(fakeConfig);

				expect(session.getNotesSupported()).toBe(false);
			});

			it('returns false when checkNotesSupport throws', async () => {
				mockValidateConnection.mockResolvedValue(fakeUser);
				mockValidateSyncEndpoint.mockResolvedValue(undefined);
				mockCheckNotesSupport.mockRejectedValue(
					new Error('network error')
				);

				await session.connect(fakeConfig);

				expect(session.getNotesSupported()).toBe(false);
			});

			it('resets to false on disconnect', async () => {
				mockValidateConnection.mockResolvedValue(fakeUser);
				mockValidateSyncEndpoint.mockResolvedValue(undefined);
				mockCheckNotesSupport.mockResolvedValue(true);

				await session.connect(fakeConfig);
				expect(session.getNotesSupported()).toBe(true);

				await session.disconnect();
				expect(session.getNotesSupported()).toBe(false);
			});
		});

		describe('listNotes()', () => {
			it('delegates to API client and returns notes with noteBlockMap', async () => {
				await connectAndOpenWithNotes(session);
				mockListNotes.mockResolvedValue([fakeNote]);

				const result = await session.listNotes();

				expect(result.notes).toEqual([fakeNote]);
				expect(mockListNotes).toHaveBeenCalledWith(42);
			});

			it('builds noteBlockMap from block metadata', async () => {
				await connectAndOpenWithNotes(session);

				// Add a note to block 0 to create metadata.noteId
				mockCreateNote.mockResolvedValue(fakeNote);
				await session.addNote('0', 'A note');

				mockListNotes.mockResolvedValue([fakeNote]);
				const result = await session.listNotes();

				expect(result.noteBlockMap[10]).toBe('0');
			});

			it('returns empty noteBlockMap when no blocks have noteId metadata', async () => {
				await connectAndOpenWithNotes(session);
				mockListNotes.mockResolvedValue([fakeNote]);

				const result = await session.listNotes();

				expect(result.noteBlockMap).toEqual({});
			});

			it('throws when not in editing state', async () => {
				mockValidateConnection.mockResolvedValue(fakeUser);
				mockValidateSyncEndpoint.mockResolvedValue(undefined);
				mockCheckNotesSupport.mockResolvedValue(true);
				await session.connect(fakeConfig);

				await expect(session.listNotes()).rejects.toThrow(
					/requires state/
				);
			});

			it('throws when notes not supported', async () => {
				await connectAndOpen(session);

				await expect(session.listNotes()).rejects.toThrow(
					'Notes are not supported. This feature requires WordPress 6.9 or later.'
				);
			});
		});

		describe('addNote()', () => {
			it('creates note via API and sets metadata on block', async () => {
				await connectAndOpenWithNotes(session);
				mockCreateNote.mockResolvedValue(fakeNote);

				const result = await session.addNote('0', 'A note');

				expect(result).toEqual(fakeNote);
				expect(mockCreateNote).toHaveBeenCalledWith({
					post: 42,
					content: 'A note',
				});

				// Verify block metadata was set
				const block = session.readBlock('0');
				expect(block).toContain('note');
			});

			it('flushes the sync queue after setting metadata', async () => {
				await connectAndOpenWithNotes(session);
				mockCreateNote.mockResolvedValue(fakeNote);

				await session.addNote('0', 'A note');

				expect(mockSyncFlushQueue).toHaveBeenCalled();
			});

			it('throws when block not found', async () => {
				await connectAndOpenWithNotes(session);

				await expect(session.addNote('999', 'A note')).rejects.toThrow(
					'Block not found at index 999'
				);
			});

			it('throws when block already has a note', async () => {
				await connectAndOpenWithNotes(session);
				mockCreateNote.mockResolvedValue(fakeNote);

				await session.addNote('0', 'First note');

				await expect(
					session.addNote('0', 'Second note')
				).rejects.toThrow(
					/already has a note.*ID: 10.*wp_read_post.*wp_list_notes.*wp_reply_to_note/
				);
			});

			it('throws when not in editing state', async () => {
				mockValidateConnection.mockResolvedValue(fakeUser);
				mockValidateSyncEndpoint.mockResolvedValue(undefined);
				mockCheckNotesSupport.mockResolvedValue(true);
				await session.connect(fakeConfig);

				await expect(session.addNote('0', 'A note')).rejects.toThrow(
					/requires state/
				);
			});

			it('throws when notes not supported', async () => {
				await connectAndOpen(session);

				await expect(session.addNote('0', 'A note')).rejects.toThrow(
					'Notes are not supported. This feature requires WordPress 6.9 or later.'
				);
			});
		});

		describe('replyToNote()', () => {
			it('creates reply with parent set', async () => {
				await connectAndOpenWithNotes(session);
				mockCreateNote.mockResolvedValue(fakeReply);

				const result = await session.replyToNote(10, 'Reply text');

				expect(result).toEqual(fakeReply);
				expect(mockCreateNote).toHaveBeenCalledWith({
					post: 42,
					content: 'Reply text',
					parent: 10,
				});
			});

			it('throws when not in editing state', async () => {
				mockValidateConnection.mockResolvedValue(fakeUser);
				mockValidateSyncEndpoint.mockResolvedValue(undefined);
				mockCheckNotesSupport.mockResolvedValue(true);
				await session.connect(fakeConfig);

				await expect(session.replyToNote(10, 'Reply')).rejects.toThrow(
					/requires state/
				);
			});

			it('throws when notes not supported', async () => {
				await connectAndOpen(session);

				await expect(session.replyToNote(10, 'Reply')).rejects.toThrow(
					'Notes are not supported. This feature requires WordPress 6.9 or later.'
				);
			});
		});

		describe('resolveNote()', () => {
			it('deletes note via API and removes metadata from block', async () => {
				await connectAndOpenWithNotes(session);
				mockCreateNote.mockResolvedValue(fakeNote);
				mockDeleteNote.mockResolvedValue(undefined);

				// First add a note so the metadata exists
				await session.addNote('0', 'A note');
				mockSyncFlushQueue.mockClear();

				await session.resolveNote(10);

				expect(mockDeleteNote).toHaveBeenCalledWith(10);
				expect(mockSyncFlushQueue).toHaveBeenCalled();
			});

			it('finds and removes note metadata from nested inner block', async () => {
				vi.useFakeTimers();
				await connectAndOpenWithNotes(session);

				// Insert a list with inner blocks
				session.insertBlock(0, {
					name: 'core/list',
					innerBlocks: [
						{ name: 'core/list-item', content: 'Item one' },
						{ name: 'core/list-item', content: 'Item two' },
					],
				});
				await vi.runAllTimersAsync();
				vi.useRealTimers();

				// Add a note to the second inner block (index "0.1")
				mockCreateNote.mockResolvedValue(fakeNote);
				await session.addNote('0.1', 'Note on inner block');

				// Now resolve — findBlockIndexByNoteId must recurse into inner blocks
				mockListNotes.mockResolvedValue([]);
				mockDeleteNote.mockResolvedValue(undefined);
				mockSyncFlushQueue.mockClear();

				await session.resolveNote(10);

				expect(mockDeleteNote).toHaveBeenCalledWith(10);
				expect(mockSyncFlushQueue).toHaveBeenCalled();
			});

			it('handles case where noteId is not linked to any block', async () => {
				await connectAndOpenWithNotes(session);
				mockDeleteNote.mockResolvedValue(undefined);

				// Resolve a note that isn't linked to any block - should still delete via API
				await session.resolveNote(999);

				expect(mockDeleteNote).toHaveBeenCalledWith(999);
				// flushQueue should still be called to notify other clients via root/comment room
				expect(mockSyncFlushQueue).toHaveBeenCalled();
			});

			it('throws when not in editing state', async () => {
				mockValidateConnection.mockResolvedValue(fakeUser);
				mockValidateSyncEndpoint.mockResolvedValue(undefined);
				mockCheckNotesSupport.mockResolvedValue(true);
				await session.connect(fakeConfig);

				await expect(session.resolveNote(10)).rejects.toThrow(
					/requires state/
				);
			});

			it('throws when notes not supported', async () => {
				await connectAndOpen(session);

				await expect(session.resolveNote(10)).rejects.toThrow(
					'Notes are not supported. This feature requires WordPress 6.9 or later.'
				);
			});
		});

		describe('updateNote()', () => {
			it('delegates to API client', async () => {
				await connectAndOpenWithNotes(session);
				const updatedNote = {
					...fakeNote,
					content: { rendered: '<p>Updated</p>', raw: 'Updated' },
				};
				mockUpdateNote.mockResolvedValue(updatedNote);

				const result = await session.updateNote(10, 'Updated');

				expect(result).toEqual(updatedNote);
				expect(mockUpdateNote).toHaveBeenCalledWith(10, {
					content: 'Updated',
				});
			});

			it('throws when not in editing state', async () => {
				mockValidateConnection.mockResolvedValue(fakeUser);
				mockValidateSyncEndpoint.mockResolvedValue(undefined);
				mockCheckNotesSupport.mockResolvedValue(true);
				await session.connect(fakeConfig);

				await expect(session.updateNote(10, 'Updated')).rejects.toThrow(
					/requires state/
				);
			});

			it('throws when notes not supported', async () => {
				await connectAndOpen(session);

				await expect(session.updateNote(10, 'Updated')).rejects.toThrow(
					'Notes are not supported. This feature requires WordPress 6.9 or later.'
				);
			});
		});
	});

	describe('post-gone detection', () => {
		function getSyncCallbacks(): SyncCallbacks {
			const call = mockSyncStart.mock.calls[0];
			assertDefined(call, 'syncClient.start() was not called');
			return call[3];
		}

		it('sets postGone when sync error triggers 404 on getPost', async () => {
			await connectAndOpen(session);
			const callbacks = getSyncCallbacks();

			// Simulate sync error with a 404 WordPressApiError
			const syncError = new WordPressApiError('Not found', 404, '');
			// getPost will also return 404 when checking
			mockGetPost.mockRejectedValueOnce(
				new WordPressApiError('Not found', 404, '')
			);

			callbacks.onStatusChange('error', syncError);

			// checkPostStillExists is async fire-and-forget; wait for it
			await vi.waitFor(() => {
				expect(session.isPostGone().gone).toBe(true);
			});

			expect(session.isPostGone().reason).toBe(
				'This post has been deleted.'
			);

			// Background work should be stopped
			expect(mockSyncStop).toHaveBeenCalled();
		});

		it('sets postGone when getPost returns trashed post', async () => {
			await connectAndOpen(session);
			const callbacks = getSyncCallbacks();

			const syncError = new WordPressApiError('Forbidden', 403, '');
			const trashedPost: WPPost = { ...fakePost, status: 'trash' };
			mockGetPost.mockResolvedValueOnce(trashedPost);

			callbacks.onStatusChange('error', syncError);

			await vi.waitFor(() => {
				expect(session.isPostGone().gone).toBe(true);
			});

			expect(session.isPostGone().reason).toBe(
				'This post has been moved to the trash.'
			);

			// Background work should be stopped
			expect(mockSyncStop).toHaveBeenCalled();
		});

		it('does not set postGone on transient errors', async () => {
			await connectAndOpen(session);
			const callbacks = getSyncCallbacks();

			// Network error (not a WordPressApiError) should not trigger a check
			callbacks.onStatusChange('error', new Error('Network timeout'));

			// Give it a tick to ensure nothing async fires
			await new Promise((r) => setTimeout(r, 10));

			expect(session.isPostGone().gone).toBe(false);
		});

		it('does not set postGone when getPost succeeds with active post', async () => {
			await connectAndOpen(session);
			const callbacks = getSyncCallbacks();

			const syncError = new WordPressApiError('Forbidden', 403, '');
			// getPost returns the post normally (transient sync error)
			mockGetPost.mockResolvedValueOnce(fakePost);

			callbacks.onStatusChange('error', syncError);

			await new Promise((r) => setTimeout(r, 10));

			expect(session.isPostGone().gone).toBe(false);
		});

		it('blocks editing operations when postGone is set', async () => {
			await connectAndOpen(session);
			const callbacks = getSyncCallbacks();

			const syncError = new WordPressApiError('Not found', 404, '');
			mockGetPost.mockRejectedValueOnce(
				new WordPressApiError('Not found', 404, '')
			);

			callbacks.onStatusChange('error', syncError);

			await vi.waitFor(() => {
				expect(session.isPostGone().gone).toBe(true);
			});

			// readPost should throw
			expect(() => session.readPost()).toThrow(/has been deleted/);
			expect(() => session.readPost()).toThrow(/wp_close_post/);

			// updateBlock should throw
			expect(() => {
				session.updateBlock('0', { content: 'test' });
			}).toThrow(/has been deleted/);

			// insertBlock should throw
			expect(() => {
				session.insertBlock(0, {
					name: 'core/paragraph',
					content: 'test',
				});
			}).toThrow(/has been deleted/);

			// setTitle should throw
			expect(() => {
				session.setTitle('test');
			}).toThrow(/has been deleted/);

			// save should throw
			await expect(session.save()).rejects.toThrow(/has been deleted/);
		});

		it('allows closePost when postGone is set', async () => {
			await connectAndOpen(session);
			const callbacks = getSyncCallbacks();

			const syncError = new WordPressApiError('Not found', 404, '');
			mockGetPost.mockRejectedValueOnce(
				new WordPressApiError('Not found', 404, '')
			);

			callbacks.onStatusChange('error', syncError);

			await vi.waitFor(() => {
				expect(session.isPostGone().gone).toBe(true);
			});

			// closePost should still work
			await session.closePost();
			expect(session.getState()).toBe('connected');
		});

		it('resets postGone after closePost', async () => {
			await connectAndOpen(session);
			const callbacks = getSyncCallbacks();

			const syncError = new WordPressApiError('Not found', 404, '');
			mockGetPost.mockRejectedValueOnce(
				new WordPressApiError('Not found', 404, '')
			);

			callbacks.onStatusChange('error', syncError);

			await vi.waitFor(() => {
				expect(session.isPostGone().gone).toBe(true);
			});

			await session.closePost();

			expect(session.isPostGone().gone).toBe(false);
			expect(session.isPostGone().reason).toBeNull();
		});

		it('does not trigger concurrent post-existence checks', async () => {
			await connectAndOpen(session);
			const callbacks = getSyncCallbacks();

			// Make getPost hang to simulate slow network
			let resolveGetPost: ((value: WPPost) => void) | undefined;
			mockGetPost.mockReturnValueOnce(
				new Promise<WPPost>((resolve) => {
					resolveGetPost = resolve;
				})
			);

			const syncError = new WordPressApiError('Not found', 404, '');
			callbacks.onStatusChange('error', syncError);
			// Second call while first is in progress — should be ignored
			callbacks.onStatusChange('error', syncError);

			// Only one getPost call should have been made
			// The first call was during openPost, the second is our check
			const getPostCallsBeforeResolve = mockGetPost.mock.calls.length;
			expect(getPostCallsBeforeResolve).toBe(2); // 1 from openPost + 1 from check

			// Resolve the pending check
			assertDefined(resolveGetPost, 'resolveGetPost should be set');
			resolveGetPost(fakePost);
			await new Promise((r) => setTimeout(r, 10));

			expect(session.isPostGone().gone).toBe(false);
		});

		it('periodic health check detects trashed post', async () => {
			// Use a very short interval so the timer fires quickly
			session.postHealthCheckInterval = 50;
			await connectAndOpen(session);

			// Return trashed post on next getPost call
			const trashedPost: WPPost = { ...fakePost, status: 'trash' };
			mockGetPost.mockResolvedValueOnce(trashedPost);

			// Wait for the health check timer to fire
			await vi.waitFor(
				() => {
					expect(session.isPostGone().gone).toBe(true);
				},
				{ timeout: 1000 }
			);

			expect(session.isPostGone().reason).toBe(
				'This post has been moved to the trash.'
			);

			// Background work (including the health check timer) should be stopped
			expect(mockSyncStop).toHaveBeenCalled();

			// closePost still works for cleanup
			await session.closePost();
			expect(session.isPostGone().gone).toBe(false);
		});

		it('closePost waits for in-flight check before clearing state', async () => {
			await connectAndOpen(session);
			const callbacks = getSyncCallbacks();

			// Make getPost hang so the check is in-flight
			let resolveGetPost: ((value: WPPost) => void) | undefined;
			mockGetPost.mockReturnValueOnce(
				new Promise<WPPost>((resolve) => {
					resolveGetPost = resolve;
				})
			);

			const syncError = new WordPressApiError('Not found', 404, '');
			callbacks.onStatusChange('error', syncError);

			// Start closePost while the check is still in-flight — it must await it
			const closePromise = session.closePost();

			// Resolve the hanging getPost after closePost has started waiting
			assertDefined(resolveGetPost, 'resolveGetPost should be set');
			resolveGetPost({ ...fakePost, status: 'trash' });

			await closePromise;

			// closePost resets postGone after the check completes
			expect(session.getState()).toBe('connected');
			expect(session.isPostGone().gone).toBe(false);
		});

		it('closePost clears health check timer on a healthy post', async () => {
			session.postHealthCheckInterval = 5000;
			await connectAndOpen(session);

			// Post is not gone — closePost should clean up the running timer
			await session.closePost();
			expect(session.getState()).toBe('connected');
		});
	});

	describe('command handler integration', () => {
		describe('plugin detection in connect()', () => {
			it('creates command handler and stores it when plugin is detected', async () => {
				mockCommandHandlerStart.mockResolvedValue(true);
				mockCommandHandlerGetPluginStatus.mockReturnValue({
					version: '1.0.0',
					protocol_version: 1,
					mcp_connected: true,
					mcp_last_seen_at: null,
				});
				mockCommandHandlerGetTransport.mockReturnValue('sse');

				await connectSession(session);

				expect(mockCommandHandlerStart).toHaveBeenCalledTimes(1);
				expect(session.getPluginInfo()).toEqual({
					version: '1.0.0',
					protocolVersion: 1,
					transport: 'sse',
				});
			});

			it('does not store command handler when plugin is not detected', async () => {
				mockCommandHandlerStart.mockResolvedValue(false);

				await connectSession(session);

				expect(mockCommandHandlerStart).toHaveBeenCalledTimes(1);
				expect(session.getPluginInfo()).toBeNull();
			});

			it('swallows errors from plugin detection and connects successfully', async () => {
				mockCommandHandlerStart.mockRejectedValue(
					new Error('Network error')
				);

				await connectSession(session);

				expect(session.getState()).toBe('connected');
				expect(session.getPluginInfo()).toBeNull();
			});

			it('passes stored channel notifier to new command handler', async () => {
				const notifier = vi.fn();
				session.setChannelNotifier(notifier);

				mockCommandHandlerStart.mockResolvedValue(true);
				mockCommandHandlerGetPluginStatus.mockReturnValue({
					version: '1.0.0',
					protocol_version: 1,
					mcp_connected: false,
					mcp_last_seen_at: null,
				});
				mockCommandHandlerGetTransport.mockReturnValue('polling');

				await connectSession(session);

				expect(mockCommandHandlerSetNotifier).toHaveBeenCalledWith(
					notifier
				);
			});

			it('does not pass notifier to handler when none is set', async () => {
				mockCommandHandlerStart.mockResolvedValue(true);
				mockCommandHandlerGetPluginStatus.mockReturnValue({
					version: '1.0.0',
					protocol_version: 1,
					mcp_connected: false,
					mcp_last_seen_at: null,
				});
				mockCommandHandlerGetTransport.mockReturnValue('sse');

				await connectSession(session);

				expect(mockCommandHandlerSetNotifier).not.toHaveBeenCalled();
			});
		});

		describe('command handler cleanup in disconnect()', () => {
			it('stops command handler on disconnect', async () => {
				mockCommandHandlerStart.mockResolvedValue(true);
				mockCommandHandlerGetPluginStatus.mockReturnValue({
					version: '1.0.0',
					protocol_version: 1,
					mcp_connected: false,
					mcp_last_seen_at: null,
				});
				mockCommandHandlerGetTransport.mockReturnValue('sse');

				await connectSession(session);
				await session.disconnect();

				expect(mockCommandHandlerStop).toHaveBeenCalledTimes(1);
				expect(session.getPluginInfo()).toBeNull();
			});

			it('does not call stop when no command handler exists', async () => {
				mockCommandHandlerStart.mockResolvedValue(false);

				await connectSession(session);
				await session.disconnect();

				expect(mockCommandHandlerStop).not.toHaveBeenCalled();
			});
		});

		describe('setChannelNotifier()', () => {
			it('stores the notifier for future connections', async () => {
				const notifier = vi.fn();
				session.setChannelNotifier(notifier);

				// Connect — the stored notifier should be forwarded
				mockCommandHandlerStart.mockResolvedValue(true);
				mockCommandHandlerGetPluginStatus.mockReturnValue({
					version: '1.0.0',
					protocol_version: 1,
					mcp_connected: false,
					mcp_last_seen_at: null,
				});
				mockCommandHandlerGetTransport.mockReturnValue('sse');

				await connectSession(session);

				expect(mockCommandHandlerSetNotifier).toHaveBeenCalledWith(
					notifier
				);
			});

			it('forwards to existing command handler immediately', async () => {
				mockCommandHandlerStart.mockResolvedValue(true);
				mockCommandHandlerGetPluginStatus.mockReturnValue({
					version: '1.0.0',
					protocol_version: 1,
					mcp_connected: false,
					mcp_last_seen_at: null,
				});
				mockCommandHandlerGetTransport.mockReturnValue('sse');

				await connectSession(session);

				// Clear the mock to isolate the setChannelNotifier call
				mockCommandHandlerSetNotifier.mockClear();

				const notifier = vi.fn();
				session.setChannelNotifier(notifier);

				expect(mockCommandHandlerSetNotifier).toHaveBeenCalledWith(
					notifier
				);
			});

			it('does not call setNotifier on handler when disconnected', () => {
				const notifier = vi.fn();
				session.setChannelNotifier(notifier);

				// No command handler exists when disconnected
				expect(mockCommandHandlerSetNotifier).not.toHaveBeenCalled();
			});
		});

		describe('updateCommandStatus()', () => {
			it('delegates to command handler when plugin is connected', async () => {
				mockCommandHandlerStart.mockResolvedValue(true);
				mockCommandHandlerGetPluginStatus.mockReturnValue({
					version: '1.0.0',
					protocol_version: 1,
					mcp_connected: false,
					mcp_last_seen_at: null,
				});
				mockCommandHandlerGetTransport.mockReturnValue('sse');
				mockCommandHandlerUpdateCommandStatus.mockResolvedValue(
					undefined
				);

				await connectSession(session);

				await session.updateCommandStatus(123, 'completed', 'Done');

				expect(
					mockCommandHandlerUpdateCommandStatus
				).toHaveBeenCalledWith(123, 'completed', 'Done');
			});

			it('delegates without message parameter', async () => {
				mockCommandHandlerStart.mockResolvedValue(true);
				mockCommandHandlerGetPluginStatus.mockReturnValue({
					version: '1.0.0',
					protocol_version: 1,
					mcp_connected: false,
					mcp_last_seen_at: null,
				});
				mockCommandHandlerGetTransport.mockReturnValue('sse');
				mockCommandHandlerUpdateCommandStatus.mockResolvedValue(
					undefined
				);

				await connectSession(session);

				await session.updateCommandStatus(456, 'running');

				expect(
					mockCommandHandlerUpdateCommandStatus
				).toHaveBeenCalledWith(456, 'running', undefined);
			});

			it('throws when no command handler exists', async () => {
				mockCommandHandlerStart.mockResolvedValue(false);

				await connectSession(session);

				await expect(
					session.updateCommandStatus(123, 'completed')
				).rejects.toThrow(
					'WordPress editor plugin is not connected. Command features are not available.'
				);
			});

			it('throws when disconnected', async () => {
				await expect(
					session.updateCommandStatus(123, 'completed')
				).rejects.toThrow(/not connected/i);
			});
		});

		describe('getPluginInfo()', () => {
			it('returns plugin info when handler has status', async () => {
				mockCommandHandlerStart.mockResolvedValue(true);
				mockCommandHandlerGetPluginStatus.mockReturnValue({
					version: '2.1.0',
					protocol_version: 3,
					mcp_connected: true,
					mcp_last_seen_at: '2026-01-01T00:00:00',
				});
				mockCommandHandlerGetTransport.mockReturnValue('polling');

				await connectSession(session);

				expect(session.getPluginInfo()).toEqual({
					version: '2.1.0',
					protocolVersion: 3,
					transport: 'polling',
				});
			});

			it('returns null when no command handler exists', async () => {
				mockCommandHandlerStart.mockResolvedValue(false);

				await connectSession(session);

				expect(session.getPluginInfo()).toBeNull();
			});

			it('returns null when handler has no plugin status', async () => {
				mockCommandHandlerStart.mockResolvedValue(true);
				mockCommandHandlerGetPluginStatus.mockReturnValue(null);
				mockCommandHandlerGetTransport.mockReturnValue('sse');

				await connectSession(session);

				expect(session.getPluginInfo()).toBeNull();
			});

			it('returns null when disconnected', () => {
				expect(session.getPluginInfo()).toBeNull();
			});
		});
	});
});
