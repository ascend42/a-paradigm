/**
 * W2 falsifiers (#fabric-mirror, #fabric-writer, #fabric-adopt, #mirror-audit,
 * #git-run) — one per W1 review finding, real git, scratch repos only (the real
 * repo's .git is never written: every repo here lives under os.tmpdir() and git
 * runs with all GIT_* env stripped).
 */

import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { recordPick } from '../src/fabric/pick.js';
import { withFabricLock } from '../src/fabric/lock.js';
import { verifyFabric } from '../src/fabric/verify.js';
import { appendStrand, readFabric, warplineDirOf } from '../src/fabric/fabric.js';
import { openSection, publish, parseLedger, MirrorRefusal } from '../src/fabric/git-mirror.js';
import { readWriterId } from '../src/fabric/writer.js';
import { gitSpawnCount, resetGitSpawnCount, resetGitBinaryCache } from '../src/fabric/git-run.js';
import { mirrorObjectWrites, resetMirrorObjectWrites } from '../src/fabric/mirror-tree.js';
import { pushFabric, pinGenesis, adoptCommand, mirrorStatus, migrateToMirror } from '../src/fabric/mirror-sync.js';
import { installPrePushHook } from '../src/fabric/hook.js';
import { assertCandidate, planMerge } from '../src/fabric/adopt.js';
import { buildStrandV3, computePickId } from '../src/fabric/strand.js';
import { readBlobsCapped } from '../src/fabric/mirror-tree.js';
import { repairFabric } from '../src/fabric/repair.js';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_CLI = path.join(PKG_ROOT, 'dist', 'cli.js');
const ENV: NodeJS.ProcessEnv = (() => {
  const e: NodeJS.ProcessEnv = { ...process.env, WARPLINE_FSYNC: 'none', WARPLINE_AGENT_ID: '', WARPLINE_ROOT: '' };
  for (const k of Object.keys(e)) if (k.startsWith('GIT_')) delete e[k];
  return e;
})();
const BRANCH = 'refs/heads/warpline/fabric';
const tmpRoots: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
function gitIn(cwd: string, input: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: ENV, encoding: 'utf8', input }).trim();
}
function tmp(prefix: string): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpRoots.push(d);
  return d;
}
function configure(dir: string): void {
  git(dir, 'config', 'user.email', 'w2@warpline.test');
  git(dir, 'config', 'user.name', 'Warpline W2');
  git(dir, 'config', 'commit.gpgsign', 'false');
}
/** A repo on the 0.3.0 layout: .warpline/ ignored except the tracked config. */
function mkRepo(prefix = 'wl-w2-'): string {
  const dir = tmp(prefix);
  git(dir, 'init', '-q', '-b', 'main');
  configure(dir);
  fs.writeFileSync(path.join(dir, '.gitignore'), '.warpline/*\n!.warpline/config.json\n');
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const a = 0;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}
let counter = 0;
async function seal(dir: string): Promise<void> {
  counter++;
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), `export const a = ${counter};\nexport function f${counter}() { return ${counter}; }\n`);
  git(dir, 'add', 'src');
  git(dir, 'commit', '-q', '-m', `c${counter}`);
  await recordPick(dir, { cwd: dir, ref: 'HEAD', intent: `c${counter}` });
}
const ledger = (dir: string): Buffer => {
  try {
    return fs.readFileSync(path.join(dir, '.warpline', 'fabric.jsonl'));
  } catch {
    return Buffer.alloc(0);
  }
};
const ids = (b: Buffer): string[] => parseLedger(b).lines.map((l) => l.pickId);
const refsOf = (dir: string, pattern = 'refs/'): string => git(dir, 'for-each-ref', '--format=%(objectname) %(refname)', pattern);
const ownRef = (dir: string): string => `refs/warpline/writers/${readWriterId(path.join(dir, '.git'))}`;
const writerAt = (dir: string, rev: string): string => git(dir, 'cat-file', 'blob', `${rev}:writer`);
const recorded = (dir: string, rev: string): string[] => {
  const segs = git(dir, 'ls-tree', '--name-only', `${rev}:ledger`).split('\n').filter(Boolean);
  return segs.flatMap((s) => ids(Buffer.from(git(dir, 'cat-file', 'blob', `${rev}:ledger/${s}`) + '\n')));
};

