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
import { binaryDenies, ensureTranscriptDir } from '../src/kernel/supervisor/supervisor.js';
import { PERSISTENCE_PATHS, realpathLoose, buildSessionPolicy, claudePermissions, type SessionPolicyInput } from '../src/kernel/manifest/policy.js';
import { LifecycleRefusal } from '../src/kernel/lifecycle/refusal.js';
import { parseCsrutilStatus } from '../src/platform/darwin/macos.js';
import { sessionWorld, worldPolicy, type SessionWorld } from './session-helpers.js';

let w: SessionWorld;
afterEach(() => w?.cleanup());
/**
 * FIXTURE: the exact `/usr/bin/csrutil status` stdout on macOS 15.7.3 (darwin
 * 24.6.0, arm64, SIP on), captured 2026-10-17 — one line, trailing newline.
 */
const CSRUTIL_MACOS15_ENABLED = 'System Integrity Protection status: enabled.\n';
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
    expect(sb).toContain('(deny mach-lookup (global-name "com.apple.coreservices.appleevents"))'); // CI run 39100811385: the service, not only the in-process check
    for (const l of DARWIN_LAUNCHERS) expect(sb).toContain(`(literal "${realpathLoose(l)}")`); // realpath'd on the host (on Linux /usr/bin/open may be a link)
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

