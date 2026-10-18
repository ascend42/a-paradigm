/**
 * The generated `session` profile ENFORCED (spec §15.5 row `session`, §16
 * "Session denies"; M1.7 slice 1; P8-D79/D80; G-SBX-04, G-SBX-05, G-SBX-06,
 * G-SBX-08 run against the session profile). A shell under `sandbox-exec`
 * with the kernel-generated profile: key reads, settings/linked/git writes,
 * the endpoint port, pgrep, the screen socket dir and the launcher execs all
 * fail; the worktree, node and child spawn still work. The real-Claude half
 * (Claude Code working under this exact profile) is the probe
 * p10m-claude-compat-generated (pass, 2026-10-17). Never counts a failing
 * `ps` as evidence (setuid).
 */
// @gnomon-platform: darwin
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sessionLaunchPlan } from '../src/kernel/sandbox/session.js';
import { binaryDenies } from '../src/kernel/supervisor/supervisor.js';
import { COPIED_PLATFORM_BINARY_KILLED_FROM_MACOS } from '../src/platform/darwin/session-sbpl.js';
import { darwinFloor } from '../src/kernel/sandbox/session.js';
import { LifecycleRefusal } from '../src/kernel/lifecycle/refusal.js';

/** capability, not platform: below the macOS floor or with SIP off the backend refuses and the enforcement suite cannot run */
const FLOOR = darwinFloor();
const SANDBOX_OK = FLOOR.ok;
/** macOS 15+ whatever SIP says: the copied-osascript check is RECORDED there (informational, see below) */
const MACOS_OK = FLOOR.ok || FLOOR.floor === 'sip';
/**
 * The copied-osascript check, verbatim from check.sh below. It does NOT exercise
 * AppleEvent delivery: AppleScript answers `get name` of an application without
 * sending an event (measured 2026-10-17: the stock osascript prints "System
 * Events", exit 0, under a deny-all mach-lookup profile). Its exit code is
 * therefore recorded, never asserted as a security property (spec OPEN 5); only
 * its 137 under launch constraints (SIP on, macOS 15+) is asserted, below.
 */
const copiedOsascript = (root: string): string => `/bin/cp /usr/bin/osascript "${root}/osa" 2>/dev/null; "${root}/osa" -e 'tell application "System Events" to get name' >/dev/null 2>&1; echo "copied_osascript_exit=$?"`;
import { sessionWorld, worldPolicy, type SessionWorld } from './session-helpers.js';

let w: SessionWorld;
let server: http.Server;
let port = 0;
let hits = 0;
let out: Record<string, string> = {};
let sock: net.Server | null = null;
let createdScreenDir = false;
const LABEL = `com.gnomon.test.copied-launchctl.${process.pid}`;
let MARKER = '';
const macosMajor = Number((spawnSync('/usr/bin/sw_vers', ['-productVersion'], { encoding: 'utf8' }).stdout ?? '0').split('.')[0]);
const screenDir = path.join(fs.realpathSync(os.tmpdir()), '.screen');
const sockPath = path.join(screenDir, `gnomon-test-${process.pid}`);

