/**
 * @symbol #local-tool-tier
 *
 * #local-tool-tier (TD-2026-10-27-833 slice C4'a; spec §13.1 "Tool tiers"): how much tool surface a local session gets.
 * One tier, 0-3, per session, fixed at open and changed only by the human's two-phase request.session.tier commit
 * (never implicitly mid-session: the prompt cache depends on a stable tools array).
 *
 *   SKILL     the probe's grade (probe.ts probeToolSkill): T1 (the get_time check) fails => 0; T1 passes => 1; T1-T3
 *             pass => 2; all four pass => 3. The probe stops at the first failure, so the grade is the passing prefix.
 *   HUMAN     a per-model value the human chose (remember:true on a commit); it REPLACES the skill (a raise or a
 *             lower), labelled tierSource 'human'.
 *   WINDOW    the effective context target (min(config, n_ctx); never the trained maximum): < 4096 => 0, >= 4096 =>
 *             1, >= 8192 => 2, >= 16384 => 3; an unknown n_ctx caps it at 1.
 *   EFFECTIVE min(human ?? skill, window). A session opened while the measurement is pending uses min(1, window),
 *             labelled 'provisional'.
 *
 * The plan of a tier (tierPlan): K narrow tools at most, the tools slot (a share of the target, capped), the surface
 * (compact for 0-2, full for 3), whether find_tool and complex human-only tools are offered. Tier 0 offers NO brokered
 * tool at all (not even a kernel verb), so the child never offers find_tool; the child's core tools are the same at
 * every tier. A tier never touches allow, classOf, cards, trust, the manual (read-only) filter or the destructive-entry
 * rules.
 *
 * The store, <gnomonHome>/local/tool-tiers.json (0600, atomic temp + fsync + rename, shape-validated; a corrupt,
 * oversized or non-regular file is ignored, never trusted): one record per sha256(base|model|fingerprint) with the
 * measured skill at TIER_PROBE_VERSION and the human value. A new fingerprint (a new model digest) is a new record, and
 * writing it drops every other record of the same base and model (their human values included). No TTL: a re-run
 * happens on a fingerprint change, a TIER_PROBE_VERSION bump or an explicit re-measure.
 */
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export type ToolTier = 0 | 1 | 2 | 3;
export type TierSource = 'measured' | 'human' | 'provisional';
export type TierSurface = 'compact' | 'full';
export const TOOL_TIERS: readonly ToolTier[] = Object.freeze([0, 1, 2, 3]);

/** Bump when the probe's tests or grading change: every stored measurement is re-run. */
export const TIER_PROBE_VERSION = 1;

/** Context targets each window tier needs. */
export const WINDOW_TIER_MIN: Readonly<Record<1 | 2 | 3, number>> = Object.freeze({ 1: 4096, 2: 8192, 3: 16384 });

export const isTier = (v: unknown): v is ToolTier => v === 0 || v === 1 || v === 2 || v === 3;

/** The window tier of an effective context target; an unknown n_ctx caps it at 1. */
export function windowTier(contextTarget: number, nCtxKnown = true): ToolTier {
  const t = Number.isFinite(contextTarget) ? contextTarget : 0;
  const w: ToolTier = t >= WINDOW_TIER_MIN[3] ? 3 : t >= WINDOW_TIER_MIN[2] ? 2 : t >= WINDOW_TIER_MIN[1] ? 1 : 0;
  return nCtxKnown ? w : (Math.min(w, 1) as ToolTier);
}

/** The skill tier of a probe run: how many of T1..T4 passed, in order (the probe stops at the first failure). */
export function skillTier(passed: number): ToolTier {
  if (!Number.isInteger(passed) || passed <= 0) return 0;
  if (passed >= 4) return 3;
  if (passed >= 3) return 2;
  return 1;
}

