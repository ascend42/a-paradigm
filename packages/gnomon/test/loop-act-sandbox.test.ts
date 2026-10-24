/**
 * #loop-act escape suite under the REAL darwin `loop-act` profile (sandbox-exec; Aegis step-10 review). A probe
 * (test/fixtures/loop-act-probe.cjs) runs as the act child would (the pinned node, cwd the scratch) and attempts each
 * escape; every one must be denied unless stated. Plus the kernel side: colliding trees, FIFOs, swapped links and
 * hard links at park, and removeScratch leaving the human node_modules intact.
 */
// @gnomon-platform: darwin
import { execFileSync, spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSessionPolicy } from '../src/kernel/manifest/policy.js';
import { loopActLaunchPlan } from '../src/kernel/sandbox/loop-act.js';
import { darwinFloor } from '../src/kernel/sandbox/session.js';
import { LifecycleRefusal } from '../src/kernel/lifecycle/refusal.js';
import { createScratch, GitRefusal, parkScratch, removeScratch, scratchChanges } from '../src/kernel/git/scratch.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { PKG_ROOT } from './helpers.js';

const darwin = process.platform === 'darwin';
// the enforced profile needs the session floor (macOS 15+ and SIP on); a host below it (a CI VM with SIP off) cannot run it
const floor = darwin ? darwinFloor() : { ok: false as const };
const tmps: string[] = [];
const kids: ChildProcess[] = [];
const closers: Array<() => void> = [];
afterEach(() => {
  for (const k of kids.splice(0)) {
    try {
      process.kill(k.pid!, 'SIGCONT');
      k.kill('SIGKILL');
    } catch {
      /* gone */
    }
  }
  for (const c of closers.splice(0)) c();
  while (tmps.length) removeTree(tmps.pop()!);
});
function tmp(prefix: string): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmps.push(d);
  return d;
}
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' } });
const listen = async (srv: net.Server, host = '127.0.0.1'): Promise<number> => {
  await new Promise<void>((r) => srv.listen(0, host, () => r()));
  closers.push(() => srv.close());
  return (srv.address() as net.AddressInfo).port;
};
const lanIp = (): string => Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address ?? '10.255.255.1';

describe.skipIf(!darwin || floor.ok)('the loop-act profile below the session floor (the escape suite is skipped here, never weakened)', () => {
  it('refuses sandbox-unavailable naming the floor, which is why the escape suite cannot run on this host', () => {
    let err: unknown;
    try {
      loopActLaunchPlan({} as never, 'darwin');
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LifecycleRefusal);
    expect((err as LifecycleRefusal).reason).toBe('sandbox-unavailable');
    expect((err as LifecycleRefusal).detail).toMatchObject({ profile: 'loop-act', floor: (floor as { floor?: string }).floor });
  });
});

