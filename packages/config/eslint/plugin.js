'use strict';

module.exports = {
  meta: { name: '@trugrade/eslint-plugin', version: '1.0.0' },
  rules: {
    'no-cross-module-import': require('./rules/no-cross-module-import'),
    'no-cross-schema-join': require('./rules/no-cross-schema-join'),
  },
};
