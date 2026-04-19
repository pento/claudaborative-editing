/**
 * Unit tests for the locale helpers.
 *
 * Verifies that getCommandLocaleArgs reads user/site locale from
 * window.wpceInitialState and tolerates missing / empty fields.
 */

import { getCommandLocaleArgs } from '../locale';

describe('getCommandLocaleArgs', () => {
	let originalState: unknown;

	beforeEach(() => {
		originalState = (window as any).wpceInitialState;
	});

	afterEach(() => {
		if (originalState === undefined) {
			delete (window as any).wpceInitialState;
		} else {
			(window as any).wpceInitialState = originalState;
		}
	});

	it('returns empty object when wpceInitialState is undefined', () => {
		delete (window as any).wpceInitialState;
		expect(getCommandLocaleArgs()).toEqual({});
	});

	it('returns userLocale and siteLocale when both are set', () => {
		(window as any).wpceInitialState = {
			userLocale: 'fr_FR',
			siteLocale: 'en_US',
		};
		expect(getCommandLocaleArgs()).toEqual({
			userLocale: 'fr_FR',
			siteLocale: 'en_US',
		});
	});

	it('omits empty-string locale fields', () => {
		(window as any).wpceInitialState = {
			userLocale: '',
			siteLocale: 'en_US',
		};
		expect(getCommandLocaleArgs()).toEqual({ siteLocale: 'en_US' });
	});

	it('omits non-string locale fields', () => {
		(window as any).wpceInitialState = {
			userLocale: 42,
			siteLocale: null,
		};
		expect(getCommandLocaleArgs()).toEqual({});
	});

	it('returns only the fields that are present', () => {
		(window as any).wpceInitialState = { userLocale: 'ja_JP' };
		expect(getCommandLocaleArgs()).toEqual({ userLocale: 'ja_JP' });
	});
});
