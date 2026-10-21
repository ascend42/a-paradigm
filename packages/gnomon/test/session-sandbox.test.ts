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
import { randomBytes } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { sessionLaunchPlan } from '../src/kernel/sandbox/session.js';
import { binaryDenies, ensureSessionEnvDir, ensureTranscriptDir } from '../src/kernel/supervisor/supervisor.js';
import { buildSessionPolicy, realpathLoose } from '../src/kernel/manifest/policy.js';
import { planSessionPath } from '../src/kernel/runner/env.js';
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
let pathPlan: { dirs: string[]; denies: string[] } = { dirs: [], denies: [] };
let sock: net.Server | null = null;
let homeSock: net.Server | null = null;
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
  // T-2026-10-18-010: a populated Gnomon home — the kernel log, a sibling session, the pin, this session's own dir, the exec'd copy
  // Aegis M1 (gui.open): the on-disk identity record a same-user gui.open caller presents, beside keys/device.key
  fs.writeFileSync(path.join(w.home, 'keys', 'identity.json'), '{}\n');
  for (const d of ['log/segments', 'sessions/own', 'sessions/sibling', 'bin']) fs.mkdirSync(path.join(w.home, ...d.split('/')), { recursive: true });
  for (const f of ['kernel.db', 'kernel.db-wal', 'log/segments/000001.db', 'sessions/sibling/session.key', 'sessions/own/policy.json', 'claude-pin.json']) fs.writeFileSync(path.join(w.home, ...f.split('/')), 'x\n');
  fs.writeFileSync(path.join(w.home, 'bin', 'claude-copy'), '#!/bin/sh\necho copy_ran\n', { mode: 0o755 });
  fs.writeFileSync(path.join(w.cwd, 'README.md'), 'project\n');
  homeSock = net.createServer((c) => {
    c.on('error', () => undefined);
    c.destroy();
  }); // spawnSync blocks this loop: the check waits for 'connect' (the backlog), never for data
  await new Promise<void>((r) => homeSock!.listen(path.join(w.home, 'gnomon.sock'), () => r()));
  const own = path.join(w.home, 'sessions', 'own');
  const bd = binaryDenies({ knownBinaries: ['~/.local/bin/claude'], managedSettings: [], managedSettingsDirs: [], managedUnscannable: [], userClaudeDir: '.claude' }, w.userHome, path.join(versions, '2.1.302'));
  // TD-2026-10-21-162: a user-writable Homebrew-shaped prefix and ~/.local/bin on the session PATH are write-denied
  const brew = path.join(w.root, 'brew');
  fs.mkdirSync(path.join(brew, 'Cellar', 'tool', '1', 'bin'), { recursive: true });
  fs.mkdirSync(path.join(brew, 'bin'));
  fs.writeFileSync(path.join(brew, 'Cellar', 'tool', '1', 'bin', 'tool'), '#!/bin/sh\necho tool_ran\n', { mode: 0o755 });
  fs.symlinkSync(path.join(brew, 'Cellar', 'tool', '1', 'bin', 'tool'), path.join(brew, 'bin', 'tool'));
  pathPlan = planSessionPath([path.join(w.userHome, '.local', 'bin'), path.join(brew, 'bin'), '/usr/bin'], { home: w.userHome });
  bd.push(...pathPlan.denies.map((p) => ({ path: realpathLoose(p), match: 'subpath' as const, class: 'persistence' as const })));
  const script = path.join(w.root, 'check.sh');
  fs.writeFileSync(
    script,
    `#!/bin/bash
cd "${w.cwd}"
echo hi > ./wrote.txt 2>/dev/null && echo "write_work=ok" || echo "write_work=fail"
(cat "${w.home}/keys/device.key") >/dev/null 2>&1 && echo "read_keys=allowed" || echo "read_keys=blocked"
(cat "${w.home}/keys/identity.json") >/dev/null 2>&1 && echo "read_identity=allowed" || echo "read_identity=blocked"
(/usr/bin/find "${w.home}/keys" -type f) >/dev/null 2>&1 && echo "find_keys=allowed" || echo "find_keys=blocked"
(echo x > "${w.home}/x") 2>/dev/null && echo "write_home=allowed" || echo "write_home=blocked"
(echo x > "${w.linked}/x") 2>/dev/null && echo "write_linked=allowed" || echo "write_linked=blocked"
(echo x > "${w.userHome}/.claude/settings.json") 2>/dev/null && echo "write_user_claude=allowed" || echo "write_user_claude=blocked"
(echo x > "${w.userHome}/.claude.json") 2>/dev/null && echo "write_claude_json=allowed" || echo "write_claude_json=blocked"
mkdir -p "${w.userHome}/.claude/projects/-enc-dir" 2>/dev/null && echo '{"a":1}' > "${w.userHome}/.claude/projects/-enc-dir/t.jsonl" 2>/dev/null && echo '{"b":2}' >> "${w.userHome}/.claude/projects/-enc-dir/t.jsonl" 2>/dev/null && echo "write_transcript=ok" || echo "write_transcript=fail"
(echo x > "${w.userHome}/.claude/plugins.json") 2>/dev/null && echo "write_claude_other=allowed" || echo "write_claude_other=blocked"
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
(echo x > "${w.userHome}/.local/bin/ls") 2>/dev/null && echo "write_local_bin=allowed" || echo "write_local_bin=blocked"
(/usr/bin/readlink "${w.userHome}/.local/bin/claude") >/dev/null 2>&1 && echo "read_local_bin=ok" || echo "read_local_bin=fail"
(echo x > "${brew}/bin/git") 2>/dev/null && echo "write_brew_bin=allowed" || echo "write_brew_bin=blocked"
(echo x > "${brew}/Cellar/tool/1/bin/tool") 2>/dev/null && echo "write_brew_cellar=allowed" || echo "write_brew_cellar=blocked"
"${brew}/bin/tool" 2>/dev/null | /usr/bin/grep -q tool_ran && echo "exec_brew=ok" || echo "exec_brew=fail"
/bin/cp /bin/launchctl "${w.root}/lc" 2>/dev/null; "${w.root}/lc" submit -l "${LABEL}" -- /usr/bin/touch "${MARKER}" >/dev/null 2>&1; echo "copied_launchctl_exit=$?"
${copiedOsascript(w.root)}
/bin/cp /usr/bin/open "${w.root}/op" 2>/dev/null; "${w.root}/op" -h >/dev/null 2>&1; echo "copied_open_exit=$?"
n=$(pgrep -fl . 2>/dev/null | wc -l | tr -d ' '); echo "pgrep_lines=$n"
sleep 30 & C=$!; if kill $C 2>/dev/null; then wait $C 2>/dev/null; echo "child_spawn_kill=ok"; else echo "child_spawn_kill=fail"; fi
/usr/bin/open -h >/dev/null 2>&1; echo "open_exit=$?"
(cat "${w.home}/kernel.db") >/dev/null 2>&1 && echo "read_kernel_db=allowed" || echo "read_kernel_db=blocked"
(cat "${w.home}/kernel.db-wal") >/dev/null 2>&1 && echo "read_kernel_wal=allowed" || echo "read_kernel_wal=blocked"
(cat "${w.home}/log/segments/000001.db") >/dev/null 2>&1 && echo "read_segment=allowed" || echo "read_segment=blocked"
(cat "${w.home}/sessions/sibling/session.key") >/dev/null 2>&1 && echo "read_sibling=allowed" || echo "read_sibling=blocked"
(/bin/ls "${w.home}/sessions") >/dev/null 2>&1 && echo "list_sessions=allowed" || echo "list_sessions=blocked"
(/bin/ls "${w.home}/keys") >/dev/null 2>&1 && echo "list_keys=allowed" || echo "list_keys=blocked"
(cat "${w.home}/claude-pin.json") >/dev/null 2>&1 && echo "read_pin=allowed" || echo "read_pin=blocked"
/bin/ln "${w.home}/keys/device.key" "${w.cwd}/k" 2>/dev/null && echo "hardlink_ln=ok" || echo "hardlink_ln=fail"
(cat "${w.cwd}/k") 2>/dev/null | /usr/bin/grep -q secret && echo "hardlink_key=allowed" || echo "hardlink_key=blocked"
/bin/ln "${w.home}/kernel.db" "${w.cwd}/kdb" 2>/dev/null; (cat "${w.cwd}/kdb") >/dev/null 2>&1 && echo "hardlink_db=allowed" || echo "hardlink_db=blocked"
(cat "${own}/policy.json") >/dev/null 2>&1 && echo "read_own=ok" || echo "read_own=fail"
"${process.execPath}" -e "try{require('fs').realpathSync('${own}/policy.json');console.log('realpath_own=ok')}catch(e){console.log('realpath_own='+e.code)}"
"${w.home}/bin/claude-copy" 2>/dev/null | /usr/bin/grep -q copy_ran && echo "exec_copy=ok" || echo "exec_copy=fail"
(cat "${w.cwd}/README.md") >/dev/null 2>&1 && echo "read_project=ok" || echo "read_project=fail"
"${process.execPath}" -e "require('net').connect('${path.join(w.home, 'gnomon.sock')}').on('connect',()=>{console.log('home_sock=open');process.exit(0)}).on('error',e=>{console.log('home_sock='+e.code);process.exit(0)})"
/usr/bin/osascript -e 'return 1' >/dev/null 2>&1; echo "osascript_exit=$?"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -h >/dev/null 2>&1; echo "lsregister_exit=$?"
/bin/launchctl list >/dev/null 2>&1; echo "launchctl_exit=$?"
`,
    { mode: 0o755 },
  );
  ensureTranscriptDir(path.join(w.userHome, '.claude')); // the supervisor creates the transcript dir before the spawn (Aegis M1: the session cannot create, remove or swap it)
  const plan = sessionLaunchPlan({ policy: worldPolicy(w, port, bd, [{ path: own, match: 'subpath' }, { path: path.join(w.home, 'bin', 'claude-copy'), match: 'literal' }], { claudeTranscripts: true }), binaryReal: '/bin/bash', argv: [script], extras: { uid: process.getuid!(), tmpdir: os.tmpdir(), home: w.userHome, roots: [w.cwd] } }, 'darwin');
  const r = spawnSync(plan.command, plan.args, { encoding: 'utf8', env: { HOME: w.userHome, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, timeout: 60_000 });
  out = Object.fromEntries(r.stdout.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
}, 90_000);

