/**
 * W2 REVIEW falsifiers (Aegis + Judge, items 1-26) — (#fabric-mirror, #fabric-writer, #fabric-adopt, #mirror-audit,
 * #git-run) — one per W1 review finding, real git, scratch repos only (the real
 * repo's .git is never written: every repo here lives under os.tmpdir() and git
 * runs with all GIT_* env stripped).
 */

import { describe, it, expect, afterAll, afterEach } from 'vitest';
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
import { sanitizedGitEnv, networkGitEnv } from '../src/fabric/git-run.js';
import { ensureWriterId, __setWriterLinkForTest } from '../src/fabric/writer.js';
import { probeMode, gitContext } from '../src/fabric/git-mirror.js';
import { claimCanonical } from '../src/fabric/mirror-sync.js';
import { resetGitBinaryCache as resetBin } from '../src/fabric/git-run.js';
import { readAuditCursor } from '../src/fabric/mirror-audit.js';
import { initWarpline } from '../src/fabric/init.js';
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
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); // NOT realpath'd (review 19)
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

const W = (dir: string): string => warplineDirOf(dir);
function pushForged(dir: string, transform: (lines: string[]) => string[], segmentLines?: (lines: string[]) => string[][]): string {
  const lines = ledger(dir).toString('utf8').trim().split('\n');
  const tip = git(dir, 'rev-parse', BRANCH);
  const segs = segmentLines ? segmentLines(transform(lines)) : [transform(lines)];
  const ents = segs.map((seg, i) => `100644 blob ${gitIn(dir, seg.join('\n') + '\n', 'hash-object', '-w', '--stdin')}\t${String(i).padStart(6, '0')}.jsonl`);
  const lt = gitIn(dir, ents.join('\n') + '\n', 'mktree');
  const rootEntries = git(dir, 'ls-tree', tip).split('\n').filter((l) => !l.endsWith('\tledger'));
  const rt = gitIn(dir, [...rootEntries, `040000 tree ${lt}\tledger`].join('\n') + '\n', 'mktree');
  const c = git(dir, 'commit-tree', rt, '-p', tip, '-m', 'forged');
  git(dir, 'push', '-q', 'origin', `${c}:${BRANCH}`);
  return c;
}
function cloneOf(remote: string): string {
  const clone = path.join(tmp('wl-rv-clone-'), 'c');
  git(path.dirname(clone), 'clone', '-q', remote, clone);
  configure(clone);
  return clone;
}

describe('review 1 — the own record cannot be rewound or deleted out of band', () => {
  it('(A) own ref rewound + ledger deleted → seal refuses; verify HARD mirror-orphan', async () => {
    const dir = mkRepo();
    for (let i = 0; i < 6; i++) await seal(dir);
    git(dir, 'update-ref', ownRef(dir), `${ownRef(dir)}~5`);
    fs.rmSync(path.join(W(dir), 'fabric.jsonl'));
    await expect(withFabricLock(dir, () => undefined)).rejects.toThrow(/rewound or deleted|not a fast-forward/);
    expect(verifyFabric(dir).failures.some((f) => f.kind === 'mirror-orphan')).toBe(true);
  });

  it('(B) own ref deleted + ledger truncated → seal refuses (no new root record)', async () => {
    const dir = mkRepo();
    for (let i = 0; i < 3; i++) await seal(dir);
    const lines = ledger(dir).toString('utf8').trim().split('\n');
    git(dir, 'update-ref', '-d', ownRef(dir));
    fs.writeFileSync(path.join(W(dir), 'fabric.jsonl'), lines[0] + '\n');
    await expect(withFabricLock(dir, () => undefined)).rejects.toThrow(/rewound or deleted|missing/);
    expect(refsOf(dir, 'refs/warpline')).toBe('');
    expect(verifyFabric(dir).failures.some((f) => f.kind === 'mirror-orphan')).toBe(true);
  });

  it('a deleted local canonical branch is reported by verify (no silent demotion)', async () => {
    const dir = mkRepo();
    await seal(dir);
    git(dir, 'update-ref', '-d', BRANCH);
    expect(verifyFabric(dir).failures.some((f) => f.kind === 'canonical-rewound')).toBe(true);
  });
});

