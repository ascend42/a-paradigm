/**
 * Scoped learning S0+S1 (TD-2026-10-28-820): the home resolver and its guard,
 * promotion carrying the journal's home, union reads, per-scope calibration,
 * the S1 teammate-verdict rule, and repoIdOf parity with gnomon.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';

const shared = vi.hoisted(() => {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const nodeFs = require('fs') as typeof import('fs');
  const nodePath = require('path') as typeof import('path');
  const nodeOs = require('os') as typeof import('os');
  /* eslint-enable @typescript-eslint/no-require-imports */
  return { mockHome: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'scoped-mock-home-')) };
});

vi.mock('os', async importOriginal => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => shared.mockHome };
});

import {
  appendLearningRows,
  homeOf,
  LearningHomeError,
  listLearningStores,
  pathFor,
  promotionHomeOf,
  readLearningRows,
} from './learning-stores.js';
import { repoIdOf, repoIdSegment } from './repo-id.js';
import { recordJournalEntry } from './journal-loader.js';
import { autoPromoteJournalEntries, gatedPromoteJournalEntry, getNominationStats } from './nomination-engine.js';
import { loadNotebookEntries } from './notebook-loader.js';
import { appendVerdictEntry, markVerdictsConsumed, readPendingVerdicts } from './session-work-log.js';
import { rebuildLearnedTable } from './calibration-aggregate.js';
import { readClassroomCertifications } from './field-failures.js';
import type { JournalEntry } from '../types/knowledge-streams.js';

const mockHome = shared.mockHome;
let root: string;
let prevHome: string | undefined;
let prevAuthor: string | undefined;

beforeEach(() => {
  prevHome = process.env.HOME;
  prevAuthor = process.env.PARADIGM_AUTHOR;
  process.env.HOME = mockHome;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'scoped-root-'));
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  if (prevAuthor === undefined) delete process.env.PARADIGM_AUTHOR;
  else process.env.PARADIGM_AUTHOR = prevAuthor;
  for (const sub of ['notebooks', 'agents']) {
    fs.rmSync(path.join(mockHome, '.paradigm', sub), { recursive: true, force: true });
  }
  fs.rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(mockHome, { recursive: true, force: true });
});

const events = (...p: string[]) => path.join(root, '.paradigm', 'events', ...p);
const writeJsonl = (file: string, rows: object[]) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map(r => JSON.stringify(r)).join('\n') + '\n', 'utf8');
};

function journal(agent: string, over: Partial<JournalEntry>): JournalEntry {
  return recordJournalEntry(agent, {
    trigger: over.trigger ?? 'pattern_discovered',
    insight: over.insight ?? 'guard the jwt middleware',
    confidence_after: over.confidence_after ?? 0.9,
    project: 'scoped-proj',
    transferable: over.transferable ?? true,
    tags: over.tags ?? ['jwt-guard'],
  });
}

describe('resolver: homeOf precedence', () => {
  it('entry home > config default > registry default', () => {
    expect(homeOf('verdicts')).toBe('user');
    expect(homeOf('notebook-refs')).toBe('repo');
    expect(homeOf('team-funnel')).toBe('machine');
    const config = { learning: { default_home: { verdicts: 'repo', nominations: 'bogus' } } };
    expect(homeOf('verdicts', null, config)).toBe('repo');
    expect(homeOf('nominations', null, config)).toBe('user'); // invalid config value falls through
    expect(homeOf('verdicts', { home: 'machine' }, config)).toBe('machine');
  });

  it('reads learning.default_home from .paradigm/config.yaml on write', () => {
    fs.mkdirSync(path.join(root, '.paradigm'), { recursive: true });
    fs.writeFileSync(path.join(root, '.paradigm', 'config.yaml'), 'learning:\n  default_home:\n    debates: repo\n', 'utf8');
    const file = appendLearningRows('debates', root, [{ id: 'd1' }]);
    expect(file).toBe(pathFor('debates', 'repo', root));
  });
});

