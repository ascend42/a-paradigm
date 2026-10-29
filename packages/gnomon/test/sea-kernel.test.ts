// @gnomon-platform: darwin
/**
 * #kernel-sea (TD-2026-10-29-746, G-ID-13): the BUILT SEA kernel, ad-hoc (scripts/build-sea.mjs --sign adhoc), in a
 * private kernel root (a copy of dist + package.json, gnomon.kernel, node/bin/node).
 *
 * Falsifiers:
 *   - the ad-hoc fallback: identifier gnomon.kernel, hardened runtime, allow-jit only, no get-task-allow, and the
 *     "unsigned → guarded only" note; the children's node is signed gnomon.node;
 *   - NODE_OPTIONS=--require=<x.js> never runs (the CLI, and the kernel in wrapper mode, which still starts: the
 *     variable is ignored and stripped, not refused);
 *   - the kernel smoke: `gnomon.kernel dev up --wrapper` answers up and launch; every child it spawns (gnomon-web)
 *     runs gnomon.node, none runs gnomon.kernel; `daemon --detach` re-execs the SEA with --gnomond and status sees it.
 * Base node: the pinned bundled node tarball. Skipped (with the reason) unless it is in the release cache
 * (~/Library/Caches/gnomon-release/node) or GNOMON_SEA_TEST=1 allows the download.
 */
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain .mjs script, no declarations
import * as sea from '../scripts/build-sea.mjs';
// @ts-expect-error -- a plain .mjs script, no declarations
import { nodeLockFor } from '../scripts/release-darwin.mjs';
import { readPidfile, pidAlive } from '../src/kernel/lifecycle/index.js';
import { privateTmpRoot } from './daemon-helpers.js';
import { PKG_ROOT } from './helpers.js';

const lock = nodeLockFor(process.arch);
const CACHE = path.join(os.homedir(), 'Library', 'Caches', 'gnomon-release', 'node');
const RUN = existsSync(path.join(CACHE, lock.file)) || process.env.GNOMON_SEA_TEST === '1';
const VERSION = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')).version as string;