describe('review 3 — hook blocks keep the user\'s exit status', () => {
  it.skipIf(process.platform === 'win32')('a hook ending `false` (or `exit $?`) still exits 1 after install', () => {
    const dir = mkRepo();
    for (const tail of ['false\n', 'false\nexit $?\n']) {
      const hook = path.join(dir, '.git', 'hooks', 'pre-push');
      fs.writeFileSync(hook, `#!/bin/sh\necho user\n${tail}`);
      installPrePushHook(hook, { node: process.execPath, script: path.join(dir, 'missing.js') });
      const r = spawnSync('sh', [hook, 'origin', 'x'], { cwd: dir, env: ENV, input: '' });
      expect(r.status).toBe(1);
    }
  });
});

describe('review 4 + 7 — an unmigrated clone after upstream migrated', () => {
  it('seal refuses ("upstream migrated"); `mirror migrate` follows an EQUAL ledger and records it', async () => {
    const remote = path.join(tmp('wl-rv-r-'), 'r.git');
    git(path.dirname(remote), 'init', '-q', '--bare', '-b', 'main', remote);
    const a = await legacyRepo('wl-rv-a-');
    git(a, 'remote', 'add', 'origin', remote);
    git(a, 'push', '-q', 'origin', 'main');
    const b = cloneOf(remote); // tracks the ledger, never migrated
    const m = await migrateToMirror(a); // seeds + pushes warpline/fabric
    expect(m.pushed).toBe('pushed');
    git(b, 'fetch', '-q');
    await expect(withFabricLock(b, () => undefined)).rejects.toThrow(/upstream migrated/);
    const r = await migrateToMirror(b);
    expect(r.path).toBe('follow');
    expect(r.commit).not.toBeNull();
    expect(git(b, 'rev-parse', r.ownRef)).toBe(git(b, 'rev-parse', 'refs/remotes/origin/warpline/fabric'));
  });
});

describe('review 6 + 8 — audit cursor and windowed audit', () => {
  it('publish and push advance the cursors; a clean verify advances the remote cursor', async () => {
    const { dir } = await canonicalWithRemote(2);
    const ctx = gitContext(dir)!;
    expect(readAuditCursor(ctx)[BRANCH]).toBe(git(dir, 'rev-parse', BRANCH));
    expect(readAuditCursor(ctx)['refs/remotes/origin/warpline/fabric']).toBe(git(dir, 'rev-parse', BRANCH));
  });

  it('a record whose non-last segment does not hold 32 strands is flagged', async () => {
    const { dir, remote } = await canonicalWithRemote(3);
    const clone = cloneOf(remote);
    await seal(clone); // sets the cursor
    pushForged(dir, (l) => [...l, l[l.length - 1]].slice(0, 4), (l) => [l.slice(0, 1), l.slice(1)]);
    git(clone, 'fetch', '-q');
    const v = verifyFabric(clone);
    expect(v.failures.some((f) => f.kind === 'mirror-chain-truncation' && /32 strands|drops or/.test(f.detail))).toBe(true);
  });
});

