/**
 * The Classroom — end-to-end proof that the failure → reinforcement loop TURNS
 * (TD-2026-06-19-007).
 *
 * This is the acceptance bar for Wave 1 of the Classroom MVP. The reducer under
 * test (runFieldFailureReducer) joins reviewer verdicts back to notebook
 * application receipts BY orchestrationId and, for each REAL join:
 *   - writes a field-failures.jsonl row,
 *   - bumps appliedAndBrokeCount + revises confidence DOWN on the entry,
 *   - back-binds the matching pending certification → overturned.
 *
 * notebook-loader.ts (which reviseDown lives in) computes GLOBAL_NOTEBOOKS_DIR at
 * module-load time via os.homedir(). We mock os.homedir() BEFORE the module is
 * imported so the global notebook area resolves to a temp dir we control — the
 * fixtures below all use PROJECT scope, but the mock guarantees the test can never
 * touch the developer's real ~/.paradigm/notebooks.
 */

import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';

// Stable mock-home created before the module-under-test is imported.
const shared = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const nodeFs = require('fs') as typeof import('fs');
  const nodePath = require('path') as typeof import('path');
  const nodeOs = require('os') as typeof import('os');
  /* eslint-enable @typescript-eslint/no-require-imports */
  const mockHome = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'ffr-mock-home-'));
  return { mockHome };
});

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    homedir: () => shared.mockHome,
  };
});

// Imported AFTER the os mock so GLOBAL_NOTEBOOKS_DIR resolves into the mock-home.
import { runFieldFailureReducer } from './field-failure-reducer.js';
import { loadScenarios } from './scenario-loader.js';
import {
  appendFieldFailure,
  readFieldFailures,
  readClassroomCertifications,
  appendClassroomCertification,
  makeFailureId,
  type ClassroomCertRow,
} from './field-failures.js';
import {
  recordNotebookReference,
  appendSessionWorkEntry,
  type SessionWorkEntry,
} from './session-work-log.js';
import type { NotebookEntry } from '../types/notebooks.js';

// ────────────────────────────────────────────────────────
// Fixtures
// ────────────────────────────────────────────────────────

let projectDir: string;
const globalNotebooksBase = path.join(shared.mockHome, '.paradigm', 'notebooks');

const AGENT = 'test-agent';
const ENTRY_ID = 'nb-test-agent-auth-pattern';
const ORCH_ID = 'orch-fixture-0001';
const START_CONFIDENCE = 0.8;

function makeEntry(overrides: Partial<NotebookEntry> = {}): NotebookEntry {
  return {
    id: overrides.id ?? ENTRY_ID,
    context: overrides.context ?? 'When implementing auth middleware',
    snippet: overrides.snippet ?? 'app.use(authMiddleware)',
    provenance: overrides.provenance ?? { source: 'lore' },
    appliedCount: overrides.appliedCount ?? 1,
    appliedAndBrokeCount: overrides.appliedAndBrokeCount,
    confidence: overrides.confidence ?? START_CONFIDENCE,
    concepts: overrides.concepts ?? ['auth', 'middleware'],
    tags: overrides.tags ?? ['pattern'],
    created: overrides.created ?? '2026-01-01T00:00:00.000Z',
    updated: overrides.updated ?? '2026-01-01T00:00:00.000Z',
  };
}

/** Write a notebook entry into the PROJECT scope (rootDir/.paradigm/notebooks/<agent>). */
function writeProjectNotebook(entry: NotebookEntry, agentId: string = AGENT): string {
  const agentDir = path.join(projectDir, '.paradigm', 'notebooks', agentId);
  fs.mkdirSync(agentDir, { recursive: true });
  const filePath = path.join(agentDir, `${entry.id}.yaml`);
  fs.writeFileSync(filePath, yaml.dump(entry, { lineWidth: 120, noRefs: true }));
  return filePath;
}

/** Read a project-scope notebook entry back from disk. */
function readProjectNotebook(entryId: string, agentId: string = AGENT): NotebookEntry {
  const filePath = path.join(projectDir, '.paradigm', 'notebooks', agentId, `${entryId}.yaml`);
  return yaml.load(fs.readFileSync(filePath, 'utf-8')) as NotebookEntry;
}

