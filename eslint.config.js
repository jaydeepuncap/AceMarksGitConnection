import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', '.wrangler', 'node_modules', 'migrations', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': ['warn', { allow: ['warn', 'error', 'info', 'log'] }],
    },
  },
  {
    files: ['app/**/*.{ts,tsx}', 'test/app/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['worker/**/*.ts'],
    languageOptions: { globals: globals.serviceworker },
    rules: {
      // Worker code must log through worker/lib/logger.ts so secrets are redacted.
      'no-console': 'error',
    },
  },
  {
    files: ['worker/lib/logger.ts', 'scripts/**', 'test/**', '*.config.{js,ts}'],
    languageOptions: { globals: globals.node },
    rules: { 'no-console': 'off' },
  },
);