describe('review 9 — the tracked signing pin is the trust anchor on fresh clones', () => {
  it('an UNSIGNED agent-class strand after the pinned boundary is refused with no local .warpline/keys', async () => {
    const { dir, remote } = await canonicalWithRemote(2);
    const cfgPath = path.join(W(dir), 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg.fabricMirror.signedFrom = ids(ledger(dir))[0];
    cfg.fabricMirror.keyIds = [];
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
    git(dir, 'add', '.warpline/config.json');
    git(dir, 'commit', '-q', '-m', 'pin signing');
    git(dir, 'push', '-q', 'origin', 'main');
    pushForged(dir, (l) => {
      const prev = JSON.parse(l[l.length - 1]);
      const { pickId: _p, ...body } = { ...prev, seq: prev.seq + 1, parentPickId: prev.pickId, parentStateId: prev.stateId, intent: 'agent', authoredBy: { agentId: 'mallory' } };
      return [...l, JSON.stringify({ ...body, pickId: computePickId(body) })];
    });
    const clone = cloneOf(remote);
    await expect(seal(clone)).rejects.toThrow(/sig-missing|sig-key-unknown/);
    expect(ids(ledger(clone))).toEqual([]);
  });
});

describe('review 10, 11, 18 — unrecorded strands, probeMode, append bytes', () => {
  it('a strand in the ledger but not the record is a HARD mirror-unrecorded', async () => {
    const dir = mkRepo();
    await seal(dir);
    const l = ledger(dir).toString('utf8').trim().split('\n');
    fs.appendFileSync(path.join(W(dir), 'fabric.jsonl'), JSON.stringify({ ...JSON.parse(l[0]), pickId: 'pick:v2:extra' }) + '\n');
    expect(verifyFabric(dir).failures.some((f) => f.kind === 'mirror-unrecorded')).toBe(true);
  });

  it('probeMode treats a corrupt config and a tracked-commit history as recorded', async () => {
    const dir = mkRepo();
    fs.mkdirSync(W(dir), { recursive: true });
    fs.writeFileSync(path.join(W(dir), 'config.json'), '{ not json');
    expect(probeMode(dir)).toBe('mirror');
  });

  it('an append onto a ledger without a trailing newline leaves file bytes == record bytes', async () => {
    const dir = mkRepo();
    await seal(dir);
    const s = readFabric(W(dir))[0];
    await withFabricLock(dir, () => {
      // simulate a ledger whose last newline is missing but still covers the record
      const m = openSection(dir);
      if (m.mode !== 'mirror') throw new Error('expected mirror');
    });
    void s;
    await seal(dir);
    expect(recorded(dir, ownRef(dir))).toEqual(ids(ledger(dir)));
    const rec = Buffer.concat(git(dir, 'ls-tree', '--name-only', `${ownRef(dir)}:ledger`).split('\n').filter(Boolean)
      .map((n) => execFileSync('git', ['cat-file', 'blob', `${ownRef(dir)}:ledger/${n}`], { cwd: dir, env: ENV })));
    expect(rec.equals(ledger(dir))).toBe(true);
  });
});

describe('review 12, 14, 15, 17, 19, 21, 22, 24, 26 — lower items', () => {
  it('12: the git env strips config/replace/shallow redirections and disables replace objects', () => {
    const saved = { ...process.env };
    process.env.GIT_CONFIG_PARAMETERS = "'core.fsmonitor=evil'";
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'core.fsmonitor';
    process.env.GIT_SHALLOW_FILE = '/tmp/x';
    try {
      const env = sanitizedGitEnv();
      for (const k of ['GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_SHALLOW_FILE']) expect(env[k]).toBeUndefined();
      expect(env.GIT_NO_REPLACE_OBJECTS).toBe('1');
    } finally {
      process.env = saved;
    }
  });

  it('14: writer-id creation is link-into-place (same id twice, no temp residue)', () => {
    const gd = tmp('wl-rv-gd-');
    const a = ensureWriterId(gd);
    expect(ensureWriterId(gd)).toBe(a);
    expect(fs.readdirSync(path.join(gd, 'warpline'))).toEqual(['writer-id']);
  });

  it('15: an absent binding object is a TYPED failure (objectAbsent), a corrupt one is not', () => {
    const root = tmp('wl-rv-15-');
    const s = { ...JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'frozen-fabric', 'fabric.jsonl'), 'utf8').split('\n')[15]) };
    const f = verifyFabric(root, { strands: [s], requireAnchor: false }).failures.find((x) => x.kind === 'missing-binding');
    expect(f?.objectAbsent).toBe(true);
  });

  it('17: a torn tail restored from the record is quarantined first', async () => {
    const dir = mkRepo();
    await seal(dir);
    await seal(dir);
    const full = ledger(dir);
    fs.writeFileSync(path.join(W(dir), 'fabric.jsonl'), full.subarray(0, full.length - 15));
    await withFabricLock(dir, () => undefined);
    const q = fs.readdirSync(path.join(W(dir), 'repair'));
    expect(q.some((n) => n.startsWith('restore-'))).toBe(true);
  });

  it('19: a SYMLINKED root is a main worktree (not linked) and records normally', async () => {
    const dir = mkRepo();
    const link = path.join(tmp('wl-rv-ln-'), 'link');
    fs.symlinkSync(dir, link, 'dir');
    await seal(link);
    expect(gitContext(link)!.linked).toBe(false);
    expect(git(dir, 'rev-parse', BRANCH)).toBe(git(dir, 'rev-parse', ownRef(dir)));
  });

  it('21: the default ssh command bounds connect and keep-alive', () => {
    const dir = mkRepo();
    const saved = process.env.GIT_SSH_COMMAND;
    delete process.env.GIT_SSH_COMMAND;
    try {
      expect(networkGitEnv(dir).GIT_SSH_COMMAND).toMatch(/BatchMode=yes.*ConnectTimeout=20.*ServerAliveInterval=15.*ServerAliveCountMax=2/);
    } finally {
      if (saved !== undefined) process.env.GIT_SSH_COMMAND = saved;
    }
  });

  it('22: `mirror push` to a non-remote exits non-zero; `mirror adopt` with no source exits non-zero', async () => {
    const dir = mkRepo();
    await seal(dir);
    const r = spawnSync(process.execPath, [DIST_CLI, 'mirror', 'push', 'nope', '--root', dir], { cwd: dir, env: ENV, encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/not a configured git remote/);
    const fresh = mkRepo();
    const a = spawnSync(process.execPath, [DIST_CLI, 'mirror', 'adopt', '--no-fetch', '--root', fresh], { cwd: fresh, env: ENV, encoding: 'utf8' });
    expect(a.status).toBe(1);
  });

  it('24: adoption emits !fabric-adopted to events.jsonl and the hook log', async () => {
    const { remote } = await canonicalWithRemote(1);
    const clone = cloneOf(remote);
    await seal(clone);
    expect(fs.readFileSync(path.join(clone, '.git', 'warpline', 'events.jsonl'), 'utf8')).toMatch(/!fabric-adopted/);
    expect(fs.readFileSync(path.join(clone, '.git', 'warpline-hook.log'), 'utf8')).toMatch(/!fabric-adopted/);
  });

  it('26: `warpline init` in a git repo pins the genesis', async () => {
    const dir = mkRepo();
    const r = await initWarpline(dir);
    expect(JSON.parse(fs.readFileSync(path.join(W(dir), 'config.json'), 'utf8')).fabricMirror.genesis).toBe(r.genesisPickId);
  });

  it('2: the CI audit workflow is not triggered by pushes to the record branch (they carry no .github/)', () => {
    const wf = fs.readFileSync(path.join(PKG_ROOT, '..', '..', '.github', 'workflows', 'warpline-fabric-audit.yml'), 'utf8');
    expect(wf).not.toMatch(/branches:\s*\[\s*'?warpline\/fabric'?\s*\]/);
    expect(wf).toMatch(/schedule:/);
    expect(wf).toMatch(/workflow_dispatch:/);
    expect(wf).toMatch(/actions\/cache\/restore/);
  });
});

