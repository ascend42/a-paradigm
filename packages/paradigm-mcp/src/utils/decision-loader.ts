/**
 * Decision Loader — CRUD for the "what we decided" knowledge stream
 *
 * Storage: .paradigm/decisions/TD-{date}-{counter}.yaml
 * Audience: Everyone — current team, future agents, institutional memory.
 * Lifecycle: Institutional — lasts as long as the decision is relevant.
 *
 * v6.0 additions (sub-phase 1):
 *   - Read/write path accepts absorbed ADR fields on TeamDecision:
 *     context, consequences, date, migrated_from, supersedes[].
 *     All optional; existing shape preserved.
 *   - Exposes `writeCompanionLoreEntry(decisionId, rootDir)` helper for
 *     the companion-lore-write pattern (D3). Not yet wired into
 *     recordDecision — sub-phase 2 will wire the consumer.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import type {
  TeamDecision,
  DecisionFilter,
  DecisionStatus,
} from '../types/knowledge-streams.js';
import { log } from './mcp-logger.js';

const DECISIONS_DIR = '.paradigm/decisions';
const LORE_DIR = '.paradigm/lore';

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

/**
 * Fields that `updateDecision` accepts. Extended in v6.0 to cover the
 * absorbed ADR fields so callers can mutate them post-record (e.g. the
 * migration script sets `migrated_from`; supersession may backfill
 * `supersedes[]`).
 */
export type UpdatableDecisionFields = Partial<Pick<TeamDecision,
  | 'status'
  | 'superseded_by'
  | 'tags'
  | 'context'
  | 'consequences'
  | 'date'
  | 'migrated_from'
  | 'supersedes'
>>;

export function updateDecision(
  rootDir: string,
  id: string,
  updates: UpdatableDecisionFields
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
 *
 * v6.0: also backfills `supersedes[]` on the new decision (D2 Loid addendum —
 * enables bidirectional graph traversal without a separate index).
 */
export function supersedeDecision(
  rootDir: string,
  oldId: string,
  newEntry: Omit<TeamDecision, 'id' | 'timestamp'>
): { old: TeamDecision; new: TeamDecision } | null {
  const old = loadDecision(rootDir, oldId);
  if (!old) return null;

  // Ensure the new entry records that it supersedes the old one (D2 addendum)
  const mergedSupersedes = Array.from(new Set([...(newEntry.supersedes ?? []), oldId]));
  const newDecision = recordDecision(rootDir, { ...newEntry, supersedes: mergedSupersedes });

  const updatedOld = updateDecision(rootDir, oldId, {
    status: 'superseded',
    superseded_by: newDecision.id,
  });

  if (!updatedOld) return null;

  return { old: updatedOld, new: newDecision };
}

/**
 * Write a companion lore entry for a newly-recorded decision (D3 locked).
 *
 * The lore entry has `type: 'insight'` and `references.decision_id` pointing
 * at the canonical decision. Lore keeps its role as the immutable narrative
 * timeline; the structured decision lives in .paradigm/decisions/.
 *
 * Exposed in sub-phase 1. Not yet wired into `recordDecision` — the consumer
 * wiring (tools/decision.ts) happens in sub-phase 2 so the companion write
 * is a single well-defined call site rather than a loader side effect.
 *
 * Returns the written lore entry id, or null on any failure (best-effort —
 * companion writes must never block decision recording).
 */
export function writeCompanionLoreEntry(rootDir: string, decisionId: string): string | null {
  try {
    const decision = loadDecision(rootDir, decisionId);
    if (!decision) return null;

    const today = new Date().toISOString().slice(0, 10);
    const author = process.env.USER || process.env.USERNAME || 'unknown';
    const counter = String(Math.floor(Math.random() * 999) + 1).padStart(3, '0');
    const hhmmss = new Date().toISOString().slice(11, 19).replace(/:/g, '');
    const loreId = `L-${today}-${author}-${hhmmss}-${counter}`;

    const loreEntry = {
      id: loreId,
      type: 'insight',
      timestamp: new Date().toISOString(),
      author,
      title: `Decision ${decision.id} recorded`,
      summary: `Companion lore entry for decision record ${decision.id}. See .paradigm/decisions/${decision.id}.yaml.`,
      symbols_touched: decision.symbols_affected || [],
      references: {
        decision_id: decision.id,
      },
      tags: ['companion-lore', 'decision-reference'],
    };

    const loreEntriesDir = path.join(rootDir, LORE_DIR, 'entries', today);
    fs.mkdirSync(loreEntriesDir, { recursive: true });
    const filePath = path.join(loreEntriesDir, `${loreId}.lore`);
    fs.writeFileSync(filePath, yaml.dump(loreEntry, { lineWidth: 120, noRefs: true }), 'utf8');

    return loreId;
  } catch (err) {
    log.component('#decision-loader').warn('companion lore write failed', {
      error: (err as Error).message,
      decisionId,
    });
    return null;
  }
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
