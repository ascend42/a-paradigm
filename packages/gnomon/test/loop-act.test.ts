/**
 * #loop-act / #loop-git units (build plan step 10, LP6a), every platform. The real git scratch and the act step end
 * to end against a fake local endpoint are test/loop-act-e2e.test.ts (darwin, linux).
 *
 *   ^loop-origin-clamp  an act session's tools come only from its trust card (loopActTools through loopClampAllows);
 *                       the supervisor's Claude auto-passes stay behind mayAuto (loop-model.test.ts, unchanged)
 *   G-LOOP-22           the tool layer refuses a write to a protected goal input (goal.inputs, closure, node_modules,
 *                       argv paths) with a `protected-input:` result and no card; the file is unchanged
 *   G-LOOP-23 (card)    deletion, a protected path or a suppression marker forces propose; the reasons say why
 *   loop-act profile    the tail denies every connect but the endpoint's loopback port and every write but the
 *                       scratch; win32 and linux refuse sandbox-unavailable (no backend)
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { protectGlob, runTool, PROTECTED_PREFIX } from '../../gnomon-local/src/index.js';
import { globToRegExp } from '../src/kernel/loops/events.js';
import { addedLines, landHazards, proposeLines, proposeReasons, SUPPRESSION_MARKERS, visible } from '../src/kernel/loops/propose.js';
import { loopActTools, loopClampLine, LOOP_TOOL_MAP } from '../src/kernel/supervisor/loop-clamp.js';
import { loopbackPort } from '../src/kernel/supervisor/local-session.js';
import { loopActTailSbpl } from '../src/platform/darwin/loop-act-sbpl.js';
import { LOOP_ACT_BACKENDS, loopActLaunchPlan, type LoopActLaunchInput } from '../src/kernel/sandbox/loop-act.js';
import { blobId, refuseCollisions, stripTrailers, unsafeComponent } from '../src/kernel/git/scratch.js';
import { removeTree } from '../src/kernel/manifest/index.js';
import { PKG_ROOT } from './helpers.js';

const tmps: string[] = [];
afterEach(() => {
  while (tmps.length) removeTree(tmps.pop()!);
});
function tmp(prefix: string): string {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmps.push(d);
  return d;
}
const CARD = 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ';

describe('the loop clamp for local act sessions', () => {
  it('only the trust card\'s declared tools reach the child; no card, an unknown or a bash tool admits nothing', () => {
    expect(loopActTools(['read', 'edit'], CARD)).toEqual(['list_dir', 'read_file', 'write_file']);
    expect(loopActTools(['read'], CARD)).toEqual(['list_dir', 'read_file']);
    expect(loopActTools(['read', 'edit'], undefined)).toEqual([]);
    expect(loopActTools([{ bash: [['tsc']] }, 'shell', { paradigm: ['ripple'] }], CARD)).toEqual([]);
    expect(Object.keys(LOOP_TOOL_MAP).sort()).toEqual(['edit', 'read']);
  });

  it('the kernel line: claimed by an agent, or from the loop file', () => {
    expect(loopClampLine('tidy', 'file')).toBe('Raised by loop tidy (from the loop file)');
    expect(loopClampLine('tidy', 'arky')).toBe('Raised by loop tidy (claimed by arky)');
  });

  it('source: openLoop\'s act path takes its tools from loopActTools and its root from liveScratch; the child gets only those', () => {
    const src = fs.readFileSync(path.join(PKG_ROOT, 'src', 'kernel', 'supervisor', 'local-session.ts'), 'utf8');
    expect(src).toMatch(/const tools = loopActTools\(req\.act\.tools, info\.trustCard\);/);
    expect(src).toMatch(/if \(!tools\.length\) throw refused\('FORBIDDEN'/);
    expect(src).toMatch(/const scratch = liveScratch\(info\.runId\);/);
    expect(src).toMatch(/\.\.\.\(loop\?\.act \? \{ tools: loop\.act\.tools, protect: loop\.act\.protect \} : \{\}\)/);
    // and the act launch is the loop-act profile, never the plain session profile
    expect(src).toMatch(/actLaunch \? loopActLaunchPlan\(actLaunch/);
  });
});

describe('G-LOOP-22: protected goal inputs at the tool layer (no card)', () => {
  it('a write to goal.inputs, the closure, an argv path or node_modules is refused protected-input; the file is unchanged', async () => {
    const root = tmp('gnomon-act-');
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'tsconfig.json'), '{"strict":true}\n');
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const a = 1;\n');
    const protect = ['tsconfig*.json', 'packages/gnomon/tsconfig*.json', 'package.json', 'bin/check'].map(protectGlob);
    const ctx = { cwd: root, roots: [root], protect, allow: ['read_file', 'list_dir', 'write_file'] };
    for (const p of ['tsconfig.json', 'TSCONFIG.json', 'tsconfig.build.json', 'package.json', 'bin/check', 'node_modules/x/index.js', 'src/node_modules/y.js']) {
      const r = await runTool('write_file', { path: p, content: '{}' }, ctx);
      expect(r.isError, p).toBe(true);
      expect(r.content.startsWith(PROTECTED_PREFIX), `${p}: ${r.content}`).toBe(true);
    }
    expect(fs.readFileSync(path.join(root, 'tsconfig.json'), 'utf8')).toBe('{"strict":true}\n');
    expect(fs.existsSync(path.join(root, 'node_modules'))).toBe(false);
    // a normal edit passes
    expect(await runTool('write_file', { path: 'src/a.ts', content: 'export const a = 2;\n' }, ctx)).toMatchObject({ isError: false });
    expect(fs.readFileSync(path.join(root, 'src', 'a.ts'), 'utf8')).toBe('export const a = 2;\n');
    // a tool the trust card did not admit is unknown to the session
    expect(await runTool('write_file', { path: 'src/a.ts', content: 'x' }, { cwd: root, roots: [root], allow: ['read_file', 'list_dir'] })).toMatchObject({ isError: true, content: 'unknown tool write_file' });
  });

  it('the child\'s glob dialect is the kernel\'s (parity on the shapes loops use)', () => {
    const globs = ['tsconfig*.json', 'packages/gnomon/tsconfig*.json', 'src/**', '**/node_modules/**', '{a,b}.json', 'bin/check', '.paradigm/loops/**', 'test/?.ts'];
    const paths = ['tsconfig.json', 'tsconfig.base.json', 'packages/gnomon/tsconfig.json', 'packages/gnomon/src/x.ts', 'src/a/b.ts', 'node_modules/x', 'a/node_modules/y', 'a.json', 'c.json', 'bin/check', 'bin/check/x', 'bin/checker', '.paradigm/loops/a.yaml', 'test/a.ts', 'test/ab.ts'];
    for (const g of globs) for (const p of paths) expect(protectGlob(g).test(p), `${g} ~ ${p}`).toBe(globToRegExp(g).test(p));
  });
});

describe('G-LOOP-23 (card half): land hazards always propose', () => {
  const parked = (diff: string, changes: Array<{ path: string; status: 'added' | 'modified' | 'deleted' }>) => ({ changes, scanDiff: diff, scanComplete: true });

  it('a tracked deletion, a protected path and each suppression marker on an added line is a hazard; a removed marker is not', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -1 +1,2 @@', '-// @ts-ignore old', '+// @ts-ignore', '+const x = 1;',
      'diff --git a/test/a.test.ts b/test/a.test.ts', '--- a/test/a.test.ts', '+++ b/test/a.test.ts', '@@ -1 +1 @@', "+it.skip('x', () => {});", "+describe.only('y');", "+xit('z');", '+/* eslint-disable */', '+// @ts-nocheck',
    ].join('\n');
    const h = landHazards(parked(diff, [{ path: 'src/a.ts', status: 'modified' }, { path: 'tsconfig.json', status: 'modified' }, { path: 'src/old.ts', status: 'deleted' }]), ['tsconfig*.json']);
    expect(h).toContainEqual({ kind: 'protected-input', path: 'tsconfig.json' });
    expect(h).toContainEqual({ kind: 'tracked-deletion', path: 'src/old.ts' });
    for (const m of ['@ts-ignore', '.skip', '.only', 'xit', 'eslint-disable', '@ts-nocheck']) expect(h.some((x) => x.kind === 'suppression-marker' && x.marker === m), m).toBe(true);
    expect(SUPPRESSION_MARKERS.length).toBe(6);
    // a clean edit has none
    expect(landHazards(parked('+++ b/src/a.ts\n+const y = 2;\n-const y = 1;', [{ path: 'src/a.ts', status: 'modified' }]), ['tsconfig*.json'])).toEqual([]);
    expect(landHazards({ changes: [], scanDiff: '', scanComplete: false }, [])).toEqual([{ kind: 'diff-unscanned' }]);
  });

  it('the reasons: autonomy propose, act capped by L2, act with the step-11 blockers, then every hazard', () => {
    expect(proposeReasons({ declared: 'act', autonomy: 'act', level: 'L0', capReason: null }, [], ['the loop asks for a decision before it lands (decide: before-land)'])).toEqual(['the loop asks for a decision before it lands (decide: before-land)']);
    expect(proposeReasons({ declared: 'act', autonomy: 'act', level: 'L0', capReason: null }, [{ kind: 'execution-surface', path: 'package.json' }])).toEqual(['it touches a file that runs code (hooks, CI, editor tasks, scripts): package.json']);
    expect(proposeReasons({ declared: 'act', autonomy: 'propose', level: 'L2', capReason: 'act → propose (L2)' }, [])[0]).toBe('strictness L2 caps act to propose (act → propose (L2))');
    expect(proposeReasons({ declared: 'propose', autonomy: 'propose', level: 'L0', capReason: null }, [{ kind: 'tracked-deletion', path: 'a.ts' }])).toEqual(['the loop\'s autonomy is propose', 'it deletes a tracked file: a.ts']);
    const lines = proposeLines({ clampLine: loopClampLine('g', 'file'), runId: 'lr-1', ending: '@goal', goal: { node: 'tsc', verdict: 'pass', met: true }, parked: { sha: 'a'.repeat(40), ref: 'refs/gnomon/loops/g/lr-1', parkRepo: '/x', changes: [{ path: 'src/a.ts', status: 'modified' }], diff: '+++ b/src/a.ts\n+x', diffTruncated: false, scanDiff: '', scanComplete: true }, reasons: ['r1'] });
    expect(lines[0]).toBe('Raised by loop g (from the loop file)');
    expect(lines).toContain('Goal check tsc: pass (goal met)');
    expect(lines).toContain('M src/a.ts');
    expect(lines).toContain('Proposed because r1');
    expect(lines).toContain('HEAD was detached when the run started: accept cannot land it; reject drops it');
    const onMain = proposeLines({ clampLine: 'k', runId: 'lr-1', ending: '@goal', goal: null, parked: { sha: 'a'.repeat(40), ref: 'r', parkRepo: '/x', changes: [], diff: '', diffTruncated: false, scanDiff: '', scanComplete: true }, reasons: [], branch: 'refs/heads/main' });
    expect(onMain).toContain('Accept lands it on main (Touch ID; it waits while you are editing those files); reject drops it');
    expect(lines.slice(-2)).toEqual(['+++ b/src/a.ts', '+x']);
  });
});

