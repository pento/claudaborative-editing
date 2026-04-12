const mockHandleCopy = jest.fn();
jest.mock('../../../hooks/use-copy-to-clipboard', () => ({
	useCopyToClipboard: jest.fn(() => ({
		copied: false,
		handleCopy: mockHandleCopy,
	})),
}));

jest.mock('@wordpress/i18n', () => ({
	__: (str: string) => str,
	sprintf: (fmt: string, ...args: string[]) => {
		let result = fmt;
		for (const arg of args) {
			result = result.replace('%s', arg);
		}
		return result;
	},
}));

jest.mock('@wordpress/components', () => {
	const { createElement } = require('react');
	return {
		Button: ({
			children,
			onClick,
			className,
			variant: _v,
			size: _s,
			...props
		}: any) =>
			createElement('button', { onClick, className, ...props }, children),
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
		Spinner: () => createElement('span', { 'data-testid': 'spinner' }),
	};
});

jest.mock('@wordpress/icons', () => ({
	cloud: { name: 'cloud' },
	code: { name: 'code' },
}));

import { render, screen, fireEvent } from '@testing-library/react';
import { useCopyToClipboard } from '../../../hooks/use-copy-to-clipboard';
import OnboardingContent from '../OnboardingContent';

const mockedUseCopyToClipboard = useCopyToClipboard as jest.Mock;

describe('OnboardingContent', () => {
	const originalState = (window as any).wpceInitialState;

	beforeEach(() => {
		jest.clearAllMocks();
		mockedUseCopyToClipboard.mockReturnValue({
			copied: false,
			handleCopy: mockHandleCopy,
		});
		// Ensure no cloud settings by default.
		delete (window as any).wpceInitialState;
	});

	afterEach(() => {
		if (originalState !== undefined) {
			(window as any).wpceInitialState = originalState;
		} else {
			delete (window as any).wpceInitialState;
		}
	});

	it('renders the heading text', () => {
		render(<OnboardingContent />);
		expect(
			screen.getByText('Get started with one of these options:')
		).toBeTruthy();
	});

	it('renders cloud option with link to claudaborative.cloud', () => {
		render(<OnboardingContent />);
		expect(screen.getByText('Claudaborative Cloud')).toBeTruthy();
		expect(
			screen.getByText(
				'The fastest way to get started. No local setup required.'
			)
		).toBeTruthy();

		const link = screen.getByText('Sign up at claudaborative.cloud');
		expect(link.tagName).toBe('A');
		expect(link.getAttribute('href')).toBe('https://claudaborative.cloud');
		expect(link.getAttribute('target')).toBe('_blank');
	});

	it('renders local setup option with command text', () => {
		render(<OnboardingContent />);
		expect(screen.getByText('Set up locally')).toBeTruthy();
		expect(
			screen.getByText('Use Claude Code on your own computer.')
		).toBeTruthy();
		expect(
			screen.getByText('npx claudaborative-editing start')
		).toBeTruthy();
	});

	it('copy button calls handleCopy from useCopyToClipboard', () => {
		render(<OnboardingContent />);

		const copyButton = screen.getByText('Copy');
		fireEvent.click(copyButton);

		expect(mockHandleCopy).toHaveBeenCalled();
	});

	it('copy button shows "Copied!" feedback when copied is true', () => {
		mockedUseCopyToClipboard.mockReturnValue({
			copied: true,
			handleCopy: mockHandleCopy,
		});

		render(<OnboardingContent />);

		expect(screen.getByText('Copied!')).toBeTruthy();
		expect(screen.queryByText('Copy')).toBeNull();
	});

	describe('when cloud is configured', () => {
		beforeEach(() => {
			(window as any).wpceInitialState = {
				cloudUrl: 'https://claudaborative.cloud',
				cloudApiKey: 'key-abc-123',
			};
		});

		it('shows a connecting message instead of setup instructions', () => {
			render(<OnboardingContent />);

			expect(
				screen.getByText(/Connecting to Claudaborative Cloud/)
			).toBeTruthy();
			expect(screen.getByTestId('spinner')).toBeTruthy();
		});

		it('does not render setup option cards', () => {
			render(<OnboardingContent />);

			expect(
				screen.queryByText('Get started with one of these options:')
			).toBeNull();
			expect(screen.queryByText('Set up locally')).toBeNull();
			expect(
				screen.queryByText('Sign up at claudaborative.cloud')
			).toBeNull();
		});
	});
});
