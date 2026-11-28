/**
 * @symbol #dim-cli
 *
 * The dimension CLI (S1.3 P2; spec §12.7; scale amendment A9).
 *
 *   gnomon dim replay <dim> [--to <seq>] [<home>] [--json]
 *       Verifies the kernel log (as `gnomon replay` does), folds the rows of one dimension with the published
 *       `dim-shape:v1` fold in ONE pass from the first row (never a fold per row), and prints the state: title,
 *       seq, hash, and every mark in drawing order with the hand that drew it. `--to` stops after that seq.
 *
 *   gnomon dim stats [<dim>] [<home>] [--json]
 *       The five A9 signals, folded from the same rows; nothing is stored. Per dimension and in total:
 *       reopens; agent-mark survival; round trips; voice co-occurrence; dimensions closed inside a minute with no
 *       human op.
 *
 * Read-only; both run with or without a daemon and need no relay (a `cli`-surface WRITE is refused in S1.3). An
 * unverified log is refused. Board text is permanent user text: everything printed is stripped of control,
 * format and line-separator characters first (Aegis S1.3), so a mark can never forge a line or steer a terminal.
 */
import * as path from 'node:path';
import { DIM_AGENT_LABEL_PATTERN, DIM_ID_PATTERN, DIM_KINDS, DIM_VIEW_PRINCIPAL_PATTERN, dimHash, dimViewOf, emptyDimState, foldDim, type DimBy, type DimRow, type DimState } from '@a-company/gnomon-contracts';
import { readKernelPubs } from '../kernel/identity/index.js';
import { kernelPrincipalOf, resolveGnomonHome } from '../kernel/lifecycle/index.js';
import { KeyRing, verifyLog } from '../kernel/log/index.js';
import { GNOMON_VERSION } from '../version.js';
import { heading, readout, refused, type Out } from './readout.js';

export const DIM_EXIT_OK = 0;
export const DIM_EXIT_REFUSED = 1;
export const DIM_EXIT_USAGE = 64;

export const DIM_USAGE = `gnomon ${GNOMON_VERSION} dim — dimensions (boards) from the verified log
usage: gnomon dim replay <dim> [--to <seq>] [<home>] [--json]
       gnomon dim stats [<dim>] [<home>] [--json]
  replay  fold one dimension from its first row and print its state and marks
  stats   reopens, agent-mark survival, round trips, voice co-occurrence, and
          dimensions closed inside a minute with no human op
`;

export const DIM_CLI_KINDS: readonly string[] = Object.freeze([DIM_KINDS.start, DIM_KINDS.attach, DIM_KINDS.op, DIM_KINDS.end]);
/** One sentence, printed with the stats (Aegis S1.3 B3). */
export const DIM_STATS_UNDO_NOTE = "undoing a delete of an agent's mark adds it again as a human mark, so that mark counts as not surviving";
export const DIM_STATS_ROUND_TRIP_NOTE = 'a round trip is an agent row citing a mark a human drew or changed; the view step between them is not on the log yet';

/** A dimension row as the CLI reads it from a verified envelope. */
export interface DimCliRow extends DimRow {
  /** the envelope time (ISO), when present */
  at?: string;
}

/** Remove every control, format, line-separator and paragraph-separator code point. Applied to ALL printed text. */
export function stripControl(s: string): string {
  return s.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '');
}

/** The same, at any depth of a JSON value (keys included), for `--json`. */
export function stripControlDeep(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return stripControl(v);
  if (v === null || typeof v !== 'object' || depth > 64) return v;
  if (Array.isArray(v)) return v.map((x) => stripControlDeep(x, depth + 1));
  // no prototype: a key read from the log (`__proto__`, `constructor`) is kept as a plain key and sets nothing
  const out = Object.create(null) as Record<string, unknown>;
  for (const k of Object.keys(v)) out[stripControl(k)] = stripControlDeep((v as Record<string, unknown>)[k], depth + 1);
  return out;
}

const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const dimOf = (row: DimRow): string | null => (isObj(row.payload) && typeof row.payload.dim === 'string' ? row.payload.dim : null);

/**
 * G-DDL-01 for the CLI: ONE `foldDim` over the rows, from the first row, in one pass. `rows` may be any iterable;
 * it is iterated exactly once and each row is read once.
 */
export function replayDim(rows: Iterable<DimRow>, dim: string, to?: number): DimState {
  return foldDim(rows, to, emptyDimState(dim));
}

