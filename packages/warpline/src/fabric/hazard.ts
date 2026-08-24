/**
 * #clean-hazard — the CLEAN-hazard ADVISORY (T-2026-06-24-015).
 *
 * WHAT IT IS, AND WHAT IT IS EMPHATICALLY NOT. This module NEVER changes a
 * verdict. It cannot produce an `AdmitStatus`, cannot move `sealed`, cannot
 * raise a refusal, cannot enter `knots`/`dangling`. It is a note attached to a
 * CLEAN admission that already happened. The field test this was built for
 * measures a CONTESTED DENOMINATOR (K3), and the founder deliberately declined
 * the over-block fix — so an advisory that inflated KNOT/DANGLE counts would
 * corrupt the very measurement it was built to protect. `health.ts` counts
 * contested as KNOT||DANGLE, and `shadow.ts` derives `meaningContested` from
 * `knots.length>0 || dangling.length>0`; this module is invisible to both by
 * construction, and `test/clean-hazard.test.ts` pins that invariance.
 *
 * THE DEFECT IT ANNOTATES. Two verified facts:
 *
 *   1. `cfg-lens.ts:375` emits `references: []` on EVERY config node, so config
 *      nodes are permanent GRAPH ISLANDS — no edge in, no edge out. Any
 *      (config-value change × code change) pair is therefore NECESSARILY a
 *      symbol-disjoint `independent` CLEAN and auto-weaves with zero review.
 *      On an Expo/React-Native app that is app.json / eas.json / package.json
 *      versus the code that reads them, guaranteed by construction.
 *   2. `grade.ts:41` K_MIN_GRADED=3 and `grade.ts:247` returns [] on a missing
 *      sidecar, so the trust floor (HELD) CANNOT fire on a fresh repo. There is
 *      no safety net under (1).
 *
 * THE SIGNAL, STATED HONESTLY. Each side's LOCALLY-CHANGED units (`SemDelta.
 * localChanged`) are token-scanned; the VALUE tokens that entered or left each
 * essence are intersected across the two sides and weighted by rarity. A
 * non-empty intersection on a symbol-disjoint CLEAN is a LEXICAL coupling the
 * symbol graph did not model.
 *
 * ITS LIMIT, STATED JUST AS PLAINLY (and pinned by a test, not only by this
 * paragraph): this detects SHARED TOKENS. The canonical invariant conflict —
 * side A changes a bound from 100 to 50, side B writes an unrelated retry loop
 * that assumed 100 — shares NO token, and is NOT detectable here. Nothing in
 * this module licenses the sentence "Warpline catches invariant conflicts."
 *
 * RARITY IS THE WHOLE REASON THIS IS USABLE. `num:0`, `str:""`, `free:useState`
 * score ~0; `num:50`, `str:"rate_limit"`, `free:MAX_RETRIES` score high. The
 * index is computed from the BASE state alone and needs NO break-history —
 * which matters, because on a fresh repo there is none.
 *
 * DANGER FLAGS ARE A MULTIPLIER, NEVER A TRIGGER. A portal gate on a
 * participating symbol, or high inbound fan-in in the base graph, raises the
 * SEVERITY of an already-triggered hazard. Neither can create one.
 *
 * PURITY. `evaluateHazards` mirrors `evaluateEscalation`'s contract: a pure
 * function of its inputs — no clock, no disk, no randomness. The only I/O here
 * is the sidecar writer, which is suppressed under `shadow` exactly like
 * `recordGradeEscalation`.
 *
 * Library code: no console output.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { CFG_ESSENCE_TAG } from '../lens/cfg-lens.js';
import { diff } from '../sem-delta.js';
import type { WarpState } from '../warp/warp-state.js';
import type { WarpObject } from '../warp/warp-object.js';
import { warplineDirOf } from './fabric.js';
import { readHazardConfig } from './config.js';
import type { AdmitConfidence, AdmitDecision } from './admit.js';

/** G1 version stamp for the advisory shape (additive evolution or a bump). */
export const HAZARD_SCHEMA = 'cleanHazard:v1' as const;

