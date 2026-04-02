const mockCreateNotice = jest.fn();

jest.mock('@wordpress/data', () => ({
	useSelect: jest.fn(),
	useDispatch: jest.fn((storeName) => {
		if (storeName === 'core/notices') {
			return { createNotice: mockCreateNotice };
		}
		return {};
	}),
}));

jest.mock('@wordpress/components', () => {
	const { createElement } = require('react');
	return {
		Button: ({
			children,
			onClick,
			className,
			label,
			isDestructive: _,
			variant: _v,
			...props
		}) =>
			createElement(
				'button',
				{ onClick, className, 'aria-label': label, ...props },
				children
			),
		Popover: ({ children, className }) =>
			createElement(
				'div',
				{ 'data-testid': 'popover', className },
				children
			),
	};
});

jest.mock('../../../hooks/use-mcp-status', () => ({
	useMcpStatus: jest.fn(),
}));

jest.mock('../../../hooks/use-commands', () => ({
	useCommands: jest.fn(),
}));

jest.mock('../../../store', () => ({ STORE_NAME: 'wpce/ai-actions' }));

import { render, screen, fireEvent, act } from '@testing-library/react';
import { useSelect } from '@wordpress/data';
import { useMcpStatus } from '../../../hooks/use-mcp-status';
import { useCommands } from '../../../hooks/use-commands';
import ConnectionStatus from '..';

// MutationObserver stub for jsdom — components use window.MutationObserver.
const OriginalMutationObserver = window.MutationObserver;
window.MutationObserver = class {
	observe() {}
	disconnect() {}
};

function mockUseSelect(stores) {
	useSelect.mockImplementation((selector) => {
		const select = (storeName) => stores[storeName] || {};
		return selector(select);
	});
}