let root = '';
let built: { kernel: string; signing: string; note: string | null; signature: { identifier: string; runtime: boolean; entitlements: string[]; getTaskAllow: boolean }; childNode: { path: string; signature: { identifier: string } } };
const ENV = (home: string, extra: Record<string, string> = {}): Record<string, string> => ({ HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', LANG: 'en_US.UTF-8', ...extra });

function injector(dir: string): { file: string; marker: string } {
  const marker = path.join(dir, 'INJECTED');
  const file = path.join(dir, 'inject.js');
  writeFileSync(file, `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x');\n`);
  return { file, marker };
}

describe.skipIf(!RUN)('#kernel-sea built binary (ad-hoc)', () => {
  beforeAll(async () => {
    root = realpathSync(mkdtempSync(path.join(privateTmpRoot(), 'sea-')));
    cpSync(path.join(PKG_ROOT, 'dist'), path.join(root, 'dist'), { recursive: true });
    copyFileSync(path.join(PKG_ROOT, 'package.json'), path.join(root, 'package.json'));
    built = await sea.buildKernelSea({ outDir: root, sign: 'adhoc' });
  }, 240_000);
  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it('FALSIFIER (ad-hoc fallback): identifier gnomon.kernel, hardened runtime, allow-jit only, no get-task-allow; guarded-only note', () => {
    expect(built.signing).toBe('adhoc');
    expect(built.note).toContain('unsigned → guarded only');
    expect(built.signature).toMatchObject({ identifier: 'gnomon.kernel.dev', runtime: true, getTaskAllow: false });
    expect(built.signature.entitlements).toEqual(['com.apple.security.cs.allow-jit']);
    expect(built.childNode.path).toBe(path.join(root, 'node', 'bin', 'node'));
    expect(built.childNode.signature.identifier).toBe('gnomon.node.dev');
    expect(sea.inspectSignature(built.kernel)).toMatchObject({ identifier: 'gnomon.kernel.dev', getTaskAllow: false });
  });

  it('FALSIFIER (Aegis H2): a dev SEA never meets the release requirement; buildSeaBinary refuses gnomon.kernel outside a release', async () => {
    const ok = spawnSync('/usr/bin/codesign', ['--verify', '--strict', `-R=${sea.kernelRequirement('adhoc', 'dev')}`, built.kernel]);
    expect(ok.status).toBe(0);
    const prod = spawnSync('/usr/bin/codesign', ['--verify', '--strict', `-R=${sea.kernelRequirement('adhoc', 'release')}`, built.kernel]);
    expect(prod.status).not.toBe(0);
    await expect(sea.buildSeaBinary({ baseNode: '/nonexistent', main: '/x', out: '/x', identifier: 'gnomon.kernel', work: root })).rejects.toThrow(/only release-darwin/);
    await expect(sea.buildSeaBinary({ baseNode: '/nonexistent', main: '/x', out: '/x', work: root })).rejects.toThrow(/explicit identifier/);
  });

  /** A copy of the signed kernel in a fresh root with a copy of dist + package.json (and optionally a child node). */
  function copyRoot(tag: string, node: 'signed' | 'impostor' | 'none' = 'signed'): string {
    const r = realpathSync(mkdtempSync(path.join(privateTmpRoot(), tag)));
    cpSync(path.join(root, 'dist'), path.join(r, 'dist'), { recursive: true });
    copyFileSync(path.join(root, 'package.json'), path.join(r, 'package.json'));
    copyFileSync(built.kernel, path.join(r, 'gnomon.kernel'));
    mkdirSync(path.join(r, 'node', 'bin'), { recursive: true });
    if (node === 'signed') copyFileSync(built.childNode.path, path.join(r, 'node', 'bin', 'node'));
    if (node === 'impostor') {
      // the pristine pinned node, ad-hoc signed with the dev child identifier: right identifier, wrong cdhash
      copyFileSync(built.childNode.path, path.join(r, 'node', 'bin', 'node'));
      const s = spawnSync('/usr/bin/codesign', ['--force', '--sign', '-', '--identifier', 'gnomon.node.dev', path.join(r, 'node', 'bin', 'node')], { encoding: 'utf8' });
      expect(s.status, s.stderr).toBe(0);
    }
    return r;
  }

  it('FALSIFIER (Aegis H1): beside changed kernel files the signed kernel refuses to start (exit 78), before any kernel code', () => {
    const r = copyRoot('sh1-');
    try {
      const k = path.join(r, 'gnomon.kernel');
      expect(spawnSync(k, ['--version'], { env: ENV(r), encoding: 'utf8' }).status).toBe(0);
      for (const tamper of [() => writeFileSync(path.join(r, 'dist', 'extra.js'), 'x'), () => writeFileSync(path.join(r, 'dist', 'transport', 'gnomon-web.js'), 'console.log("evil")\n')]) {
        tamper();
        const v = spawnSync(k, ['--version'], { env: ENV(r), encoding: 'utf8' });
        expect(v.status).toBe(78);
        expect(v.stderr).toMatch(/do not|hash to .* not this build's.*refusing to start/);
        expect(v.stdout).toBe('');
      }
    } finally {
      rmSync(r, { recursive: true, force: true });
    }
  });

  it('FALSIFIER (Aegis H1): beside an impostor child node (right identifier, wrong cdhash) the kernel spawns no child', async () => {
    const r = copyRoot('sh2-', 'impostor');
    try {
      const k = path.join(r, 'gnomon.kernel');
      const devHome = path.join(r, 'devhome');
      expect(spawnSync(k, ['dev', 'init', '--home', devHome], { env: ENV(r), encoding: 'utf8' }).status).toBe(0);
      const c = spawnSync(k, ['dev', 'up', '--home', devHome, '--wrapper'], { env: ENV(r), input: 'launch\nquit\n', encoding: 'utf8', timeout: 45_000 });
      expect(c.stdout + c.stderr).toMatch(/refuses to spawn a child|child-node requirement/);
      expect(c.stdout).not.toContain('"t":"launch"');
    } finally {
      rmSync(r, { recursive: true, force: true });
    }
  }, 60_000);

  it('FALSIFIER: NODE_OPTIONS=--require=<x.js> has no effect (CLI)', () => {
    const inj = injector(root);
    for (const opt of [`--require=${inj.file}`, `--import=${inj.file}`]) {
      const r = spawnSync(built.kernel, ['--version'], { env: ENV(root, { NODE_OPTIONS: opt }), encoding: 'utf8' });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout.trim()).toBe(`gnomon ${VERSION}`);
      expect(existsSync(inj.marker), opt).toBe(false);
    }
  });

  it('FALSIFIER (kernel smoke, wrapper mode): up + launch under NODE_OPTIONS; every child runs gnomon.node, never the kernel', async () => {
    const w = realpathSync(mkdtempSync(path.join(privateTmpRoot(), 'sw-')));
    try {
      const devHome = path.join(w, 'devhome');
      const inj = injector(w);
      const env = ENV(w, { NODE_OPTIONS: `--require=${inj.file}` });
      const init = spawnSync(built.kernel, ['dev', 'init', '--home', devHome], { env, encoding: 'utf8' });
      expect(init.status, init.stderr).toBe(0);
      const c = spawn(built.kernel, ['dev', 'up', '--home', devHome, '--wrapper'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
      const exited = new Promise<number | null>((r) => c.on('exit', (code) => r(code)));
      let out = '';
      c.stdout!.setEncoding('utf8').on('data', (s: string) => (out += s));
      const wait = async (t: string): Promise<void> => {
        for (const end = Date.now() + 45_000; !out.includes(`"t":"${t}"`); ) {
          if (Date.now() > end) throw new Error(`no ${t} line: ${out.slice(0, 400)}`);
          await new Promise((r) => setTimeout(r, 50));
        }
      };
      try {
        await wait('up');
        c.stdin!.write('launch\n');
        await wait('launch');
        const kids = spawnSync('/bin/ps', ['-axww', '-o', 'pid=,ppid=,command='], { encoding: 'utf8' })
          .stdout.split('\n')
          .map((l) => l.trim().split(/\s+/))
          .filter((f) => f[1] === String(c.pid))
          .map((f) => f.slice(2).join(' '));
        expect(kids.length, 'the web transport child').toBeGreaterThan(0);
        for (const k of kids) {
          expect(k.startsWith(path.join(root, 'node', 'bin', 'node')), k).toBe(true);
          expect(k).not.toContain('gnomon.kernel');
        }
        expect(existsSync(inj.marker)).toBe(false);
        c.stdin!.write('quit\n');
        expect(await exited).toBe(0);
      } finally {
        c.kill('SIGKILL');
      }
    } finally {
      rmSync(w, { recursive: true, force: true });
    }
  }, 90_000);

  it('FALSIFIER (daemon smoke): --detach re-execs the SEA as --gnomond --foreground with the clean env; status sees it', async () => {
    const w = realpathSync(mkdtempSync(path.join(privateTmpRoot(), 'sd-')));
    const h = path.join(w, 'h');
    try {
      const r = spawnSync(built.kernel, ['daemon', '--detach', '--home', h, '--idle-ms', '3000', '--no-open'], { env: ENV(w, { NODE_OPTIONS: '--no-warnings', GNOMON_HOME: '/nonexistent' }), encoding: 'utf8', timeout: 30_000 });
      expect(r.status, r.stderr).toBe(0);
      const pf = readPidfile(h)!;
      expect(pf).not.toBeNull();
      const ps = spawnSync('ps', ['eww', '-o', 'command=', '-p', String(pf.pid)], { encoding: 'utf8' }).stdout;
      expect(ps).toContain(`${built.kernel} --gnomond --foreground --home ${h}`);
      expect(ps).not.toMatch(/NODE_OPTIONS=|GNOMON_HOME=|--disable-sigusr1/);
      const st = spawnSync(built.kernel, ['daemon', 'status', '--home', h], { env: ENV(w), encoding: 'utf8' });
      expect(JSON.parse(st.stdout)).toMatchObject({ running: true, diagnosticPid: pf.pid });
      for (const end = Date.now() + 10_000; pidAlive(pf.pid) && Date.now() < end; ) await new Promise((res) => setTimeout(res, 100));
      expect(pidAlive(pf.pid)).toBe(false);
    } finally {
      rmSync(w, { recursive: true, force: true });
    }
  }, 60_000);
});
