jest.mock('@wordpress/i18n', () => ({
	__: (str: string) => str,
}));

jest.mock('@wordpress/components', () => {
	const { createElement } = require('react');
	return {
		Notice: ({ children, status, isDismissible, className }: any) =>
			createElement(
				'div',
				{
					'data-testid': 'notice',
					'data-status': status,
					'data-dismissible': isDismissible,
					className,
				},
				children
			),
		ExternalLink: ({ children, href, className, ...props }: any) =>
			createElement(
				'a',
				{ href, target: '_blank', className, ...props },
				children
			),
	};
});

import { render, screen } from '@testing-library/react';
import CollaborationNotice from '../CollaborationNotice';

const HEADING =
	'Real-time collaboration is not enabled on this site, so Claudaborative Editing cannot connect.';

describe('CollaborationNotice', () => {
	const originalState = (window as any).wpceInitialState;

	afterEach(() => {
		if (originalState !== undefined) {
			(window as any).wpceInitialState = originalState;
		} else {
			delete (window as any).wpceInitialState;
		}
	});

	it('renders nothing when wpceInitialState.collaboration is absent', () => {
		delete (window as any).wpceInitialState;

		const { container } = render(<CollaborationNotice />);
		expect(container.innerHTML).toBe('');
	});

	it('renders nothing when collaboration is already enabled', () => {
		(window as any).wpceInitialState = {
			collaboration: {
				gutenbergActive: true,
				collaborationEnabled: true,
				canManageOptions: true,
				experimentsUrl:
					'https://example.com/wp-admin/options-general.php?page=experiments-wp-admin',
			},
		};

		const { container } = render(<CollaborationNotice />);
		expect(container.innerHTML).toBe('');
	});

	it('renders the heading text whenever the notice is shown', () => {
		(window as any).wpceInitialState = {
			collaboration: {
				gutenbergActive: true,
				collaborationEnabled: false,
				canManageOptions: true,
				experimentsUrl:
					'https://example.com/wp-admin/options-general.php?page=experiments-wp-admin',
			},
		};

		render(<CollaborationNotice />);
		expect(screen.getByText(HEADING)).toBeTruthy();
		expect(screen.getByTestId('notice').getAttribute('data-status')).toBe(
			'warning'
		);
		expect(
			screen.getByTestId('notice').getAttribute('data-dismissible')
		).toBe('false');
	});

	it('active + can manage options: links to the experiments page', () => {
		(window as any).wpceInitialState = {
			collaboration: {
				gutenbergActive: true,
				collaborationEnabled: false,
				canManageOptions: true,
				experimentsUrl:
					'https://example.com/wp-admin/options-general.php?page=experiments-wp-admin',
			},
		};

		render(<CollaborationNotice />);

		const link = screen.getByText(
			'Turn on “Enable real-time collaboration” under Settings → Experiments'
		);
		expect(link.tagName).toBe('A');
		expect(link.getAttribute('href')).toBe(
			'https://example.com/wp-admin/options-general.php?page=experiments-wp-admin'
		);
		expect(link.getAttribute('target')).toBe('_blank');
	});

	it('active + cannot manage options: plain text, no link', () => {
		(window as any).wpceInitialState = {
			collaboration: {
				gutenbergActive: true,
				collaborationEnabled: false,
				canManageOptions: false,
				experimentsUrl: null,
			},
		};

		render(<CollaborationNotice />);

		expect(
			screen.getByText(
				'Ask an administrator to turn on “Enable real-time collaboration” under Settings → Experiments.'
			)
		).toBeTruthy();
		expect(screen.queryByRole('link')).toBeNull();
	});

	it('inactive + can manage options: install guidance, no link', () => {
		(window as any).wpceInitialState = {
			collaboration: {
				gutenbergActive: false,
				collaborationEnabled: false,
				canManageOptions: true,
				experimentsUrl: null,
			},
		};

		render(<CollaborationNotice />);

		expect(
			screen.getByText(
				'Install and activate the Gutenberg plugin (23.8 or later), then turn on “Enable real-time collaboration” under Settings → Experiments.'
			)
		).toBeTruthy();
		expect(screen.queryByRole('link')).toBeNull();
	});

	it('inactive + cannot manage options: ask-an-administrator install guidance, no link', () => {
		(window as any).wpceInitialState = {
			collaboration: {
				gutenbergActive: false,
				collaborationEnabled: false,
				canManageOptions: false,
				experimentsUrl: null,
			},
		};

		render(<CollaborationNotice />);

		expect(
			screen.getByText(
				'Ask an administrator to install the Gutenberg plugin (23.8 or later) and turn on “Enable real-time collaboration” under Settings → Experiments.'
			)
		).toBeTruthy();
		expect(screen.queryByRole('link')).toBeNull();
	});
});