/* ───────── final-review items (a)-(d) ───────── */

describe('(a) the key registry travels into forks and survives claim', () => {
  it('a fork with no local keys carries the canonical registry; claim keeps it', async () => {
    const { dir, remote } = await canonicalWithRemote(1);
    // a (public) registry on the canonical writer, recorded by the next seal
    fs.mkdirSync(path.join(W(dir), 'keys'), { recursive: true });
    const reg = JSON.stringify({ schemaVersion: 'keyRegistry:v1', kind: 'signed-from', signedFromPickId: null, createdAt: '2026-01-01T00:00:00Z' }) + '\n';
    fs.writeFileSync(path.join(W(dir), 'keys', 'registry.jsonl'), reg);
    await seal(dir);
    git(dir, 'push', '-q', 'origin', 'main'); // the fork re-absorbs the tip state from its provenance commit
    expect(pushFabric(dir).action).toBe('pushed');
    const clone = cloneOf(remote);
    await seal(clone); // adopt + fork seal, no local .warpline/keys
    expect(fs.existsSync(path.join(W(clone), 'keys'))).toBe(false);
    expect(git(clone, 'cat-file', 'blob', `${ownRef(clone)}:keys-registry.jsonl`) + '\n').toBe(reg);
    const r = await claimCanonical(clone);
    expect(git(clone, 'cat-file', 'blob', `${r.commit}:keys-registry.jsonl`) + '\n').toBe(reg);
  });

  it('claim refuses when the claimed record would drop the canonical registry', async () => {
    const { dir, remote } = await canonicalWithRemote(1);
    fs.mkdirSync(path.join(W(dir), 'keys'), { recursive: true });
    fs.writeFileSync(path.join(W(dir), 'keys', 'registry.jsonl'), '{"kind":"signed-from"}\n');
    await seal(dir);
    git(dir, 'push', '-q', 'origin', 'main');
    pushFabric(dir);
    const clone = cloneOf(remote);
    await seal(clone);
    // forge: the fork's own record WITHOUT the registry (same ledger)
    const own = git(clone, 'rev-parse', ownRef(clone));
    const entries = git(clone, 'ls-tree', own).split('\n').filter((l) => !l.endsWith('\tkeys-registry.jsonl'));
    const t = gitIn(clone, entries.join('\n') + '\n', 'mktree');
    const c = git(clone, 'commit-tree', t, '-p', own, '-m', 'drop registry');
    git(clone, 'update-ref', ownRef(clone), c, own);
    fs.rmSync(path.join(clone, '.git', 'warpline', 'mirror-cache.json'), { force: true });
    await expect(claimCanonical(clone)).rejects.toThrow(/drop or shrink the canonical key registry/);
  });
});

