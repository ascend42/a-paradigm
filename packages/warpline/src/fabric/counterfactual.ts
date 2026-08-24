/**
 * #git-counterfactual — WHAT GIT WOULD HAVE DECIDED, recorded on the live
 * verdict row at the moment the verdict was reached.
 *
 * THE PROBLEM THIS EXISTS FOR. The product claim is "meaning caught what bytes
 * missed." Every instrument needed to substantiate it already existed and was
 * wired to the wrong path: #oracle computes the git×meaning confusion matrix
 * (agreeClean / agreeConflict / divergeGitOnly / divergeMeaningOnly) but is an
 * OFFLINE MANUAL verb whose ledger (`.warpline/oracle.jsonl`, 11 MB / 28 rows)
 * has zero readers, while #shadow-gate — the only thing that fires on real work
 * — never called `mergeTree` at all. So at the end of a project the question
 * "would git have caught this?" had no evidence, and it is the ONE question
 * that cannot be reconstructed retroactively: the two commits are still there,
 * but WHICH PAIR a given verdict adjudicated is not recoverable once the
 * selvage has moved on. It has to be measured at verdict time or never.
 *
 * THE COUNTERFACTUAL. `git merge-tree --write-tree <theirs> <ours>` — the same
 * call #oracle makes at oracle.ts:160 — asked of the SAME two sides the meaning
 * verdict adjudicated: `ours` = the agent's proposed commit, `theirs` = the git
 * commit of the strand the selvage names. Git computes its own merge base, which
 * is exactly the question a human would have asked git ("merge these two"), so
 * the counterfactual is the real alternative and not a rigged one.
 *
 * THE TAXONOMY IS REUSED, NOT REINVENTED. `ConvergenceCell` names the four cells
 * of #oracle's confusion matrix verbatim, and `convergenceCellOf` partitions on
 * the same two predicates `score()` (oracle.ts:365-372) partitions on. The
 * binding is a TEST, not a comment: test/git-counterfactual.test.ts drives the
 * real `score()` through all four cells and asserts the cell this file names is
 * the cell oracle populates. A rename or a re-partition over there fails here.
 *
 * `unavailable` IS A REQUIRED ENUM, NEVER AN ABSENT FIELD. This row learned that
 * lesson once already, one field over: shadow.ts's `baseFrom` exists because a
 * FAST_ADMIT that had NO base to contend against was indistinguishable, on this
 * exact stream, from a FAST_ADMIT that had one and found no contest (audit C-9).
 * A counterfactual that is simply missing from a row would reproduce that trap
 * precisely — "git said clean" and "we never asked git" are opposite facts and
 * both would read as a hole. So every measurement attempt records its OUTCOME:
 * `unavailable: null` means git actually decided; any other value names WHY it
 * did not, and the four reasons are operationally distinct (a WORKTREE proposal
 * is uncommitted and unmergeable BY CONSTRUCTION; a null second ref is a fabric
 * whose tip predates git coexistence; an error is a broken repo; a timeout is a
 * slow one).
 *
 * BOUNDS. `conflictPaths` is capped the way shadow.ts:43 caps its symbol arrays
 * — a sorted, deterministic top-N with the EXACT total alongside — because a
 * conflicted merge on a monorepo can list thousands of paths and this row is
 * append-only telemetry.
 *
 * COSTS, STATED. The primary path (`git merge-tree --write-tree`, git ≥2.38)
 * WRITES the resulting tree into `.git/objects` — it is read-only with respect
 * to HEAD, the index and the worktree (and to `.warpline/` entirely, so the
 * shadow invariant holds), but it is not literally write-free. The objects are
 * a handful of trees, unreferenced and gc-able, and a fast-forward writes none
 * at all. The git<2.38 FALLBACK is far heavier (a throwaway worktree under a
 * per-repo lock), which is why every call is bounded by `timeoutMs`: this runs
 * on the auto-seal hook path and must never be able to wedge a commit.
 *
 * Library code: no console output.
 */

import { mergeTree, revParse, type MergeTreeResult, type GitOptions } from '../git/git-exec.js';
import { WORKTREE_REF } from '../absorb.js';

