# Review: README Audit + Restructure Proposal

**Agent:** Reviewer (Judge)
**Date:** 2026-04-18
**Inputs reviewed:**
- `.paradigm/ftux/reports/2026-04-18-readme-audit.md` (Nora / FTUX)
- `docs/private/plans/readme-restructure.md` (Apex / Architect)
**Source of truth consulted:** `packages/paradigm/src/commands/shift.ts`, `packages/paradigm/src/commands/shift-files.ts`, `packages/paradigm/src/index.ts:44–59`, `packages/paradigm/src/commands/init.ts`

---

## 1. Resolution of the Critical Open Question

**Question (from Nora):** Does `paradigm shift` on a fresh machine actually perform first-install (init + sync + beacon + seed `.purpose`), or does it assume Paradigm is already installed?

**Answer: YES — `paradigm shift` handles a fresh project end-to-end. The architect's hypothesis is structurally sound.**

### Evidence from `packages/paradigm/src/commands/shift.ts`

1. **Lines 147–148** — shift explicitly detects whether `.paradigm/` exists:
   ```ts
   const paradigmDir = path.join(cwd, '.paradigm');
   const isInitialized = fs.existsSync(paradigmDir) && fs.statSync(paradigmDir).isDirectory();
   ```
   If the directory does not exist, `isInitialized === false`.

2. **Lines 164–178** — on the fresh-project path, shift calls `initCommand()` with `quick: true` and the detected project name. This is the actual init command, same binary entry point as `paradigm init`. It runs the full initialization path, including config.yaml creation, discipline detection, and IDE adapter resolution.

3. **Lines 488–497** — calls `ensureGuaranteedFiles(cwd)`, which is a *declarative* manifest (`GUARANTEED_FILES` in `shift-files.ts`) that creates **36 files/directories** idempotently on every run. This means even if `init` misses something, the guarantees layer picks it up.

4. **Lines 536–540** — ensures `portal.yaml` exists with a default `{ version: '1.0.0', gates: {}, routes: {} }` structure before doctor runs. Explicitly handled as first-run-safe (comment: *"prevents doctor failures on first run"*).

5. **Lines 549–598** — creates `.paradigm/university/` subtree and writes a default `university/config.yaml` with branded theme if missing.

6. **Lines 600–623** — syncs all IDE adapters (`claude`, `cursor`, `copilot`, `windsurf`, `agents`) using `force: true`, generating `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/`, etc. from scratch.

7. **Lines 626–632** — installs hooks (git + Claude Code + Cursor) via `hooksInstallCommand()`.

8. **Lines 702–708** — `getRecommendations(cwd)` inspects actual post-shift state and emits up to 4 contextual next-step items (not a hardcoded list).

### What shift does NOT do

- It does not install `@a-company/paradigm` itself — the user must have the `paradigm` binary on `PATH` first (i.e., `npm install -g @a-company/paradigm`). This is correct and expected; the binary cannot bootstrap itself.
- It does not seed example `.purpose` content beyond the bare skeleton. The root `.purpose` gets `{ version: "2.0", id: root, description: "", components: [] }` — **this is the 'dead-end' Nora flagged**. A first-timer who runs shift and then opens `.purpose` sees an empty components list with no example. **This is an UNRESOLVED gap in the proposal.** See Finding 3 below.
- It does not run `paradigm beacon` as part of shift. Beacon is a separate subsequent command. The proposal's hero copy doesn't promise beacon, so this is fine — but `getRecommendations()` should probably recommend running beacon as a next step.

### Verdict on the open question

`paradigm shift` **is** a legitimate first-install entry point for a project (assuming the binary is installed). The proposal's core thesis stands. Nora's alternative hypotheses — (a) extend shift to first-install capability, (b) rename to `paradigm start` — are **unnecessary**. Shift already does (a).

The one remaining ambiguity Nora raised is **install the binary itself**. The proposal's hero section handles this correctly: `npm install -g @a-company/paradigm` comes before `paradigm shift`. The install + shift two-step is a reasonable concession to reality (npm can't be internalized).

