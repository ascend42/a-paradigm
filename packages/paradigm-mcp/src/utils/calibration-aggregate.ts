/**
 * Calibration aggregation (#calibration) — the MCP-side home of the learned
 * token-estimate rebuild, so BOTH the `paradigm calibrate` CLI command AND the
 * settlement chain can trigger it. Previously this logic lived only in the CLI
 * (commands/calibrate.ts), so the learned table only refreshed when a human ran
 * the command by hand — the loop never closed automatically. (MCP can't import
 * from the CLI package; the CLI imports this.)
 *
 * Pure aggregation: read the captured per-agent actuals → group by
 * (archetype, taskType) → compute p10/p90 bands for groups at/above the sample
 * floor (MIN_SAMPLES) → write `.paradigm/learned/token-estimates.json`.
 */

import * as fs from 'fs';
import * as path from 'path';

/** Minimum samples per (archetype, taskType) group before a band is learned. */
export const MIN_SAMPLES = 8;

const ACTUALS_FILE = '.paradigm/events/estimate-actuals.jsonl';
const LEARNED_FILE = '.paradigm/learned/token-estimates.json';

/** A learned band for one (archetype, taskType) cell. */
export interface LearnedBand {
  min: number;
  max: number;
  n: number;
}

/** archetype → taskType → band. The shape written to token-estimates.json. */
export type LearnedTokenTable = Record<string, Record<string, LearnedBand>>;

interface ActualRecord {
  archetype?: string;
  taskType?: string;
  actualTokens?: { total?: number };
}

/** One group's calibration outcome. */
export interface GroupReport {
  archetype: string;
  taskType: string;
  n: number;
  learned: boolean;
  band?: LearnedBand;
}

/**
 * Percentile of a numeric sample using linear interpolation between closest
 * ranks. `p` is in [0,1]. Sorted-copy is taken internally.
 */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = p * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  const frac = rank - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

/**
 * Pure aggregation: JSONL lines → group by (archetype, taskType) → p10/p90 bands
 * for groups at/above the sample floor. Malformed lines are skipped.
 */
export function aggregateActuals(lines: string[]): { table: LearnedTokenTable; groups: GroupReport[] } {
  const buckets = new Map<string, number[]>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: ActualRecord;
    try {
      rec = JSON.parse(trimmed) as ActualRecord;
    } catch {
      continue;
    }
    const { archetype, taskType } = rec;
    const total = rec.actualTokens?.total;
    if (typeof archetype !== 'string' || typeof taskType !== 'string') continue;
    if (typeof total !== 'number' || !Number.isFinite(total)) continue;

    const key = `${archetype} ${taskType}`;
    const arr = buckets.get(key);
    if (arr) arr.push(total);
    else buckets.set(key, [total]);
  }

  const table: LearnedTokenTable = {};
  const groups: GroupReport[] = [];

  for (const [key, totals] of buckets) {
    const [archetype, taskType] = key.split(' ');
    const n = totals.length;
    if (n >= MIN_SAMPLES) {
      const band: LearnedBand = {
        min: Math.round(percentile(totals, 0.1)),
        max: Math.round(percentile(totals, 0.9)),
        n,
      };
      if (!table[archetype]) table[archetype] = {};
      table[archetype][taskType] = band;
      groups.push({ archetype, taskType, n, learned: true, band });
    } else {
      groups.push({ archetype, taskType, n, learned: false });
    }
  }

  groups.sort((a, b) =>
    a.archetype === b.archetype ? a.taskType.localeCompare(b.taskType) : a.archetype.localeCompare(b.archetype),
  );

  return { table, groups };
}

/**
 * Read the captured actuals, aggregate, and WRITE the learned token table.
 * Best-effort and idempotent — safe to call on every settlement. Returns the
 * outcome, or `null` when there are no actuals yet (nothing written). Never
 * throws (a settlement must not break on a calibration hiccup).
 */
export function rebuildLearnedTable(rootDir: string): { table: LearnedTokenTable; groups: GroupReport[]; samplesRead: number } | null {
  try {
    const actualsPath = path.join(rootDir, ACTUALS_FILE);
    if (!fs.existsSync(actualsPath)) return null;

    const lines = fs.readFileSync(actualsPath, 'utf8').split('\n');
    const { table, groups } = aggregateActuals(lines);

    const learnedDir = path.join(rootDir, path.dirname(LEARNED_FILE));
    if (!fs.existsSync(learnedDir)) fs.mkdirSync(learnedDir, { recursive: true });
    fs.writeFileSync(path.join(rootDir, LEARNED_FILE), JSON.stringify(table, null, 2) + '\n', 'utf8');

    return { table, groups, samplesRead: groups.reduce((s, g) => s + g.n, 0) };
  } catch {
    return null;
  }
}
