/**
 * #guard-report — the pure core of the Warpline Guard action: OracleRecord →
 * GuardReport. No I/O, no env, no git — everything here is unit-testable.
 *
 * The report applies the KNOT-SIZE THRESHOLD (ground truth, 18 git-clean hits
 * over 275 real merges: flag-sets ≤6 direct-contested symbols were 50%
 * churn-validated; every ≥10-symbol set was 0%): only merges whose
 * direct-contested knot size is within the threshold get their symbols LISTED.
 * Larger flag sets are reported as a folded avalanche count — never as a wall
 * of symbols. Ripple-only flags (essence transitivity) always fold to a count.
 *
 * The threshold judges the oracle's RAW knotSize (the validated ranking key);
 * the paths filter only narrows what is listed/failed on, never the stratum.
 */

import type { OracleRecord } from '@a-company/warpline';

export const DEFAULT_THRESHOLD = 6;

/**
 * The honest scope line — rendered on EVERY report, quiet or flagged.
 * TypeScript-only, structural not semantic, symbol-local.
 */
export const SCOPE_LINE =
  'Scope: TypeScript only · structural, not semantic · symbol-local ' +
  '(cross-symbol dataflow interference is out of scope today). ' +
  'A quiet run means Warpline found no contested-symbol knots — ' +
  'not that the merge is correct.';

export type GuardVerdict =
  | 'clean' /** no meaning flags, git merges clean */
  | 'ripple-only' /** flags exist but none direct-contested — folded, advisory */
  | 'flagged' /** 1..threshold direct-contested symbols — the validated stratum */
  | 'avalanche' /** direct-contested count ABOVE threshold — 0%-precision stratum, folded */
  | 'git-conflict'; /** git itself conflicts — GitHub already blocks; Guard defers */

export interface GuardFlag {
  /** the flagged symbol name (e.g. `#code:src/types.ts::ZodRecord`) */
  symbol: string;
  /** repo-relative file parsed from a `#code:` symbol name, if any */
  file?: string;
  kind: 'knot' | 'dangling';
  /** slots both sides changed to different values (knots) */
  conflictingSlots: string[];
  /** the dangle detail (dangling only) */
  dangling?: { edgeKind: string; targetSymbol: string; retiredBy: 'A' | 'B' };
  /** BOTH branches' touch points: did base×A / base×B touch this symbol? */
  touchedBy: { A: boolean; B: boolean };
}

export interface GuardBranch {
  ref: string;
  /** commit subject of the branch tip (from the oracle's justification) */
  intent: string;
  touchedSymbols: number;
}

export interface GuardReport {
  schemaVersion: 1;
  tool: 'warpline-guard';
  engine: { name: '@a-company/warpline'; oracleSchemaVersion: number };
  ts: string;
  base: GuardBranch;
  head: GuardBranch;
  mergeBase: string;
  threshold: number;
  pathsFilter: string[];
  verdict: GuardVerdict;
  /** raw direct-contested count (the oracle's validated ranking key) */
  knotSize: number;
  /** raw divergeMeaningOnly count (pre-ranking volume) */
  flagCount: number;
  /** ripple-only flags — always folded, never listed */
  rippleCount: number;
  /** direct flags excluded from the listing by the paths filter */
  filteredOutCount: number;
  /** the LISTED flags: direct-contested, within threshold, matching the filter */
  flags: GuardFlag[];
  gitReality: { conflicted: boolean; conflictPaths: string[] };
  scopeLine: string;
  failOnFlag: boolean;
  /** true ⇔ failOnFlag AND verdict is `flagged` AND ≥1 listed flag survived the filter */
  shouldFail: boolean;
}

export interface GuardOptions {
  /** max direct-contested knot size to LIST (default 6 — the 50%-precision stratum) */
  threshold?: number;
  /** globs (`*`, `**`, `?`) over repo-relative files; empty = everything */
  paths?: string[];
  /** advisory by default — the action only exits non-zero when this is true */
  failOnFlag?: boolean;
}

/** Parse the repo-relative file out of a `#code:<rel-path>::<name>` symbol. */
export function codeFileOf(symbol: string): string | undefined {
  if (!symbol.startsWith('#code:')) return undefined;
  const rest = symbol.slice('#code:'.length);
  const sep = rest.indexOf('::');
  return sep === -1 ? undefined : rest.slice(0, sep);
}

