jest.mock('@wordpress/i18n', () => ({
	__: (str: string) => str,
}));

jest.mock('@wordpress/components', () => {
	const { createElement } = require('react');
	return {
		Modal: ({ children, title, onRequestClose, className, icon }: any) =>
			createElement(
				'div',
				{
					'data-testid': 'modal',
					className,
					role: 'dialog',
					'aria-label': title,
				},
				icon &&
					createElement(
						'span',
						{ 'data-testid': 'modal-icon' },
						icon
					),
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
		Button: ({
			children,
			onClick,
			className,
			variant: _v,
			size: _s,
			...props
		}: any) =>
			createElement('button', { onClick, className, ...props }, children),
		ExternalLink: ({ children, href, ...props }: any) =>
			createElement('a', { href, target: '_blank', ...props }, children),
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

jest.mock('../../SparkleIcon', () => {
	const { createElement } = require('react');
	return {
		__esModule: true,
		default: ({ size }: { size?: number }) =>
			createElement('span', {
				'data-testid': 'sparkle-icon',
				'data-size': size,
			}),
	};
});

import { render, screen, fireEvent, act } from '@testing-library/react';
import SetupModal from '..';

describe('SetupModal', () => {
	let clipboardSpy: jest.SpyInstance;

	beforeEach(() => {
		jest.useFakeTimers();
		clipboardSpy = jest.fn().mockResolvedValue(undefined);
		Object.assign(navigator, {
			clipboard: { writeText: clipboardSpy },
		});
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	it('renders modal with title', () => {
		render(<SetupModal onRequestClose={jest.fn()} />);
		const modal = screen.getByTestId('modal');
		expect(modal.getAttribute('aria-label')).toBe('Get Started');
	});

	it('renders SparkleIcon in modal header', () => {
		render(<SetupModal onRequestClose={jest.fn()} />);
		expect(screen.getByTestId('sparkle-icon')).toBeTruthy();
	});

	it('renders cloud option with link to claudaborative.cloud', () => {
		render(<SetupModal onRequestClose={jest.fn()} />);
		expect(screen.getByText('Claudaborative Cloud')).toBeTruthy();
		expect(screen.getByText('Recommended')).toBeTruthy();

		const link = screen.getByText('Sign up at claudaborative.cloud');
		expect(link.tagName).toBe('A');
		expect(link.getAttribute('href')).toBe('https://claudaborative.cloud');
	});

	it('renders cloud option benefits', () => {
		render(<SetupModal onRequestClose={jest.fn()} />);
		expect(screen.getByText('No installation required')).toBeTruthy();
		expect(screen.getByText('Works from any device')).toBeTruthy();
		expect(screen.getByText('Automatic updates')).toBeTruthy();
	});

	it('renders local setup option with command', () => {
		render(<SetupModal onRequestClose={jest.fn()} />);
		expect(screen.getByText('Set up locally')).toBeTruthy();
		expect(
			screen.getByText('npx claudaborative-editing start')
		).toBeTruthy();
	});

	it('renders local setup benefits', () => {
		render(<SetupModal onRequestClose={jest.fn()} />);
		expect(screen.getByText('Runs on your machine')).toBeTruthy();
		expect(
			screen.getByText('Full control over the connection')
		).toBeTruthy();
		expect(screen.getByText('Requires Claude Code')).toBeTruthy();
	});

	it('copy button copies command to clipboard', async () => {
		render(<SetupModal onRequestClose={jest.fn()} />);

		await act(async () => fireEvent.click(screen.getByText('Copy')));

		expect(clipboardSpy).toHaveBeenCalledWith(
			'npx claudaborative-editing start'
		);
	});

	it('copy button shows "Copied!" feedback', async () => {
		render(<SetupModal onRequestClose={jest.fn()} />);

		await act(async () => fireEvent.click(screen.getByText('Copy')));

		expect(screen.getByText('Copied!')).toBeTruthy();

		act(() => jest.advanceTimersByTime(2000));
		expect(screen.getByText('Copy')).toBeTruthy();
	});

	it('calls onRequestClose when modal close is clicked', () => {
		const onClose = jest.fn();
		render(<SetupModal onRequestClose={onClose} />);

		fireEvent.click(screen.getByTestId('modal-close'));
		expect(onClose).toHaveBeenCalledTimes(1);
	});
});
