# Loid — learning loop in the harness (2026-10-15)

Read-only, counted 2026-10-15. Key claims spot-checked by the orchestrator (orchestration.ts:881 increments appliedCount on injection; notebook-loader.ts:148 sorts by appliedCount; 384 entries at appliedCount 0; last notebook-reference event 2026-07-22). (inferred) marked.

## 1. Honest state
Plumbing complete, almost nothing flows. Content is written, rarely reused, never corrected.
- Notebooks: 397 global entries / 62 agents + 40 project. Provenance 284 manual, 44 bundled-canonical, 11 lore, 7 journal-auto-promote, 2 creator-confirmed. 280 written March 2026 (seeding). Only 7 born from the pipeline.
- Reuse: 384/396 at appliedCount 0. 80 injections, 342 entry-loads, only 28 distinct entries; four entries injected ~33× each. Cause: ranking by appliedCount, incremented on injection not use — a popularity loop, not learning. Injection dark since 2026-07-22.
- Breaks: appliedAndBrokeCount 0 everywhere; no field-failures.jsonl; Classroom reducer built, never fired. Decay only for expertise and display-only (60-day half-life, never written back).
- Journals: 125 (77 opus-4-6 self-reflections), monthly 50 → 29 → 20 → 13 → 7 → 6 (Aug) → 0.
- Nominations 35, all low-urgency, all from one hour on 2026-09-29, 0 surfaced. Promotions: 3 decisions, 1 promoted. User verdicts: 6 total. Settlement: 14 settles, 0 journals, 1 promotion. Classroom: 5 certifications, all survived. Debates: 200/200 complementary.
- Calibration: a-paradigm has no `.paradigm/learned/`; other repos `{}`. The claimed moat is empty on the founder's own repo.
- Neurons: 99 regions, 75 with confidence, 2 `contradicts` links, 1 audit. `tend` (contradiction, ≥0.9 near-dupe, 180-day stale) is the only real quality machinery in the family.
Leaks: no signal in (verdicts rare); no helped/hurt record per injection; consolidation only on manual trigger; outputs never consumed.

## 2. Querying + consolidation
- One read verb `knowledge.query({q, scope, minTier, requester})` federating notebooks, neurons, lore, decisions, Steward memory — each a manifest-registered provider.
- Result envelope `{ref, owner, provenance.source, trust_tier, confidence_live, last_validated, applied/broke, source_hash}`.
- Trust tiers: T0 founder-confirmed/gate-certified; T1 peer-certified; T2 pipeline auto-promote; T3 external/forage (always injected as untrusted).
- Cross-agent reads allowed with receipts (who read whose) so failures attribute across agents. Subagents get a frozen slice at spawn (in the turn contract + receipt). Model-visible ⟺ logged.
- Consolidation: one scheduler job `tend` generalizing neurons `maintenance.ts` to all providers. Trigger: N=5 new events AND ≥10 min quiet; cancels if founder active. Passes: dedupe ≥0.9 (propose merge), contradiction scan, decay recompute written back, calibration aggregate, surface nominations. Output one digest of proposals; never mutates T0/T1 alone.

## 3. Teacher → skill flywheel
- Detector deterministic first, LLM judge fallback: reviewer revised/dismissed, tests/tsc fail after agent edit, Warpline KNOT/refusal, loop thrash flag, same symbol in ≥2 failed attempts.
- Teacher: domain's strongest agent on a stronger model; cross-domain failures → Loid drafts. Writes fix AND candidate SKILL.md scoped to symbol/ecosystem.
- Lands: T3 staging in Classroom queue → certified → notebook (knowledge) or `.claude/skills/<name>` via 7.14 skills path (procedure), per TD-2026-09-26-846.
- Gate: replay fixes the saved `.scenario`; no regression on 2–3 nearest scenarios; peer refutation attempt; founder sign-off; first field break auto-overturns. Weak point: 5/5 survived ⇒ refute step has no teeth yet.

## 4. Loops that learn
Per-iteration row to `.paradigm/learned/loop-ledger.jsonl`: `{loopId, repo, iter, goal_ref, tests_passing, tsc_errors, diff_lines, files_touched, symbols_touched, tokens, verdict}`.
Progress = monotone improvement on something that can't lie. Thrash = same files/symbols rewritten k iterations with flat score, or same hunk reverted and re-applied. Learned per codebase × task type: iterations to converge, thrash k, tokens per unit progress → token-estimates via aggregate-on-settle. Harness pauses loop past learned threshold and turns the episode into a detector event (stuck loop → teaching case). (inferred) ~20 runs/repo before beating defaults; ship k=3 + budget cap.

## 5. Memory quality MVP for 8.0
1. Honest usage: split appliedCount into `injected` and `credited` (loaded in a turn whose outcome was accepted); rank by credited − broke.
2. Decay written back: 60-day half-life after 7-day grace, reset on credit; <0.3 ⇒ query-only.
3. Same-symbol contradiction detection in `tend`: LLM judge on pairs sharing symbol/tag at ≥0.75 similarity ⇒ pending audit, both tagged `contested` until founder rules.
4. Source-hash validation: entries citing a file/symbol store its hash; change ⇒ stale + re-check via symbol-integrity Phase 2 ripple.
Out of scope: global truth maintenance, cross-user trust.

## 6. Falsifiers (weeks 2–4)
1. Credited reuse of loop-born entries ≥25% of credited injections by week 4 and rising. Fails if credit stays on the same seeded 4–28 entries.
2. Repeat-failure rate per (symbol, failure-class) halves after certification, and iterations-to-converge fall. Fails if flat, or certifications keep 100% survival.
Liveness underneath: ≥1 verdict per working day, ≥1 `tend` per week; either zero ⇒ loop not running.
