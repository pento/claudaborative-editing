import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CheckboxItem } from '../../../src/cli/checkbox-prompt.js';

const { checkboxPrompt } = await import('../../../src/cli/checkbox-prompt.js');

// Store original value so we can restore it
const originalIsTTY = process.stdin.isTTY;

beforeEach(() => {
	// Force non-TTY mode so tests use the fallback path
	Object.defineProperty(process.stdin, 'isTTY', {
		value: false,
		configurable: true,
	});
});

afterEach(() => {
	Object.defineProperty(process.stdin, 'isTTY', {
		value: originalIsTTY,
		configurable: true,
	});
	vi.restoreAllMocks();
});

describe('checkboxPrompt (non-TTY fallback)', () => {
	it('returns initial selection when stdin is not a TTY', async () => {
		const items: CheckboxItem[] = [
			{ label: 'A', selected: true },
			{ label: 'B', selected: false },
			{ label: 'C', selected: true },
		];

		const result = await checkboxPrompt(items);

		expect(result.selected).toEqual([0, 2]);
	});

	it('returns empty array when no items are initially selected', async () => {
		const items: CheckboxItem[] = [
			{ label: 'A', selected: false },
			{ label: 'B', selected: false },
		];

		const result = await checkboxPrompt(items);

		expect(result.selected).toEqual([]);
	});

	it('returns empty array when requireSelection is true and nothing is selected', async () => {
		const items: CheckboxItem[] = [
			{ label: 'A', selected: false },
			{ label: 'B', selected: false },
		];

		// Non-interactive mode can't prompt the user, so it returns whatever the initial state is
		const result = await checkboxPrompt(items, { requireSelection: true });

		expect(result.selected).toEqual([]);
	});

	it('returns all indices when all items are initially selected', async () => {
		const items: CheckboxItem[] = [
			{ label: 'First', selected: true },
			{ label: 'Second', selected: true },
			{ label: 'Third', selected: true },
		];

		const result = await checkboxPrompt(items);

		expect(result.selected).toEqual([0, 1, 2]);
	});

	it('handles items with hints', async () => {
		const items: CheckboxItem[] = [
			{ label: 'Detected', selected: true },
			{ label: 'Not Detected', hint: '(not installed)', selected: false },
		];

		const result = await checkboxPrompt(items);

		// Hints don't affect selection logic
		expect(result.selected).toEqual([0]);
	});

	it('handles empty items list', async () => {
		const items: CheckboxItem[] = [];

		const result = await checkboxPrompt(items);

		expect(result.selected).toEqual([]);
	});
});
