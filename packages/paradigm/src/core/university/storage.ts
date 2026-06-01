/**
 * University Storage — re-export shim over `@a-company/university-core`.
 *
 * The CLI's content-loading/-writing implementation was a divergent copy of the
 * canonical loader. As of the extract-university-core refactor (spec §4.2) the
 * implementation lives ONCE in `@a-company/university-core`; this module re-
 * exports it so the 8 CLI command files + serve.ts (which import through the
 * `core/university` barrel) stay untouched.
 *
 * Most symbols are PURE re-exports. Three are thin compatibility wrappers that
 * preserve the CLI's historical signatures/behavior exactly — see each below.
 * They are NOT reimplementations of the §5.5-guarded functions (scanPackEntries /
 * resolveContentBaseLabel / countPackEntries / safeLoadPackId); those live in
 * exactly one place (university-core) and are never redefined here.
 */

import {
  resolveContentBase as coreResolveContentBase,
  countPackEntries as coreCountPackEntries,
  loadPackIndex as coreLoadPackIndex,
  saveNote as coreSaveNote,
  saveQuiz as coreSaveQuiz,
  safeLoadPackId as coreSafeLoadPackId,
} from '@a-company/university-core';
import type {
  UniversityFrontmatter,
  UniversityQuiz,
  UniversityIndex,
} from './types.js';

// ── Pure re-exports (signatures identical to the old CLI impl) ──────────────
export {
  loadUniversityIndex,
  loadNote,
  loadQuiz,
  loadPath,
  loadDiplomas,
  saveDiploma,
  searchContent,
  searchContentWithMeta,
  rebuildUniversityIndex,
} from '@a-company/university-core';

// ═══════════════════════════════════════════════════════════════════════════
// COMPATIBILITY WRAPPERS (spec deviation — see relay)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * resolveContentBase — preserve the CLI's NO-FALLBACK contract.
 *
 * Core's `resolveContentBase` falls back to "first base that merely exists"
 * when neither base contains content (D3, scoped by the spec to the server).
 * The CLI's historical version returned `null` in that case (storage.test.ts
 * lines 123-126 assert null for an empty-but-existing `content/`). Gate core's
 * result on core's own `countPackEntries` to reproduce the CLI's null-on-empty
 * behavior. Provably byte-identical to the old CLI version across all four
 * cases: populated content → content; empty content + populated src/content →
 * src/content; both empty → null; neither exists → null.
 */
export function resolveContentBase(packRoot: string): string | null {
  const base = coreResolveContentBase(packRoot);
  if (!base) return null;
  return coreCountPackEntries(packRoot) > 0 ? base : null;
}

/**
 * loadPackIndex — CLI signature is `(packRoot)`; core's is `(packRoot, rootDir)`
 * where `rootDir` is only used to thread through to nested calls that the CLI
 * never exercised (the CLI always passed just the pack root). Pass `packRoot`
 * for both so behavior matches the old single-arg CLI implementation.
 */
export function loadPackIndex(packRoot: string): UniversityIndex {
  return coreLoadPackIndex(packRoot, packRoot);
}

/**
 * saveNote — preserve the CLI write contract EXACTLY.
 *
 * Old CLI behavior: write to `<rootDir>/.paradigm/university` (never resolve a
 * default first-party pack) when no packRoot; when an explicit packRoot IS
 * passed, stamp `pack_id` with the manifest's REAL id via a raw-YAML read — or
 * nothing if the manifest is absent/idless. NEVER stamp the directory basename.
 *
 * Core's `stampPackId` boolean cannot express "real id or nothing, never
 * basename" — its stamp routes through `loadOrFabricatePackManifest`, which
 * fabricates a basename id on a partial/missing manifest (spec §3's claim that
 * it "subsumes" safeLoadPackId is therefore false — see relay). So we set
 * `stampPackId: false` and stamp `pack_id` ourselves from core's lenient
 * `safeLoadPackId` (single-home reader, spec §5.5). `resolveDefaultPack: false`
 * holds the CLI's "never first-party" dir-targeting rule.
 *
 * Cases (all byte-identical to the pre-refactor CLI):
 *   - no packRoot                 → `<rootDir>/.paradigm/university`, no stamp
 *   - packRoot + valid id         → packRoot dir, stamp the real id
 *   - packRoot + no/idless manifest → packRoot dir, NO stamp (no basename)
 */
export function saveNote(
  rootDir: string,
  frontmatter: UniversityFrontmatter,
  body: string,
  packRoot?: string,
): string {
  const fm = stampPackId(frontmatter, packRoot);
  return coreSaveNote(rootDir, fm, body, {
    packRoot,
    stampPackId: false,
    resolveDefaultPack: false,
  });
}

/**
 * saveQuiz — same exact write contract as {@link saveNote}.
 */
export function saveQuiz(rootDir: string, quiz: UniversityQuiz, packRoot?: string): string {
  const stamped = stampPackId(quiz, packRoot);
  return coreSaveQuiz(rootDir, stamped, {
    packRoot,
    stampPackId: false,
    resolveDefaultPack: false,
  });
}

/**
 * Stamp `pack_id` onto a record with the CLI's exact, lenient semantics: only
 * when an explicit packRoot is given AND the manifest carries a real id AND the
 * record does not already declare a `pack_id`. Returns the record unchanged
 * otherwise (no fabrication, no mutation of the input object).
 */
function stampPackId<T extends { pack_id?: unknown }>(record: T, packRoot?: string): T {
  if (!packRoot) return record;
  const id = coreSafeLoadPackId(packRoot);
  if (id && !record.pack_id) return { ...record, pack_id: id };
  return record;
}
