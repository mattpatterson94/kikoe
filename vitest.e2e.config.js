import { defineConfig } from 'vitest/config';

// Separate from vitest.config.js: these specs drive a real browser with the
// built extension loaded, so they need a build, a display, and far longer
// timeouts than the jsdom suites. `npm test` never runs them.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/e2e/**/*.spec.mjs'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Chromium loads extensions only in a headed browser, and each file
    // launches its own — keep them sequential.
    fileParallelism: false,
  },
});
