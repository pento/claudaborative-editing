import type {
  WordPressConfig,
  WPBlockType,
  WPMediaItem,
  WPNote,
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
   * Fetch all registered block types from the WordPress site.
   * GET /wp/v2/block-types?context=edit
   */
  async getBlockTypes(): Promise<WPBlockType[]> {
    return this.apiFetch<WPBlockType[]>('/wp/v2/block-types?context=edit');
  }

  /**
   * Upload a file to the WordPress media library.
   * POST /wp/v2/media (multipart/form-data)
   */
  async uploadMedia(
    fileData: Buffer,
    fileName: string,
    mimeType: string,
    options?: { altText?: string; caption?: string; title?: string },
  ): Promise<WPMediaItem> {
    const formData = new FormData();
    const blob = new Blob([fileData], { type: mimeType });
    formData.append('file', blob, fileName);

    if (options?.title) formData.append('title', options.title);
    if (options?.altText) formData.append('alt_text', options.altText);
    if (options?.caption) formData.append('caption', options.caption);

    return this.apiFetch<WPMediaItem>('/wp/v2/media', {
      method: 'POST',
      body: formData,
    });
  }

  /**
   * Check whether the site supports notes (block comments).
   * GET /wp/v2/comments?type=note&per_page=1
   * Returns true if the endpoint accepts type=note, false if the endpoint
   * rejects the type parameter (400) or doesn't exist (404).
   * Other errors (auth, server) are re-thrown so callers get actionable errors.
   */
  async checkNotesSupport(): Promise<boolean> {
    try {
      await this.apiFetch<unknown>('/wp/v2/comments?type=note&per_page=1');
      return true;
    } catch (err) {
      if (err instanceof WordPressApiError && (err.status === 400 || err.status === 404)) {
        return false;
      }
      throw err;
    }
  }

  /**
   * List all notes (block comments) for a given post.
   * Paginates automatically (100 per page, the WP REST API maximum).
   */
  async listNotes(postId: number): Promise<WPNote[]> {
    const perPage = 100;
    const allNotes: WPNote[] = [];
    let page = 1;

    while (true) {
      const params = new URLSearchParams({
        post: String(postId),
        type: 'note',
        context: 'edit',
        per_page: String(perPage),
        page: String(page),
      });

      const notes = await this.apiFetch<WPNote[]>(`/wp/v2/comments?${params.toString()}`);
      allNotes.push(...notes);

      if (notes.length < perPage) break;
      page++;
    }

    return allNotes;
  }

  /**
   * Create a new note (block comment) on a post.
   * POST /wp/v2/comments
   */
  async createNote(data: { post: number; content: string; parent?: number }): Promise<WPNote> {
    return this.apiFetch<WPNote>('/wp/v2/comments', {
      method: 'POST',
      body: JSON.stringify({
        post: data.post,
        content: data.content,
        type: 'note',
        ...(data.parent ? { parent: data.parent } : {}),
      }),
    });
  }

  /**
   * Update an existing note's content.
   * POST /wp/v2/comments/{noteId}
   */
  async updateNote(noteId: number, data: { content: string }): Promise<WPNote> {
    return this.apiFetch<WPNote>(`/wp/v2/comments/${noteId}`, {
      method: 'POST',
      body: JSON.stringify({ content: data.content }),
    });
  }

  /**
   * Delete a note permanently.
   * DELETE /wp/v2/comments/{noteId}?force=true
   */
  async deleteNote(noteId: number): Promise<void> {
    await this.apiFetch<unknown>(`/wp/v2/comments/${noteId}?force=true`, {
      method: 'DELETE',
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
   * Produce a human-friendly error message for common failure modes.
   */
  private formatErrorMessage(path: string, status: number, body: string): string {
    if (status === 401 || status === 403) {
      return `Authentication failed. Check your username and Application Password. (HTTP ${status})`;
    }

    if (status === 404 && path.startsWith('/wp-sync/')) {
      return (
        'Collaborative editing is not enabled. ' +
        'Enable it in Settings \u2192 Writing in your WordPress admin, then try again. ' +
        '(Requires WordPress 7.0 or later.)'
      );
    }

    return `WordPress API error ${status}: ${body}`;
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

    // Add Content-Type for JSON requests (skip for FormData — fetch auto-sets the boundary)
    if (
      (options?.method === 'POST' || options?.method === 'PUT') &&
      !(options?.body instanceof FormData)
    ) {
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

      const message = this.formatErrorMessage(path, response.status, errorBody);

      throw new WordPressApiError(
        message,
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
