/**
 * #cfg-lens — the structured-data lens (roadmap P3 Lane A, GAP-1): lifts JSON /
 * YAML key-trees into `CodeUnit`-shaped nodes so config files — the census-proven
 * agent-collision center of mass (package.json, tsconfig, CI yaml) — get MEANING
 * verdicts instead of falling silently to the byte tier.
 *
 * GRANULARITY (cfg-v1, the merge algebra follows from it):
 *   - one FILE-ROOT marker unit per parsed file (`key: '/'`) — file presence is
 *     visible meaning; an empty `{}` is parsed-empty, never silent-empty.
 *   - a top-level key whose value is a NON-EMPTY MAP lifts ONE UNIT PER CHILD
 *     (`/dependencies/react`) — so two agents each adding a DIFFERENT dependency
 *     touch DISJOINT units and COMMUTE (autoClean with a meaning verdict), while
 *     the same dep at different versions is a same-unit divergent body → KNOT.
 *     A child's whole value subtree is its body (deeper nesting is one leaf).
 *   - a top-level SCALAR (or empty-map) key lifts one unit (`/version`) — two
 *     divergent bumps of the same scalar are a KNOT (correct: version-bump races
 *     are real contradictions).
 *   - SEQUENCES (arrays) DEFER TO THE BYTE TIER: a unit whose value subtree
 *     contains a sequence anywhere becomes a REDUCED-FIDELITY marker with a
 *     content-INDEPENDENT body. Order is meaning for a sequence, and the cfg
 *     key-tree algebra cannot honestly claim it — pretending would KNOT edits
 *     (e.g. two agents editing different steps of one CI job) that the token
 *     byte-merge composes today. Visible marker, never a silent gap; never a
 *     false verdict. (cfg-v2 candidate: set-like sequence semantics.)
 *
 * DETERMINISM (mirrors ts-essence's literal discipline):
 *   - scalar values hash as their RAW SOURCE LEXEMES (`"^18.0"` incl. quotes;
 *     `1.0` ≠ `1`; YAML re-quoting moves the essence — conservative: may surface
 *     a false knot, never a false clean);
 *   - map key ORDER is NOT meaning — canonicalSerialize sorts keys, so a pure
 *     key reorder is the EMPTY delta (the meaning-primary payoff);
 *   - the KEY PATH and the FILE PATH are folded into the body — a DELIBERATE,
 *     documented exception to "labels are never hashed": for structured data the
 *     key path IS the contract (`{"a":1}` ≠ `{"b":1}`), and a config file's
 *     location IS its meaning (packages/a/package.json ≠ packages/b/…). Cost:
 *     renaming a cfg file reads as retire+born, never `rename` (conservative);
 *   - the essence tag is `cfg-v1` (CFG_ESSENCE_TAG) — its own content-address
 *     namespace, never colliding with TS CCNF essences.
 *
 * FAIL-CLOSED: unparseable / duplicate-key / non-map-root / multi-document /
 * anchor-alias-tag-bearing YAML / oversize files stay at the BYTE TIER, marked
 * by a single visible reduced-fidelity `unliftable` unit (never silent-empty).
 * YAML accepts the plain core schema ONLY (no custom tags, no anchors/aliases,
 * no merge keys — `<<` falls to byte tier). JSON is parsed by a strict local
 * scanner extended with JSONC comforts (comments + trailing commas — tsconfig
 * reality); comments are prose, never hashed. LOCKFILES are excluded entirely
 * (#derived-artifacts — derived, never lifted, never knotted).
 *
 * Library code: no console output.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { parseAllDocuments, isMap, isScalar, isSeq, isAlias } from 'yaml';
import type { CodeLens, CodeUnit } from './code-lens.js';
import { codeStableKey } from './code-symbol.js';
import { canonicalSerialize, type CanonicalValue } from '../warp/canonical.js';
import { isDerivedArtifact } from './derived-artifacts.js';

/**
 * The cfg essence version tag (its own content-address namespace, spec §5.2
 * discipline). Bump on ANY change to the lift granularity, the body layout, or
 * the lexeme rules — a different algorithm must never silently collide.
 */