const OLD_GITIGNORE = '.warpline/*\n!.warpline/fabric.jsonl\n!.warpline/fabric-legacy.json\n!.warpline/config.json\n!.warpline/refs/\n.warpline/refs/*\n!.warpline/refs/selvage\n!.warpline/refs/heads/\n.warpline/refs/heads/*\n!.warpline/refs/heads/selvage\n';
/** A pre-0.3.0 repo: one seal with the ledger + tips TRACKED and no record refs (sealed by 0.2.x). */
async function legacyRepo(prefix: string): Promise<string> {
  const dir = tmp(prefix);
  git(dir, 'init', '-q', '-b', 'main');
  configure(dir);
  fs.writeFileSync(path.join(dir, '.gitignore'), OLD_GITIGNORE);
  fs.mkdirSync(path.join(dir, 'src'));
  fs.writeFileSync(path.join(dir, 'src', 'a.ts'), 'export const a = 0;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'init');
  await recordPick(dir, { cwd: dir, ref: 'HEAD', intent: 'legacy' });
  for (const r of git(dir, 'for-each-ref', '--format=%(refname)', 'refs/warpline', BRANCH).split('\n').filter(Boolean)) git(dir, 'update-ref', '-d', r);
  fs.rmSync(path.join(dir, '.git', 'warpline'), { recursive: true, force: true });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'track ledger (pre-0.3.0)');
  return dir;
}

/** canonical repo with N seals, pinned + pushed to a bare remote. */
async function canonicalWithRemote(n: number): Promise<{ dir: string; remote: string }> {
  const remote = path.join(tmp('wl-w2-remote-'), 'r.git');
  git(path.dirname(remote), 'init', '-q', '--bare', '-b', 'main', remote);
  const dir = mkRepo();
  git(dir, 'remote', 'add', 'origin', remote);
  for (let i = 0; i < n; i++) await seal(dir);
  pinGenesis(dir);
  git(dir, 'add', '.warpline/config.json');
  git(dir, 'commit', '-q', '-m', 'pin');
  git(dir, 'push', '-q', 'origin', 'main');
  expect(pushFabric(dir).action).toBe('pushed');
  return { dir, remote };
}

afterAll(() => {
  for (const d of tmpRoots) fs.rmSync(d, { recursive: true, force: true });
});

