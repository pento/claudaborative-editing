// jsdom does not implement scrollIntoView
Element.prototype.scrollIntoView = jest.fn();

// jsdom does not implement PointerEvent. MouseEvent is a close-enough
// substitute for the pointer-based resize-handle tests: both carry clientX
// and dispatch the same way through addEventListener('pointermove', ...).
if (typeof (window as any).PointerEvent === 'undefined') {
	(window as any).PointerEvent = window.MouseEvent;
}

// jsdom does not implement the pointer-capture API. The drag handler calls
// these to keep pointermove flowing while the cursor is over Gutenberg's
// iframe; stub them so tests don't throw.
{
	const proto = Element.prototype as unknown as Record<string, unknown>;
	if (typeof proto.setPointerCapture !== 'function') {
		proto.setPointerCapture = function () {};
		proto.releasePointerCapture = function () {};
		proto.hasPointerCapture = function () {
			return false;
		};
	}
}

jest.mock('@wordpress/i18n', () => ({
	__: jest.fn((str: string) => str),
}));

jest.mock('@wordpress/editor', () => {
	const { createElement } = require('react');
	return {
		// Wrap children in the same ancestor chain Gutenberg renders so
		// useResizableSidebar's closest() lookups for all three ancestors
		// (`.interface-interface-skeleton__body`, the skeleton sidebar, and
		// the complementary area) succeed in jsdom.
		PluginSidebar: ({ children, title }: any) =>
			createElement(
				'div',
				{ className: 'interface-interface-skeleton__body' },
				createElement(
					'div',
					{ className: 'interface-interface-skeleton__sidebar' },
					createElement(
						'div',
						{ className: 'interface-complementary-area' },
						createElement(
							'div',
							{
								'data-testid': 'plugin-sidebar',
								'data-title': title,
							},
							children
						)
					)
				)
			),
	};
});

jest.mock('@wordpress/data', () => ({
	useSelect: jest.fn(),
	useDispatch: jest.fn(() => ({})),
}));

jest.mock('@wordpress/notices', () => ({ store: { name: 'core/notices' } }));

jest.mock('../../../store', () => ({
	__esModule: true,
	default: { name: 'wpce/ai-actions' },
}));

jest.mock('@wordpress/components', () => {
	const { createElement, forwardRef } = require('react');
	return {
		Button: ({
			children,
			onClick,
			disabled,
			isBusy: _isBusy,
			variant: _variant,
			isDestructive: _isDestructive,
			...props
		}: any) =>
			createElement('button', { onClick, disabled, ...props }, children),
		TextareaControl: forwardRef(
			(
				{
					value,
					onChange,
					placeholder,
					rows,
					onKeyDown,
					disabled,
					__nextHasNoMarginBottom: _,
					...props
				}: any,
				ref: any
			) =>
				createElement('textarea', {
					ref,
					value,
					onChange: (e: any) => onChange(e.target.value),
					placeholder,
					rows,
					onKeyDown,
					disabled,
					'data-testid': 'conversation-textarea',
					...props,
				})
		),
	};
});

jest.mock('../../../hooks/use-commands', () => ({
	useCommands: jest.fn(),
}));

jest.mock('../../../utils/command-i18n', () => ({
	getCommandLabel: jest.fn((slug: string) => {
		const labels: Record<string, string> = {
			compose: 'Compose',
			proofread: 'Proofread',
			review: 'Review',
		};
		return labels[slug] ?? slug;
	}),
}));

import { render, screen, fireEvent, act } from '@testing-library/react';
import { useSelect, useDispatch } from '@wordpress/data';
import { useCommands } from '../../../hooks/use-commands';
import ConversationPanel from '..';

const mockedUseSelect = useSelect as jest.Mock;
const mockedUseDispatch = useDispatch as jest.Mock;
const mockedUseCommands = useCommands as jest.Mock;

import aiActionsStore from '../../../store';

function mockUseSelect(
	stores: Map<unknown, Record<string, (...args: any[]) => any>>
) {
	mockedUseSelect.mockImplementation((selector: any) => {
		const select = (s: unknown) => stores.get(s) ?? {};
		return selector(select);
	});
}

