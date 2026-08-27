'use strict';
/**
 * Mirrors `packages/ui/jest.config.js` — same environment, same transform.
 *
 * The app's own tsconfig is `jsx: preserve` and ESM, because that is what Next
 * compiles against; Jest runs the same files through ts-jest in CommonJS with
 * the automatic JSX runtime, which is the only difference and the reason the
 * overrides are inline here rather than in a second tsconfig file.
 */
module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.spec.tsx', '**/*.spec.ts'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  transform: {
    [String.raw`^.+\.tsx?$`]: [
      'ts-jest',
      {
        // Only `jsx` is overridden: Next compiles the app with `preserve`, and
        // Jest needs the automatic runtime. Module and resolution stay as the
        // app's own tsconfig has them so `@trugrade/*` resolve through their
        // `exports` maps exactly as they do in a build.
        tsconfig: { jsx: 'react-jsx' },
      },
    ],
  },
  moduleNameMapper: { [String.raw`\.css$`]: '<rootDir>/test-stubs/style.js' },
};
