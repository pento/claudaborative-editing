import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../../src/session/session-manager.js';
import type { WordPressConfig, WPNote, WPPost, WPUser } from '../../src/wordpress/types.js';

// --- Mock the WordPress API client ---
const mockValidateConnection = vi.fn<() => Promise<WPUser>>();
const mockValidateSyncEndpoint = vi.fn<() => Promise<void>>();
const mockGetPost = vi.fn<(id: number) => Promise<WPPost>>();
const mockListPosts = vi.fn<() => Promise<WPPost[]>>();
const mockCreatePost = vi.fn<() => Promise<WPPost>>();
const mockSendSyncUpdate = vi.fn();
const mockGetBlockTypes = vi.fn<() => Promise<unknown[]>>();
const mockUploadMedia = vi.fn();
const mockCheckNotesSupport = vi.fn<() => Promise<boolean>>();
const mockListNotes = vi.fn<() => Promise<WPNote[]>>();
const mockCreateNote = vi.fn<() => Promise<WPNote>>();
const mockUpdateNote = vi.fn<() => Promise<WPNote>>();
const mockDeleteNote = vi.fn<() => Promise<void>>();

vi.mock('../../src/wordpress/api-client.js', () => {
  return {
    WordPressApiClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.validateConnection = mockValidateConnection;
      this.validateSyncEndpoint = mockValidateSyncEndpoint;
      this.getPost = mockGetPost;
      this.listPosts = mockListPosts;
      this.createPost = mockCreatePost;
      this.sendSyncUpdate = mockSendSyncUpdate;
      this.getBlockTypes = mockGetBlockTypes;
      this.uploadMedia = mockUploadMedia;
      this.checkNotesSupport = mockCheckNotesSupport;
      this.listNotes = mockListNotes;
      this.createNote = mockCreateNote;
      this.updateNote = mockUpdateNote;
      this.deleteNote = mockDeleteNote;
    }),
  };
});

// --- Mock node:fs/promises for uploadMedia tests ---
const mockReadFile = vi.fn<() => Promise<Buffer>>();
vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