describe.skipIf(!darwin || !floor.ok)('the loop-act profile under sandbox-exec (Aegis escape suite)', () => {
  it('every escape is denied; the scratch, tmp, node_modules reads and the endpoint port are allowed', async () => {
    const home = tmp('gnomon-home-');
    const userHome = tmp('gnomon-user-');
    const repo = tmp('gnomon-repo-');
    const sibling = tmp('gnomon-sibling-');
    fs.writeFileSync(path.join(userHome, '.zshrc'), 'orig\n');
    fs.mkdirSync(path.join(userHome, '.ssh'));
    fs.writeFileSync(path.join(userHome, '.ssh', 'id'), 'secret\n');
    fs.mkdirSync(path.join(home, 'keys'), { recursive: true });
    fs.writeFileSync(path.join(home, 'keys', 'k'), 'key\n');
    const work = path.join(home, 'loop-work');
    const runDir = path.join(work, 'act-r1');
    const tree = path.join(runDir, 'tree');
    const tmpd = path.join(runDir, 'tmp');
    for (const d of [tree, tmpd, path.join(work, 'park', 'x.git'), path.join(work, 'act-r2', 'tree')]) fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(work, 'park', 'x.git', 'HEAD'), 'ref\n');
    fs.writeFileSync(path.join(work, 'act-r2', 'tree', 'secret'), 'other run\n');
    fs.mkdirSync(path.join(repo, 'src'));
    fs.mkdirSync(path.join(repo, '.git'));
    fs.writeFileSync(path.join(repo, '.git', 'config'), '[core]\n');
    fs.writeFileSync(path.join(repo, 'src', 'a.ts'), 'repo src\n');
    fs.mkdirSync(path.join(repo, 'node_modules', 'dep'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'node_modules', 'dep', 'index.js'), 'module.exports = 1;\n');
    fs.writeFileSync(path.join(sibling, 'file'), 'sibling\n');
    fs.mkdirSync(path.join(tree, 'src'));
    fs.writeFileSync(path.join(tree, 'src', 'a.ts'), 'scratch\n');
    fs.symlinkSync(path.join(repo, 'node_modules'), path.join(tree, 'node_modules'), 'dir');
    fs.symlinkSync(path.join(userHome, '.zshrc'), path.join(tree, 'l-zshrc'));
    fs.symlinkSync(path.join(repo, 'src', 'a.ts'), path.join(tree, 'l-repofile'));
    fs.symlinkSync(path.join(work, 'park'), path.join(tree, 'l-park'), 'dir');
    fs.copyFileSync(path.join(PKG_ROOT, 'test', 'fixtures', 'loop-act-probe.cjs'), path.join(tree, 'probe.cjs'));
    // the endpoint, another loopback listener, the kernel's port and socket, a daemon stand-in and another process
    // the endpoint listens on every interface, so a connect to its port on a non-loopback address would succeed if allowed
    const endpointPort = await listen(net.createServer((s) => s.end()), '0.0.0.0');
    const otherPort = await listen(net.createServer((s) => s.end()));
    const kernelSrv = http.createServer((_q, r) => r.end());
    const kernelPort = await listen(kernelSrv as unknown as net.Server);
    const kernelSock = path.join(home, 'k.sock');
    const sockSrv = net.createServer((s) => s.end());
    await new Promise<void>((r) => sockSrv.listen(kernelSock, () => r()));
    closers.push(() => sockSrv.close());
    const daemon = spawn('/bin/sleep', ['60']);
    const other = spawn('/bin/sleep', ['60']);
    kids.push(daemon, other);
    const dylibs = fs.existsSync('/opt/homebrew/lib') ? fs.readdirSync('/opt/homebrew/lib').filter((n) => n.endsWith('.dylib')).map((n) => fs.realpathSync.native(path.join('/opt/homebrew/lib', n))) : [];
    const dylib = dylibs[0];
    const cfg = {
      tree, tmp: tmpd, runDir, repo, zshrc: path.join(userHome, '.zshrc'), repoFile: path.join(repo, 'src', 'a.ts'), keyFile: path.join(home, 'keys', 'k'),
      reads: {
        'repo-git-config': path.join(repo, '.git', 'config'), 'repo-src': path.join(repo, 'src', 'a.ts'), sibling: path.join(sibling, 'file'),
        keys: path.join(home, 'keys', 'k'), park: path.join(work, 'park', 'x.git', 'HEAD'), 'other-run': path.join(work, 'act-r2', 'tree', 'secret'),
        ssh: path.join(userHome, '.ssh', 'id'), 'ALLOW-scratch': path.join(tree, 'src', 'a.ts'), 'ALLOW-nm': path.join(tree, 'node_modules', 'dep', 'index.js'),
      },
      endpointPort, otherPort, kernelPort, lanIp: lanIp(), kernelSock, daemonPid: daemon.pid, otherPid: other.pid,
      ...(dylib ? { dylib } : {}),
    };
    fs.writeFileSync(path.join(tree, 'cfg.json'), JSON.stringify(cfg));
    const policy = buildSessionPolicy({ home, cwd: tree, userClaudeDir: path.join(userHome, '.claude'), userHome, managedSettingsPaths: [], linkedFolders: [], endpointPort: kernelPort });
    const node = fs.realpathSync.native(process.execPath);
    const launch = { policy, binaryReal: node, argv: [path.join(tree, 'probe.cjs'), path.join(tree, 'cfg.json')], extras: { uid: process.getuid!(), tmpdir: tmpd, home: userHome, roots: [tree] }, act: { home, userHome, scratch: tree, tmp: tmpd, repo, nodeModules: [path.join(repo, 'node_modules')], endpointPort, gitDeny: [path.join(repo, '.git'), sibling] } };
    // M2: an endpoint on a port the kernel denies is refused before any profile exists
    expect(() => loopActLaunchPlan({ ...launch, act: { ...launch.act, endpointPort: kernelPort } }, 'darwin')).toThrow(/a port the kernel denies/);
    const plan = loopActLaunchPlan(launch, 'darwin');
    const r = spawnSync(plan.command, plan.args, { cwd: tree, encoding: 'utf8', env: { PATH: '/usr/bin:/bin', HOME: userHome, TMPDIR: tmpd }, timeout: 60_000 });
    const got = Object.fromEntries(r.stdout.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    // the measured results are data for the review
    if (process.env.LOOP_ACT_ESCAPE_OUT) fs.writeFileSync(process.env.LOOP_ACT_ESCAPE_OUT, JSON.stringify(got, null, 1));
    // net-endpoint-port-nonloopback: SBPL's `localhost` matches the machine's own addresses, so the endpoint port on
    // the host's LAN address reaches the SAME host's listener (recorded residual; off-host is denied below)
    const allowed = new Set(['r-ALLOW-scratch', 'r-ALLOW-nm', 'w-scratch', 'w-tmp', 'net-endpoint', 'net-endpoint-port-nonloopback']);
    expect(Object.keys(got).length, r.stderr).toBeGreaterThan(30);
    for (const k of allowed) expect(got[k], k).toMatch(/^ok/);
    for (const [k, v] of Object.entries(got)) if (!allowed.has(k)) expect(v, k).toMatch(/^denied/);
    // nothing outside moved
    expect(fs.readFileSync(path.join(userHome, '.zshrc'), 'utf8')).toBe('orig\n');
    expect(fs.readFileSync(path.join(repo, 'src', 'a.ts'), 'utf8')).toBe('repo src\n');
    expect(fs.existsSync(path.join(repo, 'node_modules', 'dep', 'y.js'))).toBe(false);
    expect(fs.existsSync(path.join(work, 'park', 'planted'))).toBe(false);
    expect(fs.readdirSync(runDir).sort()).toEqual(['tmp', 'tree']);
    expect(got['tree-still-there']).toBe('denied:still-there');
    if (dylib) for (const k of ['dl-tmp', 'dl-scratch']) expect(got[k], k).toMatch(/^denied/);
  }, 90_000);
});

