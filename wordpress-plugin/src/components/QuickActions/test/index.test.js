const mockSubmitCommand = jest.fn();

jest.mock('@wordpress/data', () => ({
	useSelect: jest.fn(),
	useDispatch: jest.fn((storeName) => {
		if (storeName === 'wpce/ai-actions') {
			return { submitCommand: mockSubmitCommand };
		}
		return { invalidateResolution: jest.fn() };
	}),
}));

jest.mock('@wordpress/components', () => {
	const { createElement } = require('react');
	return {
		MenuGroup: ({ children }) =>
			createElement('div', { role: 'group' }, children),
		MenuItem: ({ children, disabled, onClick, info, ...props }) =>
			createElement(
				'button',
				{ role: 'menuitem', disabled, onClick, ...props },
				children,
				info && createElement('span', { className: 'info' }, info)
			),
	};
});

jest.mock('../../../hooks/use-mcp-status', () => ({
	useMcpStatus: jest.fn(),
}));

jest.mock('../../../store', () => ({ STORE_NAME: 'wpce/ai-actions' }));

import { render, screen, fireEvent } from '@testing-library/react';
import { useSelect } from '@wordpress/data';
import { useMcpStatus } from '../../../hooks/use-mcp-status';
import QuickActions from '..';

function mockUseSelect(stores) {
	useSelect.mockImplementation((selector) => {
		const select = (storeName) => stores[storeName] || {};
		return selector(select);
	});
}

function defaultStores(overrides = {}) {
	return {
		'core/editor': {
			getCurrentPostId: () => 123,
		},
		core: {
			getEntityRecords: () => null,
		},
		'wpce/ai-actions': {
			getActiveCommand: () => null,
			isSubmitting: () => false,
			getCommandError: () => null,
		},
		...overrides,
	};
}

describe('QuickActions', () => {
	beforeEach(() => {
		jest.clearAllMocks();

		useMcpStatus.mockReturnValue({
			mcpConnected: true,
			mcpLastSeenAt: '2026-03-30T12:00:00Z',
			isLoading: false,
			error: null,
		});

		mockUseSelect(defaultStores());
	});

	it('renders Proofread and Review menu items', () => {
		render(<QuickActions />);

		expect(screen.getByText('Proofread')).toBeTruthy();
		expect(screen.getByText('Review')).toBeTruthy();
	});

	it('menu items show info descriptions', () => {
		render(<QuickActions />);

		expect(
			screen.getByText('Fix grammar, spelling, and punctuation')
		).toBeTruthy();
		expect(
			screen.getByText('Leave editorial notes on the post')
		).toBeTruthy();
	});

	it('items disabled when not connected', () => {
		useMcpStatus.mockReturnValue({
			mcpConnected: false,
			mcpLastSeenAt: null,
			isLoading: false,
			error: null,
		});

		render(<QuickActions />);

		expect(screen.getByText('Proofread').closest('button').disabled).toBe(
			true
		);
		expect(screen.getByText('Review').closest('button').disabled).toBe(
			true
		);
	});

	it('items enabled when connected with no active command', () => {
		render(<QuickActions />);

		expect(screen.getByText('Proofread').closest('button').disabled).toBe(
			false
		);
		expect(screen.getByText('Review').closest('button').disabled).toBe(
			false
		);
	});

	it('click Proofread calls submitCommand and onClose', () => {
		const onClose = jest.fn();
		render(<QuickActions onClose={onClose} />);

		fireEvent.click(screen.getByText('Proofread'));

		expect(mockSubmitCommand).toHaveBeenCalledWith('proofread', 123);
		expect(onClose).toHaveBeenCalled();
	});

	it('click Review calls submitCommand and onClose', () => {
		const onClose = jest.fn();
		render(<QuickActions onClose={onClose} />);

		fireEvent.click(screen.getByText('Review'));

		expect(mockSubmitCommand).toHaveBeenCalledWith('review', 123);
		expect(onClose).toHaveBeenCalled();
	});

	it('shows error message when error exists', () => {
		mockUseSelect(
			defaultStores({
				'wpce/ai-actions': {
					getActiveCommand: () => null,
					isSubmitting: () => false,
					getCommandError: () => 'Something went wrong',
				},
			})
		);

		render(<QuickActions />);

		expect(screen.getByText('Something went wrong')).toBeTruthy();
	});

	it('items disabled when command is active', () => {
		mockUseSelect(
			defaultStores({
				'wpce/ai-actions': {
					getActiveCommand: () => ({
						id: 42,
						prompt: 'proofread',
						status: 'running',
						post_id: 123,
					}),
					isSubmitting: () => false,
					getCommandError: () => null,
				},
			})
		);

		render(<QuickActions />);

		expect(screen.getByText('Proofread').closest('button').disabled).toBe(
			true
		);
		expect(screen.getByText('Review').closest('button').disabled).toBe(
			true
		);
	});

	it('items disabled when submitting', () => {
		mockUseSelect(
			defaultStores({
				'wpce/ai-actions': {
					getActiveCommand: () => null,
					isSubmitting: () => true,
					getCommandError: () => null,
				},
			})
		);

		render(<QuickActions />);

		expect(screen.getByText('Proofread').closest('button').disabled).toBe(
			true
		);
	});

	it('items disabled when postId is not available', () => {
		mockUseSelect(
			defaultStores({
				'core/editor': {
					getCurrentPostId: () => null,
				},
			})
		);

		render(<QuickActions />);

		expect(screen.getByText('Proofread').closest('button').disabled).toBe(
			true
		);
		expect(screen.getByText('Review').closest('button').disabled).toBe(
			true
		);
	});

	it('items disabled when editing other post', () => {
		mockUseSelect(
			defaultStores({
				'wpce/ai-actions': {
					getActiveCommand: () => ({
						id: 1,
						post_id: 999,
						status: 'running',
					}),
					isSubmitting: () => false,
					getCommandError: () => null,
				},
			})
		);

		render(<QuickActions />);

		expect(screen.getByText('Proofread').closest('button').disabled).toBe(
			true
		);
	});
});
