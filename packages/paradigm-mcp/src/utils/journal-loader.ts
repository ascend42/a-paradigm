/**
 * Learning Journal Loader — CRUD for the "what I learned" knowledge stream
 *
 * Storage: ~/.paradigm/agents/{agentId}/journal/LJ-{date}-{counter}.yaml
 * Audience: The agent itself. Its future self across sessions and projects.
 * Lifecycle: Durable — carries forward as long as the agent exists.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type { JournalEntry, JournalFilter, JournalTrigger } from '../types/knowledge-streams.js';

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

function getJournalDir(agentId: string): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(home, '.paradigm', 'agents', agentId, 'journal');
}

function generateJournalId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const time = now.toISOString().slice(11, 19).replace(/:/g, '');
  const counter = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
  return `LJ-${date}-${time}-${counter}`;
}

// ────────────────────────────────────────────────────────
// Write Operations
// ────────────────────────────────────────────────────────

export function recordJournalEntry(
  agentId: string,
  entry: Omit<JournalEntry, 'id' | 'timestamp' | 'agent'>
): JournalEntry {
  const now = new Date();
  const id = generateJournalId();

  const full: JournalEntry = {
    id,
    agent: agentId,
    timestamp: now.toISOString(),
    ...entry,
  };

  const dir = getJournalDir(agentId);
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `${id}.yaml`);
  fs.writeFileSync(filePath, yaml.dump(full, { lineWidth: 120, noRefs: true }), 'utf8');

  return full;
}

// ────────────────────────────────────────────────────────
// Read Operations
// ────────────────────────────────────────────────────────

export function loadJournalEntries(agentId: string, filter?: JournalFilter): JournalEntry[] {
  const dir = getJournalDir(agentId);
  if (!fs.existsSync(dir)) return [];

  const entries: JournalEntry[] = [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.yaml'));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file), 'utf8');
      const entry = yaml.load(content) as JournalEntry;
      if (entry && entry.id) {
        entries.push(entry);
      }
    } catch {
      // Skip malformed files
    }
  }

  // Apply filters
  let filtered = entries;

  if (filter?.trigger) {
    filtered = filtered.filter(e => e.trigger === filter.trigger);
  }
  if (filter?.project) {
    filtered = filtered.filter(e => e.project === filter.project);
  }
  if (filter?.transferable !== undefined) {
    filtered = filtered.filter(e => e.transferable === filter.transferable);
  }
  if (filter?.tag) {
    filtered = filtered.filter(e => e.tags?.some(t => t.startsWith(filter.tag!)));
  }
  if (filter?.dateFrom) {
    filtered = filtered.filter(e => e.timestamp >= filter.dateFrom!);
  }
  if (filter?.dateTo) {
    filtered = filtered.filter(e => e.timestamp <= filter.dateTo!);
  }

  // Sort newest first
  filtered.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  if (filter?.limit) {
    filtered = filtered.slice(0, filter.limit);
  }

  return filtered;
}

export function loadJournalEntry(agentId: string, id: string): JournalEntry | null {
  const dir = getJournalDir(agentId);
  const filePath = path.join(dir, `${id}.yaml`);

  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, 'utf8');
  return yaml.load(content) as JournalEntry;
}

/**
 * Load journal entries across ALL agents (for cross-agent learning analysis)
 */
export function loadAllJournalEntries(filter?: JournalFilter): JournalEntry[] {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const agentsDir = path.join(home, '.paradigm', 'agents');

  if (!fs.existsSync(agentsDir)) return [];

  const entries: JournalEntry[] = [];
  const agents = fs.readdirSync(agentsDir, { withFileTypes: true })
    .filter(d => d.isDirectory());

  for (const agentDir of agents) {
    if (filter?.agent && agentDir.name !== filter.agent) continue;
    const agentEntries = loadJournalEntries(agentDir.name, filter);
    entries.push(...agentEntries);
  }

  // Re-sort combined results
  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  if (filter?.limit) {
    return entries.slice(0, filter.limit);
  }

  return entries;
}

// ────────────────────────────────────────────────────────
// Analysis
// ────────────────────────────────────────────────────────

export function getJournalStats(agentId: string): {
  total: number;
  byTrigger: Record<string, number>;
  byProject: Record<string, number>;
  transferableCount: number;
  recentInsights: Array<{ id: string; trigger: JournalTrigger; insight: string; timestamp: string }>;
} {
  const entries = loadJournalEntries(agentId);

  const byTrigger: Record<string, number> = {};
  const byProject: Record<string, number> = {};
  let transferableCount = 0;

  for (const e of entries) {
    byTrigger[e.trigger] = (byTrigger[e.trigger] || 0) + 1;
    byProject[e.project] = (byProject[e.project] || 0) + 1;
    if (e.transferable) transferableCount++;
  }

  return {
    total: entries.length,
    byTrigger,
    byProject,
    transferableCount,
    recentInsights: entries.slice(0, 5).map(e => ({
      id: e.id,
      trigger: e.trigger,
      insight: e.insight.slice(0, 200),
      timestamp: e.timestamp,
    })),
  };
}
