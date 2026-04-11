jest.mock('@wordpress/element', () => {
	const React = require('react');
	return {
		useState: React.useState,
		useCallback: React.useCallback,
		useRef: React.useRef,
		useEffect: React.useEffect,
	};
});

import { renderHook, act } from '@testing-library/react';
import { useCopyToClipboard } from '../use-copy-to-clipboard';

describe('useCopyToClipboard', () => {
	let clipboardSpy: jest.Mock;

	beforeEach(() => {
		jest.useFakeTimers();
		clipboardSpy = jest.fn().mockResolvedValue(undefined);
		Object.assign(navigator, {
			clipboard: { writeText: clipboardSpy },
		});
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('calls navigator.clipboard.writeText with the provided text', async () => {
		const { result } = renderHook(() =>
			useCopyToClipboard('npx claudaborative-editing start')
		);

		await act(async () => {
			result.current.handleCopy();
		});

		expect(clipboardSpy).toHaveBeenCalledWith(
			'npx claudaborative-editing start'
		);
	});

	it('sets copied to true after successful write and resets after 2000ms', async () => {
		const { result } = renderHook(() => useCopyToClipboard('hello'));

		expect(result.current.copied).toBe(false);

		await act(async () => {
			result.current.handleCopy();
		});

		expect(result.current.copied).toBe(true);

		act(() => {
			jest.advanceTimersByTime(2000);
		});

		expect(result.current.copied).toBe(false);
	});

	it('does not throw when navigator.clipboard is undefined', () => {
		Object.defineProperty(navigator, 'clipboard', {
			value: undefined,
			writable: true,
			configurable: true,
		});

		const { result } = renderHook(() => useCopyToClipboard('test'));

		expect(() => result.current.handleCopy()).not.toThrow();
	});

	it('does not throw when navigator.clipboard.writeText is undefined', () => {
		Object.assign(navigator, { clipboard: {} });

		const { result } = renderHook(() => useCopyToClipboard('test'));

		expect(() => result.current.handleCopy()).not.toThrow();
	});

	it('handles rejected clipboard write gracefully', async () => {
		clipboardSpy.mockRejectedValueOnce(new Error('Permission denied'));

		const { result } = renderHook(() => useCopyToClipboard('test'));

		await act(async () => {
			result.current.handleCopy();
		});

		expect(result.current.copied).toBe(false);
	});

	it('cleans up timeout on unmount', async () => {
		const { result, unmount } = renderHook(() =>
			useCopyToClipboard('test')
		);

		await act(async () => {
			result.current.handleCopy();
		});

		expect(result.current.copied).toBe(true);

		// Unmount while copied is still true
		unmount();

		// Advance timers past the timeout — should not throw
		act(() => {
			jest.advanceTimersByTime(3000);
		});
	});
});