// Minimal glob → RegExp: `**` crosses `/`, `*` and `?` do not. Anchored.
// Enough for src/**, packages/*/src/**/*.ts — no brace/extglob support.
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        // `**/` or trailing `**` — cross directories
        re += '.*';
        i++;
        if (glob[i + 1] === '/') i++;
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

/**
 * Does a flag survive the paths filter? Flags with NO parseable file (e.g. a
 * `.purpose` component symbol like `#oracle`) always survive — unknown is
 * surfaced, never silently dropped (the engine's own convention).
 */
function matchesFilter(flag: { file?: string }, patterns: RegExp[]): boolean {
  if (patterns.length === 0) return true;
  if (!flag.file) return true;
  return patterns.some((p) => p.test(flag.file!));
}

/** The diff-of-verdicts: fold an OracleRecord into the Guard's report. */
export function buildReport(record: OracleRecord, opts: GuardOptions = {}): GuardReport {
  const threshold = normalizeThreshold(opts.threshold);
  const paths = (opts.paths ?? []).map((p) => p.trim()).filter(Boolean);
  const failOnFlag = opts.failOnFlag ?? false;
  const patterns = paths.map(globToRegExp);

  const c = record.convergence;
  const knotSize = c.knotSize;
  const flagCount = c.flagCount;
  const rippleCount = c.rippleOnly.length;

  // verdict — git-conflict wins (GitHub blocks those PRs anyway; Guard defers),
  // then the knot-size stratum decides.
  let verdict: GuardVerdict;
  if (record.gitReality.conflicted) verdict = 'git-conflict';
  else if (knotSize === 0 && flagCount === 0) verdict = 'clean';
  else if (knotSize === 0) verdict = 'ripple-only';
  else if (knotSize <= threshold) verdict = 'flagged';
  else verdict = 'avalanche';

  // Listed flags: ONLY when the merge sits in the validated stratum.
  const touchedA = new Set(record.justifications.A.computedRipple.touchedSymbols);
  const touchedB = new Set(record.justifications.B.computedRipple.touchedSymbols);
  const knotBySymbol = new Map(record.prediction.knots.map((k) => [k.symbol, k]));
  const dangleBySymbol = new Map(record.prediction.dangling.map((d) => [d.fromSymbol, d]));

  const allDirect: GuardFlag[] =
    verdict === 'flagged'
      ? c.directContested.map((symbol) => {
          const knot = knotBySymbol.get(symbol);
          const dangle = dangleBySymbol.get(symbol);
          const flag: GuardFlag = {
            symbol,
            file: codeFileOf(symbol),
            kind: knot ? 'knot' : 'dangling',
            conflictingSlots: knot?.conflictingSlots ?? [],
            touchedBy: { A: touchedA.has(symbol), B: touchedB.has(symbol) },
          };
          if (!knot && dangle) {
            flag.dangling = {
              edgeKind: dangle.edgeKind,
              targetSymbol: dangle.danglingTargetSymbol,
              retiredBy: dangle.retiredBy,
            };
          }
          return flag;
        })
      : [];

  const flags = allDirect.filter((f) => matchesFilter(f, patterns));
  const filteredOutCount = allDirect.length - flags.length;

  return {
    schemaVersion: 1,
    tool: 'warpline-guard',
    engine: { name: '@a-company/warpline', oracleSchemaVersion: record.schemaVersion },
    ts: record.ts,
    base: {
      ref: record.branchA,
      intent: record.justifications.A.intent,
      touchedSymbols: record.justifications.A.computedRipple.touchedSymbols.length,
    },
    head: {
      ref: record.branchB,
      intent: record.justifications.B.intent,
      touchedSymbols: record.justifications.B.computedRipple.touchedSymbols.length,
    },
    mergeBase: record.mergeBase,
    threshold,
    pathsFilter: paths,
    verdict,
    knotSize,
    flagCount,
    rippleCount,
    filteredOutCount,
    flags,
    gitReality: {
      conflicted: record.gitReality.conflicted,
      conflictPaths: record.gitReality.conflictPaths,
    },
    scopeLine: SCOPE_LINE,
    failOnFlag,
    shouldFail: failOnFlag && verdict === 'flagged' && flags.length > 0,
  };
}

function normalizeThreshold(t: number | undefined): number {
  if (t === undefined || !Number.isFinite(t)) return DEFAULT_THRESHOLD;
  return Math.max(0, Math.floor(t));
}
