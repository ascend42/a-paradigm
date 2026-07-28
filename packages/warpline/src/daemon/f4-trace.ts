/**
 * #f4-trace — `f4Trace:v1`, the skin's OWN measurement stream (mcp-skin-spec
 * §5; Loid requirement 2). The F4 harness's ground truth: daemonAudit:v1 was
 * REJECTED for that job because `audit(true)` masks verdict-class refusals
 * riding inside ok results, rows carry no runId, and the wasted-turn
 * classifier needs the PRIOR refusal's enums to judge the NEXT call.
 *
 * One row per tool/CLI call, appended to `.warpline/f4/trace.jsonl`:
 *
 *   f4Trace:v1 {schemaVersion, ts, runId, seq, skin, principal, verb,
 *               target, ok, refusal?, resultClass?, descriptorsId}
 *
 * Discipline:
 *  - `refusal` is the `refusal:v1` object VERBATIM — legal in a log because
 *    refusal:v1 is prose-free by construction (the binding rule in
 *    refusal.ts). It is captured from BOTH sources: error frames AND
 *    `result.refusal` (the in-result verdict-class refusals the audit masks).
 *  - `target` follows the `targetOf` discipline: selectors/paths/flags only —
 *    NEVER intent/reason/prose bodies. No other field may carry prose.
 *  - `runId` comes from $WARPLINE_F4_RUN_ID (set by the T-005 harness);
 *    'unscored' when absent — rows always emit, scoring filters by runId.
 *  - `seq` is the per-RUN ordinal, seeded from the trace file at construction
 *    rather than from zero. The MCP skin is one long-lived process per run, but
 *    the CLI skin is one process PER COMMAND — a process-local counter would
 *    stamp every CLI row seq:0 and the classifier (which orders by seq) would
 *    see an unorderable transcript. Seeding makes the ordinal continuous across
 *    the many short processes of a CLI-arm run. Ordering assumes the arm is
 *    SERIAL (one subject issuing one command at a time, which is what F4
 *    measures); genuinely concurrent writers in one runId could tie.
 *  - `descriptorsId` pins WHICH teaching text served this call (FG-3), so a
 *    failed run attributes to description vs refusal vs protocol.
 *  - The wasted-turn taxonomy (W1-W4) is the HARNESS's pure classifier over
 *    these rows — this module only emits them faithfully.
 *
 * Library code: no console output; a trace-write failure must never take the
 * serving call down (best-effort append, same posture as the daemon audit).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Refusal } from '../fabric/refusal.js';
import { descriptorsId } from './descriptors.js';

export const F4_TRACE_SCHEMA = 'f4Trace:v1' as const;

export interface F4TraceRow {
  schemaVersion: typeof F4_TRACE_SCHEMA;
  ts: string;
  /** harness run correlation — 'unscored' outside a harness run. */
  runId: string;
  /** per-run call ordinal within this emitting process. */
  seq: number;
  skin: 'mcp' | 'cli';
  principal: string;
  /** the DAEMON verb name (dotted, verbatim) — never the mangled tool name. */
  verb: string;
  /** structural request summary (selector/flags/paths) — never prose. */
  target: string | null;
  ok: boolean;
  /** refusal:v1 VERBATIM — from the error frame OR result.refusal. */
  refusal?: Refusal;
  /** structural verdict class for ok rows ('sealed' | decision.status | 'noop' | 'read'). */
  resultClass?: string;
  descriptorsId: string;
}

export function f4TracePathOf(root: string): string {
  return path.join(root, '.warpline', 'f4', 'trace.jsonl');
}

/**
 * Structural verdict class from a result SHAPE — never from text. Admit-shaped
 * results report 'sealed' or their decision status; propose no-ops report
 * 'noop'; sealing writes report 'sealed'; everything else is a 'read'.
 */
export function resultClassOf(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  const decision = r.decision;
  if (decision && typeof decision === 'object') {
    if (r.sealed === true) return 'sealed';
    const status = (decision as Record<string, unknown>).status;
    return typeof status === 'string' ? status : 'unknown';
  }
  if (r.noop === true) return 'noop';
  if ('strand' in r && r.strand) return 'sealed';
  return 'read';
}

/**
 * The next ordinal for `runId` in this fabric's trace: max(seq)+1 over the rows
 * already recorded for that run, 0 when the run has none. Best-effort — an
 * unreadable trace starts a fresh ordinal rather than failing the call.
 */
export function nextSeqFor(root: string, runId: string): number {
  let max = -1;
  for (const row of readF4Trace(root)) {
    if (row.runId === runId && typeof row.seq === 'number' && row.seq > max) max = row.seq;
  }
  return max + 1;
}

/**
 * One emitting process's trace handle: fixes runId/skin/principal/descriptorsId
 * at construction and counts seq from wherever the run left off. Append is
 * BEST-EFFORT — a trace failure never fails the serving call.
 */
export class F4Tracer {
  private seq: number;
  private readonly runId: string;
  private readonly descriptorsId: string;

  constructor(
    private readonly root: string,
    private readonly skin: 'mcp' | 'cli',
    /** MUTABLE: the MCP skin learns its principal from the first status()
     * round-trip — updating it here keeps one tracer (and one seq ordinal)
     * per process instead of resetting the ordinal on discovery. */
    public principal: string,
  ) {
    this.runId = process.env.WARPLINE_F4_RUN_ID || 'unscored';
    this.descriptorsId = descriptorsId();
    this.seq = nextSeqFor(root, this.runId);
  }

  emit(entry: {
    verb: string;
    target: string | null;
    ok: boolean;
    refusal?: Refusal;
    resultClass?: string | null;
  }): void {
    const row: F4TraceRow = {
      schemaVersion: F4_TRACE_SCHEMA,
      ts: new Date().toISOString(),
      runId: this.runId,
      seq: this.seq++,
      skin: this.skin,
      principal: this.principal,
      verb: entry.verb,
      target: entry.target,
      ok: entry.ok,
      ...(entry.refusal ? { refusal: entry.refusal } : {}),
      ...(entry.resultClass ? { resultClass: entry.resultClass } : {}),
      descriptorsId: this.descriptorsId,
    };
    try {
      const p = f4TracePathOf(this.root);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.appendFileSync(p, JSON.stringify(row) + '\n', 'utf8');
    } catch {
      /* best-effort — never take the serving call down */
    }
  }
}

/** Read the trace rows (harness-side; bad lines skipped, never fatal). */
export function readF4Trace(root: string): F4TraceRow[] {
  let raw: string;
  try {
    raw = fs.readFileSync(f4TracePathOf(root), 'utf8');
  } catch {
    return [];
  }
  const out: F4TraceRow[] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as F4TraceRow);
    } catch {
      /* skip */
    }
  }
  return out;
}
