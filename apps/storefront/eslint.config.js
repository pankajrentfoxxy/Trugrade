'use strict';
const { base, testOverrides } = require('@trugrade/config/eslint');

// The Next ESLint plugin is deliberately absent: it duplicates rules `base`
// already enforces and pulls a second, conflicting TypeScript parser config.
// `next build` warns about this; the warning is expected, not a gap.
module.exports = [...base, testOverrides];