/**
 * WHY the two sides are lexically coupled.
 *   'cfg-island'       one side is a `#cfg:` unit and the other is not — the
 *                      config-node-is-a-graph-island case (cfg-lens.ts:375).
 *                      Ranked as its own kind because it is the one hazard
 *                      class the graph is STRUCTURALLY unable to link.
 *   'shared-free-ref'  both sides moved the same free VALUE name (`free:NAME`).
 *   'shared-literal'   both sides moved the same literal (`str:` / `num:`).
 */
export type HazardKind = 'shared-literal' | 'shared-free-ref' | 'cfg-island';

/**
 * A severity MULTIPLIER on an already-triggered hazard. Never a trigger.
 *   'portal-gate'   a participating symbol carries `contract.gates`, or is the
 *                   target of an edge from a symbol that does.
 *   'high-fan-in'   a participating symbol has ≥ HAZARD_FAN_IN_MIN inbound
 *                   edges in the BASE graph (blast radius if it is wrong).
 */
export type HazardDangerFlag = 'portal-gate' | 'high-fan-in';

/** One lexical coupling the symbol graph did not model. Advisory. */
export interface CleanHazard {
  kind: HazardKind;
  /** the canonical shared token: `str:<decoded>` / `num:<normalized>` / `free:<name>`. */
  token: string;
  /** symbols on the PROPOSED side whose essence gained or lost the token (capped, sorted). */
  oursSymbols: string[];
  /** symbols on the SELVAGE side whose essence gained or lost the token (capped, sorted). */
  theirsSymbols: string[];
  /** 0..1 — how informative the token is in the BASE corpus (see rarityOf). */
  rarity: number;
  /** 0..1 — rarity after the danger multiplier; the ranking key. */
  score: number;
  dangerFlags: HazardDangerFlag[];
}

/* ── the knobs (all documented, none hand-tuned against an outcome corpus) ──── */

/** Default `hazard.minScore` — a hazard below this is not reported. */
export const HAZARD_MIN_SCORE = 0.5;
/** Per-danger-flag severity multiplier increment. */
export const HAZARD_DANGER_WEIGHT = 0.25;
/** Inbound-edge count in the BASE graph that earns 'high-fan-in'. */
export const HAZARD_FAN_IN_MIN = 5;
/** Max hazards on one advisory (bounds the result + the sidecar row). */
export const HAZARD_MAX = 25;
/** Max symbols named per side, per hazard. */
export const HAZARD_SYMBOL_CAP = 10;
/** Literals/names shorter than this carry no coupling information. */
const MIN_LITERAL_LEN = 3;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/* ── token extraction ────────────────────────────────────────────────────────
 *
 * The ts CCNF vocabulary is machine-extractable by regex (ts-essence.ts:445-456,
 * 496, 498, 509): `free:{name}`, `str:"…"`, `num:…`, `tmpl:"…"`. The scan is a
 * SINGLE left-to-right pass with a string-literal alternative that CONSUMES
 * quoted regions, so a `free:x` occurring INSIDE a string literal's payload can
 * never be mistaken for a real free reference (JSON.stringify escapes every
 * control char, so the literal cannot forge a token boundary either).
 *
 * cfg bodies are canonical JSON (cfg-lens.ts:396-402) and are walked instead,
 * because their scalars are RAW SOURCE LEXEMES, not CCNF tokens.
 */

const CCNF_SCAN =
  /(?:str|tmpl):("(?:[^"\\]|\\.)*")|re:\/(?:[^/\\\n]|\\.)*\/[a-z]*|"(?:[^"\\]|\\.)*"|num:([0-9.][^\s)\]>]*)|free:([A-Za-z_$][A-Za-z0-9_$]*)/g;