export const CFG_ESSENCE_TAG = 'cfg-v1';

const CFG_EXTENSIONS = ['.json', '.yml', '.yaml'] as const;

/**
 * Directories never descended into. The ts-lens set PLUS the framework/VCS state
 * dirs: `.warpline` (the fabric must never lift itself), `.loom` (the Loom-era
 * engine's own state dir — same rule, prior name; R1 hygiene T-2026-07-17-007:
 * absorb(WORKTREE) was lifting thousands of `#cfg:.loom/states/*.json` symbols
 * into every worktree verdict) and `.paradigm` (machine-managed index/state —
 * already lifted as symbols where it is meaning).
 */
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.warpline', '.loom', '.paradigm',
]);

/** Files above this size fall to the byte tier (`too-large` marker). */
const MAX_CFG_BYTES = 1 << 20; // 1 MiB

/* ── the parsed value tree ────────────────────────────────────────────────── */

/**
 * The lens-internal value tree. Scalars carry their RAW SOURCE LEXEME (never a
 * re-serialization); sequences are OPAQUE (presence only — they defer the owning
 * unit to the byte tier, so their content is deliberately not modeled).
 */
type CfgValue =
  | { kind: 'scalar'; lexeme: string }
  | { kind: 'map'; entries: Array<[string, CfgValue]> }
  | { kind: 'seq' };

/** Why a file (or unit) fell to the byte tier — deterministic category strings. */
type UnliftableReason =
  | 'parse-error'
  | 'duplicate-key'
  | 'non-map-root'
  | 'multi-document'
  | 'unsafe-yaml'
  | 'too-large';

class CfgUnliftable extends Error {
  constructor(readonly reason: UnliftableReason) {
    super(`cfg unliftable: ${reason}`);
  }
}

/* ── JSON/JSONC scanner (raw lexemes + duplicate-key detection) ───────────── */
// JSON.parse cannot serve here: it silently keeps the LAST duplicate key (we
// must fail closed), discards number lexemes (`1.0` → 1), and rejects the
// JSONC comments/trailing-commas that real tsconfig files carry.

