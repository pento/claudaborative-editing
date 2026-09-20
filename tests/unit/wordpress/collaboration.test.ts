import { describe, it, expect } from 'vitest';
import {
	collaborationGuidance,
	describeCollaborationState,
	experimentsUrl,
	isGutenbergVersionSupported,
	EXPERIMENTS_ADMIN_PATH,
	MIN_GUTENBERG_VERSION,
	RTC_EXPERIMENT_LABEL,
	type CollaborationStatus,
} from '../../../src/wordpress/collaboration.js';

describe('experimentsUrl', () => {
	it('appends the admin path to a site URL without a trailing slash', () => {
		expect(experimentsUrl('https://example.com')).toBe(
			`https://example.com${EXPERIMENTS_ADMIN_PATH}`
		);
	});

	it('strips a trailing slash before appending', () => {
		expect(experimentsUrl('https://example.com/')).toBe(
			`https://example.com${EXPERIMENTS_ADMIN_PATH}`
		);
	});

	it('strips multiple trailing slashes', () => {
		expect(experimentsUrl('https://example.com///')).toBe(
			`https://example.com${EXPERIMENTS_ADMIN_PATH}`
		);
	});

	it('always ends with the experiments admin path', () => {
		expect(experimentsUrl('https://example.com')).toMatch(
			/\/wp-admin\/options-general\.php\?page=experiments-wp-admin$/
		);
	});
});

describe('collaborationGuidance', () => {
	it('mentions the minimum Gutenberg version, the experiment label, and the experiments URL', () => {
		const guidance = collaborationGuidance('https://example.com');
		expect(guidance).toContain(MIN_GUTENBERG_VERSION);
		expect(guidance).toContain(RTC_EXPERIMENT_LABEL);
		expect(guidance).toContain(experimentsUrl('https://example.com'));
	});
});

describe('isGutenbergVersionSupported', () => {
	it('accepts the minimum version exactly', () => {
		expect(isGutenbergVersionSupported('23.8.0')).toBe(true);
	});

	it('accepts a later major version with a pre-release suffix', () => {
		expect(isGutenbergVersionSupported('24.0.0-rc.1')).toBe(true);
	});

	it('rejects a patch version below the minimum minor', () => {
		expect(isGutenbergVersionSupported('23.7.9')).toBe(false);
	});

	it('rejects an older minimum-Gutenberg-era version', () => {
		expect(isGutenbergVersionSupported('22.8')).toBe(false);
	});

	it('rejects null', () => {
		expect(isGutenbergVersionSupported(null)).toBe(false);
	});

	it('rejects unparsable garbage', () => {
		expect(isGutenbergVersionSupported('garbage')).toBe(false);
	});
});

