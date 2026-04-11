const mockCreateNotice = jest.fn();

jest.mock('@wordpress/data', () => ({
	useSelect: jest.fn(),
	useDispatch: jest.fn(() => ({})),
}));

jest.mock('@wordpress/core-data', () => ({ store: { name: 'core' } }));
jest.mock('@wordpress/notices', () => ({ store: { name: 'core/notices' } }));
jest.mock('../../../store', () => ({
	__esModule: true,
	default: { name: 'wpce/ai-actions' },
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
			size: _sz,
			...props
		}: any) =>
			createElement(
				'button',
				{ onClick, className, 'aria-label': label, ...props },
				children
			),
		Popover: ({ children, className }: any) =>
			createElement(
				'div',
				{ 'data-testid': 'popover', className },
				children
			),
		ExternalLink: ({ children, href, className, ...props }: any) =>
			createElement(
				'a',
				{ href, target: '_blank', className, ...props },
				children
			),
		Icon: ({ icon, size }: any) =>
			createElement('span', {
				'data-testid': 'icon',
				'data-icon': icon?.name ?? 'unknown',
				'data-size': size,
			}),
	};
});

jest.mock('@wordpress/icons', () => ({
	cloud: { name: 'cloud' },
	code: { name: 'code' },
}));

jest.mock('../../../hooks/use-mcp-status', () => ({
	useMcpStatus: jest.fn(),
}));

jest.mock('../../../hooks/use-commands', () => ({
	useCommands: jest.fn(),
}));

import { render, screen, fireEvent, act } from '@testing-library/react';
import { useSelect, useDispatch } from '@wordpress/data';
import { store as coreDataStore } from '@wordpress/core-data';
import { store as noticesStore } from '@wordpress/notices';
import aiActionsStore from '../../../store';
import { useMcpStatus } from '../../../hooks/use-mcp-status';
import { useCommands } from '../../../hooks/use-commands';
import ConnectionStatus from '..';

const mockedUseSelect = useSelect as jest.Mock;
const mockedUseDispatch = useDispatch as jest.Mock;
const mockedUseMcpStatus = useMcpStatus as jest.Mock;
const mockedUseCommands = useCommands as jest.Mock;

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
	stores: Map<unknown, Record<string, (...args: any[]) => any>>
) {
	mockedUseSelect.mockImplementation((selector: any) => {
		const select = (s: unknown) => stores.get(s) ?? {};
		return selector(select);
	});
}

