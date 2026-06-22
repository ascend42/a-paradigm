/**
 * The Classroom — the DECAY PASS proves the metric (TD-2026-06-19-007, Phase 2).
 *
 * The decay pass is load-bearing: until it flips aged-without-break certs to
 * `survived`, `resolved` == `overturned` and repeat-failure-rate is a structural
 * 1.0 (or null) — a lie. These tests prove:
 *   - a pending cert older than the survival window with NO break flips to survived;
 *   - a pending cert that WAS overturned (a break attributed it) is NOT flipped
 *     (overturn wins);
 *   - the pass is idempotent across two runs;
 *   - METRIC HONESTY: 1 overturned + 3 survived ⇒ computeRepeatFailureRate = 0.25
 *     (the denominator is real now);
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
import { runDecayPass } from './decay.js';
import {
  appendClassroomCertification,
  readClassroomCertifications,
  appendFieldFailure,
  makeFailureId,
  type ClassroomCertRow,
  type FieldFailureRow,
} from './field-failures.js';
// The metric lives in premise-core (the canonical rollup). We prove honesty
// through the SAME ledger the decay pass writes.
import { computeRepeatFailureRate } from '@a-company/premise-core';
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

describe('runDecayPass — survived flip', () => {
  it('flips a pending cert older than the survival window with NO break to survived', () => {
    appendClassroomCertification(projectDir, pendingCert({ ts: daysAgo(20) }));

    const result = runDecayPass(projectDir, { now: NOW });

    expect(result.certsSurvived).toBe(1);
    const certs = readClassroomCertifications(projectDir);
    expect(certs).toHaveLength(1);
    expect(certs[0].outcome).toBe('survived');
    expect(certs[0].survivedAt).toBeTruthy();
  });

  it('does NOT flip a pending cert that is younger than the survival window', () => {
    appendClassroomCertification(projectDir, pendingCert({ ts: daysAgo(3) }));

    const result = runDecayPass(projectDir, { now: NOW });

    expect(result.certsSurvived).toBe(0);
    expect(readClassroomCertifications(projectDir)[0].outcome).toBe('pending');
  });

  it('does NOT flip to survived when an attributed break exists (overturn wins)', () => {
    const entryId = 'nb-decay-agent-x';
    appendClassroomCertification(projectDir, pendingCert({ ts: daysAgo(20), entryId }));
    // A break landed on this entry → it must NOT be treated as a survivor.
    appendFieldFailure(projectDir, fieldFailure(entryId));

    const result = runDecayPass(projectDir, { now: NOW });

    expect(result.certsSurvived).toBe(0);
    expect(readClassroomCertifications(projectDir)[0].outcome).toBe('pending');
  });

  it('is idempotent across two decay runs (no double flip)', () => {
    appendClassroomCertification(projectDir, pendingCert({ ts: daysAgo(20) }));

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
  it('1 overturned + 3 survived ⇒ repeat-failure-rate = 0.25 (not 1.0)', () => {
    // One entry breaks (overturned); three age out clean (survived after decay).
    const overturnedEntry = 'nb-decay-agent-broke';
    appendClassroomCertification(projectDir, {
      ...pendingCert({ entryId: overturnedEntry, ts: daysAgo(20) }),
      outcome: 'overturned',
      overturnedByFailureId: makeFailureId('orch-1', overturnedEntry),
      boundAt: daysAgo(2),
    });

    // Three pending certs aged past the window with no break.
    for (const id of ['nb-decay-agent-a', 'nb-decay-agent-b', 'nb-decay-agent-c']) {
      appendClassroomCertification(projectDir, pendingCert({ entryId: id, ts: daysAgo(20) }));
    }

    // BEFORE decay: resolved == overturned only ⇒ rate is a structural 1.0.
    const before = computeRepeatFailureRate(readClassroomCertifications(projectDir));
    expect(before.overall).toBe(1);

    // Decay flips the three survivors.
    const result = runDecayPass(projectDir, { now: NOW });
    expect(result.certsSurvived).toBe(3);

    // AFTER decay: resolved = 1 overturned + 3 survived = 4 ⇒ rate = 1/4 = 0.25.
    const after = computeRepeatFailureRate(readClassroomCertifications(projectDir));
    expect(after.overall).toBe(0.25);
    expect(after.perAgent[AGENT].resolved).toBe(4);
    expect(after.perAgent[AGENT].overturned).toBe(1);
    expect(after.perAgent[AGENT].rate).toBe(0.25);
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
