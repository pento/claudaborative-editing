jest.mock('@wordpress/data', () => ({
	useSelect: jest.fn(),
}));

jest.mock('@wordpress/components', () => ({
	PanelRow: ({ children }) => <div>{children}</div>,
}));

jest.mock('../../../hooks/use-mcp-status', () => ({
	useMcpStatus: jest.fn(),
}));

jest.mock('../../../store', () => ({ STORE_NAME: 'wpce/ai-actions' }));

import { render, screen } from '@testing-library/react';
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
	beforeEach(() => {
		jest.clearAllMocks();

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

	it('shows "Claude not connected" when disconnected', () => {
		render(<ConnectionStatus />);

		expect(screen.getByText('Claude not connected')).toBeTruthy();
	});

	it('shows "Claude connected" when connected', () => {
		useMcpStatus.mockReturnValue({
			mcpConnected: true,
			mcpLastSeenAt: '2026-03-30T12:00:00Z',
			isLoading: false,
			error: null,
		});

		render(<ConnectionStatus />);

		expect(screen.getByText('Claude connected')).toBeTruthy();
	});

	it('shows "Claude is editing another post" when editing other post', () => {
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
				getEntityRecord: () => null,
			},
		});

		render(<ConnectionStatus />);

		expect(screen.getByText('Claude is editing another post')).toBeTruthy();
	});

	it('shows post title when available for other post', () => {
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

		expect(
			screen.getByText('Claude is editing My Other Post')
		).toBeTruthy();
	});

	it('does not show other post message when editing same post', () => {
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
					post_id: 100,
					status: 'running',
				}),
			},
			'core/editor': {
				getCurrentPostId: () => 100,
			},
			core: {
				getEntityRecord: () => null,
			},
		});

		render(<ConnectionStatus />);

		expect(screen.getByText('Claude connected')).toBeTruthy();
		expect(screen.queryByText('Claude is editing another post')).toBeNull();
	});
});
