import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../../src/session/session-manager.js';
import type { WordPressConfig, WPPost, WPUser } from '../../src/wordpress/types.js';

// --- Mock the WordPress API client ---
const mockValidateConnection = vi.fn<() => Promise<WPUser>>();
const mockValidateSyncEndpoint = vi.fn<() => Promise<void>>();
const mockGetPost = vi.fn<(id: number) => Promise<WPPost>>();
const mockListPosts = vi.fn<() => Promise<WPPost[]>>();
const mockCreatePost = vi.fn<() => Promise<WPPost>>();
const mockSendSyncUpdate = vi.fn();

vi.mock('../../src/wordpress/api-client.js', () => {
  return {
    WordPressApiClient: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.validateConnection = mockValidateConnection;
      this.validateSyncEndpoint = mockValidateSyncEndpoint;
      this.getPost = mockGetPost;
      this.listPosts = mockListPosts;
      this.createPost = mockCreatePost;
      this.sendSyncUpdate = mockSendSyncUpdate;
    }),
  };
});

// --- Mock the sync client ---
const mockSyncStart = vi.fn();
const mockSyncStop = vi.fn();
const mockSyncQueueUpdate = vi.fn();
const mockSyncFlushQueue = vi.fn();
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
});
