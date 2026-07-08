import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,       // test/expect/describe/vi available without imports
    environment: 'jsdom',
    exclude: ['**/node_modules/**', '**/dist/**', '**/.claude/worktrees/**', '**/Kikoe/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**', 'extension/**'],
      exclude: ['src/candidates/*.test.js'],
    },
  },
});
