# v6.0 Migration Guide

> Upgrading from v5.x → v6.0 (and v6.0.x). What broke, what to do, and how the migration shims keep you safe if you skip a release.

## TL;DR — the six breaking changes

1. **`LoreType.decision` removed.** `paradigm_lore_record({type:'decision'})` and `paradigm_assessment_record({type:'decision'})` now return a structured rejection envelope. CLI side throws the same migration message at the storage layer.
2. **`loadPortalConfigLegacy` deleted.** The one-minor back-compat shim from v5.37.12 is gone. Use `loadPortalConfig` and switch on the `status` discriminator (`'missing' | 'unparseable' | 'ok'`).
3. **Legacy University JSON content removed.** `@a-company/university/src/content/{courses,plsat}/*.json` are gone. Server routes read from the v6 pack layout (`content/{notes,quizzes,paths}/`). Use the pack-loader API.
4. **`paradigm_university_search` result `id` format changed** to `<pack-id>:<entry-id>`. Strip the prefix for display if needed.
5. **Decision-store consolidation.** `paradigm migrate decisions` consolidates `wisdom/decisions/*.yaml` and `lore.type='decision'` into the canonical `.paradigm/decisions/TD-*.yaml` store.
6. **Wisdom `type='decision'` soft-deprecated.** Still writes to disk in v6.0 with a deprecation warning; hard-error in a future minor.

Read on for the per-change details, migration shims, and an upgrade checklist.

---

## 1. `LoreType.decision` removed

**What broke**

```typescript
// v5.x — worked
paradigm_lore_record({ type: 'decision', summary: '...', decisions: [...] })
paradigm_assessment_record({ type: 'decision', ... })
```

```typescript
// v6.0 — both now return a structured rejection
{
  "error": {
    "code": "lore_type_decision_removed",
    "message": "lore type 'decision' was removed in v6.0. Use paradigm_decision_record instead. ...",
    "successor_tool": "paradigm_decision_record",
    "doc": "docs/private/plans/v6.0-decisions-locked.md",
    "removed_in": "6.0.0"
  }
}
```

CLI side: `paradigm lore record --type decision` is rejected at the storage layer (`packages/paradigm/src/core/lore/storage.ts:158-166`) with the same migration message.

**What to do**

Use `paradigm_decision_record` instead. The decision lands in `.paradigm/decisions/TD-*.yaml` and a companion lore insight entry with `references.decision_id` is written automatically — the timeline stays complete:

```typescript
paradigm_decision_record({
  title: "Adopt fail-closed portal compliance",
  decision: "loadPortalConfig returns a discriminated union; unparseable fail-closes.",
  rationale: "Field reports of silent fail-open behavior on duplicate-key portal.yaml",
  participants: [
    { id: 'architect', role: 'agent', stance: 'proposed' },
    { id: 'matt',      role: 'human', stance: 'supported' },
  ],
  symbols_affected: ['#portal-compliance'],
  status: 'active',
})
```

Full guide: [docs/guides/decisions.md](./decisions.md).

**Auto-migration on read (forensic recovery)**

Pre-v6 lore entries with `type='decision'` are auto-remapped to `type='insight'` on read by the `lore-loader` v1→v2 migration shim, with a `v6-migrated:from-decision` tag preserved. Find them later:

```typescript
paradigm_lore_search({ tag: "v6-migrated:from-decision" })
```

To finalize the migration (write proper TD-* entries and back-link them), run:

```bash
paradigm migrate decisions
```

---

## 2. `loadPortalConfigLegacy` deleted

**What broke**

```typescript
// v5.37.12 — worked, with deprecation warning
import { loadPortalConfigLegacy } from '@a-company/paradigm-mcp/utils/portal-writer';
const portal = loadPortalConfigLegacy(rootDir);  // null on failure
if (!portal) { /* ... */ }
```

```typescript
// v6.0 — symbol does not exist; loud ERR_MODULE_NOT_FOUND for dynamic-import callers
```

Per the v6.0 security audit: `loadPortalConfigLegacy` was never on the public npm surface (`packages/paradigm` has no `exports` map for that path), so external silent breakage is impossible — at worst a runtime dynamic-import caller hits `ERR_MODULE_NOT_FOUND`.

**What to do**

Use `loadPortalConfig` and switch on the `status` discriminator:

```typescript
import { loadPortalConfig } from '@a-company/paradigm-mcp/utils/portal-writer';

const result = loadPortalConfig(rootDir);
switch (result.status) {
  case 'ok':
    return result.data;
  case 'missing':
    // No portal.yaml present
    return null;
  case 'unparseable':
    // FAIL CLOSED — do not treat as missing. The v5.37.12 contract is
    // that any parse error produces violations, not "compliant".
    log.error(`portal.yaml unparseable: ${result.errorClass} — ${result.detail}`);
    throw new Error('portal.yaml unparseable');
}
```

The `'unparseable'` branch fail-closes by design — that was the v5.37.12 fix that the v6.0 cut hard-locks. Treating an unparseable portal as "no portal declared" was a documented auth-bypass vector that v5.37.12 closed and v6.0 makes irreversible.

