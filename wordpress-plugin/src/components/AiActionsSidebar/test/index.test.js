jest.mock('@wordpress/editor', () => ({
	PluginSidebar: ({ children, icon, ...props }) => (
		<div data-testid="plugin-sidebar" {...props}>
			<span data-testid="sidebar-icon">{icon}</span>
			{children}
		</div>
	),
}));

jest.mock('../../QuickActions', () => {
	const Component = () => <div data-testid="quick-actions" />;
	Component.displayName = 'QuickActions';
	return { __esModule: true, default: Component };
});

import { render, screen } from '@testing-library/react';
import AiActionsSidebar from '..';

describe('AiActionsSidebar', () => {
	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('renders PluginSidebar with correct name', () => {
		render(<AiActionsSidebar />);

		const sidebar = screen.getByTestId('plugin-sidebar');
		expect(sidebar).toBeTruthy();
		expect(sidebar.getAttribute('name')).toBe(
			'claudaborative-editing-ai-actions'
		);
	});

	it('renders PluginSidebar with correct title', () => {
		render(<AiActionsSidebar />);

		const sidebar = screen.getByTestId('plugin-sidebar');
		expect(sidebar.getAttribute('title')).toBe('Claudaborative Editing');
	});

	it('contains QuickActions component', () => {
		render(<AiActionsSidebar />);

		expect(screen.getByTestId('quick-actions')).toBeTruthy();
	});

	it('renders the icon SVG', () => {
		render(<AiActionsSidebar />);

		const iconContainer = screen.getByTestId('sidebar-icon');
		const svg = iconContainer.querySelector('svg');
		expect(svg).toBeTruthy();
	});
});