describe('resolver: write-side guard', () => {
  it('rejects a user write into the repo', () => {
    const inside = path.join(root, 'nested-learning-home');
    expect(() => pathFor('verdicts', 'user', root, { learningHome: inside })).toThrow(LearningHomeError);
    expect(() => appendLearningRows('verdicts', root, [{ verdict: 'accepted' }], { learningHome: inside })).toThrow(
      LearningHomeError,
    );
    expect(fs.existsSync(inside)).toBe(false);
  });

  it('rejects machine data under the repo root too', () => {
    expect(() => pathFor('team-funnel', 'machine', root, { learningHome: path.join(root, '.paradigm') })).toThrow(
      LearningHomeError,
    );
  });

  it('places user and machine stores outside the repo, keyed by repo id', () => {
    const user = pathFor('verdicts', 'user', root);
    const machine = pathFor('team-funnel', 'machine', root);
    expect(user.startsWith(root)).toBe(false);
    expect(user).toContain(path.join('projects', repoIdSegment(root), 'events', 'verdicts.jsonl'));
    expect(machine).toContain(path.join('machine', repoIdSegment(root), 'events', 'team-funnel.jsonl'));
    expect(pathFor('verdicts', 'repo', root)).toBe(events('verdicts.jsonl'));
  });

  it('registers the missing stores with their default homes', () => {
    const byId = Object.fromEntries(listLearningStores(root, { homeDir: mockHome }).map(s => [s.id, s.home]));
    expect(byId).toMatchObject({
      'verdicts': 'user', 'overrides': 'repo', 'provisional-mined': 'user', 'estimate-actuals': 'user',
      'team-funnel': 'machine', 'compliance-history': 'machine', 'notebooks': 'repo', 'notebooks-global': 'user',
    });
  });
});

describe('union read', () => {
  it('repo wins on the same id, and a legacy row (no home, no author) takes the home it was read from', () => {
    writeJsonl(events('nominations.jsonl'), [
      { id: 'n1', agent: 'a', brief: 'repo copy' }, // legacy: no home
      { id: 'n3', agent: 'a', brief: 'repo only' },
    ]);
    appendLearningRows('nominations', root, [
      { id: 'n1', agent: 'a', brief: 'user copy' },
      { id: 'n2', agent: 'a', brief: 'user only' },
    ]);
    const rows = readLearningRows<{ id: string; brief: string }>('nominations', root, { idOf: r => r.id });
    expect(rows.map(r => r.id).sort()).toEqual(['n1', 'n2', 'n3']);
    expect(rows.find(r => r.id === 'n1')!.brief).toBe('repo copy');
    // F2: the legacy repo row is tagged by its file, not the type default, and flagged
    expect(rows.find(r => r.id === 'n3')).toMatchObject({ home: 'repo', legacy: true });
    expect(rows.find(r => r.id === 'n2')!.legacy).toBeUndefined();
    // a row with an author but no home still takes the type default
    writeJsonl(events('verdicts.jsonl'), [{ nominationId: 'v', author: 'someone' }]);
    expect(readLearningRows('verdicts', root)[0]).toMatchObject({ home: 'user' });
    expect((readLearningRows('verdicts', root)[0] as { legacy?: true }).legacy).toBeUndefined();
  });
});