/**
 * THE PRE-FLIGHT, AND WHY IT IS NOT OPTIONAL (found by M18 while red-firsting
 * the 'no-two-refs' arm, 2026-08-10).
 *
 * `git merge-tree --write-tree` exits **1** for BOTH "the merge conflicted" and
 * "definitely-not-a-ref - not something we can merge". `git-exec.ts:563` keys on
 * `e.code === 1 && typeof e.stdout === 'string'`, so an UNRESOLVABLE REF comes
 * back as `{ conflicted: true, conflictPaths: [] }` — a clean-looking answer, no
 * throw, nothing for a `.catch()` to catch. Verified directly:
 *
 *     $ git merge-tree --write-tree --name-only definitely-not-a-ref HEAD
 *     merge-tree: definitely-not-a-ref - not something we can merge
 *     EXIT=1
 *
 * Left alone, a `provenance.gitCommit` naming a rebased-away or gc'd commit —
 * an ordinary occurrence — would land the verdict in `agreeConflict` or
 * `divergeGitOnly` on the strength of a git ERROR. That is a fabricated
 * measurement of exactly the claim this module exists to measure, which is
 * strictly worse than no measurement. So both sides are RESOLVED FIRST, and a
 * side that does not resolve is reported as 'git-error', never merged.
 *
 * NOTE FOR THE FOUNDER: the same conflation reaches `oracle.ts:160`, whose
 * `.catch()` cannot fire for this class of failure either. Fixing `mergeTree`
 * itself changes shared merge semantics on the oracle path, so it is REPORTED
 * rather than changed here.
 */
export interface CounterfactualGit {
  revParse(ref: string, opts: GitOptions): Promise<string>;
  mergeTree(a: string, b: string, opts: GitOptions): Promise<MergeTreeResult>;
}

const REAL_GIT: CounterfactualGit = { revParse, mergeTree };

/**
 * WHY a verdict was not measured against git. Required (see the module header):
 * `null` on the counterfactual means git decided; one of these names the reason
 * it could not, and no row is ever silent about which happened.
 *
 *   'worktree-ref'  the proposed side is WORKTREE — uncommitted work has no
 *                   commit for git to merge. Structural, not a failure.
 *   'no-two-refs'   one or both sides resolved to no git commit: a native
 *                   (git-null) strand, a fabric tip sealed before coexistence,
 *                   genesis, or a ledger too damaged to read a tip out of.
 *   'git-error'     git was asked and failed (missing object, corrupt pack,
 *                   EMFILE, a pruned commit). NEVER read as "clean" — that is
 *                   audit C-8's mistake, and here it would forge evidence.
 *   'timeout'       git was asked and did not answer inside timeoutMs.
 */
export type CounterfactualUnavailable = 'no-two-refs' | 'git-error' | 'timeout' | 'worktree-ref';

/**
 * The four cells of #oracle's git×meaning confusion matrix, at VERDICT scope.
 * Named identically to `OracleRecord['convergence']`'s arrays on purpose — one
 * taxonomy, two scopes (oracle partitions symbols; a shadow verdict is one
 * adjudication, so it lands in exactly one cell).
 *
 *   agreeClean          meaning admitted, git would have merged        (agreement)
 *   agreeConflict       meaning contested, git would have conflicted   (agreement)
 *   divergeGitOnly      meaning admitted, git would have CONFLICTED    ★ the text
 *                       noise Warpline absorbs — "we merged what git refused"
 *   divergeMeaningOnly  meaning CONTESTED, git would have merged clean ★ THE
 *                       HEADLINE — "meaning caught what bytes missed"
 */
export type ConvergenceCell = 'agreeClean' | 'agreeConflict' | 'divergeGitOnly' | 'divergeMeaningOnly';

/** Default bound on one counterfactual. It rides the auto-seal hook; it may never wedge a commit. */
export const COUNTERFACTUAL_TIMEOUT_MS = 20_000;

/** The git counterfactual for ONE adjudication (the shadow row's `gitCounterfactual`). */
export interface GitCounterfactual {
  /**
   * REQUIRED, and the discriminator for every other field: `null` ⇔ git was
   * asked and answered. See CounterfactualUnavailable for why absence is
   * forbidden here.
   */
  unavailable: CounterfactualUnavailable | null;
  /** the agent's proposed commit (the `ours` side), or null if there wasn't one. */
  ours: string | null;
  /** the commit of the strand the selvage named (the `theirs` side), or null. */
  theirs: string | null;
  /** git's verdict on merging the two. null ⇔ unavailable !== null. */
  gitConflicted: boolean | null;
  /** the confusion-matrix cell this adjudication lands in. null ⇔ unavailable !== null. */
  cell: ConvergenceCell | null;
  /** conflicting repo-relative paths — sorted, CAPPED (see conflictPathsTotal). */
  conflictPaths: string[];
  /** the exact number of conflicting paths, uncapped. */
  conflictPathsTotal: number;
  /** wall-clock spent asking git (0 when we never asked). */
  durationMs: number;
}

/**
 * The confusion-matrix partition, at verdict scope.
 *
 * This is the SAME partition `score()` performs per symbol at oracle.ts:365-372
 * — `m && g`, `!m && !g`, `!m && g`, `m && !g` — and the equivalence is pinned
 * by a test that drives the real `score()` through all four cells rather than
 * by this sentence.
 */
