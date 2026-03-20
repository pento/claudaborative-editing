import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WordPressApiClient, WordPressApiError } from '../../src/wordpress/api-client.js';
import type { SyncPayload, WPPost, WPUser } from '../../src/wordpress/types.js';

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
  content: { rendered: '<p>World</p>', raw: '<!-- wp:paragraph --><p>World</p><!-- /wp:paragraph -->' },
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
        mockResponse({ code: 'rest_forbidden', message: 'Forbidden' }, { status: 401, statusText: 'Unauthorized' }),
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
      const syncResponse = { rooms: [{ room: 'postType/post:42', end_cursor: 5, awareness: {}, updates: [] }] };
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
