/**
 * Falsifiable tests for the CLOSED learning loop (T-2026-06-13-004).
 *
 * These tests FAIL on the pre-fix behavior and pass after. The whole point of
 * the task was to make "broken" stop being byte-identical to "healthy":
 *
 *   1. Completing a STANDALONE (parentless) terminal task must produce a
 *      DISTINGUISHABLE postflight signal — a journal OR a postflight-noop{reason}
 *      row. Pre-fix, a solo completion fired NOTHING (updateTask only settled
 *      parented tasks), so postflight-liveness.jsonl never appeared → these
 *      assertions fail on the old code.
 *   2. Session-mined failure signals enter as FLOOR-TRUST provisional candidates
 *      staged in the journal — NOT auto-promoted into notebooks (gate preserved).
 *   3. The doctor learning-liveness metric has a REAL, non-null denominator.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

import { createTask, completeTask, loadTask } from './task-loader.js';
import {
  readPostflightLiveness,
  type PostflightLivenessRecord,
} from './session-work-log.js';
import { loadJournalEntries } from './journal-loader.js';
import { autoPromoteJournalEntries } from './nomination-engine.js';

let root: string;
let homeDir: string;
let priorHome: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-loop-test-'));
  // Isolate journal/notebook writes to a throwaway HOME (journal-loader keys
  // getJournalDir off process.env.HOME).
  homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-loop-home-'));
  priorHome = process.env.HOME;
  process.env.HOME = homeDir;
});

afterEach(() => {
  vi.restoreAllMocks();
  if (priorHome === undefined) delete process.env.HOME;
  else process.env.HOME = priorHome;
  for (const d of [root, homeDir]) {
    if (d && fs.existsSync(d)) fs.rmSync(d, { recursive: true, force: true });
  }
});

// ────────────────────────────────────────────────────────
// 1. The crux: a standalone completion leaves a distinguishable trace
// ────────────────────────────────────────────────────────

describe('standalone (parentless) task completion — the decoupled trigger', () => {
  it('produces a distinguishable postflight signal (FAILS pre-fix)', async () => {
    const solo = await createTask(root, { blurb: 'a standalone task, no parent' });

    // Pre-fix: this fired nothing. Post-fix: settleLeafTask runs the chain.
    await completeTask(root, solo);

    const records = readPostflightLiveness(root);
    // The falsifiable assertion: SOMETHING observable happened.
    expect(records.length).toBeGreaterThanOrEqual(1);

    // With no verdicts staged, the pass is a NOOP — but now a TRACEABLE one.
    const last = records[records.length - 1] as PostflightLivenessRecord;
    expect(last.journalsWritten).toBe(0);
    expect(last.type).toBe('postflight-noop');
    expect(last.reason).toBe('no-verdicts');
    expect(typeof last.sessionId).toBe('string');
    expect(last.sessionId.length).toBeGreaterThan(0);
  });

  it('stamps settledAt on the leaf (idempotent — no re-fire on a second pass)', async () => {
    const solo = await createTask(root, { blurb: 'solo' });
    await completeTask(root, solo);

    const settled = await loadTask(root, solo);
    expect(settled?.settledAt).toBeTruthy();

    const countAfterFirst = readPostflightLiveness(root).length;

    // Re-completing an already-terminal, already-settled task must not re-run
    // the chain (settledAt guard).
    const { settleLeafTask } = await import('./task-settlement.js');
    await settleLeafTask(root, settled!);
    expect(readPostflightLiveness(root).length).toBe(countAfterFirst);
  });
});

// ────────────────────────────────────────────────────────
// 2. Provisional intake lands in STAGING, never notebooks
// ────────────────────────────────────────────────────────

describe('provisional-candidate intake — floor trust, gate-preserving', () => {
  it('stages an overridden soft-block as a floor-trust journal entry, NOT a notebook', async () => {
    // Record a failure signal: an archetype's soft-block was overridden.
    const eventsDir = path.join(root, '.paradigm', 'events');
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.writeFileSync(
      path.join(eventsDir, 'overrides.jsonl'),
      JSON.stringify({
        timestamp: new Date().toISOString(),
        remediation_id: 'rmd-test-001',
        claimant: 'compliance',
        mechanism: 'cli',
      }) + '\n',
      'utf8',
    );

    // A standalone completion runs the session-boundary postflight pass, which
    // mines the override into a provisional candidate.
    const solo = await createTask(root, { blurb: 'trigger the boundary pass' });
    await completeTask(root, solo);

    // The candidate is a journal entry at the FLOOR trust tier.
    const journals = loadJournalEntries('compliance');
    const provisional = journals.filter(
      e => e.provenance?.trust === 'external' && e.tags?.includes('provisional-candidate'),
    );
    expect(provisional.length).toBe(1);
    expect(provisional[0].provenance?.source).toBe('external');
    // Non-promotable trigger — the gate, not auto-promotion, decides.
    expect(provisional[0].trigger).toBe('failure_analysis');

    // GATE PRESERVED: floor-trust provisional candidates never auto-promote.
    const promotion = autoPromoteJournalEntries(root, 'compliance');
    expect(promotion.promoted).toBe(0);
  });

  it('is idempotent — a second boundary pass does not re-stage the same override', async () => {
    const eventsDir = path.join(root, '.paradigm', 'events');
    fs.mkdirSync(eventsDir, { recursive: true });
    fs.writeFileSync(
      path.join(eventsDir, 'overrides.jsonl'),
      JSON.stringify({
        timestamp: '2026-08-31T00:00:00.000Z',
        remediation_id: 'rmd-idem-001',
        claimant: 'security',
        mechanism: 'env',
      }) + '\n',
      'utf8',
    );

    const a = await createTask(root, { blurb: 'first pass' });
    await completeTask(root, a);
    const b = await createTask(root, { blurb: 'second pass' });
    await completeTask(root, b);

    const staged = loadJournalEntries('security').filter(e =>
      e.tags?.includes('provisional-candidate'),
    );
    expect(staged.length).toBe(1);
  });
});

// ────────────────────────────────────────────────────────
// 3. The liveness metric has a real denominator
// ────────────────────────────────────────────────────────

describe('learning-liveness metric denominator', () => {
  it('records one countable completion per standalone settlement (non-null denominator)', async () => {
    for (let i = 0; i < 3; i++) {
      const t = await createTask(root, { blurb: `task ${i}` });
      await completeTask(root, t);
    }

    const records = readPostflightLiveness(root);
    // The doctor denominator = records.length. It is a REAL count, never null.
    expect(records.length).toBeGreaterThanOrEqual(3);
    const journals = records.reduce((n, r) => n + r.journalsWritten, 0);
    expect(journals).toBe(0); // flatline — but now OBSERVABLE, not silent
  });
});
