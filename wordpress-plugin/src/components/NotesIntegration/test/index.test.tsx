const mockSubmitCommand = jest.fn();

jest.mock('@wordpress/data', () => ({
	useSelect: jest.fn(),
	useDispatch: jest.fn(() => ({})),
}));

jest.mock('@wordpress/components', () => {
	const { createElement } = require('react');
	return {
		Button: ({
			children,
			disabled,
			onClick,
			className,
			label,
			isDestructive: _,
			variant: _v,
			size: _s,
			...props
		}: any) =>
			createElement(
				'button',
				{ disabled, onClick, className, 'aria-label': label, ...props },
				children
			),
	};
});

jest.mock('../../../hooks/use-mcp-status', () => ({
	useMcpStatus: jest.fn(),
}));

jest.mock('../../../store', () => ({
	__esModule: true,
	default: 'ai-actions-store',
}));

jest.mock('../../SparkleIcon', () => {
	const { createElement } = require('react');
	return {
		__esModule: true,
		default: ({ size, processing }: any) =>
			createElement('span', {
				'data-testid': 'sparkle-icon',
				'data-size': size,
				'data-processing': String(processing),
			}),
	};
});

import { render, screen, fireEvent, act } from '@testing-library/react';
import { useSelect, useDispatch } from '@wordpress/data';
import aiActionsStore from '../../../store';
import { useMcpStatus } from '../../../hooks/use-mcp-status';
import NotesIntegration from '..';

const mockedUseSelect = useSelect as jest.Mock;
const mockedUseDispatch = useDispatch as jest.Mock;
const mockedUseMcpStatus = useMcpStatus as jest.Mock;

// MutationObserver stub for jsdom — components use window.MutationObserver.
const OriginalMutationObserver: typeof MutationObserver =
	window.MutationObserver;
window.MutationObserver = class {
	observe() {}
	disconnect() {}
	takeRecords() {
		return [];
	}
} as any;

function mockUseSelect(
	stores: Record<string, Record<string, (...args: any[]) => any>>
) {
	mockedUseSelect.mockImplementation((selector: any) => {
		const select = (s: unknown) => stores[s as string] || {};
		return selector(select);
	});
}

const DEFAULT_AI_STORE = {
	getCurrentPostId: () => 100,
	getActiveCommand: () => null,
};

function defaultStores(
	aiStoreOverrides: Record<string, (...args: any[]) => any> = {}
) {
	return {
		[aiActionsStore as unknown as string]: {
			...DEFAULT_AI_STORE,
			...aiStoreOverrides,
		},
	};
}

function createMockPanel(
	threads: Array<{ id: number; hasStatus: boolean }> = []
): { panel: HTMLElement; cleanup: () => void } {
	const panel = document.createElement('div');
	panel.className = 'editor-collab-sidebar-panel';

	for (const { id, hasStatus } of threads) {
		const thread = document.createElement('div');
		thread.className = 'editor-collab-sidebar-panel__thread';
		thread.id = `comment-thread-${id}`;

		if (hasStatus) {
			const status = document.createElement('div');
			status.className = 'editor-collab-sidebar-panel__comment-status';
			const hstack = document.createElement('div');
			status.appendChild(hstack);
			thread.appendChild(status);
		}

		panel.appendChild(thread);
	}

	document.body.appendChild(panel);
	return { panel, cleanup: () => document.body.removeChild(panel) };
}

