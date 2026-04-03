const mockSubmitCommand = jest.fn();
const mockCreateNotice = jest.fn();

jest.mock('@wordpress/data', () => ({
	useSelect: jest.fn(),
	useDispatch: jest.fn(() => ({})),
}));

jest.mock('@wordpress/notices', () => ({ store: { name: 'core/notices' } }));

jest.mock('@wordpress/components', () => {
	const { createElement } = require('react');
	return {
		DropdownMenu: ({ children, icon, label }: any) =>
			createElement(
				'div',
				{ 'data-testid': 'dropdown-menu', 'aria-label': label },
				createElement('span', { 'data-testid': 'menu-icon' }, icon),
				typeof children === 'function'
					? children({ onClose: jest.fn() })
					: children
			),
		MenuGroup: ({ children }: any) =>
			createElement('div', { role: 'group' }, children),
		MenuItem: ({ children, disabled, onClick, info, ...props }: any) =>
			createElement(
				'button',
				{ role: 'menuitem', disabled, onClick, ...props },
				children,
				info && createElement('span', { className: 'info' }, info)
			),
	};
});

jest.mock('@wordpress/interface', () => {
	const { createElement } = require('react');
	return {
		PinnedItems: ({ children }: any) =>
			createElement('div', { 'data-testid': 'pinned-items' }, children),
	};
});

jest.mock('../../../hooks/use-mcp-status', () => ({
	useMcpStatus: jest.fn(),
}));

jest.mock('../../../store', () => ({
	__esModule: true,
	default: { name: 'wpce/ai-actions' },
}));

import { render, screen, fireEvent, act } from '@testing-library/react';
import { useSelect, useDispatch } from '@wordpress/data';
import { store as noticesStore } from '@wordpress/notices';
import aiActionsStore from '../../../store';
import { useMcpStatus } from '../../../hooks/use-mcp-status';
import AiActionsMenu from '..';

const mockedUseSelect = useSelect as jest.Mock;
const mockedUseDispatch = useDispatch as jest.Mock;
const mockedUseMcpStatus = useMcpStatus as jest.Mock;

function mockUseSelect(
	stores: Map<unknown, Record<string, (...args: any[]) => any>>
) {
	mockedUseSelect.mockImplementation((selector: any) => {
		const select = (s: unknown) => stores.get(s) ?? {};
		return selector(select);
	});
}

const DEFAULT_AI_STORE = {
	getCurrentPostId: () => 123,
	getActiveCommand: () => null,
	isSubmitting: () => false,
	getCommandError: () => null,
};

function defaultStores(
	aiStoreOverrides: Record<string, (...args: any[]) => any> = {}
): Map<unknown, Record<string, (...args: any[]) => any>> {
	return new Map([
		[aiActionsStore, { ...DEFAULT_AI_STORE, ...aiStoreOverrides }],
	]);
}

