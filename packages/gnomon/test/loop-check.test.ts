/**
 * #loop-check, platform-neutral half (docs/specs/gnomon-loops.md §2 `pass`, §4 "Sandboxes" and "Evidence";
 * build plan step 4): the pass-rule parsers (tap, junit, tsc, json with every op), the evidence secret scanner,
 * the check env (G-SEC-02: NODE_OPTIONS, GNOMON_* and secrets never reach a check child), the profile registry
 * (win32 and linux refuse `sandbox-unavailable`; no network rule in the darwin SBPL), the repo copy (git ls-files,
 * caps, the ignored worktrees dir, cleanup) and the kept-on-error retention. The enforcement half, under
 * sandbox-exec, is test/loop-check-sandbox.test.ts (darwin).
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { applyPassRule, compareJson, jsonPathGet, parseJunit, parseTap, parseTsc } from '../src/kernel/loops/check-parse.js';
import { scanSecrets } from '../src/kernel/loops/secret-scan.js';
import { buildCheckEnv } from '../src/kernel/runner/env.js';
import { LOOP_CHECK_BACKENDS, loopCheckLaunchPlan } from '../src/kernel/sandbox/loop-check.js';
import { loopCheckProfileSbpl, LoopCheckSbplError } from '../src/platform/darwin/loop-check-sbpl.js';
import { CheckCopyRefusal, checkRunDir, makeCheckCopy, pinParadigmCli, runCheck, sweepCheckCopies } from '../src/kernel/loops/check-exec.js';
import { resolveShebangInterpreter, shebangProgram } from '../src/kernel/loops/shebang.js';
import { LifecycleRefusal } from '../src/kernel/lifecycle/refusal.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});
const tmp = (): string => {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gnomon-lc-')));
  dirs.push(d);
  return d;
};
const gitEnv = { PATH: process.env.PATH ?? '', HOME: os.tmpdir(), GIT_CONFIG_NOSYSTEM: '1' } as Record<string, string>;
function repo(files: Record<string, string>): string {
  const r = tmp();
  expect(spawnSync('git', ['init', '-q'], { cwd: r, env: gitEnv }).status).toBe(0);
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(r, rel)), { recursive: true });
    fs.writeFileSync(path.join(r, rel), body);
  }
  return r;
}

describe('pass-rule parsers', () => {
  it('TAP: ok / not ok at the top level, SKIP and TODO never fail, subtests not double counted', () => {
    expect(parseTap('TAP version 13\n1..3\nok 1 a\nnot ok 2 b\nok 3 c # SKIP x\n')).toEqual({ passed: 2, failed: 1, total: 3 });
    expect(parseTap('TAP version 14\n    ok 1 sub\n    not ok 2 sub\nnot ok 1 parent\nok 2 other\n')).toEqual({ passed: 1, failed: 1, total: 2 });
    expect(parseTap('not ok 1 later # TODO not yet\n')).toEqual({ passed: 1, failed: 0, total: 1 });
    expect(parseTap('1..0 # no tests\n')).toEqual({ passed: 0, failed: 0, total: 0 });
    expect(parseTap('Bail out! db down\n')).toMatchObject({ failed: 1 });
    expect(parseTap('hello world\n')).toBeNull();
  });
  it('JUnit: the testsuites totals, else summed testsuite totals, else counted testcases', () => {
    expect(parseJunit('<?xml version="1.0"?><testsuites tests="5" failures="1" errors="1"><testsuite tests="5"/></testsuites>')).toEqual({ failed: 2, total: 5, passed: 3 });
    expect(parseJunit('<testsuite name="a" tests="2" failures="0"></testsuite><testsuite name="b" tests="3" failures="2"></testsuite>')).toEqual({ failed: 2, total: 5, passed: 3 });
    expect(parseJunit('<testcase name="a"/><testcase name="b"><failure>x</failure></testcase>')).toEqual({ failed: 1, total: 2, passed: 1 });
    expect(parseJunit('no xml')).toBeNull();
  });
  it('tsc: one failure per error TSnnnn, Found N errors as the summary; a silent non-zero exit is unparseable', () => {
    expect(parseTsc("src/a.ts(1,7): error TS2322: Type 'string' is not assignable.\nsrc/b.ts(2,1): error TS2304: Cannot find name 'x'.\n", 2)).toEqual({ failed: 2 });
    expect(parseTsc('\u001b[91merror\u001b[0m TS2322 ...\nFound 3 errors in 2 files.\n', 2)).toEqual({ failed: 3 });
    expect(parseTsc('', 0)).toEqual({ failed: 0 });
    expect(parseTsc('Segmentation fault\n', 139)).toBeNull();
  });
  it('JSONPath subset and every op (==, !=, <, <=, >, >=); ordering needs matching types', () => {
    const doc = { summary: { failed: 2, name: 'b' }, list: [{ v: true }] };
    expect(jsonPathGet(doc, '$.summary.failed')).toBe(2);
    expect(jsonPathGet(doc, '$.list[0].v')).toBe(true);
    expect(jsonPathGet(doc, '$.list[3]')).toBeUndefined();
    expect(jsonPathGet(doc, '$.nope')).toBeUndefined();
    expect(jsonPathGet(doc, '$')).toEqual(doc);
    expect([compareJson(2, '==', 2), compareJson(2, '!=', 2), compareJson(1, '<', 2), compareJson(2, '<=', 2), compareJson(3, '>', 2), compareJson(2, '>=', 3)]).toEqual([true, false, true, true, true, false]);
    expect(compareJson('a', '<', 'b')).toBe(true);
    expect(compareJson('1', '<', 2)).toBeNull();
    expect(compareJson(null, '==', null)).toBe(true);
  });
  it('applyPassRule: exit, parse (failed is the allowed maximum) and json give pass or fail; unparseable is error', () => {
    expect(applyPassRule({ exit: 0 }, { exitCode: 0, stdout: '' }).verdict).toBe('pass');
    expect(applyPassRule({ exit: 0 }, { exitCode: 1, stdout: '' }).verdict).toBe('fail');
    expect(applyPassRule({ parse: 'tap', failed: 0 }, { exitCode: 1, stdout: 'ok 1\nnot ok 2\n' })).toMatchObject({ verdict: 'fail', counts: { failed: 1 } });
    expect(applyPassRule({ parse: 'tap', failed: 1 }, { exitCode: 1, stdout: 'ok 1\nnot ok 2\n' }).verdict).toBe('pass');
    expect(applyPassRule({ parse: 'junit', failed: 0 }, { exitCode: 0, stdout: 'garbage' })).toMatchObject({ verdict: 'error', reason: 'unparseable' });
    expect(applyPassRule({ json: '$.failed', op: '==', value: 0 }, { exitCode: 1, stdout: '{"failed":0,"passed":4}' })).toMatchObject({ verdict: 'pass', value: 0, counts: { failed: 0, passed: 4 } });
    expect(applyPassRule({ json: '$.failed', op: '<', value: 1 }, { exitCode: 0, stdout: '{"failed":3}' }).verdict).toBe('fail');
    expect(applyPassRule({ json: '$.failed', op: '==', value: 0 }, { exitCode: 0, stdout: 'not json' })).toMatchObject({ verdict: 'error', reason: 'unparseable' });
    expect(applyPassRule({ json: '$.missing', op: '==', value: 0 }, { exitCode: 0, stdout: '{}' })).toMatchObject({ verdict: 'error' });
    expect(applyPassRule({ json: '$.name', op: '>', value: 1 }, { exitCode: 0, stdout: '{"name":"x"}' })).toMatchObject({ verdict: 'error' });
  });
});

describe('the evidence secret scanner (G-LOOP-27 evidence half)', () => {
  it('redacts AWS keys, GitHub tokens, private key blocks and generic api_key= assignments, reporting kinds only', () => {
    const pem = ['-----BEGIN RSA PRIVATE KEY-----', 'MIIEowIBAAKCAQEAx', 'abc', '-----END RSA PRIVATE KEY-----'].join('\n');
    const gh = `ghp_${'a1B2'.repeat(9)}`;
    const text = [`key AKIAIOSFODNN7EXAMPLE here`, `aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY`, `token ${gh}`, pem, 'api_key=sk_live_abcdef123456', 'Authorization: Bearer abc.def.ghi123', 'all 3 tests passed'].join('\n');
    const r = scanSecrets(text);
    for (const secret of ['AKIAIOSFODNN7EXAMPLE', 'wJalrXUtnFEMI', gh, 'MIIEowIBAAKCAQEAx', 'sk_live_abcdef123456', 'abc.def.ghi123']) expect(r.text).not.toContain(secret);
    expect(r.text).toContain('all 3 tests passed');
    expect(r.text).toContain('aws_secret_access_key = [REDACTED:aws-secret]');
    expect(r.text).toContain('api_key=[REDACTED:stripe-key]');
    const kinds = Object.fromEntries(r.redactions.map((x) => [x.kind, x.count]));
    expect(kinds).toMatchObject({ 'private-key': 1, 'aws-access-key': 1, 'aws-secret': 1, 'github-token': 1, 'stripe-key': 1, bearer: 1 });
    expect(JSON.stringify(r.redactions)).not.toContain('AKIA');
  });
  it('JWTs, npm_ tokens, sk_live_/sk_test_, glpat- and passwords in URLs are redacted', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
    const npm = `npm_${'a1'.repeat(18)}`;
    // Stripe's public docs example key, assembled at runtime so secret scanners don't flag the fixture
    const stripeTest = ['sk', 'test', '4eC39HqLyjWDarjtT1zdp7dc'].join('_');
    const t = [jwt, npm, stripeTest, 'glpat-xxxxxxxxxxxxxxxxxxxx', 'postgres://admin:hunter2pass@db.local:5432/x', 'https://example.com/a/b'].join('\n');
    const r = scanSecrets(t);
    for (const secret of [jwt, npm, stripeTest, 'glpat-xxxxxxxxxxxxxxxxxxxx', 'hunter2pass']) expect(r.text).not.toContain(secret);
    expect(r.text).toContain('postgres://admin:[REDACTED:url-password]@db.local:5432/x');
    expect(r.text).toContain('https://example.com/a/b');
    expect(r.redactions.map((x) => x.kind).sort()).toEqual(['gitlab-token', 'jwt', 'npm-token', 'stripe-key', 'url-password']);
  });
  it('a private key block cut by the tail window (no BEGIN, or no END) is still redacted', () => {
    expect(scanSecrets('Zm9vYmFy\nbase64tail\n-----END OPENSSH PRIVATE KEY-----\nafter').text).toBe('[REDACTED:private-key]\nafter');
    expect(scanSecrets('before\n-----BEGIN PRIVATE KEY-----\nMIIE...').text).toBe('before\n[REDACTED:private-key]');
  });
  it('leaves ordinary test output alone', () => {
    const t = 'ok 1 adds numbers\nTests: 12 passed, 0 failed\nDuration 1.2s\n';
    expect(scanSecrets(t)).toEqual({ text: t, redactions: [] });
  });
});

describe('the one shebang parser (shared with the registry hash)', () => {
  it('env skips flags and NAME=value assignments; a direct interpreter is its first word', () => {
    expect(shebangProgram('/usr/bin/env node')).toMatchObject({ program: 'node', viaEnv: true });
    expect(shebangProgram('/usr/bin/env -S FOO=1 node --no-warnings')).toMatchObject({ program: 'node', viaEnv: true });
    expect(shebangProgram('/bin/sh -e')).toMatchObject({ program: '/bin/sh', viaEnv: false });
    expect(shebangProgram('/usr/bin/env')).toMatchObject({ program: '', viaEnv: true });
  });
  it('env node resolves to the kernel node; an unknown program is unresolved', () => {
    const k = resolveShebangInterpreter('/usr/bin/env node', { execPath: process.execPath, pathDirs: [] });
    expect(k).toMatchObject({ via: 'kernel-node', real: fs.realpathSync.native(process.execPath) });
    expect(resolveShebangInterpreter('/usr/bin/env no-such-prog-xyz', { pathDirs: [os.tmpdir()] })).toMatchObject({ via: 'unresolved', real: null });
    expect(resolveShebangInterpreter('relative/interp', { pathDirs: [] })).toMatchObject({ via: 'unresolved' });
  });
});

describe('G-SEC-02: the check env (runner/env.ts buildCheckEnv)', () => {
  it('allowlist and scrub: NODE_OPTIONS, GNOMON_*, ANTHROPIC_* and secrets never reach the child; HOME and TMPDIR are the check’s own', () => {
    const from = { PATH: '/evil/bin', HOME: '/Users/me', USER: 'me', LANG: 'en_US.UTF-8', NODE_OPTIONS: '--require /tmp/x.js', GNOMON_SOCK: '/s', GNOMON_HOME: '/h', ANTHROPIC_API_KEY: 'sk-ant-x', AWS_SECRET_ACCESS_KEY: 'k', GITHUB_TOKEN: 't', NPM_TOKEN: 'n', OPENAI_BASE_URL: 'u' };
    const { env, envKeys } = buildCheckEnv({ from, identity: { user: 'me' }, path: '/kernel/node/bin:/usr/bin:/bin', home: '/c/home', tmpdir: '/c/tmp', inject: { NO_COLOR: '1', NODE_OPTIONS: '--inspect', GNOMON_HSID: 'x' } });
    for (const k of ['NODE_OPTIONS', 'GNOMON_SOCK', 'GNOMON_HOME', 'GNOMON_HSID', 'GNOMON_SESSION_KEY', 'ANTHROPIC_API_KEY', 'AWS_SECRET_ACCESS_KEY', 'GITHUB_TOKEN', 'NPM_TOKEN', 'OPENAI_BASE_URL']) expect(env[k], k).toBeUndefined();
    expect(env).toMatchObject({ HOME: '/c/home', TMPDIR: '/c/tmp', PATH: '/kernel/node/bin:/usr/bin:/bin', USER: 'me', LOGNAME: 'me', LANG: 'en_US.UTF-8', NO_COLOR: '1' });
    expect(envKeys).toEqual(Object.keys(env).sort());
  });
});

describe('the loop-check profile registry', () => {
  const input = { home: '/h', copyDir: '/c', nodeModules: [], argv: ['/bin/x'], env: {} };
  it('win32 (W5 fills it) and linux have no backend and refuse sandbox-unavailable; darwin is registered', () => {
    expect(Object.keys(LOOP_CHECK_BACKENDS)).toEqual(['darwin']);
    for (const p of ['win32', 'linux']) {
      expect(() => loopCheckLaunchPlan(input, p)).toThrow(LifecycleRefusal);
      try {
        loopCheckLaunchPlan(input, p);
      } catch (e) {
        expect((e as LifecycleRefusal).reason).toBe('sandbox-unavailable');
      }
    }
  });
  it('darwin below the floor (macOS < 15 or SIP off) refuses, never a weaker profile', () => {
    expect(() => loopCheckLaunchPlan(input, 'darwin', () => 14, () => true)).toThrow(/macOS 15/);
    expect(() => loopCheckLaunchPlan(input, 'darwin', () => 15, () => false)).toThrow(/System Integrity Protection/);
  });
  it('the SBPL is default-deny with no network rule, exec literals only, node_modules write-denied and credential stores denied last', () => {
    const sbpl = loopCheckProfileSbpl({ nodeReal: '/opt/n/bin/node', copyReal: '/Users/u/.gnomon/loop-work/check-1', nodeModulesReal: ['/r/node_modules'], execReal: ['/r/node_modules/typescript/bin/tsc', '/usr/bin/env'], readReal: [], homeReal: '/Users/u/.gnomon', denyReal: ['/Users/u/.ssh', '/Users/u/.gnomon/keys'] });
    expect(sbpl).toContain('(deny default)');
    expect(sbpl).not.toMatch(/network/);
    expect(sbpl).toContain('(allow process-exec (literal "/opt/n/bin/node") (literal "/r/node_modules/typescript/bin/tsc") (literal "/usr/bin/env"))');
    expect(sbpl).toContain('(allow file-write* (subpath "/Users/u/.gnomon/loop-work/check-1") (literal "/dev/null"))');
    // the Gnomon home is denied as a whole, then only the run dir is re-allowed after it
    const homeDeny = sbpl.indexOf('(deny file-read* file-write* (subpath "/Users/u/.gnomon"))');
    expect(homeDeny).toBeGreaterThan(0);
    expect(sbpl.indexOf('(allow file-read* file-write* (subpath "/Users/u/.gnomon/loop-work/check-1"))')).toBeGreaterThan(homeDeny);
    const lines = sbpl.trim().split('\n');
    expect(lines.at(-2)).toBe('(deny file-write* (subpath "/r/node_modules"))');
    expect(lines.at(-1)).toBe('(deny file-read* file-write* (subpath "/Users/u/.ssh") (subpath "/Users/u/.gnomon/keys"))');
    expect(() => loopCheckProfileSbpl({ nodeReal: '/n', copyReal: '/c"x', nodeModulesReal: [], execReal: [], readReal: [], homeReal: '/h', denyReal: [] })).toThrow(LoopCheckSbplError);
  });
});

describe('the check copy', () => {
  it('copies tracked and untracked-not-ignored files, never ignored ones, node_modules or the Gnomon dir, into the kernel-owned run dir under the Gnomon home', () => {
    const r = repo({ '.gitignore': 'ignored.txt\nnode_modules/\n', 'a.txt': 'A', 'src/b.ts': 'B', 'ignored.txt': 'I', '.gnomon/sessions/x': 'S', '.warpline/keys/k': 'K' });
    const h = tmp();
    const c = makeCheckCopy(r, 'run1', gitEnv, undefined, h);
    expect(c.runDir).toBe(checkRunDir(h, 'run1'));
    expect(fs.readFileSync(path.join(c.tree, 'a.txt'), 'utf8')).toBe('A');
    expect(fs.readFileSync(path.join(c.tree, 'src', 'b.ts'), 'utf8')).toBe('B');
    for (const gone of ['ignored.txt', path.join('.gnomon', 'sessions', 'x'), path.join('.warpline', 'keys', 'k')]) expect(fs.existsSync(path.join(c.tree, gone)), gone).toBe(false);
    expect(c.files).toBe(3);
    // nothing is written inside the repo
    const st = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: r, env: gitEnv, encoding: 'utf8' }).stdout;
    expect(st.split('\n').filter(Boolean).sort()).toEqual(['?? .gitignore', '?? .gnomon/sessions/x', '?? .warpline/keys/k', '?? a.txt', '?? src/b.ts']);
    expect(fs.existsSync(path.join(r, '.gnomon', 'worktrees'))).toBe(false);
    fs.rmSync(c.runDir, { recursive: true, force: true });
  });
  it('refuses past the file and size caps with a clear reason, leaving nothing behind', () => {
    const r = repo({ 'a.txt': 'x'.repeat(2000), 'b.txt': 'y', 'c.txt': 'z' });
    const h3 = tmp();
    expect(() => makeCheckCopy(r, 'r2', gitEnv, { maxFiles: 2, maxBytes: 1e9, maxNodeModules: 10 }, tmp())).toThrow(/3 files, over the 2-file cap/);
    try {
      makeCheckCopy(r, 'r3', gitEnv, { maxFiles: 10, maxBytes: 1000, maxNodeModules: 10 }, h3);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(CheckCopyRefusal);
      expect((e as CheckCopyRefusal).reason).toBe('copy-too-large');
    }
    expect(fs.existsSync(checkRunDir(h3, 'r3'))).toBe(false);
  });
  it('a runId is one path component', () => {
    const r = repo({ 'a.txt': 'A' });
    expect(() => makeCheckCopy(r, '../escape', gitEnv, undefined, tmp())).toThrow(/runId/);
    expect(() => makeCheckCopy(r, 'nohome', gitEnv)).toThrow(/Gnomon home/);
  });
  it('runCheck on a platform with no backend is error sandbox-unavailable; the copy is kept with a retention note, and the sweep removes it past the window', async () => {
    const r = repo({ 'a.txt': 'A' });
    const h = tmp();
    const dist = path.join(tmp(), 'dist');
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, 'index.js'), '');
    fs.writeFileSync(path.join(dist, 'chunk.js'), '');
    const res = await runCheck({ runId: 'w1', repo: r, home: h, node: { id: 'c', builtin: 'git.clean', pass: { exit: 0 }, timeoutSec: 5 }, paradigmCli: pinParadigmCli(path.join(dist, 'index.js')), platform: 'win32', envFrom: gitEnv });
    expect(res).toMatchObject({ verdict: 'error', reason: 'sandbox-unavailable', copy: { kept: true } });
    expect(res.copy.retention).toMatch(/kept for debugging/);
    expect(fs.existsSync(res.copy.dir)).toBe(true);
    expect(path.dirname(res.copy.dir)).toBe(path.join(h, 'loop-work'));
    expect(sweepCheckCopies(h, 60_000)).toEqual([]);
    expect(sweepCheckCopies(h, 60_000, Date.now() + 120_000)).toEqual([res.copy.dir]);
    expect(fs.existsSync(res.copy.dir)).toBe(false);
  });
  it('a pin mismatch is error, never a run: any file of the paradigm CLI dist changing breaks the pin', async () => {
    const r = repo({ 'a.txt': 'A' });
    const h = tmp();
    const dist = path.join(tmp(), 'dist');
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, 'index.js'), '');
    fs.writeFileSync(path.join(dist, 'chunk-1.js'), 'a');
    const pin = pinParadigmCli(path.join(dist, 'index.js'));
    fs.writeFileSync(path.join(dist, 'chunk-1.js'), 'b'); // a chunk, not the entry
    const res = await runCheck({ runId: 'p1', repo: r, home: h, node: { id: 'c', builtin: 'paradigm.drift', pass: { exit: 0 }, timeoutSec: 5 }, paradigmCli: pin, platform: 'win32', envFrom: gitEnv, keepOnError: false });
    expect(res).toMatchObject({ verdict: 'error', reason: 'pin-mismatch', copy: { kept: false } });
    expect(fs.existsSync(checkRunDir(h, 'p1'))).toBe(false);
  });
});
