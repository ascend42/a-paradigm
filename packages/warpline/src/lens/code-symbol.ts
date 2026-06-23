/**
 * #code-symbol — the pure string builders for a code-unit's WARP key and its
 * (path-fragile) structural stable key (spec §2).
 *
 * Both are LABELS — provenance + rename tiebreakers — and are NEVER hashed.
 * They are pure functions of their string inputs (no I/O, no path resolution),
 * which keeps them trivially deterministic across machines (§5).
 *
 *   - `codeSymbol(relPath, qualifiedName)`  → `#code:<rel-path>::<qualified-name>`
 *     the WARP key the lens injects into the SymbolIndex (e.g.
 *     `#code:packages/warpline/src/predict.ts::isKnot`).
 *   - `codeStableKey(relPath, structuralPath)` → `<rel-path>::<structural-path>`
 *     where structural-path is a `/`-joined chain of `(scopeKind#ordinal)`
 *     segments (e.g. `class#0/method#2`). Path-fragile under cross-file move;
 *     recovered via essence-equality matching exactly as `.purpose` rename
 *     recovery already works.
 */

/** `#code:<rel-path>::<qualified-name>` — the WARP key (label, never hashed). */
export function codeSymbol(relPath: string, qualifiedName: string): string {
  return '#code:' + relPath + '::' + qualifiedName;
}

/**
 * `<rel-path>::<structural-path>` — the structural stable key (label, never
 * hashed). `structuralPath` is the chain of `(scopeKind#ordinal)` segments
 * joined by `/` (e.g. `class#0/method#2`), built by the lens as it walks.
 */
export function codeStableKey(relPath: string, structuralPath: string): string {
  return relPath + '::' + structuralPath;
}