describe('ConnectionStatus', () => {
	afterAll(() => {
		window.MutationObserver = OriginalMutationObserver;
	});

	let footerEl: HTMLDivElement;

	beforeEach(() => {
		jest.clearAllMocks();

		mockedUseDispatch.mockImplementation((s: unknown) => {
			if (s === noticesStore) {
				return { createNotice: mockCreateNotice };
			}
			if (s === aiActionsStore) {
				return { submitCommand: jest.fn() };
			}
			return {};
		});

		// Create a mock footer element for the portal
		footerEl = document.createElement('div');
		footerEl.className = 'interface-interface-skeleton__footer';
		document.body.appendChild(footerEl);

		mockedUseMcpStatus.mockReturnValue({
			mcpConnected: false,
			mcpLastSeenAt: null,
			isLoading: false,
			error: null,
		});

		mockedUseCommands.mockReturnValue({
			activeCommand: null,
			isSubmitting: false,
			error: null,
			history: [],
			submit: jest.fn(),
			cancel: jest.fn(),
		});

		mockUseSelect(
			new Map<unknown, Record<string, (...args: any[]) => any>>([
				[aiActionsStore, { getCurrentPostId: () => 100 }],
				[coreDataStore, { getEntityRecord: () => null }],
			])
		);
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
		mockedUseMcpStatus.mockReturnValue({
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

		const toggle = footerEl.querySelector('.wpce-footer-status-toggle')!;
		await act(async () => fireEvent.click(toggle));

		expect(screen.getByText('Status: disconnected')).toBeTruthy();
		expect(screen.getByText('Claudaborative Editing')).toBeTruthy();
	});

	it('shows popover with "Status: connected" on click when connected', async () => {
		mockedUseMcpStatus.mockReturnValue({
			mcpConnected: true,
			mcpLastSeenAt: '2026-03-30T12:00:00Z',
			isLoading: false,
			error: null,
		});

		await act(async () => render(<ConnectionStatus />));

		const toggle = footerEl.querySelector('.wpce-footer-status-toggle')!;
		await act(async () => fireEvent.click(toggle));

		expect(screen.getByText('Status: connected')).toBeTruthy();
	});

	it('hides popover on second click', async () => {
		await act(async () => render(<ConnectionStatus />));

		const toggle = footerEl.querySelector('.wpce-footer-status-toggle')!;
		await act(async () => fireEvent.click(toggle));
		expect(screen.getByText('Status: disconnected')).toBeTruthy();

		await act(async () => fireEvent.click(toggle));
		expect(screen.queryByText('Status: disconnected')).toBeNull();
	});

	it('toggle button has accessible label', async () => {
		await act(async () => render(<ConnectionStatus />));

		const toggle = footerEl.querySelector('.wpce-footer-status-toggle')!;
		expect(toggle.getAttribute('aria-label')).toBe(
			'Claudaborative Editing status'
		);
	});

	it('shows editing-other-post info in popover', async () => {
		mockedUseMcpStatus.mockReturnValue({
			mcpConnected: true,
			mcpLastSeenAt: '2026-03-30T12:00:00Z',
			isLoading: false,
			error: null,
		});

		mockedUseCommands.mockReturnValue({
			activeCommand: { id: 1, post_id: 999, status: 'running' },
			isSubmitting: false,
			error: null,
			history: [],
			submit: jest.fn(),
			cancel: jest.fn(),
		});

		mockUseSelect(
			new Map<unknown, Record<string, (...args: any[]) => any>>([
				[
					aiActionsStore,
					{
						getCurrentPostId: () => 100,
					},
				],
				[
					coreDataStore,
					{
						getEntityRecord: () => ({
							title: { rendered: 'My Other Post' },
						}),
					},
				],
			])
		);

		await act(async () => render(<ConnectionStatus />));

		const toggle = footerEl.querySelector('.wpce-footer-status-toggle')!;
		await act(async () => fireEvent.click(toggle));

		expect(screen.getByText('Editing: My Other Post')).toBeTruthy();
	});

	it('shows success snackbar when command completes', async () => {
		mockedUseCommands.mockReturnValue({
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

		mockedUseCommands.mockReturnValue({
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
		mockedUseCommands.mockReturnValue({
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

		mockedUseCommands.mockReturnValue({
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
		mockedUseMcpStatus.mockReturnValue({
			mcpConnected: true,
			mcpLastSeenAt: '2026-03-30T12:00:00Z',
			isLoading: false,
			error: null,
		});

		mockedUseCommands.mockReturnValue({
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

		const toggle = footerEl.querySelector('.wpce-footer-status-toggle')!;
		await act(async () => fireEvent.click(toggle));

		expect(screen.getByText(/Proofreading/)).toBeTruthy();
	});

	it('shows cancel button for pending command', async () => {
		mockedUseMcpStatus.mockReturnValue({
			mcpConnected: true,
			mcpLastSeenAt: '2026-03-30T12:00:00Z',
			isLoading: false,
			error: null,
		});

		const cancel = jest.fn();
		mockedUseCommands.mockReturnValue({
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

		const toggle = footerEl.querySelector('.wpce-footer-status-toggle')!;
		await act(async () => fireEvent.click(toggle));

		const cancelBtn = screen.getByText('(cancel)');
		expect(cancelBtn).toBeTruthy();

		await act(async () => fireEvent.click(cancelBtn));
		expect(cancel).toHaveBeenCalledWith(42);
	});

	it('shows "Waiting for your input" when command is awaiting_input', async () => {
		mockedUseMcpStatus.mockReturnValue({
			mcpConnected: true,
			mcpLastSeenAt: '2026-03-30T12:00:00Z',
			isLoading: false,
			error: null,
		});

		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 42,
				prompt: 'compose',
				status: 'awaiting_input',
				post_id: 100,
			},
			isSubmitting: false,
			error: null,
			history: [],
			submit: jest.fn(),
			cancel: jest.fn(),
		});

		await act(async () => render(<ConnectionStatus />));

		const toggle = footerEl.querySelector('.wpce-footer-status-toggle')!;
		await act(async () => fireEvent.click(toggle));

		expect(screen.getByText('Waiting for your input')).toBeTruthy();
	});

	it('shows cancel button for awaiting_input command', async () => {
		mockedUseMcpStatus.mockReturnValue({
			mcpConnected: true,
			mcpLastSeenAt: '2026-03-30T12:00:00Z',
			isLoading: false,
			error: null,
		});

		const cancel = jest.fn();
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 42,
				prompt: 'compose',
				status: 'awaiting_input',
				post_id: 100,
			},
			isSubmitting: false,
			error: null,
			history: [],
			submit: jest.fn(),
			cancel,
		});

		await act(async () => render(<ConnectionStatus />));

		const toggle = footerEl.querySelector('.wpce-footer-status-toggle')!;
		await act(async () => fireEvent.click(toggle));

		const cancelBtn = screen.getByText('(cancel)');
		expect(cancelBtn).toBeTruthy();

		await act(async () => fireEvent.click(cancelBtn));
		expect(cancel).toHaveBeenCalledWith(42);
	});

	it('does not show cancel for running command', async () => {
		mockedUseMcpStatus.mockReturnValue({
			mcpConnected: true,
			mcpLastSeenAt: '2026-03-30T12:00:00Z',
			isLoading: false,
			error: null,
		});

		mockedUseCommands.mockReturnValue({
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

		const toggle = footerEl.querySelector('.wpce-footer-status-toggle')!;
		await act(async () => fireEvent.click(toggle));

		expect(screen.queryByText('(cancel)')).toBeNull();
	});

	it('does not show cancel when disconnected', async () => {
		mockedUseCommands.mockReturnValue({
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

		const toggle = footerEl.querySelector('.wpce-footer-status-toggle')!;
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

	it('shows onboarding content when disconnected', async () => {
		await act(async () => render(<ConnectionStatus />));

		const toggle = footerEl.querySelector('.wpce-footer-status-toggle')!;
		await act(async () => fireEvent.click(toggle));

		// Status line should still be present
		expect(screen.getByText('Status: disconnected')).toBeTruthy();

		// Onboarding content should be visible
		expect(
			screen.getByText('Get started with one of these options:')
		).toBeTruthy();
		expect(
			screen.getByText('Sign up at claudaborative.cloud')
		).toBeTruthy();
		expect(
			screen.getByText('npx claudaborative-editing start')
		).toBeTruthy();
	});

	it('does not show onboarding content when connected', async () => {
		mockedUseMcpStatus.mockReturnValue({
			mcpConnected: true,
			mcpLastSeenAt: '2026-03-30T12:00:00Z',
			isLoading: false,
			error: null,
		});

		await act(async () => render(<ConnectionStatus />));

		const toggle = footerEl.querySelector('.wpce-footer-status-toggle')!;
		await act(async () => fireEvent.click(toggle));

		expect(
			screen.queryByText('Get started with one of these options:')
		).toBeNull();
	});

	it('shows "Reconnecting" when previously connected then disconnected', async () => {
		// Start connected
		mockedUseMcpStatus.mockReturnValue({
			mcpConnected: true,
			mcpLastSeenAt: '2026-03-30T12:00:00Z',
			isLoading: false,
			error: null,
		});

		const { rerender } = render(<ConnectionStatus />);

		// Transition to disconnected
		mockedUseMcpStatus.mockReturnValue({
			mcpConnected: false,
			mcpLastSeenAt: null,
			isLoading: false,
			error: null,
		});

		await act(async () => rerender(<ConnectionStatus />));

		const toggle = footerEl.querySelector('.wpce-footer-status-toggle')!;
		await act(async () => fireEvent.click(toggle));

		expect(screen.getByText('Reconnecting\u2026')).toBeTruthy();

		// Onboarding should NOT be shown during reconnection
		expect(
			screen.queryByText('Get started with one of these options:')
		).toBeNull();
	});

	it('does not show "Reconnecting" on first load when never connected', async () => {
		await act(async () => render(<ConnectionStatus />));

		const toggle = footerEl.querySelector('.wpce-footer-status-toggle')!;
		await act(async () => fireEvent.click(toggle));

		expect(screen.queryByText('Reconnecting\u2026')).toBeNull();
	});

	it('popover has onboarding modifier class when disconnected', async () => {
		await act(async () => render(<ConnectionStatus />));

		const toggle = footerEl.querySelector('.wpce-footer-status-toggle')!;
		await act(async () => fireEvent.click(toggle));

		const tooltip = screen
			.getByTestId('popover')
			.querySelector('.wpce-footer-status-tooltip-onboarding');
		expect(tooltip).toBeTruthy();
	});
});
