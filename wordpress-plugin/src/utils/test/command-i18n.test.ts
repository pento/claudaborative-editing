/**
 * Unit tests for the command i18n helpers.
 *
 * Verifies that every command slug defined in shared/commands.ts
 * has a translated label, description, and progress label.
 */

jest.mock('@wordpress/i18n', () => ({
	__: jest.fn((str: string) => str),
}));

import { COMMAND_SLUGS, type CommandSlug } from '#shared/commands';
import {
	getCommandLabel,
	getCommandDescription,
	getCommandProgressLabel,
} from '../command-i18n';

describe('command-i18n', () => {
	describe('getCommandLabel', () => {
		it.each(COMMAND_SLUGS)(
			'returns a non-empty string for "%s"',
			(slug: CommandSlug) => {
				const label = getCommandLabel(slug);
				expect(label).toBeTruthy();
				expect(typeof label).toBe('string');
				// Should not just return the slug itself
				expect(label).not.toBe(slug);
			}
		);
	});

	describe('getCommandDescription', () => {
		it.each(COMMAND_SLUGS)(
			'returns a non-empty string for "%s"',
			(slug: CommandSlug) => {
				const description = getCommandDescription(slug);
				expect(description).toBeTruthy();
				expect(typeof description).toBe('string');
			}
		);
	});

	describe('getCommandProgressLabel', () => {
		it.each(COMMAND_SLUGS)(
			'returns a non-empty string for "%s"',
			(slug: CommandSlug) => {
				const progressLabel = getCommandProgressLabel(slug);
				expect(progressLabel).toBeTruthy();
				expect(typeof progressLabel).toBe('string');
			}
		);
	});
});
