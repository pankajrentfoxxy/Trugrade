import { defineConfig } from 'vitest/config';

/**
 * The offline queue is the part of this app that loses a day's work when it is
 * wrong, so it is written as plain TypeScript over a three-method SQLite port
 * and tested here against `node:sqlite` — real SQLite, real SQL, no simulator.
 *
 * Nothing under `test/` imports an `expo-*` module, and nothing the tests import
 * does either: `src/db/db.ts`, `src/queue/*` and `src/api/transport.ts` are all
 * deliberately free of React Native so this suite runs in CI on a plain Node.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
  },
});
