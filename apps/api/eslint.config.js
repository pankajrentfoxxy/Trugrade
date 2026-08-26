'use strict';
const { base, testOverrides } = require('@trugrade/config/eslint');

module.exports = [
  ...base,
  {
    rules: {
      /**
       * OFF for the API, deliberately.
       *
       * NestJS resolves constructor dependencies from `emitDecoratorMetadata`,
       * which needs the class VALUE at runtime. `import type { PrismaService }`
       * erases it and injection fails at boot with an unhelpful "can't resolve
       * dependency at index 1". The rule cannot tell a DI class from a plain
       * type, so it has to be off in the one place where the distinction matters.
       *
       * It stays ON in packages/*, which have no DI container.
       */
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
  testOverrides,
];