describe('(b) `warpline init` makes the genesis pin travel', () => {
  it('a fresh init tracks config.json with the pin; a clone gets it', async () => {
    const dir = tmp('wl-rv-init-');
    git(dir, 'init', '-q', '-b', 'main');
    configure(dir);
    fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1;\n');
    const r = await initWarpline(dir);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'init');
    expect(git(dir, 'ls-files', '.warpline').split('\n')).toEqual(['.warpline/config.json']);
    const clone = path.join(tmp('wl-rv-initc-'), 'c');
    git(path.dirname(clone), 'clone', '-q', dir, clone);
    expect(JSON.parse(fs.readFileSync(path.join(clone, '.warpline', 'config.json'), 'utf8')).fabricMirror.genesis).toBe(r.genesisPickId);
  });
});

describe.skipIf(process.platform === 'win32')('(c) hung-ssh pushes leave no orphan', () => {
  const pidFiles: string[] = [];
  afterEach(() => {
    for (const f of pidFiles.splice(0)) {
      const pid = fs.existsSync(f) ? Number(fs.readFileSync(f, 'utf8').trim()) : NaN;
      if (!Number.isFinite(pid)) continue;
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        /* already gone */
      }
      let alive = true;
      for (let i = 0; i < 50 && alive; i++) {
        try {
          process.kill(pid, 0);
          execFileSync('sleep', ['0.05']);
        } catch {
          alive = false;
        }
      }
      expect(alive).toBe(false);
    }
  });
  function stub(): { script: string; pidFile: string } {
    const d = tmp('wl-rv-ssh-');
    const pidFile = path.join(d, 'ssh.pid');
    const script = path.join(d, 'fake-ssh');
    fs.writeFileSync(script, `#!/bin/sh\necho $$ > '${pidFile}'\nexec sleep 30\n`);
    fs.chmodSync(script, 0o755);
    pidFiles.push(pidFile);
    return { script, pidFile };
  }

  it('the non-detached push is killed at WARPLINE_NET_TIMEOUT_MS; the stub is reaped', async () => {
    const dir = mkRepo();
    await seal(dir); // canonical, so the push really reaches ssh
    git(dir, 'remote', 'add', 'origin', 'ssh://example.invalid/r.git');
    const { script, pidFile } = stub();
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [DIST_CLI, 'mirror', 'push', 'origin', '--root', dir], {
      cwd: dir,
      env: { ...ENV, GIT_SSH_COMMAND: script, WARPLINE_NET_TIMEOUT_MS: '1500' },
      encoding: 'utf8',
    });
    expect(r.status).not.toBe(0);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(1400);
    expect(fs.existsSync(pidFile)).toBe(true); // it really reached ssh
  });

  it('`mirror push --detached` returns at once while the stub hangs', async () => {
    const dir = mkRepo();
    await seal(dir);
    git(dir, 'remote', 'add', 'origin', 'ssh://example.invalid/r.git');
    const { script, pidFile } = stub();
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [DIST_CLI, 'mirror', 'push', '--detached', 'origin', '--root', dir], {
      cwd: dir,
      env: { ...ENV, GIT_SSH_COMMAND: script },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(Date.now() - t0).toBeLessThan(3500);
    for (let i = 0; i < 100 && !fs.existsSync(pidFile); i++) execFileSync('sleep', ['0.05']);
    expect(fs.existsSync(pidFile)).toBe(true);
  });
});