function parseJsonc(src: string): CfgValue {
  let i = 0;
  const err = (): never => {
    throw new CfgUnliftable('parse-error');
  };

  const skipWs = (): void => {
    for (;;) {
      while (i < src.length && ' \t\r\n'.includes(src[i])) i++;
      if (src.startsWith('//', i)) {
        while (i < src.length && src[i] !== '\n') i++;
      } else if (src.startsWith('/*', i)) {
        const end = src.indexOf('*/', i + 2);
        if (end < 0) err();
        i = end + 2;
      } else {
        return;
      }
    }
  };

  const scanString = (): string => {
    // Returns the RAW LEXEME including quotes. Validates escape shape loosely.
    const start = i;
    if (src[i] !== '"') err();
    i++;
    while (i < src.length) {
      const c = src[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '"') {
        i++;
        return src.slice(start, i);
      }
      if (c === '\n') err(); // raw newline inside a JSON string
      i++;
    }
    return err();
  };

  const scanNumber = (): string => {
    const start = i;
    if (src[i] === '-') i++;
    if (!/[0-9]/.test(src[i] ?? '')) err();
    while (/[0-9]/.test(src[i] ?? '')) i++;
    if (src[i] === '.') {
      i++;
      if (!/[0-9]/.test(src[i] ?? '')) err();
      while (/[0-9]/.test(src[i] ?? '')) i++;
    }
    if (src[i] === 'e' || src[i] === 'E') {
      i++;
      if (src[i] === '+' || src[i] === '-') i++;
      if (!/[0-9]/.test(src[i] ?? '')) err();
      while (/[0-9]/.test(src[i] ?? '')) i++;
    }
    return src.slice(start, i);
  };

  const parseValue = (): CfgValue => {
    skipWs();
    const c = src[i];
    if (c === '{') {
      i++;
      const entries: Array<[string, CfgValue]> = [];
      const seen = new Set<string>();
      skipWs();
      if (src[i] === '}') {
        i++;
        return { kind: 'map', entries };
      }
      for (;;) {
        skipWs();
        if (src[i] === '}') {
          i++; // trailing comma (JSONC)
          return { kind: 'map', entries };
        }
        const keyLexeme = scanString();
        const key = JSON.parse(keyLexeme) as string;
        if (seen.has(key)) throw new CfgUnliftable('duplicate-key');
        seen.add(key);
        skipWs();
        if (src[i] !== ':') err();
        i++;
        entries.push([key, parseValue()]);
        skipWs();
        if (src[i] === ',') {
          i++;
          continue;
        }
        if (src[i] === '}') {
          i++;
          return { kind: 'map', entries };
        }
        err();
      }
    }
    if (c === '[') {
      i++;
      // Sequences are opaque — parse (to find the end + validate) and discard.
      skipWs();
      if (src[i] === ']') {
        i++;
        return { kind: 'seq' };
      }
      for (;;) {
        skipWs();
        if (src[i] === ']') {
          i++; // trailing comma (JSONC)
          return { kind: 'seq' };
        }
        parseValue();
        skipWs();
        if (src[i] === ',') {
          i++;
          continue;
        }
        if (src[i] === ']') {
          i++;
          return { kind: 'seq' };
        }
        err();
      }
    }
    if (c === '"') return { kind: 'scalar', lexeme: scanString() };
    if (c === '-' || /[0-9]/.test(c ?? '')) return { kind: 'scalar', lexeme: scanNumber() };
    for (const lit of ['true', 'false', 'null']) {
      if (src.startsWith(lit, i)) {
        i += lit.length;
        return { kind: 'scalar', lexeme: lit };
      }
    }
    return err();
  };

  const root = parseValue();
  skipWs();
  if (i !== src.length) err();
  return root;
}

/* ── YAML (plain core schema only; anchors/aliases/tags/merge → byte tier) ── */

function parseYamlSafe(src: string): CfgValue {
  const docs = parseAllDocuments(src, { uniqueKeys: true });
  if (docs.length > 1) throw new CfgUnliftable('multi-document');
  const doc = docs[0];
  if (!doc) throw new CfgUnliftable('non-map-root'); // empty stream
  if (doc.errors.length > 0) {
    const dup = doc.errors.some((e) => e.code === 'DUPLICATE_KEY');
    throw new CfgUnliftable(dup ? 'duplicate-key' : 'parse-error');
  }

  const toValue = (node: unknown): CfgValue => {
    if (node === null || node === undefined) return { kind: 'scalar', lexeme: 'null' };
    if (isAlias(node as object)) throw new CfgUnliftable('unsafe-yaml');
    const n = node as { anchor?: string; tag?: string; range?: [number, number, number] };
    // Anchors and explicit tags are outside the plain core schema — byte tier.
    if (n.anchor) throw new CfgUnliftable('unsafe-yaml');
    if (n.tag) throw new CfgUnliftable('unsafe-yaml');
    if (isScalar(node as object)) {
      const s = node as { value: unknown; range?: [number, number, number] };
      // RAW SOURCE LEXEME (as-written is meaning — ts-essence's literal
      // discipline). The range slice covers exactly the scalar's source text.
      const lexeme = s.range
        ? src.slice(s.range[0], s.range[1])
        : JSON.stringify(s.value ?? null);
      return { kind: 'scalar', lexeme };
    }
    if (isSeq(node as object)) {
      // Opaque — but the SUBTREE must still be safety-scanned: an anchor/alias
      // inside a sequence is as unsafe as one outside it.
      const seq = node as { items: unknown[] };
      for (const item of seq.items) scanSafety(item);
      return { kind: 'seq' };
    }
    if (isMap(node as object)) {
      const map = node as { items: Array<{ key: unknown; value: unknown }> };
      const entries: Array<[string, CfgValue]> = [];
      for (const pair of map.items) {
        const k = pair.key;
        if (!isScalar(k as object)) throw new CfgUnliftable('unsafe-yaml'); // complex keys
        const kk = k as { value: unknown; anchor?: string; tag?: string };
        if (kk.anchor || kk.tag) throw new CfgUnliftable('unsafe-yaml');
        const keyText = String(kk.value);
        if (keyText === '<<') throw new CfgUnliftable('unsafe-yaml'); // merge key
        entries.push([keyText, toValue(pair.value)]);
      }
      return { kind: 'map', entries };
    }
    throw new CfgUnliftable('parse-error');
  };

  // Safety-only walk for opaque sequence subtrees (content discarded).
  const scanSafety = (node: unknown): void => {
    if (node === null || node === undefined) return;
    if (isAlias(node as object)) throw new CfgUnliftable('unsafe-yaml');
    const n = node as { anchor?: string; tag?: string };
    if (n.anchor || n.tag) throw new CfgUnliftable('unsafe-yaml');
    if (isSeq(node as object)) {
      for (const item of (node as { items: unknown[] }).items) scanSafety(item);
    } else if (isMap(node as object)) {
      for (const pair of (node as { items: Array<{ key: unknown; value: unknown }> }).items) {
        scanSafety(pair.key);
        scanSafety(pair.value);
      }
    }
  };

  return toValue(doc.contents);
}

