'use strict';
const { base, testOverrides } = require('@trugrade/config/eslint');
module.exports = [...base, testOverrides];
