/**
 * The `session` sandbox profile, generated (spec §15.5, §16; M1.7 slice 1;
 * T-2026-10-18-008, P8-D79/D80): the SBPL TEXT the darwin backend writes from
 * the M1.5 SessionPolicy, every path realpath'd, the T-008 git denies, and the
 * platform registry's refusal where no backend exists (G-WIN-06 status
 * `partial`). Platform-independent: string generation only — the enforcement
 * half is test/session-sandbox.test.ts (darwin).
 */
// @gnomon-platform: darwin, linux
import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sessionProfileSbpl, extraGitDenies, DARWIN_LAUNCHERS, SbplError } from '../src/platform/darwin/session-sbpl.js';
import { sessionLaunchPlan, sessionSandboxFidelity } from '../src/kernel/sandbox/session.js';
import { binaryDenies } from '../src/kernel/supervisor/supervisor.js';
import { PERSISTENCE_PATHS } from '../src/kernel/manifest/policy.js';
import { LifecycleRefusal } from '../src/kernel/lifecycle/refusal.js';
import { sessionWorld, worldPolicy, type SessionWorld } from './session-helpers.js';

let w: SessionWorld;
afterEach(() => w?.cleanup());
const extras = (x: SessionWorld) => ({ uid: 501, tmpdir: x.root, home: x.userHome, roots: [x.cwd] });

