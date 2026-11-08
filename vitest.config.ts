import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // The suite starts a worker per file, so a loaded machine slows every test. Two replay tests set longer limits of their own.
    testTimeout: 15_000,
  },
  // vite.config.ts sets this from package.json for the app. Tests never show a version.
  define: { __APP_VERSION__: '"test"' },
});
