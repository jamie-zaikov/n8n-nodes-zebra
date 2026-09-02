import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'jest.config.js', 'eslint.config.mjs'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // The transport/error layers intentionally narrow `unknown` from the
      // n8n SDK and HTTP responses; explicit `any` is used deliberately there.
      '@typescript-eslint/no-explicit-any': 'off',
      // Allow underscore-prefixed identifiers to mark intentional non-use.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Test files use Jest globals.
    files: ['**/*.test.ts'],
    languageOptions: {
      globals: { ...globals.jest },
    },
  },
);
