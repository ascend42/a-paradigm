/**
 * Overview Aggregation Route
 *
 * GET /api/platform/overview
 *
 * Returns a single aggregated payload for the Overview dashboard:
 * project info, symbol counts, lore stats, calibration, tasks, health metrics,
 * and a merged recent-activity feed (git commits + lore entries).
 */

import { type Request, type Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import simpleGit from 'simple-git';
import * as yaml from 'js-yaml';

interface ActivityItem {
  timestamp: string;
  type: 'commit' | 'lore';
  summary: string;
  symbol?: string;
  link?: string;
}

interface OverviewData {
  project: { name: string; branch: string; discipline: string };
  symbols: { total: number; byType: Record<string, number> };
  lore: { total: number; thisWeek: number; lastEntry: string | null };
  calibration: { score: number | null; assessed: number };
  tasks: { total: number; inProgress: number; completed: number };
  health: {
    purposeCoverage: number;
    aspectAnchors: number;
    gateCompliance: number;
    calibration: number;
    loreFreshnessDays: number;
  };
  recentActivity: ActivityItem[];
}

function readJsonSafe(filePath: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function readYamlSafe(filePath: string): unknown {
  try {
    return yaml.load(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return null;
  }
}

function getSymbolCounts(projectDir: string): { total: number; byType: Record<string, number> } {
  const indexPath = path.join(projectDir, '.paradigm', 'scan-index.json');
  const data = readJsonSafe(indexPath) as { symbols?: Array<{ category?: string }> } | null;
  if (!data?.symbols) return { total: 0, byType: {} };

  const byType: Record<string, number> = {};
  for (const sym of data.symbols) {
    const cat = sym.category || 'unknown';
    byType[cat] = (byType[cat] || 0) + 1;
  }
  return { total: data.symbols.length, byType };
}

function getLoreStats(projectDir: string): {
  total: number;
  thisWeek: number;
  lastEntry: string | null;
  calibrationScore: number | null;
  assessed: number;
} {
  const entriesDir = path.join(projectDir, '.paradigm', 'lore', 'entries');
  if (!fs.existsSync(entriesDir)) {
    return { total: 0, thisWeek: 0, lastEntry: null, calibrationScore: null, assessed: 0 };
  }

  const files = fs.readdirSync(entriesDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  const now = Date.now();
  const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
  let lastTimestamp: string | null = null;
  let thisWeek = 0;
  let assessedCount = 0;
  let confidenceSum = 0;
  let deltaSum = 0;
  let deltaCount = 0;

  for (const file of files) {
    try {
      const entry = readYamlSafe(path.join(entriesDir, file)) as Record<string, unknown> | null;
      if (!entry) continue;

      const ts = entry.timestamp as string;
      if (ts) {
        const entryTime = new Date(ts).getTime();
        if (!lastTimestamp || entryTime > new Date(lastTimestamp).getTime()) {
          lastTimestamp = ts;
        }
        if (entryTime >= weekAgo) thisWeek++;
      }

      if (entry.assessment) {
        assessedCount++;
        if (typeof entry.confidence === 'number' && typeof entry.assessment_delta === 'number') {
          confidenceSum += entry.confidence;
          deltaSum += Math.abs(entry.assessment_delta);
          deltaCount++;
        }
      }
    } catch {
      // skip malformed
    }
  }

  const calibrationScore = deltaCount > 0 ? Math.max(0, 1 - (deltaSum / deltaCount)) : null;

  return {
    total: files.length,
    thisWeek,
    lastEntry: lastTimestamp,
    calibrationScore,
    assessed: assessedCount,
  };
}

function getTaskCounts(projectDir: string): { total: number; inProgress: number; completed: number } {
  const tasksDir = path.join(projectDir, '.paradigm', 'tasks');
  if (!fs.existsSync(tasksDir)) return { total: 0, inProgress: 0, completed: 0 };

  const files = fs.readdirSync(tasksDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  let inProgress = 0;
  let completed = 0;

  for (const file of files) {
    try {
      const task = readYamlSafe(path.join(tasksDir, file)) as Record<string, unknown> | null;
      if (!task) continue;
      const status = task.status as string;
      if (status === 'in-progress' || status === 'in_progress') inProgress++;
      else if (status === 'completed' || status === 'done') completed++;
    } catch {
      // skip
    }
  }

  return { total: files.length, inProgress, completed };
}

function getPurposeCoverage(projectDir: string): number {
  // Count source directories that have .purpose files vs total source dirs
  const srcDirs = ['src', 'lib', 'packages'];
  let withPurpose = 0;
  let total = 0;

  for (const dir of srcDirs) {
    const fullPath = path.join(projectDir, dir);
    if (!fs.existsSync(fullPath)) continue;
    countPurposeCoverage(fullPath, { withPurpose: 0, total: 0 }, (stats) => {
      withPurpose += stats.withPurpose;
      total += stats.total;
    });
  }

  // Also check root .purpose
  if (fs.existsSync(path.join(projectDir, '.purpose'))) {
    withPurpose++;
    total++;
  }

  return total === 0 ? 1.0 : withPurpose / total;
}

function countPurposeCoverage(
  dir: string,
  _stats: { withPurpose: number; total: number },
  callback: (stats: { withPurpose: number; total: number }) => void,
): void {
  const stats = { withPurpose: 0, total: 0 };
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const hasSourceFiles = entries.some(
      e => e.isFile() && /\.(ts|tsx|js|jsx|rs|py|go|swift)$/.test(e.name)
    );
    if (hasSourceFiles) {
      stats.total++;
      if (entries.some(e => e.isFile() && e.name === '.purpose')) {
        stats.withPurpose++;
      }
    }
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist') {
        countPurposeCoverage(path.join(dir, entry.name), stats, (sub) => {
          stats.withPurpose += sub.withPurpose;
          stats.total += sub.total;
        });
      }
    }
  } catch {
    // skip
  }
  callback(stats);
}

function getGateCompliance(projectDir: string): number {
  const portalPath = path.join(projectDir, 'portal.yaml');
  if (!fs.existsSync(portalPath)) return 1.0; // No portal = no routes to protect

  const portal = readYamlSafe(portalPath) as { routes?: Record<string, unknown> } | null;
  if (!portal?.routes) return 1.0;

  const routeCount = Object.keys(portal.routes).length;
  // If portal exists with routes defined, assume compliant
  return routeCount > 0 ? 1.0 : 0.5;
}

function getAspectAnchors(projectDir: string): number {
  const dbPath = path.join(projectDir, '.paradigm', 'aspect-graph.db');
  if (!fs.existsSync(dbPath)) return 1.0; // No aspects = healthy

  // Simple heuristic: if the DB exists, aspects are tracked
  return 1.0;
}

function getConfigInfo(projectDir: string): { name: string; discipline: string } {
  const configPath = path.join(projectDir, '.paradigm', 'config.yaml');
  const config = readYamlSafe(configPath) as { project?: string; discipline?: string } | null;
  return {
    name: config?.project || path.basename(projectDir),
    discipline: config?.discipline || 'general',
  };
}

async function getRecentCommits(projectDir: string, limit: number): Promise<ActivityItem[]> {
  try {
    const git = simpleGit(projectDir);
    const log = await git.log({ maxCount: limit });
    return log.all.map((c) => ({
      timestamp: c.date,
      type: 'commit' as const,
      summary: c.message.split('\n')[0],
      symbol: extractFirstSymbol(c.message),
      link: c.hash.substring(0, 7),
    }));
  } catch {
    return [];
  }
}

function extractFirstSymbol(text: string): string | undefined {
  const match = text.match(/[#$^!~][\w-]+/);
  return match ? match[0] : undefined;
}

function getLoreActivity(projectDir: string, limit: number): ActivityItem[] {
  const entriesDir = path.join(projectDir, '.paradigm', 'lore', 'entries');
  if (!fs.existsSync(entriesDir)) return [];

  const files = fs.readdirSync(entriesDir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
  const items: ActivityItem[] = [];

  for (const file of files) {
    try {
      const entry = readYamlSafe(path.join(entriesDir, file)) as Record<string, unknown> | null;
      if (!entry) continue;
      items.push({
        timestamp: (entry.timestamp as string) || '',
        type: 'lore',
        summary: (entry.title as string) || file,
        symbol: Array.isArray(entry.symbols_touched) ? entry.symbols_touched[0] : undefined,
        link: entry.id as string,
      });
    } catch {
      // skip
    }
  }

  return items
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, limit);
}

export function createOverviewHandler(projectDir: string) {
  return async (_req: Request, res: Response) => {
    try {
      const configInfo = getConfigInfo(projectDir);
      const symbolCounts = getSymbolCounts(projectDir);
      const loreStats = getLoreStats(projectDir);
      const taskCounts = getTaskCounts(projectDir);
      const purposeCoverage = getPurposeCoverage(projectDir);
      const gateCompliance = getGateCompliance(projectDir);
      const aspectAnchors = getAspectAnchors(projectDir);

      // Git branch
      let branch = 'unknown';
      try {
        const git = simpleGit(projectDir);
        const branchInfo = await git.branch();
        branch = branchInfo.current;
      } catch {
        // no git
      }

      // Recent activity: merge commits + lore, sort by time, take top 20
      const [commits, loreActivity] = await Promise.all([
        getRecentCommits(projectDir, 20),
        Promise.resolve(getLoreActivity(projectDir, 20)),
      ]);

      const recentActivity = [...commits, ...loreActivity]
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, 20);

      // Lore freshness
      const loreFreshnessDays = loreStats.lastEntry
        ? Math.floor((Date.now() - new Date(loreStats.lastEntry).getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      const overview: OverviewData = {
        project: { name: configInfo.name, branch, discipline: configInfo.discipline },
        symbols: symbolCounts,
        lore: { total: loreStats.total, thisWeek: loreStats.thisWeek, lastEntry: loreStats.lastEntry },
        calibration: { score: loreStats.calibrationScore, assessed: loreStats.assessed },
        tasks: taskCounts,
        health: {
          purposeCoverage,
          aspectAnchors,
          gateCompliance,
          calibration: loreStats.calibrationScore ?? 1.0,
          loreFreshnessDays,
        },
        recentActivity,
      };

      res.json(overview);
    } catch (err) {
      res.status(500).json({ error: 'Failed to aggregate overview', detail: String(err) });
    }
  };
}
