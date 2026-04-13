/**
 * Unit tests for the cloud/connect module.
 */

describe('cloud/connect', () => {
	let originalFetch: typeof window.fetch;
	let originalState: unknown;

	beforeEach(() => {
		originalFetch = window.fetch;
		originalState = (window as any).wpceInitialState;
		jest.resetModules();
	});

	afterEach(() => {
		window.fetch = originalFetch;
		if (originalState !== undefined) {
			(window as any).wpceInitialState = originalState;
		} else {
			delete (window as any).wpceInitialState;
		}
	});

	describe('isCloudConfigured', () => {
		it('returns false when wpceInitialState is undefined', () => {
			delete (window as any).wpceInitialState;
			const { isCloudConfigured } = require('../connect');
			expect(isCloudConfigured()).toBe(false);
		});

		it('returns false when cloudUrl is empty', () => {
			(window as any).wpceInitialState = {
				cloudUrl: '',
				cloudApiKey: 'key-123',
			};
			const { isCloudConfigured } = require('../connect');
			expect(isCloudConfigured()).toBe(false);
		});

		it('returns false when cloudApiKey is empty', () => {
			(window as any).wpceInitialState = {
				cloudUrl: 'https://example.com',
				cloudApiKey: '',
			};
			const { isCloudConfigured } = require('../connect');
			expect(isCloudConfigured()).toBe(false);
		});

		it('returns false when both are missing', () => {
			(window as any).wpceInitialState = {};
			const { isCloudConfigured } = require('../connect');
			expect(isCloudConfigured()).toBe(false);
		});

		it('returns true when both cloudUrl and cloudApiKey are set', () => {
			(window as any).wpceInitialState = {
				cloudUrl: 'https://claudaborative.cloud',
				cloudApiKey: 'key-abc-123',
			};
			const { isCloudConfigured } = require('../connect');
			expect(isCloudConfigured()).toBe(true);
		});
	});

	describe('connectToCloud', () => {
		it('does not call fetch when cloud is not configured', () => {
			(window as any).wpceInitialState = {};
			const mockFetch = jest.fn().mockResolvedValue({});
			window.fetch = mockFetch;

			const { connectToCloud } = require('../connect');
			connectToCloud();

			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('does not call fetch when cloudUrl is missing', () => {
			(window as any).wpceInitialState = { cloudApiKey: 'key-123' };
			const mockFetch = jest.fn().mockResolvedValue({});
			window.fetch = mockFetch;

			const { connectToCloud } = require('../connect');
			connectToCloud();

			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('does not call fetch when cloudApiKey is missing', () => {
			(window as any).wpceInitialState = {
				cloudUrl: 'https://example.com',
			};
			const mockFetch = jest.fn().mockResolvedValue({});
			window.fetch = mockFetch;

			const { connectToCloud } = require('../connect');
			connectToCloud();

			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('calls fetch with correct URL and headers when configured', () => {
			(window as any).wpceInitialState = {
				cloudUrl: 'https://claudaborative.cloud',
				cloudApiKey: 'key-abc-123',
			};
			const mockFetch = jest.fn().mockResolvedValue({});
			window.fetch = mockFetch;

			const { connectToCloud } = require('../connect');
			connectToCloud();

			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockFetch).toHaveBeenCalledWith(
				'https://claudaborative.cloud/api/v1/connect',
				{
					method: 'POST',
					headers: {
						Authorization: 'Bearer key-abc-123',
					},
					mode: 'cors',
					credentials: 'omit',
				}
			);
		});

		it('strips trailing slashes from cloudUrl', () => {
			(window as any).wpceInitialState = {
				cloudUrl: 'https://claudaborative.cloud///',
				cloudApiKey: 'key-456',
			};
			const mockFetch = jest.fn().mockResolvedValue({});
			window.fetch = mockFetch;

			const { connectToCloud } = require('../connect');
			connectToCloud();

			expect(mockFetch).toHaveBeenCalledWith(
				'https://claudaborative.cloud/api/v1/connect',
				expect.any(Object)
			);
		});

		it('does not call fetch when cloudUrl uses plain HTTP', () => {
			(window as any).wpceInitialState = {
				cloudUrl: 'http://cloud.example.com',
				cloudApiKey: 'key-insecure',
			};
			const mockFetch = jest.fn().mockResolvedValue({});
			window.fetch = mockFetch;

			const { connectToCloud } = require('../connect');
			connectToCloud();

			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('allows HTTP for localhost development', () => {
			(window as any).wpceInitialState = {
				cloudUrl: 'http://localhost:8080',
				cloudApiKey: 'key-dev',
			};
			const mockFetch = jest.fn().mockResolvedValue({});
			window.fetch = mockFetch;

			const { connectToCloud } = require('../connect');
			connectToCloud();

			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		it('allows HTTP for 127.0.0.1 development', () => {
			(window as any).wpceInitialState = {
				cloudUrl: 'http://127.0.0.1:3000',
				cloudApiKey: 'key-dev',
			};
			const mockFetch = jest.fn().mockResolvedValue({});
			window.fetch = mockFetch;

			const { connectToCloud } = require('../connect');
			connectToCloud();

			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		it('allows HTTP for [::1] IPv6 loopback development', () => {
			(window as any).wpceInitialState = {
				cloudUrl: 'http://[::1]:3000',
				cloudApiKey: 'key-dev',
			};
			const mockFetch = jest.fn().mockResolvedValue({});
			window.fetch = mockFetch;

			const { connectToCloud } = require('../connect');
			connectToCloud();

			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		it('does not call fetch when cloudUrl is an invalid URL', () => {
			(window as any).wpceInitialState = {
				cloudUrl: 'not-a-url',
				cloudApiKey: 'key-bad',
			};
			const mockFetch = jest.fn().mockResolvedValue({});
			window.fetch = mockFetch;

			const { connectToCloud } = require('../connect');
			connectToCloud();

			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('silently catches fetch errors', async () => {
			(window as any).wpceInitialState = {
				cloudUrl: 'https://claudaborative.cloud',
				cloudApiKey: 'key-789',
			};
			const fetchError = new Error('Network failure');
			const mockFetch = jest.fn().mockRejectedValue(fetchError);
			window.fetch = mockFetch;

			const { connectToCloud } = require('../connect');

			// Should not throw.
			expect(() => connectToCloud()).not.toThrow();

			// Wait for the catch handler to execute.
			await new Promise((resolve) => setTimeout(resolve, 0));
		});
	});

	describe('reconnectToCloud', () => {
		it('returns true when fetch succeeds', async () => {
			(window as any).wpceInitialState = {
				cloudUrl: 'https://claudaborative.cloud',
				cloudApiKey: 'key-abc',
			};
			const mockFetch = jest
				.fn()
				.mockResolvedValue({ ok: true, status: 200 });
			window.fetch = mockFetch;

			const { reconnectToCloud } = require('../connect');
			const result = await reconnectToCloud();

			expect(result).toBe(true);
			expect(mockFetch).toHaveBeenCalledWith(
				'https://claudaborative.cloud/api/v1/connect',
				expect.objectContaining({ method: 'POST' })
			);
		});

		it('returns false when fetch fails', async () => {
			(window as any).wpceInitialState = {
				cloudUrl: 'https://claudaborative.cloud',
				cloudApiKey: 'key-abc',
			};
			const mockFetch = jest
				.fn()
				.mockRejectedValue(new Error('Network failure'));
			window.fetch = mockFetch;

			const { reconnectToCloud } = require('../connect');
			const result = await reconnectToCloud();

			expect(result).toBe(false);
		});

		it('returns false when response is not ok', async () => {
			(window as any).wpceInitialState = {
				cloudUrl: 'https://claudaborative.cloud',
				cloudApiKey: 'key-abc',
			};
			const mockFetch = jest
				.fn()
				.mockResolvedValue({ ok: false, status: 502 });
			window.fetch = mockFetch;

			const { reconnectToCloud } = require('../connect');
			const result = await reconnectToCloud();

			expect(result).toBe(false);
		});

		it('returns false when not configured', async () => {
			(window as any).wpceInitialState = {};
			const mockFetch = jest.fn().mockResolvedValue({ ok: true });
			window.fetch = mockFetch;

			const { reconnectToCloud } = require('../connect');
			const result = await reconnectToCloud();

			expect(result).toBe(false);
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('refuses non-HTTPS URLs', async () => {
			(window as any).wpceInitialState = {
				cloudUrl: 'http://cloud.example.com',
				cloudApiKey: 'key-abc',
			};
			const mockFetch = jest.fn().mockResolvedValue({ ok: true });
			window.fetch = mockFetch;

			const { reconnectToCloud } = require('../connect');
			const result = await reconnectToCloud();

			expect(result).toBe(false);
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('returns false when URL is invalid', async () => {
			(window as any).wpceInitialState = {
				cloudUrl: 'not-a-url',
				cloudApiKey: 'key-abc',
			};
			const mockFetch = jest.fn().mockResolvedValue({ ok: true });
			window.fetch = mockFetch;

			const { reconnectToCloud } = require('../connect');
			const result = await reconnectToCloud();

			expect(result).toBe(false);
			expect(mockFetch).not.toHaveBeenCalled();
		});

		it('allows HTTP for localhost development', async () => {
			(window as any).wpceInitialState = {
				cloudUrl: 'http://localhost:8080',
				cloudApiKey: 'key-dev',
			};
			const mockFetch = jest
				.fn()
				.mockResolvedValue({ ok: true, status: 200 });
			window.fetch = mockFetch;

			const { reconnectToCloud } = require('../connect');
			const result = await reconnectToCloud();

			expect(result).toBe(true);
			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		it('allows HTTP for 127.0.0.1 development', async () => {
			(window as any).wpceInitialState = {
				cloudUrl: 'http://127.0.0.1:3000',
				cloudApiKey: 'key-dev',
			};
			const mockFetch = jest
				.fn()
				.mockResolvedValue({ ok: true, status: 200 });
			window.fetch = mockFetch;

			const { reconnectToCloud } = require('../connect');
			const result = await reconnectToCloud();

			expect(result).toBe(true);
			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		it('allows HTTP for [::1] IPv6 loopback development', async () => {
			(window as any).wpceInitialState = {
				cloudUrl: 'http://[::1]:3000',
				cloudApiKey: 'key-dev',
			};
			const mockFetch = jest
				.fn()
				.mockResolvedValue({ ok: true, status: 200 });
			window.fetch = mockFetch;

			const { reconnectToCloud } = require('../connect');
			const result = await reconnectToCloud();

			expect(result).toBe(true);
			expect(mockFetch).toHaveBeenCalledTimes(1);
		});

		it('strips trailing slashes from cloudUrl', async () => {
			(window as any).wpceInitialState = {
				cloudUrl: 'https://claudaborative.cloud///',
				cloudApiKey: 'key-456',
			};
			const mockFetch = jest
				.fn()
				.mockResolvedValue({ ok: true, status: 200 });
			window.fetch = mockFetch;

			const { reconnectToCloud } = require('../connect');
			await reconnectToCloud();

			expect(mockFetch).toHaveBeenCalledWith(
				'https://claudaborative.cloud/api/v1/connect',
				expect.any(Object)
			);
		});

		it('includes credentials: omit in fetch options', async () => {
			(window as any).wpceInitialState = {
				cloudUrl: 'https://claudaborative.cloud',
				cloudApiKey: 'key-abc',
			};
			const mockFetch = jest
				.fn()
				.mockResolvedValue({ ok: true, status: 200 });
			window.fetch = mockFetch;

			const { reconnectToCloud } = require('../connect');
			await reconnectToCloud();

			expect(mockFetch).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({ credentials: 'omit' })
			);
		});
	});
});