/* ── key-tree → CodeUnits ─────────────────────────────────────────────────── */

/** RFC 6901 JSON-pointer segment escape (`~` → `~0`, `/` → `~1`). */
function escapePointerSegment(seg: string): string {
  return seg.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Does this value subtree contain a sequence anywhere? (→ byte-tier deferral) */
function containsSeq(v: CfgValue): boolean {
  if (v.kind === 'seq') return true;
  if (v.kind === 'map') return v.entries.some(([, w]) => containsSeq(w));
  return false;
}

/** A seq-free value subtree → CanonicalValue (scalars = raw lexeme strings). */
function toCanonical(v: CfgValue): CanonicalValue {
  if (v.kind === 'scalar') return v.lexeme;
  if (v.kind === 'map') {
    const obj: { [key: string]: CanonicalValue } = {};
    for (const [k, w] of v.entries) obj[k] = toCanonical(w);
    return obj; // canonicalSerialize sorts keys — entry ORDER is not meaning
  }
  throw new CfgUnliftable('parse-error'); // unreachable: caller checked containsSeq
}

function cfgSymbol(relPath: string, keyPath: string): string {
  return '#cfg:' + relPath + '::' + keyPath;
}

interface UnitSpec {
  keyPath: string;
  body: string;
  reducedFidelity?: boolean;
  cfgMarker?: 'file' | 'seq' | 'unliftable';
}

function toUnit(relPath: string, spec: UnitSpec): CodeUnit {
  return {
    symbol: cfgSymbol(relPath, spec.keyPath),
    qualifiedName: spec.keyPath,
    filePath: relPath,
    structuralPath: 'cfg' + spec.keyPath,
    stableKey: codeStableKey(relPath, 'cfg' + spec.keyPath),
    componentType: 'code-unit',
    codeEssence: spec.body,
    references: [],
    essenceTag: CFG_ESSENCE_TAG,
    ...(spec.reducedFidelity ? { reducedFidelity: true } : {}),
    ...(spec.cfgMarker ? { cfgMarker: spec.cfgMarker } : {}),
  };
}

/** One unit for a lifted key (value body) or its seq-deferral marker. */
function keyUnit(relPath: string, keyPath: string, value: CfgValue): UnitSpec {
  if (containsSeq(value)) {
    // Content-INDEPENDENT marker: edits inside the sequence never move the
    // essence, so the byte tier governs — visible, never a false verdict.
    return {
      keyPath,
      body: canonicalSerialize({ cfg: CFG_ESSENCE_TAG, file: relPath, key: keyPath, marker: 'seq' }),
      reducedFidelity: true,
      cfgMarker: 'seq',
    };
  }
  return {
    keyPath,
    body: canonicalSerialize({
      cfg: CFG_ESSENCE_TAG,
      file: relPath,
      key: keyPath,
      value: toCanonical(value),
    }),
  };
}

/** Lift a parsed root map into the cfg-v1 unit set (see module docstring). */
function liftUnits(relPath: string, root: CfgValue): CodeUnit[] {
  if (root.kind !== 'map') throw new CfgUnliftable('non-map-root');
  const specs: UnitSpec[] = [
    {
      keyPath: '/',
      body: canonicalSerialize({ cfg: CFG_ESSENCE_TAG, file: relPath, key: '/', marker: 'file' }),
      cfgMarker: 'file',
    },
  ];
  for (const [k, v] of root.entries) {
    const kp = '/' + escapePointerSegment(k);
    if (v.kind === 'map' && v.entries.length > 0) {
      // depth-2: one unit per CHILD — disjoint adds commute (the dependency case)
      for (const [c, w] of v.entries) {
        specs.push(keyUnit(relPath, kp + '/' + escapePointerSegment(c), w));
      }
    } else {
      // scalar, sequence, or empty map — one unit for the key itself
      specs.push(keyUnit(relPath, kp, v));
    }
  }
  return specs.map((s) => toUnit(relPath, s));
}

/** The single visible byte-tier fallback marker for an unliftable file. */
function unliftableUnit(relPath: string, reason: UnliftableReason): CodeUnit {
  return toUnit(relPath, {
    keyPath: '/',
    body: canonicalSerialize({
      cfg: CFG_ESSENCE_TAG,
      file: relPath,
      key: '/',
      marker: 'unliftable',
      reason,
    }),
    reducedFidelity: true,
    cfgMarker: 'unliftable',
  });
}

/* ── the lens ─────────────────────────────────────────────────────────────── */

/** Enumerate cfg files under `rootDir`, SORTED; lockfiles excluded entirely. */
async function enumerateCfgFiles(rootDir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        await walk(full);
      } else if (e.isFile()) {
        const ext = path.extname(e.name);
        if (!(CFG_EXTENSIONS as readonly string[]).includes(ext)) continue;
        if (isDerivedArtifact(e.name)) continue; // derived — never lifted
        out.push(full);
      }
    }
  };
  await walk(rootDir);
  out.sort();
  return out;
}

