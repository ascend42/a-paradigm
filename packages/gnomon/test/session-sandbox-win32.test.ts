// @gnomon-platform: win32
/**
 * The win32 `session` sandbox profile (W5, docs/plans/gnomon-windows.md; spec §15.5, §16 "Sandbox" + "Session
 * denies"): Low integrity under a restricted token carrying GNOMON_SESSION_SID and the session's own SID, the policy as
 * labels and session-SID ACEs, a private Low desktop. Sibling of test/session-sandbox.test.ts (darwin). Falsifiers,
 * run under a real session token: the home is neither readable nor writable, a carve-back read stays read-only, the
 * repo is writable, ~/.claude is not except the transcripts carve-back (whose root cannot be replaced), a literal-
 * denied file cannot be deleted and recreated (Aegis H1), nothing outside the roots can be written, no process of the
 * user can be signalled (Low integrity, Aegis H3), another session cannot write this one's session-env (Aegis M2).
 */
import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureGnomonHome } from '../src/kernel/lifecycle/home.js';
import { buildSessionPolicy } from '../src/kernel/manifest/policy.js';
import { clearVerifiedRootsForTests } from '../src/platform/owner-only.js';
import { pinWin32Helper } from '../src/platform/win32/helper-client.js';
import { liveHoldsForTests, mergeSessionAcls, ownCarveBacks, releaseSession, sessionSidFor, win32SessionAcls, win32SessionPlan } from '../src/platform/win32/session-sandbox.js';
import { transportLaunchPlan } from '../src/kernel/sandbox/index.js';
import { shieldProcess } from '../src/platform/win32/shield.js';
import { PKG_ROOT } from './helpers.js';

const HELPER = path.resolve(PKG_ROOT, '..', 'gnomon-helper', 'bin', 'win32', 'gnomon-helper.exe');
const built = fs.existsSync(HELPER);
if (!built && process.env.CI) throw new Error(`the win32 helper is not built at ${HELPER}`);
const pin = () => pinWin32Helper(HELPER);
const UUID = '0b8a2f4e-1c3d-4e5f-8a9b-0c1d2e3f4a5b';
const OWN = sessionSidFor('h-test-a');
const OTHER = sessionSidFor('h-test-b');

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  clearVerifiedRootsForTests();
  while (cleanups.length) await cleanups.pop()!();
});

/** A user profile with a Gnomon home, a repo and a ~/.claude, under the real temp dir (realpath'd: 8.3 names). */
function fixture() {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'gsw-')));
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const profile = path.join(root, 'profile');
  const home = path.join(profile, '.gnomon');
  const repo = path.join(root, 'repo');
  const claude = path.join(profile, '.claude');
  for (const d of [repo, path.join(claude, 'projects'), path.join(claude, 'session-env', UUID), path.join(home, 'sessions', 's1'), path.join(home, 'bin')]) fs.mkdirSync(d, { recursive: true });
  ensureGnomonHome(home);
  fs.writeFileSync(path.join(home, 'secret.key'), 'k');
  fs.writeFileSync(path.join(home, 'sessions', 's1', 'mine.txt'), 'mine');
  fs.writeFileSync(path.join(home, 'bin', 'claude-x.exe'), 'bin');
  fs.writeFileSync(path.join(claude, 'settings.json'), '{}');
  fs.writeFileSync(path.join(profile, '.bashrc'), '# rc');
  fs.writeFileSync(path.join(repo, 'CLAUDE.md'), '# steering');
  const policy = buildSessionPolicy({
    home, cwd: repo, userClaudeDir: claude, managedSettingsPaths: [], linkedFolders: [], endpointPort: null, userHome: profile,
    homeReadable: [{ path: path.join(home, 'sessions', 's1'), match: 'subpath' }, { path: path.join(home, 'bin', 'claude-x.exe'), match: 'literal' }],
    claudeTranscripts: true, claudeSessionEnv: UUID,
  });
  const tempDir = path.join(root, 'gnomon-sessions', 'a');
  fs.mkdirSync(tempDir, { recursive: true });
  return { root, profile, home, repo, claude, policy, tempDir };
}

