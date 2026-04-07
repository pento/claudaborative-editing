jest.mock('@wordpress/plugins', () => ({
	registerPlugin: jest.fn(),
}));
jest.mock('../store', () => {});
jest.mock('../sync/command-sync', () => ({
	initCommandSync: jest.fn(),
}));
jest.mock('../components/AiActionsMenu', () => ({
	__esModule: true,
	default: () => null,
}));
jest.mock('../components/ConnectionStatus', () => ({
	__esModule: true,
	default: () => null,
}));
jest.mock('../components/NotesIntegration', () => ({
	__esModule: true,
	default: () => null,
}));
jest.mock('../components/PrePublishPanel', () => ({
	__esModule: true,
	default: () => null,
}));
jest.mock('../components/ConversationPanel', () => ({
	__esModule: true,
	default: () => null,
}));

import { registerPlugin } from '@wordpress/plugins';

// Import the entry point (side effect: calls registerPlugin).
import '../index';

describe('AI Actions entry point', () => {
	it('registers the actions menu plugin', () => {
		expect(registerPlugin).toHaveBeenCalledWith(
			'claudaborative-editing-ai-actions',
			expect.objectContaining({
				render: expect.any(Function),
			})
		);
	});

	it('registers the status indicator plugin', () => {
		expect(registerPlugin).toHaveBeenCalledWith(
			'claudaborative-editing-status',
			expect.objectContaining({
				render: expect.any(Function),
			})
		);
	});

	it('registers the notes integration plugin', () => {
		expect(registerPlugin).toHaveBeenCalledWith(
			'claudaborative-editing-notes',
			expect.objectContaining({
				render: expect.any(Function),
			})
		);
	});

	it('registers the pre-publish panel plugin', () => {
		expect(registerPlugin).toHaveBeenCalledWith(
			'claudaborative-editing-pre-publish',
			expect.objectContaining({
				render: expect.any(Function),
			})
		);
	});

	it('registers the conversation panel plugin', () => {
		expect(registerPlugin).toHaveBeenCalledWith(
			'claudaborative-editing-conversation',
			expect.objectContaining({
				render: expect.any(Function),
			})
		);
	});
});