const handText = (by: DimBy): string => (by.cls === 'agent' ? `agent ${by.agent ?? ''} (${by.principal})` : by.cls === 'human' ? `human (${by.principal})` : 'unknown hand');
/**
 * The hand a person's FORENSIC replay shows: the stored `by`, not the agent-facing bounded one. A principal in its
 * pattern is shown even when the agent label is not; such a label is never printed ("label not shown").
 */
function replayHand(stored: DimBy | undefined, bounded: DimBy): string {
  if (!stored || bounded.cls !== 'unknown' || stored.cls !== 'agent' || typeof stored.principal !== 'string' || !DIM_VIEW_PRINCIPAL_PATTERN.test(stored.principal)) return handText(bounded);
  return typeof stored.agent === 'string' && DIM_AGENT_LABEL_PATTERN.test(stored.agent) ? handText(stored) : `agent (label not shown) (${stored.principal})`;
}
const WORDS = ['text', 'label', 'title'] as const;

/** The replay as text lines. Every value is stripped of control characters; a line break exists only between lines. */
export function replayLines(state: DimState): { head: Array<readonly [string, string | number]>; marks: string[] } {
  const view = dimViewOf(state);
  const head: Array<readonly [string, string | number]> = [
    ['title', stripControl(state.title)],
    ['seq', state.seq],
    ['state', state.ended ? 'closed' : 'open'],
    ['sessions', state.attached.length],
    ['ops', state.ops],
    ['not applied', state.unapplied],
    ['marks', state.nodes.size],
    ['hash', dimHash(state)],
  ];
  const marks = view.nodes.map((n) => {
    const words = WORDS.map((k) => (typeof n[k] === 'string' ? `${k} ${JSON.stringify(stripControl(n[k] as string))}` : '')).filter(Boolean).join(' ');
    const at = typeof n.x === 'number' && typeof n.y === 'number' ? `${n.x},${n.y}` : '-';
    return stripControl(`${n.id}  ${n.kind}${n.core ? '' : ' (fallback)'}  at ${at}  by ${replayHand(state.nodes.get(n.id)?.by, n.by)}${words ? `  ${words}` : ''}`);
  });
  return { head, marks };
}

/* ── stats (scale amendment A9) ───────────────────────────────────────────── */

export interface DimStats {
  rows: number;
  /** start rows after a dimension's first */
  reopens: number;
  openedBy: Record<string, number>;
  /** marks an agent hand added, and how many of those are still on the board */
  agentMarks: { added: number; surviving: number };
  /** agent op rows that cite a mark a human drew or changed */
  roundTrips: number;
  /** op rows stamped with the voice surface, and whether human GUI rows share the dimension */
  voice: { rows: number; withHumanRows: boolean };
  /** start→end spans shorter than a minute holding no human op */
  closedQuick: number;
  /** op rows per session: the stamped hsid, else the single attached session, else the nearest preceding start or attach row */
  opsBySession: Record<string, number>;
}

interface Acc {
  stats: DimStats;
  started: boolean;
  attached: string[];
  lastSession: string | null;
  /** the hand that added each mark an agent drew */
  agentAdded: Set<string>;
  /** ids a human row added or changed */
  humanTouched: Set<string>;
  spanStart: number | null;
  spanHumanOps: number;
  humanRows: number;
  rows: DimRow[];
}

const PROBE = 'dim:01JD1MPR0BE000000000000000';
const handCache = new Map<string, DimBy>();
/** The hand of a row by the CONTRACT's rule (the fold's own `by`), so the CLI never restates who counts as human. */
function handOf(payload: Record<string, unknown>): DimBy {
  const stamp = payload.relayedFor;
  let key: string;
  try {
    key = JSON.stringify(stamp) ?? 'none';
  } catch {
    key = 'none';
  }
  const hit = handCache.get(key);
  if (hit) return hit;
  const s = foldDim([{ seq: 1, kind: DIM_KINDS.op, payload: { v: 1, dim: PROBE, ops: [{ type: 'add', node: { id: 'probe' } }], ...(stamp !== undefined ? { relayedFor: stamp } : {}) } }], undefined, emptyDimState(PROBE));
  const by = s.nodes.get('probe')?.by ?? { cls: 'unknown', principal: 'unknown' };
  if (handCache.size < 4096) handCache.set(key, by);
  return by;
}

