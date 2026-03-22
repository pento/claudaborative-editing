import { execFileSync } from 'child_process';
import { describe, it, expect } from 'vitest';

describe('git hooks', () => {
  it.skipIf(process.env.CI === 'true')('core.hooksPath is configured to .githooks', () => {
    let hooksPath: string;
    try {
      hooksPath = execFileSync('git', ['config', 'core.hooksPath'], {
        encoding: 'utf-8',
      }).trim();
    } catch {
      hooksPath = '';
    }

    expect(
      hooksPath,
      'Git hooks are not configured.\n' +
        'Run: git config core.hooksPath .githooks\n' +
        'This enables the pre-commit hook that auto-formats and lints staged files.',
    ).toBe('.githooks');
  });
});
