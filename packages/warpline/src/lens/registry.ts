/**
 * #lens-registry — the code-lens registry (spec §9).
 *
 * Maps a file extension to the `CodeLens` responsible for it. Registered lenses:
 * the TS/TSX lens (v1) and the JSON/YAML structured-data lens (#cfg-lens, P3
 * GAP-1). The registry is the single seam per-language lenses plug into without
 * touching `absorb`/`lift-code-units`.
 */

import type { CodeLens } from './code-lens.js';
import { TsLens } from './ts-lens.js';
import { CfgLens } from './cfg-lens.js';

/** All registered lenses (instantiated once — they are stateless). */
const LENSES: readonly CodeLens[] = [new TsLens(), new CfgLens()];

/** Extension → lens index, built once from the registered lenses' `extensions`. */
const BY_EXTENSION: ReadonlyMap<string, CodeLens> = (() => {
  const map = new Map<string, CodeLens>();
  for (const lens of LENSES) {
    for (const ext of lens.extensions) {
      // First registration wins (deterministic registration order).
      if (!map.has(ext)) map.set(ext, lens);
    }
  }
  return map;
})();

/**
 * The lens responsible for `ext` (e.g. `'.ts'`), or `undefined` if none claims
 * it. `ext` is the file extension INCLUDING the leading dot.
 */
export function lensFor(ext: string): CodeLens | undefined {
  return BY_EXTENSION.get(ext);
}

/** All registered lenses (read-only — for enumeration). */
export function allLenses(): readonly CodeLens[] {
  return LENSES;
}
