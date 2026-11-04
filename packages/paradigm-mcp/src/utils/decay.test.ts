/**
 * The Classroom — the DECAY PASS, gated by exercise (TD-2026-06-19-007,
 * TD-2026-07-01-401, T-2026-11-03-001).
 *
 * The one principle: wall-clock time may DECAY confidence but never MINT
 * evidence. These tests prove:
 *   - an aged pending cert with NO exercise evidence does NOT survive; it is
 *     reported `unproven` and the row stays pending;
 *   - an aged cert that cleared the floor (>= K_MIN_EXERCISE receipts, >= 1
 *     adversarial probe) survives, stamped with the exercise that minted it;
 *   - passive apply-and-held alone, pre-cert receipts and receipts from an
 *     orchestration that broke the entry never count;
 *   - survival does not wait on age: a young cert that clears the floor
 *     survives at once; the window only labels `unproven`;
 *   - SPEC §1 GUARD: a fixture that clears the floor at t0 survives at t0, then
 *     with activity frozen and the clock advanced Δsurvived == 0 (and a
 *     separate zero-probe case);
 *   - a break from before the cert does not block its re-cert (F8);
 *   - the summary logs the unproven delta, not the same count each pass;
 *   - overturn wins; the pass is idempotent;
 *   - METRIC HONESTY: 1 overturned + 3 exercised survivors ⇒ rate 0.25, and a
 *     legacy aged-only `survived` row reads `unproven` under requireExercise;
 *   - UNUSED DECAY: an entry idle past the idle window loses a bit of confidence;
 *     a recently-applied entry does not.
 *
 * notebook-loader.ts resolves GLOBAL_NOTEBOOKS_DIR at module-load via os.homedir().
 * We mock os.homedir() BEFORE importing the module so the global notebook area
 * resolves into a temp dir (the fixtures use PROJECT scope, but the mock keeps the
 * test off the developer's real ~/.paradigm/notebooks).
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
  const mockHome = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'decay-mock-home-'));
  return { mockHome };
});

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => shared.mockHome };
});

// Imported AFTER the os mock.
import { runDecayPass, decayPassLogLevel, SURVIVAL_WINDOW_DAYS } from './decay.js';
import {
  appendClassroomCertification,
  readClassroomCertifications,
  appendFieldFailure,
  appendExerciseEvents,
  surviveCertification,
  certEvidenceState,
  makeFailureId,
  K_MIN_EXERCISE,
  type ClassroomCertRow,
  type ExerciseEvent,
  type FieldFailureRow,
} from './field-failures.js';
// The metric lives in premise-core (the canonical rollup). We prove honesty
// through the SAME ledger the decay pass writes.
import {
  computeRepeatFailureRate,
  readClassroomCertifications as readCertsForRollup,
} from '@a-company/premise-core';
import type { NotebookEntry } from '../types/notebooks.js';

// ────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────

let projectDir: string;
const globalNotebooksBase = path.join(shared.mockHome, '.paradigm', 'notebooks');

const AGENT = 'decay-agent';
const NOW = Date.parse('2026-06-22T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

/** An ISO timestamp `days` before NOW. */
function daysAgo(days: number): string {
  return new Date(NOW - days * DAY).toISOString();
}

function makeEntry(overrides: Partial<NotebookEntry> = {}): NotebookEntry {
  return {
    id: overrides.id ?? 'nb-decay-agent-x',
    context: overrides.context ?? 'When doing X',
    snippet: overrides.snippet ?? 'doX()',
    provenance: overrides.provenance ?? { source: 'lore' },
    appliedCount: overrides.appliedCount ?? 1,
    confidence: overrides.confidence ?? 0.8,
    concepts: overrides.concepts ?? ['x'],
    tags: overrides.tags ?? ['pattern'],
    created: overrides.created ?? '2026-01-01T00:00:00.000Z',
    updated: overrides.updated ?? '2026-01-01T00:00:00.000Z',
    lastAppliedAt: overrides.lastAppliedAt,
  };
}