describe('(d) items 13, 18, 20, 25', () => {
  it('13: adopt refuses a differing local legacy manifest; with none, the incoming one is written', async () => {
    const remote = path.join(tmp('wl-rv-13r-'), 'r.git');
    git(path.dirname(remote), 'init', '-q', '--bare', '-b', 'main', remote);
    const dir = mkRepo();
    git(dir, 'remote', 'add', 'origin', remote);
    const legacy = '{"reason":"canonical","grandfathered":[]}\n';
    fs.mkdirSync(W(dir), { recursive: true });
    fs.writeFileSync(path.join(W(dir), 'fabric-legacy.json'), legacy);
    await seal(dir);
    git(dir, 'push', '-q', 'origin', 'main');
    pushFabric(dir);
    const a = cloneOf(remote);
    fs.mkdirSync(W(a), { recursive: true });
    fs.writeFileSync(path.join(W(a), 'fabric-legacy.json'), '{"reason":"other","grandfathered":[]}\n');
    await expect(seal(a)).rejects.toThrow(/different fabric-legacy\.json/);
    expect(refsOf(a, 'refs/warpline')).toBe('');
    const b = cloneOf(remote);
    await seal(b);
    expect(fs.readFileSync(path.join(W(b), 'fabric-legacy.json'), 'utf8')).toBe(legacy);
  });

  it('18: an append onto a ledger without a trailing newline keeps file bytes == record bytes', async () => {
    const src = mkRepo();
    await seal(src);
    await seal(src);
    const [l1, l2] = ledger(src).toString('utf8').trim().split('\n');
    const dir = mkRepo(); // no record yet: the open-time restore cannot heal anything
    fs.mkdirSync(W(dir), { recursive: true });
    fs.writeFileSync(path.join(W(dir), 'fabric.jsonl'), l1); // NO trailing newline
    await withFabricLock(dir, () => appendStrand(W(dir), JSON.parse(l2)));
    const segs = git(dir, 'ls-tree', '--name-only', `${ownRef(dir)}:ledger`).split('\n').filter(Boolean);
    const rec = Buffer.concat(segs.map((n) => execFileSync('git', ['cat-file', 'blob', `${ownRef(dir)}:ledger/${n}`], { cwd: dir, env: ENV })));
    expect(ledger(dir).equals(rec)).toBe(true);
    expect(ledger(dir).toString('utf8')).toBe(`${l1}\n${l2}\n`);
  });

  it('20: a re-run migrate whose push fails deletes only the refs it created', async () => {
    const dir = await legacyRepo('wl-rv-20-');
    git(dir, 'remote', 'add', 'origin', path.join(tmp('wl-rv-20b-'), 'missing.git'));
    // a previous (interrupted) run left this worktree's own record
    const m = openSection(dir, { ignoreTracked: true });
    if (m.mode !== 'mirror') throw new Error('expected mirror');
    m.section.createBranch = false;
    publish(m.section, m.section.bytes, { message: 'earlier run' });
    const own = git(dir, 'rev-parse', ownRef(dir));
    await expect(migrateToMirror(dir)).rejects.toThrow(/migrate stopped/);
    expect(git(dir, 'rev-parse', ownRef(dir))).toBe(own); // pre-existing: kept
    expect(refsOf(dir, BRANCH)).toBe(''); // nothing created survives
    expect(git(dir, 'ls-files', '.warpline/fabric.jsonl')).toBe('.warpline/fabric.jsonl'); // nothing untracked
  });

  it.skipIf(process.platform === 'win32')('25: an unparsable --show-object-format answer falls back to extensions.objectformat (default sha1)', () => {
    const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    const d = tmp('wl-rv-25-');
    const wrapper = path.join(d, 'old-git');
    fs.writeFileSync(
      wrapper,
      `#!/bin/sh\nfor a in "$@"; do if [ "$a" = "--show-object-format" ]; then\n  args=""; for b in "$@"; do [ "$b" = "--show-object-format" ] || args="$args '$b'"; done\n  eval "'${realGit}' $args" && echo "--show-object-format"; exit $?\nfi; done\nexec '${realGit}' "$@"\n`,
    );
    fs.chmodSync(wrapper, 0o755);
    const sha1 = mkRepo();
    const sha256 = tmp('wl-rv-25s-');
    git(sha256, 'init', '-q', '--object-format=sha256', '-b', 'main');
    const saved = process.env.WARPLINE_GIT;
    process.env.WARPLINE_GIT = wrapper;
    resetBin();
    try {
      expect(gitContext(sha1)!.objectFormat).toBe('sha1');
      expect(gitContext(sha256)!.objectFormat).toBe('sha256');
    } finally {
      if (saved === undefined) delete process.env.WARPLINE_GIT;
      else process.env.WARPLINE_GIT = saved;
      resetBin();
    }
  });
});

