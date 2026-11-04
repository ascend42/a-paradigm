/**
 * #lesson-evidence — the checkable lesson schema (advisory).
 *
 * Guards Loid's rules:
 *   - evidenceStrength is pure over (rows, resolver) and returns
 *     none | cited | confounded-only | contradicted | supported (ruling 5);
 *   - a row counts only when its ref resolves, and its verdict is the one the
 *     LEDGER derives; the author's verdict is never read (F1: a source is a
 *     citation, it can never make a lesson supported);
 *   - probe runs and scenarios count only when they are about THIS lesson (F3);
 *   - promotion stores {ref, kind} plus the DERIVED verdict only (F6), on both
 *     the gated and the auto path;
 *   - gated promotion WARNS on confounded-only / contradicted, returns an info
 *     note on none / cited (Judge I6), and never refuses.
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
  return { mockHome: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'lesson-evidence-home-')) };
});

vi.mock('os', async importOriginal => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => shared.mockHome };
});

import {
  deriveLessonEvidence,
  evidenceStrength,
  ledgerEvidenceResolver,
  normalizeLessonEvidence,
  type EvidenceResolver,
} from './lesson-evidence.js';
import { appendExerciseEvents, appendFieldFailure, makeFailureId, type FieldFailureRow } from './field-failures.js';
import { recordJournalEntry } from './journal-loader.js';
import { autoPromoteJournalEntries, gatedPromoteJournalEntry } from './nomination-engine.js';
import { loadNotebookEntries } from './notebook-loader.js';
import type { LessonEvidence } from '../types/notebooks.js';

let root: string;
let prevHome: string | undefined;

beforeEach(() => {
  prevHome = process.env.HOME;
  process.env.HOME = shared.mockHome;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'lesson-evidence-root-'));
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  for (const sub of ['notebooks', 'agents']) {
    fs.rmSync(path.join(shared.mockHome, '.paradigm', sub), { recursive: true, force: true });
  }
  fs.rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(shared.mockHome, { recursive: true, force: true });
});

function failure(orch: string, ids: string[], confounded = false): FieldFailureRow {
  return {
    ts: '2026-11-01T00:00:00.000Z',
    orchestrationId: orch,
    agent: 'kit',
    signal: 'reviewer-reject',
    severity: 'high',
    attributedEntryIds: ids,
    symbols: [],
    detail: 'broke',
    sourceEvent: 'verdict:dismissed',
    ...(confounded ? { attribution: 'confounded' as const } : {}),
  };
}

describe('evidenceStrength (pure, ruling 5)', () => {
  const resolveNone: EvidenceResolver = () => null;

  it('none when there is no evidence or nothing resolves', () => {
    expect(evidenceStrength(undefined, () => 'helped')).toBe('none');
    expect(evidenceStrength([], () => 'helped')).toBe('none');
    expect(evidenceStrength([{ ref: 'x', kind: 'probe-run', verdict: 'helped' }], resolveNone)).toBe('none');
  });

  it('cited when only source citations resolve', () => {
    expect(evidenceStrength([{ ref: 'TD-1', kind: 'source', verdict: 'helped' }], () => 'cited')).toBe('cited');
  });

  it('confounded-only when every derived outcome is confounded (citations do not lift it)', () => {
    const rows: LessonEvidence[] = [
      { ref: 'a', kind: 'field-failure', verdict: 'helped' },
      { ref: 'd', kind: 'source', verdict: 'helped' },
      { ref: 'b', kind: 'probe-run', verdict: 'helped' },
    ];
    const resolve: EvidenceResolver = row => (row.ref === 'a' ? 'confounded' : row.ref === 'd' ? 'cited' : null);
    expect(evidenceStrength(rows, resolve)).toBe('confounded-only');
  });

  it('contradicted when derived outcomes exist but only hurt / no-effect', () => {
    const rows: LessonEvidence[] = [
      { ref: 'a', kind: 'field-failure', verdict: 'helped' },
      { ref: 'c', kind: 'field-failure', verdict: 'helped' },
    ];
    expect(evidenceStrength(rows, row => (row.ref === 'a' ? 'hurt' : 'confounded'))).toBe('contradicted');
    expect(evidenceStrength(rows, () => 'no-effect')).toBe('contradicted');
  });

  it('supported only on a DERIVED helped, whatever the author claims', () => {
    const rows: LessonEvidence[] = [
      { ref: 'a', kind: 'field-failure', verdict: 'confounded' },
      { ref: 'b', kind: 'probe-run', verdict: 'no-effect' },
    ];
    expect(evidenceStrength(rows, row => (row.ref === 'b' ? 'helped' : 'confounded'))).toBe('supported');
    // The author claims helped; the ledger says confounded.
    expect(evidenceStrength([{ ref: 'a', kind: 'field-failure', verdict: 'helped' }], () => 'confounded')).toBe('confounded-only');
  });

  it('L1: a helped AND a hurt row reads contradicted, never supported (the contradiction is not hidden)', () => {
    const resolve: EvidenceResolver = row => (row.ref === 'h' ? 'helped' : row.ref === 'x' ? 'hurt' : null);
    expect(evidenceStrength([{ ref: 'h', kind: 'probe-run', verdict: 'helped' }, { ref: 'x', kind: 'field-failure', verdict: 'helped' }], resolve)).toBe('contradicted');
    expect(evidenceStrength([{ ref: 'x', kind: 'field-failure', verdict: 'helped' }, { ref: 'h', kind: 'probe-run', verdict: 'helped' }], resolve)).toBe('contradicted');
  });

  it('ignores malformed rows and a throwing resolver', () => {
    expect(evidenceStrength([{ ref: '', kind: 'probe-run', verdict: 'helped' }, { kind: 'x' }, 'junk'], () => 'helped')).toBe('none');
    expect(evidenceStrength([{ ref: 'a', kind: 'probe-run', verdict: 'helped' }], () => { throw new Error('boom'); })).toBe('none');
  });

  it('normalizeLessonEvidence keeps only well-formed rows', () => {
    expect(normalizeLessonEvidence('nope')).toBeUndefined();
    expect(normalizeLessonEvidence([{ ref: ' r ', kind: 'source', verdict: 'no-effect' }, { ref: 'r', kind: 'bogus', verdict: 'helped' }]))
      .toEqual([{ ref: 'r', kind: 'source', verdict: 'no-effect' }]);
  });

  it('deriveLessonEvidence keeps {ref, kind} plus the DERIVED verdict; citations carry none; unresolved rows drop', () => {
    const rows: LessonEvidence[] = [
      { ref: 'ff', kind: 'field-failure', verdict: 'helped' },
      { ref: 'TD-1', kind: 'source', verdict: 'helped' },
      { ref: 'gone', kind: 'probe-run', verdict: 'helped' },
    ];
    const resolve: EvidenceResolver = row => (row.ref === 'ff' ? 'hurt' : row.ref === 'TD-1' ? 'cited' : null);
    expect(deriveLessonEvidence(rows, resolve)).toEqual([
      { ref: 'ff', kind: 'field-failure', verdict: 'hurt' },
      { ref: 'TD-1', kind: 'source' },
    ]);
    expect(deriveLessonEvidence(rows, resolveNone)).toBeUndefined();
  });
});

describe('ledgerEvidenceResolver', () => {
  const lessonA = { entryId: 'nb-a' };

  it('field-failure: confounded row derives confounded, attributable derives hurt, unknown does not resolve', () => {
    appendFieldFailure(root, failure('orch-c', ['nb-a', 'nb-b'], true));
    appendFieldFailure(root, failure('orch-x', ['nb-a']));
    const resolve = ledgerEvidenceResolver(root, lessonA);
    expect(resolve({ ref: makeFailureId('orch-c', 'nb-a'), kind: 'field-failure', verdict: 'helped' })).toBe('confounded');
    expect(resolve({ ref: makeFailureId('orch-x', 'nb-a'), kind: 'field-failure', verdict: 'helped' })).toBe('hurt');
    expect(resolve({ ref: makeFailureId('orch-nope', 'nb-a'), kind: 'field-failure', verdict: 'hurt' })).toBeNull();
  });

  it('field-failure (Loid re-review): a failure naming ANOTHER entry is the lesson\'s provenance, a citation, never hurt', () => {
    appendFieldFailure(root, failure('orch-t', ['nb-old']));
    appendFieldFailure(root, failure('orch-tc', ['nb-old', 'nb-other'], true));
    const resolve = ledgerEvidenceResolver(root, lessonA);
    expect(resolve({ ref: makeFailureId('orch-t', 'nb-old'), kind: 'field-failure', verdict: 'hurt' })).toBe('cited');
    expect(resolve({ ref: makeFailureId('orch-tc', 'nb-other'), kind: 'field-failure', verdict: 'hurt' })).toBe('cited');
    // the commonest lesson, a correction born from a break, no longer reads contradicted
    expect(evidenceStrength([{ ref: makeFailureId('orch-t', 'nb-old'), kind: 'field-failure', verdict: 'hurt' }], resolve)).toBe('cited');
  });

  it('probe-run: an adversarial-probe receipt for THIS lesson derives helped; an application receipt does not resolve', () => {
    appendExerciseEvents(root, [
      { ts: '2026-11-01T00:00:00.000Z', certEntryId: 'nb-a', orchestrationId: 'sc-run-1', agent: 'kit', kind: 'adversarial-probe' },
      { ts: '2026-11-01T00:00:00.000Z', certEntryId: 'nb-a', orchestrationId: 'orch-app', agent: 'kit', kind: 'application' },
    ]);
    const resolve = ledgerEvidenceResolver(root, lessonA);
    expect(resolve({ ref: 'sc-run-1', kind: 'probe-run', verdict: 'no-effect' })).toBe('helped');
    expect(resolve({ ref: 'orch-app', kind: 'probe-run', verdict: 'helped' })).toBeNull();
  });

  it('probe-run (F3): a probe of ANOTHER entry does not resolve for this lesson', () => {
    appendExerciseEvents(root, [
      { ts: '2026-11-01T00:00:00.000Z', certEntryId: 'nb-other', orchestrationId: 'sc-run-2', agent: 'kit', kind: 'adversarial-probe' },
    ]);
    expect(ledgerEvidenceResolver(root, lessonA)({ ref: 'sc-run-2', kind: 'probe-run', verdict: 'helped' })).toBeNull();
    expect(ledgerEvidenceResolver(root, { entryId: 'nb-other' })({ ref: 'sc-run-2', kind: 'probe-run', verdict: 'helped' })).toBe('helped');
  });

  it('probe-run (F3): an orchestration with a field failure naming this entry never derives helped', () => {
    appendExerciseEvents(root, [
      { ts: '2026-11-01T00:00:00.000Z', certEntryId: 'nb-a', orchestrationId: 'orch-ba', agent: 'kit', kind: 'break-attempt' },
      { ts: '2026-11-01T00:00:00.000Z', certEntryId: 'nb-a', orchestrationId: 'orch-cf', agent: 'kit', kind: 'adversarial-probe' },
    ]);
    appendFieldFailure(root, failure('orch-ba', ['nb-a']));
    appendFieldFailure(root, failure('orch-cf', ['nb-a', 'nb-b'], true));
    const resolve = ledgerEvidenceResolver(root, lessonA);
    expect(resolve({ ref: 'orch-ba', kind: 'probe-run', verdict: 'helped' })).toBeNull();
    expect(resolve({ ref: 'orch-cf', kind: 'probe-run', verdict: 'helped' })).toBeNull();
  });

  it('scenario-outcome: latest outcome decides; no outcome or unsafe id does not resolve', () => {
    const dir = path.join(root, '.paradigm', 'curriculum', 'scenarios');
    fs.mkdirSync(dir, { recursive: true });
    const probes = [{ agent: 'kit', learning_ref: 'nb-a', claim: 'x' }];
    fs.writeFileSync(path.join(dir, 'SC-held.scenario'), yaml.dump({ id: 'SC-held', probes, outcome_history: [{ result: 'broke' }, { result: 'survived' }] }));
    fs.writeFileSync(path.join(dir, 'SC-fresh.scenario'), yaml.dump({ id: 'SC-fresh', probes, outcome_history: [] }));
    const resolve = ledgerEvidenceResolver(root, lessonA);
    expect(resolve({ ref: 'SC-held', kind: 'scenario-outcome', verdict: 'hurt' })).toBe('helped');
    expect(resolve({ ref: 'SC-fresh', kind: 'scenario-outcome', verdict: 'helped' })).toBeNull();
    expect(resolve({ ref: '../SC-held', kind: 'scenario-outcome', verdict: 'helped' })).toBeNull();
  });

  it('scenario-outcome (F3): a scenario whose target and symbols do not overlap the lesson does not resolve', () => {
    const dir = path.join(root, '.paradigm', 'curriculum', 'scenarios');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SC-other.scenario'), yaml.dump({
      id: 'SC-other', probes: [{ agent: 'kit', learning_ref: 'nb-other', claim: 'x' }], outcome_history: [{ result: 'survived' }],
    }));
    fs.writeFileSync(path.join(dir, 'SC-sym.scenario'), yaml.dump({
      id: 'SC-sym', probes: [{ agent: 'kit', learning_ref: 'nb-other', claim: 'x' }], symbols: ['#auth-middleware'], outcome_history: [{ result: 'survived' }],
    }));
    const resolve = ledgerEvidenceResolver(root, { entryId: 'nb-a', symbols: ['caching'] });
    expect(resolve({ ref: 'SC-other', kind: 'scenario-outcome', verdict: 'helped' })).toBeNull();
    expect(resolve({ ref: 'SC-sym', kind: 'scenario-outcome', verdict: 'helped' })).toBeNull();
    // Symbol overlap counts.
    const bySymbol = ledgerEvidenceResolver(root, { entryId: 'nb-a', symbols: ['auth-middleware'] });
    expect(bySymbol({ ref: 'SC-sym', kind: 'scenario-outcome', verdict: 'helped' })).toBe('helped');
  });

  it('source (F1): a decision id or a path inside the project is a CITATION, never an outcome; the author verdict is ignored', () => {
    fs.mkdirSync(path.join(root, '.paradigm', 'decisions'), { recursive: true });
    fs.writeFileSync(path.join(root, '.paradigm', 'decisions', 'TD-1.yaml'), 'id: TD-1\n');
    fs.writeFileSync(path.join(root, 'NOTES.md'), 'x');
    const resolve = ledgerEvidenceResolver(root, lessonA);
    expect(resolve({ ref: 'TD-1', kind: 'source', verdict: 'helped' })).toBe('cited');
    expect(resolve({ ref: 'NOTES.md', kind: 'source', verdict: 'no-effect' })).toBe('cited');
    expect(resolve({ ref: '../../etc/hosts', kind: 'source', verdict: 'helped' })).toBeNull();
    expect(resolve({ ref: '.', kind: 'source', verdict: 'helped' })).toBeNull();
    expect(evidenceStrength([{ ref: 'TD-1', kind: 'source', verdict: 'helped' }], resolve)).toBe('cited');
  });
});

describe('gated promotion: evidence warns on the wrong direction, notes on absence, never refuses', () => {
  function journal(over: { cue?: string; evidence?: LessonEvidence[]; tags: string[]; trigger?: 'pattern_discovered' }) {
    return recordJournalEntry('kit', {
      trigger: 'pattern_discovered',
      insight: 'guard the jwt middleware',
      confidence_after: 0.9,
      project: 'lesson-proj',
      transferable: false,
      tags: over.tags,
      ...(over.cue ? { cue: over.cue } : {}),
      ...(over.evidence ? { evidence: over.evidence } : {}),
    });
  }
  const notebook = (id?: string) => loadNotebookEntries('kit', root).find(e => e.id === id);

  it('no evidence (legacy): promotes, strength none, NO warning, one info note', () => {
    const j = journal({ tags: ['no-evidence'] });
    const res = gatedPromoteJournalEntry(root, 'kit', j.id, { certifiedBy: 'peer' });
    expect(res.promoted).toBe(true);
    expect(res.evidenceStrength).toBe('none');
    expect(res.warnings).toBeUndefined();
    expect(res.notes).toHaveLength(1);
  });

  it('citations only (F1): strength cited, never supported, no warning; stored row has no verdict', () => {
    fs.mkdirSync(path.join(root, '.paradigm', 'decisions'), { recursive: true });
    fs.writeFileSync(path.join(root, '.paradigm', 'decisions', 'TD-9.yaml'), 'id: TD-9\n');
    const j = journal({ tags: ['cited-evidence'], evidence: [{ ref: 'TD-9', kind: 'source', verdict: 'helped' }] });
    const res = gatedPromoteJournalEntry(root, 'kit', j.id, { certifiedBy: 'peer' });
    expect(res.evidenceStrength).toBe('cited');
    expect(res.warnings).toBeUndefined();
    expect(res.notes?.[0]).toMatch(/citations only/);
    expect(notebook(res.notebookId)?.evidence).toEqual([{ ref: 'TD-9', kind: 'source' }]);
  });

  it('confounded-only evidence: promotes with a warning', () => {
    // the failure names the entry this lesson becomes (stable id nb-<agent>-<concept>)
    appendFieldFailure(root, failure('orch-c', ['nb-kit-confounded-evidence', 'nb-b'], true));
    const j = journal({ tags: ['confounded-evidence'], evidence: [{ ref: makeFailureId('orch-c', 'nb-kit-confounded-evidence'), kind: 'field-failure', verdict: 'hurt' }] });
    const res = gatedPromoteJournalEntry(root, 'kit', j.id, { certifiedBy: 'peer' });
    expect(res.promoted).toBe(true);
    expect(res.evidenceStrength).toBe('confounded-only');
    expect(res.warnings?.[0]).toMatch(/confounded/);
  });

  it('contradicted evidence: the author says helped, the ledger says hurt; promotes with a warning and stores hurt', () => {
    appendFieldFailure(root, failure('orch-h', ['nb-kit-contradicted-evidence']));
    const ref = makeFailureId('orch-h', 'nb-kit-contradicted-evidence');
    const j = journal({ tags: ['contradicted-evidence'], evidence: [{ ref, kind: 'field-failure', verdict: 'helped' }] });
    const res = gatedPromoteJournalEntry(root, 'kit', j.id, { certifiedBy: 'peer' });
    expect(res.promoted).toBe(true);
    expect(res.evidenceStrength).toBe('contradicted');
    expect(res.warnings?.[0]).toMatch(/contradicted/);
    expect(notebook(res.notebookId)?.evidence).toEqual([{ ref, kind: 'field-failure', verdict: 'hurt' }]);
  });

  it('a probe of a DIFFERENT entry does not support this lesson (F3)', () => {
    appendExerciseEvents(root, [
      { ts: '2026-11-01T00:00:00.000Z', certEntryId: 'nb-someone-else', orchestrationId: 'sc-run-7', agent: 'kit', kind: 'adversarial-probe' },
    ]);
    const j = journal({ tags: ['unbound-probe'], evidence: [{ ref: 'sc-run-7', kind: 'probe-run', verdict: 'helped' }] });
    const res = gatedPromoteJournalEntry(root, 'kit', j.id, { certifiedBy: 'peer' });
    expect(res.evidenceStrength).toBe('none');
    expect(notebook(res.notebookId)?.evidence).toBeUndefined();
  });

  it('supported evidence: no warning, no note; cue and DERIVED evidence are carried to the notebook entry', () => {
    // The probe is of the entry this lesson becomes (stable id nb-<agent>-<concept>).
    appendExerciseEvents(root, [
      { ts: '2026-11-01T00:00:00.000Z', certEntryId: 'nb-kit-supported-evidence', orchestrationId: 'sc-run-9', agent: 'kit', kind: 'adversarial-probe' },
    ]);
    const j = journal({
      tags: ['supported-evidence'],
      cue: 'adding a route behind auth',
      evidence: [{ ref: 'sc-run-9', kind: 'probe-run', verdict: 'no-effect' }, { ref: 'sc-run-gone', kind: 'probe-run', verdict: 'helped' }],
    });
    const res = gatedPromoteJournalEntry(root, 'kit', j.id, { certifiedBy: 'peer', refinedForm: 'use requireAuth()' });
    expect(res.promoted).toBe(true);
    expect(res.notebookId).toBe('nb-kit-supported-evidence');
    expect(res.evidenceStrength).toBe('supported');
    expect(res.warnings).toBeUndefined();
    expect(res.notes).toBeUndefined();
    const nb = notebook(res.notebookId);
    expect(nb?.cue).toBe('adding a route behind auth');
    // F6: the author's verdict (no-effect) is not copied; the unresolved row is dropped.
    expect(nb?.evidence).toEqual([{ ref: 'sc-run-9', kind: 'probe-run', verdict: 'helped' }]);
    expect(nb?.snippet).toBe('use requireAuth()'); // the human's refine path is unchanged
  });
});

describe('auto promotion stores derived evidence too (F6)', () => {
  it('never copies the author verdict onto the notebook entry', () => {
    appendFieldFailure(root, failure('orch-auto', ['nb-kit-auto-evidence']));
    const ref = makeFailureId('orch-auto', 'nb-kit-auto-evidence');
    recordJournalEntry('kit', {
      trigger: 'pattern_discovered',
      insight: 'auto-promoted lesson',
      confidence_after: 0.95,
      project: 'lesson-proj',
      transferable: false,
      tags: ['auto-evidence'],
      evidence: [{ ref, kind: 'field-failure', verdict: 'helped' }, { ref: 'nope', kind: 'probe-run', verdict: 'helped' }],
    });
    const res = autoPromoteJournalEntries(root, 'kit');
    const promoted = res.entries.find(e => e.notebookId.includes('auto-evidence'));
    expect(promoted).toBeTruthy();
    const nb = loadNotebookEntries('kit', root).find(e => e.id === promoted?.notebookId);
    expect(nb?.evidence).toEqual([{ ref, kind: 'field-failure', verdict: 'hurt' }]);
  });
});