/** The session's tier: min(human ?? skill, window); a pending measurement is min(1, window), labelled provisional. */
export function effectiveTier(i: { skill: ToolTier | null; human?: ToolTier | null; window: ToolTier }): { tier: ToolTier; source: TierSource } {
  if (i.human !== undefined && i.human !== null) return { tier: Math.min(i.human, i.window) as ToolTier, source: 'human' };
  if (i.skill === null) return { tier: Math.min(1, i.window) as ToolTier, source: 'provisional' };
  return { tier: Math.min(i.skill, i.window) as ToolTier, source: 'measured' };
}

export interface TierPlan {
  tier: ToolTier;
  /** the most narrow tools offered */
  k: number;
  /** the tools slot: tokens the offered tools may take (after the fixed tools) */
  slotTokens: number;
  /** the slot's share of the target */
  slotShare: number;
  /** the cap on the slot */
  slotMax: number;
  surface: TierSurface;
  /** brokered tools (kernel verbs, narrow tools, find_tool) are offered at all */
  brokered: boolean;
  findTool: boolean;
  /** complex human-only tools are offered (full form) when fullOfferable */
  complexHumanOnly: boolean;
}

const PLAN: Readonly<Record<ToolTier, Omit<TierPlan, 'tier' | 'slotTokens'>>> = Object.freeze({
  0: { k: 0, slotShare: 0, slotMax: 0, surface: 'compact', brokered: false, findTool: false, complexHumanOnly: false },
  1: { k: 4, slotShare: 0.1, slotMax: 600, surface: 'compact', brokered: true, findTool: true, complexHumanOnly: false },
  2: { k: 12, slotShare: 0.15, slotMax: 1500, surface: 'compact', brokered: true, findTool: true, complexHumanOnly: false },
  3: { k: 12, slotShare: 0.25, slotMax: 4000, surface: 'full', brokered: true, findTool: true, complexHumanOnly: true },
});

/** The plan of `tier` at `contextTarget` (the slot is min(slotMax, floor(share x target))). */
export function tierPlan(tier: ToolTier, contextTarget: number): TierPlan {
  const p = PLAN[tier];
  return { tier, ...p, slotTokens: Math.min(p.slotMax, Math.floor(Math.max(0, contextTarget) * p.slotShare)) };
}

/** The order of surfaces: a configured surface can only LOWER the tier's (none < compact < full). */
export function lowerSurface<S extends 'none' | 'compact' | 'full'>(a: S, b: 'none' | 'compact' | 'full' | undefined): S | 'none' | 'compact' | 'full' {
  if (b === undefined) return a;
  const rank = { none: 0, compact: 1, full: 2 } as const;
  return rank[b] < rank[a] ? b : a;
}

// ── the store ─────────────────────────────────────────────────────────────────────────────────────────────────────

export const TOOL_TIERS_SCHEMA = 'gnomon-tool-tiers:v1';
export const TOOL_TIERS_DIR = 'local';
export const TOOL_TIERS_FILE = 'tool-tiers.json';
/** A store larger than this is ignored (never parsed). */
export const TOOL_TIERS_MAX_BYTES = 256 * 1024;
/** At most this many records are kept (the oldest measurement goes first). */
export const TOOL_TIERS_MAX_RECORDS = 256;

export interface TierModel {
  base: string;
  model: string;
  fingerprint: string;
}

export interface TierRecord extends TierModel {
  /** the measured skill (null: never measured at this version) */
  skill: ToolTier | null;
  /** how many of T1..T4 passed */
  passed: number | null;
  version: number;
  measuredAt: string | null;
  /** the human's per-model value (remember:true) */
  human: ToolTier | null;
  humanAt: string | null;
}

export interface TierDoc {
  schema: typeof TOOL_TIERS_SCHEMA;
  records: Record<string, TierRecord>;
}

/** The cache key: sha256(base|model|fingerprint), hex. */
export function tierKey(m: TierModel): string {
  return createHash('sha256').update(`${m.base}|${m.model}|${m.fingerprint}`).digest('hex');
}

