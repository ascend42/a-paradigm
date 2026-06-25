/**
 * #repo-lock — a per-repo, in-process async mutex.
 *
 * ABSORB's tree materialization is now lock-free (`git archive` touches no
 * `.git/worktrees` state), but the git<2.38 mergeTree FALLBACK still spins a real
 * `git worktree`, which takes the repo's worktree lock. Serialize those (and any
 * future worktree user) per RESOLVED repo root so concurrent calls in one process
 * can't race the lock. In-process only — cross-process contention would need a
 * `.git`-level flock (out of scope; the parallel-absorb path no longer needs it).
 *
 * Library code: no console output.
 */

const chains = new Map<string, Promise<unknown>>();

/**
 * Run `fn` with exclusive access for `repoRoot`. Calls keyed by the same repo run
 * strictly one-at-a-time, in arrival order. A predecessor's rejection never blocks
 * or poisons later callers; `fn`'s own result/rejection is returned to its caller
 * unchanged. Distinct repo roots run concurrently.
 */
export function withRepoLock<T>(repoRoot: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(repoRoot) ?? Promise.resolve();
  // Run fn after prev settles either way — a predecessor's error must not block us.
  const result = prev.then(fn, fn);
  // The stored chain tail must never reject, or the next caller would skip its turn.
  chains.set(repoRoot, result.then(noop, noop));
  return result;
}

function noop(): void {
  /* swallow — used only to keep the chain tail non-rejecting */
}
