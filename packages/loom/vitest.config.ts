import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    // Absorb spins up real git worktrees on this repo — generous timeout.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // ABSORB runs `git worktree add/remove`, which contends on a repo's
    // .git/worktrees locks. Running test FILES in parallel lets two absorbs
    // race on the same repo and intermittently throw — a test-infra artifact,
    // not an engine bug. Serialize files so the proof suite is deterministic.
    // (NB: the engine's worktree ops aren't concurrency-safe against one repo;
    // a future parallel-absorb feature like CONSOLIDATE must isolate/serialize
    // them — tracked separately.)
    fileParallelism: false,
  },
});
