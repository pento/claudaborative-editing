import { createElement } from 'react';

const createComponent = (name) => {
	const Component = ({ children, ...props }) =>
		createElement(name, props, children);
	Component.displayName = name;
	return Component;
};

export const Button = createComponent('button');
export function PanelBody({ children, title, initialOpen, ...props }) {
	return createElement('div', props, children);
}
export const PanelRow = createComponent('div');
export function Spinner() {
	return createElement('div', { 'data-testid': 'spinner' });
}
export function Notice({ children, isDismissible, onDismiss, ...props }) {
	return createElement('div', { role: 'alert', ...props }, children);
}
