import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,       // test/expect/describe/vi available without imports
    environment: 'jsdom',
    // tests/e2e drives a real browser and needs a build — see
    // vitest.e2e.config.js and `npm run test:e2e`.
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/worktrees/**', '**/Kikoe/**', 'tests/e2e/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**', 'extension/**'],
      exclude: ['src/candidates/*.test.js'],
    },
  },
});
