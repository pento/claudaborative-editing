// jsdom does not implement scrollIntoView
Element.prototype.scrollIntoView = jest.fn();

jest.mock('@wordpress/i18n', () => ({
	__: jest.fn((str: string) => str),
}));

jest.mock('@wordpress/editor', () => {
	const { createElement } = require('react');
	return {
		PluginSidebar: ({ children, title }: any) =>
			createElement(
				'div',
				{ 'data-testid': 'plugin-sidebar', 'data-title': title },
				children
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

import { render, screen, fireEvent } from '@testing-library/react';
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

		mockedUseDispatch.mockImplementation((storeNameOrDescriptor?: any) => {
			if (
				storeNameOrDescriptor === 'core/interface' ||
				storeNameOrDescriptor?.name === 'core/interface'
			) {
				return { enableComplementaryArea: jest.fn() };
			}
			return { createNotice: jest.fn() };
		});

		mockUseSelect(
			new Map<unknown, Record<string, (...args: any[]) => any>>([
				[aiActionsStore, { getCurrentPostId: () => 100 }],
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

	it('returns null when the active command is running without conversation data', () => {
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

		const { container } = render(<ConversationPanel />);
		expect(container.innerHTML).toBe('');
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

		expect(screen.getByText('Processing\u2026')).toBeTruthy();
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

		expect(screen.queryByText('Processing\u2026')).toBeNull();
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
});
