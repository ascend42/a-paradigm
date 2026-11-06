/**
 * #doctor history storage audit (T-2026-11-06-001): an unmigrated repository
 * (pre-v4 post-commit, tracked index.yaml, no merge=union, duplicate legacy
 * ids) is reported; a migrated one is ok.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { historyAuditChecks, duplicateLegacyIds, HISTORY_MIGRATION_FIX } from './history-audit.js';
import { ensureHistoryGitattributes, ensureSessionMarkersGitignore, untrackGeneratedState } from '../../core/session-markers-gitignore.js';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function repo(): { root: string; git: (...a: string[]) => string } {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'pdg-ha-')));
  dirs.push(root);
  const cfg = path.join(root, '..', `${path.basename(root)}.gitconfig`);
  fs.writeFileSync(cfg, '');
  dirs.push(cfg);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: cfg, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const git = (...a: string[]) => execFileSync('git', a, { cwd: root, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q');
  return { root, git };
}

describe('historyAuditChecks', () => {
  it('reports each unmigrated symptom, then ok after sync + hooks install', () => {
    const { root, git } = repo();
    const h = path.join(root, '.paradigm', 'history');
    fs.mkdirSync(h, { recursive: true });
    const row = (id: string, c: string) => JSON.stringify({ id, ts: '2026-01-01T00:00:00Z', type: 'implement', symbols: ['#a'], author: { type: 'human', id: 't' }, commit: c.repeat(40) });
    fs.writeFileSync(path.join(h, 'log.jsonl'), [row('h0001', 'a'), row('h0002', 'b'), row('h0002', 'c')].join('\n') + '\n');
    fs.writeFileSync(path.join(h, 'index.yaml'), 'version: "1.0"\n');
    fs.writeFileSync(path.join(root, '.git', 'hooks', 'post-commit'), '#!/bin/sh\n# Paradigm post-commit hook - captures history from commits\n# Installed by: paradigm hooks install\n# paradigm-hook-version: 3\n');
    git('add', '-A');
    git('commit', '-qm', 'init');

    const names = historyAuditChecks(root).map((c) => `${c.name}:${c.status}`);
    expect(names).toEqual(['History hook:warn', 'History index:warn', 'History merge:warn', 'History ids:info']);
    expect(historyAuditChecks(root)[0].fix).toBe(HISTORY_MIGRATION_FIX);
    expect(duplicateLegacyIds(root)).toEqual(['h0002']);

    // migrate: what `paradigm sync` and `paradigm hooks install` do
    ensureSessionMarkersGitignore(path.join(root, '.paradigm'));
    ensureHistoryGitattributes(root);
    untrackGeneratedState(root);
    fs.writeFileSync(path.join(root, '.git', 'hooks', 'post-commit'), '#!/bin/sh\n# Paradigm post-commit hook - x\n# Installed by: paradigm hooks install\n# paradigm-hook-version: 4\n');
    expect(historyAuditChecks(root).map((c) => `${c.name}:${c.status}`)).toEqual(['History ids:info']);
  });

  it('is ok in a clean repository and silent outside git', () => {
    const { root } = repo();
    fs.mkdirSync(path.join(root, '.paradigm'));
    expect(historyAuditChecks(root)).toEqual([{ name: 'History', status: 'ok', message: 'derived from git; index generated and ignored' }]);
    const plain = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'pdg-ha-nogit-')));
    dirs.push(plain);
    fs.mkdirSync(path.join(plain, '.paradigm'));
    expect(historyAuditChecks(plain)).toEqual([]);
  });
});
