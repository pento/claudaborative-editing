import { isConversationVisible } from '../conversation-visibility';
import type { Command } from '../../store/types';

function makeCommand(overrides: Partial<Command>): Command {
	return {
		id: 1,
		post_id: 100,
		user_id: 1,
		prompt: 'compose',
		status: 'pending',
		arguments: {},
		message: null,
		result_data: null,
		...overrides,
	};
}

describe('isConversationVisible', () => {
	it('returns false for null', () => {
		expect(isConversationVisible(null)).toBe(false);
	});

	it.each([
		['pending compose', { prompt: 'compose', status: 'pending' }, true],
		['running compose', { prompt: 'compose', status: 'running' }, true],
		[
			'awaiting_input compose',
			{ prompt: 'compose', status: 'awaiting_input' },
			true,
		],
		[
			'awaiting_input non-conversational command',
			{ prompt: 'translate', status: 'awaiting_input' },
			true,
		],
		[
			'running non-conversational command with messages',
			{
				prompt: 'translate',
				status: 'running',
				result_data: { messages: [] },
			},
			true,
		],
		[
			'running non-conversational command without messages',
			{ prompt: 'proofread', status: 'running' },
			false,
		],
		[
			'pending non-conversational command',
			{ prompt: 'proofread', status: 'pending' },
			false,
		],
		[
			'completed compose',
			{ prompt: 'compose', status: 'completed' },
			false,
		],
		[
			'cancelled compose',
			{ prompt: 'compose', status: 'cancelled' },
			false,
		],
		['failed compose', { prompt: 'compose', status: 'failed' }, false],
		['expired compose', { prompt: 'compose', status: 'expired' }, false],
	] as const)('%s → %s', (_label, overrides, expected) => {
		expect(
			isConversationVisible(makeCommand(overrides as Partial<Command>))
		).toBe(expected);
	});
});