describe('ConnectionStatus', () => {
	afterAll(() => {
		window.MutationObserver = OriginalMutationObserver;
	});

	let footerEl;

	beforeEach(() => {
		jest.clearAllMocks();

		// Create a mock footer element for the portal
		footerEl = document.createElement('div');
		footerEl.className = 'interface-interface-skeleton__footer';
		document.body.appendChild(footerEl);

		useMcpStatus.mockReturnValue({
			mcpConnected: false,
			mcpLastSeenAt: null,
			isLoading: false,
			error: null,
		});

		useCommands.mockReturnValue({
			activeCommand: null,
			isSubmitting: false,
			error: null,
			history: [],
			submit: jest.fn(),
			cancel: jest.fn(),
		});

		mockUseSelect({
			'wpce/ai-actions': {
				getActiveCommand: () => null,
			},
			'core/editor': {
				getCurrentPostId: () => 100,
			},
			core: {
				getEntityRecord: () => null,
			},
		});
	});

	afterEach(() => {
		document.body.removeChild(footerEl);
	});

	it('renders sparkle icon into the footer', async () => {
		await act(async () => render(<ConnectionStatus />));

		const svg = footerEl.querySelector('svg');
		expect(svg).toBeTruthy();
	});

	it('renders grey sparkles when disconnected', async () => {
		await act(async () => render(<ConnectionStatus />));

		const paths = footerEl.querySelectorAll('svg path');
		for (const path of paths) {
			expect(path.getAttribute('fill')).toBe('#949494');
		}
	});

	it('renders orange sparkles when connected', async () => {
		useMcpStatus.mockReturnValue({
			mcpConnected: true,
			mcpLastSeenAt: '2026-03-30T12:00:00Z',
			isLoading: false,
			error: null,
		});

		await act(async () => render(<ConnectionStatus />));

		const paths = footerEl.querySelectorAll('svg path');
		for (const path of paths) {
			expect(path.getAttribute('fill')).toBe('#D97706');
		}
	});

	it('shows popover with "Status: disconnected" on click', async () => {
		await act(async () => render(<ConnectionStatus />));

		const toggle = footerEl.querySelector('.wpce-footer-status-toggle');
		await act(async () => fireEvent.click(toggle));

		expect(screen.getByText('Status: disconnected')).toBeTruthy();
		expect(screen.getByText('Claudaborative Editing')).toBeTruthy();
	});

	it('shows popover with "Status: connected" on click when connected', async () => {
		useMcpStatus.mockReturnValue({
			mcpConnected: true,
			mcpLastSeenAt: '2026-03-30T12:00:00Z',
			isLoading: false,
			error: null,
		});

		await act(async () => render(<ConnectionStatus />));

		const toggle = footerEl.querySelector('.wpce-footer-status-toggle');
		await act(async () => fireEvent.click(toggle));

		expect(screen.getByText('Status: connected')).toBeTruthy();
	});

	it('hides popover on second click', async () => {
		await act(async () => render(<ConnectionStatus />));

		const toggle = footerEl.querySelector('.wpce-footer-status-toggle');
		await act(async () => fireEvent.click(toggle));
		expect(screen.getByText('Status: disconnected')).toBeTruthy();

		await act(async () => fireEvent.click(toggle));
		expect(screen.queryByText('Status: disconnected')).toBeNull();
	});

	it('toggle button has accessible label', async () => {
		await act(async () => render(<ConnectionStatus />));

		const toggle = footerEl.querySelector('.wpce-footer-status-toggle');
		expect(toggle.getAttribute('aria-label')).toBe(
			'Claudaborative Editing status'
		);
	});

	it('shows editing-other-post info in popover', async () => {
		useMcpStatus.mockReturnValue({
			mcpConnected: true,
			mcpLastSeenAt: '2026-03-30T12:00:00Z',
			isLoading: false,
			error: null,
		});

		useCommands.mockReturnValue({
			activeCommand: { id: 1, post_id: 999, status: 'running' },
			isSubmitting: false,
			error: null,
			history: [],
			submit: jest.fn(),
			cancel: jest.fn(),
		});

		mockUseSelect({
			'wpce/ai-actions': {
				getActiveCommand: () => ({
					id: 1,
					post_id: 999,
					status: 'running',
				}),
			},
			'core/editor': {
				getCurrentPostId: () => 100,
			},
			core: {
				getEntityRecord: () => ({
					title: { rendered: 'My Other Post' },
				}),
			},
		});

		await act(async () => render(<ConnectionStatus />));

		const toggle = footerEl.querySelector('.wpce-footer-status-toggle');
		await act(async () => fireEvent.click(toggle));

		expect(screen.getByText('Editing: My Other Post')).toBeTruthy();
	});

	it('shows success snackbar when command completes', async () => {
		useCommands.mockReturnValue({
			activeCommand: {
				id: 42,
				prompt: 'proofread',
				status: 'running',
				post_id: 100,
			},
			isSubmitting: false,
			error: null,
			history: [],
			submit: jest.fn(),
			cancel: jest.fn(),
		});

		const { rerender } = render(<ConnectionStatus />);

		useCommands.mockReturnValue({
			activeCommand: null,
			isSubmitting: false,
			error: null,
			history: [
				{
					id: 42,
					prompt: 'proofread',
					status: 'completed',
					message: 'All done!',
					post_id: 100,
				},
			],
			submit: jest.fn(),
			cancel: jest.fn(),
		});
		rerender(<ConnectionStatus />);

		expect(mockCreateNotice).toHaveBeenCalledWith('success', 'All done!', {
			type: 'snackbar',
		});
	});

	it('shows error snackbar when command fails', async () => {
		useCommands.mockReturnValue({
			activeCommand: {
				id: 42,
				prompt: 'proofread',
				status: 'running',
				post_id: 100,
			},
			isSubmitting: false,
			error: null,
			history: [],
			submit: jest.fn(),
			cancel: jest.fn(),
		});

		const { rerender } = render(<ConnectionStatus />);

		useCommands.mockReturnValue({
			activeCommand: null,
			isSubmitting: false,
			error: null,
			history: [
				{
					id: 42,
					prompt: 'proofread',
					status: 'failed',
					message: null,
					post_id: 100,
				},
			],
			submit: jest.fn(),
			cancel: jest.fn(),
		});
		rerender(<ConnectionStatus />);

		expect(mockCreateNotice).toHaveBeenCalledWith(
			'error',
			'Command failed.',
			{ type: 'snackbar' }
		);
	});

	it('shows human-readable status label for active command', async () => {
		useMcpStatus.mockReturnValue({
			mcpConnected: true,
			mcpLastSeenAt: '2026-03-30T12:00:00Z',
			isLoading: false,
			error: null,
		});

		useCommands.mockReturnValue({
			activeCommand: {
				id: 42,
				prompt: 'proofread',
				status: 'running',
				post_id: 100,
			},
			isSubmitting: false,
			error: null,
			history: [],
			submit: jest.fn(),
			cancel: jest.fn(),
		});

		await act(async () => render(<ConnectionStatus />));

		const toggle = footerEl.querySelector('.wpce-footer-status-toggle');
		await act(async () => fireEvent.click(toggle));

		expect(screen.getByText(/Proofreading/)).toBeTruthy();
	});

	it('shows cancel button for pending command', async () => {
		useMcpStatus.mockReturnValue({
			mcpConnected: true,
			mcpLastSeenAt: '2026-03-30T12:00:00Z',
			isLoading: false,
			error: null,
		});

		const cancel = jest.fn();
		useCommands.mockReturnValue({
			activeCommand: {
				id: 42,
				prompt: 'review',
				status: 'pending',
				post_id: 100,
			},
			isSubmitting: false,
			error: null,
			history: [],
			submit: jest.fn(),
			cancel,
		});

		await act(async () => render(<ConnectionStatus />));

		const toggle = footerEl.querySelector('.wpce-footer-status-toggle');
		await act(async () => fireEvent.click(toggle));

		const cancelBtn = screen.getByText('(cancel)');
		expect(cancelBtn).toBeTruthy();

		await act(async () => fireEvent.click(cancelBtn));
		expect(cancel).toHaveBeenCalledWith(42);
	});

	it('does not show cancel for running command', async () => {
		useMcpStatus.mockReturnValue({
			mcpConnected: true,
			mcpLastSeenAt: '2026-03-30T12:00:00Z',
			isLoading: false,
			error: null,
		});

		useCommands.mockReturnValue({
			activeCommand: {
				id: 42,
				prompt: 'review',
				status: 'running',
				post_id: 100,
			},
			isSubmitting: false,
			error: null,
			history: [],
			submit: jest.fn(),
			cancel: jest.fn(),
		});

		await act(async () => render(<ConnectionStatus />));

		const toggle = footerEl.querySelector('.wpce-footer-status-toggle');
		await act(async () => fireEvent.click(toggle));

		expect(screen.queryByText('(cancel)')).toBeNull();
	});

	it('does not show cancel when disconnected', async () => {
		useCommands.mockReturnValue({
			activeCommand: {
				id: 42,
				prompt: 'review',
				status: 'pending',
				post_id: 100,
			},
			isSubmitting: false,
			error: null,
			history: [],
			submit: jest.fn(),
			cancel: jest.fn(),
		});

		await act(async () => render(<ConnectionStatus />));

		const toggle = footerEl.querySelector('.wpce-footer-status-toggle');
		await act(async () => fireEvent.click(toggle));

		expect(screen.getByText('Status: disconnected')).toBeTruthy();
		expect(screen.queryByText('(cancel)')).toBeNull();
	});

	it('returns null when footer element is not found', async () => {
		document.body.removeChild(footerEl);

		const { container } = render(<ConnectionStatus />);
		expect(container.innerHTML).toBe('');

		// Re-add so afterEach cleanup doesn't fail
		document.body.appendChild(footerEl);
	});
});
