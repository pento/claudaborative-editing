/* eslint-disable jsdoc/require-jsdoc */

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