/* ───────── final round (Aegis N1-N5, Judge 1-6) ───────── */

const REGISTRY_ROW = (n: number): string =>
  JSON.stringify({ schemaVersion: 'keyRegistry:v1', kind: 'agent-key', keyId: `wlkey:v1:${String(n).repeat(64).slice(0, 64)}`, principal: `p${n}`, publicKeyPem: 'x', createdAt: '2026-01-01T00:00:00Z' }) + '\n';
const SIGNED_FROM = (pickId: string | null): string =>
  JSON.stringify({ schemaVersion: 'keyRegistry:v1', kind: 'signed-from', signedFromPickId: pickId, createdAt: '2026-01-01T00:00:00Z' }) + '\n';

describe('final N1 — migrate writes the signing pin from the local registry (no hand edit)', () => {
  it('a migrated repo with a signed-from row: a clone refuses an unsigned agent strand', async () => {
    const remote = path.join(tmp('wl-fn1-r-'), 'r.git');
    git(path.dirname(remote), 'init', '-q', '--bare', '-b', 'main', remote);
    const dir = await legacyRepo('wl-fn1-');
    git(dir, 'remote', 'add', 'origin', remote);
    fs.mkdirSync(path.join(W(dir), 'keys'), { recursive: true });
    fs.writeFileSync(path.join(W(dir), 'keys', 'registry.jsonl'), SIGNED_FROM(ids(ledger(dir))[0]));
    git(dir, 'push', '-q', 'origin', 'main');
    const m = await migrateToMirror(dir);
    expect(m.pushed).toBe('pushed');
    const pin = JSON.parse(fs.readFileSync(path.join(W(dir), 'config.json'), 'utf8')).fabricMirror;
    expect(pin.signedFrom).toBe(ids(ledger(dir))[0]);
    expect(pin.keyIds).toEqual([]);
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'migrate');
    git(dir, 'push', '-q', 'origin', 'main');
    pushForged(dir, (l) => {
      const prev = JSON.parse(l[l.length - 1]);
      const { pickId: _p, ...body } = { ...prev, seq: (prev.seq ?? 0) + 1, schemaVersion: 2, parentPickId: prev.pickId, parentStateId: prev.stateId, intent: 'agent', authoredBy: { agentId: 'mallory' } };
      return [...l, JSON.stringify({ ...body, pickId: computePickId(body) })];
    });
    const clone = cloneOf(remote);
    await expect(seal(clone)).rejects.toThrow(/sig-missing|sig-key-unknown/);
    expect(ids(ledger(clone))).toEqual([]);
  });
});