/** A reviewer verdict written into the session-log (the channel the reducer reads). */
function makeVerdict(overrides: Partial<SessionWorkEntry> = {}): SessionWorkEntry {
  return {
    timestamp: overrides.timestamp ?? '2026-06-19T00:00:00.000Z',
    type: 'user-verdict',
    agent: overrides.agent ?? AGENT,
    verdict: overrides.verdict ?? 'dismissed',
    orchestrationId: 'orchestrationId' in overrides ? overrides.orchestrationId : ORCH_ID,
    reason: overrides.reason ?? 'the auth pattern leaked a token in the error path',
    symbols: overrides.symbols ?? ['#auth-middleware'],
  };
}

/** A pending classroom certification for an entry (what promotion writes). */
function pendingCert(overrides: Partial<ClassroomCertRow> = {}): ClassroomCertRow {
  return {
    ts: overrides.ts ?? '2026-06-18T00:00:00.000Z',
    agent: overrides.agent ?? AGENT,
    entryId: overrides.entryId ?? ENTRY_ID,
    concepts: overrides.concepts ?? ['auth', 'middleware'],
    confidenceAtCert: overrides.confidenceAtCert ?? START_CONFIDENCE,
    certifiedBy: overrides.certifiedBy ?? 'gate',
    outcome: overrides.outcome ?? 'pending',
  };
}

// ────────────────────────────────────────────────────────
// Setup / Teardown
// ────────────────────────────────────────────────────────

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ffr-project-'));
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
// 1. THE LOOP TURNS — the headline acceptance test
// ────────────────────────────────────────────────────────

describe('runFieldFailureReducer — the loop turns (acceptance)', () => {
  it('joins a break to its application receipt and reinforces (failure + bump + revise + overturn)', () => {
    // GIVEN a promoted entry, its application receipt, a pending cert, and a break.
    writeProjectNotebook(makeEntry({ appliedCount: 1, confidence: START_CONFIDENCE }));
    appendClassroomCertification(projectDir, pendingCert());
    recordNotebookReference(projectDir, AGENT, [ENTRY_ID], ORCH_ID);
    appendSessionWorkEntry(projectDir, makeVerdict({ verdict: 'dismissed' }));

    // WHEN the reducer runs at postflight.
    const result = runFieldFailureReducer(projectDir);

    expect(result).toEqual({
      failuresRecorded: 1,
      failuresConfounded: 0,
      entriesRevised: 1,
      certsOverturned: 1,
      scenariosCreated: 1,
    });

    // (a) a field-failures.jsonl row attributing this entry under this orchestration.
    const failures = readFieldFailures(projectDir);
    expect(failures).toHaveLength(1);
    expect(failures[0].attributedEntryIds).toEqual([ENTRY_ID]);
    expect(failures[0].orchestrationId).toBe(ORCH_ID);
    expect(failures[0].agent).toBe(AGENT);
    expect(failures[0].signal).toBe('reviewer-reject');
    expect(failures[0].sourceEvent).toBe('verdict:dismissed');

    // (b) appliedAndBrokeCount was bumped (read the entry back).
    const entry = readProjectNotebook(ENTRY_ID);
    expect(entry.appliedAndBrokeCount).toBe(1);

    // (c) confidence was revised DOWN.
    expect(entry.confidence).toBeLessThan(START_CONFIDENCE);
    expect(entry.confidence).toBeCloseTo(START_CONFIDENCE - 0.15, 5);

    // (d) the matching cert flipped pending → overturned, with the failure id bound.
    const certs = readClassroomCertifications(projectDir);
    expect(certs).toHaveLength(1);
    expect(certs[0].outcome).toBe('overturned');
    expect(certs[0].overturnedByFailureId).toBe(makeFailureId(ORCH_ID, ENTRY_ID));
    expect(certs[0].boundAt).toBeTruthy();
  });
});