describe('W2 record — mirror-first, prefix rule, restore (I4, L4, I7, C-6)', () => {
  it('a seal records to git first: own ref + canonical branch hold exactly the ledger; the tree stays clean', async () => {
    const dir = mkRepo();
    await seal(dir);
    await seal(dir);
    const own = ownRef(dir);
    expect(git(dir, 'rev-parse', own)).toBe(git(dir, 'rev-parse', BRANCH));
    expect(recorded(dir, own)).toEqual(ids(ledger(dir)));
    expect(writerAt(dir, BRANCH)).toBe(readWriterId(path.join(dir, '.git')));
    expect(git(dir, 'status', '--porcelain')).toBe('');
    expect(verifyFabric(dir).failures).toEqual([]);
  });

  it('hand-truncate → seal refuses (nothing written) and the prefix is auto-restored; verify flags mirror-orphan', async () => {
    const dir = mkRepo();
    await seal(dir);
    await seal(dir);
    await seal(dir);
    const full = ledger(dir);
    const lines = full.toString('utf8').trim().split('\n');
    // an out-of-band EDIT that drops a middle strand (not a prefix) → refuse
    fs.writeFileSync(path.join(dir, '.warpline', 'fabric.jsonl'), [lines[0], lines[2]].join('\n') + '\n');
    expect(verifyFabric(dir).failures.some((f) => f.kind === 'mirror-orphan')).toBe(true);
    const before = refsOf(dir, 'refs/warpline') + refsOf(dir, BRANCH);
    await expect(seal(dir)).rejects.toThrow(/TRUNCATION|does not match its record/);
    expect(refsOf(dir, 'refs/warpline') + refsOf(dir, BRANCH)).toBe(before);
    // a PREFIX (tail cut) is restored by the next section, then exactly one strand appends
    fs.writeFileSync(path.join(dir, '.warpline', 'fabric.jsonl'), lines[0] + '\n');
    await seal(dir);
    expect(ids(ledger(dir)).slice(0, 3)).toEqual(ids(full));
    expect(ids(ledger(dir)).length).toBe(4);
  });

  it('I7: a reordered ledger fails verify (prefix rule) and refuses a seal', async () => {
    const dir = mkRepo();
    await seal(dir);
    await seal(dir);
    const lines = ledger(dir).toString('utf8').trim().split('\n');
    fs.writeFileSync(path.join(dir, '.warpline', 'fabric.jsonl'), [lines[1], lines[0]].join('\n') + '\n');
    const v = verifyFabric(dir);
    expect(v.failures.filter((f) => f.kind === 'mirror-orphan').length).toBe(2);
    await expect(withFabricLock(dir, () => undefined)).rejects.toThrow(MirrorRefusal);
  });

  it('deleted ledger (git clean -X) → the next seal restores it and appends exactly one strand', async () => {
    const dir = mkRepo();
    await seal(dir);
    await seal(dir);
    const before = ids(ledger(dir));
    fs.rmSync(path.join(dir, '.warpline', 'fabric.jsonl'));
    fs.rmSync(path.join(dir, '.warpline', 'refs'), { recursive: true, force: true });
    await seal(dir);
    const after = ids(ledger(dir));
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.length).toBe(before.length + 1);
    expect(verifyFabric(dir).failures).toEqual([]);
  });

  it('I4/L4: a CAS conflict writes no strand; the retry seals exactly once; a crash between ref and file is restored', async () => {
    const dir = mkRepo();
    await seal(dir);
    const wdir = warplineDirOf(dir);
    const strands = readFabric(wdir);
    const n0 = ids(ledger(dir)).length;
    // CAS: move the own ref behind the section's back, then publish
    await expect(
      withFabricLock(dir, () => {
        git(dir, 'update-ref', ownRef(dir), git(dir, 'commit-tree', `${git(dir, 'rev-parse', `${ownRef(dir)}^{tree}`)}`, '-m', 'x'));
        appendStrand(wdir, { ...strands[0], pickId: 'pick:v2:cas-probe' } as never);
      }),
    ).rejects.toThrow(/CAS|record moved/);
    expect(ids(ledger(dir)).length).toBe(n0); // no strand written
    git(dir, 'update-ref', ownRef(dir), git(dir, 'rev-parse', BRANCH));
    await seal(dir);
    expect(ids(ledger(dir)).length).toBe(n0 + 1); // exactly once
    // crash seam: record ahead of the file (publish ran, file write lost)
    const full = ledger(dir);
    fs.writeFileSync(path.join(dir, '.warpline', 'fabric.jsonl'), full.subarray(0, full.indexOf(0x0a) + 1));
    await withFabricLock(dir, () => undefined);
    expect(ledger(dir).equals(full)).toBe(true);
  });

  it('a ledger write outside #fabric-lock in a recorded repo refuses', async () => {
    const dir = mkRepo();
    await seal(dir);
    const s = readFabric(warplineDirOf(dir))[0];
    expect(() => appendStrand(warplineDirOf(dir), s)).toThrow(/outside #fabric-lock/);
  });

  it('I9: ≤6 #git-run spawns and ≤1 segment blob per seal', async () => {
    const dir = mkRepo();
    await seal(dir);
    resetGitSpawnCount();
    resetMirrorObjectWrites();
    await seal(dir);
    expect(gitSpawnCount()).toBeLessThanOrEqual(6);
    expect(mirrorObjectWrites().blob).toBeLessThanOrEqual(1);
  });
});