describe('AiActionsMenu', () => {
	beforeEach(() => {
		jest.clearAllMocks();

		mockedUseDispatch.mockImplementation((s: unknown) => {
			if (s === aiActionsStore) {
				return { submitCommand: mockSubmitCommand };
			}
			if (s === noticesStore) {
				return { createNotice: mockCreateNotice };
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

	it('renders inside PinnedItems', () => {
		render(<AiActionsMenu />);
		expect(screen.getByTestId('pinned-items')).toBeTruthy();
	});

	it('renders DropdownMenu with correct label', () => {
		render(<AiActionsMenu />);
		const menu = screen.getByTestId('dropdown-menu');
		expect(menu.getAttribute('aria-label')).toBe('Claudaborative Editing');
	});

	it('renders SparkleIcon without processing when no active command', () => {
		render(<AiActionsMenu />);
		const svg = screen.getByTestId('menu-icon').querySelector('svg');
		expect(svg).toBeTruthy();
		expect(svg!.classList.contains('wpce-sparkles-processing')).toBe(false);
	});

	it('renders SparkleIcon with processing when command is active', () => {
		mockUseSelect(
			defaultStores({
				getActiveCommand: () => ({
					id: 1,
					prompt: 'proofread',
					status: 'running',
					post_id: 123,
				}),
				isSubmitting: () => false,
				getCommandError: () => null,
			})
		);

		render(<AiActionsMenu />);
		const svg = screen.getByTestId('menu-icon').querySelector('svg');
		expect(svg!.classList.contains('wpce-sparkles-processing')).toBe(true);
	});

	it('renders Proofread and Review menu items', () => {
		render(<AiActionsMenu />);
		expect(screen.getByText('Proofread')).toBeTruthy();
		expect(screen.getByText('Review')).toBeTruthy();
	});

	it('menu items show info descriptions', () => {
		render(<AiActionsMenu />);
		expect(
			screen.getByText('Fix grammar, spelling, and punctuation')
		).toBeTruthy();
		expect(
			screen.getByText('Leave editorial notes on the post')
		).toBeTruthy();
	});

	it('items enabled when connected with no active command', () => {
		render(<AiActionsMenu />);
		expect(screen.getByText('Proofread').closest('button')!.disabled).toBe(
			false
		);
		expect(screen.getByText('Review').closest('button')!.disabled).toBe(
			false
		);
	});

	it('items disabled when not connected', () => {
		mockedUseMcpStatus.mockReturnValue({
			mcpConnected: false,
			mcpLastSeenAt: null,
			isLoading: false,
			error: null,
		});

		render(<AiActionsMenu />);
		expect(screen.getByText('Proofread').closest('button')!.disabled).toBe(
			true
		);
	});

	it('items disabled when postId is not available', () => {
		mockUseSelect(
			defaultStores({
				getCurrentPostId: () => null,
				getActiveCommand: () => null,
				isSubmitting: () => false,
				getCommandError: () => null,
			})
		);

		render(<AiActionsMenu />);
		expect(screen.getByText('Proofread').closest('button')!.disabled).toBe(
			true
		);
	});

	it('items disabled when command is active', () => {
		mockUseSelect(
			defaultStores({
				getActiveCommand: () => ({
					id: 42,
					prompt: 'proofread',
					status: 'running',
					post_id: 123,
				}),
				isSubmitting: () => false,
				getCommandError: () => null,
			})
		);

		render(<AiActionsMenu />);
		expect(screen.getByText('Proofread').closest('button')!.disabled).toBe(
			true
		);
	});

	it('items disabled when submitting', () => {
		mockUseSelect(
			defaultStores({
				getActiveCommand: () => null,
				isSubmitting: () => true,
				getCommandError: () => null,
			})
		);

		render(<AiActionsMenu />);
		expect(screen.getByText('Proofread').closest('button')!.disabled).toBe(
			true
		);
	});

	it('items disabled when editing other post', () => {
		mockUseSelect(
			defaultStores({
				getActiveCommand: () => ({
					id: 1,
					post_id: 999,
					status: 'running',
				}),
				isSubmitting: () => false,
				getCommandError: () => null,
			})
		);

		render(<AiActionsMenu />);
		expect(screen.getByText('Proofread').closest('button')!.disabled).toBe(
			true
		);
	});

	it('click Proofread calls submitCommand', () => {
		render(<AiActionsMenu />);
		fireEvent.click(screen.getByText('Proofread'));
		expect(mockSubmitCommand).toHaveBeenCalledWith('proofread', 123);
	});

	it('click Review calls submitCommand', () => {
		render(<AiActionsMenu />);
		fireEvent.click(screen.getByText('Review'));
		expect(mockSubmitCommand).toHaveBeenCalledWith('review', 123);
	});

	it('shows error as snackbar toast when error appears', async () => {
		const { rerender } = render(<AiActionsMenu />);
		expect(mockCreateNotice).not.toHaveBeenCalled();

		// Simulate an error appearing after submission
		mockUseSelect(
			defaultStores({
				getActiveCommand: () => null,
				isSubmitting: () => false,
				getCommandError: () => 'Something went wrong',
			})
		);

		await act(async () => rerender(<AiActionsMenu />));

		expect(mockCreateNotice).toHaveBeenCalledWith(
			'error',
			'Something went wrong',
			{ type: 'snackbar' }
		);
	});
});
