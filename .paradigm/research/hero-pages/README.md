# Hero pages and teaching: working folder

Task T-2026-11-24-002. Founder brief and tone are in lore L-2026-11-24-ascend-064322-003.

- `teaching-audit.md`: the Sheila/Nora/Helix audit of the first hour, the learning path, best practices, and the docs and product changes that fell out.

## Audit claims re-checked by the orchestrator (2026-11-23)
- Enforcement defaults to `none`: `packages/paradigm/src/core/enforcement/loader.ts:21`. README lines 6 and 14 and the generated CLAUDE.md (`core/ide-adapters/claude.ts:127-131`) say the Stop hook blocks.
- `paradigm doctor --verify` is recommended by `commands/shift-recommendations.ts:474` and fails: `error: unknown option '--verify'`.
- Generated `AGENTS.md` header points at `github.com/anthropics/paradigm` v2.0: `core/ide-adapters/agents.ts:49`.
- Shift's enforcement prompt says "paradigm 6.0.4": `commands/shift.ts:195`.
- `paradigm agent` has `create` and `roster`, no `add`.
- Shift syncs IDE files with `force: true`: `commands/shift.ts:750`. Whether that overwrites a hand-written CLAUDE.md is NOT yet confirmed by a run.
- `docs/site/` holds only `INFO.md` and `README.md`; the older static pages are `docs/warpline/{index,pov,system}.html` and `docs/warpline-overview.html`.

## Founder decisions, deferred (founder, 2026-11-23: "denote those other decisions for later with placeholders")
None of these blocks the build. Each has a working default; where a page or doc depends on the answer it carries a marked placeholder (`TBD-FOUNDER: <id>`), listed in the facts file so they can be found and filled in one pass.

| Id | Decision | Working default until decided |
|---|---|---|
| warpline-tagline | Which Warpline tagline (three in use: "version control for meaning", "merge prediction from the symbol graph", "meaning-merge adjudication layer") | Placeholder slot on the page; the page describes what it does in a plain sentence instead of a tagline |
| learning-story | Is a learning promoted automatically, or only after sign-off? (README says gated; in-tool guidance says automatic) | Pages describe the gate as the design and say outcome data is not in yet; no doc is changed to pick a side |
| tutorial | `paradigm tutorial`: revive as the day-one exercise, or remove | Left as is; not referenced from the new learning path |
| default-enforcement | Should `paradigm shift` default above `none`? | Stays `none`; pages and docs say checks are off until turned on |
| p12-firefox | Accept the P12 pass rule without Firefox (Aegis: acceptable) | Rule as built |
| board-design | Luna's S1.1 choices (naming in the UI, palette without red/orange/violet, solid-only human strokes, seals, `⌥B`, the shadow override) | Built as proposed; entries stay `proposed` |
| pages-direction | Luna's hero-page direction and which path GitHub Pages serves | Built as proposed; Pages is enabled by the founder at the morning merge |