/** A map keyed by strings read from the log (session ids, dimension ids): no prototype, so a key such as `__proto__` or `constructor` is only a key. */
const logKeyed = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;
const emptyStats = (): DimStats => ({ rows: 0, reopens: 0, openedBy: logKeyed<number>(), agentMarks: { added: 0, surviving: 0 }, roundTrips: 0, voice: { rows: 0, withHumanRows: false }, closedQuick: 0, opsBySession: logKeyed<number>() });
const bump = (m: Record<string, number>, k: string): void => void (m[k] = (m[k] ?? 0) + 1);
const QUICK_MS = 60_000;

/** ids an op cites: the marks it edits, and the marks a new one points at. */
function citedIds(op: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (typeof op.id === 'string') out.push(op.id);
  if (Array.isArray(op.ids)) for (const id of op.ids) if (typeof id === 'string') out.push(id);
  const src = op.type === 'add' ? op.node : op.type === 'update' ? op.patch : null;
  if (isObj(src)) for (const k of ['from', 'to', 'parent']) if (typeof src[k] === 'string') out.push(src[k] as string);
  return out;
}

/** Fold the five signals per dimension. One pass over the rows, then ONE `foldDim` per dimension for what survives. */
export function foldDimStats(rows: Iterable<DimCliRow>): Record<string, DimStats> {
  const accs = new Map<string, Acc>();
  for (const row of rows) {
    if (!DIM_CLI_KINDS.includes(row.kind) || !isObj(row.payload)) continue;
    const dim = dimOf(row);
    if (dim === null) continue;
    const p = row.payload;
    let a = accs.get(dim);
    if (!a) {
      a = { stats: emptyStats(), started: false, attached: [], lastSession: null, agentAdded: new Set(), humanTouched: new Set(), spanStart: null, spanHumanOps: 0, humanRows: 0, rows: [] };
      accs.set(dim, a);
    }
    a.rows.push(row);
    a.stats.rows += 1;
    const at = typeof row.at === 'string' ? Date.parse(row.at) : Number.NaN;
    if (row.kind === DIM_KINDS.start) {
      if (a.started) a.stats.reopens += 1;
      a.started = true;
      bump(a.stats.openedBy, typeof p.opened === 'string' && ['command', 'menu', 'offer'].includes(p.opened) ? p.opened : 'unknown');
      const first = Array.isArray(p.attached) && typeof p.attached[0] === 'string' ? p.attached[0] : null;
      if (first) {
        if (!a.attached.includes(first)) a.attached.push(first);
        a.lastSession = first;
      }
      a.spanStart = Number.isFinite(at) ? at : null;
      a.spanHumanOps = 0;
    } else if (row.kind === DIM_KINDS.attach) {
      if (typeof p.hsid === 'string' && p.hsid.length > 0) {
        if (!a.attached.includes(p.hsid)) a.attached.push(p.hsid);
        a.lastSession = p.hsid;
      }
    } else if (row.kind === DIM_KINDS.end) {
      if (a.spanStart !== null && Number.isFinite(at) && at - a.spanStart < QUICK_MS && a.spanHumanOps === 0) a.stats.closedQuick += 1;
      a.spanStart = null;
    } else {
      const by = handOf(p);
      const stamp = isObj(p.relayedFor) ? p.relayedFor : {};
      const session = typeof stamp.hsid === 'string' && stamp.hsid.length > 0 ? stamp.hsid : a.attached.length === 1 ? a.attached[0]! : a.lastSession;
      bump(a.stats.opsBySession, session ?? 'unknown');
      if (stamp.surface === 'voice') a.stats.voice.rows += 1;
      if (by.cls === 'human') {
        a.humanRows += 1;
        a.spanHumanOps += 1;
      }
      const ops = Array.isArray(p.ops) ? p.ops.filter(isObj) : [];
      if (by.cls === 'agent' && ops.some((op) => citedIds(op).some((id) => a!.humanTouched.has(id)))) a.stats.roundTrips += 1;
      for (const op of ops) {
        const added = op.type === 'add' && isObj(op.node) && typeof op.node.id === 'string' ? op.node.id : null;
        if (by.cls === 'agent' && added) a.agentAdded.add(added);
        if (by.cls === 'human') {
          if (added) a.humanTouched.add(added);
          else if (op.type === 'update' || op.type === 'move') for (const id of citedIds(op)) a.humanTouched.add(id);
        }
      }
    }
  }
  const out = logKeyed<DimStats>();
  for (const [dim, a] of accs) {
    // what is on the board now, and by whose hand: the published fold, once
    const state = foldDim(a.rows, undefined, emptyDimState(dim));
    let surviving = 0;
    for (const id of a.agentAdded) if (state.nodes.get(id)?.by.cls === 'agent') surviving += 1;
    a.stats.agentMarks = { added: a.agentAdded.size, surviving };
    a.stats.voice.withHumanRows = a.stats.voice.rows > 0 && a.humanRows > 0;
    out[dim] = a.stats;
  }
  return out;
}

