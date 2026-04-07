import { describe, it, expect } from 'vitest';
import {
	COMMANDS,
	COMMAND_SLUGS,
	TERMINAL_STATUSES,
	VALID_TRANSITIONS,
} from '../shared/commands.js';
import type {
	CommandSlug,
	CommandStatus,
	CommandDefinition,
} from '../shared/commands.js';

describe('shared/commands', () => {
	describe('COMMANDS', () => {
		it('defines all expected command slugs', () => {
			const expectedSlugs: CommandSlug[] = [
				'open-post',
				'proofread',
				'review',
				'respond-to-notes',
				'respond-to-note',
				'edit',
				'translate',
				'pre-publish-check',
				'compose',
			];

			expect(Object.keys(COMMANDS)).toEqual(expectedSlugs);
		});

		it.each(Object.values(COMMANDS))(
			'$slug has all required fields',
			(cmd: CommandDefinition) => {
				expect(cmd.slug).toBeTruthy();
				expect(cmd.label).toBeTruthy();
				expect(cmd.description).toBeTruthy();
				expect(cmd.progressLabel).toBeTruthy();
				expect(cmd.args).toBeDefined();
			}
		);

		it.each(Object.values(COMMANDS))(
			'$slug.slug matches its key in COMMANDS',
			(cmd: CommandDefinition) => {
				expect(COMMANDS[cmd.slug].slug).toBe(cmd.slug);
			}
		);

		it.each(Object.values(COMMANDS))(
			'$slug args have valid definitions',
			(cmd: CommandDefinition) => {
				for (const [name, arg] of Object.entries(cmd.args)) {
					expect(name).toBeTruthy();
					expect(['string', 'number']).toContain(arg.type);
					expect(typeof arg.required).toBe('boolean');
					expect(arg.description).toBeTruthy();
				}
			}
		);
	});

	describe('COMMAND_SLUGS', () => {
		it('matches Object.keys(COMMANDS)', () => {
			expect(COMMAND_SLUGS).toEqual(Object.keys(COMMANDS));
		});
	});

	describe('TERMINAL_STATUSES', () => {
		const allStatuses: CommandStatus[] = [
			'pending',
			'running',
			'completed',
			'failed',
			'expired',
			'cancelled',
			'awaiting_input',
		];

		it('contains only valid CommandStatus values', () => {
			for (const status of TERMINAL_STATUSES) {
				expect(allStatuses).toContain(status);
			}
		});

		it('does not contain active statuses', () => {
			expect(TERMINAL_STATUSES).not.toContain('pending');
			expect(TERMINAL_STATUSES).not.toContain('running');
			expect(TERMINAL_STATUSES).not.toContain('awaiting_input');
		});
	});

	describe('VALID_TRANSITIONS', () => {
		it('defines transitions for pending, running, and awaiting_input', () => {
			expect(VALID_TRANSITIONS).toHaveProperty('pending');
			expect(VALID_TRANSITIONS).toHaveProperty('running');
			expect(VALID_TRANSITIONS).toHaveProperty('awaiting_input');
		});

		it('pending can transition to running or completed', () => {
			expect(VALID_TRANSITIONS.pending).toEqual(['running', 'completed']);
		});

		it('running can transition to completed, failed, or awaiting_input', () => {
			expect(VALID_TRANSITIONS.running).toEqual([
				'completed',
				'failed',
				'awaiting_input',
			]);
		});

		it('awaiting_input can transition to running or cancelled', () => {
			expect(VALID_TRANSITIONS.awaiting_input).toEqual([
				'running',
				'cancelled',
			]);
		});
	});
});
