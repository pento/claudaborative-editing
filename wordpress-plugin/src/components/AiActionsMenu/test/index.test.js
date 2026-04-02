jest.mock('@wordpress/data', () => ({
	useSelect: jest.fn(),
}));

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

jest.mock('../../../store', () => ({ STORE_NAME: 'wpce/ai-actions' }));

import { render, screen } from '@testing-library/react';
import { useSelect } from '@wordpress/data';
import AiActionsMenu from '..';

function mockUseSelect(stores) {
	useSelect.mockImplementation((selector) => {
		const select = (storeName) => stores[storeName] || {};
		return selector(select);
	});
}

function defaultStores(overrides = {}) {
	return {
		'wpce/ai-actions': {
			getActiveCommand: () => null,
		},
		...overrides,
	};
}

describe('AiActionsMenu', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockUseSelect(defaultStores());
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

	it('renders SparkleIcon without processing when no active command', () => {
		render(<AiActionsMenu />);

		const iconContainer = screen.getByTestId('menu-icon');
		const svg = iconContainer.querySelector('svg');
		expect(svg).toBeTruthy();
		expect(svg.classList.contains('wpce-sparkles-processing')).toBe(false);
	});

	it('renders SparkleIcon with processing when command is active', () => {
		mockUseSelect(
			defaultStores({
				'wpce/ai-actions': {
					getActiveCommand: () => ({
						id: 1,
						prompt: 'proofread',
						status: 'running',
						post_id: 100,
					}),
				},
			})
		);

		render(<AiActionsMenu />);

		const iconContainer = screen.getByTestId('menu-icon');
		const svg = iconContainer.querySelector('svg');
		expect(svg).toBeTruthy();
		expect(svg.classList.contains('wpce-sparkles-processing')).toBe(true);
	});
});
