jest.mock('@wordpress/components', () => {
	const { createElement } = require('react');
	return {
		Modal: ({
			children,
			title,
			onRequestClose,
		}: {
			children: React.ReactNode;
			title: string;
			onRequestClose: () => void;
		}) =>
			createElement(
				'div',
				{ 'data-testid': 'modal', 'aria-label': title },
				createElement(
					'button',
					{
						'data-testid': 'modal-close',
						onClick: onRequestClose,
					},
					'Close'
				),
				children
			),
		TextControl: ({
			value,
			onChange,
			label,
			onKeyDown,
		}: {
			value: string;
			onChange: (v: string) => void;
			label: string;
			onKeyDown?: (e: React.KeyboardEvent) => void;
		}) =>
			createElement('input', {
				'data-testid': 'text-input',
				'aria-label': label,
				value,
				onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
					onChange(e.target.value),
				onKeyDown,
			}),
		Button: ({
			children,
			disabled,
			onClick,
			variant,
		}: {
			children: React.ReactNode;
			disabled?: boolean;
			onClick?: () => void;
			variant?: string;
		}) =>
			createElement(
				'button',
				{
					disabled,
					onClick,
					'data-variant': variant,
				},
				children
			),
	};
});

import { render, screen, fireEvent } from '@testing-library/react';
import EditFocusModal from '..';

describe('EditFocusModal', () => {
	const onSubmit = jest.fn();
	const onRequestClose = jest.fn();

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('renders modal with title and text input', () => {
		render(
			<EditFocusModal
				onSubmit={onSubmit}
				onRequestClose={onRequestClose}
			/>
		);
		expect(screen.getByTestId('modal')).toBeTruthy();
		expect(screen.getByTestId('modal').getAttribute('aria-label')).toBe(
			'Automatic Post Editing'
		);
		expect(screen.getByTestId('text-input')).toBeTruthy();
	});

	it('submit button is disabled when input is empty', () => {
		render(
			<EditFocusModal
				onSubmit={onSubmit}
				onRequestClose={onRequestClose}
			/>
		);
		const submit = screen.getByText('Submit');
		expect(submit.closest('button')!.disabled).toBe(true);
	});

	it('submit button is disabled when input is only whitespace', () => {
		render(
			<EditFocusModal
				onSubmit={onSubmit}
				onRequestClose={onRequestClose}
			/>
		);
		fireEvent.change(screen.getByTestId('text-input'), {
			target: { value: '   ' },
		});
		const submit = screen.getByText('Submit');
		expect(submit.closest('button')!.disabled).toBe(true);
	});

	it('submit button is enabled when input has text', () => {
		render(
			<EditFocusModal
				onSubmit={onSubmit}
				onRequestClose={onRequestClose}
			/>
		);
		fireEvent.change(screen.getByTestId('text-input'), {
			target: { value: 'make it more formal' },
		});
		const submit = screen.getByText('Submit');
		expect(submit.closest('button')!.disabled).toBe(false);
	});

	it('calls onSubmit with trimmed text and closes on submit', () => {
		render(
			<EditFocusModal
				onSubmit={onSubmit}
				onRequestClose={onRequestClose}
			/>
		);
		fireEvent.change(screen.getByTestId('text-input'), {
			target: { value: '  make it conversational  ' },
		});
		fireEvent.click(screen.getByText('Submit'));

		expect(onSubmit).toHaveBeenCalledWith('make it conversational');
		expect(onRequestClose).toHaveBeenCalled();
	});

	it('submits on Enter key', () => {
		render(
			<EditFocusModal
				onSubmit={onSubmit}
				onRequestClose={onRequestClose}
			/>
		);
		fireEvent.change(screen.getByTestId('text-input'), {
			target: { value: 'expand the intro' },
		});
		fireEvent.keyDown(screen.getByTestId('text-input'), {
			key: 'Enter',
		});

		expect(onSubmit).toHaveBeenCalledWith('expand the intro');
		expect(onRequestClose).toHaveBeenCalled();
	});

	it('does not submit on Enter when input is empty', () => {
		render(
			<EditFocusModal
				onSubmit={onSubmit}
				onRequestClose={onRequestClose}
			/>
		);
		fireEvent.keyDown(screen.getByTestId('text-input'), {
			key: 'Enter',
		});

		expect(onSubmit).not.toHaveBeenCalled();
		expect(onRequestClose).not.toHaveBeenCalled();
	});

	it('calls onRequestClose when modal close button is clicked', () => {
		render(
			<EditFocusModal
				onSubmit={onSubmit}
				onRequestClose={onRequestClose}
			/>
		);
		fireEvent.click(screen.getByTestId('modal-close'));

		expect(onSubmit).not.toHaveBeenCalled();
		expect(onRequestClose).toHaveBeenCalled();
	});
});