export function convergenceCellOf(meaningContested: boolean, gitConflicted: boolean): ConvergenceCell {
  if (meaningContested && gitConflicted) return 'agreeConflict';
  if (!meaningContested && !gitConflicted) return 'agreeClean';
  if (!meaningContested && gitConflicted) return 'divergeGitOnly';
  return 'divergeMeaningOnly';
}

export interface CounterfactualInput extends GitOptions {
  /** the proposed side's ref as the verdict named it (WORKTREE ⇒ 'worktree-ref'). */
  ref: string;
  /**
   * The two git commits the verdict's two meaning-sides correspond to, as the
   * ADMISSION resolved them under its own lock. Never re-derived here: a second
   * reader of the selvage would report a counterfactual against a tip the row's
   * own authority did not judge against (the mistake shadow.ts's `baseFrom`
   * docstring already refuses to repeat).
   */
  ours: string | null;
  theirs: string | null;
  /** did the MEANING verdict contest? (knots ∪ dangles non-empty — oracle's own predicate). */
  meaningContested: boolean;
  /** cap for `conflictPaths` (callers pass SHADOW_ROW_CAP — one constant, no second cap). */
  cap: number;
  /** bound on the git call (default COUNTERFACTUAL_TIMEOUT_MS). */
  timeoutMs?: number;
  /** TEST SEAM ONLY: substitute git, so the error/timeout arms are exercisable. */
  git?: CounterfactualGit;
}

const unmeasured = (
  reason: CounterfactualUnavailable,
  ours: string | null,
  theirs: string | null,
  durationMs = 0,
): GitCounterfactual => ({
  unavailable: reason,
  ours,
  theirs,
  gitConflicted: null,
  cell: null,
  conflictPaths: [],
  conflictPathsTotal: 0,
  durationMs,
});

/**
 * Ask git what it would have done with the same two sides, and place the
 * adjudication in the confusion matrix. NEVER THROWS — a counterfactual is
 * evidence, and evidence that can fail a verdict would make the instrument the
 * risk. Every failure becomes an explicit `unavailable` value.
 */
export async function gitCounterfactual(input: CounterfactualInput): Promise<GitCounterfactual> {
  const { ref, ours, theirs, meaningContested, cap } = input;
  const timeoutMs = input.timeoutMs ?? COUNTERFACTUAL_TIMEOUT_MS;

  // Structural, and checked FIRST: uncommitted work is not a thing git can be
  // asked to merge. Reporting this as 'no-two-refs' would be true but useless —
  // it would hide a permanent property of the proposal behind a transient-
  // sounding one.
  if (ref === WORKTREE_REF) return unmeasured('worktree-ref', ours, theirs);
  if (!ours || !theirs) return unmeasured('no-two-refs', ours, theirs);

  const git = input.git ?? REAL_GIT;
  const opts: GitOptions = { ...(input.cwd ? { cwd: input.cwd } : {}) };
  const t0 = Date.now();

  // PRE-FLIGHT (see CounterfactualGit): a side git cannot resolve must never
  // reach merge-tree, which would report it as a CONFLICT rather than an error.
  try {
    await Promise.all([git.revParse(`${theirs}^{commit}`, opts), git.revParse(`${ours}^{commit}`, opts)]);
  } catch {
    return unmeasured('git-error', ours, theirs, Date.now() - t0);
  }

  let reality: MergeTreeResult;
  try {
    let timer: NodeJS.Timeout | undefined;
    const TIMED_OUT = Symbol('timeout');
    const raced = await Promise.race([
      git.mergeTree(theirs, ours, opts),
      new Promise<typeof TIMED_OUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
        // never hold the event loop open on the diagnostic's account
        timer.unref?.();
      }),
    ]);
    if (timer) clearTimeout(timer);
    if (raced === TIMED_OUT) return unmeasured('timeout', ours, theirs, Date.now() - t0);
    reality = raced;
  } catch {
    // A git failure is NOT a clean merge. Audit C-8 is the whole family of bugs
    // that comes from reading an error as an absence; here it would manufacture
    // a false `agreeClean` and corrupt the only measurement of the headline claim.
    return unmeasured('git-error', ours, theirs, Date.now() - t0);
  }

  const paths = [...reality.conflictPaths].sort();
  return {
    unavailable: null,
    ours,
    theirs,
    gitConflicted: reality.conflicted,
    cell: convergenceCellOf(meaningContested, reality.conflicted),
    conflictPaths: paths.slice(0, cap),
    conflictPathsTotal: paths.length,
    durationMs: Date.now() - t0,
  };
}

/**
 * Resolve a ref to a commit for the `ours` side, or null. Exported so a caller
 * that has no AdmitResult to read the side off (a bare fixture, a future
 * consumer) resolves it the one way this module means it.
 */
export async function commitOf(ref: string, opts: GitOptions = {}): Promise<string | null> {
  if (ref === WORKTREE_REF) return null;
  return revParse(ref, opts).catch(() => null);
}
