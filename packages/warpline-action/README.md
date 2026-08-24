# Warpline Guard — GitHub Action

Warpline Guard deterministically flags contested-symbol knots your typechecker and tests provably missed. On every pull request it lifts PR-head and base to a symbol-level meaning graph, predicts the merge from meaning, runs git's real merge read-only, and reports the one stratum where the two disagree: merges git completes clean while both branches changed the same symbol's meaning. Meaning judges, bytes execute, disagreement fails closed — decide before `tsc` has to.

Advisory by default: the check reports, it never blocks unless you opt in with `fail-on-flag: true`.

## What it does

1. **Merge-base.** For the PR's head × base pair, the engine (`@a-company/warpline`) computes the git merge-base itself.
2. **Lift.** Base, head, and merge-base trees are lifted through the TypeScript code lens into content-addressed meaning states (per-symbol essence hashes over declarations, signatures, and bodies).
3. **Adjudicate.** The oracle predicts the merge from meaning (clean / knot / dangling reference), runs `git merge-tree --write-tree` read-only for byte reality, and scores where the two verdicts diverge.
4. **Report.** Direct-contested symbols (a symbol whose own content changed on both sides) are listed first with both branches' touch points; ripple-only flags (a dependency's meaning shifted transitively) fold to a count and are never listed. A JSON report is written for machine consumption; a job summary renders the human verdict.

Everything is read-only and deterministic: same trees in, same verdict out. No network calls, no LLM, no state written to your repo.

## Quick start

```yaml
# .github/workflows/warpline-guard.yml
name: Warpline Guard
on:
  pull_request:
    branches: [main]
permissions:
  contents: read
jobs:
  guard:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0 # the oracle needs the merge-base locally
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      # Until the action is published, consume it from a checkout of this
      # monorepo (see "Consuming the action", below). Once published:
      # uses: ascend42/warpline-action@v0
      - uses: ./packages/warpline-action
        id: guard
        with:
          fail-on-flag: 'false' # advisory (the default)
      - uses: actions/upload-artifact@v4
        if: always() && steps.guard.outputs.report-path != ''
        with:
          name: warpline-guard-report
          path: ${{ steps.guard.outputs.report-path }}
```

## Inputs

| input | default | meaning |
|---|---|---|
| `base-ref` | PR event `base.sha` | base side of the adjudication |
| `head-ref` | PR event `head.sha` | head side (the PR) |
| `threshold` | `6` | max direct-contested knot size to LIST (see "Why 6") |
| `paths` | *(all)* | comma/newline-separated globs (`*`, `**`, `?`); only flags in matching files are listed and failed on |
| `fail-on-flag` | `false` | `true` = fail the step on an in-stratum flag, and fail closed on engine errors |
| `working-directory` | `.` | repo checkout to adjudicate |
| `report-path` | `warpline-guard-report.json` | where the JSON report is written |

## Outputs

| output | meaning |
|---|---|
| `verdict` | `clean` \| `ripple-only` \| `flagged` \| `avalanche` \| `git-conflict` \| `error` |
| `knot-size` | direct-contested symbol count (the validated ranking key) |
| `flag-count` | raw meaning-flag count (direct + ripple) |
| `report-path` | absolute path of the JSON report |

## The evidence (with its scope)

All numbers come from the base-rate and ground-truth experiments in this repo (`.paradigm/research/warpline-guard-base-rate/`), run on plain clones of three external TypeScript repos (zod, nest, xstate):

- **6.2% of 275 real git-clean merges flagged** (17 merges across the three primary samples; 360/360 oracle runs succeeded, zero errors, zero timeouts). In a human-PR-merge era sample (zod 2021–2022) the rate was 13.1% of git-clean merges; in bot-dominated dependency-bump traffic it was 0% — correctly, since dependency bumps are meaning-empty.
- **18/18 flagged git-clean merges ground-truthed** (checkout, `tsc`, repo tests, post-merge fixup-commit scan).
- **Knot-size ≤6 stratum: 50% churn-validated precision** — of the 6 ground-truthed hits whose direct-contested flag set was ≤6 symbols, 3 were repaired by the maintainers within days, on exactly the flagged symbols. Every flag set of ≥10 symbols validated at 0% (essence-transitivity avalanches). That stratum boundary is the default threshold.
- **Deterministic, 1.4–5.4 s median per merge** on warm clones of those repos (single-package and monorepo layouts).

