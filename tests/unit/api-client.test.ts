import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WordPressApiClient, WordPressApiError } from '../../src/wordpress/api-client.js';
import type {
  SyncPayload,
  WPBlockType,
  WPMediaItem,
  WPNote,
  WPPost,
  WPTerm,
  WPUser,
} from '../../src/wordpress/types.js';

// Helper to build a mock Response
function mockResponse(body: unknown, init?: { status?: number; statusText?: string }): Response {
  const status = init?.status ?? 200;
  const statusText = init?.statusText ?? 'OK';
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as unknown as Response;
}

const fakeUser: WPUser = {
  id: 1,
  name: 'admin',
  slug: 'admin',
  avatar_urls: { '96': 'https://example.com/avatar.jpg' },
};

const fakePost: WPPost = {
  id: 42,
  title: { rendered: 'Hello', raw: 'Hello' },
  content: {
    rendered: '<p>World</p>',
    raw: '<!-- wp:paragraph --><p>World</p><!-- /wp:paragraph -->',
  },
  excerpt: { rendered: '', raw: '' },
  status: 'draft',
  type: 'post',
  slug: 'hello',
  author: 1,
  date: '2026-01-01T00:00:00',
  modified: '2026-01-01T00:00:00',
};

describe('WordPressApiClient', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createClient(siteUrl = 'https://example.com') {
    return new WordPressApiClient({
      siteUrl,
      username: 'admin',
      appPassword: 'xxxx yyyy zzzz',
    });
  }

  describe('constructor', () => {
    it('strips trailing slashes from siteUrl', () => {
      fetchMock.mockResolvedValue(mockResponse(fakeUser));
      const client = createClient('https://example.com///');
      client.getCurrentUser();
      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/wp-json/wp/v2/users/me',
        expect.anything(),
      );
    });

    it('builds correct Basic auth header', () => {
      fetchMock.mockResolvedValue(mockResponse(fakeUser));
      const client = createClient();
      client.getCurrentUser();

      const expectedAuth = `Basic ${btoa('admin:xxxx yyyy zzzz')}`;
      const callOptions = fetchMock.mock.calls[0][1] as RequestInit;
      expect((callOptions.headers as Record<string, string>).Authorization).toBe(expectedAuth);
    });
  });

  describe('validateConnection', () => {
    it('returns the current user on success', async () => {
      fetchMock.mockResolvedValue(mockResponse(fakeUser));
      const client = createClient();
      const user = await client.validateConnection();
      expect(user).toEqual(fakeUser);
    });

    it('throws on auth failure', async () => {
      fetchMock.mockResolvedValue(
        mockResponse(
          { code: 'rest_forbidden', message: 'Forbidden' },
          { status: 401, statusText: 'Unauthorized' },
        ),
      );
      const client = createClient();
      await expect(client.validateConnection()).rejects.toThrow(WordPressApiError);
    });
  });

  describe('validateSyncEndpoint', () => {
    it('posts empty rooms array', async () => {
      fetchMock.mockResolvedValue(mockResponse({ rooms: [] }));
      const client = createClient();
      await client.validateSyncEndpoint();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/wp-json/wp-sync/v1/updates',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ rooms: [] }),
        }),
      );
    });
  });

  describe('getWordPressVersion', () => {
    it('returns version string', async () => {
      fetchMock.mockResolvedValue(mockResponse({ version: '7.0' }));
      const client = createClient();
      expect(await client.getWordPressVersion()).toBe('7.0');
    });

    it('returns unknown when endpoint is unavailable', async () => {
      fetchMock.mockRejectedValue(new Error('fetch failed'));
      const client = createClient();
      expect(await client.getWordPressVersion()).toBe('unknown');
    });

    it('returns unknown when version field is missing', async () => {
      fetchMock.mockResolvedValue(mockResponse({}));
      const client = createClient();
      expect(await client.getWordPressVersion()).toBe('unknown');
    });

    it('returns unknown when version field is empty', async () => {
      fetchMock.mockResolvedValue(mockResponse({ version: '' }));
      const client = createClient();
      expect(await client.getWordPressVersion()).toBe('unknown');
    });
  });

  describe('getCurrentUser', () => {
    it('fetches /wp/v2/users/me', async () => {
      fetchMock.mockResolvedValue(mockResponse(fakeUser));
      const client = createClient();
      const user = await client.getCurrentUser();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/wp-json/wp/v2/users/me',
        expect.anything(),
      );
      expect(user).toEqual(fakeUser);
    });
  });

  describe('listPosts', () => {
    it('includes context=edit by default', async () => {
      fetchMock.mockResolvedValue(mockResponse([fakePost]));
      const client = createClient();
      await client.listPosts();

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('context=edit');
    });

    it('applies status filter', async () => {
      fetchMock.mockResolvedValue(mockResponse([fakePost]));
      const client = createClient();
      await client.listPosts({ status: 'draft' });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('status=draft');
    });

    it('applies search filter', async () => {
      fetchMock.mockResolvedValue(mockResponse([fakePost]));
      const client = createClient();
      await client.listPosts({ search: 'hello world' });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('search=hello+world');
    });

    it('applies perPage filter', async () => {
      fetchMock.mockResolvedValue(mockResponse([fakePost]));
      const client = createClient();
      await client.listPosts({ perPage: 5 });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('per_page=5');
    });

    it('combines multiple filters', async () => {
      fetchMock.mockResolvedValue(mockResponse([fakePost]));
      const client = createClient();
      await client.listPosts({ status: 'publish', search: 'test', perPage: 10 });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('context=edit');
      expect(url).toContain('status=publish');
      expect(url).toContain('search=test');
      expect(url).toContain('per_page=10');
    });

    it('returns array of posts', async () => {
      fetchMock.mockResolvedValue(mockResponse([fakePost]));
      const client = createClient();
      const posts = await client.listPosts();
      expect(posts).toEqual([fakePost]);
    });
  });

  describe('getPost', () => {
    it('fetches post by ID with context=edit', async () => {
      fetchMock.mockResolvedValue(mockResponse(fakePost));
      const client = createClient();
      const post = await client.getPost(42);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/wp-json/wp/v2/posts/42?context=edit',
        expect.anything(),
      );
      expect(post).toEqual(fakePost);
    });
  });

  describe('createPost', () => {
    it('posts correct body and includes Content-Type', async () => {
      fetchMock.mockResolvedValue(mockResponse(fakePost));
      const client = createClient();
      const data = { title: 'New Post', content: '<p>Content</p>', status: 'draft' };
      const post = await client.createPost(data);

      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://example.com/wp-json/wp/v2/posts');
      expect(options.method).toBe('POST');
      expect((options.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify(data));
      expect(post).toEqual(fakePost);
    });
  });

  describe('sendSyncUpdate', () => {
    it('posts correct payload to sync endpoint', async () => {
      const syncResponse = {
        rooms: [{ room: 'postType/post:42', end_cursor: 5, awareness: {}, updates: [] }],
      };
      fetchMock.mockResolvedValue(mockResponse(syncResponse));

      const client = createClient();
      const payload: SyncPayload = {
        rooms: [
          {
            room: 'postType/post:42',
            client_id: 123,
            after: 0,
            awareness: null,
            updates: [],
          },
        ],
      };
      const result = await client.sendSyncUpdate(payload);

      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://example.com/wp-json/wp-sync/v1/updates');
      expect(options.method).toBe('POST');
      expect(options.body).toBe(JSON.stringify(payload));
      expect(result).toEqual(syncResponse);
    });
  });

  describe('error handling', () => {
    it('throws WordPressApiError with status 401', async () => {
      fetchMock.mockResolvedValue(
        mockResponse(
          { code: 'rest_forbidden', message: 'Sorry, you are not allowed to do that.' },
          { status: 401, statusText: 'Unauthorized' },
        ),
      );
      const client = createClient();

      try {
        await client.getCurrentUser();
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(WordPressApiError);
        const apiErr = err as WordPressApiError;
        expect(apiErr.status).toBe(401);
        expect(apiErr.message).toContain('Authentication failed');
        expect(apiErr.message).toContain('Application Password');
      }
    });

    it('throws WordPressApiError with status 404', async () => {
      fetchMock.mockResolvedValue(
        mockResponse(
          { code: 'rest_post_invalid_id', message: 'Invalid post ID.' },
          { status: 404, statusText: 'Not Found' },
        ),
      );
      const client = createClient();

      await expect(client.getPost(999)).rejects.toThrow(WordPressApiError);
      try {
        await client.getPost(999);
      } catch (err) {
        expect((err as WordPressApiError).status).toBe(404);
      }
    });

    it('throws WordPressApiError with status 500', async () => {
      fetchMock.mockResolvedValue(
        mockResponse('Internal Server Error', { status: 500, statusText: 'Internal Server Error' }),
      );
      const client = createClient();

      await expect(client.listPosts()).rejects.toThrow(WordPressApiError);
    });

    it('includes response body in error', async () => {
      const errorBody = { code: 'some_error', message: 'Something went wrong' };
      fetchMock.mockResolvedValue(
        mockResponse(errorBody, { status: 400, statusText: 'Bad Request' }),
      );
      const client = createClient();

      try {
        await client.listPosts();
        expect.fail('should have thrown');
      } catch (err) {
        const apiErr = err as WordPressApiError;
        expect(apiErr.body).toContain('some_error');
      }
    });

    it('gives auth-specific message for 401', async () => {
      fetchMock.mockResolvedValue(
        mockResponse(
          { code: 'rest_forbidden', message: 'Sorry' },
          { status: 401, statusText: 'Unauthorized' },
        ),
      );
      const client = createClient();

      try {
        await client.getCurrentUser();
        expect.fail('should have thrown');
      } catch (err) {
        const apiErr = err as WordPressApiError;
        expect(apiErr.message).toContain('Authentication failed');
        expect(apiErr.message).toContain('Application Password');
      }
    });

    it('gives auth-specific message for 403', async () => {
      fetchMock.mockResolvedValue(
        mockResponse(
          { code: 'rest_forbidden', message: 'Sorry' },
          { status: 403, statusText: 'Forbidden' },
        ),
      );
      const client = createClient();

      try {
        await client.getCurrentUser();
        expect.fail('should have thrown');
      } catch (err) {
        const apiErr = err as WordPressApiError;
        expect(apiErr.message).toContain('Authentication failed');
      }
    });

    it('gives collaborative editing message for 404 on sync endpoint', async () => {
      fetchMock.mockResolvedValue(
        mockResponse(
          { code: 'rest_no_route', message: 'No route' },
          { status: 404, statusText: 'Not Found' },
        ),
      );
      const client = createClient();

      try {
        await client.validateSyncEndpoint();
        expect.fail('should have thrown');
      } catch (err) {
        const apiErr = err as WordPressApiError;
        expect(apiErr.message).toContain('Collaborative editing is not enabled');
        expect(apiErr.message).toContain('Settings');
        expect(apiErr.message).toContain('WordPress 7.0');
      }
    });

    it('gives generic message for 404 on non-sync endpoint', async () => {
      fetchMock.mockResolvedValue(
        mockResponse(
          { code: 'rest_post_invalid_id', message: 'Invalid post ID.' },
          { status: 404, statusText: 'Not Found' },
        ),
      );
      const client = createClient();

      try {
        await client.getPost(999);
        expect.fail('should have thrown');
      } catch (err) {
        const apiErr = err as WordPressApiError;
        expect(apiErr.message).not.toContain('Collaborative editing');
        expect(apiErr.message).toContain('404');
      }
    });
  });

  describe('uploadMedia', () => {
    const fakeMediaItem: WPMediaItem = {
      id: 101,
      source_url: 'https://example.com/wp-content/uploads/2026/03/test.jpg',
      title: { rendered: 'test', raw: 'test' },
      caption: { rendered: '', raw: '' },
      alt_text: 'A test image',
      mime_type: 'image/jpeg',
      media_details: { width: 800, height: 600, sizes: {} },
    };

    it('posts to /wp/v2/media with FormData body', async () => {
      fetchMock.mockResolvedValue(mockResponse(fakeMediaItem));
      const client = createClient();
      const fileData = Buffer.from('fake image data');
      const result = await client.uploadMedia(fileData, 'test.jpg', 'image/jpeg');

      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://example.com/wp-json/wp/v2/media');
      expect(options.method).toBe('POST');
      expect(options.body).toBeInstanceOf(FormData);
      expect(result).toEqual(fakeMediaItem);
    });

    it('does not manually set Content-Type for FormData', async () => {
      fetchMock.mockResolvedValue(mockResponse(fakeMediaItem));
      const client = createClient();
      await client.uploadMedia(Buffer.from('data'), 'test.jpg', 'image/jpeg');

      const options = fetchMock.mock.calls[0][1] as RequestInit;
      expect((options.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    });

    it('includes Authorization header', async () => {
      fetchMock.mockResolvedValue(mockResponse(fakeMediaItem));
      const client = createClient();
      await client.uploadMedia(Buffer.from('data'), 'test.jpg', 'image/jpeg');

      const expectedAuth = `Basic ${btoa('admin:xxxx yyyy zzzz')}`;
      const options = fetchMock.mock.calls[0][1] as RequestInit;
      expect((options.headers as Record<string, string>).Authorization).toBe(expectedAuth);
    });

    it('appends optional metadata to FormData', async () => {
      fetchMock.mockResolvedValue(mockResponse(fakeMediaItem));
      const client = createClient();
      await client.uploadMedia(Buffer.from('data'), 'test.jpg', 'image/jpeg', {
        altText: 'Alt text',
        title: 'My Image',
        caption: 'A caption',
      });

      const options = fetchMock.mock.calls[0][1] as RequestInit;
      const formData = options.body as FormData;
      expect(formData.get('alt_text')).toBe('Alt text');
      expect(formData.get('title')).toBe('My Image');
      expect(formData.get('caption')).toBe('A caption');
    });

    it('does not append undefined optional fields', async () => {
      fetchMock.mockResolvedValue(mockResponse(fakeMediaItem));
      const client = createClient();
      await client.uploadMedia(Buffer.from('data'), 'test.jpg', 'image/jpeg');

      const options = fetchMock.mock.calls[0][1] as RequestInit;
      const formData = options.body as FormData;
      expect(formData.get('alt_text')).toBeNull();
      expect(formData.get('title')).toBeNull();
      expect(formData.get('caption')).toBeNull();
    });

    it('throws on auth failure', async () => {
      fetchMock.mockResolvedValue(
        mockResponse(
          { code: 'rest_forbidden', message: 'Forbidden' },
          { status: 401, statusText: 'Unauthorized' },
        ),
      );
      const client = createClient();
      await expect(
        client.uploadMedia(Buffer.from('data'), 'test.jpg', 'image/jpeg'),
      ).rejects.toThrow(WordPressApiError);
    });

    it('throws on server error (e.g., file too large)', async () => {
      fetchMock.mockResolvedValue(
        mockResponse(
          { code: 'rest_upload_file_too_big', message: 'File too large' },
          { status: 413, statusText: 'Payload Too Large' },
        ),
      );
      const client = createClient();
      await expect(
        client.uploadMedia(Buffer.from('data'), 'test.jpg', 'image/jpeg'),
      ).rejects.toThrow(WordPressApiError);
    });
  });

  describe('getBlockTypes', () => {
    it('fetches /wp/v2/block-types?context=edit', async () => {
      const fakeBlockTypes: WPBlockType[] = [
        {
          name: 'core/paragraph',
          attributes: { content: { type: 'rich-text', source: 'rich-text' } },
        },
        {
          name: 'core/heading',
          attributes: { content: { type: 'rich-text', source: 'rich-text' } },
        },
      ];
      fetchMock.mockResolvedValue(mockResponse(fakeBlockTypes));
      const client = createClient();
      const result = await client.getBlockTypes();

      expect(fetchMock).toHaveBeenCalledWith(
        'https://example.com/wp-json/wp/v2/block-types?context=edit',
        expect.anything(),
      );
      expect(result).toEqual(fakeBlockTypes);
    });

    it('returns block types with attributes', async () => {
      const fakeBlockTypes: WPBlockType[] = [
        {
          name: 'core/paragraph',
          attributes: {
            content: { type: 'rich-text', source: 'rich-text' },
            dropCap: { type: 'boolean', default: false },
            placeholder: { type: 'string' },
          },
        },
        {
          name: 'core/image',
          attributes: {
            url: { type: 'string', source: 'attribute' },
            alt: { type: 'string', source: 'attribute', default: '' },
            caption: { type: 'rich-text', source: 'rich-text' },
            id: { type: 'number' },
          },
        },
        { name: 'core/separator', attributes: null },
      ];
      fetchMock.mockResolvedValue(mockResponse(fakeBlockTypes));
      const client = createClient();
      const result = await client.getBlockTypes();

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('core/paragraph');
      expect(result[0].attributes).toEqual({
        content: { type: 'rich-text', source: 'rich-text' },
        dropCap: { type: 'boolean', default: false },
        placeholder: { type: 'string' },
      });
      expect(result[1].name).toBe('core/image');
      expect(result[1].attributes!.caption).toEqual({ type: 'rich-text', source: 'rich-text' });
      expect(result[2].name).toBe('core/separator');
      expect(result[2].attributes).toBeNull();
    });
  });

  describe('note methods', () => {
    const fakeNote: WPNote = {
      id: 10,
      post: 42,
      parent: 0,
      author: 1,
      author_name: 'admin',
      date: '2026-03-22T00:00:00',
      content: { rendered: '<p>A note</p>', raw: 'A note' },
      status: 'approved',
      type: 'note',
    };

    describe('checkNotesSupport', () => {
      it('returns true when the endpoint succeeds', async () => {
        fetchMock.mockResolvedValue(mockResponse([]));
        const client = createClient();
        const result = await client.checkNotesSupport();

        expect(result).toBe(true);
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toBe('https://example.com/wp-json/wp/v2/comments?type=note&per_page=1');
      });

      it('returns false on 400 error', async () => {
        fetchMock.mockResolvedValue(
          mockResponse(
            { code: 'rest_invalid_param', message: 'Invalid parameter(s): type' },
            { status: 400, statusText: 'Bad Request' },
          ),
        );
        const client = createClient();
        const result = await client.checkNotesSupport();

        expect(result).toBe(false);
      });

      it('returns false on 404 error', async () => {
        fetchMock.mockResolvedValue(
          mockResponse(
            { code: 'rest_no_route', message: 'No route' },
            { status: 404, statusText: 'Not Found' },
          ),
        );
        const client = createClient();
        const result = await client.checkNotesSupport();

        expect(result).toBe(false);
      });

      it('re-throws non-API errors (e.g. network failure)', async () => {
        fetchMock.mockRejectedValue(new TypeError('fetch failed'));
        const client = createClient();

        await expect(client.checkNotesSupport()).rejects.toThrow('fetch failed');
      });

      it('re-throws 5xx server errors instead of returning false', async () => {
        fetchMock.mockResolvedValue(
          mockResponse(
            { code: 'internal_error', message: 'Internal Server Error' },
            { status: 500, statusText: 'Internal Server Error' },
          ),
        );
        const client = createClient();

        await expect(client.checkNotesSupport()).rejects.toThrow(/500/);
      });
    });

    describe('listNotes', () => {
      it('fetches notes with correct query params', async () => {
        fetchMock.mockResolvedValue(mockResponse([fakeNote]));
        const client = createClient();
        const result = await client.listNotes(42);

        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('post=42');
        expect(url).toContain('type=note');
        expect(url).toContain('context=edit');
        expect(url).toContain('per_page=100');
        expect(url).toContain('page=1');
        expect(result).toEqual([fakeNote]);
      });

      it('calls the comments endpoint', async () => {
        fetchMock.mockResolvedValue(mockResponse([]));
        const client = createClient();
        await client.listNotes(99);

        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('/wp/v2/comments?');
      });

      it('paginates when first page is full', async () => {
        const fullPage = Array.from({ length: 100 }, (_, i) => ({
          ...fakeNote,
          id: i + 1,
        }));
        const secondPage = [{ ...fakeNote, id: 101 }];

        fetchMock
          .mockResolvedValueOnce(mockResponse(fullPage))
          .mockResolvedValueOnce(mockResponse(secondPage));

        const client = createClient();
        const result = await client.listNotes(42);

        expect(fetchMock).toHaveBeenCalledTimes(2);
        const url1 = fetchMock.mock.calls[0][0] as string;
        const url2 = fetchMock.mock.calls[1][0] as string;
        expect(url1).toContain('page=1');
        expect(url2).toContain('page=2');
        expect(result).toHaveLength(101);
      });

      it('does not paginate when first page is partial', async () => {
        fetchMock.mockResolvedValue(mockResponse([fakeNote]));
        const client = createClient();
        await client.listNotes(42);

        expect(fetchMock).toHaveBeenCalledTimes(1);
      });
    });

    describe('createNote', () => {
      it('posts to /wp/v2/comments with type note', async () => {
        fetchMock.mockResolvedValue(mockResponse(fakeNote));
        const client = createClient();
        const result = await client.createNote({ post: 42, content: 'A note' });

        const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://example.com/wp-json/wp/v2/comments');
        expect(options.method).toBe('POST');
        const body = JSON.parse(options.body as string);
        expect(body.post).toBe(42);
        expect(body.content).toBe('A note');
        expect(body.type).toBe('note');
        expect(body.parent).toBeUndefined();
        expect(result).toEqual(fakeNote);
      });

      it('includes parent when provided', async () => {
        const replyNote: WPNote = { ...fakeNote, id: 11, parent: 10 };
        fetchMock.mockResolvedValue(mockResponse(replyNote));
        const client = createClient();
        const result = await client.createNote({ post: 42, content: 'A reply', parent: 10 });

        const options = fetchMock.mock.calls[0][1] as RequestInit;
        const body = JSON.parse(options.body as string);
        expect(body.parent).toBe(10);
        expect(body.type).toBe('note');
        expect(result).toEqual(replyNote);
      });

      it('does not include parent when not provided', async () => {
        fetchMock.mockResolvedValue(mockResponse(fakeNote));
        const client = createClient();
        await client.createNote({ post: 42, content: 'No parent' });

        const options = fetchMock.mock.calls[0][1] as RequestInit;
        const body = JSON.parse(options.body as string);
        expect(body).not.toHaveProperty('parent');
      });
    });

    describe('updateNote', () => {
      it('posts to /wp/v2/comments/{noteId} with content', async () => {
        const updatedNote: WPNote = {
          ...fakeNote,
          content: { rendered: '<p>Updated</p>', raw: 'Updated' },
        };
        fetchMock.mockResolvedValue(mockResponse(updatedNote));
        const client = createClient();
        const result = await client.updateNote(10, { content: 'Updated' });

        const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://example.com/wp-json/wp/v2/comments/10');
        expect(options.method).toBe('POST');
        const body = JSON.parse(options.body as string);
        expect(body.content).toBe('Updated');
        expect(result).toEqual(updatedNote);
      });
    });

    describe('deleteNote', () => {
      it('sends DELETE to /wp/v2/comments/{noteId} with force=true', async () => {
        fetchMock.mockResolvedValue(mockResponse({ deleted: true }));
        const client = createClient();
        await client.deleteNote(10);

        const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('https://example.com/wp-json/wp/v2/comments/10?force=true');
        expect(options.method).toBe('DELETE');
      });
    });
  });

  describe('updatePost', () => {
    it('posts to /wp/v2/posts/{id}?context=edit with JSON body', async () => {
      const updatedPost: WPPost = { ...fakePost, title: { rendered: 'Updated', raw: 'Updated' } };
      fetchMock.mockResolvedValue(mockResponse(updatedPost));
      const client = createClient();
      const data = { title: 'Updated', status: 'publish' };
      const result = await client.updatePost(42, data);

      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://example.com/wp-json/wp/v2/posts/42?context=edit');
      expect(options.method).toBe('POST');
      expect((options.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify(data));
      expect(result).toEqual(updatedPost);
    });

    it('returns the updated post', async () => {
      const updatedPost: WPPost = { ...fakePost, status: 'publish' };
      fetchMock.mockResolvedValue(mockResponse(updatedPost));
      const client = createClient();
      const result = await client.updatePost(42, { status: 'publish' });

      expect(result.status).toBe('publish');
    });

    it('throws on error', async () => {
      fetchMock.mockResolvedValue(
        mockResponse(
          { code: 'rest_post_invalid_id', message: 'Invalid post ID.' },
          { status: 404, statusText: 'Not Found' },
        ),
      );
      const client = createClient();
      await expect(client.updatePost(999, { title: 'Nope' })).rejects.toThrow(WordPressApiError);
    });
  });

  describe('searchTerms', () => {
    const fakeCat: WPTerm = { id: 1, name: 'Tech', slug: 'tech', taxonomy: 'category' };
    const fakeTag: WPTerm = { id: 2, name: 'JavaScript', slug: 'javascript', taxonomy: 'post_tag' };

    it('searches categories with correct URL params', async () => {
      fetchMock.mockResolvedValue(mockResponse([fakeCat]));
      const client = createClient();
      const result = await client.searchTerms('categories', 'Tech');

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('/wp/v2/categories?');
      expect(url).toContain('search=Tech');
      expect(url).toContain('per_page=100');
      expect(result).toEqual([fakeCat]);
    });

    it('searches tags with correct URL params', async () => {
      fetchMock.mockResolvedValue(mockResponse([fakeTag]));
      const client = createClient();
      const result = await client.searchTerms('tags', 'JavaScript');

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('/wp/v2/tags?');
      expect(url).toContain('search=JavaScript');
      expect(url).toContain('per_page=100');
      expect(result).toEqual([fakeTag]);
    });

    it('returns empty array when no matches', async () => {
      fetchMock.mockResolvedValue(mockResponse([]));
      const client = createClient();
      const result = await client.searchTerms('categories', 'nonexistent');

      expect(result).toEqual([]);
    });

    it('is a GET request without Content-Type', async () => {
      fetchMock.mockResolvedValue(mockResponse([]));
      const client = createClient();
      await client.searchTerms('tags', 'test');

      const options = fetchMock.mock.calls[0][1] as RequestInit;
      expect(options.method).toBeUndefined();
      expect((options.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    });
  });

  describe('listTerms', () => {
    const fakeCat: WPTerm = { id: 1, name: 'Tech', slug: 'tech', taxonomy: 'category' };
    const fakeTag: WPTerm = { id: 2, name: 'JavaScript', slug: 'javascript', taxonomy: 'post_tag' };

    it('lists categories with default params', async () => {
      fetchMock.mockResolvedValue(mockResponse([fakeCat]));
      const client = createClient();
      const result = await client.listTerms('categories');

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('/wp/v2/categories?');
      expect(url).toContain('per_page=100');
      expect(url).toContain('orderby=count');
      expect(url).toContain('order=desc');
      expect(result).toEqual([fakeCat]);
    });

    it('lists tags with correct endpoint', async () => {
      fetchMock.mockResolvedValue(mockResponse([fakeTag]));
      const client = createClient();
      const result = await client.listTerms('tags');

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('/wp/v2/tags?');
      expect(result).toEqual([fakeTag]);
    });

    it('passes search parameter when provided', async () => {
      fetchMock.mockResolvedValue(mockResponse([fakeCat]));
      const client = createClient();
      await client.listTerms('categories', { search: 'Tech' });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('search=Tech');
    });

    it('passes custom perPage', async () => {
      fetchMock.mockResolvedValue(mockResponse([fakeCat]));
      const client = createClient();
      await client.listTerms('categories', { perPage: 10 });

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('per_page=10');
    });

    it('returns empty array when no terms', async () => {
      fetchMock.mockResolvedValue(mockResponse([]));
      const client = createClient();
      const result = await client.listTerms('tags');

      expect(result).toEqual([]);
    });
  });

  describe('createTerm', () => {
    const fakeCat: WPTerm = {
      id: 5,
      name: 'New Category',
      slug: 'new-category',
      taxonomy: 'category',
    };
    const fakeTag: WPTerm = { id: 6, name: 'New Tag', slug: 'new-tag', taxonomy: 'post_tag' };

    it('creates a category with POST and JSON body', async () => {
      fetchMock.mockResolvedValue(mockResponse(fakeCat));
      const client = createClient();
      const result = await client.createTerm('categories', 'New Category');

      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://example.com/wp-json/wp/v2/categories');
      expect(options.method).toBe('POST');
      expect((options.headers as Record<string, string>)['Content-Type']).toBe('application/json');
      expect(options.body).toBe(JSON.stringify({ name: 'New Category' }));
      expect(result).toEqual(fakeCat);
    });

    it('creates a tag with POST and JSON body', async () => {
      fetchMock.mockResolvedValue(mockResponse(fakeTag));
      const client = createClient();
      const result = await client.createTerm('tags', 'New Tag');

      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://example.com/wp-json/wp/v2/tags');
      expect(options.method).toBe('POST');
      expect(options.body).toBe(JSON.stringify({ name: 'New Tag' }));
      expect(result).toEqual(fakeTag);
    });

    it('throws on duplicate term', async () => {
      fetchMock.mockResolvedValue(
        mockResponse(
          { code: 'term_exists', message: 'A term with the name provided already exists.' },
          { status: 400, statusText: 'Bad Request' },
        ),
      );
      const client = createClient();
      await expect(client.createTerm('categories', 'Existing')).rejects.toThrow(WordPressApiError);
    });
  });

  describe('getTerms', () => {
    const fakeCats: WPTerm[] = [
      { id: 1, name: 'Tech', slug: 'tech', taxonomy: 'category' },
      { id: 2, name: 'Science', slug: 'science', taxonomy: 'category' },
      { id: 3, name: 'Art', slug: 'art', taxonomy: 'category' },
    ];

    it('fetches categories by IDs with correct params', async () => {
      fetchMock.mockResolvedValue(mockResponse(fakeCats));
      const client = createClient();
      const result = await client.getTerms('categories', [1, 2, 3]);

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('/wp/v2/categories?');
      expect(url).toContain('include=1%2C2%2C3');
      expect(url).toContain('per_page=3');
      expect(result).toEqual(fakeCats);
    });

    it('fetches tags by IDs', async () => {
      const fakeTags: WPTerm[] = [{ id: 10, name: 'JS', slug: 'js', taxonomy: 'post_tag' }];
      fetchMock.mockResolvedValue(mockResponse(fakeTags));
      const client = createClient();
      const result = await client.getTerms('tags', [10]);

      const url = fetchMock.mock.calls[0][0] as string;
      expect(url).toContain('/wp/v2/tags?');
      expect(url).toContain('include=10');
      expect(url).toContain('per_page=1');
      expect(result).toEqual(fakeTags);
    });

    it('returns empty array for empty IDs without making a request', async () => {
      const client = createClient();
      const result = await client.getTerms('categories', []);

      expect(result).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('is a GET request without Content-Type', async () => {
      fetchMock.mockResolvedValue(mockResponse(fakeCats));
      const client = createClient();
      await client.getTerms('categories', [1, 2, 3]);

      const options = fetchMock.mock.calls[0][1] as RequestInit;
      expect(options.method).toBeUndefined();
      expect((options.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    });
  });

  describe('GET requests', () => {
    it('does not include Content-Type header', async () => {
      fetchMock.mockResolvedValue(mockResponse(fakeUser));
      const client = createClient();
      await client.getCurrentUser();

      const options = fetchMock.mock.calls[0][1] as RequestInit;
      expect((options.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    });
  });
});
