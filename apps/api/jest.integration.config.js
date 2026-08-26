'use strict';
module.exports = {
  displayName: 'integration',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test/integration'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    [String.raw`^.+\.ts$`]: ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleNameMapper: { '^src/(.*)$': '<rootDir>/src/$1' },
  // Real Postgres, real constraints, real transactions. Sequential because
  // several tests assert on transaction and locking behaviour itself.
  maxWorkers: 1,
  setupFiles: ['<rootDir>/test/support/env.ts'],
  testTimeout: 60_000,
};