describe('TD-2026-10-19-814 item 1: ~/.claude/projects (Claude Code transcripts) is carved back out of the ~/.claude write deny (probe p-resume, darwin)', () => {
  const claudeDir = (x: SessionWorld) => path.join(x.userHome, '.claude');
  const projects = (x: SessionWorld) => path.join(x.userHome, '.claude', 'projects');
  /** the index of the LAST `file-write*` rule whose line names `needle` (SBPL: the last matching rule wins) */
  const lastWriteRule = (sb: string, needle: string): { i: number; verb: string } => {
    const lines = sb.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) if (/^\((allow|deny) file-write\* /.test(lines[i]!) && lines[i]!.includes(needle)) return { i, verb: lines[i]!.slice(1, lines[i]!.indexOf(' ')) };
    return { i: -1, verb: '' };
  };
  it('profile text: the projects allow comes AFTER the ~/.claude deny; settings.json and ~/.claude.json stay denied; nothing re-covers the allow but the projects dir itself (literal)', () => {
    w = sessionWorld();
    const sb = sessionProfileSbpl(worldPolicy(w, 4321, [], [], { claudeTranscripts: true }), extras(w));
    const lines = sb.split('\n');
    const iDeny = lines.findIndex((l) => l.startsWith('(deny file-write* ') && l.includes(`(subpath "${claudeDir(w)}")`));
    const iAllow = lines.indexOf(`(allow file-write* (subpath "${projects(w)}"))`);
    expect(iDeny).toBeGreaterThan(-1);
    expect(iAllow).toBeGreaterThan(iDeny);
    expect(lines[iDeny]).toContain(`(literal "${path.join(w.userHome, '.claude.json')}")`);
    // the ONLY write allow in the profile, and no file-write deny after it names the projects dir or an ancestor of it
    // T-2026-10-23-004: besides the deny-by-default allowlist (device files, roots, temp, caches), the projects carve-back is the only write allow
    expect(lines.filter((l) => l.startsWith('(allow file-write*') && !l.includes('(literal "/dev/null")'))).toEqual([`(allow file-write* (subpath "${projects(w)}"))`]);
    for (const l of lines.slice(iAllow + 1).filter((x) => x.startsWith('(deny file-write*'))) {
      expect(l).not.toContain(`(subpath "${claudeDir(w)}")`);
      expect(l).not.toContain(`(subpath "${projects(w)}")`);
      expect(l).not.toContain(`(subpath "${w.userHome}")`);
    }
    expect(lastWriteRule(sb, `(subpath "${projects(w)}")`)).toMatchObject({ i: iAllow, verb: 'allow' });
    // ~/.claude/settings.json and ~/.claude.json: their last matching write rule is a deny (the subpath allow names only projects)
    expect(path.join(claudeDir(w), 'settings.json').startsWith(projects(w) + path.sep)).toBe(false);
    expect(lastWriteRule(sb, `(subpath "${claudeDir(w)}")`).verb).toBe('deny');
    expect(lastWriteRule(sb, `(literal "${path.join(w.userHome, '.claude.json')}")`).verb).toBe('deny');
  });
  it('policy data: allowWrite is exactly <userClaudeDir>/projects (realpath\'d); off unless claudeTranscripts (a local session gets none)', () => {
    w = sessionWorld();
    const on = worldPolicy(w, null, [], [], { claudeTranscripts: true });
    expect(on.allowWrite).toEqual([{ path: projects(w), match: 'subpath', class: 'transcripts' }]);
    expect(on.allowWriteRefused).toBeUndefined();
    expect(on.denyWrite.some((d) => d.path === claudeDir(w) && d.match === 'subpath')).toBe(true);
    const off = worldPolicy(w);
    expect(off.allowWrite).toEqual([]);
    expect(sessionProfileSbpl(off, extras(w))).not.toContain(`(subpath "${projects(w)}")`);
  });
  it('a project cannot widen it: the input has no allow path, and an injected one is ignored', () => {
    w = sessionWorld();
    const inp = { home: w.home, cwd: w.cwd, userClaudeDir: claudeDir(w), userHome: w.userHome, managedSettingsPaths: [], linkedFolders: [], endpointPort: null, claudeTranscripts: true, allowWrite: [{ path: claudeDir(w), match: 'subpath', class: 'transcripts' }] } as unknown as SessionPolicyInput;
    const p = buildSessionPolicy(inp);
    expect(p.allowWrite.map((a) => a.path)).toEqual([projects(w)]);
    // Claude's own Edit tool still may not write there (the carve-back is for Claude Code's transcript writer, not the model)
    expect(claudePermissions(p).permissions.deny).toContain(`Edit(/${claudeDir(w)}/**)`);
  });
  it('win32 (W5): Low-integrity sessions get the PowerShell tool and no Bash tool; other platforms are unchanged', () => {
    w = sessionWorld();
    const p = buildSessionPolicy({ home: w.home, cwd: w.cwd, userClaudeDir: claudeDir(w), userHome: w.userHome, managedSettingsPaths: [], linkedFolders: [], endpointPort: null });
    const win = claudePermissions(p, 'win32');
    expect(win.permissions.deny).toContain('Bash');
    expect(win.env).toMatchObject({ CLAUDE_CODE_USE_POWERSHELL_TOOL: '1' });
    expect(win.permissions.ask).toContain('PowerShell');
    for (const plat of ['darwin', 'linux']) {
      const o = claudePermissions(p, plat);
      expect(o.permissions.deny).not.toContain('Bash');
      expect(o.env).not.toHaveProperty('CLAUDE_CODE_USE_POWERSHELL_TOOL');
    }
  });
  it('a deny inside the carve-back (a cwd under ~/.claude/projects) is re-denied AFTER the allow', () => {
    w = sessionWorld();
    const inner = path.join(projects(w), 'enc', 'pinned');
    const p = worldPolicy(w, null, [{ path: inner, match: 'literal', class: 'binary' }], [], { claudeTranscripts: true });
    expect(p.denyWriteAlways).toEqual([{ path: projects(w), match: 'literal', class: 'transcripts' }, { path: inner, match: 'literal', class: 'binary' }]);
    const sb = sessionProfileSbpl(p, extras(w));
    expect(lastWriteRule(sb, `(literal "${inner}")`).verb).toBe('deny');
    expect(lastWriteRule(sb, `(literal "${inner}")`).i).toBeGreaterThan(lastWriteRule(sb, `(subpath "${projects(w)}")`).i);
  });
  it('Aegis M1: the projects dir itself is literal-denied AFTER the allow (no remove, rename or swap); its children still fall to the allow', () => {
    w = sessionWorld();
    const p = worldPolicy(w, null, [], [], { claudeTranscripts: true });
    expect(p.denyWriteAlways).toContainEqual({ path: projects(w), match: 'literal', class: 'transcripts' });
    const sb = sessionProfileSbpl(p, extras(w));
    const lit = lastWriteRule(sb, `(literal "${projects(w)}")`);
    expect(lit.verb).toBe('deny');
    expect(lit.i).toBeGreaterThan(lastWriteRule(sb, `(subpath "${projects(w)}")`).i);
    // never a subpath or prefix re-deny of the carve-back: that would close the transcripts again
    expect(p.denyWriteAlways.filter((d) => d.path === projects(w) && d.match !== 'literal')).toEqual([]);
  });
  it('Aegis L3: a steering regex whose root holds the carve-back is re-denied AFTER the allow, re-rooted at projects (the original would re-close ~/.claude itself)', () => {
    w = sessionWorld();
    // the production shape: the memory chain's top is the user home, so the steering regex covers ~/.claude/projects
    const p = buildSessionPolicy({ home: w.home, cwd: w.cwd, userClaudeDir: claudeDir(w), userHome: w.userHome, managedSettingsPaths: [], linkedFolders: [], endpointPort: null, memorySubtree: w.userHome, claudeTranscripts: true });
    expect(p.allowWrite.map((a) => a.path)).toEqual([projects(w)]);
    expect(p.denyWrite).toContainEqual({ path: w.userHome, match: 'steering', class: 'settings' });
    expect(p.denyWriteAlways).toContainEqual({ path: projects(w), match: 'steering', class: 'settings' });
    expect(p.denyWriteAlways.some((d) => d.match === 'steering' && d.path === w.userHome)).toBe(false);
    const sb = sessionProfileSbpl(p, extras(w));
    const lines = sb.split('\n');
    const iAllow = lines.indexOf(`(allow file-write* (subpath "${projects(w)}"))`);
    const re = projects(w).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    const iAgain = lines.findIndex((l, i) => i > iAllow && l.startsWith('(deny file-write* ') && l.includes(`(regex #"^${re}/(.+/)?\\.[Cc][Ll][Aa][Uu][Dd][Ee](/.*)?$")`) && l.includes(`(regex #"^${re}/(.+/)?[Cc][Ll][Aa][Uu][Dd][Ee][^/]*\\.[Mm][Dd]$")`));
    expect(iAllow).toBeGreaterThan(-1);
    expect(iAgain).toBeGreaterThan(iAllow);
    // the user-home-rooted steering regex is NOT repeated after the allow (it matches ~/.claude/** and would undo the carve-back)
    const homeRe = w.userHome.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    for (const l of lines.slice(iAllow + 1)) expect(l).not.toContain(`(regex #"^${homeRe}/(.+/)?`);
  });
  it('Aegis L3: a steering root INSIDE the carve-back is re-denied as is', () => {
    w = sessionWorld();
    const inner = path.join(projects(w), 'enc');
    fs.mkdirSync(inner, { recursive: true });
    const p = buildSessionPolicy({ home: w.home, cwd: w.cwd, userClaudeDir: claudeDir(w), userHome: w.userHome, managedSettingsPaths: [], linkedFolders: [], endpointPort: null, memorySubtree: inner, claudeTranscripts: true });
    expect(p.denyWriteAlways).toContainEqual({ path: inner, match: 'steering', class: 'settings' });
  });
  it('Aegis M1: ensureTranscriptDir creates a missing projects dir (owner-only) and leaves an existing entry exactly as found', () => {
    w = sessionWorld();
    ensureTranscriptDir(claudeDir(w));
    expect(fs.lstatSync(projects(w)).isDirectory()).toBe(true);
    expect(fs.statSync(projects(w)).mode & 0o777).toBe(0o700);
    fs.rmdirSync(projects(w));
    fs.symlinkSync(w.userHome, projects(w));
    ensureTranscriptDir(claudeDir(w));
    expect(fs.lstatSync(projects(w)).isSymbolicLink()).toBe(true);
    expect(worldPolicy(w, null, [], [], { claudeTranscripts: true }).allowWrite).toEqual([]);
  });
  it('fail closed: ~/.claude/projects linked to ~/.claude, the user home or the Gnomon home ⇒ no allow, reason recorded', () => {
    for (const target of [(x: SessionWorld) => claudeDir(x), (x: SessionWorld) => x.userHome, (x: SessionWorld) => x.home]) {
      w = sessionWorld();
      fs.symlinkSync(target(w), projects(w));
      const p = worldPolicy(w, null, [], [], { claudeTranscripts: true });
      expect(p.allowWrite).toEqual([]);
      expect(p.allowWriteRefused).toMatch(/resolves outside the user Claude dir/);
      expect(sessionProfileSbpl(p, extras(w))).not.toMatch(/\.claude\/projects"\)\)/);
      w.cleanup();
    }
  });
  it('fail closed: another write deny covering the projects dir (a Gnomon home that contains ~/.claude) ⇒ no allow', () => {
    w = sessionWorld();
    const p = buildSessionPolicy({ home: w.userHome, cwd: w.cwd, userClaudeDir: claudeDir(w), userHome: w.userHome, managedSettingsPaths: [], linkedFolders: [], endpointPort: null, claudeTranscripts: true });
    expect(p.allowWrite).toEqual([]);
    expect(p.allowWriteRefused).toMatch(/covered by another write deny \(gnomon-home/);
  });
});

describe('T-2026-10-18-010 the Gnomon home is read-denied; only the session\'s own reads are carved back', () => {
  const own = (x: SessionWorld) => path.join(x.home, 'sessions', 's1');
  const readable = (x: SessionWorld) => [{ path: own(x), match: 'subpath' as const }, { path: path.join(x.home, 'bin', 'claude-abc'), match: 'literal' as const }];
  it('policy: the whole home, keys and the kernel log (kernel.db*, log/**) are read-denied; keys + the kernel log re-denied after the allows', () => {
    w = sessionWorld();
    const p = worldPolicy(w, null, [], readable(w));
    const has = (list: readonly { path: string; match: string }[], pth: string, m: string) => list.some((d) => d.path === pth && d.match === m);
    expect(has(p.denyRead, w.home, 'subpath')).toBe(true);
    expect(has(p.denyRead, path.join(w.home, 'kernel.db'), 'prefix')).toBe(true);
    expect(has(p.denyRead, path.join(w.home, 'log'), 'subpath')).toBe(true);
    expect(has(p.denyReadAlways, path.join(w.home, 'keys'), 'subpath')).toBe(true);
    expect(has(p.denyReadAlways, path.join(w.home, 'kernel.db'), 'prefix')).toBe(true);
    expect(has(p.denyReadAlways, path.join(w.home, 'log'), 'subpath')).toBe(true);
    expect(p.allowRead.map((a) => `${a.match}:${a.path}`).sort()).toEqual([`literal:${path.join(w.home, 'bin', 'claude-abc')}`, `subpath:${own(w)}`].sort());
    // metadata (realpath's lstat) on the literal ancestors only: never a subpath, never data
    expect(p.allowReadMetadata.map((a) => a.path).sort()).toEqual([w.home, path.join(w.home, 'bin'), path.join(w.home, 'sessions')].sort());
    expect(p.allowReadMetadata.every((a) => a.match === 'literal')).toBe(true);
  });
  it('profile text: deny home → allow own → metadata → re-deny keys + kernel log, in that order (SBPL: last match wins)', () => {
    w = sessionWorld();
    const sb = sessionProfileSbpl(worldPolicy(w, null, [], readable(w)), extras(w));
    const iDeny = sb.indexOf(`(deny file-read* `);
    const iAllow = sb.indexOf('(allow file-read* ');
    expect(sb.slice(iAllow, sb.indexOf('\n', iAllow))).toContain(`(subpath "${own(w)}")`);
    const iMeta = sb.indexOf('(allow file-read-metadata ');
    // the last deny that is not the M5 helper deny (T-2026-10-18-028), which is a regex line after everything
    const iRe = sb.lastIndexOf(`(deny file-read* `, sb.indexOf('(deny file-read* (regex ') - 1);
    expect(sb.slice(iDeny, sb.indexOf('\n', iDeny))).toContain(`(subpath "${w.home}")`);
    expect(iDeny).toBeGreaterThanOrEqual(0);
    expect(iAllow).toBeGreaterThan(iDeny);
    expect(iMeta).toBeGreaterThan(iAllow);
    expect(iRe).toBeGreaterThan(iMeta);
    expect(sb.slice(iRe, sb.indexOf('\n', iRe))).toContain(`(subpath "${path.join(w.home, 'keys')}")`);
    expect(sb.slice(iRe, sb.indexOf('\n', iRe))).toContain(`(prefix "${path.join(w.home, 'kernel.db')}")`);
  });
  it.each([
    ['keys/device.key', 'literal'],
    ['keys', 'subpath'],
    ['kernel.db', 'literal'],
    ['log/segments', 'subpath'],
    ['sessions', 'subpath'],
    ['bin', 'subpath'],
    ['claude-pin.json', 'literal'],
    ['sessions/s1/../../keys', 'subpath'],
    ['', 'subpath'],
  ] as const)('a carve-back at <home>/%s (%s) refuses the policy (fail closed)', (rel, match) => {
    w = sessionWorld();
    expect(() => worldPolicy(w, null, [], [{ path: path.join(w.home, ...rel.split('/').filter(Boolean)), match }])).toThrow(/may read only inside/);
  });
  it('a carve-back outside the home refuses; an unknown match refuses', () => {
    w = sessionWorld();
    expect(() => worldPolicy(w, null, [], [{ path: w.cwd, match: 'subpath' }])).toThrow(/may read only inside/);
    expect(() => worldPolicy(w, null, [], [{ path: own(w), match: 'prefix' as 'subpath' }])).toThrow(/literal\|subpath/);
  });
  it('a carve-back through a symlink is judged by its realpath (a link in sessions/ to keys/ refuses)', () => {
    w = sessionWorld();
    fs.mkdirSync(path.join(w.home, 'sessions'), { recursive: true });
    fs.symlinkSync(path.join(w.home, 'keys'), path.join(w.home, 'sessions', 'evil'));
    expect(() => worldPolicy(w, null, [], [{ path: path.join(w.home, 'sessions', 'evil'), match: 'subpath' }])).toThrow(/may read only inside/);
  });
});

describe('the macOS floor (SESSION_SANDBOX_MIN_MACOS = 15; CI run 39100281741)', () => {
  it.each([14, 13, null])('darwin at macOS %s refuses sandbox-unavailable with the floor, never a weaker profile', (v) => {
    w = sessionWorld();
    try {
      sessionLaunchPlan({ policy: worldPolicy(w), binaryReal: '/bin/true', argv: [], extras: extras(w) }, 'darwin', () => v);
      expect.unreachable();
    } catch (e) {
      expect((e as LifecycleRefusal).reason).toBe('sandbox-unavailable');
      expect((e as LifecycleRefusal).detail).toMatchObject({ floor: 'macos', have: v, need: 15 });
    }
  });
});

describe('the SIP floor (CI run 39100811385: SIP off ⇒ launch constraints off ⇒ a copied launcher is not killed)', () => {
  it.each([
    [false, 'disabled'],
    [null, 'unknown'],
  ] as const)('darwin 15 with SIP %s refuses sandbox-unavailable {floor sip}, never a weaker profile', (sip, have) => {
    w = sessionWorld();
    try {
      sessionLaunchPlan({ policy: worldPolicy(w), binaryReal: '/bin/true', argv: [], extras: extras(w) }, 'darwin', () => 15, () => sip);
      expect.unreachable();
    } catch (e) {
      expect((e as LifecycleRefusal).reason).toBe('sandbox-unavailable');
      expect((e as LifecycleRefusal).detail).toMatchObject({ profile: 'session', floor: 'sip', have });
    }
  });
  it('the macOS floor is checked first', () => {
    w = sessionWorld();
    expect(() => sessionLaunchPlan({ policy: worldPolicy(w), binaryReal: '/bin/true', argv: [], extras: extras(w) }, 'darwin', () => 14, () => false)).toThrow(/macOS 15\+/);
  });
  it('status: SIP off ⇒ unavailable, reason sip-disabled', () => {
    expect(sessionSandboxFidelity('darwin', () => 15, () => false)).toMatchObject({ fidelity: 'unavailable', reason: 'sip-disabled', have: 'disabled' });
    expect(sessionSandboxFidelity('darwin', () => 15, () => null)).toMatchObject({ fidelity: 'unavailable', reason: 'sip-disabled', have: 'unknown' });
  });
  it('csrutil parsing: only a plain "enabled." is enabled; Custom Configuration is not', () => {
    expect(parseCsrutilStatus(CSRUTIL_MACOS15_ENABLED)).toBe(true);
    expect(parseCsrutilStatus('System Integrity Protection status: enabled.\n')).toBe(true);
    expect(parseCsrutilStatus('System Integrity Protection status: disabled.\n')).toBe(false);
    expect(parseCsrutilStatus('System Integrity Protection status: unknown (Custom Configuration).\n\nConfiguration:\n\tApple Internal: disabled\n')).toBe(false);
    expect(parseCsrutilStatus('')).toBe(null);
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
    expect(sessionSandboxFidelity('darwin', () => 15, () => true).fidelity).toBe('partial');
    // Aegis: AppleEvents are partial while spec OPEN 5 is open (status must not overclaim)
    expect(sessionSandboxFidelity('darwin', () => 15, () => true).classes['automation:apple-events']).toBe('partial');
    expect(sessionSandboxFidelity('darwin', () => 14)).toMatchObject({ fidelity: 'unavailable', reason: 'macos-floor', have: 14, need: 15 });
    expect(sessionSandboxFidelity('darwin', () => null)).toMatchObject({ fidelity: 'unavailable', reason: 'macos-floor' });
    expect(sessionSandboxFidelity('aix').fidelity).toBe('none');
  });
});
