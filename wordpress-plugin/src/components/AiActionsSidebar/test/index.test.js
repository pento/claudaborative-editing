jest.mock('@wordpress/components', () => {
	const { createElement } = require('react');
	return {
		DropdownMenu: ({ children, icon, label }) =>
			createElement(
				'div',
				{ 'data-testid': 'dropdown-menu', 'aria-label': label },
				createElement('span', { 'data-testid': 'menu-icon' }, icon),
				typeof children === 'function'
					? children({ onClose: jest.fn() })
					: children
			),
	};
});

jest.mock('@wordpress/interface', () => {
	const { createElement } = require('react');
	return {
		PinnedItems: ({ children }) =>
			createElement('div', { 'data-testid': 'pinned-items' }, children),
	};
});

jest.mock('../../QuickActions', () => {
	const Component = () => <div data-testid="quick-actions" />;
	Component.displayName = 'QuickActions';
	return { __esModule: true, default: Component };
});

import { render, screen } from '@testing-library/react';
import AiActionsMenu from '..';

describe('AiActionsMenu', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('renders inside PinnedItems', () => {
		render(<AiActionsMenu />);

		expect(screen.getByTestId('pinned-items')).toBeTruthy();
	});

	it('renders DropdownMenu with correct label', () => {
		render(<AiActionsMenu />);

		const menu = screen.getByTestId('dropdown-menu');
		expect(menu.getAttribute('aria-label')).toBe('Claudaborative Editing');
	});

	it('contains QuickActions component', () => {
		render(<AiActionsMenu />);

		expect(screen.getByTestId('quick-actions')).toBeTruthy();
	});

	it('renders the icon SVG', () => {
		render(<AiActionsMenu />);

		const iconContainer = screen.getByTestId('menu-icon');
		const svg = iconContainer.querySelector('svg');
		expect(svg).toBeTruthy();
	});
});
