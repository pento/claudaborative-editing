jest.mock('@wordpress/data', () => ({
	useSelect: jest.fn(),
	useDispatch: jest.fn(() => ({ invalidateResolution: jest.fn() })),
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
		Spinner: () => createElement('div', { 'data-testid': 'spinner' }),
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
import QuickActions from '..';

function mockUseSelect(stores) {
	useSelect.mockImplementation((selector) => {
		const select = (storeName) => stores[storeName] || {};
		return selector(select);
	});
}

describe('QuickActions', () => {
	let submit;
	let cancel;

	beforeEach(() => {
		jest.clearAllMocks();

		submit = jest.fn();
		cancel = jest.fn();

		useMcpStatus.mockReturnValue({
			mcpConnected: true,
			mcpLastSeenAt: '2026-03-30T12:00:00Z',
			isLoading: false,
			error: null,
		});

		useCommands.mockReturnValue({
			activeCommand: null,
			isSubmitting: false,
			error: null,
			history: [],
			submit,
			cancel,
		});

		mockUseSelect({
			'core/editor': {
				getCurrentPostId: () => 123,
			},
			core: {
				getEntityRecords: () => null,
			},
			'wpce/ai-actions': {
				getActiveCommand: () => null,
			},
		});
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
		expect(screen.getByText('Leave editorial notes the post')).toBeTruthy();
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

	it('Respond to Notes hidden when no notes', () => {
		render(<QuickActions />);

		expect(screen.queryByText('Respond to Notes')).toBeNull();
	});

	it('Respond to Notes shown when notes exist', () => {
		mockUseSelect({
			'core/editor': {
				getCurrentPostId: () => 123,
			},
			core: {
				getEntityRecords: () => [{ id: 1 }],
			},
			'wpce/ai-actions': {
				getActiveCommand: () => null,
			},
		});

		render(<QuickActions />);

		expect(screen.getByText('Respond to Notes')).toBeTruthy();
	});

	it('shows spinner when command active', () => {
		useCommands.mockReturnValue({
			activeCommand: {
				id: 42,
				prompt: 'proofread',
				status: 'running',
				post_id: 123,
			},
			isSubmitting: false,
			error: null,
			history: [],
			submit,
			cancel,
		});

		render(<QuickActions />);

		expect(screen.getByTestId('spinner')).toBeTruthy();
		expect(screen.getByText('Proofreading\u2026')).toBeTruthy();
	});

	it('shows cancel when command is pending', () => {
		useCommands.mockReturnValue({
			activeCommand: {
				id: 42,
				prompt: 'review',
				status: 'pending',
				post_id: 123,
			},
			isSubmitting: false,
			error: null,
			history: [],
			submit,
			cancel,
		});

		render(<QuickActions />);

		expect(screen.getByText('Cancel')).toBeTruthy();
	});

	it('shows cancel when command is claimed', () => {
		useCommands.mockReturnValue({
			activeCommand: {
				id: 42,
				prompt: 'review',
				status: 'claimed',
				post_id: 123,
			},
			isSubmitting: false,
			error: null,
			history: [],
			submit,
			cancel,
		});

		render(<QuickActions />);

		expect(screen.getByText('Cancel')).toBeTruthy();
	});

	it('does not show cancel when command is running', () => {
		useCommands.mockReturnValue({
			activeCommand: {
				id: 42,
				prompt: 'review',
				status: 'running',
				post_id: 123,
			},
			isSubmitting: false,
			error: null,
			history: [],
			submit,
			cancel,
		});

		render(<QuickActions />);

		expect(screen.queryByText('Cancel')).toBeNull();
	});

	it('click Proofread calls submit and onClose', () => {
		const onClose = jest.fn();
		render(<QuickActions onClose={onClose} />);

		fireEvent.click(screen.getByText('Proofread'));

		expect(submit).toHaveBeenCalledWith('proofread');
		expect(onClose).toHaveBeenCalled();
	});

	it('click Review calls submit and onClose', () => {
		const onClose = jest.fn();
		render(<QuickActions onClose={onClose} />);

		fireEvent.click(screen.getByText('Review'));

		expect(submit).toHaveBeenCalledWith('review');
		expect(onClose).toHaveBeenCalled();
	});

	it('click Cancel calls cancel with command id', () => {
		useCommands.mockReturnValue({
			activeCommand: {
				id: 42,
				prompt: 'review',
				status: 'pending',
				post_id: 123,
			},
			isSubmitting: false,
			error: null,
			history: [],
			submit,
			cancel,
		});

		render(<QuickActions />);

		fireEvent.click(screen.getByText('Cancel'));

		expect(cancel).toHaveBeenCalledWith(42);
	});

	it('shows error message when error exists', () => {
		useCommands.mockReturnValue({
			activeCommand: null,
			isSubmitting: false,
			error: 'Something went wrong',
			history: [],
			submit,
			cancel,
		});

		render(<QuickActions />);

		expect(screen.getByText('Something went wrong')).toBeTruthy();
	});

	it('items disabled when command is active', () => {
		useCommands.mockReturnValue({
			activeCommand: {
				id: 42,
				prompt: 'proofread',
				status: 'running',
				post_id: 123,
			},
			isSubmitting: false,
			error: null,
			history: [],
			submit,
			cancel,
		});

		render(<QuickActions />);

		expect(screen.getByText('Proofread').closest('button').disabled).toBe(
			true
		);
		expect(screen.getByText('Review').closest('button').disabled).toBe(
			true
		);
	});

	it('items disabled when submitting', () => {
		useCommands.mockReturnValue({
			activeCommand: null,
			isSubmitting: true,
			error: null,
			history: [],
			submit,
			cancel,
		});

		render(<QuickActions />);

		expect(screen.getByText('Proofread').closest('button').disabled).toBe(
			true
		);
	});

	it('items disabled when editing other post', () => {
		mockUseSelect({
			'core/editor': {
				getCurrentPostId: () => 123,
			},
			core: {
				getEntityRecords: () => null,
			},
			'wpce/ai-actions': {
				getActiveCommand: () => ({
					id: 1,
					post_id: 999,
					status: 'running',
				}),
			},
		});

		render(<QuickActions />);

		expect(screen.getByText('Proofread').closest('button').disabled).toBe(
			true
		);
	});

	it('click Respond to Notes calls submit', () => {
		mockUseSelect({
			'core/editor': {
				getCurrentPostId: () => 123,
			},
			core: {
				getEntityRecords: () => [{ id: 1 }],
			},
			'wpce/ai-actions': {
				getActiveCommand: () => null,
			},
		});

		render(<QuickActions />);

		fireEvent.click(screen.getByText('Respond to Notes'));

		expect(submit).toHaveBeenCalledWith('respond-to-notes');
	});

	it('shows status label for review prompt', () => {
		useCommands.mockReturnValue({
			activeCommand: {
				id: 42,
				prompt: 'review',
				status: 'running',
				post_id: 123,
			},
			isSubmitting: false,
			error: null,
			history: [],
			submit,
			cancel,
		});

		render(<QuickActions />);

		expect(screen.getByText('Reviewing\u2026')).toBeTruthy();
	});

	it('shows status label for respond-to-notes prompt', () => {
		useCommands.mockReturnValue({
			activeCommand: {
				id: 42,
				prompt: 'respond-to-notes',
				status: 'running',
				post_id: 123,
			},
			isSubmitting: false,
			error: null,
			history: [],
			submit,
			cancel,
		});

		render(<QuickActions />);

		expect(screen.getByText('Responding to notes\u2026')).toBeTruthy();
	});

	it('shows generic status label for unknown prompt', () => {
		useCommands.mockReturnValue({
			activeCommand: {
				id: 42,
				prompt: 'translate',
				status: 'running',
				post_id: 123,
			},
			isSubmitting: false,
			error: null,
			history: [],
			submit,
			cancel,
		});

		render(<QuickActions />);

		expect(screen.getByText('Working\u2026')).toBeTruthy();
	});

	it('shows completion message when command completes', () => {
		const { rerender } = render(<QuickActions />);

		useCommands.mockReturnValue({
			activeCommand: {
				id: 42,
				prompt: 'proofread',
				status: 'running',
				post_id: 123,
			},
			isSubmitting: false,
			error: null,
			history: [],
			submit,
			cancel,
		});
		rerender(<QuickActions />);

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
					post_id: 123,
				},
			],
			submit,
			cancel,
		});
		rerender(<QuickActions />);

		expect(screen.getByText('All done!')).toBeTruthy();
	});

	it('shows failure message when command fails', () => {
		const { rerender } = render(<QuickActions />);

		useCommands.mockReturnValue({
			activeCommand: {
				id: 42,
				prompt: 'proofread',
				status: 'running',
				post_id: 123,
			},
			isSubmitting: false,
			error: null,
			history: [],
			submit,
			cancel,
		});
		rerender(<QuickActions />);

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
					post_id: 123,
				},
			],
			submit,
			cancel,
		});
		rerender(<QuickActions />);

		expect(screen.getByText('Command failed.')).toBeTruthy();
	});

	it('auto-dismisses completion message after timeout', () => {
		jest.useFakeTimers();

		const { rerender } = render(<QuickActions />);

		useCommands.mockReturnValue({
			activeCommand: {
				id: 42,
				prompt: 'proofread',
				status: 'running',
				post_id: 123,
			},
			isSubmitting: false,
			error: null,
			history: [],
			submit,
			cancel,
		});
		rerender(<QuickActions />);

		useCommands.mockReturnValue({
			activeCommand: null,
			isSubmitting: false,
			error: null,
			history: [
				{
					id: 42,
					prompt: 'proofread',
					status: 'completed',
					message: 'Done!',
					post_id: 123,
				},
			],
			submit,
			cancel,
		});
		rerender(<QuickActions />);

		expect(screen.getByText('Done!')).toBeTruthy();

		act(() => {
			jest.advanceTimersByTime(5000);
		});

		expect(screen.queryByText('Done!')).toBeNull();

		jest.useRealTimers();
	});
});