/** The totals over several dimensions. */
export function sumDimStats(per: Record<string, DimStats>): DimStats & { dimensions: number; voiceWithHuman: number } {
  const t = emptyStats();
  let voiceWithHuman = 0;
  for (const s of Object.values(per)) {
    t.rows += s.rows;
    t.reopens += s.reopens;
    for (const [k, n] of Object.entries(s.openedBy)) t.openedBy[k] = (t.openedBy[k] ?? 0) + n;
    t.agentMarks.added += s.agentMarks.added;
    t.agentMarks.surviving += s.agentMarks.surviving;
    t.roundTrips += s.roundTrips;
    t.voice.rows += s.voice.rows;
    if (s.voice.withHumanRows) voiceWithHuman += 1;
    t.closedQuick += s.closedQuick;
    for (const [k, n] of Object.entries(s.opsBySession)) t.opsBySession[k] = (t.opsBySession[k] ?? 0) + n;
  }
  t.voice.withHumanRows = voiceWithHuman > 0;
  return { ...t, dimensions: Object.keys(per).length, voiceWithHuman };
}

const counts = (m: Record<string, number>): string =>
  Object.keys(m)
    .sort()
    .map((k) => `${stripControl(k)} ${m[k]}`)
    .join(' · ') || '-';
const survival = (m: { added: number; surviving: number }): string => (m.added === 0 ? 'no agent mark yet' : `${m.surviving} of ${m.added} still on the board`);

export function statsReadout(s: DimStats, voiceWithHuman?: number): Array<readonly [string, string | number]> {
  return [
    ['rows', s.rows],
    ['reopens', `${s.reopens} (opened by: ${counts(s.openedBy)})`],
    ['agent marks', survival(s.agentMarks)],
    ['round trips', s.roundTrips],
    ['voice rows', voiceWithHuman === undefined ? `${s.voice.rows}${s.voice.rows ? (s.voice.withHumanRows ? ' (beside human rows)' : ' (no human row beside them)') : ''}` : `${s.voice.rows} (${voiceWithHuman} dimension(s) with human rows beside them)`],
    ['closed in a minute, no human op', s.closedQuick],
    ['ops by session', counts(s.opsBySession)],
  ];
}

/* ── the command ──────────────────────────────────────────────────────────── */

/** Read the dimension rows of a VERIFIED log. `ok: false` when the log cannot be read or does not verify. */
export function readDimRows(home: string, only?: string): { ok: true; rows: DimCliRow[]; total: number } | { ok: false; code: string; reason: string; message: string } {
  const pubs = readKernelPubs(home);
  const ring = new KeyRing();
  for (const k of pubs) ring.addEd25519(k.publicKeyPem);
  const rows: DimCliRow[] = [];
  let report: ReturnType<typeof verifyLog>;
  try {
    report = verifyLog(home, {
      keyRing: ring,
      kernelPrincipal: kernelPrincipalOf(),
      kernelKeyIds: pubs.map((k) => k.keyId),
      onRow: (r) => {
        if (!DIM_CLI_KINDS.includes(r.kind)) return;
        try {
          const env = JSON.parse(r.envelope) as { payload?: unknown; at?: unknown };
          const row: DimCliRow = { seq: r.seq, kind: r.kind, payload: env.payload, ...(typeof env.at === 'string' ? { at: env.at } : {}) };
          if (only === undefined || dimOf(row) === only) rows.push(row);
        } catch {
          /* an envelope verify accepted always parses */
        }
      },
    });
  } catch (err) {
    return { ok: false, code: 'ENGINE', reason: 'log-unreadable', message: `could not read the log: ${stripControl((err as Error).message)}` };
  }
  if (!report.ok) return { ok: false, code: 'INTEGRITY_BROKEN', reason: 'verify-failed', message: `${report.failures.length} verify failure(s); an unverified log is never replayed or counted` };
  return { ok: true, rows, total: report.rows };
}