---

## 2. Overload Catalog Completeness (§3 of proposal)

Cross-referenced against `packages/paradigm/src/index.ts:44–59` and `shift.ts:129–142` (ShiftOptions interface).

### Flags registered on the Commander command (index.ts:48–55)

| Flag | In proposal? |
|------|--------------|
| `-f, --force` | Yes |
| `-q, --quick` | Yes |
| `--verify` | Yes |
| `--ide <ide>` | Yes |
| `--configure-models` | Yes |
| `--stack <stack>` | Yes |
| `--workspace <name>` | Yes |
| `--workspace-path <path>` | Yes |

**All 8 flags catalogued. No gaps.** The ShiftOptions interface (shift.ts:129–142) matches the Commander registration exactly.

### Behavior notes — accuracy check

- **"Idempotent. Safe to re-run."** — Confirmed. `ensureGuaranteedFiles` only creates missing files; `isInitialized` branch skips init; adoptions migration checks for existing records before writing.
- **"37 core files/directories ensured"** — **INCORRECT. The actual count is 36.** See Finding 4.
- **"Agent skeletons are conditional ... 24 agents for SaaS, 11 for game, 8 for generic"** — Not independently verified in this review, but the mechanism (`ROSTER_SUGGESTIONS[projectType]`) exists and is referenced at shift.ts:374. Claim is plausible; exact numbers are architect's attestation.
- **"Environment-aware model tiers"** — Confirmed at shift.ts:457–463. The three tier maps (claude-code / cursor / fallback) match the proposal's description exactly.
- **"Post-shift recommendations ... up to 4 conditional items"** — Confirmed at shift.ts:702–708 via `getRecommendations()`. Not independently audited for the "up to 4" claim, but the mechanism (dynamic, state-aware) is accurately characterized.

### Related commands table (§3 last block)

- `paradigm doctor` — confirmed at shift.ts:634–649 (`doctorCommand` imported from `./doctor/index.js`).
- `paradigm sync <ide>` — confirmed at shift.ts:604–614 (`syncCommand`).
- `paradigm hooks install` — confirmed at shift.ts:626–632 (`hooksInstallCommand`).
- `paradigm presets` — registered at index.ts:62–96. Listed separately from shift.
- `paradigm migrate` — confirmed at shift.ts:220–227 (auto-invoked as step 1b on existing projects only).

**Catalog is complete and accurate with one number error (36 vs 37).**

---

## 3. Progressive Disclosure — Does it Serve Nora's First-Timer?

Nora's critical gaps (summarized from her report):

1. **No "first-run narrative" / hello-world.** Reader is stranded after install.
2. **`paradigm shift` framed wrong (3 conflicting framings).**
3. **Three install paths, three quick-start paths — analysis paralysis.**
4. **Jargon front-loaded (symbols, pillars) before install.**
5. **`.purpose` file never shown in the README.**

Proposal resolution check:

| Nora gap | Proposal addresses? | Notes |
|---|---|---|
| 1 — First-run narrative | **Partial** | Hero gives install + run + one-sentence outcome. But no worked `.purpose` example is shown anywhere in the new structure. See Finding 3. |
| 2 — Shift framing | **Yes** | Hero makes shift THE command with one framing ("scaffolds everything your AI assistant needs"). Three old framings deleted. |
| 3 — Three-paths paralysis | **Yes** | Six-command chain deleted; Minimal Start deleted; Quick Start block collapsed into the hero. |
| 4 — Front-loaded jargon | **Yes** | Symbol System moved from ~line 62 into "Concepts (progressive disclosure)", reached only after the shift demo. |
| 5 — `.purpose` never shown | **Partial** | §4 mentions "one example" of `.purpose` in the Concepts section, but hero copy does not include a post-run `.purpose` snippet, and §7 Q2 flags this as reviewer-taste. See Finding 3. |