beforeAll(async () => {
  if (!SANDBOX_OK) return;
  w = sessionWorld();
  MARKER = path.join(w.root, 'launchd-job-ran');
  server = http.createServer((_q, s) => {
    hits++;
    s.end('x');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as net.AddressInfo).port;
  if (!fs.existsSync(screenDir)) {
    fs.mkdirSync(screenDir, { mode: 0o700 });
    createdScreenDir = true;
  }
  sock = net.createServer((c) => c.end('s'));
  await new Promise<void>((r) => sock!.listen(sockPath, () => r()));
  // a fake native install: ~/.local/bin/claude -> ~/.local/share/claude/versions/2.1.302 (Aegis H1)
  const versions = path.join(w.userHome, '.local', 'share', 'claude', 'versions');
  fs.mkdirSync(versions, { recursive: true });
  fs.writeFileSync(path.join(versions, '2.1.302'), '#!/bin/sh\n', { mode: 0o755 });
  fs.mkdirSync(path.join(w.userHome, '.local', 'bin'), { recursive: true });
  fs.symlinkSync(path.join(versions, '2.1.302'), path.join(w.userHome, '.local', 'bin', 'claude'));
  for (const d of ['.ssh', 'Library/LaunchAgents', '.config/git']) fs.mkdirSync(path.join(w.userHome, d), { recursive: true });
  const bd = binaryDenies({ knownBinaries: ['~/.local/bin/claude'], managedSettings: [], managedSettingsDirs: [], managedUnscannable: [], userClaudeDir: '.claude' }, w.userHome, path.join(versions, '2.1.302'));
  const script = path.join(w.root, 'check.sh');
  fs.writeFileSync(
    script,
    `#!/bin/bash
cd "${w.cwd}"
echo hi > ./wrote.txt 2>/dev/null && echo "write_work=ok" || echo "write_work=fail"
(cat "${w.home}/keys/device.key") >/dev/null 2>&1 && echo "read_keys=allowed" || echo "read_keys=blocked"
(echo x > "${w.home}/x") 2>/dev/null && echo "write_home=allowed" || echo "write_home=blocked"
(echo x > "${w.linked}/x") 2>/dev/null && echo "write_linked=allowed" || echo "write_linked=blocked"
(echo x > "${w.userHome}/.claude/settings.json") 2>/dev/null && echo "write_user_claude=allowed" || echo "write_user_claude=blocked"
(echo x > "${w.userHome}/.claude.json") 2>/dev/null && echo "write_claude_json=allowed" || echo "write_claude_json=blocked"
(echo x > "${w.cwd}/.claude/settings.json") 2>/dev/null && echo "write_project_claude=allowed" || echo "write_project_claude=blocked"
(echo x > "${w.cwd}/CLAUDE.md") 2>/dev/null && echo "write_claude_md=allowed" || echo "write_claude_md=blocked"
(echo x > "${w.cwd}/.git/hooks/pre-commit") 2>/dev/null && echo "write_git_hook=allowed" || echo "write_git_hook=blocked"
(echo x >> "${w.cwd}/.git/config") 2>/dev/null && echo "write_git_config=allowed" || echo "write_git_config=blocked"
"${process.execPath}" -e "require('net').connect(${port},'127.0.0.1').on('connect',()=>{console.log('port=open');process.exit(0)}).on('error',e=>{console.log('port='+e.code);process.exit(0)})"
"${process.execPath}" -e "require('net').connect(${port + 1},'127.0.0.1').on('connect',()=>{console.log('port1=open');process.exit(0)}).on('error',e=>{console.log('port1='+e.code);process.exit(0)})"
"${process.execPath}" -e "require('net').connect('${sockPath}').on('connect',()=>{console.log('screen_sock=open');process.exit(0)}).on('error',e=>{console.log('screen_sock='+e.code);process.exit(0)})"
(echo x >> "${path.join(versions, '2.1.302')}") 2>/dev/null && echo "write_binary=allowed" || echo "write_binary=blocked"
(echo x > "${path.join(versions, '9.9.9')}") 2>/dev/null && echo "write_versions=allowed" || echo "write_versions=blocked"
(/bin/rm -f "${path.join(w.userHome, '.local', 'bin', 'claude')}") 2>/dev/null && [ -L "${path.join(w.userHome, '.local', 'bin', 'claude')}" ] && echo "unlink_link=blocked" || { [ -L "${path.join(w.userHome, '.local', 'bin', 'claude')}" ] && echo "unlink_link=blocked" || echo "unlink_link=allowed"; }
(echo x >> "${w.userHome}/.zshrc") 2>/dev/null && echo "write_zshrc=allowed" || echo "write_zshrc=blocked"
(echo x > "${w.userHome}/.ssh/authorized_keys") 2>/dev/null && echo "write_ssh=allowed" || echo "write_ssh=blocked"
(echo x > "${w.userHome}/Library/LaunchAgents/x.plist") 2>/dev/null && echo "write_launchagent=allowed" || echo "write_launchagent=blocked"
(echo x > "${w.userHome}/.gitconfig") 2>/dev/null && echo "write_gitconfig=allowed" || echo "write_gitconfig=blocked"
/bin/cp /bin/launchctl "${w.root}/lc" 2>/dev/null; "${w.root}/lc" submit -l "${LABEL}" -- /usr/bin/touch "${MARKER}" >/dev/null 2>&1; echo "copied_launchctl_exit=$?"
${copiedOsascript(w.root)}
/bin/cp /usr/bin/open "${w.root}/op" 2>/dev/null; "${w.root}/op" -h >/dev/null 2>&1; echo "copied_open_exit=$?"
n=$(pgrep -fl . 2>/dev/null | wc -l | tr -d ' '); echo "pgrep_lines=$n"
sleep 30 & C=$!; if kill $C 2>/dev/null; then wait $C 2>/dev/null; echo "child_spawn_kill=ok"; else echo "child_spawn_kill=fail"; fi
/usr/bin/open -h >/dev/null 2>&1; echo "open_exit=$?"
/usr/bin/osascript -e 'return 1' >/dev/null 2>&1; echo "osascript_exit=$?"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -h >/dev/null 2>&1; echo "lsregister_exit=$?"
/bin/launchctl list >/dev/null 2>&1; echo "launchctl_exit=$?"
`,
    { mode: 0o755 },
  );
  const plan = sessionLaunchPlan({ policy: worldPolicy(w, port, bd), binaryReal: '/bin/bash', argv: [script], extras: { uid: process.getuid!(), tmpdir: os.tmpdir(), home: w.userHome, roots: [w.cwd] } }, 'darwin');
  const r = spawnSync(plan.command, plan.args, { encoding: 'utf8', env: { HOME: w.userHome, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, timeout: 60_000 });
  out = Object.fromEntries(r.stdout.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
}, 90_000);

afterAll(async () => {
  spawnSync('/bin/launchctl', ['remove', LABEL]); // in case a submit ever got through
  server?.close();
  await new Promise<void>((r) => (sock ? sock.close(() => r()) : r()));
  fs.rmSync(sockPath, { force: true });
  if (createdScreenDir) fs.rmSync(screenDir, { recursive: true, force: true });
  w?.cleanup();
});

describe.runIf(!SANDBOX_OK)('below the host floor (macOS 15+ and SIP enabled)', () => {
  it(`the session backend refuses sandbox-unavailable (floor ${FLOOR.floor}) — no weaker profile`, () => {
    const x = sessionWorld();
    try {
      sessionLaunchPlan({ policy: worldPolicy(x), binaryReal: '/bin/true', argv: [], extras: { uid: process.getuid!(), tmpdir: os.tmpdir(), home: x.userHome, roots: [x.cwd] } }, 'darwin');
      expect.unreachable();
    } catch (e) {
      expect((e as LifecycleRefusal).reason).toBe('sandbox-unavailable');
      expect((e as LifecycleRefusal).detail).toMatchObject(FLOOR.floor === 'sip' ? { floor: 'sip', have: FLOOR.have } : { floor: 'macos', need: 15 });
    }
    x.cleanup();
  });
});

describe.runIf(MACOS_OK)('copied-osascript record under the generated profile (macOS 15+, regardless of SIP; CI run 39100811385) — informational', () => {
  it('records the copied osascript exit code (does NOT exercise AppleEvent delivery; no security assertion)', ({ annotate }) => {
    const x = sessionWorld();
    try {
      const script = path.join(x.root, 'osa.sh');
      fs.writeFileSync(script, `#!/bin/bash\n${copiedOsascript(x.root)}\n`, { mode: 0o755 });
      // SIP seam `() => true`: the exact profile a SIP host gets
      const plan = sessionLaunchPlan({ policy: worldPolicy(x), binaryReal: '/bin/bash', argv: [script], extras: { uid: process.getuid!(), tmpdir: os.tmpdir(), home: x.userHome, roots: [x.cwd] } }, 'darwin', undefined, () => true);
      const r = spawnSync(plan.command, plan.args, { encoding: 'utf8', env: { HOME: x.userHome, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, timeout: 60_000 });
      const exit = /copied_osascript_exit=(\d+)/.exec(r.stdout)?.[1];
      expect(exit, 'the check did not run').toBeDefined();
      // informational only: `get name` sends no AppleEvent, so this exit proves neither delivery nor the deny (spec OPEN 5)
      void annotate(`copied_osascript_exit=${exit} (SIP ${FLOOR.ok ? 'on' : 'off'}; informational, no AppleEvent is sent by this check)`);
    } finally {
      x.cleanup();
    }
  }, 90_000);
});

describe.skipIf(!SANDBOX_OK)('G-SBX-08 the generated session profile holds (darwin, macOS 15+, SIP enabled)', () => {
  it('Aegis H1: the claude binary, its versions dir and its known-location link cannot be replaced', () => {
    expect(out).toMatchObject({ write_binary: 'blocked', write_versions: 'blocked', unlink_link: 'blocked' });
  });
  it('Aegis M2: shell rc, ~/.ssh, LaunchAgents and ~/.gitconfig are unwritable', () => {
    expect(out).toMatchObject({ write_zshrc: 'blocked', write_ssh: 'blocked', write_launchagent: 'blocked', write_gitconfig: 'blocked' });
  });
  it('Aegis M1: a COPIED launchctl cannot submit a job (the copied osascript exit is recorded, not asserted)', async ({ annotate }) => {
    await new Promise((r) => setTimeout(r, 1_000));
    expect(out.copied_launchctl_exit, 'a copied launchctl SUBMITTED a job from inside the session profile').not.toBe('0');
    expect(fs.existsSync(MARKER), 'launchd RAN the job a copied launchctl submitted').toBe(false);
    // informational only: `get name` sends no AppleEvent (see copiedOsascript) — spec OPEN 5
    void annotate(`copied_osascript_exit=${out.copied_osascript_exit} (informational)`);
  });
  it(`Aegis M1: with SIP enabled, from macOS ${COPIED_PLATFORM_BINARY_KILLED_FROM_MACOS} copies are SIGKILLed by launch constraints (137)`, () => {
    // capability, not platform: this suite runs only where darwinFloor() holds (macOS 15+ AND SIP enabled)
    expect(macosMajor).toBeGreaterThanOrEqual(COPIED_PLATFORM_BINARY_KILLED_FROM_MACOS);
    for (const k of ['copied_launchctl_exit', 'copied_osascript_exit', 'copied_open_exit']) expect(out[k], k).toBe('137');
  });
  it('the session still works: worktree writes, child spawn and kill', () => {
    expect(out.write_work).toBe('ok');
    expect(out.child_spawn_kill).toBe('ok');
  });
  it('keys unreadable; ~/.gnomon, settings layers (incl. ~/.claude.json), CLAUDE*, linked folder and git hooks/config unwritable', () => {
    expect(out).toMatchObject({ read_keys: 'blocked', write_home: 'blocked', write_linked: 'blocked', write_user_claude: 'blocked', write_claude_json: 'blocked', write_project_claude: 'blocked', write_claude_md: 'blocked', write_git_hook: 'blocked', write_git_config: 'blocked' });
  });
  it('the endpoint port is denied, port+1 is not; the server saw nothing', () => {
    expect(out.port).toBe('EPERM');
    expect(out.port1).not.toBe('EPERM');
    expect(hits).toBe(0);
  });
  it('pgrep sees no process (sysmond deny); the screen socket dir is unreachable', () => {
    expect(out.pgrep_lines).toBe('0');
    expect(out.screen_sock).toBe('EPERM');
  });
  it('G-SBX-04 osascript, G-SBX-05 launchctl, G-SBX-06 open — and lsregister — cannot exec (P8-D80)', () => {
    for (const k of ['osascript_exit', 'launchctl_exit', 'open_exit', 'lsregister_exit']) expect(out[k], k).toBe('126');
  });
});
