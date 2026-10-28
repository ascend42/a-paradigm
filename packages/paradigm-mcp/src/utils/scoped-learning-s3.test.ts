/**
 * Scoped learning S3 (TD-2026-10-28-820): teach infers a lesson's home from
 * the human's words (asks once when they do not settle it), home_source is
 * recorded explicit or inferred and carried to the notebook, and a class
 * sign-off can flip or confirm the home.
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
  return { mockHome: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'scoped-s3-home-')) };
});

vi.mock('os', async importOriginal => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, homedir: () => shared.mockHome };
});

import { inferTeachHome, resolveJournalHome, teachConfirmationLine, TEACH_HOME_QUESTION } from './teach-home.js';
import { handleStreamsTool } from '../tools/streams.js';
import { loadJournalEntries, recordJournalEntry } from './journal-loader.js';
import { autoPromoteJournalEntries, gatedPromoteJournalEntry } from './nomination-engine.js';
import { loadNotebookEntries } from './notebook-loader.js';
import type { ProjectContext } from './index-loader.js';

const mockHome = shared.mockHome;
let root: string;
let prevHome: string | undefined;

beforeEach(() => {
  prevHome = process.env.HOME;
  process.env.HOME = mockHome;
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'scoped-s3-root-'));
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.HOME;
  else process.env.HOME = prevHome;
  for (const sub of ['notebooks', 'agents']) fs.rmSync(path.join(mockHome, '.paradigm', sub), { recursive: true, force: true });
  fs.rmSync(root, { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(mockHome, { recursive: true, force: true });
});

describe('teach: home inference from wording', () => {
  it('repo wording → repo', () => {
    expect(inferTeachHome('security, check rate limiting on auth routes for this repo').home).toBe('repo');
    expect(inferTeachHome('in this project we never mock the db').home).toBe('repo');
    expect(inferTeachHome('use pnpm here').home).toBe('repo');
  });

  it('a repo symbol or a repo path points to repo', () => {
    const sym = inferTeachHome('check #payment-form before shipping');
    expect(sym.home).toBe('repo');
    expect(sym.repoSignals).toContain('names #payment-form');
    expect(inferTeachHome('read packages/paradigm-mcp/src/utils/learning-stores.ts first').home).toBe('repo');
  });

  it('personal wording → user', () => {
    expect(inferTeachHome('for me, prefer small commits').home).toBe('user');
    expect(inferTeachHome('always write the test first').home).toBe('user');
    expect(inferTeachHome('everywhere: no emojis in output').home).toBe('user');
  });

  it('ambiguous (no signal, or both sides) → null, so the caller asks', () => {
    expect(inferTeachHome('prefer early returns').home).toBeNull();
    expect(inferTeachHome('always check #auth-gate').home).toBeNull();
    expect(inferTeachHome('for me, in this project, use tabs').home).toBeNull();
  });
});

describe('teach: resolveJournalHome and home_source', () => {
  it('an explicit home is explicit unless the caller says inferred', () => {
    expect(resolveJournalHome({ home: 'repo' })).toEqual({ home: 'repo', home_source: 'explicit' });
    expect(resolveJournalHome({ home: 'user', home_source: 'inferred' })).toEqual({ home: 'user', home_source: 'inferred' });
  });

  it('taught_text infers (inferred), or asks ONE question when it cannot', () => {
    expect(resolveJournalHome({ taught_text: 'for this repo, run lint first' })).toEqual({ home: 'repo', home_source: 'inferred' });
    const ask = resolveJournalHome({ taught_text: 'prefer early returns' });
    expect(ask).toMatchObject({ ask: TEACH_HOME_QUESTION });
    expect(TEACH_HOME_QUESTION).toBe('This repo or just you?');
  });

  it('no home, no text: inferred (promotionHomeOf derives the home)', () => {
    expect(resolveJournalHome({})).toEqual({ home_source: 'inferred' });
  });

  it('the confirmation line always names the home', () => {
    expect(teachConfirmationLine('security', 'repo', 'inferred')).toContain('Home: repo');
    expect(teachConfirmationLine('security', 'user', 'explicit')).toContain('Home: user');
    expect(teachConfirmationLine('security', 'user', 'explicit')).toContain('you chose it');
  });
});

describe('teach via paradigm_journal_record', () => {
  const ctx = () => ({ rootDir: root } as unknown as ProjectContext);
  const record = async (extra: Record<string, unknown>) => JSON.parse((await handleStreamsTool('paradigm_journal_record', {
    agent: 'security',
    trigger: 'human_feedback',
    insight: 'check rate limiting',
    project: 'p',
    transferable: true,
    tags: ['rate-limit', 'human-taught'],
    ...extra,
  }, ctx())).text);

  it('ambiguous wording records nothing and asks once', async () => {
    const res = await record({ taught_text: 'check rate limiting' });
    expect(res).toMatchObject({ recorded: false, ask: 'This repo or just you?' });
    expect(loadJournalEntries('security')).toHaveLength(0);
  });

  it('the answer is recorded explicit; the confirmation line shows the home', async () => {
    const res = await record({ home: 'repo', home_source: 'explicit' });
    expect(res).toMatchObject({ recorded: true, home: 'repo', home_source: 'explicit' });
    expect(res.confirmation).toContain('Home: repo');
    expect(loadJournalEntries('security')[0]).toMatchObject({ home: 'repo', home_source: 'explicit' });
  });

  it('inferred wording is recorded inferred, with the inferred home', async () => {
    const res = await record({ taught_text: 'for me, check rate limiting' });
    expect(res).toMatchObject({ recorded: true, home: 'user', home_source: 'inferred' });
    expect(res.confirmation).toContain('Home: user');
  });
});

describe('home_source carried to the notebook', () => {
  it('auto-promotion copies the journal home_source (absent → inferred)', () => {
    const j = recordJournalEntry('kit', {
      trigger: 'human_feedback', insight: 'a', confidence_after: 0.9, project: 'p', transferable: false,
      tags: ['thing-a', 'human-taught'], home: 'repo', home_source: 'explicit',
    });
    const k = recordJournalEntry('kit', {
      trigger: 'human_feedback', insight: 'b', confidence_after: 0.9, project: 'p', transferable: false, tags: ['thing-b', 'human-taught'],
    });
    autoPromoteJournalEntries(root, 'kit');
    const nb = loadNotebookEntries('kit', root);
    const byJournal = (id: string) => nb.find(e => e.provenance?.loreEntryId === id);
    expect(byJournal(j.id)?.home_source).toBe('explicit');
    expect(byJournal(k.id)?.home_source).toBe('inferred');
  });

  it('class sign-off: a flip or a confirm records explicit; neither keeps inferred', () => {
    const mk = (tag: string) => recordJournalEntry('kit', {
      trigger: 'pattern_discovered', insight: tag, confidence_after: 0.9, project: 'p', transferable: false, tags: [tag], home_source: 'inferred',
    });
    const flipped = gatedPromoteJournalEntry(root, 'kit', mk('flip-me').id, { home: 'user' });
    expect(flipped).toMatchObject({ promoted: true, home: 'user', home_source: 'explicit' });
    expect(fs.existsSync(path.join(mockHome, '.paradigm', 'notebooks', 'kit'))).toBe(true);
    const confirmed = gatedPromoteJournalEntry(root, 'kit', mk('keep-me').id, { homeConfirmed: true });
    expect(confirmed).toMatchObject({ home: 'repo', home_source: 'explicit' });
    const plain = gatedPromoteJournalEntry(root, 'kit', mk('plain').id);
    expect(plain).toMatchObject({ home: 'repo', home_source: 'inferred' });
  });
});