export const toolTiersPath = (home: string): string => path.join(home, TOOL_TIERS_DIR, TOOL_TIERS_FILE);

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const iso = (v: unknown): v is string | null => v === null || (typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v)));
const KEY_RE = /^[0-9a-f]{64}$/;

/** One record, or null when its shape is not exactly a TierRecord (or its key does not match its fields). */
function recordOf(key: string, v: unknown): TierRecord | null {
  if (!KEY_RE.test(key) || !isObj(v)) return null;
  const keys = ['base', 'model', 'fingerprint', 'skill', 'passed', 'version', 'measuredAt', 'human', 'humanAt'];
  if (Object.keys(v).some((k) => !keys.includes(k))) return null;
  if (!str(v.base, 512) || !str(v.model, 128) || !str(v.fingerprint, 512)) return null;
  if (!(v.skill === null || isTier(v.skill)) || !(v.human === null || isTier(v.human))) return null;
  if (!(v.passed === null || (Number.isInteger(v.passed) && (v.passed as number) >= 0 && (v.passed as number) <= 4))) return null;
  if (!Number.isInteger(v.version) || (v.version as number) < 0) return null;
  if (!iso(v.measuredAt) || !iso(v.humanAt)) return null;
  const r: TierRecord = { base: v.base, model: v.model, fingerprint: v.fingerprint, skill: v.skill, passed: v.passed as number | null, version: v.version as number, measuredAt: v.measuredAt, human: v.human, humanAt: v.humanAt };
  return tierKey(r) === key ? r : null;
}

const empty = (): TierDoc => ({ schema: TOOL_TIERS_SCHEMA, records: {} });

/**
 * The store, or an empty one when the file is missing, not a regular file, oversized, unparseable or not exactly the
 * schema's shape (a corrupt file is ignored whole; one bad record is dropped).
 */
export function readTiers(home: string): TierDoc {
  const file = toolTiersPath(home);
  let text: string;
  try {
    const st = fs.lstatSync(file);
    if (!st.isFile() || st.size > TOOL_TIERS_MAX_BYTES) return empty();
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return empty();
  }
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch {
    return empty();
  }
  if (!isObj(j) || j.schema !== TOOL_TIERS_SCHEMA || !isObj(j.records)) return empty();
  const out = empty();
  for (const [k, v] of Object.entries(j.records)) {
    const r = recordOf(k, v);
    if (r) Object.defineProperty(out.records, k, { value: r, enumerable: true, writable: true, configurable: true });
  }
  return out;
}

/** The record of a model, or null. */
export function lookupTier(home: string, m: TierModel): TierRecord | null {
  const k = tierKey(m);
  const doc = readTiers(home);
  return Object.hasOwn(doc.records, k) ? doc.records[k]! : null;
}

/** Is the record's measurement current (at TIER_PROBE_VERSION)? */
export const measuredCurrent = (r: TierRecord | null): r is TierRecord & { skill: ToolTier } => r !== null && r.skill !== null && r.version === TIER_PROBE_VERSION;

