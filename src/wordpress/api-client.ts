import type {
  WordPressConfig,
  WPPost,
  WPUser,
  SyncPayload,
  SyncResponse,
} from './types.js';

/**
 * WordPress REST API client using Application Password (HTTP Basic Auth).
 *
 * Uses native fetch() — requires Node.js 18+.
 */
export class WordPressApiClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(config: WordPressConfig) {
    // Normalize URL: strip trailing slash(es)
    const siteUrl = config.siteUrl.replace(/\/+$/, '');
    this.baseUrl = `${siteUrl}/wp-json`;
    this.authHeader = `Basic ${btoa(config.username + ':' + config.appPassword)}`;
  }

  /**
   * Validate the connection by fetching the current user.
   * Tests both auth and API availability.
   */
  async validateConnection(): Promise<WPUser> {
    return this.getCurrentUser();
  }

  /**
   * Check that the sync endpoint exists.
   * POSTs an empty rooms array to verify the endpoint responds.
   */
  async validateSyncEndpoint(): Promise<void> {
    await this.sendSyncUpdate({ rooms: [] });
  }

  /**
   * Get the current authenticated user.
   * GET /wp/v2/users/me
   */
  async getCurrentUser(): Promise<WPUser> {
    return this.apiFetch<WPUser>('/wp/v2/users/me');
  }

  /**
   * List posts with optional filters.
   * GET /wp/v2/posts?status=...&search=...&per_page=...&context=edit
   */
  async listPosts(options?: {
    status?: string;
    search?: string;
    perPage?: number;
  }): Promise<WPPost[]> {
    const params = new URLSearchParams({ context: 'edit' });

    if (options?.status) {
      params.set('status', options.status);
    }
    if (options?.search) {
      params.set('search', options.search);
    }
    if (options?.perPage !== undefined) {
      params.set('per_page', String(options.perPage));
    }

    return this.apiFetch<WPPost[]>(`/wp/v2/posts?${params.toString()}`);
  }

  /**
   * Get a single post by ID.
   * GET /wp/v2/posts/{id}?context=edit
   */
  async getPost(id: number): Promise<WPPost> {
    return this.apiFetch<WPPost>(`/wp/v2/posts/${id}?context=edit`);
  }

  /**
   * Create a new post.
   * POST /wp/v2/posts
   */
  async createPost(data: {
    title?: string;
    content?: string;
    status?: string;
  }): Promise<WPPost> {
    return this.apiFetch<WPPost>('/wp/v2/posts', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * Send a sync payload and receive response.
   * POST /wp-sync/v1/updates
   */
  async sendSyncUpdate(payload: SyncPayload): Promise<SyncResponse> {
    return this.apiFetch<SyncResponse>('/wp-sync/v1/updates', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  /**
   * Internal fetch helper with auth and error handling.
   */
  private async apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: 'application/json',
    };

    // Add Content-Type for requests with a body
    if (options?.method === 'POST' || options?.method === 'PUT') {
      headers['Content-Type'] = 'application/json';
    }

    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...(options?.headers as Record<string, string> | undefined),
      },
    });

    if (!response.ok) {
      let errorBody: string;
      try {
        errorBody = await response.text();
      } catch {
        errorBody = '(unable to read response body)';
      }

      throw new WordPressApiError(
        `WordPress API error ${response.status} ${response.statusText}: ${errorBody}`,
        response.status,
        errorBody,
      );
    }

    return (await response.json()) as T;
  }
}

/**
 * Custom error class for WordPress API errors,
 * carrying the HTTP status and response body.
 */
export class WordPressApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
  ) {
    super(message);
    this.name = 'WordPressApiError';
  }
}