Source: `packages/paradigm-mcp/src/utils/portal-writer.ts`, `packages/paradigm-mcp/src/utils/yaml-validator.ts`.

---

## 3. Legacy University JSON content removed

**What broke**

```typescript
// v5.x and earlier — worked
import courses from '@a-company/university/src/content/courses/para-101.json';
import plsat from '@a-company/university/src/content/plsat/v3.json';
```

```typescript
// v6.0 — both directories deleted from the package
// MODULE_NOT_FOUND
```

The bridge release (v5.39.0) shipped the new pack layout alongside the old JSON. v6.0 deleted the old JSON. Server routes (`courses.ts`, `plsat.ts`) read exclusively from the v6 pack layout (`content/{notes,quizzes,paths}/`).

**What to do**

Use the pack-loader API (new in v5.39.0):

```typescript
import { loadAllPacks } from '@a-company/paradigm-mcp/utils/pack-loader';

const packs = loadAllPacks(rootDir);
const paradigm = packs.find(p => p.manifest.id === 'paradigm');
const notes = paradigm.entries.filter(e => e.type === 'note');
```

Or via MCP:

```typescript
paradigm_university_pack_list({})                              // list all packs
paradigm_university_search({ pack: 'paradigm', type: 'note' }) // search a pack
paradigm_university_get({ id: 'paradigm:N-symbol-basics' })    // fetch one entry
```

Content layout, post-v6:

```
@a-company/university/
├── pack.yaml
└── src/content/
    ├── notes/        # N-*.md (82 files)
    ├── quizzes/      # Q-*.yaml (84 files, including Q-plsat-v2.yaml + Q-plsat-v3.yaml)
    └── paths/        # LP-*.yaml (8 files)
```

Full layout + pack-author flow in [University Guide](./university.md) §5–§7.

---

## 4. `paradigm_university_search` result `id` format changed

**What changed**

```typescript
// v5.x — bare ids
paradigm_university_search({ query: "symbol" })
// → entries: [{ id: "N-symbol-basics", ... }]
```

```typescript
// v6.0 — qualified ids
paradigm_university_search({ query: "symbol" })
// → entries: [{ id: "paradigm:N-symbol-basics", ... }]
```

The `<pack-id>:<entry-id>` form is the canonical cross-pack address. Bare ids still work as input (resolves against the active pack), but search results return the qualified form so multi-pack consumers can disambiguate.

**What to do**

Strip the prefix for display if your UI expects bare ids:

```typescript
const display = entry.id.includes(':') ? entry.id.split(':')[1] : entry.id;
```

Or accept the qualified form everywhere — `paradigm_university_get` happily takes either.

---

## 5. Decision-store consolidation

**Why**

Pre-v6.0 had three places decisions could land: `lore.type='decision'`, `wisdom_record({type:'decision'})`, and ad-hoc `.paradigm/decisions/`. The "three-way fracture." v6.0 hard-picks `.paradigm/decisions/` as canonical and consolidates the other two via `paradigm migrate decisions`.

**What to do**

Run the migration once after upgrading:

```bash
paradigm migrate decisions             # idempotent
paradigm migrate decisions --dry-run   # preview
paradigm migrate decisions --json      # JSON summary
```

What it does:

1. **Wisdom decisions** (`.paradigm/wisdom/decisions/*.yaml`) — converted to `TD-*` entries with `migrated_from: 'wisdom-decision'` and a `wisdom-decision:<id>` tag. Source files **deleted** after successful write. Empty `wisdom/decisions/` directory removed.

2. **Lore decisions** (`lore.type='decision'`) — converted to `TD-*` entries with `migrated_from: 'lore-decision'`, `linked_lore`, and a `lore-decision:<id>` tag. Original lore entry **rewritten in place** to `type: 'insight'` with `references.decision_id` pointing at the new TD-*. Body gets an appended note.

Idempotent — re-running checks for `wisdom-decision:<id>` / `lore-decision:<id>` tags on TD-* files and skips already-migrated entries.

Full coverage in [docs/guides/decisions.md](./decisions.md) §6.

---

## 6. Wisdom `type='decision'` soft-deprecated

**What changed**

```typescript
// v5.39.0 — deprecation warning
paradigm_wisdom_record({ type: 'decision', ... })  // still writes; warns

// v6.0.0 — still soft-deprecated, still writes, still warns
// (not yet hard-error — that ships in a future minor)
```

Per D3 (v6.0 lock): lore was the documented three-way fracture offender (hard-removed); wisdom was the documented ADR path that earned a longer grace period. Hard-removal in a future minor.

**What to do**

Migrate proactively even though it still works:

1. Use `paradigm_decision_record` for new decisions
2. Run `paradigm migrate decisions` to consolidate any existing wisdom decisions into `.paradigm/decisions/`

The warning surface is at `packages/paradigm-mcp/src/tools/wisdom.ts:427,458,490` and `packages/paradigm-mcp/src/utils/wisdom-loader.ts:252` (one-time-per-session read-side warning).

---

## 7. Skip-upgrade safety