### Worked example: zod `66cbfe09`

PR #752 changed `ZodRecord` to `Partial<Record<...>>` on one side; master moved on the other. Git merged clean. `tsc` was green at the merge and both parents; `record.test.ts` was 8/8 green at all three — the defect is type-level, so runtime tests cannot see it. The oracle flagged exactly `{ZodRecord, ZodRecord.create}` — a 2-symbol flag, no avalanche. The next day the maintainer shipped `ceca9e7722` "Fix record type", rewriting exactly those types. Every gate the repo had was green; the defect was real; a human paid to fix it in under 24 hours; this flag was the only automated signal pointing at the right two symbols.

## Why the default threshold is 6

The oracle's essence is transitive: a symbol's meaning includes the meaning of what it references, so one genuinely contested unit can avalanche into a 48–176-symbol flag set. Ground truth says flag volume inversely predicts payoff: ≤6-symbol sets were 50% churn-validated, ≥10-symbol sets were 0%. Guard therefore lists symbols only when the direct-contested knot size is within the threshold; larger sets are reported as a folded avalanche count, never as a wall of symbols. Raising the threshold buys you listings from a stratum with no evidence behind it.

## Limitations — read before trusting a green check

- **TypeScript-only.** The meaning lens covers `.ts`/`.tsx`. Other languages pass through unexamined.
- **Structural, not semantic.** The lens hashes declarations, signatures, bodies, and reference structure. It does not execute or reason about behavior.
- **Symbol-local.** A knot is two branches contesting the *same symbol's* meaning. Cross-symbol dataflow interference — branch A changes what `f` returns, branch B adds a caller of `f` elsewhere — is out of scope today.
- **Ripple flags are folded, not solved.** Ripple-only flags are the noise budget of transitive essence; Guard folds them to a count rather than pretending they are actionable.
- **The precision number is n=6.** The 50% figure comes from six ground-truthed in-stratum hits. Honest, but small; treat it as an evidence-based prior, not a warranty.
- **A quiet run means Warpline found no contested-symbol knots — not that the merge is correct.**

## JSON report

The action writes a `GuardReport` (schema in `src/report.ts`): verdict, knot size, per-flag detail (symbol, file, kind, contested slots, both branches' touch points), the folded ripple count, git reality (conflict paths), the threshold and filter used, and the scope line. Consume it from `steps.<id>.outputs.report-path`.

## Consuming the action from this monorepo

The action is a composite step that runs `dist/main.js` with the engine resolved as a workspace dependency. In this repo's own CI it is consumed by local path after a build (see `.github/workflows/warpline-guard.yml`):

```bash
npm ci
npm run build --workspace=@a-company/purpose-core
npm run build --workspace=@a-company/portal-core
npm run build --workspace=@a-company/premise-core
npm run build --workspace=@a-company/warpline
npm run build --workspace=@a-company/warpline-action
```

The package is `private: true` and is **not published** — neither to npm nor to the GitHub Marketplace. It is designed so that publishing later means: pin `@a-company/warpline` as an npm dependency, commit a self-contained `dist/`, and tag a release — no source changes.

## Development

```bash
npm run build --workspace=@a-company/warpline-action   # tsup → dist/main.js
npm run test --workspace=@a-company/warpline-action    # vitest (report core, rendering, packaging lint)
npm run typecheck --workspace=@a-company/warpline-action
```

The pure core (`src/report.ts`, `src/render.ts`) has no I/O and carries the unit tests; `src/main.ts` is the only file that touches env, filesystem, and exit codes.