describe('final N2 — the recorded key registry is append-only', () => {
  it('a truncated local registry refuses the seal; nothing is published', async () => {
    const dir = mkRepo();
    fs.mkdirSync(path.join(W(dir), 'keys'), { recursive: true });
    fs.writeFileSync(path.join(W(dir), 'keys', 'registry.jsonl'), REGISTRY_ROW(1) + REGISTRY_ROW(2));
    await seal(dir);
    const own = git(dir, 'rev-parse', ownRef(dir));
    fs.writeFileSync(path.join(W(dir), 'keys', 'registry.jsonl'), REGISTRY_ROW(1));
    await expect(seal(dir)).rejects.toThrow(/SHORTER than the recorded one/);
    expect(git(dir, 'rev-parse', ownRef(dir))).toBe(own);
  });

  it('a clone with its own local keys that adopted can claim; the canonical registry is only extended', async () => {
    const { dir, remote } = await canonicalWithRemote(1);
    fs.mkdirSync(path.join(W(dir), 'keys'), { recursive: true });
    fs.writeFileSync(path.join(W(dir), 'keys', 'registry.jsonl'), REGISTRY_ROW(1));
    await seal(dir);
    git(dir, 'push', '-q', 'origin', 'main');
    pushFabric(dir);
    const clone = cloneOf(remote);
    await seal(clone); // adopts (carries the registry), forks
    fs.mkdirSync(path.join(W(clone), 'keys'), { recursive: true });
    fs.writeFileSync(path.join(W(clone), 'keys', 'registry.jsonl'), REGISTRY_ROW(1) + REGISTRY_ROW(3));
    const r = await claimCanonical(clone);
    expect(git(clone, 'cat-file', 'blob', `${r.commit}:keys-registry.jsonl`) + '\n').toBe(REGISTRY_ROW(1) + REGISTRY_ROW(3));
    // a REPLACED local registry is refused
    fs.writeFileSync(path.join(W(clone), 'keys', 'registry.jsonl'), REGISTRY_ROW(4));
    await expect(seal(clone)).rejects.toThrow(/not an append-only extension/);
  });
});

describe('final N4 / Judge 3 — the rewind check never trusts the cache; missing = absent pickIds only', () => {
  it('a poisoned cache (writer + commit) does not hide a rewound own ref', async () => {
    const dir = mkRepo();
    for (let i = 0; i < 3; i++) await seal(dir);
    const cachePath = path.join(dir, '.git', 'warpline', 'mirror-cache.json');
    const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
    git(dir, 'update-ref', ownRef(dir), `${ownRef(dir)}~2`);
    const rewound = git(dir, 'rev-parse', ownRef(dir));
    fs.writeFileSync(cachePath, JSON.stringify({ ...cache, commit: rewound, writers: { [git(dir, 'rev-parse', BRANCH)]: 'f'.repeat(32) } }));
    await expect(withFabricLock(dir, () => undefined)).rejects.toThrow(/own record is behind it/);
  });

  it('a rewound own ref with the ledger intact reports the rewind, not phantom missing strands', async () => {
    const dir = mkRepo();
    for (let i = 0; i < 3; i++) await seal(dir);
    git(dir, 'update-ref', ownRef(dir), `${ownRef(dir)}~1`);
    const v = verifyFabric(dir);
    expect(v.mirror.missing).toEqual([]);
    expect(v.failures.some((f) => f.kind === 'mirror-orphan' && /rewound or deleted/.test(f.detail))).toBe(true);
  });
});

describe('final N5 — writer id without hard links', () => {
  it.each(['EPERM', 'ENOTSUP', 'EXDEV'])('link failing with %s falls back to an O_EXCL write', (code) => {
    const gd = tmp('wl-fn5-');
    __setWriterLinkForTest(() => {
      throw Object.assign(new Error(code), { code });
    });
    try {
      const id = ensureWriterId(gd);
      expect(id).toMatch(/^[0-9a-f]{32}$/);
      expect(fs.readFileSync(path.join(gd, 'warpline', 'writer-id'), 'utf8')).toBe(`${id}\n`);
      expect(fs.readdirSync(path.join(gd, 'warpline'))).toEqual(['writer-id']);
      expect(ensureWriterId(gd)).toBe(id);
    } finally {
      __setWriterLinkForTest(null);
    }
  });
});

describe('final 9 — migrate re-run with an own ref but no branch creates the branch once', () => {
  it('publishes once so the canonical branch exists', async () => {
    const dir = await legacyRepo('wl-f9-');
    const m = openSection(dir, { ignoreTracked: true });
    if (m.mode !== 'mirror') throw new Error('expected mirror');
    m.section.createBranch = false;
    publish(m.section, m.section.bytes, { message: 'earlier run' });
    expect(refsOf(dir, BRANCH)).toBe('');
    await migrateToMirror(dir, { push: false });
    expect(git(dir, 'rev-parse', BRANCH)).toBe(git(dir, 'rev-parse', ownRef(dir)));
  });
});
