'use strict';
const { base, testOverrides } = require('@trugrade/config/eslint');

// The Next ESLint plugin is deliberately absent: it duplicates rules `base`
// already enforces and pulls a second, conflicting TypeScript parser config.
// `next build` warns about this; the warning is expected, not a gap.
module.exports = [
  ...base,
  testOverrides,
  {
    // `next.config.mjs` runs in Node, not the browser. Flat config has no
    // `eslint-env` comment, so the globals are declared here instead.
    files: ['next.config.mjs', '*.config.mjs'],
    languageOptions: { globals: { process: 'readonly' } },
  },
];
