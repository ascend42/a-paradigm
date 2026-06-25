/**
 * absorb-concurrency.test — the proof that ABSORB is concurrency-safe.
 *
 * Regression for T-2026-06-23-003: absorb used `git worktree add/remove`, which
 * lock on `.git/worktrees`, so two concurrent absorbs against ONE repo could throw
 * — the reason vitest ran with `fileParallelism:false`. The fix materializes a
 * ref's tree via `git archive | tar` (no worktree, no lock). This file fires N
 * absorbs at once on THIS repo and asserts they all succeed AND stay byte-identical
 * under parallelism (the ~determinism invariant must survive concurrency).
 */

import { describe, it, expect } from 'vitest';
import { absorb } from '../src/absorb.js';
import { materializeTree } from '../src/git/git-exec.js';

describe('absorb — concurrency (T-2026-06-23-003)', () => {
  it('N concurrent absorbs of DIFFERENT refs all succeed', async () => {
    const refs = ['HEAD', 'HEAD~1', 'HEAD~2', 'HEAD~3'];
    const states = await Promise.all(refs.map((r) => absorb(r)));
    expect(states).toHaveLength(refs.length);
    for (const s of states) {
      expect(s.objects.size).toBeGreaterThan(0);
      expect(s.stateId.startsWith('state:v0:')).toBe(true);
    }
  });

  it('concurrent absorbs of the SAME ref stay byte-identical (determinism under parallelism)', async () => {
    const [a, b, c, d] = await Promise.all([
      absorb('HEAD'),
      absorb('HEAD'),
      absorb('HEAD'),
      absorb('HEAD'),
    ]);
    for (const other of [b, c, d]) {
      expect(other.stateId).toBe(a.stateId);
      expect(other.objects.size).toBe(a.objects.size);
    }
  });

  it('a high-fanout burst against one repo does not throw on worktree locks', async () => {
    // 8 concurrent absorbs of one ref — the exact shape that threw under the
    // worktree impl. Promise.all rejects if ANY throws; one stateId proves all
    // succeeded AND stayed deterministic.
    const burst = Array.from({ length: 8 }, () => absorb('HEAD'));
    const states = await Promise.all(burst);
    const ids = new Set(states.map((s) => s.stateId));
    expect(ids.size).toBe(1);
  });

  it('materializeTree REJECTS on an invalid ref (no silent empty tree, no hang)', async () => {
    // The materialize path must fail loudly on bad input — never return a dir that
    // would lift to a wrong/empty WarpState. revParse(--verify) rejects the ref
    // before the pipe runs; the temp dir is cleaned up internally.
    await expect(materializeTree('definitely-not-a-real-ref-zzz')).rejects.toThrow();
  });
});
