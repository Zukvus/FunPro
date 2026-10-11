import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['.output', '.wxt', 'node_modules', 'coverage', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.webextensions } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-restricted-properties': [
        'error',
        { object: 'document', property: 'write', message: 'Never use document.write.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "AssignmentExpression[left.property.name='innerHTML']",
          message: 'Assigning innerHTML is forbidden; use textContent or the sanitize helpers.',
        },
        {
          selector: "AssignmentExpression[left.property.name='outerHTML']",
          message: 'Assigning outerHTML is forbidden.',
        },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: ['tests/**', 'e2e/**', '*.config.ts', 'scripts/**'],
    languageOptions: { globals: { ...globals.node } },
  },
);
