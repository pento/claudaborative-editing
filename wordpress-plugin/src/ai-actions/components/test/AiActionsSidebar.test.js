jest.mock('@wordpress/editor', () => ({
	PluginSidebar: ({ children, ...props }) => (
		<div data-testid="plugin-sidebar" {...props}>
			{children}
		</div>
	),
}));

jest.mock('@wordpress/components', () => ({
	PanelBody: ({ children }) => <div>{children}</div>,
}));

jest.mock('../ConnectionStatus', () => {
	const Component = () => <div data-testid="connection-status" />;
	Component.displayName = 'ConnectionStatus';
	return { __esModule: true, default: Component };
});

jest.mock('../QuickActions', () => {
	const Component = () => <div data-testid="quick-actions" />;
	Component.displayName = 'QuickActions';
	return { __esModule: true, default: Component };
});

import { render, screen } from '@testing-library/react';
import AiActionsSidebar from '../AiActionsSidebar';

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
		expect(sidebar.getAttribute('title')).toBe('AI Actions');
	});

	it('contains ConnectionStatus component', () => {
		render(<AiActionsSidebar />);

		expect(screen.getByTestId('connection-status')).toBeTruthy();
	});

	it('contains QuickActions component', () => {
		render(<AiActionsSidebar />);

		expect(screen.getByTestId('quick-actions')).toBeTruthy();
	});
});
