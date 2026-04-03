jest.mock('@wordpress/components', () => {
	const { createElement } = require('react');
	return {
		Modal: ({ children, title, onRequestClose }: any) =>
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
		TextControl: ({ value, onChange, label, onKeyDown }: any) =>
			createElement('input', {
				'data-testid': 'text-input',
				'aria-label': label,
				value,
				onChange: (e: any) => onChange(e.target.value),
				onKeyDown,
			}),
		Button: ({ children, disabled, onClick, variant }: any) =>
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
import TranslateModal from '..';

describe('TranslateModal', () => {
	const onSubmit = jest.fn();
	const onRequestClose = jest.fn();

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('renders modal with title and text input', () => {
		render(
			<TranslateModal
				onSubmit={onSubmit}
				onRequestClose={onRequestClose}
			/>
		);
		expect(screen.getByTestId('modal')).toBeTruthy();
		expect(screen.getByTestId('modal').getAttribute('aria-label')).toBe(
			'Translate'
		);
		expect(screen.getByTestId('text-input')).toBeTruthy();
	});

	it('submit button is disabled when input is empty', () => {
		render(
			<TranslateModal
				onSubmit={onSubmit}
				onRequestClose={onRequestClose}
			/>
		);
		const submit = screen.getByText('Submit');
		expect(submit.closest('button')!.disabled).toBe(true);
	});

	it('submit button is enabled when input has text', () => {
		render(
			<TranslateModal
				onSubmit={onSubmit}
				onRequestClose={onRequestClose}
			/>
		);
		fireEvent.change(screen.getByTestId('text-input'), {
			target: { value: 'Swedish' },
		});
		const submit = screen.getByText('Submit');
		expect(submit.closest('button')!.disabled).toBe(false);
	});

	it('calls onSubmit with trimmed language and closes on submit', () => {
		render(
			<TranslateModal
				onSubmit={onSubmit}
				onRequestClose={onRequestClose}
			/>
		);
		fireEvent.change(screen.getByTestId('text-input'), {
			target: { value: '  Spanish  ' },
		});
		fireEvent.click(screen.getByText('Submit'));

		expect(onSubmit).toHaveBeenCalledWith('Spanish');
		expect(onRequestClose).toHaveBeenCalled();
	});

	it('submits on Enter key', () => {
		render(
			<TranslateModal
				onSubmit={onSubmit}
				onRequestClose={onRequestClose}
			/>
		);
		fireEvent.change(screen.getByTestId('text-input'), {
			target: { value: 'Finnish' },
		});
		fireEvent.keyDown(screen.getByTestId('text-input'), {
			key: 'Enter',
		});

		expect(onSubmit).toHaveBeenCalledWith('Finnish');
		expect(onRequestClose).toHaveBeenCalled();
	});

	it('does not submit on Enter when input is empty', () => {
		render(
			<TranslateModal
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
			<TranslateModal
				onSubmit={onSubmit}
				onRequestClose={onRequestClose}
			/>
		);
		fireEvent.click(screen.getByTestId('modal-close'));

		expect(onSubmit).not.toHaveBeenCalled();
		expect(onRequestClose).toHaveBeenCalled();
	});
});
