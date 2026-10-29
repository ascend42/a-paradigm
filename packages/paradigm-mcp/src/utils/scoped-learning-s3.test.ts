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
import { learningGuardViolations } from './learning-commit-guard.js';

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
  it('repo location words name repo, explicitly', () => {
    expect(inferTeachHome('security, check rate limiting on auth routes for this repo')).toMatchObject({ home: 'repo', source: 'explicit' });
    expect(inferTeachHome('in this project we never mock the db')).toMatchObject({ home: 'repo', source: 'explicit' });
  });

  it('personal location words name user, explicitly', () => {
    expect(inferTeachHome('for me, prefer small commits')).toMatchObject({ home: 'user', source: 'explicit' });
    expect(inferTeachHome('everywhere: no emojis in output')).toMatchObject({ home: 'user', source: 'explicit' });
    expect(inferTeachHome('in every project, pin node')).toMatchObject({ home: 'user', source: 'explicit' });
  });

  it('a repo symbol or a repo path alone only infers repo', () => {
    const sym = inferTeachHome('check #payment-form before shipping');
    expect(sym).toMatchObject({ home: 'repo', source: 'inferred' });
    expect(sym.repoSignals).toContain('names #payment-form');
    expect(inferTeachHome('read packages/paradigm-mcp/src/utils/learning-stores.ts first')).toMatchObject({ home: 'repo', source: 'inferred' });
  });

  it('bare "here" and "always" are not location words', () => {
    expect(inferTeachHome("here's the rule: prefer early returns").home).toBeNull();
    expect(inferTeachHome('always write the test first').home).toBeNull();
    expect(inferTeachHome('use pnpm here').home).toBeNull();
  });

  it('ambiguous (no signal, or both sides) → null, so the caller asks', () => {
    expect(inferTeachHome('prefer early returns').home).toBeNull();
    expect(inferTeachHome('for me, in this project, use tabs').home).toBeNull();
  });

  it('words beat symbols: "for me" naming a symbol is user, explicit', () => {
    expect(inferTeachHome('for me, check #auth-gate first')).toMatchObject({ home: 'user', source: 'explicit' });
  });
});

describe('teach: resolveJournalHome and home_source', () => {
  it('an explicit home is explicit unless the caller says inferred', () => {
    expect(resolveJournalHome({ home: 'repo' })).toEqual({ home: 'repo', home_source: 'explicit' });
    expect(resolveJournalHome({ home: 'user', home_source: 'inferred' })).toEqual({ home: 'user', home_source: 'inferred' });
  });

  it('"for this repo" records explicit, in a public repo too', () => {
    expect(resolveJournalHome({ taught_text: 'for this repo, run lint first' })).toEqual({ home: 'repo', home_source: 'explicit' });
    expect(resolveJournalHome({ taught_text: 'for this repo, run lint first', visibility: 'public' })).toEqual({ home: 'repo', home_source: 'explicit' });
  });

  it('symbol-only teach asks in a public repo (unset counts as public), records inferred in a private one', () => {
    expect(resolveJournalHome({ taught_text: 'check #payment-form first' })).toMatchObject({ ask: TEACH_HOME_QUESTION });
    expect(resolveJournalHome({ taught_text: 'check #payment-form first', visibility: 'public' })).toMatchObject({ ask: TEACH_HOME_QUESTION });
    expect(resolveJournalHome({ taught_text: 'check #payment-form first', visibility: 'private' })).toEqual({ home: 'repo', home_source: 'inferred' });
  });

  it('asks ONE question when the words do not settle it', () => {
    expect(resolveJournalHome({ taught_text: 'prefer early returns' })).toMatchObject({ ask: TEACH_HOME_QUESTION });
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

  it('"for me" names the home: recorded explicit, confirmation shows it', async () => {
    const res = await record({ taught_text: 'for me, check rate limiting' });
    expect(res).toMatchObject({ recorded: true, home: 'user', home_source: 'explicit' });
    expect(res.confirmation).toContain('Home: user');
  });

  it('symbol-only teach in a public repo (no visibility set) asks; private records inferred', async () => {
    const asked = await record({ taught_text: 'check #auth-gate rate limiting' });
    expect(asked).toMatchObject({ recorded: false, ask: 'This repo or just you?' });
    fs.mkdirSync(path.join(root, '.paradigm'), { recursive: true });
    fs.writeFileSync(path.join(root, '.paradigm', 'config.yaml'), 'learning:\n  visibility: private\n');
    const rec = await record({ taught_text: 'check #auth-gate rate limiting' });
    expect(rec).toMatchObject({ recorded: true, home: 'repo', home_source: 'inferred' });
  });

  it('a teach answered "this repo" passes the commit guard; an un-taught inferred entry is still caught', async () => {
    const answered = await record({ agent: 'warden', taught_text: 'check #auth-gate', home: 'repo', home_source: 'explicit', transferable: false, confidence_after: 0.9 });
    expect(answered).toMatchObject({ recorded: true, home: 'repo', home_source: 'explicit' });
    autoPromoteJournalEntries(root, 'warden');
    const dir = path.join(root, '.paradigm', 'notebooks', 'warden');
    const files = fs.readdirSync(dir);
    expect(files.length).toBe(1);
    const staged = [{ path: `.paradigm/notebooks/warden/${files[0]}`, content: fs.readFileSync(path.join(dir, files[0]), 'utf8') }];
    expect(learningGuardViolations(staged)).toEqual([]);
    // An entry that never went through teach (inferred) is what the guard catches.
    const raw = { path: '.paradigm/notebooks/warden/nb-x.yaml', content: 'id: nb-x\nhome_source: inferred\ntags: [human-taught]\n' };
    expect(learningGuardViolations([raw]).map(v => v.rule)).toEqual(['human-feedback-public']);
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
