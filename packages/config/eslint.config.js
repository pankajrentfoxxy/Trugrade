'use strict';
const { base, testOverrides } = require('./eslint/index.js');

module.exports = [
  ...base,
  testOverrides,
  {
    // The rule's own test fixtures ARE cross-schema SQL — that is what they assert.
    files: ['eslint/__tests__/**'],
    rules: { '@trugrade/no-cross-schema-join': 'off' },
  },
  {
    files: ['eslint/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { module: 'writable', require: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off', 'no-undef': 'off' },
  },
];
