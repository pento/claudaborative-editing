import { defineConfig } from 'eslint/config';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import markdown from '@eslint/markdown';
import packageJson from 'eslint-plugin-package-json';
import eslintConfigPrettier from 'eslint-config-prettier';

export default defineConfig(
  // Global ignores
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '.gutenberg/**'],
  },

  // TypeScript files: recommended + strict-type-checked + WordPress esnext-inspired code quality rules
  // Code quality rules extracted from @wordpress/eslint-plugin configs/es5.js + configs/esnext.js
  {
    files: ['**/*.ts'],
    extends: [eslint.configs.recommended, ...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        project: 'tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // --- From WordPress es5 config (code quality) ---
      'array-callback-return': 'error',
      camelcase: ['error', { properties: 'never' }],
      curly: ['error', 'all'],
      'dot-notation': 'off',
      '@typescript-eslint/dot-notation': 'error',
      eqeqeq: 'error',
      'no-alert': 'error',
      'no-bitwise': 'error',
      'no-caller': 'error',
      'no-eval': 'error',
      'no-lonely-if': 'error',
      'no-multi-str': 'error',
      'no-nested-ternary': 'error',
      'no-new-wrappers': 'error',
      'no-useless-return': 'error',
      'no-with': 'error',
      'no-else-return': 'error',
      'no-unused-expressions': 'off',
      '@typescript-eslint/no-unused-expressions': 'error',

      // --- From WordPress esnext config ---
      'no-var': 'error',
      'prefer-const': ['error', { destructuring: 'all' }],
      'object-shorthand': 'error',
      'no-useless-computed-key': 'error',

      // --- TypeScript overrides for base rules ---
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { ignoreRestSiblings: true }],
      'no-useless-constructor': 'off',
      '@typescript-eslint/no-useless-constructor': 'error',
      'no-redeclare': 'off',
      '@typescript-eslint/no-redeclare': 'error',

      // --- Deprecated function detection ---
      '@typescript-eslint/no-deprecated': 'error',

      // --- Project-specific ---
      // MCP server uses console.error() for logging (goes to stderr)
      'no-console': 'off',
      // Allow numbers in template literals (very common pattern: `Block ${index}`)
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-base-to-string': 'error',
      '@typescript-eslint/unbound-method': 'error',
    },
  },

  // Test files: relax unbound-method (vi.fn() mocks passed to expect() are false positives)
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // package.json
  packageJson.configs.recommended,

  // Markdown files
  markdown.configs.recommended,

  // Prettier must be last — disables all formatting-related ESLint rules
  eslintConfigPrettier,
);