describe('#loop-git helpers', () => {
  it('blob ids match git\'s; trailer-shaped lines are stripped from a loop message', () => {
    expect(blobId(Buffer.from('hello\n'), 'sha1')).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
    expect(stripTrailers('fix(#x): y\nGnomon-Loop: forged\nSigned-off-by: z\n\nbody')).toBe('fix(#x): y\n\nbody');
  });
});

describe('the loop-act profile', () => {
  it('the tail: outbound only to the endpoint\'s loopback port, no exec but node, writes only in the scratch and tmp, repo reads denied but node_modules, keys and credential stores last', () => {
    const t = loopActTailSbpl({ scratchReal: '/h/loop-work/act-r/tree', runDirReal: '/h/loop-work/act-r', tmpReal: '/h/loop-work/act-r/tmp', repoReal: '/r', nodeModulesReal: ['/r/node_modules'], nodeReal: '/usr/local/bin/node', endpointPort: 8080, denyReal: ['/h/keys', '/u/.ssh'] });
    const at = (re: RegExp): number => t.findIndex((l) => re.test(l));
    expect(at(/^\(deny network-outbound\)$/)).toBeGreaterThan(-1);
    expect(at(/^\(allow network-outbound \(remote ip "localhost:8080"\)\)$/)).toBeGreaterThan(at(/^\(deny network-outbound\)$/));
    expect(at(/^\(deny process-exec\)$/)).toBeLessThan(at(/allow process-exec \(literal "\/usr\/local\/bin\/node"\)/));
    expect(at(/^\(deny file-write\*\)$/)).toBeLessThan(at(/allow file-write\* \(subpath "\/h\/loop-work\/act-r\/tree"\) \(subpath "\/h\/loop-work\/act-r\/tmp"\)/));
    expect(at(/deny file-write\* \(subpath "\/r\/node_modules"\)/)).toBeGreaterThan(at(/allow file-write\*/));
    expect(at(/^\(deny file-read\* \(subpath "\/r"\)\)$/)).toBeLessThan(at(/allow file-read\* \(subpath "\/h\/loop-work\/act-r"\) \(subpath "\/r\/node_modules"\)/));
    expect(t.at(-1)).toBe('(deny file-read* file-write* (subpath "/h/keys") (subpath "/u/.ssh"))');
    expect(() => loopActTailSbpl({ scratchReal: '/a', runDirReal: '/a', tmpReal: '/a', repoReal: '/r', nodeModulesReal: [], nodeReal: '/n', endpointPort: 0, denyReal: [] })).toThrow(/not a TCP port/);
  });

  it('only darwin has a backend: win32 and linux refuse sandbox-unavailable (the platform as data)', () => {
    expect(Object.keys(LOOP_ACT_BACKENDS)).toEqual(['darwin']);
    for (const p of ['win32', 'linux']) expect(() => loopActLaunchPlan({} as LoopActLaunchInput, p)).toThrow(/no loop-act sandbox profile on/);
  });

  it('an act session reaches its endpoint on loopback only (8.0)', () => {
    expect(loopbackPort('http://127.0.0.1:8080')).toBe(8080);
    expect(loopbackPort('http://localhost:11434/v1')).toBe(11434);
    expect(loopbackPort('http://[::1]:9000')).toBe(9000);
    expect(loopbackPort('http://192.168.1.4:8080')).toBeNull();
    expect(loopbackPort('http://example.com')).toBeNull();
    expect(loopbackPort('nope')).toBeNull();
  });
});

