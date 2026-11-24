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

## Founder decisions the audit raises
1. Which Warpline tagline (three are in use).
2. Which learning story is current: automatic promotion, or gated by sign-off (README says gated; guidance says automatic).
3. `paradigm tutorial`: revive as the day-one exercise, or remove.
4. Whether `paradigm shift` should default to an enforcement level above `none` once it ends with a first prompt.
