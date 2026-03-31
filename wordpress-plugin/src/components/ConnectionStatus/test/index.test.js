jest.mock('@wordpress/data', () => ({
	useSelect: jest.fn(),
}));

jest.mock('@wordpress/components', () => {
	const { createElement } = require('react');
	return {
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

jest.mock('../../../store', () => ({ STORE_NAME: 'wpce/ai-actions' }));

import { render, screen, fireEvent } from '@testing-library/react';
import { useSelect } from '@wordpress/data';
import { useMcpStatus } from '../../../hooks/use-mcp-status';
import ConnectionStatus from '..';

function mockUseSelect(stores) {
	useSelect.mockImplementation((selector) => {
		const select = (storeName) => stores[storeName] || {};
		return selector(select);
	});
}

describe('ConnectionStatus', () => {
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

	it('renders sparkle icon into the footer', () => {
		render(<ConnectionStatus />);

		const svg = footerEl.querySelector('svg');
		expect(svg).toBeTruthy();
	});

	it('renders grey sparkles when disconnected', () => {
		render(<ConnectionStatus />);

		const paths = footerEl.querySelectorAll('svg path');
		for (const path of paths) {
			expect(path.getAttribute('fill')).toBe('#949494');
		}
	});

	it('renders orange sparkles when connected', () => {
		useMcpStatus.mockReturnValue({
			mcpConnected: true,
			mcpLastSeenAt: '2026-03-30T12:00:00Z',
			isLoading: false,
			error: null,
		});

		render(<ConnectionStatus />);

		const paths = footerEl.querySelectorAll('svg path');
		for (const path of paths) {
			expect(path.getAttribute('fill')).toBe('#D97706');
		}
	});

	it('shows popover with "Status: disconnected" on hover', () => {
		render(<ConnectionStatus />);

		const statusEl = footerEl.querySelector('.wpce-footer-status');
		fireEvent.mouseEnter(statusEl);

		expect(screen.getByText('Status: disconnected')).toBeTruthy();
		expect(screen.getByText('Claudaborative Editing')).toBeTruthy();
	});

	it('shows popover with "Status: connected" on hover when connected', () => {
		useMcpStatus.mockReturnValue({
			mcpConnected: true,
			mcpLastSeenAt: '2026-03-30T12:00:00Z',
			isLoading: false,
			error: null,
		});

		render(<ConnectionStatus />);

		const statusEl = footerEl.querySelector('.wpce-footer-status');
		fireEvent.mouseEnter(statusEl);

		expect(screen.getByText('Status: connected')).toBeTruthy();
	});

	it('hides popover on mouse leave', () => {
		render(<ConnectionStatus />);

		const statusEl = footerEl.querySelector('.wpce-footer-status');
		fireEvent.mouseEnter(statusEl);
		expect(screen.getByText('Status: disconnected')).toBeTruthy();

		fireEvent.mouseLeave(statusEl);
		expect(screen.queryByText('Status: disconnected')).toBeNull();
	});

	it('shows editing-other-post info in popover', () => {
		useMcpStatus.mockReturnValue({
			mcpConnected: true,
			mcpLastSeenAt: '2026-03-30T12:00:00Z',
			isLoading: false,
			error: null,
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

		render(<ConnectionStatus />);

		const statusEl = footerEl.querySelector('.wpce-footer-status');
		fireEvent.mouseEnter(statusEl);

		expect(screen.getByText('Editing: My Other Post')).toBeTruthy();
	});

	it('returns null when footer element is not found', () => {
		document.body.removeChild(footerEl);

		const { container } = render(<ConnectionStatus />);
		expect(container.innerHTML).toBe('');

		// Re-add so afterEach cleanup doesn't fail
		document.body.appendChild(footerEl);
	});
});
