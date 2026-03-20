/**
 * Work Log Loader — CRUD for the "what got done" knowledge stream
 *
 * Storage: .paradigm/work-log/{date}/WL-{agent}-{counter}.yaml
 * Audience: The project. Sprint boards, standup summaries.
 * Lifecycle: Ephemeral — matters for days/weeks, archived after milestones.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { WorkLogEntry, WorkLogFilter, WorkOutcome } from '../types/knowledge-streams.js';

const WORK_LOG_DIR = '.paradigm/work-log';

// ────────────────────────────────────────────────────────
// ID Generation
// ────────────────────────────────────────────────────────

function generateWorkLogId(agent: string): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const sanitized = agent.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 20);
  const counter = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
  return `WL-${sanitized}-${date}-${counter}`;
}

function getDateDir(rootDir: string, date: string): string {
  return path.join(rootDir, WORK_LOG_DIR, date);
}

// ────────────────────────────────────────────────────────
// Write Operations
// ────────────────────────────────────────────────────────

export function recordWorkLog(rootDir: string, entry: Omit<WorkLogEntry, 'id' | 'timestamp'>): WorkLogEntry {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const id = generateWorkLogId(entry.agent);

  const full: WorkLogEntry = {
    id,
    timestamp: now.toISOString(),
    ...entry,
  };

  const dir = getDateDir(rootDir, date);
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `${id}.yaml`);
  fs.writeFileSync(filePath, yaml.dump(full, { lineWidth: 120, noRefs: true }), 'utf8');

  return full;
}

// ────────────────────────────────────────────────────────
// Read Operations
// ────────────────────────────────────────────────────────

export function loadWorkLogEntries(rootDir: string, filter?: WorkLogFilter): WorkLogEntry[] {
  const baseDir = path.join(rootDir, WORK_LOG_DIR);
  if (!fs.existsSync(baseDir)) return [];

  const entries: WorkLogEntry[] = [];

  // Read date directories
  const dateDirs = fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name))
    .map(d => d.name)
    .sort()
    .reverse(); // newest first

  for (const dateDir of dateDirs) {
    // Date range filter — skip entire directories outside range
    if (filter?.dateFrom && dateDir < filter.dateFrom) continue;
    if (filter?.dateTo && dateDir > filter.dateTo) continue;

    const dirPath = path.join(baseDir, dateDir);
    const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.yaml'));

    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(dirPath, file), 'utf8');
        const entry = yaml.load(content) as WorkLogEntry;
        if (entry && entry.id) {
          entries.push(entry);
        }
      } catch {
        // Skip malformed files
      }
    }
  }

  // Apply filters
  let filtered = entries;

  if (filter?.agent) {
    filtered = filtered.filter(e => e.agent === filter.agent);
  }
  if (filter?.outcome) {
    filtered = filtered.filter(e => e.outcome === filter.outcome);
  }
  if (filter?.task_ref) {
    filtered = filtered.filter(e => e.task_ref === filter.task_ref);
  }
  if (filter?.symbol) {
    filtered = filtered.filter(e => e.symbols_touched?.includes(filter.symbol!));
  }

  // Sort newest first
  filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  if (filter?.limit) {
    filtered = filtered.slice(0, filter.limit);
  }

  return filtered;
}

export function loadWorkLogEntry(rootDir: string, id: string): WorkLogEntry | null {
  const baseDir = path.join(rootDir, WORK_LOG_DIR);
  if (!fs.existsSync(baseDir)) return null;

  // Extract date from ID format: WL-{agent}-{date}-{counter}
  const match = id.match(/WL-[^-]+-(\d{4}-\d{2}-\d{2})-/);
  if (match) {
    const filePath = path.join(baseDir, match[1], `${id}.yaml`);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return yaml.load(content) as WorkLogEntry;
    }
  }

  // Fallback: scan all directories
  const dateDirs = fs.readdirSync(baseDir, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const dir of dateDirs) {
    const filePath = path.join(baseDir, dir.name, `${id}.yaml`);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      return yaml.load(content) as WorkLogEntry;
    }
  }

  return null;
}

// ────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────

export function getWorkLogSummary(rootDir: string, days: number = 7): {
  total: number;
  byOutcome: Record<WorkOutcome, number>;
  byAgent: Record<string, number>;
  recentEntries: Array<{ id: string; agent: string; summary: string; outcome: WorkOutcome; timestamp: string }>;
} {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const dateFrom = cutoff.toISOString().slice(0, 10);

  const entries = loadWorkLogEntries(rootDir, { dateFrom });

  const byOutcome: Record<string, number> = { pass: 0, fail: 0, partial: 0, blocked: 0 };
  const byAgent: Record<string, number> = {};

  for (const e of entries) {
    byOutcome[e.outcome] = (byOutcome[e.outcome] || 0) + 1;
    byAgent[e.agent] = (byAgent[e.agent] || 0) + 1;
  }

  return {
    total: entries.length,
    byOutcome: byOutcome as Record<WorkOutcome, number>,
    byAgent,
    recentEntries: entries.slice(0, 10).map(e => ({
      id: e.id,
      agent: e.agent,
      summary: e.summary,
      outcome: e.outcome,
      timestamp: e.timestamp,
    })),
  };
}
