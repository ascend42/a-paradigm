/**
 * #lift-code-units — the absorb-side bridge (spec §9 sub-phase 2, §4.1).
 *
 * Two halves:
 *   - `liftCodeUnits(rootDir)` — run every REGISTERED lens (the registry) over a
 *     (read-only) worktree root and collect every `CodeUnit` it produces. The
 *     lens never writes; the read-only Phase-1 invariant is preserved.
 *   - `injectCodeUnits(index, units)` — turn each `CodeUnit` into a synthetic
 *     `SymbolEntry` and splice it into the live `SymbolIndex` so it becomes one
 *     more node in the SAME universe `computeEssences` iterates. NOT a parallel
 *     graph (spec §2).
 *
 * The synthetic entry is shaped so the existing WARP machinery resolves it with
 * zero special-casing on the read path:
 *   - `getSymbol(index, sym)`        → returns it (matched on `entry.symbol`).
 *   - `getReferencesFrom(index, sym)`→ yields its LOCAL targets (so `liftEdges`
 *                                      produces code→localTarget WarpEdges →
 *                                      `buildEssenceGraph.adj` sees them → Tarjan
 *                                      detects code-level cycles).
 *   - `getAllSymbols(index)`         → includes it (it lands in `index.entries`),
 *                                      so `buildWarpState` passes it to
 *                                      `computeEssences` as part of the universe.
 *
 * Identity-bearing payload travels on `entry.data` (read by `essence-hash.ts`'s
 * code-unit branch — NO ts-lens import there): `codeEssence` (the body with
 * positional `f:idx` slots), `codeLocalTargets` (the ordered distinct local
 * target symbols, so `f:N` substitutes the N-th local target's essence INLINE),
 * and `essenceTag` (`<algo>:ts<exact>`, e.g. `v1.1:ts5.9.3` — the algorithm- and
 * compiler-pinned version namespace §5.2).
 *
 * `data` ALSO carries one NON-identity-bearing slot: `codeSignature`, the
 * signature-only projection of the essence (T-2026-07-15-008 stage 1). The
 * essence's `normalizedContract` enumerates its hashed slots, and this is not
 * one of them — it travels with the node for `sem-delta` to read, and moves no
 * content-address.
 *
 * Library code: no console output.
 */

import { createHash } from 'node:crypto';
import {
  type SymbolEntry,
  type SymbolIndex,
} from '@a-company/premise-core';
import { allLenses } from './registry.js';
import { TS_LENS_VERSION } from './ts-lens.js';
import { CCNF_ALGO_VERSION } from './ts-essence.js';
import type { CodeUnit } from './code-lens.js';

/**
 * The code-essence version tag (spec §5.2). TWO version axes, both stamped:
 * the CCNF ALGORITHM version (`v1.1` — bumped whenever the serialization
 * algorithm changes, see `ts-essence.ts`) and the EXACT pinned compiler. A
 * different algorithm OR a different TS version is an explicitly different
 * content-address space, never a silent collision — cross-version essence
 * comparison is impossible by construction. `.purpose` symbols keep `v0`; the
 * schemes interoperate because Merkle-by-target is opaque to a target's
 * version namespace.
 */
export const CODE_ESSENCE_TAG = CCNF_ALGO_VERSION + ':ts' + TS_LENS_VERSION;

/**
 * Run every registered lens over `rootDir` (an absolute path to a read-only
 * worktree) and collect the union of code-units. Lenses are stateless and
 * independent; their per-lens output is already sorted, and we re-sort the
 * union by symbol so the injection order is deterministic regardless of lens
 * registration order.
 */
export async function liftCodeUnits(rootDir: string): Promise<CodeUnit[]> {
  const all: CodeUnit[] = [];
  for (const lens of allLenses()) {
    const units = await lens.lift(rootDir);
    all.push(...units);
  }
  all.sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
  return all;
}

/**
 * The DETERMINISTIC synthetic id for a code-unit. NOT a uuid — the id must be
 * stable across runs/machines (it never leaks into the essence hash, but it IS
 * the `index.entries` key and any nondeterminism there is a latent footgun).
 * Keyed on the WARP symbol (path + qualified name), so two absorbs of the same
 * tree produce byte-identical ids.
 */
function codeUnitId(symbol: string): string {
  return createHash('sha256').update('code:' + symbol, 'utf8').digest('hex');
}

