import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    // Absorb materializes ref trees with `git archive | tar` — generous timeout.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // PARALLEL — ABSORB no longer spins `git worktree` (it materializes via
    // `git archive | tar`, which takes no `.git/worktrees` lock), so concurrent
    // absorbs against one repo are safe (T-2026-06-23-003). The cold git<2.38
    // merge-tree fallback is the one remaining worktree user and is serialized
    // per-repo via #repo-lock. test/absorb-concurrency.test.ts is the proof.
    fileParallelism: true,
  },
});
