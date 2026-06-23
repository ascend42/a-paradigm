import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    // Absorb spins up real git worktrees on this repo — generous timeout.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