describe('ConversationPanel', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		window.localStorage.clear();

		mockedUseDispatch.mockImplementation((storeNameOrDescriptor?: any) => {
			if (
				storeNameOrDescriptor === 'core/interface' ||
				storeNameOrDescriptor?.name === 'core/interface'
			) {
				return {
					enableComplementaryArea: jest.fn(),
					disableComplementaryArea: jest.fn(),
				};
			}
			return { createNotice: jest.fn() };
		});

		mockUseSelect(
			new Map<unknown, Record<string, (...args: any[]) => any>>([
				[aiActionsStore, { getCurrentPostId: () => 100 }],
				[
					'core/interface',
					{
						getActiveComplementaryArea: () =>
							'claudaborative-editing-conversation/conversation',
					},
				],
			])
		);

		mockedUseCommands.mockReturnValue({
			activeCommand: null,
			isResponding: false,
			respondToCommand: jest.fn(),
			cancel: jest.fn(),
		});
	});

	it('returns null when there is no active command', () => {
		const { container } = render(<ConversationPanel />);
		expect(container.innerHTML).toBe('');
	});

	it('returns null when a non-conversational command is running without conversation data', () => {
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 1,
				prompt: 'proofread',
				status: 'running',
				post_id: 100,
				result_data: null,
			},
			isResponding: false,
			respondToCommand: jest.fn(),
			cancel: jest.fn(),
		});

		const { container } = render(<ConversationPanel />);
		expect(container.innerHTML).toBe('');
	});

	it('opens immediately for a pending compose command', () => {
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 1,
				prompt: 'compose',
				status: 'pending',
				post_id: 100,
				result_data: null,
			},
			isResponding: false,
			respondToCommand: jest.fn(),
			cancel: jest.fn(),
		});

		render(<ConversationPanel />);

		// Panel mounts with the processing indicator visible before the MCP
		// server has even picked up the command.
		expect(screen.getByTestId('plugin-sidebar')).toBeTruthy();
		expect(screen.getByText('Reading\u2026')).toBeTruthy();
		expect(screen.queryByTestId('conversation-textarea')).toBeNull();
	});

	it('opens immediately for a running compose command even without conversation data', () => {
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 1,
				prompt: 'compose',
				status: 'running',
				post_id: 100,
				result_data: null,
			},
			isResponding: false,
			respondToCommand: jest.fn(),
			cancel: jest.fn(),
		});

		render(<ConversationPanel />);

		// Panel mounts with the processing indicator visible while we wait
		// for the MCP server's first message.
		expect(screen.getByTestId('plugin-sidebar')).toBeTruthy();
		expect(screen.getByText('Reading\u2026')).toBeTruthy();
		// No awaiting-input input area yet.
		expect(screen.queryByTestId('conversation-textarea')).toBeNull();
	});

	it('renders message history when command is awaiting_input with messages', () => {
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 1,
				prompt: 'compose',
				status: 'awaiting_input',
				post_id: 100,
				result_data: {
					messages: [
						{
							role: 'assistant',
							content: 'What is the topic?',
							timestamp: '2026-04-06T10:00:00Z',
						},
						{
							role: 'user',
							content: 'I want to write about testing.',
							timestamp: '2026-04-06T10:01:00Z',
						},
					],
					input_prompt: 'Tell me more...',
				},
			},
			isResponding: false,
			respondToCommand: jest.fn(),
			cancel: jest.fn(),
		});

		render(<ConversationPanel />);

		expect(screen.getByText('What is the topic?')).toBeTruthy();
		expect(screen.getByText('I want to write about testing.')).toBeTruthy();
	});

	it('shows the command label in the header', () => {
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 1,
				prompt: 'compose',
				status: 'awaiting_input',
				post_id: 100,
				result_data: {
					messages: [
						{
							role: 'assistant',
							content: 'Hello',
							timestamp: '2026-04-06T10:00:00Z',
						},
					],
				},
			},
			isResponding: false,
			respondToCommand: jest.fn(),
			cancel: jest.fn(),
		});

		render(<ConversationPanel />);
		const sidebar = screen.getByTestId('plugin-sidebar');
		expect(sidebar.getAttribute('data-title')).toBe('Compose');
	});

	it('shows the input textarea with placeholder from input_prompt', () => {
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 1,
				prompt: 'compose',
				status: 'awaiting_input',
				post_id: 100,
				result_data: {
					messages: [
						{
							role: 'assistant',
							content: 'Hello',
							timestamp: '2026-04-06T10:00:00Z',
						},
					],
					input_prompt: 'Describe your idea...',
				},
			},
			isResponding: false,
			respondToCommand: jest.fn(),
			cancel: jest.fn(),
		});

		render(<ConversationPanel />);

		const textarea = screen.getByTestId('conversation-textarea');
		expect(textarea).toBeTruthy();
		expect(textarea.getAttribute('placeholder')).toBe(
			'Describe your idea...'
		);
	});

	it('shows default placeholder when input_prompt is not provided', () => {
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 1,
				prompt: 'compose',
				status: 'awaiting_input',
				post_id: 100,
				result_data: {
					messages: [
						{
							role: 'assistant',
							content: 'Hello',
							timestamp: '2026-04-06T10:00:00Z',
						},
					],
				},
			},
			isResponding: false,
			respondToCommand: jest.fn(),
			cancel: jest.fn(),
		});

		render(<ConversationPanel />);

		const textarea = screen.getByTestId('conversation-textarea');
		expect(textarea.getAttribute('placeholder')).toBe(
			'Type a response\u2026'
		);
	});

	it('shows Send and Cancel buttons when awaiting_input', () => {
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 1,
				prompt: 'compose',
				status: 'awaiting_input',
				post_id: 100,
				result_data: {
					messages: [
						{
							role: 'assistant',
							content: 'Hello',
							timestamp: '2026-04-06T10:00:00Z',
						},
					],
				},
			},
			isResponding: false,
			respondToCommand: jest.fn(),
			cancel: jest.fn(),
		});

		render(<ConversationPanel />);

		expect(screen.getByText('Send')).toBeTruthy();
		expect(screen.getByText('Cancel')).toBeTruthy();
	});

	it('hides input area when command is running with conversation data', () => {
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 1,
				prompt: 'compose',
				status: 'running',
				post_id: 100,
				result_data: {
					messages: [
						{
							role: 'assistant',
							content: 'What is the topic?',
							timestamp: '2026-04-06T10:00:00Z',
						},
						{
							role: 'user',
							content: 'Testing practices',
							timestamp: '2026-04-06T10:01:00Z',
						},
					],
				},
			},
			isResponding: false,
			respondToCommand: jest.fn(),
			cancel: jest.fn(),
		});

		render(<ConversationPanel />);

		// Messages should still be visible
		expect(screen.getByText('What is the topic?')).toBeTruthy();
		expect(screen.getByText('Testing practices')).toBeTruthy();

		// Input area should not be rendered
		expect(screen.queryByTestId('conversation-textarea')).toBeNull();
		expect(screen.queryByText('Send')).toBeNull();
		expect(screen.queryByText('Cancel')).toBeNull();
	});

	it('shows Processing indicator when running with conversation data', () => {
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 1,
				prompt: 'compose',
				status: 'running',
				post_id: 100,
				result_data: {
					messages: [
						{
							role: 'assistant',
							content: 'Got it.',
							timestamp: '2026-04-06T10:00:00Z',
						},
					],
				},
			},
			isResponding: false,
			respondToCommand: jest.fn(),
			cancel: jest.fn(),
		});

		render(<ConversationPanel />);

		// First phrase in the rotating list.
		expect(screen.getByText('Reading\u2026')).toBeTruthy();
	});

	it('cycles the processing indicator through its phrases', () => {
		jest.useFakeTimers();
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 1,
				prompt: 'compose',
				status: 'running',
				post_id: 100,
				result_data: null,
			},
			isResponding: false,
			respondToCommand: jest.fn(),
			cancel: jest.fn(),
		});

		render(<ConversationPanel />);

		expect(screen.getByText('Reading\u2026')).toBeTruthy();

		act(() => {
			jest.advanceTimersByTime(2000);
		});
		expect(screen.getByText('Thinking\u2026')).toBeTruthy();

		act(() => {
			jest.advanceTimersByTime(2000);
		});
		expect(screen.getByText('Conjugating\u2026')).toBeTruthy();

		jest.useRealTimers();
	});

	it('does not show Processing indicator when awaiting_input', () => {
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 1,
				prompt: 'compose',
				status: 'awaiting_input',
				post_id: 100,
				result_data: {
					messages: [
						{
							role: 'assistant',
							content: 'Hello',
							timestamp: '2026-04-06T10:00:00Z',
						},
					],
				},
			},
			isResponding: false,
			respondToCommand: jest.fn(),
			cancel: jest.fn(),
		});

		render(<ConversationPanel />);

		expect(screen.queryByText('Reading\u2026')).toBeNull();
		expect(screen.queryByText('Thinking\u2026')).toBeNull();
	});

	it('shows Approve outline button when planReady is true', () => {
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 1,
				prompt: 'compose',
				status: 'awaiting_input',
				post_id: 100,
				result_data: {
					messages: [
						{
							role: 'assistant',
							content: 'Here is the outline.',
							timestamp: '2026-04-06T10:00:00Z',
						},
					],
					planReady: true,
				},
			},
			isResponding: false,
			respondToCommand: jest.fn(),
			cancel: jest.fn(),
		});

		render(<ConversationPanel />);

		expect(screen.getByText('Approve outline')).toBeTruthy();
	});

	it('does not show Approve outline button when planReady is false', () => {
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 1,
				prompt: 'compose',
				status: 'awaiting_input',
				post_id: 100,
				result_data: {
					messages: [
						{
							role: 'assistant',
							content: 'Hello',
							timestamp: '2026-04-06T10:00:00Z',
						},
					],
					planReady: false,
				},
			},
			isResponding: false,
			respondToCommand: jest.fn(),
			cancel: jest.fn(),
		});

		render(<ConversationPanel />);

		expect(screen.queryByText('Approve outline')).toBeNull();
	});

	it('falls back to command.message when result_data.messages is empty', () => {
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 1,
				prompt: 'compose',
				status: 'awaiting_input',
				post_id: 100,
				message: 'Fallback question from message field',
				result_data: {
					messages: [],
				},
			},
			isResponding: false,
			respondToCommand: jest.fn(),
			cancel: jest.fn(),
		});

		render(<ConversationPanel />);

		expect(
			screen.getByText('Fallback question from message field')
		).toBeTruthy();
	});

	it('falls back to command.message when result_data has no messages array', () => {
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 1,
				prompt: 'compose',
				status: 'awaiting_input',
				post_id: 100,
				message: 'Question without messages array',
				result_data: null,
			},
			isResponding: false,
			respondToCommand: jest.fn(),
			cancel: jest.fn(),
		});

		render(<ConversationPanel />);

		expect(
			screen.getByText('Question without messages array')
		).toBeTruthy();
	});

	it('handleSend clears input and calls respondToCommand', () => {
		const respondToCommand = jest.fn().mockResolvedValue(undefined);
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 1,
				prompt: 'compose',
				status: 'awaiting_input',
				post_id: 100,
				result_data: {
					messages: [
						{
							role: 'assistant',
							content: 'Hello',
							timestamp: '2026-04-06T10:00:00Z',
						},
					],
				},
			},
			isResponding: false,
			respondToCommand,
			cancel: jest.fn(),
		});

		render(<ConversationPanel />);

		const textarea = screen.getByTestId(
			'conversation-textarea'
		) as HTMLTextAreaElement;

		// Type something into the textarea.
		fireEvent.change(textarea, { target: { value: 'My response text' } });
		expect(textarea.value).toBe('My response text');

		// Click Send.
		fireEvent.click(screen.getByText('Send'));

		// respondToCommand should have been called.
		expect(respondToCommand).toHaveBeenCalledWith(1, 'My response text');

		// The textarea should be cleared.
		expect(textarea.value).toBe('');
	});

	it('handleKeyDown on Enter triggers send', () => {
		const respondToCommand = jest.fn().mockResolvedValue(undefined);
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 1,
				prompt: 'compose',
				status: 'awaiting_input',
				post_id: 100,
				result_data: {
					messages: [
						{
							role: 'assistant',
							content: 'Hello',
							timestamp: '2026-04-06T10:00:00Z',
						},
					],
				},
			},
			isResponding: false,
			respondToCommand,
			cancel: jest.fn(),
		});

		render(<ConversationPanel />);

		const textarea = screen.getByTestId(
			'conversation-textarea'
		) as HTMLTextAreaElement;

		// Type something.
		fireEvent.change(textarea, { target: { value: 'Enter response' } });

		// Press Enter (without Shift).
		fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

		expect(respondToCommand).toHaveBeenCalledWith(1, 'Enter response');
		expect(textarea.value).toBe('');
	});

	it('handleKeyDown on Shift+Enter does not trigger send', () => {
		const respondToCommand = jest.fn().mockResolvedValue(undefined);
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 1,
				prompt: 'compose',
				status: 'awaiting_input',
				post_id: 100,
				result_data: {
					messages: [
						{
							role: 'assistant',
							content: 'Hello',
							timestamp: '2026-04-06T10:00:00Z',
						},
					],
				},
			},
			isResponding: false,
			respondToCommand,
			cancel: jest.fn(),
		});

		render(<ConversationPanel />);

		const textarea = screen.getByTestId(
			'conversation-textarea'
		) as HTMLTextAreaElement;

		fireEvent.change(textarea, { target: { value: 'Multiline text' } });

		// Press Shift+Enter — should NOT send.
		fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });

		expect(respondToCommand).not.toHaveBeenCalled();
	});

	it('focuses the textarea when entering awaiting_input state', () => {
		jest.useFakeTimers();

		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 1,
				prompt: 'compose',
				status: 'awaiting_input',
				post_id: 100,
				result_data: {
					messages: [
						{
							role: 'assistant',
							content: 'Hello',
							timestamp: '2026-04-06T10:00:00Z',
						},
					],
				},
			},
			isResponding: false,
			respondToCommand: jest.fn(),
			cancel: jest.fn(),
		});

		render(<ConversationPanel />);

		const textarea = screen.getByTestId('conversation-textarea');
		const focusSpy = jest.spyOn(textarea, 'focus');

		jest.advanceTimersByTime(100);

		expect(focusSpy).toHaveBeenCalled();

		focusSpy.mockRestore();
		jest.useRealTimers();
	});

	it('does not call respondToCommand when input is empty', () => {
		const respondToCommand = jest.fn().mockResolvedValue(undefined);
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 1,
				prompt: 'compose',
				status: 'awaiting_input',
				post_id: 100,
				result_data: {
					messages: [
						{
							role: 'assistant',
							content: 'Hello',
							timestamp: '2026-04-06T10:00:00Z',
						},
					],
				},
			},
			isResponding: false,
			respondToCommand,
			cancel: jest.fn(),
		});

		render(<ConversationPanel />);

		// Click Send without typing anything.
		fireEvent.click(screen.getByText('Send'));

		expect(respondToCommand).not.toHaveBeenCalled();
	});

	it('does not call respondToCommand when isResponding is true', () => {
		const respondToCommand = jest.fn().mockResolvedValue(undefined);
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 1,
				prompt: 'compose',
				status: 'awaiting_input',
				post_id: 100,
				result_data: {
					messages: [
						{
							role: 'assistant',
							content: 'Hello',
							timestamp: '2026-04-06T10:00:00Z',
						},
					],
				},
			},
			isResponding: true,
			respondToCommand,
			cancel: jest.fn(),
		});

		render(<ConversationPanel />);

		const textarea = screen.getByTestId(
			'conversation-textarea'
		) as HTMLTextAreaElement;

		// Type text so the empty-input guard is not the reason for blocking.
		fireEvent.change(textarea, { target: { value: 'Some text' } });

		// Click Send — should be blocked by isResponding guard.
		fireEvent.click(screen.getByText('Send'));

		expect(respondToCommand).not.toHaveBeenCalled();
	});

	it('calls createNotice when respondToCommand rejects on send', async () => {
		const mockCreateNotice = jest.fn();
		mockedUseDispatch.mockImplementation((storeNameOrDescriptor?: any) => {
			if (
				storeNameOrDescriptor === 'core/interface' ||
				storeNameOrDescriptor?.name === 'core/interface'
			) {
				return { enableComplementaryArea: jest.fn() };
			}
			return { createNotice: mockCreateNotice };
		});

		const respondToCommand = jest.fn().mockRejectedValue(new Error('fail'));
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 1,
				prompt: 'compose',
				status: 'awaiting_input',
				post_id: 100,
				result_data: {
					messages: [
						{
							role: 'assistant',
							content: 'Hello',
							timestamp: '2026-04-06T10:00:00Z',
						},
					],
				},
			},
			isResponding: false,
			respondToCommand,
			cancel: jest.fn(),
		});

		render(<ConversationPanel />);

		const textarea = screen.getByTestId(
			'conversation-textarea'
		) as HTMLTextAreaElement;
		fireEvent.change(textarea, { target: { value: 'My message' } });
		fireEvent.click(screen.getByText('Send'));

		// Flush microtasks so the catch handler runs.
		await new Promise(process.nextTick);

		expect(mockCreateNotice).toHaveBeenCalledWith(
			'error',
			'Failed to send response.',
			{ type: 'snackbar' }
		);
	});

	it('calls respondToCommand with approve when Approve outline is clicked', () => {
		const respondToCommand = jest.fn().mockResolvedValue(undefined);
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 1,
				prompt: 'compose',
				status: 'awaiting_input',
				post_id: 100,
				result_data: {
					messages: [
						{
							role: 'assistant',
							content: 'Here is the outline.',
							timestamp: '2026-04-06T10:00:00Z',
						},
					],
					planReady: true,
				},
			},
			isResponding: false,
			respondToCommand,
			cancel: jest.fn(),
		});

		render(<ConversationPanel />);

		fireEvent.click(screen.getByText('Approve outline'));

		expect(respondToCommand).toHaveBeenCalledWith(1, 'approve');
	});

	it('calls createNotice when respondToCommand rejects on approve', async () => {
		const mockCreateNotice = jest.fn();
		mockedUseDispatch.mockImplementation((storeNameOrDescriptor?: any) => {
			if (
				storeNameOrDescriptor === 'core/interface' ||
				storeNameOrDescriptor?.name === 'core/interface'
			) {
				return { enableComplementaryArea: jest.fn() };
			}
			return { createNotice: mockCreateNotice };
		});

		const respondToCommand = jest.fn().mockRejectedValue(new Error('fail'));
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 1,
				prompt: 'compose',
				status: 'awaiting_input',
				post_id: 100,
				result_data: {
					messages: [
						{
							role: 'assistant',
							content: 'Here is the outline.',
							timestamp: '2026-04-06T10:00:00Z',
						},
					],
					planReady: true,
				},
			},
			isResponding: false,
			respondToCommand,
			cancel: jest.fn(),
		});

		render(<ConversationPanel />);

		fireEvent.click(screen.getByText('Approve outline'));

		// Flush microtasks so the catch handler runs.
		await new Promise(process.nextTick);

		expect(mockCreateNotice).toHaveBeenCalledWith(
			'error',
			'Failed to approve outline.',
			{ type: 'snackbar' }
		);
	});

	it('closes the sidebar when Cancel is clicked so the slide-out animation plays', () => {
		const disableComplementaryArea = jest.fn();
		mockedUseDispatch.mockImplementation((storeNameOrDescriptor?: any) => {
			if (
				storeNameOrDescriptor === 'core/interface' ||
				storeNameOrDescriptor?.name === 'core/interface'
			) {
				return {
					enableComplementaryArea: jest.fn(),
					disableComplementaryArea,
				};
			}
			return { createNotice: jest.fn() };
		});

		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 7,
				prompt: 'compose',
				status: 'awaiting_input',
				post_id: 100,
				result_data: {
					messages: [
						{
							role: 'assistant',
							content: 'Hello',
							timestamp: '2026-04-06T10:00:00Z',
						},
					],
				},
			},
			isResponding: false,
			respondToCommand: jest.fn(),
			cancel: jest.fn(),
		});

		render(<ConversationPanel />);

		fireEvent.click(screen.getByText('Cancel'));

		expect(disableComplementaryArea).toHaveBeenCalledWith('core');
	});

	it('cancels the in-flight command when the sidebar becomes inactive', () => {
		const cancel = jest.fn();
		const activeCommand = {
			id: 7,
			prompt: 'compose',
			status: 'running',
			post_id: 100,
			result_data: null,
		};
		mockedUseCommands.mockReturnValue({
			activeCommand,
			isResponding: false,
			respondToCommand: jest.fn(),
			cancel,
		});

		const { rerender } = render(<ConversationPanel />);

		// Sidebar was open and command was in-flight — no cancel yet.
		expect(cancel).not.toHaveBeenCalled();

		// Flip the active complementary area to something else, mimicking
		// the close button or switching to the block inspector.
		mockUseSelect(
			new Map<unknown, Record<string, (...args: any[]) => any>>([
				[aiActionsStore, { getCurrentPostId: () => 100 }],
				[
					'core/interface',
					{
						getActiveComplementaryArea: () => 'edit-post/document',
					},
				],
			])
		);

		rerender(<ConversationPanel />);

		expect(cancel).toHaveBeenCalledWith(7);
	});

	it('cancels an awaiting_input command when the sidebar becomes inactive', () => {
		const cancel = jest.fn();
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 9,
				prompt: 'compose',
				status: 'awaiting_input',
				post_id: 100,
				result_data: {
					messages: [
						{
							role: 'assistant',
							content: 'What is the topic?',
							timestamp: '2026-04-06T10:00:00Z',
						},
					],
				},
			},
			isResponding: false,
			respondToCommand: jest.fn(),
			cancel,
		});

		const { rerender } = render(<ConversationPanel />);

		expect(cancel).not.toHaveBeenCalled();

		// User clicks close/Cancel — sidebar becomes inactive.
		mockUseSelect(
			new Map<unknown, Record<string, (...args: any[]) => any>>([
				[aiActionsStore, { getCurrentPostId: () => 100 }],
				[
					'core/interface',
					{
						getActiveComplementaryArea: () => 'edit-post/document',
					},
				],
			])
		);

		rerender(<ConversationPanel />);

		expect(cancel).toHaveBeenCalledWith(9);
	});

	it('does not cancel a terminal command when the sidebar becomes inactive', () => {
		const cancel = jest.fn();
		mockedUseCommands.mockReturnValue({
			activeCommand: {
				id: 11,
				prompt: 'compose',
				status: 'completed',
				post_id: 100,
				result_data: null,
			},
			isResponding: false,
			respondToCommand: jest.fn(),
			cancel,
		});

		const { rerender } = render(<ConversationPanel />);

		mockUseSelect(
			new Map<unknown, Record<string, (...args: any[]) => any>>([
				[aiActionsStore, { getCurrentPostId: () => 100 }],
				[
					'core/interface',
					{
						getActiveComplementaryArea: () => 'edit-post/document',
					},
				],
			])
		);

		rerender(<ConversationPanel />);

		expect(cancel).not.toHaveBeenCalled();
	});

	describe('resize', () => {
		const STORAGE_KEY = 'wpce:conversation-sidebar-width';

		function mountWithAwaitingInput() {
			mockedUseCommands.mockReturnValue({
				activeCommand: {
					id: 1,
					prompt: 'compose',
					status: 'awaiting_input',
					post_id: 100,
					result_data: {
						messages: [
							{
								role: 'assistant',
								content: 'Hello',
								timestamp: '2026-04-06T10:00:00Z',
							},
						],
					},
				},
				isResponding: false,
				respondToCommand: jest.fn(),
				cancel: jest.fn(),
			});

			return render(<ConversationPanel />);
		}

		function getAncestor(): HTMLElement {
			// The handle is portalled into
			// `.interface-interface-skeleton__body`, so walk the DOM
			// directly rather than via the handle.
			const ancestor = document.querySelector(
				'.interface-complementary-area'
			) as HTMLElement | null;
			if (!ancestor) {
				throw new Error('Ancestor not found');
			}
			return ancestor;
		}

		it('renders a resize handle when the panel is visible', () => {
			mountWithAwaitingInput();

			const handle = screen.getByRole('separator');
			expect(handle).toBeTruthy();
			expect(handle.getAttribute('aria-orientation')).toBe('vertical');
			expect(handle.getAttribute('aria-label')).toBe('Resize sidebar');
		});

		it('applies the default width to the complementary area on mount', () => {
			mountWithAwaitingInput();

			const ancestor = getAncestor();
			expect(ancestor.style.width).toBe('280px');
			expect(ancestor.style.flexBasis).toBe('280px');
			expect(ancestor.style.position).toBe('relative');
		});

		it('does not apply width when a different sidebar is active', () => {
			mockUseSelect(
				new Map<unknown, Record<string, (...args: any[]) => any>>([
					[aiActionsStore, { getCurrentPostId: () => 100 }],
					[
						'core/interface',
						{
							getActiveComplementaryArea: () =>
								'edit-post/document',
						},
					],
				])
			);

			mountWithAwaitingInput();

			// When another sidebar is active, the resize handle is not
			// portalled into the ancestor and inline styles stay untouched.
			expect(screen.queryByRole('separator')).toBeNull();
			const ancestor = document.querySelector(
				'.interface-complementary-area'
			) as HTMLElement | null;
			expect(ancestor).toBeTruthy();
			expect(ancestor!.style.width).toBe('');
			expect(ancestor!.style.flexBasis).toBe('');
		});

		it('updates the ancestor width during a pointer drag', () => {
			mountWithAwaitingInput();

			const handle = screen.getByRole('separator');
			const ancestor = getAncestor();

			fireEvent.pointerDown(handle, {
				clientX: 500,
				button: 0,
				pointerId: 1,
			});
			fireEvent.pointerMove(handle, { clientX: 400, pointerId: 1 });

			// Dragging 100px to the left grows the sidebar from 280 → 380.
			expect(ancestor.style.width).toBe('380px');

			fireEvent.pointerUp(handle, { clientX: 400, pointerId: 1 });
			expect(ancestor.style.width).toBe('380px');
		});

		it('clamps the width at MIN_WIDTH when dragging right', () => {
			mountWithAwaitingInput();

			const handle = screen.getByRole('separator');
			const ancestor = getAncestor();

			fireEvent.pointerDown(handle, {
				clientX: 500,
				button: 0,
				pointerId: 1,
			});
			fireEvent.pointerMove(handle, { clientX: 2000, pointerId: 1 });
			fireEvent.pointerUp(handle, { clientX: 2000, pointerId: 1 });

			expect(ancestor.style.width).toBe('280px');
		});

		it('clamps the width at 80% of window.innerWidth when dragging left', () => {
			mountWithAwaitingInput();

			const handle = screen.getByRole('separator');
			const ancestor = getAncestor();

			const max = Math.floor(window.innerWidth * 0.8);

			fireEvent.pointerDown(handle, {
				clientX: 500,
				button: 0,
				pointerId: 1,
			});
			fireEvent.pointerMove(handle, { clientX: -10000, pointerId: 1 });
			fireEvent.pointerUp(handle, { clientX: -10000, pointerId: 1 });

			expect(ancestor.style.width).toBe(`${max}px`);
		});

		it('writes to localStorage only on pointerup', () => {
			const setItemSpy = jest.spyOn(
				window.localStorage.__proto__,
				'setItem'
			);

			mountWithAwaitingInput();

			const handle = screen.getByRole('separator');

			fireEvent.pointerDown(handle, {
				clientX: 500,
				button: 0,
				pointerId: 1,
			});
			fireEvent.pointerMove(handle, { clientX: 400, pointerId: 1 });

			expect(setItemSpy).not.toHaveBeenCalledWith(
				STORAGE_KEY,
				expect.anything()
			);

			fireEvent.pointerUp(handle, { clientX: 400, pointerId: 1 });

			expect(setItemSpy).toHaveBeenCalledWith(STORAGE_KEY, '380');

			setItemSpy.mockRestore();
		});

		it('hydrates the width from localStorage on mount', () => {
			window.localStorage.setItem(STORAGE_KEY, '500');

			mountWithAwaitingInput();

			const ancestor = getAncestor();
			expect(ancestor.style.width).toBe('500px');
		});

		it('ignores primary button mismatches on pointerdown', () => {
			mountWithAwaitingInput();

			const handle = screen.getByRole('separator');
			const ancestor = getAncestor();

			// Right-click (button 2) should not start a drag.
			fireEvent.pointerDown(handle, {
				clientX: 500,
				button: 2,
				pointerId: 1,
			});
			fireEvent.pointerMove(handle, { clientX: 100, pointerId: 1 });

			expect(ancestor.style.width).toBe('280px');
		});

		it('clears inline styles on both skeleton and complementary wrappers when the panel unmounts', () => {
			const { unmount, container } = mountWithAwaitingInput();

			const skeleton = container.querySelector(
				'.interface-interface-skeleton__sidebar'
			) as HTMLElement;
			const complementary = container.querySelector(
				'.interface-complementary-area'
			) as HTMLElement;

			expect(skeleton.style.width).toBe('280px');
			expect(skeleton.style.flexBasis).toBe('280px');
			expect(complementary.style.width).toBe('280px');
			expect(complementary.style.position).toBe('relative');

			unmount();

			expect(skeleton.style.width).toBe('');
			expect(skeleton.style.flexBasis).toBe('');
			expect(skeleton.style.maxWidth).toBe('');
			expect(skeleton.style.minWidth).toBe('');
			expect(complementary.style.width).toBe('');
			expect(complementary.style.flexBasis).toBe('');
			expect(complementary.style.maxWidth).toBe('');
			expect(complementary.style.minWidth).toBe('');
			expect(complementary.style.position).toBe('');
		});

		it('clears skeleton inline styles after a drag when the panel unmounts', () => {
			const { unmount, container } = mountWithAwaitingInput();

			const skeleton = container.querySelector(
				'.interface-interface-skeleton__sidebar'
			) as HTMLElement;
			const handle = screen.getByRole('separator');

			// Drag to widen the sidebar.
			fireEvent.pointerDown(handle, {
				clientX: 500,
				button: 0,
				pointerId: 1,
			});
			fireEvent.pointerMove(handle, { clientX: 400, pointerId: 1 });
			fireEvent.pointerUp(handle, { clientX: 400, pointerId: 1 });

			expect(skeleton.style.width).toBe('380px');

			unmount();

			expect(skeleton.style.width).toBe('');
			expect(skeleton.style.flexBasis).toBe('');
			expect(skeleton.style.maxWidth).toBe('');
			expect(skeleton.style.minWidth).toBe('');
		});
	});
});
