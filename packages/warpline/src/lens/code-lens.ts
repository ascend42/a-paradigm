/**
 * #code-lens — the interface surface of the TS code-lens (spec §2).
 *
 * Types ONLY. The lens lifts real TS code-units (functions, methods,
 * constructors, accessors, arrow-consts) into objects shaped like a
 * premise-core `SymbolEntry`, so they flow through the EXISTING WARP
 * (essence-hash / sem-delta / predict / oracle) as synthetic nodes in the
 * SAME universe — never a parallel graph.
 *
 * The implementation lives in:
 *   - `ts-essence.ts`  → the pure-syntactic CCNF producer (`codeCNF`)
 *   - `ts-lens.ts`     → the `createProgram` + checker-resolution lift (stage 2)
 *   - `registry.ts`    → the lens registry (stage 2)
 *
 * This file declares no behavior; it pins the shape the rest of the lens
 * machinery is built against.
 */

/**
 * The syntactic role of a free reference (spec §4). `edgeKind` widens to
 * `calls`/`reads`/`types`; the edge bag sort is kind-agnostic, so this is an
 * additive label that sharpens the WARP edge without changing the algebra.
 */
export type CodeEdgeKind = 'calls' | 'reads' | 'types';

/**
 * A resolved free reference (§4), aligned 1:1 with the body's positional free
 * slot (`freeRefs[idx]` ↔ the `f:idx` token). Stage 3 substitutes the resolved
 * target's essence inline at the slot, so the ARRAY ORDER carries meaning (call
 * order is meaning — a sorted edge-set would be wrong).
 *
 * The four classifications (§4):
 *   - `local`      → resolves to a lifted code-unit UNDER rootDir; carries the
 *                    target's `#code:` symbol + the syntactic `edgeKind`. The
 *                    body emits `f:idx`; the frontier-closing Merkle-by-target
 *                    case.
 *   - `extern`     → an imported name; `id = extern:<specifier-as-written>#<exportName>`,
 *                    derived from the SYNTACTIC import statement (NOT checker
 *                    module resolution — §5.3 determinism). Body emits `free:name`.
 *   - `builtin`    → a TS lib/global (`Math.max`, `console`); carries the name.
 *                    Body emits `free:name`.
 *   - `unresolved` → no resolution; carries the name and flips the unit's
 *                    `reducedFidelity` (§4 case d). Body emits `free:name`.
 */
export type CodeRef =
  | { kind: 'local'; edgeKind: CodeEdgeKind; target: string }
  | { kind: 'extern'; id: string }
  | { kind: 'builtin'; name: string }
  | { kind: 'unresolved'; name: string };

/**
 * A synthetic code-unit node — a `SymbolEntry`-shaped object the lens injects
 * into the live `SymbolIndex` BEFORE `computeEssences` runs. Per spec §2:
 *
 *   - `symbol`        = `#code:<rel-path>::<qualified-name>` (the KEY; the path
 *                       and qname are a LABEL — provenance + rename tiebreaker —
 *                       and are NEVER hashed).
 *   - `qualifiedName` = the fully-qualified declaration name (label).
 *   - `filePath`      = repo-relative source path (label).
 *   - `structuralPath`= the `(scopeKind#ordinal)` chain (label; the stableKey tail).
 *   - `stableKey`     = `<rel-path>::<structural-path>` (label — rename recovery).
 *   - `componentType` = the new identity-bearing literal `'code-unit'`.
 *   - `codeEssence`   = the Code Canonical Normal Form (CCNF, §3) — the one new
 *                       identity-bearing contract slot.
 *   - `references`    = the resolved free-reference graph (§4), aligned to the
 *                       body's `f:idx` positional slots.
 *   - `reducedFidelity` = set when an edge degraded to `unresolved` (§4 case d)
 *                       or the unit fell to a lower fidelity tier (§8). Counts
 *                       against meaning-coverage; it is a visible marker, never
 *                       a silent-empty essence.
 */
export interface CodeUnit {
  /** The WARP key. `#code:<rel-path>::<qualified-name>`. Label, never hashed. */
  symbol: string;
  /** Provenance label: the fully-qualified declaration name (e.g. `Checkout.submit`). */
  qualifiedName: string;
  /** Repo-relative source path the unit was lifted from. Label, never hashed. */
  filePath: string;
  /** The `(scopeKind#ordinal)` structural chain (e.g. `class#0/method#2`). Label. */
  structuralPath: string;
  /** `<rel-path>::<structural-path>` — the path-fragile stable key. Label. */
  stableKey: string;
  /** The identity-bearing kind discriminator for code-units. */
  componentType: 'code-unit';
  /** The Code Canonical Normal Form (§3) — the identity-bearing body slot. */
  codeEssence: string;
  /**
   * The SIGNATURE-ONLY projection of the same unit (T-2026-07-15-008 stage 1):
   * `codeEssence` minus the body. NON-identity-bearing by construction — the
   * essence hashes `codeEssence` and the enumerated contract slots only, so
   * carrying this moves no contentId and no stateId.
   *
   * It supplies the datum the engine previously lacked: for a caller whose
   * contentId moved by Merkle ripple alone, whether the CALLEE'S CONTRACT
   * moved or only its body. `sem-delta` derives `rippleFromContract` from it.
   *
   * OPTIONAL on the lens surface: a lens with no separable signature (cfg)
   * simply omits it and `lift-code-units` falls back to `codeEssence` — fail
   * closed, i.e. every change to such a unit reads as a contract move.
   */
  codeSignature?: string;
  /** Resolved free-reference edges (§4), aligned to the body's `f:idx` slots. */
  references: CodeRef[];
  /** Set when fidelity degraded (unresolved edge / lower tier). Visible marker. */
  reducedFidelity?: boolean;
  /**
   * Per-unit essence version-tag override (additive, P3 GAP-1). When absent the
   * TS default (`CODE_ESSENCE_TAG`) applies; the cfg lens stamps `cfg-v1` so
   * structured-data essences live in their own content-address namespace.
   */
  essenceTag?: string;
  /**
   * cfg-lens marker discriminator (additive, P3 GAP-1). Set on the units whose
   * body is a MARKER rather than lifted meaning: `'file'` (file-presence root),
   * `'seq'` (sequence-valued key — byte-tier deferral), `'unliftable'` (whole
   * file fell to the byte tier). Consumed by the #honesty classifier: a path
   * with ONLY marker units is `byte-decided`, never `meaning-decided`.
   */
  cfgMarker?: string;
}

/**
 * A code-lens: a pluggable producer of `CodeUnit`s for a given source tree.
 *
 *   - `extensions` — the file extensions this lens claims (e.g. `['.ts', '.tsx']`).
 *   - `lift(...)`  — read a (read-only) worktree and emit the code-units it
 *                    contains. The concrete TS implementation lives in
 *                    `ts-lens.ts`; this is the contract the registry binds to.
 *
 * `lift` is intentionally declared abstractly here (signature only — no impl) so
 * stage 1 ships the shape and stage 2 supplies the `createProgram` machinery.
 */
export interface CodeLens {
  /** File extensions this lens is responsible for. */
  readonly extensions: readonly string[];
  /**
   * Lift the code-units found under `worktreeRoot` (an absolute path to a
   * detached, read-only worktree). Returns the synthetic nodes to inject into
   * the live `SymbolIndex`.
   */
  lift(worktreeRoot: string): Promise<CodeUnit[]>;
}
