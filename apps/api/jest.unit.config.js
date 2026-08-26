'use strict';
module.exports = {
  displayName: 'unit',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test/unit'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    [String.raw`^.+\.ts$`]: ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleNameMapper: { '^src/(.*)$': '<rootDir>/src/$1' },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.module.ts', '!src/main.ts'],
  coverageThreshold: {
    // 04_TEST_PLAN.md §1.2. The money, tax and grading paths carry a higher gate
    // than the rest of the codebase because a bug there is not a bug, it is a
    // GST notice or a mis-graded machine sold on our own invoice.
    global: { lines: 85, branches: 80, functions: 85 },
  },
};