export async function runDimCommand(argv: readonly string[], io: { stdout: Out; stderr: Out }): Promise<number> {
  const [verb, ...rest] = argv;
  if (!verb || verb === '--help' || verb === '-h' || verb === 'help') {
    (verb ? io.stdout : io.stderr).write(DIM_USAGE);
    return verb ? DIM_EXIT_OK : DIM_EXIT_USAGE;
  }
  if (verb !== 'replay' && verb !== 'stats') {
    refused(io.stderr, 'usage', 'unknown-verb', `unknown verb (${verb.length} chars)`, ['gnomon dim --help']);
    return DIM_EXIT_USAGE;
  }
  let home: string | undefined;
  let dim: string | undefined;
  let to: number | undefined;
  let json = false;
  const usage = (message: string): number => {
    refused(io.stderr, 'usage', 'bad-argument', message, ['gnomon dim --help']);
    return DIM_EXIT_USAGE;
  };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (a === '--json') json = true;
    else if (a === '--to' && verb === 'replay') {
      const v = rest[++i] ?? '';
      if (!/^[0-9]{1,15}$/.test(v)) return usage('--to takes a seq (a whole number)');
      to = Number(v);
    } else if (dim === undefined && DIM_ID_PATTERN.test(a)) dim = a;
    else if (!a.startsWith('-') && home === undefined && path.isAbsolute(a)) home = a;
    else return usage(`unexpected argument (${a.length} chars): a dimension is dim:<ULID>, the home an absolute path`);
  }
  if (verb === 'replay' && dim === undefined) return usage('replay needs a dimension id (dim:<ULID>)');
  const read = readDimRows(path.resolve(home ?? resolveGnomonHome()), dim);
  if (!read.ok) {
    refused(io.stderr, read.code, read.reason, read.message, read.reason === 'log-unreadable' ? ['check the home path'] : []);
    return DIM_EXIT_REFUSED;
  }
  // every printed byte goes through one sanitising writer: line breaks are the CLI's own, never a mark's
  const out: Out = { write: (chunk) => io.stdout.write(chunk.split('\n').map(stripControl).join('\n')) };

  if (verb === 'replay') {
    if (read.rows.length === 0) {
      refused(io.stderr, 'NOT_FOUND', 'dim-unknown', 'the verified log holds no row of that dimension');
      return DIM_EXIT_REFUSED;
    }
    const state = replayDim(read.rows, dim!, to);
    if (json) {
      out.write(`${JSON.stringify(stripControlDeep({ dim, to: to ?? null, rows: read.rows.length, hash: dimHash(state), ended: state.ended, attached: state.attached.length, ops: state.ops, unapplied: state.unapplied, view: dimViewOf(state) }))}\n`);
      return DIM_EXIT_OK;
    }
    const lines = replayLines(state);
    heading(out, 'dimension', `${dim}${to !== undefined ? `  to seq ${to}` : ''}`);
    readout(out, lines.head);
    if (lines.marks.length) {
      heading(out, 'marks', `${lines.marks.length}, in drawing order`);
      for (const m of lines.marks) out.write(`  ${m}\n`);
    }
    return DIM_EXIT_OK;
  }

  const per = foldDimStats(read.rows);
  const dims = Object.keys(per).sort();
  const total = sumDimStats(per);
  if (json) {
    out.write(`${JSON.stringify(stripControlDeep({ rows: read.total, dimensions: per, total, notes: [DIM_STATS_UNDO_NOTE, DIM_STATS_ROUND_TRIP_NOTE] }))}\n`);
    return DIM_EXIT_OK;
  }
  heading(out, 'dimensions', `${dims.length}`);
  if (dims.length === 0) {
    out.write('  no dimension row yet\n');
    return DIM_EXIT_OK;
  }
  if (dims.length > 1) readout(out, statsReadout(total, total.voiceWithHuman));
  for (const d of dims) {
    heading(out, 'dimension', d);
    readout(out, statsReadout(per[d]!));
  }
  out.write(`  note: ${DIM_STATS_UNDO_NOTE}\n  note: ${DIM_STATS_ROUND_TRIP_NOTE}\n`);
  return DIM_EXIT_OK;
}
