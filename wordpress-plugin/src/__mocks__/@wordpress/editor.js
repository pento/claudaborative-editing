import { createElement } from 'react';

export function PluginSidebar({ children, ...props }) {
	return createElement(
		'div',
		{ 'data-testid': 'plugin-sidebar', ...props },
		children
	);
}