describe('the win32 session profile: entries (W5)', () => {
  it('Low labels on the roots, home deny-all, own vs shared carve-backs, H1 parent deny, honest partial', () => {
    const f = fixture();
    const { entries, partial } = win32SessionAcls({ policy: f.policy, roots: [f.repo], tempDir: f.tempDir, sessionSid: OWN });
    const of = (p: string) => entries.filter((e) => e.path.toLowerCase() === p.toLowerCase()).map((e) => `${e.mode}:${e.match}${e.sid ? `:${e.sid === OWN ? 'own' : e.sid}` : ''}`).sort();
    expect(of(f.repo)).toEqual(['deny-replace:literal', 'label-low:subpath']); // H1: the parent of CLAUDE.md
    expect(of(f.tempDir)).toEqual(['allow-write-keep:subpath:own', 'label-low:subpath']); // re-review M3
    expect(of(path.dirname(f.tempDir))).toEqual(['deny-write:subpath']);
    expect(of(path.join(f.repo, 'CLAUDE.md'))).toEqual(['deny-write:literal', 'label-readable:literal']); // re-review H1
    expect(of(f.home)).toContain('deny-all:subpath');
    expect(of(path.join(f.home, 'sessions', 's1'))).toEqual(['allow-read:subpath:own', 'label-readable:subpath']);
    expect(of(path.join(f.home, 'bin', 'claude-x.exe'))).toEqual(['allow-read:literal', 'label-readable:literal']); // shared
    expect(of(f.claude)).toContain('deny-write:subpath');
    expect(of(path.join(f.claude, 'projects'))).toEqual(['allow-write-keep:subpath', 'label-low:subpath']); // shared
    expect(of(path.join(f.claude, 'session-env', UUID))).toEqual(['allow-write-keep:subpath:own', 'label-low:subpath']);
    expect(ownCarveBacks(f.policy).map((p) => path.basename(p)).sort()).toEqual([UUID, 's1']);
    expect(entries.some((e) => /^hkcu/i.test(e.path))).toBe(false); // Low integrity already denies every HKCU write
    expect(partial.join('\n')).toMatch(/existing matches only \(a new one can be created\)/);
  });

  it('one ACE entry and one label entry per path: denies merge, a label beside an ACE is fine, an allow plus a deny refuses', () => {
    const [h, x, d, p] = [String.raw`C:\h`, String.raw`C:\x`, String.raw`C:\d`, String.raw`C:\p`];
    const m = mergeSessionAcls([
      { path: h, mode: 'deny-all', match: 'subpath' },
      { path: x, mode: 'deny-read', match: 'literal' },
      { path: h.toLowerCase(), mode: 'deny-write', match: 'subpath' },
      { path: x, mode: 'deny-write', match: 'subpath' },
      { path: d, mode: 'deny-replace', match: 'literal' },
      { path: d, mode: 'label-low', match: 'subpath' },
      { path: d, mode: 'deny-write', match: 'literal' },
    ]);
    expect(m).toEqual([
      { path: h, mode: 'deny-all', match: 'subpath' },
      { path: x, mode: 'deny-all', match: 'subpath' },
      { path: d, mode: 'deny-write', match: 'literal' },
      { path: d, mode: 'label-low', match: 'subpath' },
    ]);
    expect(() => mergeSessionAcls([{ path: p, mode: 'allow-write-keep', match: 'subpath' }, { path: p, mode: 'deny-write', match: 'literal' }])).toThrow(/cannot be one entry/);
    expect(() => mergeSessionAcls([{ path: p, mode: 'allow-read', match: 'subpath', sid: OWN }, { path: p, mode: 'allow-read', match: 'subpath', sid: OTHER }])).toThrow(/cannot be one entry/);
  });
});

