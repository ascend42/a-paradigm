// @gnomon-platform: darwin
/**
 * The darwin `loop-check` profile ENFORCED under sandbox-exec with real check children (docs/specs/gnomon-loops.md
 * §4 "Sandboxes", §7; build plan step 4, the loops' stand-in for M2.3's oracle profile). From inside the child:
 * G-SBX-07 (no network connect, loopback included; no write outside the copy; no read of ~/.ssh, ~/.aws or the
 * Gnomon home), G-SBX-04..06 against this profile (osascript, launchctl, open, and a shell cannot exec), G-SEC-02
 * end to end (NODE_OPTIONS, GNOMON_* and secrets never reach the child), node_modules read-only, timeout and crash
 * are `error` with the process group gone, evidence redacted, the copy removed or kept, and builtins through a
 * pinned paradigm CLI entry. Requires the session floor (macOS 15+ AND SIP); below it the backend refuses.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { darwinFloor } from '../src/kernel/sandbox/session.js';
import { checkRunDir, makeCheckCopy, pinFile, pinParadigmCli, runCheck, CheckCopyRefusal, type CheckExecInput } from '../src/kernel/loops/check-exec.js';
import { processControlFor } from '../src/kernel/lifecycle/process-control.js';

const floor = darwinFloor();
const dirs: string[] = [];
const tmp = (): string => {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-lcs-')));
  dirs.push(d);
  return d;
};
const gitEnv = { PATH: process.env.PATH ?? '', HOME: os.tmpdir(), GIT_CONFIG_NOSYSTEM: '1' } as Record<string, string>;

const PROBE = `#!/usr/bin/env node
import * as fs from 'node:fs';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
const cfg = JSON.parse(fs.readFileSync('probe-config.json', 'utf8'));
const code = (f) => { try { f(); return 'ok'; } catch (e) { return e.code ?? String(e.message).slice(0, 40); } };
const connect = (host, port) => new Promise((res) => {
  const s = net.connect({ host, port });
  const t = setTimeout(() => { s.destroy(); res('timeout'); }, 3000);
  s.on('connect', () => { clearTimeout(t); s.destroy(); res('connected'); });
  s.on('error', (e) => { clearTimeout(t); res(e.code); });
});
const exec = (p) => { const r = spawnSync(p, ['-h'], { timeout: 5000 }); return r.error ? r.error.code : 'status:' + r.status; };
const out = {
  readCopy: code(() => fs.readFileSync('src/a.txt')),
  writeCopy: code(() => fs.writeFileSync('src/new.txt', 'x')),
  writeTmp: code(() => fs.writeFileSync(process.env.TMPDIR + '/t.txt', 'x')),
  readDep: code(() => fs.readFileSync('node_modules/dep/index.js')),
  writeDep: code(() => fs.writeFileSync('node_modules/dep/index.js', 'pwned')),
  writeRepoRoot: code(() => fs.writeFileSync(cfg.repoRootFile, 'x')),
  writeSysTmp: code(() => fs.writeFileSync(cfg.sysTmpFile, 'x')),
  readFakeSsh: code(() => fs.readFileSync(cfg.fakeSsh)),
  readFakeAws: code(() => fs.readFileSync(cfg.fakeAws)),
  readGnomonKeys: code(() => fs.readFileSync(cfg.gnomonKey)),
  readGnomonOther: code(() => fs.readFileSync(cfg.gnomonOther)),
  readRealSsh: code(() => fs.readdirSync(cfg.realSsh)),
  readRepoOriginal: code(() => fs.readFileSync(cfg.repoRootOriginal)),
  connectLoopback: await connect('127.0.0.1', cfg.port),
  connectRemote: await connect('1.1.1.1', 443),
  osascript: exec('/usr/bin/osascript'),
  launchctl: exec('/bin/launchctl'),
  open: exec('/usr/bin/open'),
  sh: exec('/bin/sh'),
  envKeys: Object.keys(process.env).sort(),
  home: process.env.HOME,
};
process.stdout.write(JSON.stringify(out));
`;

let repo = '';
let gnomonHome = '';
let fakeHome = '';
let server: net.Server;
let port = 0;
let hits = 0;

function file(rel: string, body: string, mode = 0o644): string {
  const p = path.join(repo, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body, { mode });
  return p;
}
// every probe is a `#!/usr/bin/env node` script: its interpreter (the kernel node) is pinned like the registry pins it
const base = (over: Partial<CheckExecInput> & Pick<CheckExecInput, 'runId' | 'node'>): CheckExecInput => ({ repo, home: gnomonHome, userHome: fakeHome, envFrom: { ...gitEnv }, interpreter: pinFile(process.execPath), ...over });

beforeAll(async () => {
  if (!floor.ok) return;
  repo = tmp();
  gnomonHome = tmp();
  fakeHome = tmp();
  expect(spawnSync('git', ['init', '-q'], { cwd: repo, env: gitEnv }).status).toBe(0);
  fs.mkdirSync(path.join(gnomonHome, 'keys'));
  fs.writeFileSync(path.join(gnomonHome, 'keys', 'root.key'), 'KEY');
  fs.writeFileSync(path.join(gnomonHome, 'grants.jsonl'), 'G');
  fs.mkdirSync(path.join(fakeHome, '.ssh'));
  fs.writeFileSync(path.join(fakeHome, '.ssh', 'id_ed25519'), 'SSH');
  fs.mkdirSync(path.join(fakeHome, '.aws'));
  fs.writeFileSync(path.join(fakeHome, '.aws', 'credentials'), 'AWS');
  server = net.createServer((s) => {
    hits++;
    s.end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as net.AddressInfo).port;
  file('.gitignore', 'node_modules/\n');
  file('src/a.txt', 'A');
  file('node_modules/dep/index.js', 'export default 1;\n');
  file('probe.mjs', PROBE, 0o755);
  file('probe-config.json', JSON.stringify({
    port,
    repoRootFile: path.join(repo, 'escaped.txt'),
    repoRootOriginal: path.join(repo, 'src', 'a.txt'),
    sysTmpFile: path.join(fs.realpathSync('/tmp'), `gnomon-lcs-${process.pid}.txt`),
    fakeSsh: path.join(fakeHome, '.ssh', 'id_ed25519'),
    fakeAws: path.join(fakeHome, '.aws', 'credentials'),
    gnomonKey: path.join(gnomonHome, 'keys', 'root.key'),
    gnomonOther: path.join(gnomonHome, 'grants.jsonl'),
    realSsh: path.join(fs.realpathSync(os.homedir()), '.ssh'),
  }));
});
afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe.skipIf(!floor.ok)('the darwin loop-check profile, enforced (macOS 15+ and SIP)', () => {
  let out: Record<string, unknown> = {};
  let result: Awaited<ReturnType<typeof runCheck>>;
  beforeAll(async () => {
    const envFrom = { ...gitEnv, NODE_OPTIONS: '--require /nonexistent/hook.js', AWS_SECRET_ACCESS_KEY: 'wJalrXUtnFEMI', GNOMON_SOCK: '/tmp/s', GNOMON_HOME: gnomonHome, ANTHROPIC_API_KEY: 'sk-ant-xyz', GITHUB_TOKEN: 'ghp_x' };
    result = await runCheck(base({ runId: 'probe', node: { id: 'probe', run: ['./probe.mjs'], pass: { exit: 0 }, timeoutSec: 60 }, argv0: pinFile(path.join(repo, 'probe.mjs')), envFrom }));
    out = result.evidence.stdoutTail ? JSON.parse(result.evidence.stdoutTail) : {};
  }, 90_000);

  it('the probe ran under the profile and passed; the copy is removed after a pass', () => {
    expect(result, JSON.stringify({ ...result, evidence: { ...result.evidence, stdoutTail: '' } })).toMatchObject({ verdict: 'pass', exitCode: 0, copy: { kept: false } });
    expect(result.profileHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(fs.existsSync(checkRunDir(gnomonHome, 'probe'))).toBe(false);
    expect(fs.existsSync(path.join(repo, '.gnomon'))).toBe(false);
    expect(result.evidence).toMatchObject({ label: 'private', sensitive: true });
  });
  it('reads and writes inside the copy and its TMPDIR; reads node_modules but never writes it', () => {
    expect(out).toMatchObject({ readCopy: 'ok', writeCopy: 'ok', writeTmp: 'ok', readDep: 'ok', writeDep: 'EPERM' });
    expect(fs.readFileSync(path.join(repo, 'node_modules', 'dep', 'index.js'), 'utf8')).toBe('export default 1;\n');
  });
  it('G-SBX-07: no network connect (loopback included), no write outside the copy, no read of ~/.ssh, ~/.aws, the Gnomon home (outside its own run dir) or the real repo', () => {
    expect(out).toMatchObject({ connectLoopback: 'EPERM', connectRemote: 'EPERM', writeRepoRoot: 'EPERM', writeSysTmp: 'EPERM', readFakeSsh: 'EPERM', readFakeAws: 'EPERM', readGnomonKeys: 'EPERM', readGnomonOther: 'EPERM', readRepoOriginal: 'EPERM' });
    expect(out.readRealSsh).not.toBe('ok');
    expect(hits).toBe(0);
    expect(fs.existsSync(path.join(repo, 'escaped.txt'))).toBe(false);
  });
  it('G-SBX-04 osascript, G-SBX-05 launchctl, G-SBX-06 open — and a shell — cannot exec', () => {
    expect(out).toMatchObject({ osascript: 'EPERM', launchctl: 'EPERM', open: 'EPERM', sh: 'EPERM' });
  });
  it('G-SEC-02: NODE_OPTIONS, GNOMON_*, ANTHROPIC_* and secrets never reach the check; HOME is the check’s own', () => {
    const keys = out.envKeys as string[];
    for (const k of ['NODE_OPTIONS', 'AWS_SECRET_ACCESS_KEY', 'GNOMON_SOCK', 'GNOMON_HOME', 'ANTHROPIC_API_KEY', 'GITHUB_TOKEN']) expect(keys, k).not.toContain(k);
    expect(result.envKeys).toEqual(keys);
    expect(String(out.home)).toContain(`${path.sep}check-probe${path.sep}home`);
  });
});

describe.skipIf(!floor.ok)('verdicts, evidence and cleanup through a real check child', () => {
  const script = (name: string, body: string): string => file(name, `#!/usr/bin/env node\n${body}\n`, 0o755);

  it('a TAP report is parsed: one not ok is fail, its counts recorded; a planted secret is redacted in the evidence', async () => {
    const p = script('tap.mjs', "console.log('TAP version 13\\n1..2\\nok 1 a\\nnot ok 2 b'); console.error('leaked AKIAIOSFODNN7EXAMPLE and api_key=supersecretvalue1');");
    const r = await runCheck(base({ runId: 'tap', node: { id: 't', run: ['./tap.mjs'], pass: { parse: 'tap', failed: 0 }, timeoutSec: 30 }, argv0: pinFile(p) }));
    expect(r).toMatchObject({ verdict: 'fail', counts: { passed: 1, failed: 1, total: 2 }, copy: { kept: false } });
    expect(r.evidence.stderrTail).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(r.evidence.stderrTail).not.toContain('supersecretvalue1');
    expect(r.evidence.redactions.map((x) => x.kind).sort()).toEqual(['aws-access-key', 'generic-secret']);
  }, 30_000);

  it('a timeout is error; the whole process group (a spawned grandchild included) is gone; the copy is kept for debugging', async () => {
    const p = script('hang.mjs', "import { spawn } from 'node:child_process'; const c = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }); console.log('pgid', process.pid, c.pid); setInterval(() => {}, 1000);");
    const r = await runCheck(base({ runId: 'hang', node: { id: 'h', run: ['./hang.mjs'], pass: { exit: 0 }, timeoutSec: 6 }, argv0: pinFile(p) }));
    expect(r).toMatchObject({ verdict: 'error', reason: 'timeout', copy: { kept: true } });
    const m = /pgid (\d+) (\d+)/.exec(r.evidence.stdoutTail);
    expect(m).not.toBeNull();
    expect(processControlFor('darwin').probeGroup(Number(m![1]))).toBe('gone');
    fs.rmSync(r.copy.dir, { recursive: true, force: true });
  }, 30_000);

  it('a crash (killed by a signal) is error crash, never fail', async () => {
    const p = script('crash.mjs', 'process.abort();');
    const r = await runCheck(base({ runId: 'crash', node: { id: 'c', run: ['./crash.mjs'], pass: { exit: 0 }, timeoutSec: 30 }, argv0: pinFile(p), keepOnError: false }));
    expect(r).toMatchObject({ verdict: 'error', reason: 'crash', signal: 'SIGABRT', copy: { kept: false } });
  }, 30_000);

  it('argv0 changed after trust is error pin-mismatch and nothing runs', async () => {
    const p = script('drift.mjs', "console.log('v1');");
    const pin = pinFile(p);
    fs.appendFileSync(p, '// one byte\n');
    const r = await runCheck(base({ runId: 'drift', node: { id: 'd', run: ['./drift.mjs'], pass: { exit: 0 }, timeoutSec: 30 }, argv0: pin, keepOnError: false }));
    expect(r).toMatchObject({ verdict: 'error', reason: 'pin-mismatch', exitCode: null });
  }, 30_000);

  const fakeCli = (body: string): string => {
    const pkg = tmp();
    fs.writeFileSync(path.join(pkg, 'package.json'), JSON.stringify({ name: '@a-company/paradigm', type: 'module' }));
    fs.mkdirSync(path.join(pkg, 'dist'));
    fs.writeFileSync(path.join(pkg, 'dist', 'chunk-a.js'), 'export const x = 1;\n');
    const entry = path.join(pkg, 'dist', 'index.js');
    fs.writeFileSync(entry, body);
    return entry;
  };

  it('a builtin runs as node <pinned paradigm CLI> loop builtin <name> --json; the json rule judges it; a tampered dist chunk is pin-mismatch', async () => {
    const entry = fakeCli("const a = process.argv.slice(2); const ok = a[0]==='loop' && a[1]==='builtin' && a[3]==='--json'; console.log(JSON.stringify({ builtin: a[2], ok, passed: 3, failed: ok ? 0 : 1, args: a[5] ? JSON.parse(a[5]) : null }));");
    const pin = pinParadigmCli(entry);
    const r = await runCheck(base({ runId: 'bi', node: { id: 'b', builtin: 'paradigm.ripple', args: { symbol: '#x' }, pass: { json: '$.failed', op: '==', value: 0 }, timeoutSec: 30 }, paradigmCli: pin }));
    expect(r, r.detail ?? r.evidence.stderrTail).toMatchObject({ verdict: 'pass', value: 0, counts: { failed: 0, passed: 3 } });
    expect(JSON.parse(r.evidence.stdoutTail)).toMatchObject({ builtin: 'paradigm.ripple', args: { symbol: '#x' } });
    fs.appendFileSync(path.join(path.dirname(entry), 'chunk-a.js'), '// x\n');
    const t = await runCheck(base({ runId: 'bi2', node: { id: 'b', builtin: 'paradigm.ripple', pass: { exit: 0 }, timeoutSec: 30 }, paradigmCli: pin, keepOnError: false }));
    expect(t).toMatchObject({ verdict: 'error', reason: 'pin-mismatch' });
  }, 30_000);

  it('a builtin that could not judge (exit 2) or crashed (exit 1, no JSON verdict) is error, never pass or fail', async () => {
    const e2 = fakeCli("console.log(JSON.stringify({ builtin: 'git.clean', ok: false, passed: 0, failed: 0, error: 'git status failed' })); process.exit(2);");
    const e = await runCheck(base({ runId: 'bi3', node: { id: 'b', builtin: 'git.clean', pass: { json: '$.failed', op: '==', value: 0 }, timeoutSec: 30 }, paradigmCli: pinParadigmCli(e2), keepOnError: false }));
    expect(e).toMatchObject({ verdict: 'error', reason: 'builtin-error' });
    expect(e.detail).toContain('git status failed');
    const crash = fakeCli("throw new Error('boom');");
    const c = await runCheck(base({ runId: 'bi4', node: { id: 'b', builtin: 'git.clean', pass: { exit: 0 }, timeoutSec: 30 }, paradigmCli: pinParadigmCli(crash), keepOnError: false }));
    expect(c).toMatchObject({ verdict: 'error', reason: 'builtin-error', exitCode: 1 });
  }, 30_000);

  it('a script argv0 with no interpreter pin is pin-mismatch; nothing runs', async () => {
    const p = script('nopin.mjs', "console.log('ran');");
    const r = await runCheck(base({ runId: 'nopin', node: { id: 'n', run: ['./nopin.mjs'], pass: { exit: 0 }, timeoutSec: 30 }, argv0: pinFile(p), interpreter: undefined, keepOnError: false }));
    expect(r).toMatchObject({ verdict: 'error', reason: 'pin-mismatch', exitCode: null });
    expect(r.detail).toMatch(/no trusted pin/);
  }, 30_000);

  it('a child that leaves the process group (setsid) is swept and killed after the check exits', async () => {
    const p = script('escape.mjs', "import { spawn } from 'node:child_process'; const c = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', detached: true }); c.unref(); console.log('escaped', c.pid); setTimeout(() => process.exit(0), 1500);");
    const r = await runCheck(base({ runId: 'esc', node: { id: 'e', run: ['./escape.mjs'], pass: { exit: 0 }, timeoutSec: 30 }, argv0: pinFile(p) }));
    expect(r.verdict).toBe('pass');
    const pid = Number(/escaped (\d+)/.exec(r.evidence.stdoutTail)![1]);
    expect(r.escapedKilled).toBeGreaterThanOrEqual(1);
    await new Promise((res) => setTimeout(res, 300));
    expect(processControlFor('darwin').probeGroup(pid)).toBe('gone');
  }, 30_000);

  it("a json rule's value is bounded and secret-scanned before it is returned", async () => {
    const p = script('val.mjs', "console.log(JSON.stringify({ msg: 'key AKIAIOSFODNN7EXAMPLE ' + 'x'.repeat(2000) }));");
    const r = await runCheck(base({ runId: 'val', node: { id: 'v', run: ['./val.mjs'], pass: { json: '$.msg', op: '!=', value: 'nope' }, timeoutSec: 30 }, argv0: pinFile(p) }));
    expect(r.verdict).toBe('pass');
    expect(typeof r.value).toBe('string');
    expect((r.value as string).length).toBeLessThanOrEqual(257);
    expect(r.value as string).not.toContain('AKIAIOSFODNN7EXAMPLE');
  }, 30_000);
});

describe.skipIf(!floor.ok)('the copy refuses paths that resolve outside the repo', () => {
  const fresh = (): string => {
    const r = tmp();
    expect(spawnSync('git', ['init', '-q'], { cwd: r, env: gitEnv }).status).toBe(0);
    return r;
  };
  it('a node_modules link to a dir outside the repo (say ~/Documents) is refused: it would widen the reads', () => {
    const r = fresh();
    const outside = tmp();
    fs.writeFileSync(path.join(r, 'a.txt'), 'A');
    fs.symlinkSync(outside, path.join(r, 'node_modules'));
    const h = tmp();
    expect(() => makeCheckCopy(r, 'nm', gitEnv, undefined, h)).toThrow(CheckCopyRefusal);
    expect(() => makeCheckCopy(r, 'nm', gitEnv, undefined, h)).toThrow(/node_modules resolves outside the repo/);
    expect(fs.existsSync(checkRunDir(h, 'nm'))).toBe(false);
  });
  it('a tracked file whose parent dir was swapped for a link out of the repo is refused, its bytes never copied', () => {
    const r = fresh();
    const outside = tmp();
    fs.mkdirSync(path.join(r, 'sub'));
    fs.writeFileSync(path.join(r, 'sub', 'f.txt'), 'in-repo');
    const env = { ...gitEnv, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
    expect(spawnSync('git', ['add', '.'], { cwd: r, env }).status).toBe(0);
    expect(spawnSync('git', ['commit', '-qm', 'x'], { cwd: r, env }).status).toBe(0);
    fs.writeFileSync(path.join(outside, 'f.txt'), 'SECRET-OUTSIDE');
    fs.rmSync(path.join(r, 'sub'), { recursive: true });
    fs.symlinkSync(outside, path.join(r, 'sub'));
    const h = tmp();
    expect(() => makeCheckCopy(r, 'swap', gitEnv, undefined, h)).toThrow(/resolves outside the repo or changed during the copy/);
    expect(fs.existsSync(checkRunDir(h, 'swap'))).toBe(false);
  });
});

describe.skipIf(!floor.ok)('TD-2026-10-23-268: named secrets, redact: off and network: on through a real check child', () => {
  const script = (name: string, body: string): string => file(name, `#!/usr/bin/env node\n${body}\n`, 0o755);
  const envDir = (): string => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'app.env'), 'STRIPE_KEY=sk_live_51HxYz\nANTHROPIC_API_KEY="sk-ant-api03-named"\nGITHUB_TOKEN=ghp_unnamedtoken0000000000000000000000\n');
    return d;
  };

  it('a named secret (from the env file) reaches the check child; an unnamed one in the same file, or in the daemon env, does not', async () => {
    const d = envDir();
    const p = script('env-probe.mjs', "process.stdout.write(JSON.stringify({ stripe: process.env.STRIPE_KEY ?? null, ant: process.env.ANTHROPIC_API_KEY ?? null, gh: process.env.GITHUB_TOKEN ?? null, nodeOptions: process.env.NODE_OPTIONS ?? null }));");
    const r = await runCheck(base({ runId: 'envp', node: { id: 'e', run: ['./env-probe.mjs'], pass: { exit: 0 }, timeoutSec: 30, env: ['STRIPE_KEY', 'ANTHROPIC_API_KEY'] }, argv0: pinFile(p), envFrom: { ...gitEnv, GITHUB_TOKEN: 'ghp_daemon', NODE_OPTIONS: '--require /nonexistent/hook.js' }, envSource: { files: [{ path: path.join(d, 'app.env'), shown: '~/app.env' }] }, redact: false }));
    expect(r.verdict, JSON.stringify(r)).toBe('pass');
    expect(JSON.parse(r.evidence.stdoutTail)).toEqual({ stripe: 'sk_live_51HxYz', ant: 'sk-ant-api03-named', gh: null, nodeOptions: null });
    expect(r.envKeys).toEqual(expect.arrayContaining(['STRIPE_KEY', 'ANTHROPIC_API_KEY']));
    expect(r.envKeys).not.toContain('GITHUB_TOKEN');
  }, 30_000);

  it('redact: off leaves the check output raw; the default redacts it, a handed-out value by literal too', async () => {
    const d = envDir();
    const p = script('leak.mjs', "console.error('leaked AKIAIOSFODNN7EXAMPLE and api_key=supersecretvalue1 and ' + process.env.STRIPE_KEY);");
    const node = { id: 'l', run: ['./leak.mjs'], pass: { exit: 0 as const }, timeoutSec: 30, env: ['STRIPE_KEY'] };
    const envSource = { files: [{ path: path.join(d, 'app.env'), shown: 'app.env' }] };
    const raw = await runCheck(base({ runId: 'raw', node, argv0: pinFile(p), envSource, redact: false }));
    expect(raw.evidence.stderrTail).toContain('AKIAIOSFODNN7EXAMPLE');
    expect(raw.evidence.stderrTail).toContain('sk_live_51HxYz');
    expect(raw.evidence.redactions).toEqual([]);
    const scrubbed = await runCheck(base({ runId: 'scrub', node, argv0: pinFile(p), envSource }));
    expect(scrubbed.evidence.stderrTail).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(scrubbed.evidence.stderrTail).not.toContain('supersecretvalue1');
    expect(scrubbed.evidence.stderrTail).toContain('[REDACTED:env:STRIPE_KEY]');
  }, 30_000);

  it('Aegis M1: a kernel listener port is denied on every address (127.0.0.1, 0.0.0.0, ::ffff:127.0.0.1, the LAN IP); L2: DNS works without system-socket', async () => {
    const lan = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address ?? null;
    const addrs = ['127.0.0.1', '0.0.0.0', '::ffff:127.0.0.1', ...(lan ? [lan] : [])];
    const p = script('net-many.mjs', "import net from 'node:net'; import dns from 'node:dns'; const [port, ...addrs] = process.argv.slice(2); const one = (a) => new Promise((res) => { const s = net.connect({ port: Number(port), host: a }); const t = setTimeout(() => { s.destroy(); res('timeout'); }, 3000); s.on('connect', () => { clearTimeout(t); s.destroy(); res('connected'); }); s.on('error', (e) => { clearTimeout(t); res(e.code); }); }); const out = {}; for (const a of addrs) out[a] = await one(a); out.dns = await new Promise((res) => dns.lookup('localhost', (e) => res(e ? e.code : 'ok'))); out.dnsReal = await new Promise((res) => dns.lookup('example.com', (e) => res(e ? e.code : 'ok'))); process.stdout.write(JSON.stringify(out));");
    const node = { id: 'm', run: ['./net-many.mjs', String(port), ...addrs], pass: { exit: 0 as const }, timeoutSec: 60 };
    const before = hits;
    const denied = await runCheck(base({ runId: 'netm', node, argv0: pinFile(p), network: true, denyLoopbackPorts: [port] }));
    const out = JSON.parse(denied.evidence.stdoutTail);
    for (const a of addrs) expect(out[a], a).toBe('EPERM');
    expect(out.dns).toBe('ok');
    // a real name too, when this machine can resolve one at all (CI may have no DNS)
    const realDns = spawnSync(process.execPath, ['-e', "require('dns').lookup('example.com', (e) => process.exit(e ? 1 : 0))"], { timeout: 10_000 }).status === 0;
    if (realDns) expect(out.dnsReal).toBe('ok');
    expect(hits).toBe(before);
    // the control: the same probe with no deny reaches the server on 127.0.0.1 (the rule, not the address, refused it)
    const open = await runCheck(base({ runId: 'netn', node, argv0: pinFile(p), network: true }));
    expect(JSON.parse(open.evidence.stdoutTail)['127.0.0.1']).toBe('connected');
  }, 90_000);

  it('network: off denies a loopback connect; on reaches the loopback test server; the kernel\'s own port stays denied', async () => {
    const p = script('net.mjs', "import net from 'node:net'; const [port] = process.argv.slice(2); const s = net.connect(Number(port), '127.0.0.1'); s.on('connect', () => { process.stdout.write('connected'); s.destroy(); }); s.on('error', (e) => process.stdout.write(e.code));");
    const node = { id: 'n', run: ['./net.mjs', String(port)], pass: { exit: 0 as const }, timeoutSec: 30 };
    const before = hits;
    const off = await runCheck(base({ runId: 'netoff', node, argv0: pinFile(p) }));
    expect(off.evidence.stdoutTail).toBe('EPERM');
    const on = await runCheck(base({ runId: 'neton', node, argv0: pinFile(p), network: true }));
    expect(on.evidence.stdoutTail, JSON.stringify(on)).toBe('connected');
    expect(hits).toBe(before + 1);
    const kernel = await runCheck(base({ runId: 'netk', node, argv0: pinFile(p), network: true, denyLoopbackPorts: [port] }));
    expect(kernel.evidence.stdoutTail).toBe('EPERM');
    expect(hits).toBe(before + 1);
  }, 60_000);
});
