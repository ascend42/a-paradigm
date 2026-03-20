/**
 * Decision Loader — CRUD for the "what we decided" knowledge stream
 *
 * Storage: .paradigm/decisions/TD-{date}-{counter}.yaml
 * Audience: Everyone — current team, future agents, institutional memory.
 * Lifecycle: Institutional — lasts as long as the decision is relevant.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type {
  TeamDecision,
  DecisionFilter,
  DecisionStatus,
} from '../types/knowledge-streams.js';

const DECISIONS_DIR = '.paradigm/decisions';

function generateDecisionId(): string {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const counter = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
  return `TD-${date}-${counter}`;
}

// ── Write Operations ──

export function recordDecision(
  rootDir: string,
  entry: Omit<TeamDecision, 'id' | 'timestamp'>
): TeamDecision {
  const now = new Date();
  const id = generateDecisionId();

  const full: TeamDecision = {
    id,
    timestamp: now.toISOString(),
    ...entry,
  };

  const dir = path.join(rootDir, DECISIONS_DIR);
  fs.mkdirSync(dir, { recursive: true });

  const filePath = path.join(dir, `${id}.yaml`);
  fs.writeFileSync(filePath, yaml.dump(full, { lineWidth: 120, noRefs: true }), 'utf8');

  return full;
}

export function updateDecision(
  rootDir: string,
  id: string,
  updates: Partial<Pick<TeamDecision, 'status' | 'superseded_by' | 'tags'>>
): TeamDecision | null {
  const existing = loadDecision(rootDir, id);
  if (!existing) return null;

  const updated = { ...existing, ...updates };

  const dir = path.join(rootDir, DECISIONS_DIR);
  const filePath = path.join(dir, `${id}.yaml`);
  fs.writeFileSync(filePath, yaml.dump(updated, { lineWidth: 120, noRefs: true }), 'utf8');

  return updated;
}

/**
 * Supersede an existing decision with a new one.
 * Marks the old decision as 'superseded' and links to the new one.
 */
export function supersedeDecision(
  rootDir: string,
  oldId: string,
  newEntry: Omit<TeamDecision, 'id' | 'timestamp'>
): { old: TeamDecision; new: TeamDecision } | null {
  const old = loadDecision(rootDir, oldId);
  if (!old) return null;

  const newDecision = recordDecision(rootDir, newEntry);
  const updatedOld = updateDecision(rootDir, oldId, {
    status: 'superseded',
    superseded_by: newDecision.id,
  });

  if (!updatedOld) return null;

  return { old: updatedOld, new: newDecision };
}

// ── Read Operations ──

export function loadDecisions(rootDir: string, filter?: DecisionFilter): TeamDecision[] {
  const dir = path.join(rootDir, DECISIONS_DIR);
  if (!fs.existsSync(dir)) return [];

  const entries: TeamDecision[] = [];
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.yaml'));

  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(dir, file), 'utf8');
      const entry = yaml.load(content) as TeamDecision;
      if (entry && entry.id) {
        entries.push(entry);
      }
    } catch {
      // Skip malformed files
    }
  }

  // Apply filters
  let filtered = entries;

  if (filter?.status) {
    filtered = filtered.filter(e => e.status === filter.status);
  }
  if (filter?.participant) {
    filtered = filtered.filter(e =>
      e.participants.some(p => p.id === filter.participant)
    );
  }
  if (filter?.symbol) {
    filtered = filtered.filter(e => e.symbols_affected?.includes(filter.symbol!));
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

export function loadDecision(rootDir: string, id: string): TeamDecision | null {
  const dir = path.join(rootDir, DECISIONS_DIR);
  const filePath = path.join(dir, `${id}.yaml`);

  if (!fs.existsSync(filePath)) return null;

  const content = fs.readFileSync(filePath, 'utf8');
  return yaml.load(content) as TeamDecision;
}

/**
 * Find active decisions that affect a given symbol.
 * Used by paradigm_ripple to surface relevant institutional decisions.
 */
export function findDecisionsForSymbol(rootDir: string, symbol: string): TeamDecision[] {
  return loadDecisions(rootDir, { symbol, status: 'active' });
}

// ── Summary ──

export function getDecisionSummary(rootDir: string): {
  total: number;
  active: number;
  superseded: number;
  deprecated: number;
  proposed: number;
  recentDecisions: Array<{ id: string; title: string; status: DecisionStatus; timestamp: string }>;
  symbolsCovered: string[];
} {
  const all = loadDecisions(rootDir);

  const byStatus: Record<string, number> = {};
  const symbols = new Set<string>();

  for (const d of all) {
    byStatus[d.status] = (byStatus[d.status] || 0) + 1;
    d.symbols_affected?.forEach(s => symbols.add(s));
  }

  return {
    total: all.length,
    active: byStatus['active'] || 0,
    superseded: byStatus['superseded'] || 0,
    deprecated: byStatus['deprecated'] || 0,
    proposed: byStatus['proposed'] || 0,
    recentDecisions: all.slice(0, 10).map(d => ({
      id: d.id,
      title: d.title,
      status: d.status,
      timestamp: d.timestamp,
    })),
    symbolsCovered: [...symbols].sort(),
  };
}