/**
 * The ordered, distinct LOCAL target symbols for a unit, in first-appearance
 * order (spec §4.1). This is the `f:idx → target` map the essence-hash code-unit
 * branch substitutes against: the body's `f:N` is the N-th LOCAL reference, and
 * `codeLocalTargets[N]` is its target symbol. Distinct (a repeated call to the
 * same local maps to the same essence) but ORDER-PRESERVING (call order is
 * meaning — a sorted set would be wrong).
 */
function orderedLocalTargets(unit: CodeUnit): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const ref of unit.references) {
    if (ref.kind !== 'local') continue;
    if (seen.has(ref.target)) continue;
    seen.add(ref.target);
    out.push(ref.target);
  }
  return out;
}

/**
 * The references the synthetic entry exposes via `entry.references`. ONLY the
 * local targets (in first-appearance, distinct order): those are the edges that
 * must enter the WARP graph so `liftEdges`/`buildEssenceGraph.adj`/Tarjan see
 * code→code structure. extern/builtin/unresolved refs are NOT edges — they are
 * already inline `free:name` tokens in the body string, never hashed as nodes.
 */
function localReferenceSymbols(unit: CodeUnit): string[] {
  return orderedLocalTargets(unit);
}

/**
 * Build the synthetic `SymbolEntry` for one code-unit. `kind: 'component'` +
 * `componentType: 'code-unit'` is the identity-bearing discriminator the
 * essence-hash branch keys on. `data` carries the three identity inputs the
 * hash reads; `source` is `'premise'` (the live-parse source family — see the
 * note in the module docstring; `SourceType` is not widened in stage 3a).
 */
function toSymbolEntry(unit: CodeUnit): SymbolEntry {
  const codeLocalTargets = orderedLocalTargets(unit);
  return {
    id: codeUnitId(unit.symbol),
    symbol: unit.symbol,
    type: 'component',
    // `SourceType` is not widened in stage 3a; use the live-parse family. The
    // source label is provenance only — never hashed, never read by the essence.
    source: 'premise',
    filePath: unit.filePath,
    data: {
      codeEssence: unit.codeEssence,
      codeLocalTargets,
      // NON-identity-bearing (T-2026-07-15-008 stage 1). `normalizedContract`
      // in essence-hash.ts enumerates the hashed slots explicitly and
      // `codeSignature` is not among them, so this rides `data` without moving
      // any contentId/stateId — no essenceTag bump, no fabric migration.
      // Absent on a lens with no separable signature (cfg) → fall back to the
      // whole essence, which makes EVERY change to such a unit read as a
      // contract move (fail closed: a false "contract moved" costs a review, a
      // false "body only" would be a silent mismerge).
      codeSignature: unit.codeSignature ?? unit.codeEssence,
      // Per-unit tag override (P3 GAP-1): the cfg lens stamps `cfg-v1`; TS units
      // keep the compiler-pinned default. The tag travels WITH the node.
      essenceTag: unit.essenceTag ?? CODE_ESSENCE_TAG,
      ...(unit.reducedFidelity ? { reducedFidelity: true } : {}),
      ...(unit.cfgMarker ? { cfgMarker: unit.cfgMarker } : {}),
    },
    references: localReferenceSymbols(unit),
    referencedBy: [],
    tags: ['code-unit'],
    componentType: 'code-unit',
  };
}

/**
 * Splice synthetic code-unit entries into the live `SymbolIndex` BEFORE
 * `computeEssences` runs (spec §2). Mirrors `buildSymbolIndex`'s wiring: the
 * main `entries` map (keyed by id) is what `getSymbol`/`getAllSymbols` read;
 * `byType`/`bySource` are kept consistent for any downstream consumer.
 *
 * Idempotent on the symbol key: a code-unit symbol already present is
 * overwritten (last-writer-wins on the deterministic id), so re-injecting the
 * same units never double-counts.
 */
export function injectCodeUnits(index: SymbolIndex, units: CodeUnit[]): void {
  for (const unit of units) {
    const entry = toSymbolEntry(unit);

    index.entries.set(entry.id, entry);

    const byType = index.byType.get(entry.type);
    if (byType) {
      const i = byType.findIndex((e) => e.id === entry.id);
      if (i >= 0) byType[i] = entry;
      else byType.push(entry);
    } else {
      index.byType.set(entry.type, [entry]);
    }

    const bySource = index.bySource.get(entry.source);
    if (bySource) {
      const i = bySource.findIndex((e) => e.id === entry.id);
      if (i >= 0) bySource[i] = entry;
      else bySource.push(entry);
    } else {
      index.bySource.set(entry.source, [entry]);
    }
  }
}