describe.skipIf(!darwin)('#loop-git kernel side (Aegis H1, M1, L3)', () => {
  function plumbingRepo(entries: (repo: string, outside: string) => string): { repo: string; outside: string } {
    const repo = tmp('gnomon-collide-');
    const outside = tmp('gnomon-outside-');
    git(repo, 'init', '-q', '-b', 'main');
    const tree = entries(repo, outside);
    const sha = git(repo, 'commit-tree', tree, '-m', 'x').trim();
    git(repo, 'update-ref', 'refs/heads/main', sha);
    return { repo, outside };
  }
  const blob = (repo: string, content: string): string => execFileSync('git', ['hash-object', '-w', '--stdin'], { cwd: repo, input: content, encoding: 'utf8' }).trim();
  const mktree = (repo: string, lines: string[]): string => execFileSync('git', ['mktree'], { cwd: repo, input: lines.join('\n') + '\n', encoding: 'utf8' }).trim();

  it('H1: a link `X` beside `x/y` (case) or NFC beside NFD collides: refused, nothing planted outside', () => {
    for (const [a, b] of [['X', 'x'], ['é', 'é']]) {
      const { repo, outside } = plumbingRepo((r, out) => {
        const sub = mktree(r, [`120000 blob ${blob(r, out)}\ty`]);
        return mktree(r, [`120000 blob ${blob(r, out)}\t${a}`, `040000 tree ${sub}\t${b}`]);
      });
      const home = tmp('gnomon-home-');
      expect(() => createScratch({ home, repo, loopId: 'c', runId: `lr-c${a.length}` })).toThrow(/collide by case or Unicode normalization/);
      expect(fs.readdirSync(outside)).toEqual([]);
      expect(fs.existsSync(path.join(home, 'loop-work')) ? fs.readdirSync(path.join(home, 'loop-work')) : []).toEqual([]);
    }
  });

  it('M1: a FIFO, a link swapped in or a hard link at park is refused; removeScratch leaves the human node_modules', () => {
    const repo = tmp('gnomon-park-');
    git(repo, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(repo, 'a.ts'), 'a\n');
    fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'x');
    fs.mkdirSync(path.join(repo, 'node_modules', 'dep'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'node_modules', 'dep', 'index.js'), 'keep\n');
    const home = tmp('gnomon-home-');
    const outside = path.join(tmp('gnomon-out-'), 'secret');
    fs.writeFileSync(outside, 'secret\n');
    // a FIFO is never read (no hang): the scan refuses it
    const s1 = createScratch({ home, repo, loopId: 'p', runId: 'lr-fifo' });
    execFileSync('mkfifo', [path.join(s1.tree, 'pipe')]);
    expect(() => scratchChanges(s1)).toThrow(/not a regular file/);
    removeScratch(s1);
    // a file swapped for a link pointing out: parked AS a link (its target string), never read through
    const s2 = createScratch({ home, repo, loopId: 'p', runId: 'lr-swap' });
    fs.writeFileSync(path.join(s2.tree, 'a.ts'), 'b\n');
    expect(scratchChanges(s2)).toHaveLength(1);
    fs.rmSync(path.join(s2.tree, 'a.ts'));
    fs.symlinkSync(outside, path.join(s2.tree, 'a.ts'));
    const p2 = parkScratch(s2, { home, message: 'm', loopTrailer: 'p@00000000' })!;
    expect(p2.changes).toMatchObject([{ path: 'a.ts', status: 'modified', mode: '120000' }]);
    expect(p2.diff).not.toMatch(/^\+secret$/m);
    removeScratch(s2);
    expect(GitRefusal).toBeDefined();
    // a hard link to an outside file is refused at the scan
    const s3 = createScratch({ home, repo, loopId: 'p', runId: 'lr-hard' });
    fs.linkSync(outside, path.join(s3.tree, 'hl.ts'));
    expect(() => scratchChanges(s3)).toThrow(/hard links/);
    removeScratch(s3);
    expect(fs.readFileSync(path.join(repo, 'node_modules', 'dep', 'index.js'), 'utf8')).toBe('keep\n');
    expect(fs.readFileSync(outside, 'utf8')).toBe('secret\n');
  });
});
