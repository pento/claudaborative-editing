import {
	getCollaborationState,
	isCollaborationEnabled,
} from '../collaboration';

describe('collaboration', () => {
	const originalState = (window as any).wpceInitialState;

	afterEach(() => {
		if (originalState !== undefined) {
			(window as any).wpceInitialState = originalState;
		} else {
			delete (window as any).wpceInitialState;
		}
	});

	describe('getCollaborationState', () => {
		it('returns the collaboration object when present', () => {
			const collaboration = {
				gutenbergActive: true,
				collaborationEnabled: false,
				canManageOptions: true,
				experimentsUrl:
					'https://example.com/wp-admin/options-general.php?page=experiments-wp-admin',
			};
			(window as any).wpceInitialState = { collaboration };

			expect(getCollaborationState()).toEqual(collaboration);
		});

		it('returns null when wpceInitialState is absent', () => {
			delete (window as any).wpceInitialState;

			expect(getCollaborationState()).toBeNull();
		});

		it('returns null when wpceInitialState.collaboration is absent', () => {
			(window as any).wpceInitialState = { mcpConnected: true };

			expect(getCollaborationState()).toBeNull();
		});
	});

	describe('isCollaborationEnabled', () => {
		it('returns true when collaborationEnabled is true', () => {
			(window as any).wpceInitialState = {
				collaboration: {
					gutenbergActive: true,
					collaborationEnabled: true,
					canManageOptions: true,
					experimentsUrl: null,
				},
			};

			expect(isCollaborationEnabled()).toBe(true);
		});

		it('returns false when collaborationEnabled is false', () => {
			(window as any).wpceInitialState = {
				collaboration: {
					gutenbergActive: true,
					collaborationEnabled: false,
					canManageOptions: true,
					experimentsUrl: null,
				},
			};

			expect(isCollaborationEnabled()).toBe(false);
		});

		it('defaults to true when the state is absent (older plugin builds)', () => {
			delete (window as any).wpceInitialState;

			expect(isCollaborationEnabled()).toBe(true);
		});
	});
});