function decodeJsonString(lexeme: string): string | null {
  try {
    const v: unknown = JSON.parse(lexeme);
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

/**
 * Canonicalize a numeric lexeme the way `ts-essence.normalizeNumeric` does, so
 * a cfg `5000` and a ts `num:5000` are THE SAME TOKEN. Non-integer forms keep
 * their lexeme verbatim (as the essence does) rather than round-tripping
 * through IEEE-754.
 */
function normalizeNumericToken(raw0: string): string {
  const raw = raw0.replace(/_/g, '');
  const neg = raw.startsWith('-');
  const body = neg ? raw.slice(1) : raw;
  const sign = neg ? '-' : '';
  try {
    if (/^0[xX][0-9a-fA-F]+$/.test(body)) return sign + BigInt(body).toString(10);
    if (/^0[oO][0-7]+$/.test(body)) return sign + BigInt(body).toString(10);
    if (/^0[bB][01]+$/.test(body)) return sign + BigInt(body).toString(10);
    if (/^0[0-7]+$/.test(body)) return sign + BigInt('0o' + body.slice(1)).toString(10);
    if (/^[0-9]+$/.test(body)) return sign + BigInt(body).toString(10);
  } catch {
    /* an unparseable numeric lexeme keeps its raw form */
  }
  return raw;
}

/** The VALUE tokens carried by one ts CCNF body. */
export function extractCodeTokens(codeEssence: string): Set<string> {
  const out = new Set<string>();
  CCNF_SCAN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CCNF_SCAN.exec(codeEssence)) !== null) {
    if (m[1] !== undefined) {
      const s = decodeJsonString(m[1]);
      if (s !== null) out.add('str:' + s.normalize('NFC'));
    } else if (m[2] !== undefined) {
      out.add('num:' + normalizeNumericToken(m[2]));
    } else if (m[3] !== undefined) {
      out.add('free:' + m[3]);
    }
    // the bare-string and `re:` alternatives match to be CONSUMED, not read.
  }
  return out;
}

/** One cfg scalar LEXEME → the canonical token, or null when it carries none. */
function lexemeToken(lexeme: string): string | null {
  const t = lexeme.trim();
  if (t === '') return null;
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    const d = decodeJsonString(t);
    return d === null ? null : 'str:' + d.normalize('NFC');
  }
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
    return 'str:' + t.slice(1, -1).replace(/''/g, "'").normalize('NFC');
  }
  if (/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?$/.test(t)) {
    return 'num:' + normalizeNumericToken(t);
  }
  // Booleans / null / the YAML null tilde are structure, not values.
  if (t === 'true' || t === 'false' || t === 'null' || t === '~') return null;
  return 'str:' + t.normalize('NFC'); // YAML plain scalar
}

function walkCfgValue(v: unknown, out: Set<string>): void {
  if (typeof v === 'string') {
    const t = lexemeToken(v);
    if (t !== null) out.add(t);
    return;
  }
  if (typeof v === 'number') {
    out.add('num:' + normalizeNumericToken(String(v)));
    return;
  }
  if (Array.isArray(v)) {
    for (const x of v) walkCfgValue(x, out);
    return;
  }
  if (typeof v === 'object' && v !== null) {
    for (const x of Object.values(v as Record<string, unknown>)) walkCfgValue(x, out);
  }
}

/**
 * The VALUE tokens carried by one cfg-v1 body. Only the `value` subtree is
 * walked: `cfg`/`file`/`key`/`marker` are the unit's own structural identity
 * (cfg-lens folds the key path and file path into the body deliberately), not
 * configured values, and scanning them would couple every unit in a file to
 * every other by its own name.
 */
export function extractCfgTokens(body: string): Set<string> {
  const out = new Set<string>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return out;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return out;
  const value = (parsed as Record<string, unknown>).value;
  if (value === undefined) return out; // a marker unit (file / seq / unliftable)
  walkCfgValue(value, out);
  return out;
}