function writeProjectNotebook(entry: NotebookEntry): string {
  const agentDir = path.join(projectDir, '.paradigm', 'notebooks', AGENT);
  fs.mkdirSync(agentDir, { recursive: true });
  const filePath = path.join(agentDir, `${entry.id}.yaml`);
  fs.writeFileSync(filePath, yaml.dump(entry, { lineWidth: 120, noRefs: true }));
  return filePath;
}

function readProjectNotebook(entryId: string): NotebookEntry {
  const filePath = path.join(projectDir, '.paradigm', 'notebooks', AGENT, `${entryId}.yaml`);
  return yaml.load(fs.readFileSync(filePath, 'utf-8')) as NotebookEntry;
}

function pendingCert(overrides: Partial<ClassroomCertRow> = {}): ClassroomCertRow {
  return {
    ts: overrides.ts ?? daysAgo(20), // aged past the survival window by default
    agent: overrides.agent ?? AGENT,
    entryId: overrides.entryId ?? 'nb-decay-agent-x',
    concepts: overrides.concepts ?? ['x'],
    confidenceAtCert: overrides.confidenceAtCert ?? 0.8,
    certifiedBy: overrides.certifiedBy ?? 'gate',
    outcome: overrides.outcome ?? 'pending',
  };
}

/** Exercise receipts for `entryId`: `apps` application holds + `probes` adversarial probes. */
function exercise(entryId: string, apps: number, probes: number, atDaysAgo = 10): void {
  const rows: ExerciseEvent[] = [];
  for (let i = 0; i < apps; i++) {
    rows.push({ ts: daysAgo(atDaysAgo), certEntryId: entryId, orchestrationId: `orch-app-${entryId}-${i}`, agent: AGENT, kind: 'application' });
  }
  for (let i = 0; i < probes; i++) {
    rows.push({ ts: daysAgo(atDaysAgo), certEntryId: entryId, orchestrationId: `sc-run-${entryId}-${i}`, agent: AGENT, kind: 'adversarial-probe' });
  }
  appendExerciseEvents(projectDir, rows);
}

function fieldFailure(entryId: string): FieldFailureRow {
  return {
    ts: daysAgo(1),
    orchestrationId: 'orch-1',
    agent: AGENT,
    signal: 'reviewer-reject',
    severity: 'high',
    attributedEntryIds: [entryId],
    symbols: [],
    detail: 'broke',
    sourceEvent: 'verdict:dismissed',
  };
}

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decay-project-'));
  if (fs.existsSync(globalNotebooksBase)) {
    fs.rmSync(globalNotebooksBase, { recursive: true, force: true });
  }
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(shared.mockHome, { recursive: true, force: true });
});

// ────────────────────────────────────────────────────────
// 1. SURVIVED FLIP
// ────────────────────────────────────────────────────────