describe('NotesIntegration', () => {
	afterAll(() => {
		window.MutationObserver = OriginalMutationObserver;
	});

	beforeEach(() => {
		jest.clearAllMocks();

		mockedUseDispatch.mockImplementation((s: unknown) => {
			if (s === aiActionsStore) {
				return { submitCommand: mockSubmitCommand };
			}
			return {};
		});

		mockedUseMcpStatus.mockReturnValue({
			mcpConnected: true,
			mcpLastSeenAt: '2026-03-30T12:00:00Z',
			isLoading: false,
			error: null,
		});

		mockUseSelect(defaultStores());
	});

	it('returns null when no panels exist', async () => {
		const { container } = await act(async () =>
			render(<NotesIntegration />)
		);

		expect(container.innerHTML).toBe('');
	});

	it('renders Address All Notes button in panel', async () => {
		const { cleanup } = createMockPanel();

		await act(async () => render(<NotesIntegration />));

		expect(screen.getByText('Address All Notes')).toBeTruthy();

		cleanup();
	});

	it('renders sparkle icon in Address All Notes button', async () => {
		const { cleanup } = createMockPanel();

		await act(async () => render(<NotesIntegration />));

		const button = screen.getByText('Address All Notes').closest('button')!;
		const sparkle = button.querySelector('[data-testid="sparkle-icon"]')!;
		expect(sparkle).toBeTruthy();
		expect((sparkle as HTMLElement).dataset.size).toBe('18');

		cleanup();
	});

	it('renders per-note button on threads with status', async () => {
		const { cleanup } = createMockPanel([
			{ id: 42, hasStatus: true },
			{ id: 99, hasStatus: true },
		]);

		await act(async () => render(<NotesIntegration />));

		const buttons = screen.getAllByLabelText('Address This Note');
		expect(buttons).toHaveLength(2);

		cleanup();
	});

	it('skips threads without status element', async () => {
		const { cleanup } = createMockPanel([{ id: 42, hasStatus: false }]);

		await act(async () => render(<NotesIntegration />));

		expect(screen.queryByLabelText('Address This Note')).toBeNull();

		cleanup();
	});

	it('Address All Notes calls submitCommand with respond-to-notes', async () => {
		const { cleanup } = createMockPanel();

		await act(async () => render(<NotesIntegration />));

		await act(async () =>
			fireEvent.click(screen.getByText('Address All Notes'))
		);

		expect(mockSubmitCommand).toHaveBeenCalledWith('respond-to-notes', 100);

		cleanup();
	});

	it('per-note button calls submitCommand with respond-to-note and noteId', async () => {
		const { cleanup } = createMockPanel([{ id: 42, hasStatus: true }]);

		await act(async () => render(<NotesIntegration />));

		await act(async () =>
			fireEvent.click(screen.getByLabelText('Address This Note'))
		);

		expect(mockSubmitCommand).toHaveBeenCalledWith('respond-to-note', 100, {
			noteId: 42,
		});

		cleanup();
	});

	it('buttons disabled when postId is not available', async () => {
		mockUseSelect(defaultStores({ getCurrentPostId: () => null }));

		const { cleanup } = createMockPanel([{ id: 42, hasStatus: true }]);

		await act(async () => render(<NotesIntegration />));

		expect(
			screen.getByText('Address All Notes').closest('button')!.disabled
		).toBe(true);
		expect(
			(screen.getByLabelText('Address This Note') as HTMLButtonElement)
				.disabled
		).toBe(true);

		cleanup();
	});

	it('buttons disabled when not connected', async () => {
		mockedUseMcpStatus.mockReturnValue({
			mcpConnected: false,
			mcpLastSeenAt: null,
			isLoading: false,
			error: null,
		});

		const { cleanup } = createMockPanel([{ id: 42, hasStatus: true }]);

		await act(async () => render(<NotesIntegration />));

		expect(
			screen.getByText('Address All Notes').closest('button')!.disabled
		).toBe(true);
		expect(
			(screen.getByLabelText('Address This Note') as HTMLButtonElement)
				.disabled
		).toBe(true);

		cleanup();
	});

	it('buttons disabled when command is active', async () => {
		mockUseSelect(
			defaultStores({
				getActiveCommand: () => ({
					id: 1,
					prompt: 'proofread',
					status: 'running',
					post_id: 100,
				}),
			})
		);

		const { cleanup } = createMockPanel([{ id: 42, hasStatus: true }]);

		await act(async () => render(<NotesIntegration />));

		expect(
			screen.getByText('Address All Notes').closest('button')!.disabled
		).toBe(true);
		expect(
			(screen.getByLabelText('Address This Note') as HTMLButtonElement)
				.disabled
		).toBe(true);

		cleanup();
	});

	it('sparkle shows processing when command is active', async () => {
		mockUseSelect(
			defaultStores({
				getActiveCommand: () => ({
					id: 1,
					prompt: 'proofread',
					status: 'running',
					post_id: 100,
				}),
			})
		);

		const { cleanup } = createMockPanel();

		await act(async () => render(<NotesIntegration />));

		const sparkle = screen.getByTestId('sparkle-icon');
		expect(sparkle.dataset.processing).toBe('true');

		cleanup();
	});

	it('skips threads with invalid id format', async () => {
		const { cleanup } = createMockPanel([]);

		// Manually add a thread with bad ID
		const panel = document.querySelector('.editor-collab-sidebar-panel')!;
		const thread = document.createElement('div');
		thread.className = 'editor-collab-sidebar-panel__thread';
		thread.id = 'not-a-comment-thread';
		const status = document.createElement('div');
		status.className = 'editor-collab-sidebar-panel__comment-status';
		status.appendChild(document.createElement('div'));
		thread.appendChild(status);
		panel.appendChild(thread);

		await act(async () => render(<NotesIntegration />));

		expect(screen.queryByLabelText('Address This Note')).toBeNull();

		cleanup();
	});
});