/** Run `script` (node -e) as a session: Low, restricted, private desktop, the given own SID. */
function asSession(exe: string, own: string, script: string, args: string[] = []): Record<string, string> {
  const out = spawnSync(exe, ['sandbox', '--low', '--desktop', '--session-sid', own, '--', process.execPath, '-e', script, ...args], { encoding: 'utf8', input: '', windowsHide: true, timeout: 60_000 });
  const last = out.stdout.trim().split('\n').pop() ?? '';
  try {
    return JSON.parse(last) as Record<string, string>;
  } catch {
    throw new Error(`no JSON from the session (status ${out.status}): ${out.stdout.slice(0, 300)} ${out.stderr.slice(0, 300)}`);
  }
}

(built ? describe : describe.skip)('the win32 session profile: under a session token (W5)', () => {
  it('falsifiers: home, carve-backs, ~/.claude, delete-and-recreate, outside writes, process signals', async () => {
    const f = fixture();
    const p = pin();
    win32SessionPlan({ policy: f.policy, roots: [f.repo], tempDir: f.tempDir, sessionSid: OWN, binaryReal: process.execPath, argv: [] }, p);
    cleanups.push(() => releaseSession(OWN, p));
    expect(liveHoldsForTests()).toContain(OWN);

    const target = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
    cleanups.push(() => target.kill());
    await shieldProcess(target.pid!, p);
    const loose = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
    cleanups.push(() => loose.kill());

    const probe = `
const fs = require('fs'), path = require('path'), r = {};
const [home, repo, claude, profile, shielded, unshielded] = process.argv.slice(1);
const t = (k, fn) => { try { fn(); r[k] = 'ok'; } catch (e) { r[k] = e.code || e.message; } };
t('readSecret', () => fs.readFileSync(path.join(home, 'secret.key')));
t('statHome', () => fs.statSync(home));
t('listHome', () => fs.readdirSync(home));
t('realpathCarve', () => fs.realpathSync.native(path.join(home, 'sessions', 's1', 'mine.txt')));
t('writeHome', () => fs.writeFileSync(path.join(home, 'planted.json'), '{}'));
t('readCarve', () => fs.readFileSync(path.join(home, 'sessions', 's1', 'mine.txt')));
t('readBin', () => fs.readFileSync(path.join(home, 'bin', 'claude-x.exe')));
t('writeCarve', () => fs.writeFileSync(path.join(home, 'sessions', 's1', 'w.txt'), 'x'));
t('writeRepo', () => fs.writeFileSync(path.join(repo, 'w.txt'), 'x'));
t('deleteRepoFile', () => fs.unlinkSync(path.join(repo, 'w.txt')));
t('writeClaudeMd', () => fs.writeFileSync(path.join(repo, 'CLAUDE.md'), 'evil'));
t('deleteClaudeMd', () => fs.unlinkSync(path.join(repo, 'CLAUDE.md')));
t('writeSettings', () => fs.writeFileSync(path.join(claude, 'settings.json'), '{"x":1}'));
t('writeTranscript', () => { fs.mkdirSync(path.join(claude, 'projects', 'p'), { recursive: true }); fs.writeFileSync(path.join(claude, 'projects', 'p', 't.jsonl'), '{}'); });
t('writeSessionEnv', () => fs.writeFileSync(path.join(claude, 'session-env', '${UUID}', 'env.sh'), 'x'));
t('renameProjects', () => fs.renameSync(path.join(claude, 'projects'), path.join(claude, 'projects2')));
t('writeBashrc', () => fs.appendFileSync(path.join(profile, '.bashrc'), 'evil'));
t('writeOutside', () => fs.writeFileSync(path.join(profile, 'outside.txt'), 'x'));
t('killShielded', () => process.kill(Number(shielded)));
t('killUnshielded', () => process.kill(Number(unshielded)));
console.log(JSON.stringify(r));`;
    const r = asSession(p.exe, OWN, probe, [f.home, f.repo, f.claude, f.profile, String(target.pid), String(loose.pid)]);
    expect(r).toEqual({
      readSecret: 'EPERM', statHome: 'ok', listHome: 'EPERM', realpathCarve: 'ok', writeHome: 'EPERM', readCarve: 'ok', readBin: 'ok', writeCarve: 'EPERM', writeRepo: 'ok', deleteRepoFile: 'ok',
      writeClaudeMd: 'EPERM', deleteClaudeMd: 'EPERM', writeSettings: 'EPERM', writeTranscript: 'ok', writeSessionEnv: 'ok',
      renameProjects: 'EPERM', writeBashrc: 'EPERM', writeOutside: 'EPERM', killShielded: 'EPERM', killUnshielded: 'EPERM',
    });
    // another session (a different own SID) can neither read this one's home carve-back nor write its session-env
    const other = asSession(p.exe, OTHER, `
const fs = require('fs'), path = require('path'), r = {};
const [home, claude] = process.argv.slice(1);
const t = (k, fn) => { try { fn(); r[k] = 'ok'; } catch (e) { r[k] = e.code || e.message; } };
t('readCarve', () => fs.readFileSync(path.join(home, 'sessions', 's1', 'mine.txt')));
t('writeSessionEnv', () => fs.writeFileSync(path.join(claude, 'session-env', '${UUID}', 'env2.sh'), 'x'));
t('writeTranscript', () => fs.writeFileSync(path.join(claude, 'projects', 'p', 't2.jsonl'), '{}'));
console.log(JSON.stringify(r));`, [f.home, f.claude]);
    expect(other).toEqual({ readCarve: 'EPERM', writeSessionEnv: 'EPERM', writeTranscript: 'ok' });
    // the kernel can still read its own home (the denies bind sessions only)
    expect(fs.readFileSync(path.join(f.home, 'secret.key'), 'utf8')).toBe('k');
    // a Low process WITHOUT a session SID (the confined GUI transport, another app's Low sandbox): the labels on the
    // denied paths stop it too (re-review H1); the root itself is Low while the session holds it
    const lowWriter = async (): Promise<Record<string, string>> => {
      const probe = path.join(f.root, 'low-writer.cjs');
      fs.writeFileSync(probe, `const fs = require('fs'), path = require('path');
process.on('message', (m) => { const [repo, home] = m; const r = {}; const t = (k, fn) => { try { fn(); r[k] = 'ok'; } catch (e) { r[k] = e.code || e.message; } };
t('writeRepo', () => fs.writeFileSync(path.join(repo, 'low.txt'), 'x'));
t('writeClaudeMd', () => fs.writeFileSync(path.join(repo, 'CLAUDE.md'), 'evil'));
t('listHome', () => fs.readdirSync(home));
process.send(r); });`);
      const plan = transportLaunchPlan({ scriptPath: probe, bundleDir: f.root });
      const c = spawn(plan.command, plan.args, { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], env: plan.env, windowsHide: true });
      cleanups.push(() => c.kill());
      await plan.confine!(c.pid!);
      c.send([f.repo, f.home]);
      return new Promise((res) => c.once('message', (m) => (res(m as Record<string, string>), c.kill())));
    };
    // partial, reported: while a session holds the home open for metadata, a Low process can list it (names only)
    expect(await lowWriter()).toEqual({ writeRepo: 'ok', writeClaudeMd: 'EPERM', listHome: 'ok' });
    // the session's own grants, its Low labels and the metadata opening end with it (re-review H1, M2)
    releaseSession(OWN, p);
    expect(liveHoldsForTests()).not.toContain(OWN);
    const after = asSession(p.exe, OWN, `
const fs = require('fs'), path = require('path'), r = {};
const [home, claude, repo] = process.argv.slice(1);
const t = (k, fn) => { try { fn(); r[k] = 'ok'; } catch (e) { r[k] = e.code || e.message; } };
t('readCarve', () => fs.readFileSync(path.join(home, 'sessions', 's1', 'mine.txt')));
t('writeSessionEnv', () => fs.writeFileSync(path.join(claude, 'session-env', '${UUID}', 'env3.sh'), 'x'));
t('writeRepo', () => fs.writeFileSync(path.join(repo, 'after.txt'), 'x'));
console.log(JSON.stringify(r));`, [f.home, f.claude, f.repo]);
    expect(after).toEqual({ readCarve: 'EPERM', writeSessionEnv: 'EPERM', writeRepo: 'EPERM' });
    expect(await lowWriter()).toEqual({ writeRepo: 'EPERM', writeClaudeMd: 'EPERM', listHome: 'EPERM' });
  });

  it('Aegis H1 (PR #52 release blocker): a session cannot open another session\'s process; it still can its own', async () => {
    const p = pin();
    // session A: kills a child of its own (own-SID allow), reports its pid, then waits to be targeted
    const a = spawn(p.exe, ['sandbox', '--low', '--desktop', '--session-sid', OWN, '--', process.execPath, '-e', `
const { spawn } = require('child_process');
const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
let own; try { process.kill(c.pid); own = 'ok'; } catch (e) { own = e.code; }
console.log(JSON.stringify({ pid: process.pid, own }));
setTimeout(() => {}, 60000);`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    cleanups.push(() => a.kill());
    const first = await new Promise<{ pid: number; own: string }>((res, rej) => {
      let buf = '';
      a.stdout!.on('data', (b: Buffer) => {
        buf += b.toString();
        const nl = buf.indexOf('\n');
        if (nl >= 0) res(JSON.parse(buf.slice(0, nl)));
      });
      a.once('exit', (c) => rej(new Error(`session A exited ${c}`)));
    });
    expect(first.own).toBe('ok');
    // session B (another own SID, same user, same Low integrity) probes session A's node process
    const b = asSession(p.exe, OTHER, `
const r = {}; const t = (k, fn) => { try { fn(); r[k] = 'ok'; } catch (e) { r[k] = e.code || e.message; } };
t('probe', () => process.kill(Number(process.argv[1]), 0));
t('kill', () => process.kill(Number(process.argv[1])));
// the owner-rights path (Aegis re-review): the helper's process.shield opens the target READ_CONTROL | WRITE_DAC; the
// session objects are owned by the user, a restricting SID, so without an OWNER RIGHTS ACE this would be granted and
// session B could rewrite A's DACL and reopen it with full access
const h = require('child_process').spawnSync(process.argv[2], ['once'], { input: JSON.stringify({ id: 1, op: 'process.shield', pid: Number(process.argv[1]) }) + '\\n', encoding: 'utf8' });
let reply = {}; try { reply = JSON.parse(h.stdout.trim().split('\\n').pop()); } catch {}
// denied AT THE OPEN (OpenProcess for READ_CONTROL | WRITE_DAC), not at a later step of the op
r.rewriteDacl = /OpenProcess\\b/.test(String(reply.message)) && /\\b5\\b|denied/i.test(String(reply.message)) ? 'denied' : 'reply:' + h.stdout.slice(0, 200);
console.log(JSON.stringify(r));`, [String(first.pid), p.exe]);
    expect(b).toEqual({ probe: 'EPERM', kill: 'EPERM', rewriteDacl: 'denied' });
    expect(a.exitCode).toBeNull(); // session A is still running
  });

  it('W5 acceptance (PR #52 release blocker): a session cannot reach a Medium window — not found, not messaged, not focused', async () => {
    const p = pin();
    const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    // the stand-in for the wrapper (W6 is not built): a Medium window owned by this user, reporting its HWND
    const target = spawn(ps, ['-NoProfile', '-Command', `
Add-Type -AssemblyName System.Windows.Forms
$f = New-Object System.Windows.Forms.Form; $f.Text = 'gnomon-uipi-target'; $f.ShowInTaskbar = $false; $f.Opacity = 0
$f.Add_Shown({ [Console]::Out.WriteLine([int64]$f.Handle); [Console]::Out.Flush() })
[System.Windows.Forms.Application]::Run($f)`], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
    cleanups.push(() => target.kill());
    const hwnd = await new Promise<string>((res, rej) => {
      target.stdout!.once('data', (b: Buffer) => res(String(b).trim()));
      target.once('exit', (c) => rej(new Error(`target exited ${c}`)));
    });
    expect(hwnd).toMatch(/^\d+$/);
    // the session: Low, restricted, on its private desktop, in a job with UI limits; Add-Type needs a Low temp dir
    const lowTemp = path.join(os.homedir(), 'AppData', 'LocalLow', `gnomon-uipi-${process.pid}`);
    fs.mkdirSync(lowTemp, { recursive: true });
    cleanups.push(() => fs.rmSync(lowTemp, { recursive: true, force: true }));
    const probe = `
Add-Type -Name U -Namespace W -MemberDefinition '
[DllImport("user32.dll", SetLastError=true)] public static extern System.IntPtr FindWindow(string c, string n);
[DllImport("user32.dll", SetLastError=true)] public static extern bool IsWindow(System.IntPtr h);
[DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(System.IntPtr h, uint m, System.IntPtr w, System.IntPtr l);
[DllImport("user32.dll", SetLastError=true)] public static extern bool SetForegroundWindow(System.IntPtr h);'
$h = [System.IntPtr][int64]${hwnd}
$r = @{ is = [W.U]::IsWindow($h); tray = [int64][W.U]::FindWindow('Shell_TrayWnd', $null) }
$r.post = [W.U]::PostMessage($h, 0x0010, [System.IntPtr]::Zero, [System.IntPtr]::Zero)
$r.focus = [W.U]::SetForegroundWindow($h)
$r | ConvertTo-Json -Compress`;
    const out = spawnSync(p.exe, ['sandbox', '--low', '--desktop', '--session-sid', OWN, '--', ps, '-NoProfile', '-Command', probe], { encoding: 'utf8', input: '', windowsHide: true, timeout: 90_000, env: { ...process.env, TEMP: lowTemp, TMP: lowTemp } });
    const last = out.stdout.trim().split('\n').pop() ?? '';
    if (!last.startsWith('{')) throw new Error(`sandboxed probe gave no result: status ${out.status} signal ${out.signal} error ${out.error?.message}\nstdout: ${out.stdout.slice(0, 500)}\nstderr: ${out.stderr.slice(0, 1500)}`);
    const r = JSON.parse(last) as Record<string, unknown>;
    expect(r).toEqual({ is: false, tray: 0, post: false, focus: false });
    // the control: unsandboxed, the same handle is a live window (the falsifier is not vacuous)
    const ctl = spawnSync(ps, ['-NoProfile', '-Command', `${probe.split('$r = ')[0]}[W.U]::IsWindow($h)`], { encoding: 'utf8', windowsHide: true, timeout: 60_000 });
    expect(ctl.stdout.trim().split('\n').pop()?.trim()).toBe('True');
    await new Promise((res) => setTimeout(res, 500));
    expect(target.exitCode).toBeNull(); // WM_CLOSE never arrived: the Medium window is still up
  }, 120_000);

  it('a session launched by a SHIELDED kernel runs, and cannot open its launcher (Aegis M1)', async () => {
    const p = pin();
    // a stand-in kernel: shielded (its default DACL denies the session SID), then it launches a session that tries to
    // signal the launcher (its parent) and reports
    const kernel = `
const { spawnSync } = require('child_process');
process.stdin.once('data', () => {
  const probe = "let r='ran'; try { process.kill(process.ppid, 0); r += ' parent-open'; } catch (e) { r += ' ' + e.code; } process.stdout.write(r)";
  const x = spawnSync(${JSON.stringify(p.exe)}, ['sandbox', '--low', '--desktop', '--session-sid', ${JSON.stringify(OWN)}, '--', process.execPath, '-e', probe], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
  process.stdout.write(JSON.stringify({ status: x.status, out: x.stdout, err: (x.stderr || '').slice(0, 300) }));
  process.exit(0);
});`;
    const k = spawn(process.execPath, ['-e', kernel], { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
    cleanups.push(() => k.kill());
    let out = '';
    k.stdout!.on('data', (b: Buffer) => (out += b.toString()));
    await shieldProcess(k.pid!, p);
    k.stdin!.write('go\n');
    await new Promise((r) => k.once('exit', r));
    expect(JSON.parse(out)).toMatchObject({ status: 0, out: 'ran EPERM' });
  });
});
