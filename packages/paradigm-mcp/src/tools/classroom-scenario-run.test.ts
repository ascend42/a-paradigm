/**
 * paradigm_classroom scenario_run (T-2026-11-04-002 slice 1): the op, its
 * legacy alias, scenario_record authored_by, and the status read-out
 * (probeBreakRate, reprobe, pendingCerts, the no-exercise notice going away).
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
  return { mockHome: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'classroom-run-home-')) };
});

vi.mock('os', async importOriginal => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => shared.mockHome };
});

import { handleClassroomTool } from './classroom.js';
import { LEGACY_TOOL_MAP } from './legacy-tool-map.js';
import { appendClassroomCertification, appendExerciseEvents, readClassroomCertifications, readExerciseEvents } from '../utils/field-failures.js';
import { loadScenario } from '../utils/scenario-loader.js';
import { NO_EXERCISE_WRITER_NOTICE } from '@a-company/premise-core';

const LEARNER = 'builder';
const E = 'nb-builder-retry-policy';
let root: string;
let prevAuthor: string | undefined;

const call = async (name: string, args: Record<string, unknown>) =>
  JSON.parse((await handleClassroomTool(name, args, { rootDir: root } as never)).text);

async function record(id: string, authored_by = 'security'): Promise<void> {
  await call('paradigm_scenario_record', {
    id,
    scenario: `breaking case ${id}`,
    probes: [{ agent: LEARNER, learning_ref: E, claim: 'retries are safe' }],
    origin: 'authored',
    expected: { must: 'survive' },
    authored_by,
  });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'classroom-run-root-'));
  prevAuthor = process.env.PARADIGM_AUTHOR;
  process.env.PARADIGM_AUTHOR = 'ue:testauthor00';
  const dir = path.join(root, '.paradigm', 'notebooks', LEARNER);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${E}.yaml`), yaml.dump({
    id: E, context: 'When retrying', snippet: 'backoff', provenance: { source: 'lore' },
    appliedCount: 1, confidence: 0.8, concepts: ['retry'], tags: ['pattern'],
    created: '2026-01-01T00:00:00.000Z', updated: '2026-01-01T00:00:00.000Z',
  }));
  appendClassroomCertification(root, {
    ts: new Date(Date.now() - 60_000).toISOString(), agent: LEARNER, entryId: E, concepts: ['retry'],
    confidenceAtCert: 0.8, certifiedBy: 'peer', outcome: 'pending',
  });
});

afterEach(() => {
  if (prevAuthor === undefined) delete process.env.PARADIGM_AUTHOR;
  else process.env.PARADIGM_AUTHOR = prevAuthor;
  fs.rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(shared.mockHome, { recursive: true, force: true });
});

describe('paradigm_classroom scenario_run', () => {
  it('is reachable as the family op and the legacy name', () => {
    expect(LEGACY_TOOL_MAP.paradigm_scenario_run).toEqual({ tool: 'paradigm_classroom', op: 'scenario_run' });
  });

  it('scenario_record keeps authored_by', async () => {
    await record('SC-a', 'security');
    expect((await loadScenario(root, 'SC-a'))!.authored_by).toBe('security');
  });

  it('T1 via the tool: two held runs survive the cert and the no-exercise notice goes away', async () => {
    await record('SC-a');
    await record('SC-b');
    const before = await call('paradigm_classroom_status', {});
    expect(before.survival).toBe(NO_EXERCISE_WRITER_NOTICE);
    expect(before.reprobe).toBe('ask');
    expect(before.pendingCerts).toEqual([expect.objectContaining({ agent: LEARNER, entryId: E })]);
    expect(before.perAgent[LEARNER].probeBreakRate).toBeNull();

    for (const scenarioId of ['SC-a', 'SC-b']) {
      const r = await call('paradigm_scenario_run', {
        scenarioId, entryId: E, assessor: 'security', result: 'held', human_confirmed: true, term: 't1', ts: '2020-01-01T00:00:00.000Z',
      });
      expect(r.counted).toBe(true);
    }
    const [c] = readClassroomCertifications(root);
    expect(c.outcome).toBe('survived');
    expect(c.exercise).toMatchObject({ timesExercised: 2, adversarialProbes: 2 });

    const after = await call('paradigm_classroom_status', {});
    expect(after.survival).toBeUndefined();
    expect(after.perAgent[LEARNER].repeatFailureRateNote).toBeUndefined();
    expect(after.perAgent[LEARNER].certifications.survived).toBe(1);
    expect(after.perAgent[LEARNER].probeBreakRate).toBe(0);
    expect(after.pendingCerts).toEqual([]);
  });

  it('probeBreakRate = breaks / counted probes', async () => {
    await record('SC-a');
    await record('SC-b');
    await call('paradigm_scenario_run', { scenarioId: 'SC-a', entryId: E, assessor: 'security', result: 'held', human_confirmed: true, term: 't1' });
    await call('paradigm_scenario_run', { scenarioId: 'SC-b', entryId: E, assessor: 'security', result: 'broke', human_confirmed: true, term: 't1' });
    const s = await call('paradigm_classroom_status', {});
    expect(s.perAgent[LEARNER].probeBreakRate).toBe(0.5);
    expect(s.totals.probeBreakRate).toBe(0.5);
  });

  it('human_confirmed false is a drill: outcome recorded, nothing counted', async () => {
    await record('SC-a');
    const r = await call('paradigm_scenario_run', { scenarioId: 'SC-a', entryId: E, assessor: 'security', result: 'held', human_confirmed: false, term: 't1' });
    expect(r).toMatchObject({ counted: false, outcomeRecorded: true });
    expect(readExerciseEvents(root)).toHaveLength(0);
  });

  it('rejects a call missing required args or with a bad result (Judge 7)', async () => {
    expect((await call('paradigm_scenario_run', { scenarioId: 'SC-a', entryId: E, result: 'held', human_confirmed: true })).missing).toEqual(['assessor']);
    const bad = await call('paradigm_scenario_run', { scenarioId: 'SC-a', entryId: E, assessor: 'security', result: 'passed', human_confirmed: true });
    expect(bad.field).toBe('result');
    expect(bad.error).toMatch(/result/);
    const noConfirm = await call('paradigm_scenario_run', { scenarioId: 'SC-a', entryId: E, assessor: 'security', result: 'held' });
    expect(noConfirm.field).toBe('human_confirmed');
  });

  it('Judge 4: unsafe ids are refused by scenario_run and scenario_record', async () => {
    const run = await call('paradigm_scenario_run', { scenarioId: '../x', entryId: E, assessor: 'security', result: 'held', human_confirmed: true, term: 't1' });
    expect(run.field).toBe('scenarioId');
    const rec = await call('paradigm_scenario_record', {
      id: 'a/../b', scenario: 'x', probes: [], origin: 'authored', expected: { must: 'survive' }, authored_by: 'security',
    });
    expect(rec.field).toBe('id');
  });

  it('Loid F2: scenario_record requires authored_by', async () => {
    const r = await call('paradigm_scenario_record', {
      id: 'SC-noauthor', scenario: 'x', probes: [], origin: 'authored', expected: { must: 'survive' },
    });
    expect(r.field).toBe('authored_by');
    expect(await loadScenario(root, 'SC-noauthor')).toBeNull();
  });

  it('Loid flag a: a probe that only broke still clears the no-exercise notice', async () => {
    await record('SC-a');
    await call('paradigm_scenario_run', { scenarioId: 'SC-a', entryId: E, assessor: 'security', result: 'broke', human_confirmed: true, term: 't1' });
    expect(readExerciseEvents(root)).toHaveLength(0);
    const s = await call('paradigm_classroom_status', {});
    expect(s.survival).toBeUndefined();
    expect(s.perAgent[LEARNER].probeBreakRate).toBe(1);
  });

  it('Loid F6: the probe-break rate skips confounded rows and is labelled all-time', async () => {
    appendExerciseEvents(root, [{ ts: new Date().toISOString(), certEntryId: E, orchestrationId: 'scn:x', agent: LEARNER, kind: 'adversarial-probe', attribution: 'confounded' }]);
    const s = await call('paradigm_classroom_status', {});
    expect(s.perAgent[LEARNER].probeBreakRate).toBeNull();
    expect(s.totals.probeBreakRateWindow).toBe('all-time');
  });

  it('Loid F6: the probe-break rate reads by physical home (a forged repo row claiming user does not count)', async () => {
    const ledger = path.join(root, '.paradigm', 'events', 'classroom-exercises.jsonl');
    fs.mkdirSync(path.dirname(ledger), { recursive: true });
    fs.writeFileSync(ledger, JSON.stringify({ ts: new Date().toISOString(), certEntryId: E, orchestrationId: 'scn:f', agent: LEARNER, kind: 'adversarial-probe', home: 'user' }) + '\n');
    expect((await call('paradigm_classroom_status', {})).perAgent[LEARNER].probeBreakRate).toBeNull();
  });

  it('Judge 9: pendingCerts is bounded with a total count', async () => {
    for (let i = 0; i < 55; i++) {
      appendClassroomCertification(root, {
        ts: new Date().toISOString(), agent: LEARNER, entryId: `nb-builder-${i}`, concepts: [], confidenceAtCert: 0.5, certifiedBy: 'peer', outcome: 'pending',
      });
    }
    const s = await call('paradigm_classroom_status', {});
    expect(s.pendingCerts).toHaveLength(50);
    expect(s.pendingCertsTotal).toBe(56);
  });

  it('status reads classroom.reprobe off from config', async () => {
    fs.writeFileSync(path.join(root, '.paradigm', 'config.yaml'), 'version: "1.0"\nproject: t\nclassroom:\n  reprobe: off\n');
    expect((await call('paradigm_classroom_status', {})).reprobe).toBe('off');
  });
});
