import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	WP_BASE_URL,
	assertSyncNamespaceRegistered,
	SYNC_NAMESPACE_MISSING_ERROR,
} from '../../e2e/helpers/playground.js';

// Helper to build a mock Response, matching the pattern in
// tests/unit/api-client.test.ts.
function mockResponse(body: unknown, ok = true, status = 200): Response {
	return {
		ok,
		status,
		json() {
			return body;
		},
	} as unknown as Response;
}

describe('assertSyncNamespaceRegistered', () => {
	let fetchMock: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
	});

	afterEach(() => {
		// restoreAllMocks() does not revert vi.stubGlobal, so the mocked
		// fetch would otherwise outlive this suite.
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('resolves when the wp-sync/v1 namespace is registered on the first check', async () => {
		fetchMock.mockResolvedValueOnce(
			mockResponse({ namespaces: ['wp/v2', 'wp-sync/v1'] })
		);

		await expect(
			assertSyncNamespaceRegistered(10_000, 1)
		).resolves.toBeUndefined();
		expect(fetchMock).toHaveBeenCalledWith(`${WP_BASE_URL}/wp-json/`);
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('polls rather than checking once: resolves once the namespace appears after a still-booting site reports only core namespaces', async () => {
		// Simulates Playground answering HTTP requests while the blueprint is
		// still installing Gutenberg (see the doc comment on
		// assertSyncNamespaceRegistered for the real incident this covers).
		fetchMock
			.mockResolvedValueOnce(
				mockResponse({
					namespaces: ['oembed/1.0', 'wp/v2', 'wp-site-health/v1'],
				})
			)
			.mockResolvedValueOnce(mockResponse({ namespaces: ['wp/v2'] }))
			.mockResolvedValueOnce(
				mockResponse({ namespaces: ['wp/v2', 'wp-sync/v1'] })
			);

		await expect(
			assertSyncNamespaceRegistered(10_000, 1)
		).resolves.toBeUndefined();
		expect(fetchMock).toHaveBeenCalledTimes(3);
	});

	it('throws the diagnosis once the deadline passes with the namespace still missing', async () => {
		fetchMock.mockResolvedValue(mockResponse({ namespaces: ['wp/v2'] }));

		await expect(assertSyncNamespaceRegistered(0, 1)).rejects.toThrow(
			SYNC_NAMESPACE_MISSING_ERROR
		);
	});

	it('throws the diagnosis once the deadline passes with the namespaces list absent', async () => {
		fetchMock.mockResolvedValue(mockResponse({}));

		await expect(assertSyncNamespaceRegistered(0, 1)).rejects.toThrow(
			SYNC_NAMESPACE_MISSING_ERROR
		);
	});

	it('reports the status code when the REST index is still not served at the deadline', async () => {
		fetchMock.mockResolvedValue(mockResponse({}, false, 500));

		await expect(assertSyncNamespaceRegistered(0, 1)).rejects.toThrow(
			'returned 500'
		);
	});

	it('reports a non-JSON REST index rather than a parse error at the deadline', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json() {
				return Promise.reject(new SyntaxError('Unexpected token <'));
			},
		});

		await expect(assertSyncNamespaceRegistered(0, 1)).rejects.toThrow(
			'did not return JSON'
		);
	});

	it('reports the last observed diagnosis, not the first, when the failure mode changes across polls', async () => {
		// First poll: still booting (non-JSON). Second poll: served, but the
		// namespace is missing. The deadline should report the more recent,
		// more specific diagnosis rather than the transient boot noise.
		fetchMock
			.mockResolvedValueOnce({
				ok: true,
				status: 200,
				json() {
					return Promise.reject(
						new SyntaxError('Unexpected token <')
					);
				},
			})
			.mockResolvedValue(mockResponse({ namespaces: ['wp/v2'] }));

		await expect(assertSyncNamespaceRegistered(50, 1)).rejects.toThrow(
			SYNC_NAMESPACE_MISSING_ERROR
		);
	});
});