describe('G-SBX-08 (text) the generated session profile', () => {
  it('carries every §15.5 session deny', () => {
    w = sessionWorld();
    const sb = sessionProfileSbpl(worldPolicy(w, 4321), extras(w));
    expect(sb).toContain('(allow default)');
    expect(sb).toContain(`(deny file-read* `);
    expect(sb).toContain(`(subpath "${path.join(w.home, 'keys')}")`);
    expect(sb).toContain(`(subpath "${path.join(w.userHome, '.claude')}")`);
    expect(sb).toContain(`(literal "${path.join(w.userHome, '.claude.json')}")`);
    expect(sb).toContain(`(subpath "${path.join(w.cwd, '.claude')}")`);
    expect(sb).toContain(`(prefix "${path.join(w.cwd, 'CLAUDE')}")`);
    expect(sb).toContain(`(subpath "${w.linked}")`);
    expect(sb).toContain(`(literal "${path.join(w.cwd, '.git', 'config')}")`);
    expect(sb).toContain('(deny network-outbound (remote ip "localhost:4321"))');
    expect(sb).toContain('(deny process-info*)');
    expect(sb).toContain('(allow process-info* (target self))');
    expect(sb).toContain('(deny mach-lookup (global-name "com.apple.sysmond"))');
    expect(sb).toContain('(remote unix-socket (subpath "/private/tmp/tmux-501"))');
    expect(sb).toContain(`(remote unix-socket (subpath "${path.join(w.root, '.screen')}"))`);
    expect(sb).toContain('(deny appleevent-send)');
    for (const l of DARWIN_LAUNCHERS.slice(0, 2)) expect(sb).toContain(`(literal "${l}")`);
    expect(sb).toContain('/Support/lsregister")'); // realpath'd (on macOS through the framework's Versions/A links)
  });
  it('Aegis M2: the user persistence paths are write-denied', () => {
    w = sessionWorld();
    const sb = sessionProfileSbpl(worldPolicy(w), extras(w));
    for (const p of PERSISTENCE_PATHS) expect(sb).toContain(`(${p.match} "${path.join(w.userHome, ...p.rel.split('/'))}")`);
  });
  it('Aegis H1: the binary realpath, its versions dir and every known-location link (unresolved) are write-denied', () => {
    w = sessionWorld();
    const versions = path.join(w.userHome, '.local', 'share', 'claude', 'versions');
    fs.mkdirSync(versions, { recursive: true });
    fs.writeFileSync(path.join(versions, '2.1.302'), 'bin');
    fs.mkdirSync(path.join(w.userHome, '.local', 'bin'), { recursive: true });
    fs.symlinkSync(path.join(versions, '2.1.302'), path.join(w.userHome, '.local', 'bin', 'claude'));
    const row = { knownBinaries: ['~/.local/bin/claude', '/opt/homebrew/bin/claude'], managedSettings: [], managedSettingsDirs: [], managedUnscannable: [], userClaudeDir: '.claude' };
    const d = binaryDenies(row, w.userHome, path.join(versions, '2.1.302'));
    const sb = sessionProfileSbpl(worldPolicy(w, null, d), extras(w));
    expect(sb).toContain(`(literal "${path.join(versions, '2.1.302')}")`);
    expect(sb).toContain(`(subpath "${versions}")`);
    expect(sb).toContain(`(literal "${path.join(w.userHome, '.local', 'bin', 'claude')}")`); // the link itself
    expect(sb).toContain('(literal "/opt/homebrew/bin/claude")');
  });
  it('no endpoint ⇒ no port deny', () => {
    w = sessionWorld();
    expect(sessionProfileSbpl(worldPolicy(w, null), extras(w))).not.toContain('remote ip "localhost:');
  });
  it('every path is realpath\'d: a deny named through a symlink lands on the target', () => {
    w = sessionWorld();
    const link = path.join(w.root, 'linked-alias');
    fs.symlinkSync(w.linked, link);
    const pol = worldPolicy(w);
    const sb = sessionProfileSbpl({ ...pol, denyWrite: [...pol.denyWrite, { path: fs.realpathSync(link), match: 'subpath', class: 'linked-folder' }] }, extras(w));
    expect(sb).not.toContain(link);
  });
  it('T-008: a linked worktree\'s .git pointer file, config.worktree and modules/**/{hooks,config,info} are write-denied', () => {
    w = sessionWorld();
    const wt = path.join(w.root, 'wt');
    const gd = path.join(w.cwd, '.git', 'worktrees', 'wt');
    fs.mkdirSync(gd, { recursive: true });
    fs.mkdirSync(wt);
    fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${gd}\n`);
    fs.writeFileSync(path.join(gd, 'commondir'), '../..\n');
    const g = extraGitDenies([wt]);
    expect(g.paths).toContain(path.join(wt, '.git'));
    expect(g.paths).toContain(path.join(gd, 'config.worktree'));
    expect(g.paths).toContain(path.join(w.cwd, '.git', 'config.worktree'));
    const re = g.filters.filter((f) => f.startsWith('(regex'));
    expect(re.some((f) => f.includes('/modules/.*/(hooks|info)'))).toBe(true);
    expect(re.some((f) => f.includes('/modules/.*/config$'))).toBe(true);
  });
  it('a path SBPL cannot express refuses the whole profile (fail closed)', () => {
    w = sessionWorld();
    const pol = worldPolicy(w);
    expect(() => sessionProfileSbpl({ ...pol, denyWrite: [...pol.denyWrite, { path: '/tmp/a"b', match: 'literal', class: 'settings' }] }, extras(w))).toThrow(SbplError);
  });
});

describe('G-WIN-06 the platform registry: no backend ⇒ refused, status partial', () => {
  it.each(['win32', 'linux'])('%s refuses sandbox-unavailable (never an unsandboxed spawn)', (p) => {
    w = sessionWorld();
    try {
      sessionLaunchPlan({ policy: worldPolicy(w), binaryReal: '/bin/true', argv: [], extras: extras(w) }, p);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(LifecycleRefusal);
      expect((e as LifecycleRefusal).reason).toBe('sandbox-unavailable');
    }
  });
  it('status: win32 partial, linux partial (classes none), darwin partial (screen/launchers/service-manager by analogy)', () => {
    expect(sessionSandboxFidelity('win32').fidelity).toBe('partial');
    expect(sessionSandboxFidelity('linux').fidelity).toBe('partial');
    expect(sessionSandboxFidelity('darwin').fidelity).toBe('partial');
    expect(sessionSandboxFidelity('aix').fidelity).toBe('none');
  });
});