/** Write the store: <home>/local (0700) then a private temp file (0600, exclusive), fsynced, renamed over the target. */
function writeTiers(home: string, doc: TierDoc): void {
  const dir = path.join(home, TOOL_TIERS_DIR);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Aegis C4'a L3: an existing dir that is too open is narrowed (ours only, never through a symlink; not on win32)
  if (process.platform !== 'win32') {
    const st = fs.lstatSync(dir);
    if (!st.isDirectory()) throw new Error(`#local-tool-tier: ${TOOL_TIERS_DIR} is not a directory (a symlink is never followed)`);
    if (st.uid === process.getuid?.() && (st.mode & 0o777) !== 0o700) fs.chmodSync(dir, 0o700);
  }
  const file = path.join(dir, TOOL_TIERS_FILE);
  const refuseTarget = (): void => {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(file);
    } catch {
      return;
    }
    if (!st.isFile()) throw new Error(`#local-tool-tier: ${TOOL_TIERS_FILE} is not a regular file (a symlink is never followed)`);
  };
  refuseTarget();
  // the oldest records go first past the cap
  const entries = Object.entries(doc.records).sort((a, b) => String(b[1].measuredAt ?? b[1].humanAt ?? '').localeCompare(String(a[1].measuredAt ?? a[1].humanAt ?? ''))).slice(0, TOOL_TIERS_MAX_RECORDS);
  const text = `${JSON.stringify({ schema: TOOL_TIERS_SCHEMA, records: Object.fromEntries(entries) }, null, 1)}\n`;
  const tmp = path.join(dir, `.${TOOL_TIERS_FILE}.tmp-${process.pid}-${randomBytes(6).toString('hex')}`);
  const fd = fs.openSync(tmp, 'wx', 0o600);
  try {
    fs.writeSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    refuseTarget();
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

/**
 * Slice C4'b: could writeTiers write the store now? (the preview's `rememberable`): <home>/local is a directory we may
 * write (a symlink or a file there is never followed) and the store, when present, is a regular file; with no
 * <home>/local yet, <home> must be writable. A best guess before Apply: the commit still reports what happened.
 */
export function tiersWritable(home: string): boolean {
  const dir = path.join(home, TOOL_TIERS_DIR);
  try {
    let st: fs.Stats | null = null;
    try {
      st = fs.lstatSync(dir);
    } catch {
      st = null;
    }
    if (!st) {
      fs.accessSync(home, fs.constants.W_OK);
      return true;
    }
    if (!st.isDirectory()) return false;
    fs.accessSync(dir, fs.constants.W_OK);
    try {
      if (!fs.lstatSync(path.join(dir, TOOL_TIERS_FILE)).isFile()) return false;
    } catch {
      // no store yet: the first write makes it
    }
    return true;
  } catch {
    return false;
  }
}

/** Drop every record of the same base and model whose fingerprint differs (a new digest clears them, human values too). */
function dropOtherDigests(doc: TierDoc, m: TierModel): void {
  for (const [k, r] of Object.entries(doc.records)) if (r.base === m.base && r.model === m.model && r.fingerprint !== m.fingerprint) delete doc.records[k];
}

/** Record a measurement (the skill and how many tests passed) at TIER_PROBE_VERSION. */
export function writeMeasured(home: string, m: TierModel, r: { skill: ToolTier; passed: number }, now: Date = new Date()): TierRecord {
  const doc = readTiers(home);
  dropOtherDigests(doc, m);
  const k = tierKey(m);
  const prev = Object.hasOwn(doc.records, k) ? doc.records[k]! : null;
  const rec: TierRecord = { base: m.base, model: m.model, fingerprint: m.fingerprint, skill: r.skill, passed: r.passed, version: TIER_PROBE_VERSION, measuredAt: now.toISOString(), human: prev?.human ?? null, humanAt: prev?.humanAt ?? null };
  Object.defineProperty(doc.records, k, { value: rec, enumerable: true, writable: true, configurable: true });
  writeTiers(home, doc);
  return rec;
}

/** Record (or clear, with null) the human's per-model tier. */
export function setHuman(home: string, m: TierModel, tier: ToolTier | null, now: Date = new Date()): TierRecord {
  const doc = readTiers(home);
  dropOtherDigests(doc, m);
  const k = tierKey(m);
  const prev = Object.hasOwn(doc.records, k) ? doc.records[k]! : null;
  const rec: TierRecord = { base: m.base, model: m.model, fingerprint: m.fingerprint, skill: prev?.skill ?? null, passed: prev?.passed ?? null, version: prev?.version ?? TIER_PROBE_VERSION, measuredAt: prev?.measuredAt ?? null, human: tier, humanAt: tier === null ? null : now.toISOString() };
  Object.defineProperty(doc.records, k, { value: rec, enumerable: true, writable: true, configurable: true });
  writeTiers(home, doc);
  return rec;
}
