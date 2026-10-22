/**
 * #gnomon-app-installer (T-2026-10-21-031, TD-2026-10-21-758; 8.0 M4): paradigm's `gnomon` installs the signed
 * Gnomon.app from the platform package's zip and launches the INSTALLED app, never the user's Node. Signing is out of
 * reach here, so the app check uses the test-only ALLOW_UNSIGNED_FOR_TESTS verifier on a fake app zip (ditto, macOS);
 * everything else (pinned zip hash, layout and version checks, staging beside the target, atomic swap, lock,
 * recovery) runs for real. The codesign half is proven on a signed release only (gate-gnomon-publish.mjs).
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, utimesSync, writeFileSync, appendFileSync, copyFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain .js bin module, no declarations
import * as inst from '../bin/gnomon-app.js';

const BIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin');
const REPO = path.resolve(BIN, '..', '..', '..');
const darwin = process.platform === 'darwin';
const ARCH = 'arm64'; // the one shipped arch in 8.0 (TD-2026-10-22-310)
const UNSIGNED = inst.ALLOW_UNSIGNED_FOR_TESTS.verifyApp as (app: string) => void;

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function tmp(): string {
  const d = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-shim-inst-')));
  dirs.push(d);
  return d;
}
const sha = (f: string): string => createHash('sha256').update(readFileSync(f)).digest('hex');

/** A release-layout fake Gnomon.app of `version`, zipped with ditto --keepParent (as release-darwin does). */
function fakeAppZip(version: string, { kernelVersion = version }: { kernelVersion?: string } = {}): { zip: string; sha256: string } {
  const d = tmp();
  const c = path.join(d, 'Gnomon.app', 'Contents');
  const write = (rel: string, body: string, mode = 0o644): void => {
    mkdirSync(path.dirname(path.join(c, rel)), { recursive: true });
    writeFileSync(path.join(c, rel), body);
    chmodSync(path.join(c, rel), mode);
  };
  write('Info.plist', '<?xml version="1.0"?><plist version="1.0"><dict/></plist>\n');
  // the "wrapper": proves the shim ran it in --cli mode with the args, and which env reached it
  write('MacOS/gnomon-wrapper', `#!/bin/sh\necho "WRAPPER ${version} $*"\n/usr/bin/env | /usr/bin/grep -E '^(NODE_|GNOMON_|DYLD_|ANTHROPIC_)' | /usr/bin/sed 's/^/LEAK /'\nexit 3\n`, 0o755);
  // the "bundled node": proves which node the shim ran, and with what
  write('Resources/node/bin/node', `#!/bin/sh\necho "BUNDLED-NODE ${version} $*"\nexit 3\n`, 0o755);
  write('Resources/kernel/package.json', JSON.stringify({ name: '@a-company/gnomon', version: kernelVersion, type: 'module' }));
  write('Resources/kernel/dist/cli/gnomon.js', '// kernel\n');
  const zip = path.join(d, `Gnomon-${version}.zip`);
  const r = spawnSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', path.join(d, 'Gnomon.app'), zip], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return { zip, sha256: sha(zip) };
}

const installedVersion = (dir: string): string => JSON.parse(readFileSync(path.join(dir, 'Gnomon.app', 'Contents/Resources/kernel/package.json'), 'utf8')).version;
/** Nothing transient left beside the app (staging dirs, old apps, the lock). */
const leftovers = (dir: string): string[] => readdirSync(dir).filter((n) => n.startsWith('.Gnomon.app'));