describe('runDecayPass — survival is minted by exercise, never by time', () => {
  it('an aged pending cert with NO exercise does NOT survive: it is unproven and stays pending', () => {
    appendClassroomCertification(projectDir, pendingCert({ ts: daysAgo(20) }));

    const result = runDecayPass(projectDir, { now: NOW });

    expect(result.certsSurvived).toBe(0);
    expect(result.certsUnproven).toBe(1);
    const certs = readClassroomCertifications(projectDir);
    expect(certs).toHaveLength(1);
    expect(certs[0].outcome).toBe('pending');
    expect(certs[0].survivedAt).toBeUndefined();
    expect(certEvidenceState(certs[0], { now: NOW, survivalWindowDays: SURVIVAL_WINDOW_DAYS })).toBe('unproven');
  });

  it('an aged cert that cleared the floor survives, stamped with the exercise that minted it', () => {
    appendClassroomCertification(projectDir, pendingCert({ ts: daysAgo(20) }));
    exercise('nb-decay-agent-x', 1, 1); // 2 receipts, 1 adversarial probe

    const result = runDecayPass(projectDir, { now: NOW });

    expect(result.certsSurvived).toBe(1);
    expect(result.certsUnproven).toBe(0);
    const [cert] = readClassroomCertifications(projectDir);
    expect(cert.outcome).toBe('survived');
    expect(cert.survivedAt).toBeTruthy();
    expect(cert.exercise).toMatchObject({ timesExercised: 2, adversarialProbes: 1 });
    expect(certEvidenceState(cert, { now: NOW, survivalWindowDays: SURVIVAL_WINDOW_DAYS })).toBe('survived');
  });

  it('passive apply-and-held alone (no adversarial probe) cannot mint survival', () => {
    appendClassroomCertification(projectDir, pendingCert({ ts: daysAgo(20) }));
    exercise('nb-decay-agent-x', 5, 0);

    expect(runDecayPass(projectDir, { now: NOW }).certsSurvived).toBe(0);
    expect(readClassroomCertifications(projectDir)[0].outcome).toBe('pending');
  });

  it('one receipt counts once, however many rows it has', () => {
    appendClassroomCertification(projectDir, pendingCert({ ts: daysAgo(20) }));
    const row: ExerciseEvent = { ts: daysAgo(5), certEntryId: 'nb-decay-agent-x', orchestrationId: 'sc-run-1', agent: AGENT, kind: 'adversarial-probe' };
    appendExerciseEvents(projectDir, [row, row, row]);

    expect(runDecayPass(projectDir, { now: NOW }).certsSurvived).toBe(0);
  });

  it('receipts from before the cert, or from an orchestration that broke the entry, do not count', () => {
    appendClassroomCertification(projectDir, pendingCert({ ts: daysAgo(20) }));
    exercise('nb-decay-agent-x', 1, 1, 30); // before the cert
    // A confounded break in a probe's orchestration: it is not a demonstrated hold.
    appendExerciseEvents(projectDir, [
      { ts: daysAgo(5), certEntryId: 'nb-decay-agent-x', orchestrationId: 'orch-broke', agent: AGENT, kind: 'adversarial-probe' },
      { ts: daysAgo(5), certEntryId: 'nb-decay-agent-x', orchestrationId: 'orch-held', agent: AGENT, kind: 'application' },
    ]);
    appendFieldFailure(projectDir, {
      ...fieldFailure('nb-decay-agent-x'),
      orchestrationId: 'orch-broke',
      attributedEntryIds: ['nb-decay-agent-x', 'nb-decay-agent-y'],
      attribution: 'confounded',
    });

    expect(runDecayPass(projectDir, { now: NOW }).certsSurvived).toBe(0);
    expect(readClassroomCertifications(projectDir)[0].outcome).toBe('pending');
  });

  it('rows without a join receipt are never written', () => {
    appendExerciseEvents(projectDir, [{ ts: daysAgo(1), certEntryId: 'nb-decay-agent-x', orchestrationId: '', agent: AGENT, kind: 'adversarial-probe' }]);
    expect(fs.existsSync(path.join(projectDir, '.paradigm', 'events', 'classroom-exercises.jsonl'))).toBe(false);
  });

  it('F7: the exercises ledger is a source of truth and is never pruned', () => {
    const rows: ExerciseEvent[] = [];
    for (let i = 0; i < 620; i++) {
      rows.push({ ts: daysAgo(1), certEntryId: 'nb-decay-agent-x', orchestrationId: `orch-${i}`, agent: AGENT, kind: 'application' });
    }
    appendExerciseEvents(projectDir, rows);
    appendExerciseEvents(projectDir, [{ ts: daysAgo(1), certEntryId: 'nb-decay-agent-x', orchestrationId: 'orch-last', agent: AGENT, kind: 'application' }]);
    const file = path.join(projectDir, '.paradigm', 'events', 'classroom-exercises.jsonl');
    expect(fs.readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(621);
  });

  it('Loid re-review: field-failures is never pruned, so the FIRST break still blocks survival after 600 later rows', () => {
    const entryId = 'nb-decay-agent-x';
    appendClassroomCertification(projectDir, pendingCert({ entryId, ts: daysAgo(5) }));
    appendFieldFailure(projectDir, { ...fieldFailure(entryId), ts: daysAgo(3), orchestrationId: 'orch-first-break' });
    for (let i = 0; i < 600; i++) {
      appendFieldFailure(projectDir, { ...fieldFailure('nb-someone-else'), ts: daysAgo(2), orchestrationId: `orch-noise-${i}` });
    }
    const file = path.join(projectDir, '.paradigm', 'events', 'field-failures.jsonl');
    expect(fs.readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(601);
    exercise(entryId, K_MIN_EXERCISE + 1, 1, 1); // clears the floor after the break
    expect(surviveCertification(projectDir, entryId)).toBe(false);
    expect(readClassroomCertifications(projectDir)[0].outcome).toBe('pending');
  });

  it('surviveCertification is gated for EVERY caller, not just the decay pass', () => {
    appendClassroomCertification(projectDir, pendingCert({ ts: daysAgo(400) }));
    expect(surviveCertification(projectDir, 'nb-decay-agent-x')).toBe(false);
    expect(readClassroomCertifications(projectDir)[0].outcome).toBe('pending');
  });

  it('SPEC §1 GUARD: a cert that clears the floor at t0 survives at t0; freezing activity and advancing the clock adds nothing', () => {
    // Fixtures that ALREADY clear the floor at t0 (young certs, exercised now).
    for (const id of ['nb-decay-agent-a', 'nb-decay-agent-b']) {
      appendClassroomCertification(projectDir, pendingCert({ entryId: id, ts: daysAgo(1) }));
      exercise(id, K_MIN_EXERCISE, 1, 0);
    }
    // And one that does not (applications only): it must never survive.
    appendClassroomCertification(projectDir, pendingCert({ entryId: 'nb-decay-agent-c', ts: daysAgo(1) }));
    exercise('nb-decay-agent-c', K_MIN_EXERCISE + 3, 0, 0);
    const survivedCount = () => readClassroomCertifications(projectDir).filter(c => c.outcome === 'survived').length;

    // t0: survival does not wait on age, so the evidenced certs may survive NOW.
    const atT0 = runDecayPass(projectDir, { now: NOW });
    expect(atT0.certsSurvived).toBe(2);
    const afterT0 = survivedCount();
    expect(afterT0).toBe(2);

    // Activity is frozen: no new exercise rows. Only the clock moves.
    for (const days of [SURVIVAL_WINDOW_DAYS + 1, 60, 365, 3650]) {
      runDecayPass(projectDir, { now: NOW + days * DAY });
    }

    expect(survivedCount() - afterT0).toBe(0);
    expect(readClassroomCertifications(projectDir).find(c => c.entryId === 'nb-decay-agent-c')?.outcome).toBe('pending');
  });

  it('SPEC §1 GUARD (zero probes): applications only, clock advanced past the window, Δsurvived == 0', () => {
    for (const id of ['nb-decay-agent-a', 'nb-decay-agent-b', 'nb-decay-agent-c']) {
      appendClassroomCertification(projectDir, pendingCert({ entryId: id, ts: daysAgo(1) }));
      exercise(id, K_MIN_EXERCISE + 3, 0, 0);
    }
    const survivedCount = () => readClassroomCertifications(projectDir).filter(c => c.outcome === 'survived').length;
    const before = survivedCount();

    for (const days of [0, SURVIVAL_WINDOW_DAYS + 1, 60, 365, 3650]) {
      runDecayPass(projectDir, { now: NOW + days * DAY });
    }

    expect(survivedCount() - before).toBe(0);
  });

  it('survival does not wait on age: a pending cert younger than the window that cleared the floor survives', () => {
    appendClassroomCertification(projectDir, pendingCert({ ts: daysAgo(3) }));
    exercise('nb-decay-agent-x', 1, 1, 1);

    const result = runDecayPass(projectDir, { now: NOW });

    expect(result.certsSurvived).toBe(1);
    expect(result.certsUnproven).toBe(0);
    expect(readClassroomCertifications(projectDir)[0].outcome).toBe('survived');
  });

  it('a young pending cert that misses the floor is neither survived nor counted unproven', () => {
    appendClassroomCertification(projectDir, pendingCert({ ts: daysAgo(3) }));

    const result = runDecayPass(projectDir, { now: NOW });

    expect(result.certsSurvived).toBe(0);
    expect(result.certsUnproven).toBe(0);
    expect(readClassroomCertifications(projectDir)[0].outcome).toBe('pending');
  });

  it('an attributable break from BEFORE the cert (it overturned an earlier cert) does not block the re-cert', () => {
    const entryId = 'nb-decay-agent-x';
    // Earlier cert, overturned by a break 30 days ago.
    appendClassroomCertification(projectDir, { ...pendingCert({ entryId, ts: daysAgo(40) }), outcome: 'overturned' });
    appendFieldFailure(projectDir, { ...fieldFailure(entryId), ts: daysAgo(30), orchestrationId: 'orch-old' });
    // Re-certified 20 days ago, then exercised past the floor.
    appendClassroomCertification(projectDir, pendingCert({ entryId, ts: daysAgo(20) }));
    exercise(entryId, 1, 1);

    const result = runDecayPass(projectDir, { now: NOW });

    expect(result.certsSurvived).toBe(1);
    expect(readClassroomCertifications(projectDir).map(c => c.outcome)).toEqual(['overturned', 'survived']);
  });

  it('does NOT flip to survived when an attributed break exists (overturn wins)', () => {
    const entryId = 'nb-decay-agent-x';
    appendClassroomCertification(projectDir, pendingCert({ ts: daysAgo(20), entryId }));
    exercise(entryId, 1, 1);
    // A break landed on this entry → it must NOT be treated as a survivor.
    appendFieldFailure(projectDir, fieldFailure(entryId));

    const result = runDecayPass(projectDir, { now: NOW });

    expect(result.certsSurvived).toBe(0);
    expect(readClassroomCertifications(projectDir)[0].outcome).toBe('pending');
  });

  it('is idempotent across two decay runs (no double flip)', () => {
    appendClassroomCertification(projectDir, pendingCert({ ts: daysAgo(20) }));
    exercise('nb-decay-agent-x', 1, 1);

    const first = runDecayPass(projectDir, { now: NOW });
    expect(first.certsSurvived).toBe(1);

    const second = runDecayPass(projectDir, { now: NOW });
    expect(second.certsSurvived).toBe(0);

    const survived = readClassroomCertifications(projectDir).filter(c => c.outcome === 'survived');
    expect(survived).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────
// 2. METRIC HONESTY — the 0.25 proof
// ────────────────────────────────────────────────────────

describe('runDecayPass — metric honesty (the denominator is real)', () => {
  it('1 overturned + 3 exercised survivors ⇒ repeat-failure-rate = 0.25 (not 1.0)', () => {
    const overturnedEntry = 'nb-decay-agent-broke';
    appendClassroomCertification(projectDir, {
      ...pendingCert({ entryId: overturnedEntry, ts: daysAgo(20) }),
      outcome: 'overturned',
      overturnedByFailureId: makeFailureId('orch-1', overturnedEntry),
      boundAt: daysAgo(2),
    });

    // Three pending certs aged past the window, each exercised past the floor.
    for (const id of ['nb-decay-agent-a', 'nb-decay-agent-b', 'nb-decay-agent-c']) {
      appendClassroomCertification(projectDir, pendingCert({ entryId: id, ts: daysAgo(20) }));
      exercise(id, 1, 1);
    }

    const before = computeRepeatFailureRate(readCertsForRollup(projectDir), { requireExercise: true });
    expect(before.overall).toBe(1);

    const result = runDecayPass(projectDir, { now: NOW });
    expect(result.certsSurvived).toBe(3);

    const after = computeRepeatFailureRate(readCertsForRollup(projectDir), { requireExercise: true });
    expect(after.overall).toBe(0.25);
    expect(after.perAgent[AGENT].resolved).toBe(4);
    expect(after.perAgent[AGENT].overturned).toBe(1);
    expect(after.perAgent[AGENT].rate).toBe(0.25);
    expect(after.unproven).toBe(0);
  });

  it('a legacy aged-only `survived` row stays as written but reads unproven', () => {
    // Written by the pre-gate timer: survived with no exercise counters.
    appendClassroomCertification(projectDir, {
      ...pendingCert({ entryId: 'nb-decay-agent-legacy', ts: daysAgo(40) }),
      outcome: 'survived',
      survivedAt: daysAgo(20),
    });
    appendClassroomCertification(projectDir, {
      ...pendingCert({ entryId: 'nb-decay-agent-broke', ts: daysAgo(40) }),
      outcome: 'overturned',
    });

    runDecayPass(projectDir, { now: NOW });
    const [legacy] = readClassroomCertifications(projectDir);
    expect(legacy.outcome).toBe('survived'); // no data migration
    expect(certEvidenceState(legacy, { now: NOW, survivalWindowDays: SURVIVAL_WINDOW_DAYS })).toBe('unproven');

    const r = computeRepeatFailureRate(readCertsForRollup(projectDir), { requireExercise: true });
    expect(r.perAgent[AGENT]).toMatchObject({ resolved: 1, overturned: 1, rate: 1, unproven: 1 });
  });
});

describe('runDecayPass — logs the unproven delta, not the same count every pass (ruling 6)', () => {
  it('decayPassLogLevel: info on change, debug on the same count, none when idle', () => {
    const r = (certsSurvived: number, certsUnproven: number, entriesDecayed = 0) => ({ certsSurvived, certsUnproven, entriesDecayed });
    expect(decayPassLogLevel(r(0, 2), undefined)).toBe('info');
    expect(decayPassLogLevel(r(0, 2), 2)).toBe('debug');
    expect(decayPassLogLevel(r(0, 3), 2)).toBe('info');
    expect(decayPassLogLevel(r(1, 2), 2)).toBe('info');
    expect(decayPassLogLevel(r(0, 0), 0)).toBe('none');
    expect(decayPassLogLevel(r(0, 0), 2)).toBe('info');
  });

  it('two identical passes over one root log the summary at info only once', () => {
    appendClassroomCertification(projectDir, pendingCert({ ts: daysAgo(20) }));
    const writes: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    });
    try {
      runDecayPass(projectDir, { now: NOW });
      runDecayPass(projectDir, { now: NOW });
      runDecayPass(projectDir, { now: NOW });
    } finally {
      spy.mockRestore();
    }
    expect(writes.filter(w => w.includes('decay pass complete'))).toHaveLength(1);
  });
});

describe('paradigm_classroom_status — reads unproven honestly', () => {
  it('splits pending / unproven / survived and keeps legacy aged-only survivals out of the rate', async () => {
    const now = Date.now();
    const ago = (d: number) => new Date(now - d * DAY).toISOString();
    appendClassroomCertification(projectDir, pendingCert({ entryId: 'nb-young', ts: ago(1) }));
    appendClassroomCertification(projectDir, pendingCert({ entryId: 'nb-aged', ts: ago(40) }));
    appendClassroomCertification(projectDir, { ...pendingCert({ entryId: 'nb-legacy', ts: ago(40) }), outcome: 'survived', survivedAt: ago(20) });
    appendClassroomCertification(projectDir, {
      ...pendingCert({ entryId: 'nb-proven', ts: ago(40) }),
      outcome: 'survived',
      exercise: { timesExercised: 2, adversarialProbes: 1, breakAttempts: 0 },
    });

    const { handleClassroomTool } = await import('../tools/classroom.js');
    const out = await handleClassroomTool('paradigm_classroom_status', {}, { rootDir: projectDir } as never);
    const parsed = JSON.parse(out.text) as {
      totals: { unproven: number };
      perAgent: Record<string, { certifications: Record<string, number>; repeatFailureRate: number | null }>;
    };
    expect(parsed.perAgent[AGENT].certifications).toEqual({
      total: 4, pending: 1, unproven: 2, survived: 1, overturned: 0, legacyAgedSurvived: 1,
    });
    expect(parsed.totals.unproven).toBe(2);
    expect(parsed.perAgent[AGENT].repeatFailureRate).toBe(0); // 0 overturned / 1 evidenced survival
  });

  it('ruling 6: an empty exercises ledger is said plainly, not left as a silent null rate', async () => {
    appendClassroomCertification(projectDir, pendingCert({ entryId: 'nb-aged', ts: daysAgo(40) }));
    const { handleClassroomTool } = await import('../tools/classroom.js');
    const read = async () => JSON.parse((await handleClassroomTool('paradigm_classroom_status', {}, { rootDir: projectDir } as never)).text) as {
      survival?: string;
      perAgent: Record<string, { repeatFailureRate: number | null; repeatFailureRateNote?: string }>;
    };

    const empty = await read();
    expect(empty.survival).toBe('no exercise events recorded yet (spec sub-phase 1): no cert can survive');
    expect(empty.perAgent[AGENT].repeatFailureRate).toBeNull();
    expect(empty.perAgent[AGENT].repeatFailureRateNote).toBe(empty.survival);

    exercise('nb-aged', 1, 0);
    const withRows = await read();
    expect(withRows.survival).toBeUndefined();
    expect(withRows.perAgent[AGENT].repeatFailureRateNote).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────
// 3. UNUSED DECAY — silence is signal
// ────────────────────────────────────────────────────────

describe('runDecayPass — unused decay', () => {
  it('decays an entry idle past the idle window with low appliedCount', () => {
    const id = 'nb-decay-agent-idle';
    writeProjectNotebook(makeEntry({ id, appliedCount: 1, confidence: 0.8, lastAppliedAt: daysAgo(60) }));

    const result = runDecayPass(projectDir, { now: NOW });

    expect(result.entriesDecayed).toBe(1);
    const entry = readProjectNotebook(id);
    expect(entry.confidence).toBeLessThan(0.8);
  });

  it('does NOT decay a recently-applied entry', () => {
    const id = 'nb-decay-agent-fresh';
    writeProjectNotebook(makeEntry({ id, appliedCount: 1, confidence: 0.8, lastAppliedAt: daysAgo(2) }));

    const result = runDecayPass(projectDir, { now: NOW });

    expect(result.entriesDecayed).toBe(0);
    expect(readProjectNotebook(id).confidence).toBe(0.8);
  });

  it('does NOT decay a well-used entry even if idle', () => {
    const id = 'nb-decay-agent-popular';
    writeProjectNotebook(makeEntry({ id, appliedCount: 50, confidence: 0.8, lastAppliedAt: daysAgo(90) }));

    const result = runDecayPass(projectDir, { now: NOW });

    expect(result.entriesDecayed).toBe(0);
    expect(readProjectNotebook(id).confidence).toBe(0.8);
  });

  it('does NOT decay a never-applied entry (no lastAppliedAt)', () => {
    const id = 'nb-decay-agent-virgin';
    writeProjectNotebook(makeEntry({ id, appliedCount: 0, confidence: 0.8, lastAppliedAt: undefined }));

    const result = runDecayPass(projectDir, { now: NOW });

    expect(result.entriesDecayed).toBe(0);
    expect(readProjectNotebook(id).confidence).toBe(0.8);
  });
});
