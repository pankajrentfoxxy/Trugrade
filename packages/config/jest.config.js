'use strict';
module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/eslint', '<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.test.js', '**/*.spec.ts'],
  transform: {
    [String.raw`^.+\.ts$`]: ['ts-jest', { tsconfig: '<rootDir>/tsconfig.build.json' }],
  },
};