A consumer pinning v5.37.11 and jumping straight to v6.0 still fail-closes correctly. The contract lives in the v6.0 binary they install, not in their TypeScript:

- `loadPortalConfig` returns `{status:'unparseable'}` on parse error
- compliance returns `violations` with the `__portal_unparseable__` sentinel
- the stop hook blocks

They inherit v5.37.12's contract automatically — pinning an older minor doesn't bypass v6.0's safety. Verified in the v6.0 security audit (`reviews/2026-04-22-v6.0-security-audit.md`).

Symmetric story for the other v5.38.0 hardening: `writeAndConfirm`'s atomic-write + verify envelope, the round-trip consistency manifest, and `PARADIGM_STRICT=1` opt-in fail-fast mode all ship in v6.0.

---

## 8. v5.39.0 multi-tenant additions you inherit

Even if you skip v5.39.0, these arrive in v6.0:

- **Multi-tenant University.** Three pack tenancies: `first-party` (installed npm packs), `project` (`.paradigm/university/`), `external`. New CLI selectors `--pack`, `--project`, `--discipline`. New `paradigm_university_pack_list` MCP tool.
- **Privacy-preserving local metrics.** `.paradigm/university/.metrics/snapshot-YYYY-MM-DD.json`. Counts only — no titles, no content, no identifiers. 90-day local retention. `metrics.remote_consent: pending` seeded so v6.1 can prompt for opt-in without a schema migration.
- **Companion-lore pattern.** `paradigm_decision_record` writes a companion lore insight entry with `references.decision_id` automatically.
- **`TeamDecision` ADR fields.** `context`, `consequences`, `date`, `migrated_from`, `supersedes[]` (inverse of existing `superseded_by`).
- **`LoreEntry.references`** — `{ decision_id?, wisdom_id?, notebook_id?, protocol_id? }`. Lore stays a timeline; canonical structured storage is in the referenced store.

---

## 9. Per-step upgrade checklist

A repeatable sequence to follow on each project:

```bash
# 1. Update the global CLI
npm install -g @a-company/paradigm@6              # or use install.sh

# 2. In each project, sync the new CLAUDE.md / hooks / config
cd /path/to/your/project
paradigm shift                                    # idempotent; safe to re-run

# 3. Consolidate decisions (if you had wisdom-decisions or lore-decisions)
paradigm migrate decisions --dry-run              # preview
paradigm migrate decisions                        # apply

# 4. Verify
paradigm doctor                                   # comprehensive health check
paradigm status                                   # symbol counts, project health

# 5. (Optional) Find any forensic-recovery lore entries from the v1→v2 shim
paradigm lore list --tag v6-migrated:from-decision
```

Then audit your own code:

- [ ] Search for `loadPortalConfigLegacy` imports in your repo. Replace with `loadPortalConfig` + status switch (§2).
- [ ] Search for `paradigm_lore_record({type:'decision'})` or `paradigm_assessment_record({type:'decision'})` call sites. Migrate to `paradigm_decision_record` (§1).
- [ ] Search for direct imports of `@a-company/university/src/content/{courses,plsat}/*.json`. Migrate to the pack-loader API (§3).
- [ ] Search consumer code that parses `paradigm_university_search` result ids. Strip the `<pack-id>:` prefix or accept the qualified form (§4).
- [ ] Search for `paradigm_wisdom_record({type:'decision'})` call sites. Migrate to `paradigm_decision_record` even though wisdom still accepts it for one more release (§6).

---

## 10. If you hit a snag

- **Issues:** [github.com/ascend42/a-paradigm/issues](https://github.com/ascend42/a-paradigm/issues)
- **Reference:** [Decisions Guide](./decisions.md), [Agents Guide](./agents.md), [University Guide](./university.md)
- **Upgrade history:** [CHANGELOG.md](../../CHANGELOG.md) (v5.37.10 README rewrite → v5.37.11 silent-no-op fix → v5.37.12 fail-closed → v5.38.0 strict-mode + writeAndConfirm → v5.39.0 multi-tenant University → v6.0.0 breaking removals)
- **Health check:** `paradigm doctor` covers the most common upgrade-time misconfigurations
- **Plugin users (Claude Code):** `/plugin marketplace add ascend42/a-paradigm` pulls main HEAD; smoke-test in a fresh Claude Code session if you suspect cache staleness

---

## Audience track map

- **5.x → 6.0 in one project:** §9, then §1–§6 as you hit each
- **Library author depending on `loadPortalConfigLegacy`:** §2
- **Library author depending on `lore.type='decision'`:** §1, §5
- **Pack author / University consumer:** §3, §4, §8
- **Skip-upgrader (pinned older minor):** §7

---

*Source of truth: [CHANGELOG.md](../../CHANGELOG.md) §6.0.0 + §6.0.1; v6.0 D3 lock at `docs/private/plans/v6.0-decisions-locked.md`; v5.37.12 fail-closed contract at `packages/paradigm-mcp/src/utils/yaml-validator.ts` + `packages/paradigm-mcp/src/utils/portal-writer.ts`; v5.38.0 envelope at `packages/paradigm-mcp/src/utils/write-and-confirm.ts`.*