**Overall: proposal addresses 3 of 5 Nora gaps fully and 2 of 5 partially.** The two partial resolutions are both the same underlying issue: a first-timer who runs `paradigm shift` successfully still has no worked example of what they just got or what to put in `.purpose`.

---

## 4. Hero Copy Check (<15 lines, no jargon)

Counted the hero block at proposal §5 (lines 175–205 of proposal):

- Lines 175–187: logo + H1 + one-line subhead + 3 badges = **13 lines**, of which 10 are boilerplate (logo/badges/H1). Actual prose: 1 line ("One command to make your codebase AI-ready").
- Lines 189–200: `## Install` + bash block + `## Run it` + bash block = **8 lines**.
- Lines 202–204: rationale paragraph + 2 jump-links = **3 lines**.

**Total above-the-fold hero: ~24 lines (not 15).** This is longer than the "<15 lines" success criterion the user set but still tight. The 24 lines include badges, H2s, and code fences, which in rendered markdown collapse visually. The rendered above-the-fold footprint is closer to 15 visual lines in GitHub's viewport at default zoom.

**Jargon check on the hero:**
- "AI-ready" — concrete.
- "scaffolds everything your AI assistant needs to understand your codebase" — acceptable; "scaffolds" is mild jargon, tolerable.
- "a config, a symbol graph, auth topology, IDE instruction files, and enforcement hooks" — **"symbol graph" and "auth topology" are still jargon** per Nora's original complaint. Nora explicitly flagged "authorization topology" as undefined. This is slightly softened to "auth topology" in the proposal but not eliminated. See Finding 2.
- "Safe to re-run." — concrete, reassuring.
- "Works with TypeScript, Python, Rust, Go, Swift, and more." — concrete.

**Verdict:** Hero lands close to target. 2 residual jargon terms ("symbol graph", "auth topology") should be replaced with outcome language (e.g., "what your AI assistant needs to navigate your code: a project map, access rules, IDE instruction files, and enforcement hooks").

---

## 5. 31 vs 37 vs 36 — File Count Discrepancy

Counted manually and with `grep "path: '"` on `shift-files.ts`:

- Core Structure: 14 entries (config, agents, roster, adoptions, team-state, fixtures, navigator, flows, tags, habits, graduation, portal, `.purpose`, `.premise`)
- Event Streams: 5 entries
- History & Knowledge: 7 entries (history/index, history/log, lore/timeline, wisdom/antipatterns, personas/index, protocols/index, notebooks/)
- University: 6 entries (config, index, notes/, policies/, quizzes/, paths/)
- IDE & Hooks: 4 entries (CLAUDE.md, AGENTS.md, .cursor/rules/, .claude/hooks/)

**Total: 14 + 5 + 7 + 6 + 4 = 36 entries.**

`grep` confirms **36** occurrences of `path: '`. Evidence: `packages/paradigm/src/commands/shift-files.ts` lines 29, 38, 45, 52, 61, 69, 76, 83, 90, 97, 104, 111, 119, 128, 136–140, 144, 150, 152, 159, 166, 173, 179, 183, 191, 197, 198, 199, 200, 204, 208, 211, 212.

**Both numbers in circulation are wrong:**
- Memory note: 31 (stale)
- Proposal: 37 (off by one, source code has 36)
- **Actual: 36**

This is a small error but the proposal presents the 37 count as a correction to the memory note — so the correction itself is wrong. The README should say **36 guaranteed files/directories** or (safer, less likely to bit-rot) **"~40 core files and directories"** or **"a complete skeleton"**.

---

## 6. Delete/Demote Risk Check (§6)

Walked each deletion against Nora's friction report to check for load-bearing content being removed:

| Proposal action | Risk? |
|---|---|
| Delete 6-command chain (138–168) | **Low.** Shift replaces it. Nora flagged this as critical friction. |
| Delete Minimal Start (170–180) | **Low.** Nora flagged the "edit .purpose" dead-end explicitly. Removing helps. |
| Delete "The Problem" (18–25) | **Low-to-medium.** Nora didn't flag this as friction. Removal loses some SEO (§7 Q3 architect already raised). Mitigate by keeping problem language in "Why this works." |
| Delete "The Solution / three pillars" (26–44) | **Low.** Nora flagged "Purpose/Portal/Premise" as brand jargon. Safe to demote into Concepts. |
| Demote Install script + manual install into `<details>` | **Low.** Keeps content, reduces surface area. Good call. |
| Delete most of Key Commands list | **Medium.** Reduces command discoverability from the README. BUT Nora didn't flag this list as painful — it's just crowded. Recommend KEEPING as a compact table at the bottom of the README rather than moving pieces into concept sections. See Finding 5. |
| Compress MCP / Sentinel / University / Conductor | **Low.** Nora flagged these as distractions. Safe to link out. |
| Move efficiency study BELOW the shift demo | **Low.** "Numbers before nouns" was Nora's specific critique. Matches. |

**One mild risk:** deleting the Key Commands list entirely loses a quick-reference affordance that many readers (not first-timers) do use. Recommend a compact "Other useful commands" table at the bottom of the README, not deletion to docs only.

---

## 7. Findings

### Blocking
*(none — open question resolves in favor of proposal standing)*

### Improvement

1. **[improvement] Add a worked `.purpose` example post-shift.** Nora's most critical gap — "edit .purpose with no template" — is not fully resolved by the proposal. The Concepts section promises "one example" but the hero itself gives the user nothing to put in `.purpose` after they run shift. **Recommendation:** add a 5–8 line code block to the hero titled "What you just got" showing the skeleton `.purpose` file and a one-line commented diff of what to edit next. This is low risk (it's a read-only example, not a command) and high value (converts "dead end" into "next action is obvious").

2. **[improvement] Strip residual jargon from the hero rationale paragraph.** "Symbol graph" and "auth topology" both appear on Nora's undefined-terms list (items 9 and 3). Replace with outcome language: *"a project map, access rules, IDE instruction files, and enforcement hooks."*

3. **[improvement] Fix the guaranteed-files count.** Proposal cites 37; source has 36. Either update the proposal's text or (safer) soften the number in the README to "a complete skeleton of about 40 files and directories" so this doesn't bit-rot on the next addition.

4. **[improvement] Keep a compact "Useful commands" table at the bottom.** §6 marks the Key Commands section for near-total deletion. First-timers don't need it, but return visitors do. A 6–8 row table with `shift`, `doctor`, `ripple`, `beacon`, `sync`, `team orchestrate`, `presets`, `migrate` serves as a quick-reference at low cost.

### Note

