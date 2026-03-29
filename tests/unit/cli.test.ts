import { describe, it, expect } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';

const BIN = join(import.meta.dirname, '../../dist/index.js');
const pkg = JSON.parse(
	readFileSync(join(import.meta.dirname, '../../package.json'), 'utf-8')
) as {
	version: string;
};

function run(...args: string[]): string {
	return execFileSync('node', [BIN, ...args], {
		encoding: 'utf-8',
		timeout: 5000,
	}).trim();
}

describe('CLI', () => {
	describe('--version', () => {
		it('prints the version from package.json', () => {
			expect(run('--version')).toBe(pkg.version);
		});

		it('works with -v shorthand', () => {
			expect(run('-v')).toBe(pkg.version);
		});
	});

	describe('--help', () => {
		it('prints usage information', () => {
			const output = run('--help');
			expect(output).toContain('claudaborative-editing');
			expect(output).toContain('Usage:');
			expect(output).toContain('setup');
			expect(output).toContain('WP_SITE_URL');
		});

		it('works with -h shorthand', () => {
			const output = run('-h');
			expect(output).toContain('Usage:');
		});

		it('includes the version in help output', () => {
			const output = run('--help');
			expect(output).toContain(`v${pkg.version}`);
		});
	});
});