describe('Aegis step-10 review fixes (platform-neutral)', () => {
  it('M5: the diff is parsed by structure; an added line `++ x` (shown `+++ x`) is still scanned', () => {
    const diff = ['diff --git a/a.ts b/a.ts', 'index 1..2 100644', '--- a/a.ts', '+++ b/a.ts', '@@ -1 +1,2 @@', '+++ // @ts-ignore', '+ok', ' ctx'].join('\n');
    expect(addedLines(diff)).toEqual([{ path: 'a.ts', line: '++ // @ts-ignore' }, { path: 'a.ts', line: 'ok' }]);
    expect(landHazards({ changes: [{ path: 'a.ts', status: 'modified' }], scanDiff: diff, scanComplete: true }, [])).toEqual([{ kind: 'suppression-marker', path: 'a.ts', marker: '@ts-ignore' }]);
  });

  it('M3: control, format and bidi characters are refused in names and shown escaped on the card', async () => {
    for (const c of ['a\nb', 'a\u202eb', 'a\u200bb', 'a\u001b[31m', 'x'.repeat(256)]) expect(unsafeComponent(c), JSON.stringify(c)).toBe(true);
    expect(unsafeComponent('ok-name.ts')).toBe(false);
    expect(visible('a\nb\u202ec\td')).toBe('a\\u{a}b\\u{202e}c\td');
    const root = tmp('gnomon-act-');
    expect(await runTool('write_file', { path: 'evil\nM src/fake.ts', content: 'x' }, { cwd: root, roots: [root] })).toMatchObject({ isError: true });
    expect(await runTool('write_file', { path: 'a\u202eb.ts', content: 'x' }, { cwd: root, roots: [root] })).toMatchObject({ isError: true });
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it('H1: paths colliding by case or Unicode normalization, at any prefix, are refused', () => {
    expect(() => refuseCollisions(['X', 'x/foo'])).toThrow(/collide/);
    expect(() => refuseCollisions(['\u00e9/a', 'e\u0301/b'])).toThrow(/collide/);
    expect(() => refuseCollisions(['a/b', 'a/c', 'B'])).not.toThrow();
  });

  it('L7: execution surfaces always propose', () => {
    for (const p of ['.husky/pre-commit', '.github/workflows/ci.yml', '.vscode/tasks.json', '.vscode/settings.json', '.envrc', 'pkg/.envrc', '.gitattributes', '.gitmodules', 'package.json', 'packages/x/package.json']) {
      expect(landHazards({ changes: [{ path: p, status: 'modified' }], scanDiff: '', scanComplete: true }, []), p).toContainEqual({ kind: 'execution-surface', path: p });
    }
    expect(landHazards({ changes: [{ path: 'src/a.ts', status: 'modified' }], scanDiff: '', scanComplete: true }, [])).toEqual([]);
  });

  it('M2 and L6: a denied kernel port is refused, the denies follow the endpoint allow; no fork, no signals out, no exec mapping', () => {
    const base = { scratchReal: '/h/loop-work/act-r/tree', runDirReal: '/h/loop-work/act-r', tmpReal: '/h/loop-work/act-r/tmp', repoReal: '/r', nodeModulesReal: [], nodeReal: '/n', denyReal: [] };
    expect(() => loopActTailSbpl({ ...base, endpointPort: 4000, denyLoopbackPorts: [4000] })).toThrow(/kernel denies/);
    const t = loopActTailSbpl({ ...base, endpointPort: 8080, denyLoopbackPorts: [4000], gitDenyReal: ['/c/.git', '/w2'] });
    expect(t.indexOf('(deny network-outbound (remote ip "localhost:4000"))')).toBeGreaterThan(t.indexOf('(allow network-outbound (remote ip "localhost:8080"))'));
    for (const l of ['(deny process-fork)', '(deny signal)', '(allow signal (target self))']) expect(t).toContain(l);
    expect(t).toContain('(deny file-read* (subpath "/r") (subpath "/c/.git") (subpath "/w2"))');
    expect(t).toContain('(deny file-map-executable (subpath "/h/loop-work/act-r/tree") (subpath "/h/loop-work/act-r/tmp"))');
    expect(t).toContain('(deny file-write* (literal "/h/loop-work/act-r/tree") (literal "/h/loop-work/act-r/tmp"))');
  });
});