describe.runIf(darwin)('#gnomon-app-installer ensureApp (fake unsigned app, test-only verifier)', () => {
  it('fresh install: unpacks beside the target, verifies, renames into place, leaves nothing behind', async () => {
    const dir = path.join(tmp(), 'Applications'); // created by the installer, like ~/Applications
    const { zip, sha256 } = fakeAppZip('8.0.0');
    const seen: string[] = [];
    const r = await inst.ensureApp({
      zip,
      sha256,
      version: '8.0.0',
      installDir: dir,
      verifyApp: (app: string) => {
        // the staged app sits BESIDE the target (same volume, so the final rename is atomic)
        expect(path.dirname(path.dirname(app))).toBe(dir);
        seen.push(path.basename(path.dirname(app)));
      },
    });
    expect(r).toEqual({ app: path.join(dir, 'Gnomon.app'), action: 'installed', version: '8.0.0', verified: true });
    expect(seen[0]).toMatch(/^\.Gnomon\.app\.staging-/);
    expect(installedVersion(dir)).toBe('8.0.0');
    expect(leftovers(dir)).toEqual([]);
  });

  it('idempotent: a present app of this version (or newer) is used as is (no lock, no unpack, no copy)', async () => {
    const dir = tmp();
    const { zip, sha256 } = fakeAppZip('8.0.0');
    await inst.ensureApp({ zip, sha256, version: '8.0.0', installDir: dir, verifyApp: UNSIGNED });
    const ino = statSync(path.join(dir, 'Gnomon.app')).ino;
    const verified: string[] = [];
    const again = await inst.ensureApp({ zip: '/nonexistent.zip', sha256: '0'.repeat(64), version: '8.0.0', installDir: dir, verifyApp: (a: string) => verified.push(a), ditto: '/nonexistent/ditto' });
    expect(again).toEqual({ app: path.join(dir, 'Gnomon.app'), action: 'present', version: '8.0.0', verified: true });
    expect(verified).toEqual([path.join(dir, 'Gnomon.app')]); // the present app is verified before every launch (Aegis M4 medium 2)
    expect(statSync(path.join(dir, 'Gnomon.app')).ino).toBe(ino);
    // an older paradigm finds a newer app: it is left alone
    expect((await inst.ensureApp({ zip: '/nonexistent.zip', sha256: '0'.repeat(64), version: '7.99.0', installDir: dir, verifyApp: UNSIGNED })).action).toBe('present');
  });

  it('upgrade: the old app stays in place until the new one verifies, then is replaced and removed', async () => {
    const dir = tmp();
    const v0 = fakeAppZip('8.0.0');
    await inst.ensureApp({ ...v0, version: '8.0.0', installDir: dir, verifyApp: UNSIGNED });
    const v1 = fakeAppZip('8.0.1');
    const r = await inst.ensureApp({
      ...v1,
      version: '8.0.1',
      installDir: dir,
      verifyApp: () => expect(installedVersion(dir)).toBe('8.0.0'), // still the old one while the new is verified
    });
    expect(r.action).toBe('upgraded');
    expect(installedVersion(dir)).toBe('8.0.1');
    expect(leftovers(dir)).toEqual([]);
  });

  it('a failed verify keeps the old app (signature, wrong version inside, tampered zip)', async () => {
    const dir = tmp();
    await inst.ensureApp({ ...fakeAppZip('8.0.0'), version: '8.0.0', installDir: dir, verifyApp: UNSIGNED });
    const ino = statSync(path.join(dir, 'Gnomon.app')).ino;
    const keep = (): void => {
      expect(installedVersion(dir)).toBe('8.0.0');
      expect(statSync(path.join(dir, 'Gnomon.app')).ino).toBe(ino);
      expect(leftovers(dir)).toEqual([]);
    };
    const v1 = fakeAppZip('8.0.1');
    await expect(inst.ensureApp({ ...v1, version: '8.0.1', installDir: dir, verifyApp: (a: string) => { if (a.includes('.staging-')) throw new inst.ShimRefused('signature', 'not signed by team SW4BMQ8PNL'); } })).rejects.toMatchObject({ reason: 'signature' });
    keep();
    // the zip's own app says another version than the release that pinned it
    const lying = fakeAppZip('8.0.1', { kernelVersion: '8.0.2' });
    await expect(inst.ensureApp({ ...lying, version: '8.0.1', installDir: dir, verifyApp: UNSIGNED })).rejects.toMatchObject({ reason: 'version' });
    keep();
    // the zip does not hash to the pin: refused before it is ever unpacked
    await expect(inst.ensureApp({ zip: v1.zip, sha256: 'f'.repeat(64), version: '8.0.1', installDir: dir, verifyApp: UNSIGNED, ditto: '/nonexistent/ditto' })).rejects.toMatchObject({ reason: 'checksum' });
    keep();
  });

  /** a verifier that refuses any app carrying Contents/PLANTED (a stand-in for a bad signature) */
  const refusePlanted = (app: string): void => {
    if (existsSync(path.join(app, 'Contents', 'PLANTED'))) throw new inst.ShimRefused('signature', 'not signed by team SW4BMQ8PNL');
  };
  /** unpack a fake app of `version` straight to `where` and mark it planted */
  function plantApp(version: string, where: string): void {
    const { zip } = fakeAppZip(version);
    const x = tmp();
    spawnSync('/usr/bin/ditto', ['-x', '-k', zip, x]);
    writeFileSync(path.join(x, 'Gnomon.app', 'Contents', 'PLANTED'), '');
    renameSync(path.join(x, 'Gnomon.app'), where);
  }

  it('falsifier (Aegis M4 medium 2): a planted "99.0.0" app that fails verification is never trusted: moved aside, reported, reinstalled', async () => {
    const dir = tmp();
    plantApp('99.0.0', path.join(dir, 'Gnomon.app'));
    const events: Array<Record<string, string>> = [];
    const r = await inst.ensureApp({ ...fakeAppZip('8.0.0'), version: '8.0.0', installDir: dir, verifyApp: refusePlanted, onEvent: (e: Record<string, string>) => events.push(e) });
    expect(r).toMatchObject({ action: 'reinstalled', version: '8.0.0', verified: true });
    expect(installedVersion(dir)).toBe('8.0.0');
    const rejected = events.find((e) => e.step === 'rejected')!;
    expect(rejected.why).toMatch(/SW4BMQ8PNL/);
    // kept, not deleted silently: the planted app sits at the path the user was told
    expect(existsSync(path.join(rejected.movedTo!, 'Contents', 'PLANTED'))).toBe(true);
    expect(path.basename(rejected.movedTo!)).toMatch(/^\.Gnomon\.app\.rejected-/);
  });

  it('falsifier (Aegis M4 medium 3): a planted .Gnomon.app.old-* is not restored unless it verifies; the app is reinstalled', async () => {
    const dir = tmp();
    plantApp('99.0.0', path.join(dir, '.Gnomon.app.old-1-planted'));
    const events: Array<Record<string, string>> = [];
    const r = await inst.ensureApp({ ...fakeAppZip('8.0.0'), version: '8.0.0', installDir: dir, verifyApp: refusePlanted, onEvent: (e: Record<string, string>) => events.push(e) });
    expect(r.action).toBe('installed');
    expect(installedVersion(dir)).toBe('8.0.0');
    expect(events.some((e) => e.step === 'discarded')).toBe(true);
    expect(existsSync(path.join(dir, 'Gnomon.app', 'Contents', 'PLANTED'))).toBe(false);
    expect(leftovers(dir)).toEqual([]);
  });

  it('a Gnomon.app that is not ours is never replaced', async () => {
    const dir = tmp();
    mkdirSync(path.join(dir, 'Gnomon.app', 'Contents'), { recursive: true });
    writeFileSync(path.join(dir, 'Gnomon.app', 'Contents', 'mine'), 'x');
    await expect(inst.ensureApp({ ...fakeAppZip('8.0.0'), version: '8.0.0', installDir: dir, verifyApp: UNSIGNED })).rejects.toMatchObject({ reason: 'foreign' });
    expect(readFileSync(path.join(dir, 'Gnomon.app', 'Contents', 'mine'), 'utf8')).toBe('x');
  });

  it('recovery: an app a crashed swap left renamed aside is put back; a dead owner\'s lock is broken', async () => {
    const dir = tmp();
    await inst.ensureApp({ ...fakeAppZip('8.0.0'), version: '8.0.0', installDir: dir, verifyApp: UNSIGNED });
    renameSync(path.join(dir, 'Gnomon.app'), path.join(dir, '.Gnomon.app.old-1-dead'));
    mkdirSync(path.join(dir, '.Gnomon.app.staging-x'));
    const dead = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
    mkdirSync(path.join(dir, '.Gnomon.app.lock'));
    writeFileSync(path.join(dir, '.Gnomon.app.lock', 'owner.json'), JSON.stringify({ pid: Number(dead.stdout), start: 'Thu Jan  1 00:00:00 1970', nonce: 'gone' }));
    const r = await inst.ensureApp({ ...fakeAppZip('8.0.0'), version: '8.0.0', installDir: dir, verifyApp: UNSIGNED, lock: { timeoutMs: 5_000 } });
    expect(r.action).toBe('present'); // restored, not re-copied
    expect(leftovers(dir)).toEqual([]);
  });

  it('falsifier (Aegis M4 low): a reused pid (live, but another start time) or an ownerless lock over 30 s is stale', async () => {
    const dir = tmp();
    mkdirSync(path.join(dir, '.Gnomon.app.lock'));
    // this test runner's own pid is alive, but the lock records another start time: a reused pid
    writeFileSync(path.join(dir, '.Gnomon.app.lock', 'owner.json'), JSON.stringify({ pid: process.pid, start: 'Thu Jan  1 00:00:00 1970', nonce: 'old' }));
    (await inst.acquireInstallLock(dir, { timeoutMs: 2_000 }))();
    mkdirSync(path.join(dir, '.Gnomon.app.lock'));
    const old = (Date.now() - 31_000) / 1000;
    utimesSync(path.join(dir, '.Gnomon.app.lock'), old, old);
    (await inst.acquireInstallLock(dir, { timeoutMs: 2_000 }))();
    // a fresh ownerless lock (being created) is NOT stale
    mkdirSync(path.join(dir, '.Gnomon.app.lock'));
    await expect(inst.acquireInstallLock(dir, { timeoutMs: 300, pollMs: 50 })).rejects.toThrow(/let it finish and run gnomon again \(if no gnomon is running, remove /);
    rmSync(path.join(dir, '.Gnomon.app.lock'), { recursive: true });
    expect(leftovers(dir)).toEqual([]);
  });

  it('a live lock holds a second installer off until it is released (and times out cleanly)', async () => {
    const dir = tmp();
    const release = await inst.acquireInstallLock(dir);
    await expect(inst.acquireInstallLock(dir, { timeoutMs: 300, pollMs: 50 })).rejects.toMatchObject({ reason: 'busy' });
    release();
    (await inst.acquireInstallLock(dir, { timeoutMs: 300 }))();
    expect(leftovers(dir)).toEqual([]);
  });

  it('two gnomon runs at once (two processes): one installs, the other waits and finds it present', async () => {
    const dir = tmp();
    const { zip, sha256 } = fakeAppZip('8.0.0');
    const log = path.join(tmp(), 'verify.log');
    const script = path.join(tmp(), 'race.mjs');
    writeFileSync(
      script,
      `import * as inst from ${JSON.stringify(pathToFileURL(path.join(BIN, 'gnomon-app.js')).href)};
import { appendFileSync } from 'node:fs';
const r = await inst.ensureApp({ zip: ${JSON.stringify(zip)}, sha256: ${JSON.stringify(sha256)}, version: '8.0.0', installDir: ${JSON.stringify(dir)},
  verifyApp: (a) => { if (!a.includes('.staging-')) return; appendFileSync(${JSON.stringify(log)}, process.pid + '\\n'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400); } });
process.stdout.write(r.action);
`,
    );
    const runOne = (): Promise<{ code: number | null; out: string }> =>
      new Promise((resolve) => {
        const c = spawn(process.execPath, [script], { stdio: ['ignore', 'pipe', 'inherit'] });
        let out = '';
        c.stdout.on('data', (d) => (out += d));
        c.on('exit', (code) => resolve({ code, out }));
      });
    const [a, b] = await Promise.all([runOne(), runOne()]);
    expect([a.code, b.code]).toEqual([0, 0]);
    expect([a.out, b.out].sort()).toEqual(['installed', 'present']);
    expect(readFileSync(log, 'utf8').trim().split('\n')).toHaveLength(1); // unpacked and verified exactly once
    expect(installedVersion(dir)).toBe('8.0.0');
    expect(leftovers(dir)).toEqual([]);
  }, 30_000);
});

describe('#gnomon-app-installer pins and constants', () => {
  /** a gnomon package dir with a build stamp */
  function gnomonPkg(stamp: unknown): string {
    const g = tmp();
    mkdirSync(path.join(g, 'dist'));
    writeFileSync(path.join(g, 'dist', 'build-id.json'), JSON.stringify(stamp));
    return g;
  }

  it('the zip pin comes from gnomon\'s release stamp; a dev build, another release or an unpinned arch is refused', () => {
    const z = { arch: 'arm64', sha256: 'a'.repeat(64) };
    const release = { schemaVersion: 'gnomon-release-manifest:v1', release: '8.0.0', artifacts: [], appZips: [z] };
    expect(inst.compiledAppZipPin(gnomonPkg({ version: '8.0.0', release }), '8.0.0', 'arm64')).toBe('a'.repeat(64));
    expect(() => inst.compiledAppZipPin(gnomonPkg({ version: '8.0.0' }), '8.0.0', 'arm64')).toThrow(/development build/);
    expect(() => inst.compiledAppZipPin(gnomonPkg({ version: '8.0.0', release: { ...release, release: '7.9.0' } }), '8.0.0', 'arm64')).toThrow(/pins of release 7.9.0/);
    expect(() => inst.compiledAppZipPin(gnomonPkg({ version: '8.0.0', release }), '8.0.0', 'x64')).toThrow(/pins no Gnomon.app for x64/);
    expect(() => inst.compiledAppZipPin(tmp(), '8.0.0', 'arm64')).toThrow(/no readable build stamp/);
  });

  it('versions compare as semver (a prerelease below its release)', () => {
    expect(inst.compareVersions('8.0.1', '8.0.0')).toBe(1);
    expect(inst.compareVersions('8.0.0', '8.0.0')).toBe(0);
    expect(inst.compareVersions('8.0.0-rc.1', '8.0.0')).toBe(-1);
    expect(inst.compareVersions('8.10.0', '8.9.9')).toBe(1);
  });

  it('install dir: /Applications when writable without sudo, else ~/Applications (the kernel\'s rule)', () => {
    expect(inst.appInstallDir({ home: '/Users/u', writable: () => true })).toBe('/Applications');
    expect(inst.appInstallDir({ home: '/Users/u', writable: () => false })).toBe('/Users/u/Applications');
  });

  it('the wrapper requirement and the layout are the release script\'s', async () => {
    const bd = await import(pathToFileURL(path.join(REPO, 'packages', 'gnomon-wrapper', 'scripts', 'build-darwin.mjs')).href);
    expect(inst.WRAPPER_REQUIREMENT).toBe(bd.WRAPPER_REQUIREMENT);
    const rel = await import(pathToFileURL(path.join(REPO, 'packages', 'gnomon', 'scripts', 'release-darwin.mjs')).href);
    expect(inst.LAYOUT.wrapper).toBe(`Contents/${rel.LAYOUT.wrapper}`);
    expect(inst.LAYOUT.node).toBe(`Contents/${rel.LAYOUT.node}`);
    expect(inst.LAYOUT.kernelPackage).toBe(`Contents/${rel.LAYOUT.kernel}/package.json`);
    expect(inst.LAYOUT.cli).toBe(`Contents/${rel.LAYOUT.kernel}/dist/cli/gnomon.js`);
  });
});

describe('#gnomon-shim never loads Node 24 code and never runs Gnomon on the user\'s node', () => {
  const sources = ['gnomon.js', 'gnomon-app.js'].map((f) => [f, readFileSync(path.join(BIN, f), 'utf8')] as const);

  it('imports only node: built-ins and its sibling, no dynamic import, no package CLI on process.execPath', () => {
    for (const [f, src] of sources) {
      const specs = [...src.matchAll(/^\s*import\s[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1]!);
      expect(specs.filter((s) => !s.startsWith('node:') && s !== './gnomon-app.js'), f).toEqual([]);
      expect(src, f).not.toMatch(/\bimport\s*\(/);
      expect(src, f).not.toMatch(/\brequire\s*\(/);
      expect(src, f).not.toMatch(/spawn(Sync)?\(\s*process\.execPath/);
    }
  });

  it('the CLI entry passes no test seam (the codesign verifier and the real install dir always apply)', () => {
    const main = sources[0][1].slice(sources[0][1].indexOf('if (isMain)'));
    expect(main).toMatch(/run\(process\.argv\.slice\(2\)\)/);
    expect(main).not.toMatch(/verifyApp|ALLOW_UNSIGNED|installDir/);
    expect(sources[0][1]).not.toMatch(/ALLOW_UNSIGNED_FOR_TESTS/);
  });

  /** the oldest node on this machine below 24 (nvm), or GNOMON_SHIM_OLD_NODE */
  function oldNode(): string | null {
    if (process.env.GNOMON_SHIM_OLD_NODE) return process.env.GNOMON_SHIM_OLD_NODE;
    const nvm = path.join(os.homedir(), '.nvm', 'versions', 'node');
    if (!existsSync(nvm)) return null;
    const v = readdirSync(nvm).filter((n) => /^v2[0-3]\./.test(n)).sort((a, b) => Number(a.split('.')[0]!.slice(1)) - Number(b.split('.')[0]!.slice(1)))[0];
    return v ? path.join(nvm, v, 'bin', 'node') : null;
  }

  it.runIf(darwin)('end to end on a pre-24 node: installs, then a verb runs the app\'s wrapper --cli with a scrubbed env and bare gnomon opens the app', () => {
    const node = oldNode() ?? process.execPath;
    const major = Number(spawnSync(node, ['-p', 'process.versions.node.split(".")[0]'], { encoding: 'utf8' }).stdout.trim());
    if (node === process.execPath) process.stderr.write('gnomon-shim-install: no node < 24 found (set GNOMON_SHIM_OLD_NODE); ran on this node\n');
    else expect(major).toBeLessThan(24);
    const { zip, sha256 } = fakeAppZip('8.0.0');
    // a paradigm install tree whose gnomon carries a release stamp pinning this zip
    const root = tmp();
    const nm = path.join(root, 'node_modules', '@a-company');
    const g = path.join(nm, 'gnomon');
    const p = path.join(nm, `gnomon-darwin-${ARCH}`);
    mkdirSync(path.join(g, 'dist'), { recursive: true });
    mkdirSync(p, { recursive: true });
    writeFileSync(path.join(g, 'dist', 'build-id.json'), JSON.stringify({ version: '8.0.0', release: { release: '8.0.0', appZips: [{ arch: ARCH, sha256 }] } }));
    copyFileSync(zip, path.join(p, 'Gnomon.app.zip'));
    const dir = path.join(root, 'Applications');
    const open = path.join(root, 'fake-open');
    writeFileSync(open, '#!/bin/sh\necho "OPEN $*"\n');
    chmodSync(open, 0o755);
    const script = path.join(tmp(), 'e2e.mjs');
    writeFileSync(
      script,
      `import { run } from ${JSON.stringify(pathToFileURL(path.join(BIN, 'gnomon.js')).href)};
import * as inst from ${JSON.stringify(pathToFileURL(path.join(BIN, 'gnomon-app.js')).href)};
const o = { arch: ${JSON.stringify(ARCH)}, resolve: () => ({ ok: true, gnomonPackage: ${JSON.stringify(g)}, platformPackage: ${JSON.stringify(p)}, version: '8.0.0' }),
  installDir: ${JSON.stringify(dir)}, verifyApp: inst.ALLOW_UNSIGNED_FOR_TESTS.verifyApp, open: ${JSON.stringify(open)} };
const args = JSON.parse(process.argv[2]);
process.exitCode = await run(args, o);
`,
    );
    // the caller's NODE_OPTIONS / GNOMON_* never reach the wrapper (Aegis M4 high 1; the wrapper scrubs again). The
    // NODE_OPTIONS value is harmless to the shim's own node; the fake wrapper prints a LEAK line for any that arrive.
    const dirty = { ...process.env, NODE_OPTIONS: '--max-old-space-size=4096', GNOMON_HOME: '/elsewhere', GNOMON_NO_OPEN: '1', ANTHROPIC_API_KEY: 'sk' };
    const verb = spawnSync(node, [script, JSON.stringify(['identity', 'status'])], { encoding: 'utf8', env: dirty });
    expect(verb.stderr).toMatch(/installing Gnomon 8.0.0/);
    // the verb goes THROUGH the wrapper (the one trust root), never straight to the bundled node
    expect(verb.stdout.trim()).toBe('WRAPPER 8.0.0 --cli -- identity status'); // and no LEAK line
    expect(verb.status).toBe(3); // the wrapper's exit code
    const bare = spawnSync(node, [script, '[]'], { encoding: 'utf8', env: dirty });
    expect(bare.stdout.trim()).toBe(`OPEN ${path.join(dir, 'Gnomon.app')}`);
    expect(bare.stderr).toBe(''); // already installed: nothing to say
    expect(bare.status).toBe(0);
    // a tampered platform zip is refused before anything runs (the installed app stays)
    appendFileSync(path.join(p, 'Gnomon.app.zip'), 'x');
    rmSync(path.join(dir, 'Gnomon.app'), { recursive: true });
    const tampered = spawnSync(node, [script, '[]'], { encoding: 'utf8' });
    expect(tampered.status).toBe(77);
    expect(tampered.stderr).toMatch(/not the [0-9a-f]{64} this release pins; refused/);
    expect(tampered.stdout).toBe('');
  }, 60_000);
});
