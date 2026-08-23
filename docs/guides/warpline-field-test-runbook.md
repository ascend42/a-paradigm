# Warpline Expo field-test — operator runbook

Status: DRAFT (2026-08-23). Companion to the pre-registration — v2 DRAFT
`.paradigm/research/warpline-native-first/expo-field-test-protocol-v2.md` (supersedes the
immutable v1) — the protocol is the law; this is the checklist. **The run may not start** until v2's §C freeze
checklist is fully checked (founder rulings TD-2026-08-23-042: M3 built first; subject = the
founder's forthcoming new Expo app; agents = claude-opus-4-8). Readiness analysis:
`.paradigm/research/warpline-native-first/field-test-readiness-2026-08-23.md`.

Tooling: the full `warpline field oracle|cards|fallback|judge|join|score` pipeline is BUILT (T-2026-08-23-003 closed @ 39002602).

## 0. Pre-run gates (all must be checked, in writing, before admission 1)

- [ ] Founder gates F1–F7 closed (`T-2026-08-23-001`) — pre-registration v2 is DRAFTED (TD-2026-08-23-042) —
      founder ratification + the freeze checklist in v2 §C are what remain.
- [ ] Subject prepared (the founder's new Expo app, v2 §A2): `npm install`; `npx tsc --noEmit`
      GREEN at base; `npx expo export` succeeds; declared green-gate set frozen in
      `.warpline/field/greengate.json`; behavioral checklist authored + frozen (its assertions
      enumerate the config×code couplings — couplings not listed are BLIND, not passed).
- [ ] `.warpline` onboarded on the subject; `.warpignore` covers agent worktrees (runbook
      `warpline-multi-instance-demo.md` §A2); daemon up; one MCP token per instance.
- [ ] **Habit (i) — MCP only, verified:** every agent's Warpline access is through the daemon
      MCP surface. Swarm agents' Claude Code tool permissions DENY `Bash(warpline*)`,
      `Bash(node*cli.js*)`, and raw `git` write commands. The subject's
      `.claude/settings.local.json` currently pre-allows `git add/commit/push` — REMOVE for
      agent instances. `$WARPLINE_AGENT_ID` is self-asserted; permissions are the enforcement.
- [ ] Agents launched with the pinned model: `claude --model claude-opus-4-8` (v2 §A1).
      Record the launch command in the run log.
- [ ] Judge credentials: the operator's standard account (SDK zero-arg chain — API key, auth
      token, or `ant auth login` OAuth profile; v2 §A10). Whatever the source, it lives ONLY
      in the judge operator shell — never in any agent env. `@anthropic-ai/sdk` installed.
- [ ] Seeds sealed BEFORE the run: planted false-CLEAN control (A6), KNOWN-GENUINE /
      KNOWN-OVER-BLOCK classifier seeds (A11), the injection corpus (v2 §A9 —
      externally-authored PUBLIC payload strings in team-built cards, stated so; membership sealed).
      Commit the sha256 of each sealed set to git before admission 1.
- [ ] Backlog fixed before the run, with overlap zones (readiness doc §D: Z1 same-screen,
      Z2 tab shell, Z3 services×screens, Z4 ≤20% zero-unit) — overlap engineered into the
      WORK, never the verdict.
- [ ] Live judge regression executed once: `WARPLINE_JUDGE_LIVE=1 npx vitest run
      test/judge-regression.test.ts` (real API; case-13/case-20).

## 1. The loop, per admission

1. Agent pulls the next backlog task → fork → propose → admit (MCP; exit 1 on KNOT is the
   fail-closed signal, not a crash).
2. After every CLEAN seal: `warpline field oracle` — restores parents + merge, runs the
   frozen green-gate + behavioral checks with the §4 power rule, appends the hash-chained
   row to `.warpline/field/expo-field-oracle.jsonl`. Run it at least at every batch boundary;
   a CLEAN the oracle never examined cannot count toward (A) surviving.
3. On every KNOT: `warpline field cards` — captures the blinded rating card from the
   persisted payload BEFORE resolve (habit ii). Record the founder's genuine/over-block call
   in the run log at resolve time; the founder's call is recorded but is NOT the denominator.
   Byte-downgrade KNOTs without payloads are recorded in `byte-downgrades.jsonl` — they are
   still contested-denominator rows (B-3).
4. Any reach for git to make progress — merge, stash, manual resolution, working around a
   wedge: `warpline field fallback -m "<what and why>" [--knot <id>]` (habit iii). Silent
   fallbacks understate (C) in the flattering direction.
5. Resolve is HUMAN-ONLY, founder console token only.

## 2. Judge batches (any cadence; batched is fine)

1. `warpline field judge` — interleaves KNOT cards + oracle-flagged + every-5th CLEAN
   (floor 15/block) + seeds + corpus by a committed shuffle seed; runs the blocking pre-flight
   (twin-invariant + injection corpus — an empty corpus now DISQUALIFIES); appends to the
   loaded hash-chained ledger (multi-batch continuity is enforced in code since ec546c4d).
2. **WITNESS BEFORE JOIN — the human step the code cannot do:** after every judge batch,
   commit the witness head into git BEFORE any Warpline verdict is joined:
   `git add .warpline-judge/expo-field-audit.head* && git commit -m "witness: judge ledger head <head>"`.
   A join before the witness commit voids the write-before-reveal claim (§3 A13). The
   witness file must live inside a git-tracked path — set `--out` accordingly.
3. `warpline field join` — refuses unless the current head chains forward from a
   git-committed witness. Only then are Warpline verdicts joined.

## 3. Close of block (n = 100 sealed admissions, exactly)

- No early stop, no extension, no interim analysis (§3). A confirmed false CLEAN records (A)
  FALSIFIED at the instant it fires and the run continues.
- `warpline field score` — §7A two separate bounds (never blended), §7B meaning-decisive
  rate vs the git three-way baseline, §7C intervention rate + fallback log, seeded
  precision/recall with the Wilson lower bound vs the 0.29 prior, indeterminate fraction
  (GENUINE-only drain), kappa with the correlated-priors caveat. Genuine (blinded, corrected)
  < 20 → (B)/(C) are reported INCONCLUSIVE — never as surviving.
- Final ledger verify + confirm the head chains from every intermediate witnessed head.

## Known traps (from the readiness panel)

- One human editing serially produces zero KNOTs — contention comes only from the backlog's
  overlap zones, engineered before the run.
- Same-screen pairs (Z1) were the dominant over-block generator on the surveyed subject —
  re-derive the zones on the new app; if the
  backlog is Z1-heavy, over-block > genuine and (C) falsifies honestly.
- `tsc` is pinned blind to the canonical invariant-conflict class — only the frozen
  behavioral checklist catches it; the planted control (A6) proves the pipeline can.
- Zero-unit-only proposals behind the tip NOOP without sealing (B-1) — a dead-end that
  becomes a logged git fallback; keep every backlog task touching at least one lifted unit.