/** A code-unit's raw body, or '' for a symbol that carries none. */
function bodyOf(obj: WarpObject | undefined): string {
  if (!obj) return '';
  const v = (obj.contract as Record<string, unknown>).codeEssence;
  return typeof v === 'string' ? v : '';
}

/** The VALUE tokens of one object, dispatched by lens. */
export function tokensOf(obj: WarpObject | undefined): Set<string> {
  const body = bodyOf(obj);
  if (body === '') return new Set();
  const tag = (obj!.contract as Record<string, unknown>).essenceTag;
  const isCfg = tag === CFG_ESSENCE_TAG || obj!.symbol.startsWith('#cfg:');
  return isCfg ? extractCfgTokens(body) : extractCodeTokens(body);
}

/* ── rarity: the noise control ───────────────────────────────────────────────── */

/** Document frequency of every token in the BASE corpus. */
export interface RarityIndex {
  /** body-bearing base objects scanned — the IDF denominator. */
  documents: number;
  /** token → how many of those objects carry it. */
  df: Map<string, number>;
}

/**
 * ONE pass over `base.objects` bodies. This is the whole noise control, and it
 * needs NO break-history — which is what makes it usable on a fresh repo, where
 * the graded corpus the trust floor wants does not and cannot exist yet.
 */
export function rarityIndex(base: WarpState): RarityIndex {
  const df = new Map<string, number>();
  let documents = 0;
  for (const obj of base.objects.values()) {
    if (bodyOf(obj) === '') continue;
    documents++;
    for (const t of tokensOf(obj)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  return { documents, df };
}

/**
 * INTRINSIC triviality — 0 for tokens that carry no coupling information no
 * matter how the corpus is shaped, 1 otherwise. Deliberately tiny and
 * structural: `0`/`1` are the arithmetic identities and appear everywhere;
 * sub-3-character literals and names (`""`, `"a"`, `i`, `x`) are noise in every
 * codebase. There is NO hardcoded framework vocabulary here — `useState` scores
 * low because it is FREQUENT in this repo's own base, which is per-codebase
 * calibration rather than a list someone has to maintain.
 */
function intrinsicRarity(token: string): 0 | 1 {
  const i = token.indexOf(':');
  const ns = token.slice(0, i);
  const v = token.slice(i + 1);
  if (ns === 'num') return v === '0' || v === '1' || v === '0.0' || v === '1.0' ? 0 : 1;
  if (ns === 'str') return v.trim().length >= MIN_LITERAL_LEN ? 1 : 0;
  if (ns === 'free') return v.length >= MIN_LITERAL_LEN ? 1 : 0;
  return 1;
}

/**
 * 0..1. Normalized IDF (`ln(N/df) / ln(N)`) times the intrinsic factor.
 *
 * IDF and not `1 − df/N`: on a real repo (N ≈ 3000) a token in 400 units must
 * score LOW (IDF says 0.25; `1 − df/N` says 0.87, which would make the advisory
 * a firehose on exactly the codebases it is for). A token ABSENT from the base
 * scores 1 — a literal both sides introduced simultaneously is the strongest
 * form of the signal, not the weakest.
 */
export function rarityOf(index: RarityIndex, token: string): number {
  if (intrinsicRarity(token) === 0) return 0;
  const n = index.documents;
  const d = index.df.get(token) ?? 0;
  if (d === 0) return 1;
  if (n < 2) return 0.5; // a corpus of one says nothing about frequency
  return round2(Math.max(0, Math.log(n / d) / Math.log(n)));
}

/* ── the danger multiplier ───────────────────────────────────────────────────── */

interface DangerIndex {
  /** symbol → inbound edge count in the base graph. */
  inbound: Map<string, number>;
  /** symbols carrying `contract.gates`, plus the targets of their edges. */
  gateTouched: Set<string>;
}

function dangerIndex(base: WarpState): DangerIndex {
  const inbound = new Map<string, number>();
  const gateTouched = new Set<string>();
  for (const obj of base.objects.values()) {
    for (const e of obj.edges) inbound.set(e.to, (inbound.get(e.to) ?? 0) + 1);
    const gates = (obj.contract as Record<string, unknown>).gates;
    if (Array.isArray(gates) && gates.length > 0) {
      gateTouched.add(obj.symbol);
      for (const e of obj.edges) gateTouched.add(e.to);
    }
  }
  return { inbound, gateTouched };
}

function dangerFlagsFor(idx: DangerIndex, symbols: Iterable<string>): HazardDangerFlag[] {
  const flags: HazardDangerFlag[] = [];
  let gated = false;
  let fanIn = false;
  for (const s of symbols) {
    if (idx.gateTouched.has(s)) gated = true;
    if ((idx.inbound.get(s) ?? 0) >= HAZARD_FAN_IN_MIN) fanIn = true;
  }
  if (fanIn) flags.push('high-fan-in');
  if (gated) flags.push('portal-gate');
  return flags; // sorted by construction (h < p)
}

/* ── the evaluator ───────────────────────────────────────────────────────────── */

function byStableKey(state: WarpState): Map<string, WarpObject> {
  const m = new Map<string, WarpObject>();
  for (const obj of state.objects.values()) m.set(obj.stableKey, obj);
  return m;
}

function addSym(m: Map<string, Set<string>>, token: string, symbol: string): void {
  const set = m.get(token);
  if (set) set.add(symbol);
  else m.set(token, new Set([symbol]));
}

/**
 * token → the symbols on THIS side whose essence gained or lost it, restricted
 * to LOCALLY-CHANGED units. `localChanged` is the direct-vs-ripple bit
 * (sem-delta.ts): a unit whose contentId moved only because a target's essence
 * shifted transitively did not touch a token itself, and counting it would
 * spray a whole Merkle cone into the advisory.
 */
function changedTokensOf(base: WarpState, side: WarpState): Map<string, Set<string>> {
  const baseByKey = byStableKey(base);
  const sideByKey = byStableKey(side);
  const out = new Map<string, Set<string>>();
  for (const d of diff(base, side).deltas.values()) {
    if (d.localChanged !== true) continue;
    const before = tokensOf(baseByKey.get(d.stableKey));
    const after = tokensOf(sideByKey.get(d.stableKey));
    for (const t of after) if (!before.has(t)) addSym(out, t, d.symbol);
    for (const t of before) if (!after.has(t)) addSym(out, t, d.symbol);
  }
  return out;
}

const isCfgSymbol = (s: string): boolean => s.startsWith('#cfg:');

function kindOf(token: string, ours: Set<string>, theirs: Set<string>): HazardKind {
  const oursCfg = [...ours].some(isCfgSymbol);
  const theirsCfg = [...theirs].some(isCfgSymbol);
  const oursCode = [...ours].some((s) => !isCfgSymbol(s));
  const theirsCode = [...theirs].some((s) => !isCfgSymbol(s));
  if ((oursCfg && theirsCode) || (theirsCfg && oursCode)) return 'cfg-island';
  return token.startsWith('free:') ? 'shared-free-ref' : 'shared-literal';
}

const sortedCap = (s: Set<string>): string[] => [...s].sort().slice(0, HAZARD_SYMBOL_CAP);

export interface EvaluateHazardsOptions {
  /** hazards scoring below this are not reported (default HAZARD_MIN_SCORE). */
  minScore?: number;
  /** a pre-computed base rarity index (skips the one pass). */
  rarity?: RarityIndex;
}

/**
 * THE ADVISORY RULE. On a CLEAN verdict — for BOTH confidence values, because
 * the 'linked' prior is inverted for the born-caller case and restricting to
 * 'independent' would miss it — take each side's LOCALLY-CHANGED units, extract
 * the value tokens that entered or left the essence, intersect across the two
 * sides, and weight by rarity. A non-empty intersection is a coupling the graph
 * missed.
 *
 * A token whose participating symbols are the SAME symbol on both sides is
 * dropped: the graph SAW that one (it would be a knot or an identical edit), so
 * it is not a missed coupling. Only cross-symbol pairs survive.
 *
 * PURE over (base, proposed, selvage, decision): no clock, no disk, no
 * randomness — the same contract `evaluateEscalation` holds in grade.ts. Any
 * status other than CLEAN returns [], so this cannot be attached to, or be read
 * as, a contested verdict.
 */
export function evaluateHazards(
  base: WarpState,
  proposed: WarpState,
  selvage: WarpState,
  decision: Pick<AdmitDecision, 'status'>,
  opts: EvaluateHazardsOptions = {},
): CleanHazard[] {
  if (decision.status !== 'CLEAN') return [];
  const minScore = opts.minScore ?? HAZARD_MIN_SCORE;
  const ours = changedTokensOf(base, proposed);
  if (ours.size === 0) return [];
  const theirs = changedTokensOf(base, selvage);
  if (theirs.size === 0) return [];

  const rarity = opts.rarity ?? rarityIndex(base);
  const danger = dangerIndex(base);
  const out: CleanHazard[] = [];
  for (const [token, oursSyms] of ours) {
    const theirsSyms = theirs.get(token);
    if (!theirsSyms) continue;
    const participants = new Set([...oursSyms, ...theirsSyms]);
    if (participants.size < 2) continue; // one symbol, both sides — the graph saw it
    const r = rarityOf(rarity, token);
    if (r <= 0) continue;
    const dangerFlags = dangerFlagsFor(danger, participants);
    const score = round2(Math.min(1, r * (1 + HAZARD_DANGER_WEIGHT * dangerFlags.length)));
    if (score < minScore) continue;
    out.push({
      kind: kindOf(token, oursSyms, theirsSyms),
      token,
      oursSymbols: sortedCap(oursSyms),
      theirsSymbols: sortedCap(theirsSyms),
      rarity: r,
      score,
      dangerFlags,
    });
  }
  out.sort(
    (a, b) => b.score - a.score || b.rarity - a.rarity || (a.token < b.token ? -1 : a.token > b.token ? 1 : 0),
  );
  return out.slice(0, HAZARD_MAX);
}

/* ── the ONE wiring helper both admit paths call ─────────────────────────────── */

/**
 * WHY THIS EXISTS AS A FUNCTION AND NOT AS TWO COPIES. The git-era path
 * (`admit.ts`) and the native path (`native.ts`) must not diverge — that exact
 * divergence is what T-2026-07-21-007 recorded for `refusal:v1`, where the
 * native path (the one agents actually use) built refusal-free verdicts for a
 * whole era. So "compute, attach, record" is defined ONCE here and both paths
 * call it; a change to the advisory cannot land on one path only.
 *
 * FAIL-SAFE, TOTALLY. Every step is inside a catch that degrades to "no
 * advisory". An advisory is the least important thing in an admission and must
 * never be able to break, slow-fail, or alter one.
 */
export interface HazardAdvisoryInput {
  root: string;
  agentId: string;
  base: WarpState;
  proposed: WarpState;
  selvage: WarpState;
  decision: Pick<AdmitDecision, 'status' | 'confidence'>;
  /** observe-only: compute and attach, but write NO sidecar row. */
  shadow: boolean;
  now: string;
  /** injected mode/threshold (tests + callers that already read the config). */
  config?: { mode: 'off' | 'advise'; minScore?: number };
}

/** The attach-and-record closure for the CLEAN return sites. */
export interface HazardAdvisory {
  hazards: CleanHazard[];
  /**
   * Attach the advisory to a CLEAN result body and (outside shadow) append the
   * sidecar row. A NO-OP when there are no hazards, so a return site that goes
   * through it is byte-identical to one that does not whenever nothing fired.
   * It writes ONLY `hazards`: no status, no `sealed`, no refusal is touched.
   */
  attach: <T extends object>(r: T) => T;
}

export function hazardAdvisory(input: HazardAdvisoryInput): HazardAdvisory {
  let hazards: CleanHazard[] = [];
  try {
    // The config read is lazy and defaulted; a caller may inject it instead.
    const cfg = input.config ?? readHazardConfigLazy(input.root);
    if (cfg.mode !== 'off') {
      hazards = evaluateHazards(input.base, input.proposed, input.selvage, input.decision, {
        ...(cfg.minScore !== undefined ? { minScore: cfg.minScore } : {}),
      });
    }
  } catch {
    hazards = []; // an advisory must never break an admission
  }
  // CONSTRAINED ON `object`, NOT on the shape it writes. The obvious constraint
  // — `{ hazards?: CleanHazard[]; strand?: { pickId: string } }` — is all-optional,
  // so a fresh object literal carrying none of those keys gives inference nothing
  // to anchor on: TS resolves T to the CONSTRAINT, then excess-property-checks the
  // literal against it and rejects `decision`/`sealed`/`proposedStateId`. That was
  // eight errors across the five CLEAN return sites. `object` has no members, so T
  // infers as the literal's own type and the result stays assignable to
  // AdmitResultBody. `strand` is read through a narrow cast instead.
  const attach = <T extends object>(r: T): T => {
    if (hazards.length === 0) return r;
    if (!input.shadow) {
      try {
        recordHazards(input.root, {
          schemaVersion: HAZARD_SCHEMA,
          ts: input.now,
          agentId: input.agentId,
          pickId: (r as { strand?: { pickId: string } }).strand?.pickId ?? null,
          confidence: input.decision.confidence ?? null,
          hazards,
        });
      } catch {
        /* the sidecar is derived evidence — never fatal to an admission */
      }
    }
    return { ...r, hazards };
  };
  return { hazards, attach };
}

/**
 * Config read, deferred to call time so `hazard.ts` does not force `config.ts`
 * to load for pure consumers (and so a test can inject instead).
 */
function readHazardConfigLazy(root: string): { mode: 'off' | 'advise'; minScore?: number } {
  const r = readHazardConfig(root);
  return { mode: r.mode, ...(r.minScore !== undefined ? { minScore: r.minScore } : {}) };
}

/* ── the sidecar stream (.warpline/hazards.jsonl — G5) ───────────────────────── */

/** One advisory, as recorded. Same mechanics as `recordGradeEscalation`. */
export interface CleanHazardRow {
  schemaVersion: typeof HAZARD_SCHEMA;
  ts: string;
  agentId: string;
  /** the sealed strand the advisory rode, or null (the CLEAN did not seal). */
  pickId: string | null;
  /** the CLEAN gate-rule confidence the advisory was computed under. */
  confidence: AdmitConfidence | null;
  hazards: CleanHazard[];
}

export function hazardsPathOf(root: string): string {
  return path.join(warplineDirOf(root), 'hazards.jsonl');
}

/** Append one advisory row. NEVER called under `shadow` (observe-only). */
export function recordHazards(root: string, row: CleanHazardRow): void {
  const p = hazardsPathOf(root);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(row) + '\n', 'utf8');
}

/** All recorded advisory rows (unreadable rows skipped, never fatal). */
export function listHazards(root: string): CleanHazardRow[] {
  const file = hazardsPathOf(root);
  if (!fs.existsSync(file)) return [];
  const out: CleanHazardRow[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line) as CleanHazardRow;
      if (Array.isArray(row?.hazards)) out.push(row);
    } catch {
      /* skip */
    }
  }
  return out;
}
