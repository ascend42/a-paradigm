/**
 * Scoped learning S2: `paradigm migrate learning-stores --scopes`.
 * Dry run by default; --apply copies own rows to the user home and stamps the
 * repo rows migrated; authorless verdicts need a confirm; idempotent; a
 * project without git gets its user-home repo records offered back after git init.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { migrateLearningScopes } from '../src/commands/migrate-learning-scopes.js';
import { appendLearningRows, pathFor, resetLearningStoreCaches } from '../../paradigm-mcp/src/utils/learning-stores.js';
import { readPendingVerdicts } from '../../paradigm-mcp/src/utils/session-work-log.js';

let root: string;
let prevAuthor: string | undefined;
const rows = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : []);

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'scopes-mig-')));
  prevAuthor = process.env.PARADIGM_AUTHOR;
  process.env.PARADIGM_AUTHOR = 'me';
  resetLearningStoreCaches();
});
afterEach(() => {
  if (prevAuthor === undefined) delete process.env.PARADIGM_AUTHOR;
  else process.env.PARADIGM_AUTHOR = prevAuthor;
  fs.rmSync(root, { recursive: true, force: true });
  resetLearningStoreCaches();
});

describe('migrate learning-stores --scopes', () => {
  it('dry run writes nothing; --apply copies own and confirmed authorless rows, stamps migrated; idempotent', async () => {
    const repoFile = path.join(root, '.paradigm', 'events', 'verdicts.jsonl');
    fs.mkdirSync(path.dirname(repoFile), { recursive: true });
    const legacy = [
      { timestamp: 't1', type: 'user-verdict', nominationId: 'n1', author: 'me' },
      { timestamp: 't2', type: 'user-verdict', nominationId: 'n2', author: 'bob' },
      { timestamp: 't3', type: 'user-verdict', nominationId: 'n3' },
    ];
    fs.writeFileSync(repoFile, legacy.map(r => JSON.stringify(r)).join('\n') + '\n');
    const before = fs.readFileSync(repoFile, 'utf8');
    const userFile = pathFor('verdicts', 'user', root);

    const dry = await migrateLearningScopes(root);
    expect(dry.dryRun).toBe(true);
    expect(dry.steps.map(s => [s.kind, s.rows, s.status])).toEqual([['own-rows', 1, 'planned'], ['authorless-verdicts', 1, 'planned']]);
    expect(fs.readFileSync(repoFile, 'utf8')).toBe(before);
    expect(fs.existsSync(userFile)).toBe(false);

    // declining the confirm leaves authorless rows alone
    const declined = await migrateLearningScopes(root, { apply: true, confirm: async () => false });
    expect(declined.steps.find(s => s.kind === 'authorless-verdicts')!.status).toBe('declined');
    expect(rows(userFile).map(r => r.nominationId)).toEqual(['n1']);

    const applied = await migrateLearningScopes(root, { apply: true, confirm: async () => true });
    expect(applied.steps.map(s => s.status)).toEqual(['done']);
    expect(rows(userFile).map(r => [r.nominationId, r.author, r.home])).toEqual([['n1', 'me', 'user'], ['n3', 'me', 'user']]);
    const repo = rows(repoFile);
    expect(repo.map(r => r.migrated === true)).toEqual([true, false, true]);
    expect(repo[1]).toEqual(legacy[1]); // a teammate's row is untouched

    // twice is safe
    const again = await migrateLearningScopes(root, { apply: true, yes: true });
    expect(again.steps).toEqual([]);
    expect(rows(userFile)).toHaveLength(2);

    // union readers see each verdict once (the frozen repo copies are skipped)
    expect(readPendingVerdicts(root).map(v => v.nominationId).sort()).toEqual(['n1', 'n3']);
  });

  it('offers no-git user records back to the repo after git init', async () => {
    const prev = process.env.PARADIGM_LEARNING_ASSUME_REPO;
    delete process.env.PARADIGM_LEARNING_ASSUME_REPO;
    try {
      fs.mkdirSync(path.join(root, '.paradigm'), { recursive: true });
      const written = appendLearningRows('overrides', root, [{ timestamp: 't', remediation_id: 'rmd-1' }]);
      expect(written.startsWith(root)).toBe(false); // no git: user home
      fs.mkdirSync(path.join(root, '.git'));
      resetLearningStoreCaches();
      const res = await migrateLearningScopes(root, { apply: true, yes: true });
      expect(res.steps).toEqual([expect.objectContaining({ artifact: 'overrides', kind: 'back-to-repo', status: 'done', rows: 1 })]);
      const repoFile = path.join(root, '.paradigm', 'events', 'overrides.jsonl');
      expect(rows(repoFile)).toEqual([{ timestamp: 't', remediation_id: 'rmd-1', home: 'repo' }]);
      expect(fs.existsSync(written)).toBe(false);
      expect((await migrateLearningScopes(root, { apply: true, yes: true })).steps).toEqual([]);
    } finally {
      if (prev !== undefined) process.env.PARADIGM_LEARNING_ASSUME_REPO = prev;
    }
  });
});
