jest.mock('@wordpress/plugins', () => ({
	registerPlugin: jest.fn(),
}));
jest.mock('../store', () => {});
jest.mock('../editor.css', () => {});
jest.mock('../components/AiActionsSidebar', () => ({
	__esModule: true,
	default: () => null,
}));

import { registerPlugin } from '@wordpress/plugins';

// Import the entry point (side effect: calls registerPlugin).
import '../index';

describe('AI Actions entry point', () => {
	it('registers the plugin with correct name', () => {
		expect(registerPlugin).toHaveBeenCalledWith(
			'claudaborative-editing-ai-actions',
			expect.objectContaining({
				render: expect.any(Function),
			})
		);
	});
});