describe('describeCollaborationState', () => {
	const siteUrl = 'https://example.com';
	const experimentsAdminUrl = experimentsUrl(siteUrl);

	function baseStatus(
		overrides: Partial<CollaborationStatus> = {}
	): CollaborationStatus {
		return {
			gutenberg_active: true,
			gutenberg_version: '24.0.0',
			collaboration_enabled: true,
			sync_endpoint_registered: true,
			can_manage_options: true,
			experiments_url: experimentsAdminUrl,
			...overrides,
		};
	}

	describe('branch 1: sync endpoint registered (wins first)', () => {
		it('reports enabled, regardless of other fields', () => {
			const text = describeCollaborationState(
				baseStatus({
					sync_endpoint_registered: true,
					collaboration_enabled: false,
					gutenberg_active: false,
				}),
				siteUrl
			);
			expect(text).toBe(
				'Real-time collaboration is enabled (Gutenberg 24.0.0).'
			);
		});

		it('does not mention administrators, since nothing needs to be done', () => {
			const text = describeCollaborationState(
				baseStatus({ can_manage_options: false }),
				siteUrl
			);
			expect(text).not.toContain('administrator');
		});
	});

	describe('branch 2: Gutenberg not active', () => {
		it('as an admin, gives a direct instruction', () => {
			const text = describeCollaborationState(
				baseStatus({
					gutenberg_active: false,
					gutenberg_version: null,
					sync_endpoint_registered: false,
					experiments_url: null,
					can_manage_options: true,
				}),
				siteUrl
			);
			expect(text).toContain('the Gutenberg plugin is not active');
			expect(text).toContain(
				`Install and activate Gutenberg ${MIN_GUTENBERG_VERSION} or later`
			);
			expect(text).not.toContain('Ask an administrator');
		});

		it('as a non-admin, defers to an administrator with a lower-cased verb', () => {
			const text = describeCollaborationState(
				baseStatus({
					gutenberg_active: false,
					gutenberg_version: null,
					sync_endpoint_registered: false,
					experiments_url: null,
					can_manage_options: false,
				}),
				siteUrl
			);
			expect(text).toContain(
				'Ask an administrator to install and activate Gutenberg'
			);
		});
	});

	describe('branch 3: Gutenberg active but too old', () => {
		it('as an admin, asks to update Gutenberg', () => {
			const text = describeCollaborationState(
				baseStatus({
					gutenberg_version: '23.5.0',
					sync_endpoint_registered: false,
					can_manage_options: true,
				}),
				siteUrl
			);
			expect(text).toContain('23.5.0 is active');
			expect(text).toContain(
				`${MIN_GUTENBERG_VERSION} or later is required`
			);
			expect(text).toContain('Update Gutenberg');
			expect(text).not.toContain('Ask an administrator');
		});

		it('as a non-admin, defers to an administrator with a lower-cased verb', () => {
			const text = describeCollaborationState(
				baseStatus({
					gutenberg_version: '23.5.0',
					sync_endpoint_registered: false,
					can_manage_options: false,
				}),
				siteUrl
			);
			expect(text).toContain('Ask an administrator to update Gutenberg');
		});
	});

	describe('branch 4: experiment off', () => {
		it('as an admin, links straight to the experiments URL', () => {
			const text = describeCollaborationState(
				baseStatus({
					collaboration_enabled: false,
					sync_endpoint_registered: false,
					can_manage_options: true,
				}),
				siteUrl
			);
			expect(text).toContain(
				`the "${RTC_EXPERIMENT_LABEL}" experiment is off`
			);
			expect(text).toContain(`Turn it on at ${experimentsAdminUrl}`);
			expect(text).not.toContain('Ask an administrator');
		});

		it('as a non-admin, defers to an administrator with a lower-cased verb', () => {
			const text = describeCollaborationState(
				baseStatus({
					collaboration_enabled: false,
					sync_endpoint_registered: false,
					can_manage_options: false,
				}),
				siteUrl
			);
			expect(text).toContain(
				`Ask an administrator to turn it on at ${experimentsAdminUrl}`
			);
		});

		it('falls back to a computed URL when experiments_url is null', () => {
			const text = describeCollaborationState(
				baseStatus({
					collaboration_enabled: false,
					sync_endpoint_registered: false,
					experiments_url: null,
				}),
				siteUrl
			);
			expect(text).toContain(`Turn it on at ${experimentsAdminUrl}`);
		});
	});

	describe('branch 5: enabled but route missing', () => {
		it('reports the route is not registered', () => {
			const text = describeCollaborationState(
				baseStatus({
					collaboration_enabled: true,
					sync_endpoint_registered: false,
				}),
				siteUrl
			);
			expect(text).toContain('is enabled in Gutenberg 24.0.0');
			expect(text).toContain('/wp-sync/v1/updates');
			expect(text).toContain('not registered');
		});
	});

	it('falls back to "unknown version" when gutenberg_version is null but Gutenberg is somehow active', () => {
		const text = describeCollaborationState(
			baseStatus({
				gutenberg_active: true,
				gutenberg_version: null,
				sync_endpoint_registered: false,
			}),
			siteUrl
		);
		expect(text).toContain('unknown version');
		expect(text).not.toContain('null');
	});
});
