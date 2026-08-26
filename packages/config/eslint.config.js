'use strict';
const { base, testOverrides } = require('./eslint/index.js');
module.exports = [
  ...base,
  testOverrides,
  { files: ['eslint/**/*.js', '*.js'], languageOptions: { sourceType: 'commonjs' }, rules: { '@typescript-eslint/no-require-imports': 'off' } },
];