afterAll(async () => {
  spawnSync('/bin/launchctl', ['remove', LABEL]); // in case a submit ever got through
  server?.close();
  await new Promise<void>((r) => (sock ? sock.close(() => r()) : r()));
  await new Promise<void>((r) => (homeSock ? homeSock.close(() => r()) : r()));
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
  it('TD-2026-10-21-162: ~/.local/bin and a user-writable Homebrew prefix on the session PATH are unwritable; read and exec still work', () => {
    expect(pathPlan.denies).toEqual(expect.arrayContaining([fs.realpathSync.native(path.join(w.root, 'brew'))]));
    expect(out).toMatchObject({ write_local_bin: 'blocked', read_local_bin: 'ok', write_brew_bin: 'blocked', write_brew_cellar: 'blocked', exec_brew: 'ok' });
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
  it('T-2026-10-18-010: keys, the kernel log (kernel.db, its WAL, sealed segments), a sibling session dir and the rest of the home are unreadable (EPERM)', () => {
    expect(out).toMatchObject({ read_keys: 'blocked', list_keys: 'blocked', read_kernel_db: 'blocked', read_kernel_wal: 'blocked', read_segment: 'blocked', read_sibling: 'blocked', list_sessions: 'blocked', read_pin: 'blocked' });
  });
  it('Aegis M1 (gui.open): a session cannot read the on-disk device key or identity a same-user gui.open caller would need (keys/ read-denied)', () => {
    // gui.open mints a GUI session for any same-user holder of this home's device key; the session sandbox denying keys/ is the boundary
    expect(out).toMatchObject({ read_keys: 'blocked', read_identity: 'blocked', find_keys: 'blocked', list_keys: 'blocked' });
  });
  it('Aegis C4: a HARDLINK of a key (or kernel.db) into the worktree cannot be read (it fails at the ln or the cat)', ({ annotate }) => {
    void annotate(`hardlink_ln=${out.hardlink_ln}`);
    expect(out.hardlink_key).toBe('blocked');
    expect(out.hardlink_db).toBe('blocked');
  });
  it('T-2026-10-18-010: the session still reads its own dir (and realpaths it), execs its private copy, reads the project root and reaches GNOMON_SOCK', () => {
    expect(out).toMatchObject({ read_own: 'ok', realpath_own: 'ok', exec_copy: 'ok', read_project: 'ok', home_sock: 'open' });
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

describe.skipIf(!SANDBOX_OK)('TD-2026-10-19-814 item 1: Claude Code transcripts are writable, the rest of ~/.claude is not (darwin, macOS 15+, SIP enabled; probe p-resume)', () => {
  it('world home: a transcript under ~/.claude/projects is created and appended; ~/.claude/settings.json, ~/.claude.json and another ~/.claude file stay unwritable', () => {
    expect(out).toMatchObject({ write_transcript: 'ok', write_user_claude: 'blocked', write_claude_json: 'blocked', write_claude_other: 'blocked' });
    expect(fs.readFileSync(path.join(w.userHome, '.claude', 'projects', '-enc-dir', 't.jsonl'), 'utf8')).toBe('{"a":1}\n{"b":2}\n');
  });

  // the REAL $HOME (the path Claude Code writes): only uniquely named temp entries, removed after; no real ~/.claude file is touched
  const realHome = fs.realpathSync(os.homedir());
  const realClaude = path.join(realHome, '.claude');
  const tag = `gnomon-sbx-probe-${process.pid}-${randomBytes(6).toString('hex')}`;
  const probeDir = path.join(realClaude, 'projects', tag);
  const probeDenied = path.join(realClaude, tag);
  const created: string[] = [];
  let x: SessionWorld | null = null;
  afterEach(() => {
    fs.rmSync(probeDir, { recursive: true, force: true });
    fs.rmSync(probeDenied, { recursive: true, force: true });
    for (const d of created.reverse()) {
      try {
        fs.rmdirSync(d); // only dirs THIS test made, and only if still empty
      } catch {
        /* not empty: something else wrote there since; leave it */
      }
    }
    created.length = 0;
    x?.cleanup();
    x = null;
  });
  it('real $HOME: a sandboxed process creates and appends $HOME/.claude/projects/<unique>/t.jsonl; $HOME/.claude/<unique> is refused', () => {
    for (const d of [realClaude, path.join(realClaude, 'projects')]) {
      if (!fs.existsSync(d)) {
        fs.mkdirSync(d); // a CI runner without ~/.claude: the kernel's world, minus Claude Code having run once
        created.push(d);
      }
    }
    x = sessionWorld();
    const policy = worldPolicy(x, null, [], [], { claudeTranscripts: true, userClaudeDir: realClaude });
    expect(policy.allowWrite.map((a) => a.path)).toEqual([path.join(realClaude, 'projects')]);
    const script = path.join(x.root, 'transcripts.sh');
    fs.writeFileSync(
      script,
      `#!/bin/bash
mkdir "${probeDir}" 2>/dev/null && echo '{"a":1}' > "${probeDir}/t.jsonl" 2>/dev/null && echo '{"b":2}' >> "${probeDir}/t.jsonl" 2>/dev/null && echo "real_transcript=ok" || echo "real_transcript=fail"
(echo x > "${probeDenied}") 2>/dev/null && echo "real_claude_other=allowed" || echo "real_claude_other=blocked"
`,
      { mode: 0o755 },
    );
    const plan = sessionLaunchPlan({ policy, binaryReal: '/bin/bash', argv: [script], extras: { uid: process.getuid!(), tmpdir: os.tmpdir(), home: realHome, roots: [x.cwd] } }, 'darwin');
    const r = spawnSync(plan.command, plan.args, { encoding: 'utf8', env: { HOME: realHome, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, timeout: 30_000 });
    const res = Object.fromEntries(r.stdout.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    expect(res).toMatchObject({ real_transcript: 'ok', real_claude_other: 'blocked' });
    expect(fs.readFileSync(path.join(probeDir, 't.jsonl'), 'utf8')).toBe('{"a":1}\n{"b":2}\n');
    expect(fs.existsSync(probeDenied)).toBe(false);
  });
});

/**
 * Aegis findings on the transcript carve-back (TD-2026-10-19-814), ENFORCED. Every destructive step (rm -rf, swap,
 * hardlinks to settings) runs against a THROWAWAY user home (sessionWorld), never the real ~/.claude.
 */
describe.skipIf(!SANDBOX_OK)('TD-2026-10-19-814 Aegis M1/M2/L3/L4: the carve-back reopens transcripts and nothing else (darwin, macOS 15+, SIP enabled; throwaway user home)', () => {
  let t: SessionWorld | null = null;
  afterEach(() => {
    t?.cleanup();
    t = null;
  });
  /** run `body` under the generated profile of a Claude session whose memory chain tops at the throwaway user home (the production shape) */
  const run = (x: SessionWorld, body: string): Record<string, string> => {
    const claudeDir = path.join(x.userHome, '.claude');
    const policy = buildSessionPolicy({ home: x.home, cwd: x.cwd, userClaudeDir: claudeDir, userHome: x.userHome, managedSettingsPaths: [], linkedFolders: [], endpointPort: null, memorySubtree: x.userHome, claudeTranscripts: true });
    expect(policy.allowWrite.map((a) => a.path)).toEqual([path.join(claudeDir, 'projects')]);
    const script = path.join(x.root, 'aegis.sh');
    fs.writeFileSync(script, `#!/bin/bash\ncd "${x.userHome}"\n${body}\n`, { mode: 0o755 });
    const plan = sessionLaunchPlan({ policy, binaryReal: '/bin/bash', argv: [script], extras: { uid: process.getuid!(), tmpdir: os.tmpdir(), home: x.userHome, roots: [x.cwd] } }, 'darwin');
    const r = spawnSync(plan.command, plan.args, { encoding: 'utf8', env: { HOME: x.userHome, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, timeout: 30_000 });
    return Object.fromEntries(r.stdout.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  };
  const seed = (x: SessionWorld): { settings: string; claudeJson: string; projects: string } => {
    const settings = path.join(x.userHome, '.claude', 'settings.json');
    const claudeJson = path.join(x.userHome, '.claude.json');
    fs.writeFileSync(settings, '{"orig":true}\n');
    fs.writeFileSync(claudeJson, '{"orig":true}\n');
    ensureTranscriptDir(path.join(x.userHome, '.claude')); // as the supervisor does before the spawn
    return { settings, claudeJson, projects: path.join(x.userHome, '.claude', 'projects') };
  };

  it('with the memory chain topped at the user home, a transcript is still created and appended (the re-rooted steering re-deny does not re-close it)', () => {
    t = sessionWorld();
    const { projects } = seed(t);
    const res = run(t, `mkdir -p .claude/projects/-enc && echo '{"a":1}' > .claude/projects/-enc/t.jsonl && echo '{"b":2}' >> .claude/projects/-enc/t.jsonl && echo "transcript=ok" || echo "transcript=fail"
mkdir -p .claude/projects/-enc/memory && echo m > .claude/projects/-enc/memory/MEMORY.md && echo "memory=ok" || echo "memory=fail"
(echo x > .claude/projects/-enc/CLAUDE.md) 2>/dev/null && echo "steer_md=allowed" || echo "steer_md=blocked"
(mkdir -p .claude/projects/-enc/.claude && echo x > .claude/projects/-enc/.claude/settings.json) 2>/dev/null && echo "steer_dir=allowed" || echo "steer_dir=blocked"`);
    expect(res).toMatchObject({ transcript: 'ok', memory: 'ok', steer_md: 'blocked', steer_dir: 'blocked' });
    expect(fs.readFileSync(path.join(projects, '-enc', 't.jsonl'), 'utf8')).toBe('{"a":1}\n{"b":2}\n');
  });

  it('M1: rm -rf ~/.claude/projects cannot remove the dir itself', () => {
    t = sessionWorld();
    const { projects } = seed(t);
    fs.mkdirSync(path.join(projects, '-other'));
    const res = run(t, `rm -rf .claude/projects 2>/dev/null; echo "rm_exit=$?"; rmdir .claude/projects 2>/dev/null && echo "rmdir=allowed" || echo "rmdir=blocked"`);
    expect(res.rm_exit).not.toBe('0');
    expect(res.rmdir).toBe('blocked');
    expect(fs.lstatSync(projects).isDirectory()).toBe(true);
  });

  it('M1: ~/.claude/projects cannot be renamed aside and replaced by a symlink', () => {
    t = sessionWorld();
    const { projects } = seed(t);
    const res = run(t, `mv .claude/projects .claude/projects.old 2>/dev/null && echo "mv=allowed" || echo "mv=blocked"
(mv .claude/projects .claude/projects.old && ln -s "${t.userHome}" .claude/projects) 2>/dev/null && echo "swap=allowed" || echo "swap=blocked"
(rm -rf .claude/projects; ln -s "${t.userHome}" .claude/projects) 2>/dev/null; [ -L .claude/projects ] && echo "swapped=yes" || echo "swapped=no"`);
    expect(res).toMatchObject({ mv: 'blocked', swap: 'blocked', swapped: 'no' });
    expect(fs.lstatSync(projects).isDirectory()).toBe(true);
    expect(fs.existsSync(`${projects}.old`)).toBe(false);
  });

  it('M2: a hardlink to ~/.claude/settings.json or ~/.claude.json cannot be planted in projects (link(2) is checked against the write-denied SOURCE); nothing is written through', () => {
    t = sessionWorld();
    const { settings, claudeJson, projects } = seed(t);
    fs.mkdirSync(path.join(projects, 'x'));
    const res = run(t, `ln .claude/settings.json .claude/projects/x/s 2>/dev/null && echo "link_settings=allowed" || echo "link_settings=blocked"
echo pwned >> .claude/projects/x/s 2>/dev/null
ln .claude.json .claude/projects/x/j 2>/dev/null && echo "link_claude_json=allowed" || echo "link_claude_json=blocked"
echo pwned >> .claude/projects/x/j 2>/dev/null; echo "done=1"`);
    expect(res).toMatchObject({ link_settings: 'blocked', link_claude_json: 'blocked', done: '1' });
    expect(fs.readFileSync(settings, 'utf8')).toBe('{"orig":true}\n');
    expect(fs.readFileSync(claudeJson, 'utf8')).toBe('{"orig":true}\n');
    expect(fs.statSync(settings).nlink).toBe(1);
    expect(fs.statSync(claudeJson).nlink).toBe(1);
  });

  it('L4: a symlink made after launch (projects/x -> ~/.claude) and projects/../settings.json both stay denied', () => {
    t = sessionWorld();
    const { settings } = seed(t);
    const res = run(t, `ln -s "${path.join(t.userHome, '.claude')}" .claude/projects/x 2>/dev/null && echo "mklink=ok" || echo "mklink=fail"
(echo pwned > .claude/projects/x/settings.json) 2>/dev/null && echo "via_link=allowed" || echo "via_link=blocked"
(echo pwned > .claude/projects/../settings.json) 2>/dev/null && echo "dotdot=allowed" || echo "dotdot=blocked"`);
    expect(res).toMatchObject({ mklink: 'ok', via_link: 'blocked', dotdot: 'blocked' });
    expect(fs.readFileSync(settings, 'utf8')).toBe('{"orig":true}\n');
  });
});

/**
 * The ~/.claude/session-env carve-back (hooks fix, 2026-10-21). Claude Code mkdirs `session-env/<session-id>/`
 * before running ANY command hook; under the ~/.claude write deny every SessionStart/Stop hook failed with
 * `EPERM: operation not permitted, mkdir '~/.claude/session-env/<id>'`. Same pattern as the transcript carve-back:
 * the subpath is writable, its root is literal re-denied, the rest of ~/.claude stays denied.
 */
describe.skipIf(!SANDBOX_OK)('session-env carve-back: Claude Code hooks can run, the rest of ~/.claude stays denied (darwin, macOS 15+, SIP enabled; throwaway user home)', () => {
  let t: SessionWorld | null = null;
  afterEach(() => {
    t?.cleanup();
    t = null;
  });
  const run = (x: SessionWorld, body: string): Record<string, string> => {
    const claudeDir = path.join(x.userHome, '.claude');
    const policy = buildSessionPolicy({ home: x.home, cwd: x.cwd, userClaudeDir: claudeDir, userHome: x.userHome, managedSettingsPaths: [], linkedFolders: [], endpointPort: null, memorySubtree: x.userHome, claudeTranscripts: true, claudeSessionEnv: true });
    expect(policy.allowWrite.map((a) => a.path).sort()).toEqual([path.join(claudeDir, 'projects'), path.join(claudeDir, 'session-env')].sort());
    expect(policy.denyWriteAlways).toContainEqual({ path: path.join(claudeDir, 'session-env'), match: 'literal', class: 'session-env' });
    expect(policy.sessionEnvRefused).toBeUndefined();
    const script = path.join(x.root, 'session-env.sh');
    fs.writeFileSync(script, `#!/bin/bash\ncd "${x.userHome}"\n${body}\n`, { mode: 0o755 });
    const plan = sessionLaunchPlan({ policy, binaryReal: '/bin/bash', argv: [script], extras: { uid: process.getuid!(), tmpdir: os.tmpdir(), home: x.userHome, roots: [x.cwd] } }, 'darwin');
    const r = spawnSync(plan.command, plan.args, { encoding: 'utf8', env: { HOME: x.userHome, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, timeout: 30_000 });
    return Object.fromEntries(r.stdout.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  };

  it('mkdir ~/.claude/session-env/<id> and a file in it succeed; ~/.claude/settings.json and ~/.claude.json stay unwritable', () => {
    t = sessionWorld();
    const claudeDir = path.join(t.userHome, '.claude');
    const settings = path.join(claudeDir, 'settings.json');
    fs.writeFileSync(settings, '{"orig":true}\n');
    fs.writeFileSync(path.join(t.userHome, '.claude.json'), '{"orig":true}\n');
    ensureSessionEnvDir(claudeDir); // as the supervisor does before the spawn
    const res = run(t, `mkdir -p .claude/session-env/4f9ede20 2>/dev/null && echo "x=1" > .claude/session-env/4f9ede20/env 2>/dev/null && echo "session_env=ok" || echo "session_env=fail"
(echo pwned > .claude/settings.json) 2>/dev/null && echo "settings=allowed" || echo "settings=blocked"
(echo pwned > .claude.json) 2>/dev/null && echo "claude_json=allowed" || echo "claude_json=blocked"
(echo pwned > .claude/session-env/../settings.json) 2>/dev/null && echo "dotdot=allowed" || echo "dotdot=blocked"`);
    expect(res).toMatchObject({ session_env: 'ok', settings: 'blocked', claude_json: 'blocked', dotdot: 'blocked' });
    expect(fs.readFileSync(path.join(claudeDir, 'session-env', '4f9ede20', 'env'), 'utf8')).toBe('x=1\n');
    expect(fs.readFileSync(settings, 'utf8')).toBe('{"orig":true}\n');
  });

  it('the session-env root cannot be removed, renamed or swapped for a symlink (literal re-deny, as for projects)', () => {
    t = sessionWorld();
    const sessionEnv = path.join(t.userHome, '.claude', 'session-env');
    ensureSessionEnvDir(path.join(t.userHome, '.claude'));
    const res = run(t, `rmdir .claude/session-env 2>/dev/null && echo "rmdir=allowed" || echo "rmdir=blocked"
mv .claude/session-env .claude/se.old 2>/dev/null && echo "mv=allowed" || echo "mv=blocked"
(rm -rf .claude/session-env; ln -s "${t.userHome}" .claude/session-env) 2>/dev/null; [ -L .claude/session-env ] && echo "swapped=yes" || echo "swapped=no"`);
    expect(res).toMatchObject({ rmdir: 'blocked', mv: 'blocked', swapped: 'no' });
    expect(fs.lstatSync(sessionEnv).isDirectory()).toBe(true);
  });
});
