import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	buildAwarenessState,
	parseCollaborators,
} from '../../src/session/awareness.js';
import type { WPUser } from '../../src/wordpress/types.js';
import type { CollaboratorInfo } from '../../src/yjs/types.js';

const fakeUser: WPUser = {
	id: 1,
	name: 'admin',
	slug: 'admin',
	avatar_urls: { '96': 'https://example.com/avatar.jpg' },
};

describe('buildAwarenessState', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('creates correct structure with user info', () => {
		vi.spyOn(Date, 'now').mockReturnValue(1700000000000);

		const state = buildAwarenessState(fakeUser);

		expect(state).toEqual({
			collaboratorInfo: {
				id: 1,
				name: 'admin (Claudaborator)',
				slug: 'admin',
				avatar_urls: { '96': 'https://example.com/avatar.jpg' },
				browserType: 'Claudaborative Editing MCP',
				enteredAt: 1700000000000,
			},
			editorState: {
				selection: { type: 'none' },
			},
		});
	});

	it('appends " (Claudaborator)" to user name', () => {
		const state = buildAwarenessState({ ...fakeUser, name: 'Gary' });
		expect(state.collaboratorInfo.name).toBe('Gary (Claudaborator)');
	});

	it('handles user with empty avatar_urls', () => {
		const user: WPUser = { ...fakeUser, avatar_urls: {} };
		const state = buildAwarenessState(user);
		expect(state.collaboratorInfo.avatar_urls).toEqual({});
	});

	it('sets browserType to "Claudaborative Editing MCP"', () => {
		const state = buildAwarenessState(fakeUser);
		expect(state.collaboratorInfo.browserType).toBe(
			'Claudaborative Editing MCP'
		);
	});

	it('sets enteredAt to current time', () => {
		const before = Date.now();
		const state = buildAwarenessState(fakeUser);
		const after = Date.now();
		expect(state.collaboratorInfo.enteredAt).toBeGreaterThanOrEqual(before);
		expect(state.collaboratorInfo.enteredAt).toBeLessThanOrEqual(after);
	});
});

describe('parseCollaborators', () => {
	const otherCollaborator: CollaboratorInfo = {
		id: 2,
		name: 'Editor',
		slug: 'editor',
		avatar_urls: { '96': 'https://example.com/editor.jpg' },
		browserType: 'Google Chrome',
		enteredAt: 1700000000000,
	};

	it('filters out own client ID', () => {
		const awareness = {
			'100': { collaboratorInfo: otherCollaborator },
			'200': {
				collaboratorInfo: {
					...otherCollaborator,
					id: 3,
					name: 'Other',
				},
			},
		};

		const result = parseCollaborators(awareness, 100);
		expect(result).toHaveLength(1);
		expect(result[0].name).toBe('Other');
	});

	it('handles null awareness states (disconnected clients)', () => {
		const awareness = {
			'100': null,
			'200': { collaboratorInfo: otherCollaborator },
		};

		const result = parseCollaborators(awareness, 999);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual(otherCollaborator);
	});

	it('returns empty array for solo editing', () => {
		const awareness = {
			'100': {
				collaboratorInfo: { ...otherCollaborator, id: 1, name: 'Me' },
			},
		};

		const result = parseCollaborators(awareness, 100);
		expect(result).toEqual([]);
	});

	it('returns empty array for empty awareness state', () => {
		const result = parseCollaborators({}, 100);
		expect(result).toEqual([]);
	});

	it('skips entries without collaboratorInfo', () => {
		const awareness = {
			'200': { cursor: { x: 0, y: 0 } },
			'300': { collaboratorInfo: otherCollaborator },
		};

		const result = parseCollaborators(awareness, 100);
		expect(result).toHaveLength(1);
		expect(result[0]).toEqual(otherCollaborator);
	});

	it('returns multiple collaborators', () => {
		const other1: CollaboratorInfo = {
			...otherCollaborator,
			id: 2,
			name: 'Editor1',
		};
		const other2: CollaboratorInfo = {
			...otherCollaborator,
			id: 3,
			name: 'Editor2',
		};

		const awareness = {
			'100': { collaboratorInfo: { ...otherCollaborator, id: 1 } },
			'200': { collaboratorInfo: other1 },
			'300': { collaboratorInfo: other2 },
		};

		const result = parseCollaborators(awareness, 100);
		expect(result).toHaveLength(2);
		expect(result.map((c) => c.name)).toContain('Editor1');
		expect(result.map((c) => c.name)).toContain('Editor2');
	});
});