describe('promotion carries the journal home', () => {
  it('teach with transferable:false produces a repo notebook, cert and decision row', () => {
    const j = journal('kit', { transferable: false, tags: ['repo-only-thing'] });
    expect(promotionHomeOf(j)).toBe('repo');
    const res = gatedPromoteJournalEntry(root, 'kit', j.id, { certifiedBy: 'peer' });
    expect(res.promoted).toBe(true);
    const repoDir = path.join(root, '.paradigm', 'notebooks', 'kit');
    expect(fs.readdirSync(repoDir).some(f => f.startsWith(res.notebookId!))).toBe(true);
    expect(fs.existsSync(path.join(mockHome, '.paradigm', 'notebooks', 'kit'))).toBe(false);
    const nb = loadNotebookEntries('kit', root).find(e => e.id === res.notebookId);
    expect(nb?.home).toBe('repo');
    const cert = readClassroomCertifications(root).find(c => c.entryId === res.notebookId);
    expect(cert?.home).toBe('repo');
    expect(fs.existsSync(events('classroom-certifications.jsonl'))).toBe(true);
  });

  it('promotion-decisions sit in the same home as the journal they measure', () => {
    journal('kit', { transferable: false, tags: ['local-pattern'] });
    journal('kit', { transferable: true, tags: ['portable-pattern'] });
    expect(autoPromoteJournalEntries(root, 'kit').promoted).toBe(2);
    const repoRows = fs.readFileSync(events('promotion-decisions.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const userRows = fs.readFileSync(pathFor('promotion-decisions', 'user', root), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    expect(repoRows.map(r => r.concepts[0])).toEqual(['local-pattern']);
    expect(repoRows[0].home).toBe('repo');
    expect(userRows.map(r => r.concepts[0])).toEqual(['portable-pattern']);
    expect(userRows[0].home).toBe('user');
    // and the notebooks followed the same homes
    const homes = Object.fromEntries(loadNotebookEntries('kit', root).map(e => [e.concepts[0], e.home]));
    expect(homes).toEqual({ 'local-pattern': 'repo', 'portable-pattern': 'user' });
  });
});

describe('classroom metrics see every home (F1)', () => {
  it('counts a transferable:true promotion cert from the user home in the tool rollup', async () => {
    const j = journal('kit', { transferable: true, tags: ['portable-cert'] });
    gatedPromoteJournalEntry(root, 'kit', j.id, { certifiedBy: 'peer' });
    expect(fs.existsSync(events('classroom-certifications.jsonl'))).toBe(false);
    const { handleClassroomTool } = await import('../tools/classroom.js');
    const out = await handleClassroomTool('paradigm_classroom_status', {}, { rootDir: root } as never);
    const parsed = JSON.parse(out.text) as { perAgent: Record<string, { certifications: { total: number } }> };
    expect(parsed.perAgent.kit.certifications.total).toBe(1);
  });
});

describe('verdicts', () => {
  it('go to the user home with an author, and never consume a teammate repo verdict', () => {
    process.env.PARADIGM_AUTHOR = 'me';
    appendVerdictEntry(root, { timestamp: 't1', type: 'user-verdict', agent: 'kit', nominationId: 'mine', verdict: 'accepted' });
    expect(fs.existsSync(events('verdicts.jsonl'))).toBe(false);
    writeJsonl(events('verdicts.jsonl'), [
      { timestamp: 't0', type: 'user-verdict', agent: 'kit', nominationId: 'theirs', verdict: 'dismissed', author: 'teammate' },
      { timestamp: 't0', type: 'user-verdict', agent: 'kit', nominationId: 'legacy', verdict: 'revised' },
    ]);
    expect(readPendingVerdicts(root).map(v => v.nominationId).sort()).toEqual(['legacy', 'mine']);
    markVerdictsConsumed(root, ['mine', 'legacy', 'theirs']);
    expect(readPendingVerdicts(root)).toEqual([]);
    const repo = fs.readFileSync(events('verdicts.jsonl'), 'utf8');
    expect(JSON.parse(repo.split('\n')[0]).consumed).toBeUndefined(); // the teammate's row is untouched
  });
});

describe('calibration is per scope', () => {
  it('tags nomination samples and computes accept rates per home', () => {
    const base = { agent: 'kit', relevance: 1, urgency: 'low', type: 'observation', brief: 'b', surfaced: true, timestamp: new Date().toISOString() };
    writeJsonl(events('nominations.jsonl'), [
      { ...base, id: 'r1', engaged: true, response: 'dismissed', home: 'repo' },
      { ...base, id: 'r2', engaged: true, response: 'dismissed', home: 'repo' },
    ]);
    appendLearningRows('nominations', root, [
      { ...base, id: 'u1', engaged: true, response: 'accepted' },
      { ...base, id: 'u2', engaged: true, response: 'dismissed' },
    ]);
    const stats = getNominationStats(root, 'kit');
    expect(stats.home).toBe('user');
    expect(stats.acceptRate).toBe(0.5); // user scope only, not pooled with repo's 0/2
    expect(stats.byHome.repo?.acceptRate).toBe(0);
    expect(stats.byHome.user?.total).toBe(2);
  });

  it('learns token bands from one population and reports the others', () => {
    const row = (total: number) => ({ archetype: 'builder', taskType: 'feature', actualTokens: { input: 0, output: 0, total } });
    appendLearningRows('estimate-actuals', root, Array.from({ length: 8 }, (_, i) => row(1000 + i)));
    writeJsonl(events('estimate-actuals.jsonl'), [{ ...row(99999), home: 'repo' }, row(50000)]);
    const res = rebuildLearnedTable(root)!;
    expect(res.home).toBe('user');
    expect(res.population).toBe('user');
    expect(res.coldStartPrior).toBe(false);
    expect(res.otherHomes).toEqual({ repo: 1 });
    expect(res.legacySamples).toBe(1); // the legacy row is its own population, not pooled
    expect(res.table.builder.feature.n).toBe(8);
    expect(res.table.builder.feature.max).toBeLessThan(2000);
  });

  it('uses legacy rows only as a labelled cold-start prior when the scope has no samples', () => {
    const row = (total: number) => ({ archetype: 'builder', taskType: 'feature', actualTokens: { input: 0, output: 0, total } });
    writeJsonl(events('estimate-actuals.jsonl'), Array.from({ length: 8 }, (_, i) => row(500 + i)));
    const res = rebuildLearnedTable(root)!;
    expect(res.population).toBe('legacy-repo');
    expect(res.coldStartPrior).toBe(true);
    expect(res.table.builder.feature.n).toBe(8);
  });

  it('reports legacy nominations apart and labels a cold-start threshold prior', async () => {
    const base = { agent: 'kit', relevance: 1, urgency: 'low', type: 'observation', brief: 'b', surfaced: true, timestamp: new Date().toISOString() };
    writeJsonl(events('nominations.jsonl'), Array.from({ length: 5 }, (_, i) => ({ ...base, id: `l${i}`, engaged: true, response: 'dismissed' })));
    const stats = getNominationStats(root, 'kit');
    expect(stats.total).toBe(0); // the user scope has no samples
    expect(stats.legacy?.total).toBe(5);
    expect(stats.byHome.repo).toBeUndefined();
    const agents = path.join(root, '.paradigm', 'agents');
    fs.mkdirSync(agents, { recursive: true });
    fs.writeFileSync(path.join(agents, 'kit.agent'), 'id: kit\nrole: test\nattention:\n  threshold: 0.6\n', 'utf8');
    const { adjustAttentionFromFeedback } = await import('./nomination-engine.js');
    const adj = adjustAttentionFromFeedback(root, 'kit');
    expect(adj.population).toBe('legacy-repo');
    expect(adj.reason).toContain('cold-start prior: legacy repo population');
  });
});

describe('repoIdOf parity with gnomon', () => {
  const gnomonSrc = path.resolve(__dirname, '../../../gnomon/src/kernel/supervisor/local-session.ts');

  it('uses project.yaml repoId when present', () => {
    fs.mkdirSync(path.join(root, '.gnomon'), { recursive: true });
    fs.writeFileSync(path.join(root, '.gnomon', 'project.yaml'), 'name: x\nrepoId: "gh:acme/widgets"\n', 'utf8');
    expect(repoIdOf(root)).toBe('gh:acme/widgets');
    expect(repoIdSegment(root)).toBe('gh-acme-widgets');
  });

  it('falls back to path: + sha256(realpath) prefix', () => {
    const expected = `path:${createHash('sha256').update(fs.realpathSync(root)).digest('hex').slice(0, 16)}`;
    expect(repoIdOf(root)).toBe(expected);
  });

  it('matches the gnomon source algorithm (regex and fallback format)', () => {
    if (!fs.existsSync(gnomonSrc)) return; // published-package checkouts carry no gnomon source
    const src = fs.readFileSync(gnomonSrc, 'utf8');
    const fn = src.slice(src.indexOf('export function repoIdOf('), src.indexOf('export function repoIdOf(') + 900);
    expect(fn).toContain(String.raw`/^repoId:\s*['"]?([A-Za-z0-9._:/-]{1,128})['"]?\s*$/m`);
    expect(fn).toContain("path.join(cwd, '.gnomon', 'project.yaml')");
    expect(fn).toContain("fs.realpathSync(cwd)");
    expect(fn).toContain(".digest('hex').slice(0, 16)}`");
  });
});
