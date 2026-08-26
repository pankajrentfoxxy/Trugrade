'use strict';
const { base, testOverrides } = require('@trugrade/config/eslint');

module.exports = [
  ...base,
  { ignores: ['.expo/**', 'android/**', 'ios/**'] },
  testOverrides,
];
