import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import packageJson from 'eslint-plugin-package-json';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory: __dirname });

export default [
	// Global ignores
	{
		ignores: [
			'dist/**',
			'coverage/**',
			'node_modules/**',
			'.gutenberg/**',
			'bin/**',
			'wordpress-plugin/vendor/**',
			'wordpress-plugin/node_modules/**',
			'wordpress-plugin/build/**',
		],
	},

	// TypeScript files: recommended + strict-type-checked + WordPress esnext-inspired code quality rules
	// Code quality rules extracted from @wordpress/eslint-plugin configs/es5.js + configs/esnext.js
	{
		files: ['src/**/*.ts', 'tests/**/*.ts', '*.config.ts'],
		...eslint.configs.recommended,
	},
	...tseslint.configs.strictTypeChecked.map((config) => ({
		...config,
		files: ['src/**/*.ts', 'tests/**/*.ts', '*.config.ts'],
	})),
	{
		files: ['src/**/*.ts', 'tests/**/*.ts', '*.config.ts'],
		languageOptions: {
			parserOptions: {
				project: 'tsconfig.eslint.json',
				tsconfigRootDir: __dirname,
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
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ ignoreRestSiblings: true },
			],
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
			'@typescript-eslint/restrict-template-expressions': [
				'error',
				{ allowNumber: true },
			],
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

	// WordPress plugin JS: @wordpress/eslint-plugin recommended (without Prettier
	// rule — we handle formatting via eslint-config-prettier at the end)
	...compat
		.extends('plugin:@wordpress/eslint-plugin/recommended-with-formatting')
		.map((config) => ({
			...config,
			files: ['wordpress-plugin/**/*.{js,ts,tsx}'],
		})),

	// WordPress plugin TypeScript files: use TS parser and disable rules
	// that conflict with TypeScript (no-undef, no-unused-vars, jsdoc types).
	// Keep @wordpress/eslint-plugin for WP-specific rules (i18n, etc.).
	{
		files: ['wordpress-plugin/**/*.{ts,tsx}'],
		plugins: {
			'@typescript-eslint': tseslint.plugin,
		},
		languageOptions: {
			parser: tseslint.parser,
		},
		rules: {
			// TypeScript handles these natively — replace with TS equivalents
			'no-undef': 'off',
			'no-unused-vars': 'off',
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ ignoreRestSiblings: true },
			],
			'no-redeclare': 'off',
			'@typescript-eslint/no-redeclare': 'error',
			// JSDoc types are redundant with TypeScript
			'jsdoc/require-param-type': 'off',
			'jsdoc/require-returns-type': 'off',
			// snake_case in API response interfaces
			camelcase: [
				'error',
				{
					properties: 'never',
					allow: ['^mcp_', '^protocol_', '^post_'],
				},
			],
		},
	},

	// WordPress plugin test files: Jest globals
	{
		files: ['wordpress-plugin/src/**/test/**/*.{js,ts,tsx}'],
		languageOptions: {
			globals: globals.jest,
		},
		rules: {
			'@wordpress/i18n-no-variables': 'off',
			'@wordpress/i18n-text-domain': 'off',
		},
	},

	// Root package.json only (plugin has its own conventions)
	{
		...packageJson.configs.recommended,
		files: ['package.json'],
	},

	// Prettier must be last — disables all formatting-related ESLint rules
	eslintConfigPrettier,
];
