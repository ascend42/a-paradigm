/**
 * Tests for the v7.1 r4 promotion belief loop:
 *   (1) Open-loop fix — promotion persists `confidence` (from confidence_after)
 *       onto the notebook entry; a re-promote OVERWRITES (no max ratchet).
 *   (2) Instrument — autoPromoteJournalEntries appends a {before, after, delta,
 *       promoted} row to .paradigm/events/promotion-decisions.jsonl per candidate.
 *   (3) Gate is UNCHANGED — a 0.75 entry still does NOT promote, a 0.85 still does.
 *
 * Both the global notebook dir (os.homedir()) and the journal dir
 * (process.env.HOME) are steered to one mock-home temp dir so the require()-based
 * promotion path reads/writes inside our sandbox.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';

const shared = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const nodeFs = require('fs') as typeof import('fs');
  const nodePath = require('path') as typeof import('path');
  const nodeOs = require('os') as typeof import('os');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const mockHome = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'promo-mock-home-'));
  return { mockHome };
});

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => shared.mockHome,
  };
});

// Imported AFTER the mock so GLOBAL_NOTEBOOKS_DIR resolves to the mock home.
import { addNotebookEntry, loadNotebookEntries, notebookPrior } from './notebook-loader.js';
import { recordJournalEntry } from './journal-loader.js';
import { autoPromoteJournalEntries } from './nomination-engine.js';
import type { JournalEntry } from '../types/knowledge-streams.js';

const mockHome = shared.mockHome;

// ────────────────────────────────────────────────────────
// Setup — steer journal dir (process.env.HOME) to the same mock home,
// and use a temp rootDir for project-scoped event/notebook writes.
// ────────────────────────────────────────────────────────

let prevHome: string | undefined;
let rootDir: string;

beforeEach(() => {
  prevHome = process.env.HOME;
  process.env.HOME = mockHome;
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-root-'));
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  // Clean global notebook + journal subtrees written under the shared mock home.
  for (const sub of ['notebooks', 'agents']) {
    const dir = path.join(mockHome, '.paradigm', sub);
    if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  }
  if (rootDir && fs.existsSync(rootDir)) fs.rmSync(rootDir, { recursive: true, force: true });
});

afterAll(() => {
  if (fs.existsSync(mockHome)) fs.rmSync(mockHome, { recursive: true, force: true });
});

function makeJournalEntry(agentId: string, overrides: Partial<JournalEntry>): JournalEntry {
  return recordJournalEntry(agentId, {
    trigger: 'pattern_discovered',
    insight: overrides.insight ?? 'reuse the jwt middleware guard',
    confidence_after: overrides.confidence_after,
    project: overrides.project ?? 'test-proj',
    transferable: overrides.transferable ?? true,
    tags: overrides.tags ?? ['jwt-guard'],
    pattern: overrides.pattern,
  });
}

function readDecisions(): Array<Record<string, unknown>> {
  const filePath = path.join(rootDir, '.paradigm', 'events', 'promotion-decisions.jsonl');
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(l => JSON.parse(l));
}

// ────────────────────────────────────────────────────────
// Part 1 — addNotebookEntry persists confidence
// ────────────────────────────────────────────────────────

describe('addNotebookEntry confidence persistence', () => {
  it('persists an explicit confidence value', () => {
    const { entry } = addNotebookEntry(
      'kit',
      {
        context: 'ctx',
        snippet: 'snip',
        provenance: { source: 'lore', createdBy: 'kit' },
        concepts: ['alpha'],
        tags: [],
        confidence: 0.91,
      },
      'global',
    );
    expect(entry.confidence).toBe(0.91);
  });

  it('defaults confidence to 0.5 when a caller omits it (no silent undefined)', () => {
    const { entry } = addNotebookEntry(
      'kit',
      {
        context: 'ctx',
        snippet: 'snip',
        provenance: { source: 'lore', createdBy: 'kit' },
        concepts: ['beta'],
        tags: [],
      } as Parameters<typeof addNotebookEntry>[1],
      'global',
    );
    expect(entry.confidence).toBe(0.5);
    expect(typeof entry.confidence).toBe('number');
  });
});

// ────────────────────────────────────────────────────────
// Part 1 — promotion writes confidence_after into the notebook; re-promote OVERWRITES
// ────────────────────────────────────────────────────────

describe('autoPromoteJournalEntries confidence loop (open-loop fix)', () => {
  it('persists entry.confidence_after onto the promoted notebook entry', () => {
    makeJournalEntry('kit', { confidence_after: 0.85, tags: ['jwt-guard'] });

    const res = autoPromoteJournalEntries(rootDir, 'kit');
    expect(res.promoted).toBe(1);

    const nb = loadNotebookEntries('kit', rootDir, { concepts: ['jwt-guard'] });
    expect(nb).toHaveLength(1);
    expect(nb[0].confidence).toBe(0.85);
  });

  it('re-promote OVERWRITES with the newest confidence_after (no max ratchet)', () => {
    // First promotion at high confidence.
    makeJournalEntry('kit', { confidence_after: 0.95, tags: ['jwt-guard'] });
    autoPromoteJournalEntries(rootDir, 'kit');

    let nb = loadNotebookEntries('kit', rootDir, { concepts: ['jwt-guard'] });
    expect(nb[0].confidence).toBe(0.95);

    // Second promotion of the SAME concept at a LOWER (but still promoting) value.
    // Same first-concept slug → same deterministic notebook id → overwrite.
    makeJournalEntry('kit', { confidence_after: 0.82, tags: ['jwt-guard'] });
    autoPromoteJournalEntries(rootDir, 'kit');

    nb = loadNotebookEntries('kit', rootDir, { concepts: ['jwt-guard'] });
    expect(nb).toHaveLength(1);
    // Latest measurement wins. If a max() ratchet existed, this would be 0.95.
    expect(nb[0].confidence).toBe(0.82);
    expect(nb[0].confidence).not.toBe(0.95);
  });
});

// ────────────────────────────────────────────────────────
// notebookPrior helper
// ────────────────────────────────────────────────────────

describe('notebookPrior', () => {
  it('returns DEFAULT_PRIOR with found=false when no notebook entry matches', () => {
    const prior = notebookPrior('kit', ['unknown-concept'], rootDir);
    expect(prior.value).toBe(0.5);
    expect(prior.found).toBe(false);
  });

  it('returns the max matching confidence with found=true', () => {
    addNotebookEntry(
      'kit',
      {
        context: 'c', snippet: 's',
        provenance: { source: 'lore', createdBy: 'kit' },
        concepts: ['jwt-guard'], tags: [], confidence: 0.7,
      },
      'global',
    );
    const prior = notebookPrior('kit', ['jwt-guard'], rootDir);
    expect(prior.value).toBe(0.7);
    expect(prior.found).toBe(true);
  });
});

// ────────────────────────────────────────────────────────
// Part 2 — instrument appends a decision row
// ────────────────────────────────────────────────────────

describe('promotion-decisions instrument', () => {
  it('appends one row with correct before/after/delta/promoted for a promoting entry', () => {
    makeJournalEntry('kit', { confidence_after: 0.85, tags: ['jwt-guard'] });

    autoPromoteJournalEntries(rootDir, 'kit');

    const rows = readDecisions();
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.agent).toBe('kit');
    expect(row.concepts).toEqual(['jwt-guard']);
    expect(row.before).toBe(0.5); // no prior on first promotion → DEFAULT_PRIOR
    expect(row.priorFound).toBe(false);
    expect(row.after).toBe(0.85);
    expect(row.delta).toBeCloseTo(0.35, 10);
    expect(row.promoted).toBe(true);
    expect(row.gate).toBe('absolute-0.8');
    expect(typeof row.ts).toBe('string');
  });

  it('records promoted=false for a sub-threshold entry but still appends a row', () => {
    makeJournalEntry('kit', { confidence_after: 0.6, tags: ['low-thing'] });

    autoPromoteJournalEntries(rootDir, 'kit');

    const rows = readDecisions();
    expect(rows).toHaveLength(1);
    expect(rows[0].promoted).toBe(false);
    expect(rows[0].after).toBe(0.6);
    expect(rows[0].delta).toBeCloseTo(0.1, 10);
  });

  it('measures a real prior on the second promotion (priorFound=true)', () => {
    makeJournalEntry('kit', { confidence_after: 0.9, tags: ['jwt-guard'] });
    autoPromoteJournalEntries(rootDir, 'kit');

    makeJournalEntry('kit', { confidence_after: 0.82, tags: ['jwt-guard'] });
    autoPromoteJournalEntries(rootDir, 'kit');

    const rows = readDecisions();
    // 2 candidates over 2 runs → 2 rows.
    expect(rows.length).toBe(2);
    const second = rows[1];
    expect(second.priorFound).toBe(true);
    expect(second.before).toBe(0.9); // prior = max existing confidence
    expect(second.after).toBe(0.82);
    expect(second.delta).toBeCloseTo(-0.08, 10); // delta can be negative; recorded, not gated
    expect(second.promoted).toBe(true); // absolute gate still passes
  });
});

// ────────────────────────────────────────────────────────
// Part 3 — absolute gate is UNCHANGED (regression lock for the deferral)
// ────────────────────────────────────────────────────────

describe('absolute promotion gate is unchanged (deferral regression lock)', () => {
  it('does NOT promote a 0.75 entry', () => {
    makeJournalEntry('kit', { confidence_after: 0.75, tags: ['below-bar'] });

    const res = autoPromoteJournalEntries(rootDir, 'kit');
    expect(res.promoted).toBe(0);

    const nb = loadNotebookEntries('kit', rootDir, { concepts: ['below-bar'] });
    expect(nb).toHaveLength(0);

    // Instrument still observed the (negative) decision.
    const rows = readDecisions();
    expect(rows).toHaveLength(1);
    expect(rows[0].promoted).toBe(false);
  });

  it('DOES promote a 0.85 entry', () => {
    makeJournalEntry('kit', { confidence_after: 0.85, tags: ['above-bar'] });

    const res = autoPromoteJournalEntries(rootDir, 'kit');
    expect(res.promoted).toBe(1);

    const nb = loadNotebookEntries('kit', rootDir, { concepts: ['above-bar'] });
    expect(nb).toHaveLength(1);

    const rows = readDecisions();
    expect(rows[0].promoted).toBe(true);
  });

  it('promotes exactly at the 0.8 boundary (>= 0.8)', () => {
    makeJournalEntry('kit', { confidence_after: 0.8, tags: ['on-bar'] });

    const res = autoPromoteJournalEntries(rootDir, 'kit');
    expect(res.promoted).toBe(1);
  });
});