describe('W2 layout — pre-migration checkouts, unmigrated repos (I1, I2, I3)', () => {
  it('I2: a pre-migration checkout refuses writes with a clean tree; back on main the next seal restores + appends one', async () => {
    const dir = await legacyRepo('wl-w2-i2-');
    const old = git(dir, 'rev-parse', 'HEAD');
    const m = await migrateToMirror(dir, { push: false });
    expect(m.untracked).toContain('.warpline/fabric.jsonl');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'migrate');
    await seal(dir);
    const n = ids(ledger(dir)).length;
    git(dir, 'checkout', '-q', old); // bisect-style
    expect(git(dir, 'status', '--porcelain')).toBe('');
    await expect(withFabricLock(dir, () => undefined)).rejects.toThrow(/pre-migration|still TRACKS/);
    expect(git(dir, 'status', '--porcelain')).toBe('');
    git(dir, 'checkout', '-q', 'main'); // the old ledger file is deleted by checkout (untracked on main)
    await seal(dir);
    expect(ids(ledger(dir)).length).toBe(n + 1);
  });

  it('I1: `mirror adopt` on an unmigrated repo refuses and leaves git status unchanged', async () => {
    const dir = await legacyRepo('wl-w2-i1-');
    const status = git(dir, 'status', '--porcelain');
    await expect(adoptCommand(dir, { fetch: false })).rejects.toThrow(/mirror adopt refused/);
    expect(git(dir, 'status', '--porcelain')).toBe(status);
    expect(refsOf(dir, 'refs/warpline')).toBe('');
  });

  it('I3: an own-ref restore whose ledger holds a diverged tail refuses before any write', async () => {
    const dir = mkRepo();
    await seal(dir);
    await seal(dir);
    const lines = ledger(dir).toString('utf8').trim().split('\n');
    const forged = JSON.stringify({ ...JSON.parse(lines[1]), pickId: 'pick:v2:diverged' });
    fs.writeFileSync(path.join(dir, '.warpline', 'fabric.jsonl'), [lines[0], forged].join('\n') + '\n');
    const before = ledger(dir);
    const refs = refsOf(dir);
    await expect(withFabricLock(dir, () => undefined)).rejects.toThrow(MirrorRefusal);
    expect(ledger(dir).equals(before)).toBe(true);
    expect(refsOf(dir)).toBe(refs);
  });
});

describe('W2 writers — linked worktrees (B2, M5, I5)', () => {
  it('linked worktrees seal into their own refs; the canonical branch only ever carries main\'s writer id; re-add → new id', async () => {
    const dir = mkRepo();
    await seal(dir);
    const mainId = readWriterId(path.join(dir, '.git'));
    const wts = [path.join(tmp('wl-w2-wt-'), 'a'), path.join(tmp('wl-w2-wt-'), 'b')];
    wts.forEach((w, i) => git(dir, 'worktree', 'add', '-q', '-b', `wt${i}`, w));
    for (let k = 0; k < 10; k++) {
      const w = k % 3 === 0 ? dir : wts[k % 2];
      await seal(w);
    }
    for (const c of git(dir, 'rev-list', BRANCH).split('\n')) expect(writerAt(dir, c)).toBe(mainId);
    const wtIds = wts.map((w) => readWriterId(git(w, 'rev-parse', '--absolute-git-dir')));
    expect(new Set([mainId, ...wtIds]).size).toBe(3);
    for (const id of wtIds) expect(refsOf(dir, `refs/warpline/writers/${id}`)).not.toBe('');
    // remove + re-add the same name → a NEW id; the old ref is untouched
    const oldRef = refsOf(dir, `refs/warpline/writers/${wtIds[0]}`);
    git(dir, 'worktree', 'remove', '--force', wts[0]);
    git(dir, 'worktree', 'add', '-q', wts[0], 'wt0');
    await seal(wts[0]);
    const newId = readWriterId(git(wts[0], 'rev-parse', '--absolute-git-dir'));
    expect(newId).not.toBe(wtIds[0]);
    expect(refsOf(dir, `refs/warpline/writers/${wtIds[0]}`)).toBe(oldRef);
  });

  it('a linked worktree push never moves the remote branch', async () => {
    const { dir, remote } = await canonicalWithRemote(1);
    const tip = git(remote, 'rev-parse', BRANCH);
    const w = path.join(tmp('wl-w2-wtp-'), 'w');
    git(dir, 'worktree', 'add', '-q', '-b', 'side', w);
    await seal(w);
    expect(pushFabric(w).action).toBe('not-canonical');
    expect(git(remote, 'rev-parse', BRANCH)).toBe(tip);
  });
});

