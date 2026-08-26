'use strict';

const js = require('@eslint/js');
const tseslint = require('typescript-eslint');
const prettier = require('eslint-config-prettier');
const trugrade = require('./plugin');

const IGNORES = [
  '**/dist/**',
  '**/.next/**',
  '**/coverage/**',
  '**/storybook-static/**',
  '**/node_modules/**',
  '**/prisma/generated/**',
  '**/*.d.ts',
];

/**
 * Base config shared by every workspace package.
 * `no-cross-module-import` and `no-cross-schema-join` are errors, not warnings —
 * a boundary you can merge past is not a boundary.
 */
const base = [
  { ignores: IGNORES },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { '@trugrade': trugrade },
    rules: {
      '@trugrade/no-cross-module-import': 'error',
      '@trugrade/no-cross-schema-join': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'no-restricted-syntax': [
        'error',
        {
          // The clock is injectable everywhere so 90-day expiry, 2-day auto-apply and
          // token TTLs are testable without sleeping. 04_TEST_PLAN.md §1.4.1.
          selector: 'MemberExpression[object.name="Date"][property.name="now"]',
          message:
            'Use ClockPort/useClock() instead of Date.now() so time-dependent rules stay testable.',
        },
      ],
    },
  },
  prettier,
  {
    // Tooling config files (jest.config.js, postcss.config.js, tailwind…) are
    // CommonJS and run in Node. Every package has them, so the exemption lives
    // here once rather than in four near-identical local configs.
    files: [
      '**/*.config.js',
      '**/*.config.cjs',
      '**/eslint.config.js',
      '**/*-preset.js',
      '**/test-stubs/**',
    ],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        module: 'writable',
        require: 'readonly',
        __dirname: 'readonly',
        process: 'readonly',
      },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off', 'no-undef': 'off' },
  },
];

/** Test files legitimately need `any`, real timers and console output. */
const testOverrides = {
  files: [
    '**/*.spec.ts',
    '**/*.test.ts',
    '**/*.spec.tsx',
    '**/*.test.tsx',
    '**/test/**',
    '**/tests/**',
    '**/e2e/**',
  ],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    'no-restricted-syntax': 'off',
    'no-console': 'off',
  },
};

module.exports = { base, testOverrides, IGNORES, plugin: trugrade };
