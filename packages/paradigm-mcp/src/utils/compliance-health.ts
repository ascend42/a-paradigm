/**
 * Compliance Health Tracker — records compliance snapshots over time and
 * computes trends for surfacing in paradigm_status.
 *
 * Storage: .paradigm/events/compliance-history.jsonl
 *
 * Design:
 *   - Pure append log — one record per stop-hook run
 *   - Trend computed from last N records (default: 10)
 *   - No scoring, no percentages — just violation/warning/check counts
 *   - All writes are non-fatal; callers must never fail because of this module
 */

import * as fs from 'fs';
import * as path from 'path';

const COMPLIANCE_HISTORY_FILE = '.paradigm/events/compliance-history.jsonl';
const DEFAULT_WINDOW = 10;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ComplianceRecord {
  timestamp: string;
  /** Number of blocking violations found by the stop hook */
  violations: number;
  /** Number of advisory warnings */
  warnings: number;
  /** Total number of checks run */
  checks: number;
  /** Optional session identifier */
  sessionId?: string;
}

export type ComplianceTrend = 'improving' | 'stable' | 'degrading';
export type HealthDot = 'green' | 'yellow' | 'orange' | 'red';

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Append a compliance snapshot to the history log.
 * Non-fatal — failure is silently ignored.
 */
export function recordComplianceSnapshot(
  rootDir: string,
  record: Omit<ComplianceRecord, 'timestamp'>
): void {
  try {
    const filePath = path.join(rootDir, COMPLIANCE_HISTORY_FILE);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const entry: ComplianceRecord = {
      timestamp: new Date().toISOString(),
      ...record,
    };

    const line = JSON.stringify(entry) + '\n';
    fs.appendFileSync(filePath, line, 'utf8');
  } catch {
    // Non-fatal — compliance history is advisory
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Read the last N compliance records from history.
 */
function readComplianceHistory(rootDir: string, limit?: number): ComplianceRecord[] {
  try {
    const filePath = path.join(rootDir, COMPLIANCE_HISTORY_FILE);
    if (!fs.existsSync(filePath)) return [];

    const all = fs.readFileSync(filePath, 'utf8')
      .trim()
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        try { return JSON.parse(line) as ComplianceRecord; }
        catch { return null; }
      })
      .filter((r): r is ComplianceRecord => r !== null);

    if (limit && limit > 0) {
      return all.slice(-limit);
    }
    return all;
  } catch {
    return [];
  }
}

// ── Trend Analysis ────────────────────────────────────────────────────────────

/**
 * Compute the violation rate for a set of records.
 * Returns violations / checks, or 0 if no checks.
 */
function violationRate(records: ComplianceRecord[]): number {
  const totalChecks = records.reduce((sum, r) => sum + r.checks, 0);
  const totalViolations = records.reduce((sum, r) => sum + r.violations, 0);
  if (totalChecks === 0) return 0;
  return totalViolations / totalChecks;
}

/**
 * Compute the compliance trend from the last `windowSize` records.
 *
 * Strategy: split the window in half, compare violation rate of recent half
 * vs older half. Threshold of 0.05 separates stable from improving/degrading.
 *
 * Returns null if there are fewer than 2 records (insufficient data).
 */
export function getComplianceTrend(
  rootDir: string,
  windowSize: number = DEFAULT_WINDOW
): ComplianceTrend | null {
  const records = readComplianceHistory(rootDir, windowSize);
  if (records.length < 2) return null;

  const mid = Math.floor(records.length / 2);
  const older = records.slice(0, mid);
  const recent = records.slice(mid);

  const olderRate = violationRate(older);
  const recentRate = violationRate(recent);
  const delta = recentRate - olderRate;

  const THRESHOLD = 0.05;
  if (delta < -THRESHOLD) return 'improving';
  if (delta > THRESHOLD) return 'degrading';
  return 'stable';
}

// ── Health Dot ────────────────────────────────────────────────────────────────

/**
 * Map trend + recent absolute violation rate to a health dot color.
 *
 * Color rules:
 *   green  — improving or stable with zero recent violations
 *   yellow — stable with some violations
 *   orange — degrading but not severe
 *   red    — degrading and high absolute violation rate
 */
export function getHealthDot(
  trend: ComplianceTrend | null,
  rootDir?: string
): HealthDot {
  if (!trend) return 'yellow'; // Insufficient data

  if (trend === 'improving') return 'green';

  // For stable/degrading, check absolute recent violation rate
  let recentRate = 0;
  if (rootDir) {
    const recent = readComplianceHistory(rootDir, Math.ceil(DEFAULT_WINDOW / 2));
    recentRate = violationRate(recent);
  }

  if (trend === 'stable') {
    return recentRate === 0 ? 'green' : 'yellow';
  }

  // degrading
  return recentRate > 0.2 ? 'red' : 'orange';
}

/**
 * Convenience: compute trend and dot together.
 * Returns null if there is insufficient data.
 */
export function getComplianceHealthSummary(
  rootDir: string,
  windowSize: number = DEFAULT_WINDOW
): { trend: ComplianceTrend; dot: HealthDot } | null {
  const trend = getComplianceTrend(rootDir, windowSize);
  if (!trend) return null;
  return { trend, dot: getHealthDot(trend, rootDir) };
}