/**
 * The JSON/YAML structured-data lens. Stateless; reads the (read-only) worktree
 * only. Every file lifts to its key-tree units, or — fail-closed — to a single
 * visible `unliftable` marker (the file stays at the byte tier).
 */
export class CfgLens implements CodeLens {
  readonly extensions: readonly string[] = CFG_EXTENSIONS;

  async lift(rootDir: string): Promise<CodeUnit[]> {
    const root = path.resolve(rootDir);
    const files = await enumerateCfgFiles(root);
    const out: CodeUnit[] = [];
    for (const abs of files) {
      const relPath = path.relative(root, abs).split(path.sep).join('/');
      out.push(...(await this.liftFile(abs, relPath)));
    }
    out.sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
    return out;
  }

  private async liftFile(abs: string, relPath: string): Promise<CodeUnit[]> {
    try {
      const stat = await fs.stat(abs);
      if (stat.size > MAX_CFG_BYTES) return [unliftableUnit(relPath, 'too-large')];
      const src = await fs.readFile(abs, 'utf8');
      const ext = path.extname(relPath);
      const value = ext === '.json' ? parseJsonc(src) : parseYamlSafe(src);
      return liftUnits(relPath, value);
    } catch (e) {
      // FAIL CLOSED to the byte tier — with a VISIBLE marker, never silent-empty.
      const reason: UnliftableReason = e instanceof CfgUnliftable ? e.reason : 'parse-error';
      return [unliftableUnit(relPath, reason)];
    }
  }
}
