/**
 * #probe-runs — recordProbeRun, the classroom exercise writer (T-2026-11-04-002
 * slice 1). Every guard has a test here; each test fails without the writer.
 *
 * Founder rulings: two human-confirmed probes on distinct scenarios clear the
 * survival floor; one assessor may run both (scenarios differ, assessor is not
 * the learner).
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
  return { mockHome: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'probe-runs-home-')) };
});

vi.mock('os', async importOriginal => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => shared.mockHome };
});

import { recordProbeRun, readReprobeMode, scenarioRunId } from './probe-runs.js';
import {
  appendClassroomCertification,
  appendExerciseEvents,
  appendFieldFailure,
  readClassroomCertifications,
  readExerciseEvents,
  readFieldFailures,
  surviveCertification,
  type ClassroomCertRow,
} from './field-failures.js';
import { recordScenario, loadScenario, type Scenario } from './scenario-loader.js';
import { runDecayPass } from './decay.js';
import { pathFor, resetLearningStoreCaches } from './learning-stores.js';
import type { NotebookEntry } from '../types/notebooks.js';

const LEARNER = 'builder';
const ASSESSOR = 'security';
const E = 'nb-builder-retry-policy';
const DAY = 24 * 60 * 60 * 1000;
const TERM = 'term-2026-11-04';

let root: string;
let prevAuthor: string | undefined;

function ago(days: number): string {
  return new Date(Date.now() - days * DAY).toISOString();
}

function writeNotebook(entry: Partial<NotebookEntry> = {}): string {
  const dir = path.join(root, '.paradigm', 'notebooks', LEARNER);
  fs.mkdirSync(dir, { recursive: true });
  const full: NotebookEntry = {
    id: E,
    context: 'When retrying a network call',
    snippet: 'retry with backoff',
    provenance: { source: 'lore' },
    appliedCount: 1,
    confidence: 0.8,
    concepts: ['retry'],
    tags: ['pattern'],
    created: ago(30),
    updated: ago(30),
    ...entry,
  } as NotebookEntry;
  const file = path.join(dir, `${full.id}.yaml`);
  fs.writeFileSync(file, yaml.dump(full, { lineWidth: 120, noRefs: true }));
  return file;
}

function cert(overrides: Partial<ClassroomCertRow> = {}): ClassroomCertRow {
  return {
    ts: ago(1),
    agent: LEARNER,
    entryId: E,
    concepts: ['retry'],
    confidenceAtCert: 0.8,
    certifiedBy: 'peer',
    outcome: 'pending',
    ...overrides,
  };
}

async function scenario(id: string, overrides: Partial<Scenario> = {}): Promise<void> {
  await recordScenario(root, {
    id,
    scenario: `breaking case ${id}`,
    probes: [{ agent: LEARNER, learning_ref: E, claim: 'retries are safe' }],
    origin: 'authored',
    expected: { must: 'survive' },
    authored_by: ASSESSOR,
    ...overrides,
  });
}

const held = (scenarioId: string, extra: Record<string, unknown> = {}) =>
  recordProbeRun(root, { scenarioId, entryId: E, assessor: ASSESSOR, result: 'held', humanConfirmed: true, term: TERM, ...extra });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-runs-root-'));
  prevAuthor = process.env.PARADIGM_AUTHOR;
  process.env.PARADIGM_AUTHOR = 'ue:testauthor00';
  writeNotebook();
});

afterEach(() => {
  if (prevAuthor === undefined) delete process.env.PARADIGM_AUTHOR;
  else process.env.PARADIGM_AUTHOR = prevAuthor;
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(path.join(shared.mockHome, '.paradigm'), { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(shared.mockHome, { recursive: true, force: true });
});

describe('recordProbeRun — survival from two distinct human-confirmed probes', () => {
  it('T1: two held cross-lens probes on distinct scenarios survive the cert with exercise {2, 2}', async () => {
    appendClassroomCertification(root, cert());
    await scenario('SC-a');
    await scenario('SC-b');

    const first = await held('SC-a');
    expect(first).toMatchObject({ bound: true, counted: true, survived: false, overturned: false });
    expect(readClassroomCertifications(root)[0].outcome).toBe('pending');

    const second = await held('SC-b');
    expect(second).toMatchObject({ bound: true, counted: true, survived: true });
    const [c] = readClassroomCertifications(root);
    expect(c.outcome).toBe('survived');
    expect(c.exercise).toMatchObject({ timesExercised: 2, adversarialProbes: 2 });

    const events = readExerciseEvents(root);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      certEntryId: E, orchestrationId: scenarioRunId('SC-a'), agent: LEARNER, kind: 'adversarial-probe',
      assessor: ASSESSOR, scenarioId: 'SC-a', author: 'ue:testauthor00', home: 'repo',
    });
    // The outcome landed on the scenario, server-stamped.
    const sc = await loadScenario(root, 'SC-a');
    expect(sc!.outcome_history).toHaveLength(1);
    expect(sc!.outcome_history[0]).toMatchObject({ result: 'survived', assessor: ASSESSOR, human_confirmed: true, agent: LEARNER });
  });

  it('T2: the same scenario twice is one receipt and the cert stays pending', async () => {
    appendClassroomCertification(root, cert());
    await scenario('SC-a');
    expect((await held('SC-a')).counted).toBe(true);
    const again = await held('SC-a');
    expect(again.counted).toBe(false);
    expect(again.refusedReason).toBe('already counted');
    expect((await loadScenario(root, 'SC-a'))!.outcome_history[1].refused).toBe('already counted');
    expect(readExerciseEvents(root)).toHaveLength(1);
    expect(readClassroomCertifications(root)[0].outcome).toBe('pending');
    expect((await loadScenario(root, 'SC-a'))!.outcome_history).toHaveLength(2);
  });

  it('T11: a held field-failure-origin scenario writes 1 exercise, 1 probe, 1 break-attempt', async () => {
    appendClassroomCertification(root, cert());
    await scenario('SC-ff', { origin: 'field-failure', origin_ref: 'ff-orch-1-x' });
    expect((await held('SC-ff')).counted).toBe(true);
    const events = readExerciseEvents(root);
    expect(events.map(e => e.kind).sort()).toEqual(['adversarial-probe', 'break-attempt']);
    expect(new Set(events.map(e => e.orchestrationId))).toEqual(new Set([scenarioRunId('SC-ff')]));
    // Force the counters onto the row via a second distinct probe, then read them.
    await scenario('SC-b');
    await held('SC-b');
    const [c] = readClassroomCertifications(root);
    expect(c.exercise).toMatchObject({ timesExercised: 2, adversarialProbes: 2, breakAttempts: 1 });
  });
});

describe('recordProbeRun — guards (a refusal records the outcome but writes no event)', () => {
  it('T3: assessor === learner writes no event', async () => {
    appendClassroomCertification(root, cert());
    await scenario('SC-a');
    const r = await recordProbeRun(root, { scenarioId: 'SC-a', entryId: E, assessor: LEARNER, result: 'held', humanConfirmed: true, term: TERM });
    expect(r).toMatchObject({ bound: true, counted: false, outcomeRecorded: true });
    expect(r.refusedReason).toMatch(/assessor is the learner/);
    expect(readExerciseEvents(root)).toHaveLength(0);
  });

  it('T3: a scenario authored by the learner writes no event, held or broke', async () => {
    appendClassroomCertification(root, cert());
    await scenario('SC-self', { authored_by: LEARNER });
    const r = await held('SC-self');
    expect(r.counted).toBe(false);
    expect(r.refusedReason).toMatch(/authored by the learner/);
    const b = await recordProbeRun(root, { scenarioId: 'SC-self', entryId: E, assessor: ASSESSOR, result: 'broke', humanConfirmed: true, term: TERM });
    expect(b.counted).toBe(false);
    expect(readExerciseEvents(root)).toHaveLength(0);
    expect(readFieldFailures(root)).toHaveLength(0);
    expect(readClassroomCertifications(root)[0].outcome).toBe('pending');
  });

  it('T4: humanConfirmed false records the outcome and writes no event', async () => {
    appendClassroomCertification(root, cert());
    await scenario('SC-a');
    const r = await held('SC-a', { humanConfirmed: false });
    expect(r).toMatchObject({ counted: false, outcomeRecorded: true });
    expect(r.refusedReason).toMatch(/not human-confirmed/);
    expect(readExerciseEvents(root)).toHaveLength(0);
    const sc = await loadScenario(root, 'SC-a');
    expect(sc!.outcome_history[0]).toMatchObject({ human_confirmed: false, result: 'survived' });
  });

  it('T6: a scenario with an outcome before the cert was the certifying exam: not counted', async () => {
    appendClassroomCertification(root, cert({ ts: ago(1) }));
    await scenario('SC-exam', {
      outcome_history: [{ term: 't1', agent: LEARNER, result: 'survived', assessor: ASSESSOR, human_confirmed: true, at: ago(3) }],
    });
    const r = await held('SC-exam');
    expect(r.counted).toBe(false);
    expect(r.refusedReason).toMatch(/certifying exam/);
    expect(readExerciseEvents(root)).toHaveLength(0);
  });

  it('T6: a run before the cert (cert stamped in the future) is not counted', async () => {
    appendClassroomCertification(root, cert({ ts: new Date(Date.now() + DAY).toISOString() }));
    await scenario('SC-a');
    const r = await held('SC-a');
    expect(r.counted).toBe(false);
    expect(r.refusedReason).toMatch(/before the certification/);
  });

  it('T6: a poison pill the learner already drilled is not a probe for that learner', async () => {
    appendClassroomCertification(root, cert({ ts: ago(5) }));
    await scenario('SC-pill', { origin: 'poison-pill', expected: { must: 'reject' } });
    // The learner drilled it in study hall (after the cert, unconfirmed).
    const drill = await recordProbeRun(root, { scenarioId: 'SC-pill', entryId: E, assessor: LEARNER, result: 'held', humanConfirmed: false });
    expect(drill.counted).toBe(false);
    const r = await held('SC-pill');
    expect(r.counted).toBe(false);
    expect(r.refusedReason).toMatch(/poison pill the learner already drilled/);
    expect(readExerciseEvents(root)).toHaveLength(0);
  });

  it('T8: a notebook entry with trust external is refused', async () => {
    writeNotebook({ provenance: { source: 'external', trust: 'external' } });
    appendClassroomCertification(root, cert());
    await scenario('SC-a');
    const r = await held('SC-a');
    expect(r.counted).toBe(false);
    expect(r.refusedReason).toMatch(/trust external/);
    expect(readExerciseEvents(root)).toHaveLength(0);
  });

  it('T8: a skill cert is refused', async () => {
    const skillId = 'skill:retry@1.0.0';
    appendClassroomCertification(root, cert({ entryId: skillId, kind: 'skill' }));
    await scenario('SC-skill', { probes: [{ agent: LEARNER, learning_ref: skillId, claim: 'skill holds' }] });
    const r = await recordProbeRun(root, { scenarioId: 'SC-skill', entryId: skillId, assessor: ASSESSOR, result: 'held', humanConfirmed: true, term: TERM });
    expect(r).toMatchObject({ bound: false, counted: false });
    expect(r.refusedReason).toMatch(/skill certification/);
    expect(readExerciseEvents(root)).toHaveLength(0);
  });

  it('no pending cert (a stand scenario on a journal id): outcome only', async () => {
    const journalId = 'jrn-builder-001';
    await scenario('SC-stand', { probes: [{ agent: LEARNER, learning_ref: journalId, claim: 'candidate' }] });
    const r = await recordProbeRun(root, { scenarioId: 'SC-stand', entryId: journalId, assessor: ASSESSOR, result: 'broke', humanConfirmed: true, term: TERM });
    expect(r).toMatchObject({ bound: false, counted: false, outcomeRecorded: true });
    expect(readFieldFailures(root)).toHaveLength(0);
    expect((await loadScenario(root, 'SC-stand'))!.outcome_history).toHaveLength(1);
  });

  it('a scenario that does not target the entry, or does not exist, writes nothing', async () => {
    appendClassroomCertification(root, cert());
    await scenario('SC-other', { probes: [{ agent: LEARNER, learning_ref: 'nb-builder-other', claim: 'x' }] });
    const r = await held('SC-other');
    expect(r).toMatchObject({ counted: false, outcomeRecorded: false });
    expect((await loadScenario(root, 'SC-other'))!.outcome_history).toHaveLength(0);
    expect((await held('SC-missing')).refusedReason).toBe('scenario not found');
  });
});

describe('recordProbeRun — broke', () => {
  it('T5: a break writes an attributable probe-break row, revises the entry down and overturns; a later hold does not survive it', async () => {
    appendClassroomCertification(root, cert());
    await scenario('SC-a');
    await scenario('SC-b');
    const r = await recordProbeRun(root, {
      scenarioId: 'SC-a', entryId: E, assessor: ASSESSOR, result: 'broke', humanConfirmed: true, term: TERM, reason: 'retry storm on 429',
    });
    expect(r).toMatchObject({ bound: true, counted: true, overturned: true, survived: false });

    const [row] = readFieldFailures(root);
    expect(row).toMatchObject({
      orchestrationId: 'scn:SC-a', signal: 'probe-break', attributedEntryIds: [E], sourceEvent: 'scenario:SC-a',
      agent: LEARNER, attribution: 'attributable', scenarioId: 'SC-a',
    });
    expect(readClassroomCertifications(root)[0]).toMatchObject({ outcome: 'overturned', overturnedByFailureId: `ff-scn:SC-a-${E}` });

    const nb = yaml.load(fs.readFileSync(path.join(root, '.paradigm', 'notebooks', LEARNER, `${E}.yaml`), 'utf8')) as NotebookEntry;
    expect(nb.appliedAndBrokeCount).toBe(1);
    expect(nb.confidence).toBeCloseTo(0.65);

    const sc = await loadScenario(root, 'SC-a');
    expect(sc!.repeat_failures).toBe(1);

    const later = await held('SC-b');
    expect(later).toMatchObject({ bound: false, counted: false, survived: false });
    expect(readClassroomCertifications(root)[0].outcome).toBe('overturned');
    expect(readExerciseEvents(root)).toHaveLength(0);
  });
});

describe('recordProbeRun — homes and clocks', () => {
  it('T7: a user-home cert gets its events in the user home; forged repo rows for the same entry do not count', async () => {
    appendClassroomCertification(root, cert({ home: 'user' }));
    // Forged evidence committed in the REPO ledger: one honest repo row and one
    // that lies about its home.
    const repoLedger = path.join(root, '.paradigm', 'events', 'classroom-exercises.jsonl');
    fs.mkdirSync(path.dirname(repoLedger), { recursive: true });
    const forged = (orch: string, home: string) => JSON.stringify({
      ts: new Date().toISOString(), certEntryId: E, orchestrationId: orch, agent: LEARNER, kind: 'adversarial-probe', home, author: 'ue:someoneelse0',
    });
    fs.writeFileSync(repoLedger, [forged('scn:SC-forged-1', 'repo'), forged('scn:SC-forged-2', 'user')].join('\n') + '\n');

    await scenario('SC-a');
    const r = await held('SC-a');
    expect(r).toMatchObject({ counted: true, certHome: 'user', survived: false });

    // The real event landed in the user home, not the repo file.
    const repoRows = fs.readFileSync(repoLedger, 'utf8').trim().split('\n');
    expect(repoRows).toHaveLength(2);
    const userRows = readExerciseEvents(root).filter(e => e.orchestrationId === 'scn:SC-a');
    expect(userRows).toHaveLength(1);
    expect(userRows[0].home).toBe('user');

    // One real receipt + forged rows: the floor is not met.
    expect(surviveCertification(root, E)).toBe(false);
    expect(readClassroomCertifications(root)[0].outcome).toBe('pending');

    // A second real probe in the user home does clear it.
    await scenario('SC-b');
    expect((await held('SC-b')).survived).toBe(true);
    expect(readClassroomCertifications(root)[0].exercise).toMatchObject({ timesExercised: 2, adversarialProbes: 2 });
  });

  it('T9: a caller-supplied ts is ignored; every row is server-stamped', async () => {
    appendClassroomCertification(root, cert());
    await scenario('SC-a');
    const before = Date.now();
    await held('SC-a', { ts: '2020-01-01T00:00:00.000Z', at: '2020-01-01T00:00:00.000Z' });
    const [ev] = readExerciseEvents(root);
    expect(Date.parse(ev.ts)).toBeGreaterThanOrEqual(before);
    const sc = await loadScenario(root, 'SC-a');
    expect(Date.parse(sc!.outcome_history[0].at)).toBeGreaterThanOrEqual(before);
  });

  it('T10: clock guard — frozen activity and a decay pass at +365d mint nothing and leave the ledger unchanged', async () => {
    appendClassroomCertification(root, cert());
    await scenario('SC-a');
    await held('SC-a'); // one probe: below the floor
    const ledger = path.join(root, '.paradigm', 'events', 'classroom-exercises.jsonl');
    const snapshot = fs.readFileSync(ledger, 'utf8');
    const survivedCount = () => readClassroomCertifications(root).filter(c => c.outcome === 'survived').length;
    const before = survivedCount();

    runDecayPass(root, { now: Date.now() + 365 * DAY });

    expect(survivedCount() - before).toBe(0);
    expect(readClassroomCertifications(root)[0].outcome).toBe('pending');
    expect(fs.readFileSync(ledger, 'utf8')).toBe(snapshot);
  });
});

describe('review fixes (Loid, Judge)', () => {
  it('Loid F1: a confirmed run with no term, or term ad-hoc, records refused "no class term" and counts nothing', async () => {
    appendClassroomCertification(root, cert());
    await scenario('SC-a');
    for (const term of [undefined, 'ad-hoc', '  ']) {
      const r = await recordProbeRun(root, { scenarioId: 'SC-a', entryId: E, assessor: ASSESSOR, result: 'held', humanConfirmed: true, term });
      expect(r).toMatchObject({ counted: false, outcomeRecorded: true, refusedReason: 'no class term' });
    }
    const sc = await loadScenario(root, 'SC-a');
    expect(sc!.outcome_history.map(o => o.refused)).toEqual(['no class term', 'no class term', 'no class term']);
    expect(readExerciseEvents(root)).toHaveLength(0);
  });

  it('Loid F2: a legacy scenario without authored_by still counts, flagged authorUnknown', async () => {
    appendClassroomCertification(root, cert());
    await scenario('SC-legacy', { authored_by: undefined });
    const r = await held('SC-legacy');
    expect(r).toMatchObject({ counted: true, authorUnknown: true });
    await scenario('SC-a');
    expect((await held('SC-a')).authorUnknown).toBeUndefined();
  });

  it('Loid ruling 2: a run on a (non-pill) scenario the learner drilled carries a note', async () => {
    appendClassroomCertification(root, cert({ ts: ago(5) }));
    await scenario('SC-a');
    await recordProbeRun(root, { scenarioId: 'SC-a', entryId: E, assessor: LEARNER, result: 'held', humanConfirmed: false });
    const r = await held('SC-a');
    expect(r.counted).toBe(true);
    expect(r.notes).toEqual(['the learner drilled this scenario before']);
  });

  it('Loid F5: an unstamped row is judged by the file it sits in, never the configured default home', async () => {
    appendClassroomCertification(root, cert({ home: 'user' }));
    const userLedger = pathFor('classroom-exercises', 'user', root);
    fs.mkdirSync(path.dirname(userLedger), { recursive: true });
    // Unstamped but authored: the union reader would tag it with the default (repo).
    fs.writeFileSync(userLedger, JSON.stringify({
      ts: new Date().toISOString(), certEntryId: E, orchestrationId: 'scn:SC-old', agent: LEARNER, kind: 'adversarial-probe', author: 'ue:testauthor00',
    }) + '\n');
    await scenario('SC-a');
    expect((await held('SC-a')).survived).toBe(true);
  });

  it('Loid flag b: a user-home cert break keeps reason and scenario prose out of the committed ledger', async () => {
    appendClassroomCertification(root, cert({ home: 'user' }));
    await scenario('SC-a', { scenario: 'secret prose about my setup' });
    await recordProbeRun(root, { scenarioId: 'SC-a', entryId: E, assessor: ASSESSOR, result: 'broke', humanConfirmed: true, term: TERM, reason: 'my private reason' });
    expect(readFieldFailures(root)[0].detail).toBe('scenario SC-a broke');
  });

  it('Judge 1: two racing broke runs write one probe-break row and revise down once', async () => {
    appendClassroomCertification(root, cert());
    await scenario('SC-a');
    const run = () => recordProbeRun(root, { scenarioId: 'SC-a', entryId: E, assessor: ASSESSOR, result: 'broke', humanConfirmed: true, term: TERM });
    const [a, b] = await Promise.all([run(), run()]);
    expect([a.counted, b.counted].filter(Boolean)).toHaveLength(1);
    expect(readFieldFailures(root)).toHaveLength(1);
    const nb = yaml.load(fs.readFileSync(path.join(root, '.paradigm', 'notebooks', LEARNER, `${E}.yaml`), 'utf8')) as NotebookEntry;
    expect(nb.appliedAndBrokeCount).toBe(1);
  });

  it('Judge 2: a truthy non-boolean humanConfirmed is not a confirmation', async () => {
    appendClassroomCertification(root, cert());
    await scenario('SC-a');
    const r = await held('SC-a', { humanConfirmed: 'yes' as unknown as boolean });
    expect(r.counted).toBe(false);
    expect(r.refusedReason).toMatch(/not human-confirmed/);
  });

  it('Judge 3: a non-git root with an unstamped legacy cert: reruns do not duplicate and survival counts', async () => {
    const prevAssume = process.env.PARADIGM_LEARNING_ASSUME_REPO;
    delete process.env.PARADIGM_LEARNING_ASSUME_REPO;
    resetLearningStoreCaches();
    try {
      const certFile = path.join(root, '.paradigm', 'events', 'classroom-certifications.jsonl');
      fs.mkdirSync(path.dirname(certFile), { recursive: true });
      const legacy = { ...cert() } as Record<string, unknown>;
      fs.writeFileSync(certFile, JSON.stringify(legacy) + '\n'); // no home, no author
      await scenario('SC-a');
      await scenario('SC-b');
      expect((await held('SC-a')).counted).toBe(true);
      const again = await held('SC-a');
      expect(again).toMatchObject({ counted: false, refusedReason: 'already counted' });
      expect(readExerciseEvents(root).filter(e => e.orchestrationId === 'scn:SC-a')).toHaveLength(1);
      expect((await held('SC-b')).survived).toBe(true);
      expect(readClassroomCertifications(root)[0].outcome).toBe('survived');
    } finally {
      if (prevAssume === undefined) delete process.env.PARADIGM_LEARNING_ASSUME_REPO;
      else process.env.PARADIGM_LEARNING_ASSUME_REPO = prevAssume;
      resetLearningStoreCaches();
    }
  });

  it('Judge 4: an unsafe scenario id is refused before any file is touched', async () => {
    appendClassroomCertification(root, cert());
    for (const id of ['../SC-a', 'a/b', 'SC..a', '']) {
      expect((await held(id)).refusedReason).toBe('invalid scenario id');
    }
  });

  it('Judge 5: identities are trimmed and lowercased; a probe for another agent does not bind', async () => {
    appendClassroomCertification(root, cert());
    await scenario('SC-a');
    expect((await held('SC-a', { assessor: '  Builder ' })).refusedReason).toMatch(/assessor is the learner/);
    await scenario('SC-self', { authored_by: 'BUILDER' });
    expect((await held('SC-self')).refusedReason).toMatch(/authored by the learner/);
    await scenario('SC-other', { probes: [{ agent: 'reviewer', learning_ref: E, claim: 'x' }] });
    expect((await held('SC-other')).refusedReason).toMatch(/different agent/);
    expect(readExerciseEvents(root)).toHaveLength(0);
  });

  it('Judge 6: the writers report whether they wrote, and counted follows them', async () => {
    expect(appendExerciseEvents(root, [{ ts: ago(0), certEntryId: E, orchestrationId: '', agent: LEARNER, kind: 'application' }])).toBe(false);
    expect(appendExerciseEvents(root, [{ ts: ago(0), certEntryId: E, orchestrationId: 'o1', agent: LEARNER, kind: 'application' }])).toBe(true);
    expect(appendFieldFailure(root, {
      ts: ago(0), orchestrationId: 'o2', agent: LEARNER, signal: 'reviewer-reject', severity: 'low',
      attributedEntryIds: ['nb-other'], symbols: [], detail: 'x', sourceEvent: 'verdict:dismissed',
    })).toBe(true);
    // Make the exercises ledger unwritable (a directory): the run is not counted.
    const ledger = path.join(root, '.paradigm', 'events', 'classroom-exercises.jsonl');
    fs.rmSync(ledger, { force: true });
    fs.mkdirSync(ledger, { recursive: true });
    appendClassroomCertification(root, cert());
    await scenario('SC-a');
    const r = await held('SC-a');
    expect(r).toMatchObject({ counted: false, refusedReason: 'exercise event could not be written' });
  });

  it('Judge 8: a run whose outcome did not record is not counted', async () => {
    appendClassroomCertification(root, cert());
    // Loadable by id (bank scan) but not at <id>.scenario, so the outcome append fails.
    const dir = path.join(root, '.paradigm', 'curriculum', 'scenarios');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'misnamed.scenario'), yaml.dump({
      id: 'SC-x', scenario: 'x', probes: [{ agent: LEARNER, learning_ref: E, claim: 'c' }], origin: 'authored',
      expected: { must: 'survive' }, outcome_history: [], repeat_failures: 0, status: 'active', authored_by: ASSESSOR,
    }));
    const r = await held('SC-x');
    expect(r).toMatchObject({ outcomeRecorded: false, counted: false, refusedReason: 'outcome not recorded on the scenario' });
    expect(readExerciseEvents(root)).toHaveLength(0);
  });
});

describe('readReprobeMode', () => {
  it('defaults to ask, reads off, and treats anything else as ask', () => {
    expect(readReprobeMode(root)).toBe('ask');
    const cfg = path.join(root, '.paradigm', 'config.yaml');
    fs.mkdirSync(path.dirname(cfg), { recursive: true });
    fs.writeFileSync(cfg, 'version: "1.0"\nproject: t\nclassroom:\n  reprobe: off\n');
    expect(readReprobeMode(root)).toBe('off');
    fs.writeFileSync(cfg, 'version: "1.0"\nproject: t\nclassroom:\n  reprobe: always\n');
    expect(readReprobeMode(root)).toBe('ask');
  });
});