describe('W2 adoption — fresh, shallow, pinned clones (B1, H2, H1)', () => {
  it('B1: a default clone seals → line 1 = pinned genesis, fork, no genesis minted, remote unchanged', async () => {
    const { remote, dir } = await canonicalWithRemote(2);
    const tip = git(remote, 'rev-parse', BRANCH);
    const clone = path.join(tmp('wl-w2-clone-'), 'c');
    git(path.dirname(clone), 'clone', '-q', remote, clone);
    configure(clone);
    await seal(clone);
    expect(ids(ledger(clone))[0]).toBe(ids(ledger(dir))[0]);
    expect(ids(ledger(clone)).slice(0, 2)).toEqual(ids(ledger(dir)));
    expect(mirrorStatus(clone).role).toBe('fork');
    expect(['not-canonical', 'nothing-to-push']).toContain(pushFabric(clone).action);
    expect(git(remote, 'rev-parse', BRANCH)).toBe(tip);
  });

  it('B1/H2: --single-branch --depth 1 → refused (no ledger), then `mirror adopt` (fetch) succeeds', async () => {
    const { remote, dir } = await canonicalWithRemote(2);
    const clone = path.join(tmp('wl-w2-shallow-'), 'c');
    git(path.dirname(clone), 'clone', '-q', '--single-branch', '--depth', '1', `file://${remote}`, clone);
    configure(clone);
    await expect(seal(clone)).rejects.toThrow(/second genesis|already has fabric history/);
    expect(ids(ledger(clone))).toEqual([]);
    const r = await adoptCommand(clone);
    expect(r.action).toBe('fast-forward');
    expect(ids(ledger(clone))).toEqual(ids(ledger(dir)));
  });

  it('pin set, no branch anywhere → refused', async () => {
    const dir = mkRepo();
    fs.mkdirSync(path.join(dir, '.warpline'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.warpline', 'config.json'), JSON.stringify({ fabricMirror: { genesis: 'pick:v2:elsewhere' } }));
    await expect(seal(dir)).rejects.toThrow(/second genesis|already has fabric history/);
    expect(ids(ledger(dir))).toEqual([]);
  });

  it('H1: a canonical commit carrying a forged (bad pickId) strand is refused; ledger, refs, cursor byte-identical', async () => {
    const { remote, dir } = await canonicalWithRemote(2);
    // forge: append a copy of the tip with a changed intent (pickId no longer recomputes)
    const lines = ledger(dir).toString('utf8').trim().split('\n');
    const forged = JSON.stringify({ ...JSON.parse(lines[lines.length - 1]), intent: 'forged' });
    const tip = git(dir, 'rev-parse', BRANCH);
    const blob = gitIn(dir, [...lines, forged].join('\n') + '\n', 'hash-object', '-w', '--stdin');
    const lt = gitIn(dir, `100644 blob ${blob}\t000000.jsonl\n`, 'mktree');
    const rootEntries = git(dir, 'ls-tree', tip).split('\n').filter((l) => !l.endsWith('\tledger'));
    const rt = gitIn(dir, [...rootEntries, `040000 tree ${lt}\tledger`].join('\n') + '\n', 'mktree');
    const c = git(dir, 'commit-tree', rt, '-p', tip, '-m', 'forged');
    git(dir, 'push', '-q', 'origin', `${c}:${BRANCH}`);
    const clone = path.join(tmp('wl-w2-h1-'), 'c');
    git(path.dirname(clone), 'clone', '-q', remote, clone);
    configure(clone);
    await expect(seal(clone)).rejects.toThrow(/adopt refused/);
    expect(ids(ledger(clone))).toEqual([]);
    expect(refsOf(clone, BRANCH)).toBe('');
    expect(refsOf(clone, 'refs/warpline')).toBe('');
    expect(fs.existsSync(path.join(clone, '.git', 'warpline', 'audit.json'))).toBe(false);
  });

  it('rows 5-6: a truncating fast-forward and a force-push on the remote are both detected', async () => {
    const { remote, dir } = await canonicalWithRemote(3);
    const clone = path.join(tmp('wl-w2-r56-'), 'c');
    git(path.dirname(clone), 'clone', '-q', remote, clone);
    configure(clone);
    await seal(clone); // adopts (sets the audit cursor), then forks
    // row 5: fast-forward commit whose ledger dropped strands
    const tip = git(dir, 'rev-parse', BRANCH);
    const first = ledger(dir).toString('utf8').split('\n')[0];
    const blob = gitIn(dir, first + '\n', 'hash-object', '-w', '--stdin');
    const lt = gitIn(dir, `100644 blob ${blob}\t000000.jsonl\n`, 'mktree');
    const rootEntries = git(dir, 'ls-tree', tip).split('\n').filter((l) => !l.endsWith('\tledger'));
    const rt = gitIn(dir, [...rootEntries, `040000 tree ${lt}\tledger`].join('\n') + '\n', 'mktree');
    const trunc = git(dir, 'commit-tree', rt, '-p', tip, '-m', 'truncate');
    git(dir, 'push', '-q', 'origin', `${trunc}:${BRANCH}`);
    git(clone, 'fetch', '-q');
    expect(verifyFabric(clone).failures.some((f) => f.kind === 'mirror-chain-truncation')).toBe(true);
    // row 6: force-push an unrelated history
    const lone = git(dir, 'commit-tree', rt, '-m', 'rewrite');
    git(dir, 'push', '-q', '--force', 'origin', `${lone}:${BRANCH}`);
    git(clone, 'fetch', '-q', '--force');
    expect(verifyFabric(clone).failures.some((f) => f.kind === 'canonical-rewound')).toBe(true);
  });
});

describe('W2 git-run — env, failures (M3, M4, I6)', () => {
  it('M4: foreign GIT_DIR / GIT_INDEX_FILE / GIT_WORK_TREE → only the correct repo changes', async () => {
    const dir = mkRepo();
    await seal(dir);
    const foreign = mkRepo('wl-w2-foreign-');
    const saved = { ...process.env };
    process.env.GIT_DIR = path.join(foreign, '.git');
    process.env.GIT_WORK_TREE = foreign;
    process.env.GIT_INDEX_FILE = path.join(foreign, '.git', 'index');
    try {
      const m = openSection(dir);
      expect(m.mode).toBe('mirror');
      if (m.mode === 'mirror') publish(m.section, m.section.bytes, { message: 'm4 probe' });
    } finally {
      for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
    expect(refsOf(foreign, 'refs/warpline')).toBe('');
    expect(refsOf(foreign, 'refs/heads/warpline')).toBe('');
    expect(git(dir, 'log', '-1', '--format=%s', ownRef(dir))).toBe('m4 probe');
  });

  it('M3: core.repositoryformatversion=99 → seal refuses, verify reports mirror-unavailable', async () => {
    const dir = mkRepo();
    await seal(dir);
    const cfgPath = path.join(dir, '.git', 'config');
    const orig = fs.readFileSync(cfgPath, 'utf8');
    fs.writeFileSync(cfgPath, orig.replace(/repositoryformatversion = \d+/, 'repositoryformatversion = 99'));
    try {
      await expect(withFabricLock(dir, () => undefined)).rejects.toThrow(/git could not answer/);
      expect(verifyFabric(dir).failures.some((f) => f.kind === 'mirror-unavailable')).toBe(true);
    } finally {
      fs.writeFileSync(cfgPath, orig);
    }
  });

  it('I6: WARPLINE_GIT pointing nowhere → refuses; an empty PATH still finds git', async () => {
    const dir = mkRepo();
    await seal(dir);
    const saved = { git: process.env.WARPLINE_GIT, path: process.env.PATH };
    try {
      process.env.WARPLINE_GIT = path.join(dir, 'no-such-git');
      resetGitBinaryCache();
      await expect(withFabricLock(dir, () => undefined)).rejects.toThrow(/git could not answer|not available/);
      delete process.env.WARPLINE_GIT;
      process.env.PATH = '';
      resetGitBinaryCache();
      if (process.platform !== 'win32') await withFabricLock(dir, () => undefined); // usual locations
    } finally {
      if (saved.git === undefined) delete process.env.WARPLINE_GIT;
      else process.env.WARPLINE_GIT = saved.git;
      process.env.PATH = saved.path;
      resetGitBinaryCache();
    }
  });
});

describe('W2 push + hook (M6, L2)', () => {
  it('the pre-push block is opt-in, lands before a trailing exit 0, restores $? and skips a URL $1', () => {
    const dir = mkRepo();
    const hook = path.join(dir, '.git', 'hooks', 'pre-push');
    fs.writeFileSync(hook, '#!/bin/sh\necho user-hook\nexit 0\n');
    fs.chmodSync(hook, 0o755);
    expect(fs.readFileSync(hook, 'utf8')).not.toContain('warpline mirror push');
    installPrePushHook(hook, { node: process.execPath, script: path.join(dir, 'missing-cli.js') });
    const text = fs.readFileSync(hook, 'utf8');
    expect(text.indexOf('# >>> warpline mirror push >>>')).toBeLessThan(text.indexOf('exit 0'));
    expect(text).toMatch(/\n\(exit \$_wl_hook_rc\)\n# <<< warpline mirror push <<</);
    if (process.platform !== 'win32') {
      const r = spawnSync('sh', [hook, 'https://example.invalid/r.git', 'https://example.invalid/r.git'], { cwd: dir, env: ENV, encoding: 'utf8', input: '' });
      expect(r.status).toBe(0);
      expect(fs.readFileSync(path.join(dir, '.git', 'warpline-hook.log'), 'utf8')).toMatch(/not a configured remote name/);
      git(dir, 'remote', 'add', 'origin', 'ssh://example.invalid/r.git');
      const r2 = spawnSync('sh', [hook, 'origin', 'x'], { cwd: dir, env: ENV, encoding: 'utf8', input: '' });
      expect(r2.status).toBe(0); // a failing binary never fails the push
    }
  });
});

/** Push a canonical commit whose ledger is `transform(lines)` (a forger with push rights; fast-forward). */
function pushForged(dir: string, transform: (lines: string[]) => string[]): void {
  const lines = ledger(dir).toString('utf8').trim().split('\n');
  const tip = git(dir, 'rev-parse', BRANCH);
  const blob = gitIn(dir, transform(lines).join('\n') + '\n', 'hash-object', '-w', '--stdin');
  const lt = gitIn(dir, `100644 blob ${blob}\t000000.jsonl\n`, 'mktree');
  const rootEntries = git(dir, 'ls-tree', tip).split('\n').filter((l) => !l.endsWith('\tledger'));
  const rt = gitIn(dir, [...rootEntries, `040000 tree ${lt}\tledger`].join('\n') + '\n', 'mktree');
  git(dir, 'push', '-q', 'origin', `${git(dir, 'commit-tree', rt, '-p', tip, '-m', 'forged')}:${BRANCH}`);
}
async function cloneAndSealRefused(remote: string, re: RegExp): Promise<string> {
  const clone = path.join(tmp('wl-w2-h1v-'), 'c');
  git(path.dirname(clone), 'clone', '-q', remote, clone);
  configure(clone);
  await expect(seal(clone)).rejects.toThrow(re);
  expect(ids(ledger(clone))).toEqual([]);
  expect(refsOf(clone, 'refs/warpline')).toBe('');
  expect(fs.existsSync(path.join(clone, '.git', 'warpline', 'audit.json'))).toBe(false);
  return clone;
}

describe('W2 adoption policy — H1 variants', () => {
  it('an incoming UNBOUND v2 strand is refused (binding required)', async () => {
    const { dir, remote } = await canonicalWithRemote(2);
    pushForged(dir, (l) => {
      const t = JSON.parse(l[l.length - 1]);
      delete t.binding;
      return [...l.slice(0, -1), JSON.stringify(t)];
    });
    await cloneAndSealRefused(remote, /no byte binding/);
  });

  it('an incoming strand with a C-4 chain break (valid pickId, wrong parentStateId) is refused', async () => {
    const { dir, remote } = await canonicalWithRemote(2);
    pushForged(dir, (l) => {
      const prev = JSON.parse(l[l.length - 1]);
      const { pickId: _p, ...body } = { ...prev, seq: prev.seq + 1, parentPickId: prev.pickId, parentStateId: 'state:v0:' + '0'.repeat(64), intent: 'c4' };
      return [...l, JSON.stringify({ ...body, pickId: computePickId(body) })];
    });
    await cloneAndSealRefused(remote, /chain-break/);
  });

  const v3 = (parents: string[], n: number, treeId: string) =>
    buildStrandV3({
      parents,
      stateId: `state:v0:${String(n).padStart(64, '0')}`,
      actor: 't',
      intent: `v3-${n}`,
      recordedAt: '2026-11-05T00:00:00.000Z',
      objectCount: 0,
      delta: { born: [], retired: [], contractChanged: [], renamedNoop: 0 },
      provenance: { ref: 'worktree', treeSha: null, gitCommit: null },
      binding: { treeId },
    });
  const asLines = (xs: ReturnType<typeof v3>[]) => parseLedger(Buffer.from(xs.map((x) => JSON.stringify(x)).join('\n') + '\n')).lines;

  it('a v3 union whose incoming binding objects are ABSENT is accepted; a CORRUPT object is refused', () => {
    const root = tmp('wl-w2-v3-');
    const absent = 'tree:v1:' + 'a'.repeat(64);
    const g = v3([], 0, absent);
    const a = v3([g.pickId], 1, absent);
    const b = v3([g.pickId], 2, 'tree:v1:' + 'b'.repeat(64));
    const local = asLines([g, a]);
    const plan = planMerge(local, asLines([g, b]), 'test');
    expect(plan.kind).toBe('union');
    const cand = [...local, ...plan.append];
    expect(() => assertCandidate(root, local, cand, plan.append, 'test')).not.toThrow();
    // corrupt the incoming strand's binding object: present but not re-hashing
    const hex = 'b'.repeat(64);
    fs.mkdirSync(path.join(root, '.warpline', 'objects', 'trees', hex.slice(0, 2)), { recursive: true });
    fs.writeFileSync(path.join(root, '.warpline', 'objects', 'trees', hex.slice(0, 2), hex.slice(2)), 'garbage');
    expect(() => assertCandidate(root, local, cand, plan.append, 'test')).toThrow(/corrupt-object/);
  });

  it('an oversized blob is refused BEFORE its content is read (L3)', () => {
    const dir = mkRepo();
    const oid = gitIn(dir, 'x'.repeat(4096), 'hash-object', '-w', '--stdin');
    expect(() => readBlobsCapped(dir, [oid], 1024)).toThrow(/over the 1024-byte/);
  });
});

describe('W2 direct writers inside a section (repair) never drop recorded strands', () => {
  it('a torn tail is healed from the record at open; repair --confirm afterwards loses nothing', async () => {
    const dir = mkRepo();
    await seal(dir);
    await seal(dir);
    const full = ledger(dir);
    const cut = full.subarray(0, full.length - 20); // torn last line
    fs.writeFileSync(path.join(dir, '.warpline', 'fabric.jsonl'), cut);
    await repairFabric(dir, { confirm: true });
    expect(ids(ledger(dir))).toEqual(ids(full));
    await withFabricLock(dir, () => undefined);
    expect(ledger(dir).equals(full)).toBe(true);
    expect(verifyFabric(dir).failures).toEqual([]);
  });
});