// ────────────────────────────────────────────────────────
// 2. GUARD: anti-grief — no join, no blame
// ────────────────────────────────────────────────────────

describe('runFieldFailureReducer — anti-grief guard', () => {
  it('does NOT revise an entry whose orchestration has no notebook-ref join to it', () => {
    // Entry X exists and has a pending cert, but the application receipt for the
    // broken orchestration references a DIFFERENT entry. You cannot blame a
    // learning that was never loaded into THIS orchestration.
    const OTHER_ENTRY = 'nb-test-agent-other-pattern';
    writeProjectNotebook(makeEntry({ id: ENTRY_ID, confidence: START_CONFIDENCE }));
    writeProjectNotebook(makeEntry({ id: OTHER_ENTRY, confidence: START_CONFIDENCE }));
    appendClassroomCertification(projectDir, pendingCert({ entryId: ENTRY_ID }));

    // The receipt for the broken orchestration loaded OTHER_ENTRY, not ENTRY_ID.
    recordNotebookReference(projectDir, AGENT, [OTHER_ENTRY], ORCH_ID);
    appendSessionWorkEntry(projectDir, makeVerdict({ verdict: 'dismissed' }));

    runFieldFailureReducer(projectDir);

    // ENTRY_ID was never loaded under ORCH_ID → untouched.
    const entryX = readProjectNotebook(ENTRY_ID);
    expect(entryX.appliedAndBrokeCount).toBeUndefined();
    expect(entryX.confidence).toBe(START_CONFIDENCE);

    // No field-failure attributes ENTRY_ID.
    const failures = readFieldFailures(projectDir);
    const blamingX = failures.filter(f => f.attributedEntryIds.includes(ENTRY_ID));
    expect(blamingX).toHaveLength(0);

    // ENTRY_ID's cert stays pending (it was not the one loaded/broken).
    const certX = readClassroomCertifications(projectDir).find(c => c.entryId === ENTRY_ID);
    expect(certX?.outcome).toBe('pending');
  });

  it('does NOT attribute a break whose verdict has no orchestrationId at all', () => {
    writeProjectNotebook(makeEntry({ confidence: START_CONFIDENCE }));
    recordNotebookReference(projectDir, AGENT, [ENTRY_ID], ORCH_ID);
    // Unkeyed verdict — cannot join.
    appendSessionWorkEntry(projectDir, makeVerdict({ orchestrationId: undefined }));

    const result = runFieldFailureReducer(projectDir);

    expect(result.failuresRecorded).toBe(0);
    expect(result.entriesRevised).toBe(0);
    expect(readProjectNotebook(ENTRY_ID).appliedAndBrokeCount).toBeUndefined();
    expect(readFieldFailures(projectDir)).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────
// 3. GUARD: dedupe — one revision per (entryId, orchestrationId)
// ────────────────────────────────────────────────────────

describe('runFieldFailureReducer — dedupe guard', () => {
  it('revises only ONCE when run twice on the same (entryId, orchestrationId) break', () => {
    writeProjectNotebook(makeEntry({ confidence: START_CONFIDENCE }));
    appendClassroomCertification(projectDir, pendingCert());
    recordNotebookReference(projectDir, AGENT, [ENTRY_ID], ORCH_ID);
    appendSessionWorkEntry(projectDir, makeVerdict({ verdict: 'dismissed' }));

    // First pass turns the loop.
    runFieldFailureReducer(projectDir);
    const afterFirst = readProjectNotebook(ENTRY_ID);
    expect(afterFirst.appliedAndBrokeCount).toBe(1);
    expect(afterFirst.confidence).toBeCloseTo(START_CONFIDENCE - 0.15, 5);

    // Second pass on the SAME inputs must not compound the revision on the entry.
    runFieldFailureReducer(projectDir);
    const afterSecond = readProjectNotebook(ENTRY_ID);
    expect(afterSecond.appliedAndBrokeCount).toBe(1);
    expect(afterSecond.confidence).toBeCloseTo(START_CONFIDENCE - 0.15, 5);

    // And the cert is not double-bound (overturnCertification is idempotent:
    // a row already overturned is left untouched, so no second flip).
    const overturned = readClassroomCertifications(projectDir).filter(
      c => c.outcome === 'overturned',
    );
    expect(overturned).toHaveLength(1);
  });
});

// ────────────────────────────────────────────────────────
// 4. ACCEPTED verdict produces no break
// ────────────────────────────────────────────────────────

describe('runFieldFailureReducer — only real breaks count', () => {
  it('produces NO field-failure for an accepted verdict', () => {
    writeProjectNotebook(makeEntry({ confidence: START_CONFIDENCE }));
    appendClassroomCertification(projectDir, pendingCert());
    recordNotebookReference(projectDir, AGENT, [ENTRY_ID], ORCH_ID);
    // accepted is NOT in FAILURE_VERDICTS — it must not trigger the loop.
    appendSessionWorkEntry(projectDir, makeVerdict({ verdict: 'accepted' }));

    const result = runFieldFailureReducer(projectDir);

    expect(result).toEqual({
      failuresRecorded: 0,
      failuresConfounded: 0,
      entriesRevised: 0,
      certsOverturned: 0,
      scenariosCreated: 0,
    });
    expect(readFieldFailures(projectDir)).toHaveLength(0);
    expect(readProjectNotebook(ENTRY_ID).appliedAndBrokeCount).toBeUndefined();
    const cert = readClassroomCertifications(projectDir).find(c => c.entryId === ENTRY_ID);
    expect(cert?.outcome).toBe('pending');
  });
});

// ────────────────────────────────────────────────────────
// 5. FIELD-FAILURE → SCENARIO CONVERTER — the field generates the probe
// ────────────────────────────────────────────────────────

describe('runFieldFailureReducer — field-failure → scenario converter', () => {
  it('creates exactly ONE field-failure scenario, with the right origin + origin_ref', () => {
    writeProjectNotebook(makeEntry({ appliedCount: 1, confidence: START_CONFIDENCE }));
    appendClassroomCertification(projectDir, pendingCert());
    recordNotebookReference(projectDir, AGENT, [ENTRY_ID], ORCH_ID);
    appendSessionWorkEntry(projectDir, makeVerdict({ verdict: 'dismissed' }));

    const result = runFieldFailureReducer(projectDir);
    expect(result.scenariosCreated).toBe(1);

    return loadScenarios(projectDir).then(scenarios => {
      expect(scenarios).toHaveLength(1);
      const sc = scenarios[0];
      expect(sc.origin).toBe('field-failure');
      // origin_ref points at the failure id (makeFailureId).
      expect(sc.origin_ref).toBe(makeFailureId(ORCH_ID, ENTRY_ID));
      // probe is derived from the attributed entry's agent + id.
      expect(sc.probes).toHaveLength(1);
      expect(sc.probes[0].agent).toBe(AGENT);
      expect(sc.probes[0].learning_ref).toBe(ENTRY_ID);
      // expected.must defaults to survive.
      expect(sc.expected.must).toBe('survive');
      expect(sc.status).toBe('active');
    });
  });

  it('does NOT duplicate the scenario on a second pass over the same break', () => {
    writeProjectNotebook(makeEntry({ confidence: START_CONFIDENCE }));
    appendClassroomCertification(projectDir, pendingCert());
    recordNotebookReference(projectDir, AGENT, [ENTRY_ID], ORCH_ID);
    appendSessionWorkEntry(projectDir, makeVerdict({ verdict: 'dismissed' }));

    const first = runFieldFailureReducer(projectDir);
    expect(first.scenariosCreated).toBe(1);

    // Second pass: dedupe guard (the failure ledger already records the break,
    // AND the scenario already exists on origin_ref) → no new scenario.
    const second = runFieldFailureReducer(projectDir);
    expect(second.scenariosCreated).toBe(0);

    return loadScenarios(projectDir).then(scenarios => {
      expect(scenarios).toHaveLength(1);
    });
  });
});

// ────────────────────────────────────────────────────────
// 6. REFINEMENT CAPTURE — "X except Y" structural record (Phase 2)
// ────────────────────────────────────────────────────────

describe('runFieldFailureReducer — refinement capture (X except Y)', () => {
  it('appends exactly ONE exception (when/then/sourceFailureId) and sets lineageType refine', () => {
    writeProjectNotebook(makeEntry({ confidence: START_CONFIDENCE }));
    appendClassroomCertification(projectDir, pendingCert());
    recordNotebookReference(projectDir, AGENT, [ENTRY_ID], ORCH_ID);
    appendSessionWorkEntry(
      projectDir,
      makeVerdict({ verdict: 'dismissed', reason: 'the auth pattern leaked a token in the error path' }),
    );

    runFieldFailureReducer(projectDir);

    const entry = readProjectNotebook(ENTRY_ID);
    // lineageType flips to 'refine'.
    expect(entry.lineageType).toBe('refine');
    // refinement.base ("the X") is the original claim — seeded once.
    expect(entry.refinement).toBeTruthy();
    expect(entry.refinement!.base.length).toBeGreaterThan(0);
    expect(entry.refinement!.revisedAt).toBeTruthy();
    // exactly one exception, traced to the break.
    expect(entry.refinement!.exceptions).toHaveLength(1);
    const ex = entry.refinement!.exceptions[0];
    // when = the break CONTEXT (the verdict reason / detail), not the bare signal.
    expect(ex.when).toContain('leaked a token');
    // then = a stub — the prose corrective is authored at the gated class review.
    expect(ex.then).toContain('gated class review');
    // sourceFailureId ties the exception to the originating field-failure.
    expect(ex.sourceFailureId).toBe(makeFailureId(ORCH_ID, ENTRY_ID));
  });

  it('does NOT duplicate the exception on a second pass over the same break', () => {
    writeProjectNotebook(makeEntry({ confidence: START_CONFIDENCE }));
    appendClassroomCertification(projectDir, pendingCert());
    recordNotebookReference(projectDir, AGENT, [ENTRY_ID], ORCH_ID);
    appendSessionWorkEntry(projectDir, makeVerdict({ verdict: 'dismissed' }));

    runFieldFailureReducer(projectDir);
    const afterFirst = readProjectNotebook(ENTRY_ID);
    expect(afterFirst.refinement!.exceptions).toHaveLength(1);

    // Second pass on the same break must not append a duplicate exception.
    runFieldFailureReducer(projectDir);
    const afterSecond = readProjectNotebook(ENTRY_ID);
    expect(afterSecond.refinement!.exceptions).toHaveLength(1);
    expect(afterSecond.refinement!.exceptions[0].sourceFailureId).toBe(
      makeFailureId(ORCH_ID, ENTRY_ID),
    );
  });
});

// ────────────────────────────────────────────────────────
// Attribution (T-2026-11-03-002): more than one injected entry ⇒ confounded
// ────────────────────────────────────────────────────────

describe('runFieldFailureReducer — confounded attribution', () => {
  const OTHER = 'nb-test-agent-cache-pattern';

  it('records ONE confounded row with every injected id, keeps scenarios, revises and overturns nothing', () => {
    writeProjectNotebook(makeEntry({ id: ENTRY_ID, confidence: START_CONFIDENCE }));
    writeProjectNotebook(makeEntry({ id: OTHER, concepts: ['cache'], confidence: START_CONFIDENCE }));
    appendClassroomCertification(projectDir, pendingCert({ entryId: ENTRY_ID }));
    appendClassroomCertification(projectDir, pendingCert({ entryId: OTHER }));
    recordNotebookReference(projectDir, AGENT, [ENTRY_ID, OTHER], ORCH_ID);
    appendSessionWorkEntry(projectDir, makeVerdict({ verdict: 'dismissed' }));

    const result = runFieldFailureReducer(projectDir);

    expect(result).toEqual({
      failuresRecorded: 1,
      failuresConfounded: 1,
      entriesRevised: 0,
      certsOverturned: 0,
      scenariosCreated: 2,
    });

    const failures = readFieldFailures(projectDir);
    expect(failures).toHaveLength(1);
    expect(failures[0].attribution).toBe('confounded');
    expect([...failures[0].attributedEntryIds].sort()).toEqual([ENTRY_ID, OTHER].sort());

    // No reviseDown: confidence and the broke counter are untouched.
    for (const id of [ENTRY_ID, OTHER]) {
      const entry = readProjectNotebook(id);
      expect(entry.confidence).toBe(START_CONFIDENCE);
      expect(entry.appliedAndBrokeCount ?? 0).toBe(0);
      expect(entry.refinement).toBeUndefined();
    }
    // No overturn.
    expect(readClassroomCertifications(projectDir).map(c => c.outcome)).toEqual(['pending', 'pending']);
  });

  it('unions receipts per agent: two single-entry loads of different entries are still confounded', () => {
    writeProjectNotebook(makeEntry({ id: ENTRY_ID }));
    writeProjectNotebook(makeEntry({ id: OTHER, concepts: ['cache'] }));
    recordNotebookReference(projectDir, AGENT, [ENTRY_ID], ORCH_ID);
    recordNotebookReference(projectDir, AGENT, [OTHER], ORCH_ID);
    appendSessionWorkEntry(projectDir, makeVerdict({ verdict: 'revised' }));

    const result = runFieldFailureReducer(projectDir);
    expect(result.failuresConfounded).toBe(1);
    expect(result.entriesRevised).toBe(0);
  });

  it('two receipts of the SAME single entry stay attributable', () => {
    writeProjectNotebook(makeEntry({ id: ENTRY_ID }));
    appendClassroomCertification(projectDir, pendingCert());
    recordNotebookReference(projectDir, AGENT, [ENTRY_ID], ORCH_ID);
    recordNotebookReference(projectDir, AGENT, [ENTRY_ID], ORCH_ID);
    appendSessionWorkEntry(projectDir, makeVerdict({ verdict: 'dismissed' }));

    const result = runFieldFailureReducer(projectDir);
    expect(result).toMatchObject({ failuresRecorded: 1, failuresConfounded: 0, entriesRevised: 1, certsOverturned: 1 });
    expect(readFieldFailures(projectDir)[0].attribution).toBeUndefined();
  });

  it('is durable: a second pass writes no second confounded row and still revises nothing', () => {
    writeProjectNotebook(makeEntry({ id: ENTRY_ID }));
    writeProjectNotebook(makeEntry({ id: OTHER, concepts: ['cache'] }));
    recordNotebookReference(projectDir, AGENT, [ENTRY_ID, OTHER], ORCH_ID);
    appendSessionWorkEntry(projectDir, makeVerdict({ verdict: 'dismissed' }));

    runFieldFailureReducer(projectDir);
    const second = runFieldFailureReducer(projectDir);
    expect(second.failuresRecorded).toBe(0);
    expect(readFieldFailures(projectDir)).toHaveLength(1);
    expect(readProjectNotebook(ENTRY_ID).confidence).toBe(START_CONFIDENCE);
  });
});

// ────────────────────────────────────────────────────────
// Ruling 4: verdict scope; Judge I5: pair-level durable dedupe
// ────────────────────────────────────────────────────────

describe('runFieldFailureReducer — verdict scope (ruling 4) and pair dedupe (I5)', () => {
  const PEER = 'peer-agent';
  const PEER_ENTRY = 'nb-peer-agent-cache-pattern';
  const OTHER = 'nb-test-agent-cache-pattern';

  it('a verdict naming its agent considers only that agent\'s receipts', () => {
    writeProjectNotebook(makeEntry({ id: ENTRY_ID }));
    writeProjectNotebook(makeEntry({ id: PEER_ENTRY, concepts: ['cache'] }), PEER);
    appendClassroomCertification(projectDir, pendingCert({ entryId: ENTRY_ID }));
    appendClassroomCertification(projectDir, pendingCert({ entryId: PEER_ENTRY, agent: PEER }));
    recordNotebookReference(projectDir, AGENT, [ENTRY_ID], ORCH_ID);
    recordNotebookReference(projectDir, PEER, [PEER_ENTRY], ORCH_ID);
    appendSessionWorkEntry(projectDir, makeVerdict({ agent: AGENT, verdict: 'dismissed' }));

    const result = runFieldFailureReducer(projectDir);

    expect(result).toMatchObject({ failuresRecorded: 1, failuresConfounded: 0, entriesRevised: 1, certsOverturned: 1 });
    const failures = readFieldFailures(projectDir);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ agent: AGENT, attributedEntryIds: [ENTRY_ID] });
    // The peer's entry was never named by the verdict: untouched.
    expect(readProjectNotebook(PEER_ENTRY, PEER).appliedAndBrokeCount ?? 0).toBe(0);
    expect(readClassroomCertifications(projectDir).find(c => c.entryId === PEER_ENTRY)?.outcome).toBe('pending');
  });

  it('a verdict naming NO agent judges the union: two agents with one entry each is confounded, nothing revised', () => {
    writeProjectNotebook(makeEntry({ id: ENTRY_ID }));
    writeProjectNotebook(makeEntry({ id: PEER_ENTRY, concepts: ['cache'] }), PEER);
    appendClassroomCertification(projectDir, pendingCert({ entryId: ENTRY_ID }));
    appendClassroomCertification(projectDir, pendingCert({ entryId: PEER_ENTRY, agent: PEER }));
    recordNotebookReference(projectDir, AGENT, [ENTRY_ID], ORCH_ID);
    recordNotebookReference(projectDir, PEER, [PEER_ENTRY], ORCH_ID);
    appendSessionWorkEntry(projectDir, { ...makeVerdict({ verdict: 'dismissed' }), agent: undefined });

    const result = runFieldFailureReducer(projectDir);

    expect(result).toMatchObject({ entriesRevised: 0, certsOverturned: 0 });
    expect(result.failuresRecorded).toBe(result.failuresConfounded);
    const failures = readFieldFailures(projectDir);
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.every(f => f.attribution === 'confounded')).toBe(true);
    expect(failures.flatMap(f => f.attributedEntryIds).sort()).toEqual([ENTRY_ID, PEER_ENTRY].sort());
    // Loid L2: every confounded row names ALL the suspects in scope, across agents
    for (const f of failures) expect([...(f.suspects ?? [])].sort()).toEqual([ENTRY_ID, PEER_ENTRY].sort());
    expect(readProjectNotebook(ENTRY_ID).confidence).toBe(START_CONFIDENCE);
    expect(readProjectNotebook(PEER_ENTRY, PEER).confidence).toBe(START_CONFIDENCE);
    expect(readClassroomCertifications(projectDir).map(c => c.outcome)).toEqual(['pending', 'pending']);
  });

  it('skips an (orchestrationId, agent) pair that already has a legacy row: no double record, no hurt rewritten to confounded', () => {
    writeProjectNotebook(makeEntry({ id: ENTRY_ID }));
    writeProjectNotebook(makeEntry({ id: OTHER, concepts: ['cache'] }));
    recordNotebookReference(projectDir, AGENT, [ENTRY_ID, OTHER], ORCH_ID);
    appendSessionWorkEntry(projectDir, makeVerdict({ verdict: 'dismissed' }));
    // A legacy (pre-confounding) pass attributed only injected[0].
    appendFieldFailure(projectDir, {
      ts: '2026-06-19T00:00:00.000Z',
      orchestrationId: ORCH_ID,
      agent: AGENT,
      signal: 'reviewer-reject',
      severity: 'high',
      attributedEntryIds: [ENTRY_ID],
      symbols: [],
      detail: 'legacy',
      sourceEvent: 'verdict:dismissed',
    });

    const result = runFieldFailureReducer(projectDir);

    expect(result.failuresRecorded).toBe(0);
    const failures = readFieldFailures(projectDir);
    expect(failures).toHaveLength(1);
    expect(failures[0].attribution).toBeUndefined();
    expect(readProjectNotebook(OTHER).confidence).toBe(START_CONFIDENCE);
  });
});