// --- Mock the sync client ---
const mockSyncStart = vi.fn();
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
    SyncClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
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
    mockCheckNotesSupport.mockResolvedValue(false);
    session = new SessionManager();
    session.syncWaitTimeout = 0; // Skip sync wait in tests
  });

  afterEach(() => {
    // Clean up any open sessions
    if (session.getState() !== 'disconnected') {
      session.disconnect();
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
      mockValidateConnection.mockRejectedValue(new Error('401 Unauthorized'));

      await expect(session.connect(fakeConfig)).rejects.toThrow('401 Unauthorized');
      expect(session.getState()).toBe('disconnected');
    });

    it('throws if sync endpoint is unavailable', async () => {
      mockValidateConnection.mockResolvedValue(fakeUser);
      mockValidateSyncEndpoint.mockRejectedValue(new Error('404 Not Found'));

      await expect(session.connect(fakeConfig)).rejects.toThrow('404 Not Found');
    });

    it('fetches block types during connect', async () => {
      mockValidateConnection.mockResolvedValue(fakeUser);
      mockValidateSyncEndpoint.mockResolvedValue(undefined);
      mockGetBlockTypes.mockResolvedValueOnce([
        { name: 'core/paragraph', attributes: { content: { type: 'rich-text' } } },
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

      await expect(session.connect(fakeConfig)).rejects.toThrow(/closePost/);
      expect(session.getState()).toBe('editing');
    });

    it('disconnects and reconnects when already connected', async () => {
      await connectSession(session);
      expect(session.getState()).toBe('connected');

      // Connect again with (potentially different) config
      mockValidateConnection.mockResolvedValue({ ...fakeUser, id: 2, name: 'other' });
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
      await expect(session.openPost(42)).rejects.toThrow(/requires state/);
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

      session.closePost();

      expect(mockSyncStop).toHaveBeenCalledTimes(1);
      expect(session.getState()).toBe('connected');
      expect(session.getCurrentPost()).toBeNull();
    });

    it('throws when not in editing state', async () => {
      await connectSession(session);
      expect(() => session.closePost()).toThrow(/requires state/);
    });

    it('throws when disconnected', () => {
      expect(() => session.closePost()).toThrow(/requires state/);
    });

    it('returns to connected state', async () => {
      await connectAndOpen(session);

      session.closePost();

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

      await session.updateBlock('0', { content: 'Updated paragraph' });

      const text = session.readPost();
      expect(text).toContain('Updated paragraph');
    });

    it('throws when not editing', async () => {
      await connectSession(session);
      await expect(session.updateBlock('0', { content: 'test' })).rejects.toThrow(/requires state/);
    });

    it('streams long content in chunks', async () => {
      vi.useFakeTimers();
      await connectAndOpen(session);

      const longContent = 'This is a long paragraph that should be streamed in chunks to the browser.';
      const promise = session.updateBlock('0', { content: longContent });

      // Advance through all streaming delays
      await vi.runAllTimersAsync();
      await promise;

      const text = session.readPost();
      expect(text).toContain(longContent);
      // flushQueue should have been called for streaming chunks
      expect(mockSyncFlushQueue).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('applies short content atomically without flushing', async () => {
      await connectAndOpen(session);

      await session.updateBlock('0', { content: 'Short' });

      const text = session.readPost();
      expect(text).toContain('Short');
      // Short content should not trigger flush
      expect(mockSyncFlushQueue).not.toHaveBeenCalled();
    });
  });

  describe('insertBlock()', () => {
    it('adds a new block to the doc', async () => {
      vi.useFakeTimers();
      await connectAndOpen(session);

      const promise = session.insertBlock(0, { name: 'core/paragraph', content: 'New first paragraph' });
      await vi.runAllTimersAsync();
      await promise;

      const text = session.readPost();
      expect(text).toContain('New first paragraph');

      vi.useRealTimers();
    });

    it('inserts at the correct position', async () => {
      await connectAndOpen(session);

      await session.insertBlock(1, { name: 'core/paragraph', content: 'Inserted at 1' });

      // Read block at position 1
      const blockText = session.readBlock('1');
      expect(blockText).toContain('Inserted at 1');
    });

    it('streams content after block structure appears', async () => {
      vi.useFakeTimers();
      await connectAndOpen(session);

      const longContent = 'This is a long paragraph that exceeds the streaming threshold for testing.';
      const promise = session.insertBlock(0, { name: 'core/paragraph', content: longContent });
      await vi.runAllTimersAsync();
      await promise;

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
      await session.insertBlock(0, { name: 'core/separator' });

      const text = session.readPost();
      expect(text).toContain('core/separator');
    });

    it('rejects unknown block types with API-sourced registry', async () => {
      // Set up mockGetBlockTypes to succeed so connect() builds an API-sourced registry
      mockGetBlockTypes.mockResolvedValueOnce([
        { name: 'core/paragraph', attributes: { content: { type: 'rich-text' } } },
        { name: 'core/heading', attributes: { content: { type: 'rich-text' } } },
        { name: 'core/list', attributes: { ordered: { type: 'boolean', default: false } } },
        { name: 'core/list-item', attributes: { content: { type: 'rich-text' } } },
      ]);

      mockValidateConnection.mockResolvedValue(fakeUser);
      mockValidateSyncEndpoint.mockResolvedValue(undefined);
      await session.connect(fakeConfig);
      mockGetPost.mockResolvedValue(fakePost);
      await session.openPost(42);

      await expect(
        session.insertBlock(0, { name: 'custom/nonexistent-block' }),
      ).rejects.toThrow(/Unknown block type: custom\/nonexistent-block/);
    });
  });

  describe('insertBlock() with innerBlocks', () => {
    it('inserts a list block with list-item inner blocks', async () => {
      vi.useFakeTimers();
      await connectAndOpen(session);

      const promise = session.insertBlock(0, {
        name: 'core/list',
        innerBlocks: [
          { name: 'core/list-item', content: 'First item' },
          { name: 'core/list-item', content: 'Second item' },
        ],
      });
      await vi.runAllTimersAsync();
      await promise;

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
      const insertPromise = session.insertBlock(0, {
        name: 'core/list',
        innerBlocks: [
          { name: 'core/list-item', content: 'Existing item' },
        ],
      });
      await vi.runAllTimersAsync();
      await insertPromise;

      // Now add an inner block to the list
      const innerPromise = session.insertInnerBlock('0', 1, {
        name: 'core/list-item',
        content: 'New item',
      });
      await vi.runAllTimersAsync();
      await innerPromise;

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
      const promise = session.insertBlock(0, {
        name: 'core/list',
        innerBlocks: [
          { name: 'core/list-item', content: 'Keep' },
          { name: 'core/list-item', content: 'Remove' },
          { name: 'core/list-item', content: 'Also keep' },
        ],
      });
      await vi.runAllTimersAsync();
      await promise;

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

      const promise = session.replaceBlocks(0, 1, [
        { name: 'core/paragraph', content: 'Replacement paragraph' },
      ]);
      await vi.runAllTimersAsync();
      await promise;

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
        { name: 'core/paragraph', attributes: { content: { type: 'rich-text' } } },
        { name: 'core/heading', attributes: { content: { type: 'rich-text' } } },
      ]);

      mockValidateConnection.mockResolvedValue(fakeUser);
      mockValidateSyncEndpoint.mockResolvedValue(undefined);
      await session.connect(fakeConfig);
      mockGetPost.mockResolvedValue(fakePost);
      await session.openPost(42);

      await expect(
        session.replaceBlocks(0, 1, [
          { name: 'custom/nonexistent-block' },
        ]),
      ).rejects.toThrow(/Unknown block type: custom\/nonexistent-block/);
    });
  });

  describe('setTitle()', () => {
    it('updates the title in the doc', async () => {
      await connectAndOpen(session);

      await session.setTitle('New Title');

      const text = session.readPost();
      expect(text).toContain('Title: "New Title"');
    });

    it('throws when not editing', async () => {
      await connectSession(session);
      await expect(session.setTitle('test')).rejects.toThrow(/requires state/);
    });

    it('streams long titles', async () => {
      vi.useFakeTimers();
      await connectAndOpen(session);

      const longTitle = 'This Is A Very Long Title That Should Be Streamed';
      const promise = session.setTitle(longTitle);
      await vi.runAllTimersAsync();
      await promise;

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
      session.save();
    });

    it('throws when not editing', async () => {
      await connectSession(session);
      expect(() => session.save()).toThrow(/requires state/);
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
      const newPost = { ...fakePost, id: 99, title: { rendered: 'New', raw: 'New' } };
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

      session.disconnect();

      expect(session.getState()).toBe('disconnected');
      expect(session.getUser()).toBeNull();
      expect(session.getCurrentPost()).toBeNull();
      expect(session.getCollaborators()).toEqual([]);
    });

    it('cleans up everything from editing state', async () => {
      await connectAndOpen(session);

      session.disconnect();

      expect(session.getState()).toBe('disconnected');
      expect(mockSyncStop).toHaveBeenCalledTimes(1);
      expect(session.getUser()).toBeNull();
      expect(session.getCurrentPost()).toBeNull();
    });

    it('is safe to call when already disconnected', () => {
      session.disconnect();
      expect(session.getState()).toBe('disconnected');
    });
  });

  describe('getState()', () => {
    it('starts as disconnected', () => {
      expect(session.getState()).toBe('disconnected');
    });
  });

  describe('getSyncStatus()', () => {
    it('returns null when not editing', async () => {
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
      mockGetBlockTypes.mockResolvedValueOnce(blockTypes);
      mockValidateConnection.mockResolvedValue(fakeUser);
      mockValidateSyncEndpoint.mockResolvedValue(undefined);
      await s.connect(fakeConfig);
      mockGetPost.mockResolvedValue(fakePost);
      await s.openPost(42);
      return s;
    }

    it('rejects content parameter for blocks without a content attribute', async () => {
      const s = await connectWithBlockTypes([
        { name: 'core/paragraph', attributes: { content: { type: 'rich-text' } } },
        { name: 'core/heading', attributes: { content: { type: 'rich-text' } } },
        {
          name: 'core/pullquote',
          attributes: {
            value: { type: 'rich-text' },
            citation: { type: 'rich-text' },
          },
        },
      ]);

      try {
        await expect(
          s.insertBlock(0, { name: 'core/pullquote', content: 'text' }),
        ).rejects.toThrow(/does not have a "content" attribute/);

        // Error message should mention available rich-text attributes
        await expect(
          s.insertBlock(0, { name: 'core/pullquote', content: 'text' }),
        ).rejects.toThrow(/value/);

        await expect(
          s.insertBlock(0, { name: 'core/pullquote', content: 'text' }),
        ).rejects.toThrow(/citation/);
      } finally {
        s.disconnect();
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
        { name: 'core/heading', attributes: { content: { type: 'rich-text' } } },
      ]);

      try {
        await expect(
          s.insertBlock(0, {
            name: 'core/paragraph',
            attributes: { content: 'hello', unknownAttr: true },
          }),
        ).rejects.toThrow(/Unknown attribute/);

        await expect(
          s.insertBlock(0, {
            name: 'core/paragraph',
            attributes: { content: 'hello', unknownAttr: true },
          }),
        ).rejects.toThrow(/unknownAttr/);
      } finally {
        s.disconnect();
      }
    });

    it('rejects inner block that violates parent constraint', async () => {
      const s = await connectWithBlockTypes([
        { name: 'core/paragraph', attributes: { content: { type: 'rich-text' } } },
        { name: 'core/heading', attributes: { content: { type: 'rich-text' } } },
        { name: 'core/list', attributes: null },
        { name: 'core/column', attributes: null, parent: ['core/columns'] },
      ]);

      try {
        await expect(
          s.insertBlock(0, {
            name: 'core/list',
            innerBlocks: [{ name: 'core/column' }],
          }),
        ).rejects.toThrow(/can only be nested inside/);

        await expect(
          s.insertBlock(0, {
            name: 'core/list',
            innerBlocks: [{ name: 'core/column' }],
          }),
        ).rejects.toThrow(/core\/columns/);
      } finally {
        s.disconnect();
      }
    });

    it('rejects inner block not in parent\'s allowedBlocks', async () => {
      const s = await connectWithBlockTypes([
        { name: 'core/paragraph', attributes: { content: { type: 'rich-text' } } },
        { name: 'core/heading', attributes: { content: { type: 'rich-text' } } },
        { name: 'core/list', attributes: null, allowed_blocks: ['core/list-item'] },
        { name: 'core/list-item', attributes: { content: { type: 'rich-text' } } },
      ]);

      try {
        await expect(
          s.insertBlock(0, {
            name: 'core/list',
            innerBlocks: [{ name: 'core/paragraph', content: 'text' }],
          }),
        ).rejects.toThrow(/only allows these inner blocks/);

        await expect(
          s.insertBlock(0, {
            name: 'core/list',
            innerBlocks: [{ name: 'core/paragraph', content: 'text' }],
          }),
        ).rejects.toThrow(/core\/list-item/);
      } finally {
        s.disconnect();
      }
    });

    it('rejects top-level insertion of block with parent constraint', async () => {
      const s = await connectWithBlockTypes([
        { name: 'core/paragraph', attributes: { content: { type: 'rich-text' } } },
        { name: 'core/columns', attributes: null },
        { name: 'core/column', attributes: null, parent: ['core/columns'] },
      ]);

      try {
        await expect(
          s.insertBlock(0, { name: 'core/column' }),
        ).rejects.toThrow(/cannot be inserted at the top level/);

        await expect(
          s.insertBlock(0, { name: 'core/column' }),
        ).rejects.toThrow(/core\/columns/);
      } finally {
        s.disconnect();
      }
    });

    it('accepts valid attributes and inner blocks', async () => {
      vi.useFakeTimers();

      const s = await connectWithBlockTypes([
        { name: 'core/paragraph', attributes: { content: { type: 'rich-text' } } },
        { name: 'core/heading', attributes: { content: { type: 'rich-text' } } },
        {
          name: 'core/list',
          attributes: { ordered: { type: 'boolean', default: false } },
          allowed_blocks: ['core/list-item'],
        },
        {
          name: 'core/list-item',
          attributes: { content: { type: 'rich-text' } },
          parent: ['core/list'],
        },
      ]);

      try {
        const promise = s.insertBlock(0, {
          name: 'core/list',
          innerBlocks: [
            { name: 'core/list-item', content: 'Item one' },
            { name: 'core/list-item', content: 'Item two' },
          ],
        });
        await vi.runAllTimersAsync();
        await promise;

        const text = s.readPost();
        expect(text).toContain('core/list');
        expect(text).toContain('Item one');
        expect(text).toContain('Item two');
      } finally {
        s.disconnect();
        vi.useRealTimers();
      }
    });
  });

  describe('uploadMedia()', () => {
    const fakeMediaResponse = {
      id: 101,
      source_url: 'https://example.com/wp-content/uploads/2026/03/test.jpg',
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
      await expect(session.uploadMedia('/path/to/file.jpg')).rejects.toThrow(
        /requires state connected or editing/,
      );
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
        undefined,
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
        undefined,
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
        { altText: 'Scenic view', title: 'Sunset', caption: 'At dusk' },
      );
    });

    it('detects MIME type from file extension', async () => {
      await connectSession(session);

      await session.uploadMedia('/path/to/clip.mp4');
      expect(mockUploadMedia).toHaveBeenCalledWith(
        expect.any(Buffer),
        'clip.mp4',
        'video/mp4',
        undefined,
      );
    });

    it('throws for unsupported file types', async () => {
      await connectSession(session);

      await expect(session.uploadMedia('/path/to/file.xyz')).rejects.toThrow(
        /Unsupported file type/,
      );
    });

    it('propagates file read errors', async () => {
      await connectSession(session);
      mockReadFile.mockRejectedValueOnce(new Error('ENOENT: no such file'));

      await expect(session.uploadMedia('/path/to/missing.jpg')).rejects.toThrow('ENOENT');
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
    async function connectAndOpenWithNotes(s: SessionManager): Promise<void> {
      mockValidateConnection.mockResolvedValue(fakeUser);
      mockValidateSyncEndpoint.mockResolvedValue(undefined);
      mockCheckNotesSupport.mockResolvedValue(true);
      await s.connect(fakeConfig);
      mockGetPost.mockResolvedValue(fakePost);
      await s.openPost(42);
    }

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
        mockCheckNotesSupport.mockRejectedValue(new Error('network error'));

        await session.connect(fakeConfig);

        expect(session.getNotesSupported()).toBe(false);
      });

      it('resets to false on disconnect', async () => {
        mockValidateConnection.mockResolvedValue(fakeUser);
        mockValidateSyncEndpoint.mockResolvedValue(undefined);
        mockCheckNotesSupport.mockResolvedValue(true);

        await session.connect(fakeConfig);
        expect(session.getNotesSupported()).toBe(true);

        session.disconnect();
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

        await expect(session.listNotes()).rejects.toThrow(/requires state/);
      });

      it('throws when notes not supported', async () => {
        await connectAndOpen(session);

        await expect(session.listNotes()).rejects.toThrow(
          'Notes are not supported. This feature requires WordPress 6.9 or later.',
        );
      });
    });

    describe('addNote()', () => {
      it('creates note via API and sets metadata on block', async () => {
        await connectAndOpenWithNotes(session);
        mockCreateNote.mockResolvedValue(fakeNote);

        const result = await session.addNote('0', 'A note');

        expect(result).toEqual(fakeNote);
        expect(mockCreateNote).toHaveBeenCalledWith({ post: 42, content: 'A note' });

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
          'Block not found at index 999',
        );
      });

      it('throws when block already has a note', async () => {
        await connectAndOpenWithNotes(session);
        mockCreateNote.mockResolvedValue(fakeNote);

        await session.addNote('0', 'First note');

        await expect(session.addNote('0', 'Second note')).rejects.toThrow(
          /already has a note.*ID: 10.*wp_read_post.*wp_list_notes.*wp_reply_to_note/,
        );
      });

      it('throws when not in editing state', async () => {
        mockValidateConnection.mockResolvedValue(fakeUser);
        mockValidateSyncEndpoint.mockResolvedValue(undefined);
        mockCheckNotesSupport.mockResolvedValue(true);
        await session.connect(fakeConfig);

        await expect(session.addNote('0', 'A note')).rejects.toThrow(/requires state/);
      });

      it('throws when notes not supported', async () => {
        await connectAndOpen(session);

        await expect(session.addNote('0', 'A note')).rejects.toThrow(
          'Notes are not supported. This feature requires WordPress 6.9 or later.',
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

        await expect(session.replyToNote(10, 'Reply')).rejects.toThrow(/requires state/);
      });

      it('throws when notes not supported', async () => {
        await connectAndOpen(session);

        await expect(session.replyToNote(10, 'Reply')).rejects.toThrow(
          'Notes are not supported. This feature requires WordPress 6.9 or later.',
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

        await expect(session.resolveNote(10)).rejects.toThrow(/requires state/);
      });

      it('throws when notes not supported', async () => {
        await connectAndOpen(session);

        await expect(session.resolveNote(10)).rejects.toThrow(
          'Notes are not supported. This feature requires WordPress 6.9 or later.',
        );
      });
    });

    describe('updateNote()', () => {
      it('delegates to API client', async () => {
        await connectAndOpenWithNotes(session);
        const updatedNote = { ...fakeNote, content: { rendered: '<p>Updated</p>', raw: 'Updated' } };
        mockUpdateNote.mockResolvedValue(updatedNote);

        const result = await session.updateNote(10, 'Updated');

        expect(result).toEqual(updatedNote);
        expect(mockUpdateNote).toHaveBeenCalledWith(10, { content: 'Updated' });
      });

      it('throws when not in editing state', async () => {
        mockValidateConnection.mockResolvedValue(fakeUser);
        mockValidateSyncEndpoint.mockResolvedValue(undefined);
        mockCheckNotesSupport.mockResolvedValue(true);
        await session.connect(fakeConfig);

        await expect(session.updateNote(10, 'Updated')).rejects.toThrow(/requires state/);
      });

      it('throws when notes not supported', async () => {
        await connectAndOpen(session);

        await expect(session.updateNote(10, 'Updated')).rejects.toThrow(
          'Notes are not supported. This feature requires WordPress 6.9 or later.',
        );
      });
    });
  });
});