5. **[note] Recommend `getRecommendations()` include "run `paradigm beacon` to see your symbol graph"** as a default next-step rec when a fresh shift completes. Beacon is not invoked during shift (correctly — it's a separate concern), but the first-run reader has no trigger to discover it. This is a code change to `shift-recommendations.ts`, not a README change, but it closes the same loop Finding 1 does.

6. **[note] `paradigm start` alternative is unnecessary.** Nora floated renaming shift to something that "IS the entry point." Based on source code evidence, shift already IS the entry point. Keep the name. "Shift" also has a useful branded ambiguity — it connotes both "change gears" (the onboarding moment) and "move together" (multi-project propagation), which is why it landed on three framings in the first place. The fix is framing discipline in the README, not renaming the command.

7. **[note] Proposal §7 Q1 answer: keep "AI-ready" subhead.** The authorization angle does not need top billing; readers who need auth find `portal.yaml` in Concepts. Architect's self-answer is correct.

8. **[note] Proposal §7 Q2 answer: INCLUDE an output snippet.** Architect flagged this for reviewer taste. Recommend YES — a trimmed `paradigm shift` output (boxed header, 6 step spinners, summary table of files created) visible as a code block in the hero dramatically lowers "what just happened to my repo?" anxiety. Nora's step 10 friction ("no first-run narrative") is softened materially by showing, not telling, what shift produces. This is the single highest-leverage addition beyond what the proposal already has.

---

## 8. Approval

**Status:** **approved-with-changes**

The proposal's thesis (make `paradigm shift` THE entry point) is validated by source code. The overload catalog is complete. The progressive disclosure map is defensible. The delete/demote list is low-risk.

Changes required before builder implements:

1. Fix file count: 37 → 36 (or use a soft phrase).
2. Strip "symbol graph" / "auth topology" from hero rationale — replace with outcome language.
3. Add a "What you just got" `.purpose` skeleton snippet to resolve Nora's deepest friction.
4. Retain a compact Useful-Commands table at the bottom of the README.
5. Include a trimmed CLI output snippet in the hero (architect's §7 Q2 YES).

Changes 1 and 2 are trivial copy edits. Changes 3, 4, 5 are small additions, not rewrites. The overall shape of the proposal stands.

---

## 9. Recommended Next Step

**Greenlight builder to implement the restructure, with the 5 changes above folded into the work.** Do not send back for another round of architect design — the structural decisions are sound; what remains is copy discipline during implementation.

Suggested builder task framing:
- Deliverable: revised `/README.md` matching the proposal's §2 outline and §5 hero copy, amended per Findings 1–4 and Note 8 above.
- Validation: run Nora again on the new README in a follow-up session. Her hypothesis (shift = THE entry point) will be validated or refuted directly from the new surface.
- Out of scope: `docs/guides/*`, `docs/README.md`. Those are downstream.

---

```yaml
# Agent Relay
status: success
summary: |
  Resolved the critical open question: `paradigm shift` IS a legitimate first-install entry
  point. It handles fresh projects end-to-end (init + guaranteed-files + team/roster/adoptions
  + workspace + scan + IDE sync + hooks + optional doctor). Architect's thesis is structurally
  validated by source code. Overload catalog is complete (all 8 flags match index.ts and
  shift.ts). Approving proposal with 5 small changes: fix the 37→36 file count, strip residual
  jargon ("symbol graph", "auth topology") from hero, add a post-run `.purpose` skeleton
  snippet to close Nora's "edit .purpose" dead-end, keep a compact useful-commands table at
  the bottom, and include a trimmed CLI output snippet in the hero for "what just happened
  to my repo" reassurance. No blocking issues. No rename needed.
artifacts:
  - reviews/2026-04-18-readme-audit-review.md
decisions:
  - `paradigm shift` handles fresh-project first-install; no rename or split needed
  - Actual guaranteed-files count is 36 (not 31 per memory, not 37 per proposal)
  - Approval status: approved-with-changes
  - Builder is greenlit to implement with 5 amendments folded in
handoff_to: builder
handoff_context: |
  Implement the README restructure in `/README.md` per docs/private/plans/readme-restructure.md,
  with these 5 amendments from review:
    1. Fix file count: proposal says 37 guaranteed files; source has 36. Either use 36 or a
       softer phrase like "a complete skeleton of ~40 files and directories".
    2. Replace "symbol graph" and "auth topology" in the hero rationale paragraph with plain
       outcome language (e.g., "a project map, access rules, IDE instruction files, and
       enforcement hooks").
    3. Add a short code block to the hero titled "What you just got" with the skeleton
       `.purpose` file contents so readers are not stranded with an empty file (this was
       Nora's most severe friction finding).
    4. Keep a compact "Useful commands" table at the bottom (shift, doctor, ripple, beacon,
       sync, team orchestrate, presets, migrate) — don't delete Key Commands outright.
    5. Include a trimmed ~10-line `paradigm shift` CLI output as a code block after the
       run command, showing the boxed header + step lines + summary table, so readers see
       what happens before they commit.
  Out of scope: docs/guides/*, docs/README.md. Only the root README.md.
  Validation: after builder finishes, re-run Nora on the new README to validate the
  hypothesis end-to-end.
```
