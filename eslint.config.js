import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import markdown from '@eslint/markdown';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  // Global ignores
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', '.gutenberg/**'],
  },

  // TypeScript files: recommended + strict-type-checked
  {
    files: ['**/*.ts'],
    extends: [eslint.configs.recommended, ...tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: {
        project: 'tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // WordPress esnext-inspired code quality rules
  // Extracted from @wordpress/eslint-plugin configs/es5.js + configs/esnext.js
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
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
      // MCP SDK callbacks and Yjs event handlers require async signatures but often don't await
      '@typescript-eslint/require-await': 'off',
      // Y.Text and other Yjs types have meaningful toString() that TypeScript doesn't know about
      '@typescript-eslint/no-base-to-string': 'off',
      // MCP SDK uses method references in callbacks (server.tool(), server.prompt())
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // Test file relaxations
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      // Test mocks often have empty async methods
      '@typescript-eslint/require-await': 'off',
    },
  },

  // Markdown files
  {
    files: ['**/*.md'],
    plugins: { markdown },
    language: 'markdown/gfm',
    rules: {
      'markdown/heading-increment': 'error',
      'markdown/fenced-code-language': 'error',
      'markdown/no-html': 'off',
      'markdown/no-missing-label-refs': 'error',
    },
  },

  // Prettier must be last — disables all formatting-related ESLint rules
  eslintConfigPrettier,
);
