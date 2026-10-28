/**
 * Scoped learning S4 (TD-2026-10-28-820): the doctor census per home, the
 * repo/user conflict report for Loid, and population tags on every rate
 * (getNominationStats, the planner's estimate note).
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const shared = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const nodeFs = require('fs') as typeof import('fs');
  const nodePath = require('path') as typeof import('path');
  const nodeOs = require('os') as typeof import('os');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { mockHome: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'scoped-s4-home-')) };
});

vi.mock('os', async importOriginal => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => shared.mockHome };
});

import { appendLearningRows, formatCensusRow, learningCensus, populationOf } from './learning-stores.js';
import { findLearningConflicts } from './notebook-loader.js';
import { getNominationStats } from './nomination-engine.js';
import { rebuildLearnedTable } from './calibration-aggregate.js';
import { classifyTaskLocal, planAgentSequence } from '../tools/orchestration.js';

const mockHome = shared.mockHome;
let root: string;
let prevHome: string | undefined;

beforeEach(() => {
  prevHome = process.env.HOME;
  process.env.HOME = mockHome;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'scoped-s4-root-'));
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  fs.rmSync(path.join(mockHome, '.paradigm', 'notebooks'), { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
  if (process.env.PARADIGM_LEARNING_HOME) fs.rmSync(process.env.PARADIGM_LEARNING_HOME, { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(mockHome, { recursive: true, force: true });
});

const events = (...p: string[]) => path.join(root, '.paradigm', 'events', ...p);
const writeJsonl = (file: string, rows: object[]) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
};

describe('doctor census per home', () => {
  it('counts each store per home, the legacy rows, the last write and the learn-path skips', () => {
    writeJsonl(events('verdicts.jsonl'), [{ nominationId: 'a' }, { nominationId: 'b' }, { nominationId: 'c', author: 'x' }]);
    appendLearningRows('verdicts', root, [{ nominationId: 'd' }, { nominationId: 'e' }]);
    appendLearningRows('team-funnel', root, [{ event: 'x' }]);
    fs.mkdirSync(path.join(root, '.paradigm', '.sessions'), { recursive: true });
    fs.writeFileSync(path.join(root, '.paradigm', '.sessions', 'learn-path-skips'), '2026-10-28T00:00:00Z\tteam-funnel\n2026-10-28T00:00:01Z\tteam-funnel\n');

    const census = learningCensus(root);
    const verdicts = census.find(r => r.artifact === 'verdicts')!;
    expect(verdicts.counts).toEqual({ repo: 3, user: 2, machine: 0 });
    expect(verdicts.legacy).toBe(2);
    expect(verdicts.lastWrite).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const funnel = census.find(r => r.artifact === 'team-funnel')!;
    expect(funnel.counts.machine).toBe(1);
    expect(funnel.skipped).toBe(2);
    expect(census.find(r => r.artifact === 'debates')).toBeUndefined(); // empty stores are left out

    const line = formatCensusRow(verdicts);
    expect(line).toMatch(/^verdicts: repo 3 \(legacy 2\) · user 2 · machine 0 · last write \d{4}-\d{2}-\d{2}$/);
    expect(formatCensusRow(funnel)).toContain('2 skipped (learn-path)');
  });
});

describe('conflict report for Loid', () => {
  const nb = (dir: string, id: string, concepts: string[], snippet: string) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.yaml`), `id: ${id}\ncontext: c\nsnippet: ${snippet}\nconcepts: [${concepts.join(', ')}]\ntags: []\nappliedCount: 0\n`);
  };
  const repoDir = () => path.join(root, '.paradigm', 'notebooks', 'kit');
  const userDir = () => path.join(mockHome, '.paradigm', 'notebooks', 'kit');

  it('reports different ids on one concept with different guidance; never resolves', () => {
    nb(repoDir(), 'nb-kit-jwt', ['jwt'], 'verify the token before the gate');
    nb(userDir(), 'nb-kit-jwt-abc123', ['symbol:jwt', 'auth'], 'skip token checks in tests');
    const before = fs.readdirSync(repoDir()).concat(fs.readdirSync(userDir()));
    const conflicts = findLearningConflicts(root);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({ agent: 'kit', concept: 'jwt', repo: { id: 'nb-kit-jwt' }, user: { id: 'nb-kit-jwt-abc123' } });
    expect(fs.readdirSync(repoDir()).concat(fs.readdirSync(userDir()))).toEqual(before); // report only
  });

  it('the same id, or the same guidance, is not a conflict', () => {
    nb(repoDir(), 'nb-kit-jwt', ['jwt'], 'verify the token');
    nb(userDir(), 'nb-kit-jwt', ['jwt'], 'something else'); // same id: repo wins on read
    nb(userDir(), 'nb-kit-jwt-x', ['jwt'], 'verify the token'); // same guidance
    expect(findLearningConflicts(root)).toEqual([]);
  });
});

describe('calibration population tags', () => {
  it('populationOf names legacy rows legacy-prior', () => {
    expect(populationOf('legacy')).toBe('legacy-prior');
    expect(populationOf('legacy-repo')).toBe('legacy-prior');
    expect(populationOf('user')).toBe('user');
  });

  it('getNominationStats: every rate carries its population', () => {
    const base = { agent: 'kit', relevance: 1, urgency: 'low', type: 'observation', brief: 'b', surfaced: true, timestamp: new Date().toISOString() };
    writeJsonl(events('nominations.jsonl'), [{ ...base, id: 'l1', engaged: true, response: 'dismissed' }]);
    appendLearningRows('nominations', root, [{ ...base, id: 'u1', engaged: true, response: 'accepted' }]);
    const stats = getNominationStats(root, 'kit');
    expect(stats.population).toBe('user');
    expect(stats.byHome.user?.population).toBe('user');
    expect(stats.legacy?.population).toBe('legacy-prior');
  });

  it("the planner's estimate note names the population (learned and legacy-prior)", () => {
    const taskType = classifyTaskLocal('Build the cache').type;
    const row = (total: number) => ({ archetype: 'builder', taskType, actualTokens: { input: 0, output: 0, total } });
    const builder = { name: 'builder', role: 'b', focus: { reads: ['**/*'], writes: ['**/*'] } };
    const plan = () => planAgentSequence('Build the cache', { builder } as never, ['builder'], classifyTaskLocal('Build the cache'), undefined, root);

    writeJsonl(events('estimate-actuals.jsonl'), Array.from({ length: 8 }, (_, i) => row(500 + i)));
    rebuildLearnedTable(root);
    expect(plan().estimatedTokens).toMatchObject({ basis: 'legacy-prior', population: 'legacy-prior' });
    expect(plan().estimatedTokens.note).toContain('[population: legacy-prior]');

    appendLearningRows('estimate-actuals', root, Array.from({ length: 8 }, (_, i) => row(1000 + i)));
    rebuildLearnedTable(root);
    const learned = plan().estimatedTokens;
    expect(learned.population).toBe('user');
    expect(learned.basis).toBeUndefined();
    expect(learned.note).toContain('[population: user]');
  });
});
