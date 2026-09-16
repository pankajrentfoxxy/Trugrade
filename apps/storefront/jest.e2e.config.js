'use strict';
/**
 * Browser tests, out of band — the shape `apps/api` already uses for the tests
 * that need a real dependency running.
 *
 * `jest.config.js` is jsdom and its roots stop at `src`, so these never load in
 * `pnpm test`. They drive a real Chromium against a real dev server and a real
 * database, which is the only way to answer the two questions asked here: does
 * a page overflow its viewport, and can a new buyer reach a placed order
 * without a human in the loop.
 *
 * `pnpm test:e2e`, with the storefront on :3000 and the API on :4000.
 */
module.exports = {
  displayName: 'e2e',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.spec.ts'],
  transform: {
    [String.raw`^.+\.ts$`]: ['ts-jest', { tsconfig: '<rootDir>/test/tsconfig.json' }],
  },
  // One browser, one database. Several of these place orders against real
  // stock, and two workers racing for the same serial is a false failure.
  maxWorkers: 1,
  testTimeout: 180_000,
};
