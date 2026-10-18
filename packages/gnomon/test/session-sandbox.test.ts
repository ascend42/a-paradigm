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
import { sessionWorld, worldPolicy, type SessionWorld } from './session-helpers.js';

let w: SessionWorld;
let server: http.Server;
let port = 0;
let hits = 0;
let out: Record<string, string> = {};
let sock: net.Server | null = null;
let createdScreenDir = false;
const screenDir = path.join(fs.realpathSync(os.tmpdir()), '.screen');
const sockPath = path.join(screenDir, `gnomon-test-${process.pid}`);

beforeAll(async () => {
  w = sessionWorld();
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
n=$(pgrep -fl . 2>/dev/null | wc -l | tr -d ' '); echo "pgrep_lines=$n"
sleep 30 & C=$!; if kill $C 2>/dev/null; then wait $C 2>/dev/null; echo "child_spawn_kill=ok"; else echo "child_spawn_kill=fail"; fi
/usr/bin/open -h >/dev/null 2>&1; echo "open_exit=$?"
/usr/bin/osascript -e 'return 1' >/dev/null 2>&1; echo "osascript_exit=$?"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -h >/dev/null 2>&1; echo "lsregister_exit=$?"
/bin/launchctl list >/dev/null 2>&1; echo "launchctl_exit=$?"
`,
    { mode: 0o755 },
  );
  const plan = sessionLaunchPlan({ policy: worldPolicy(w, port), binaryReal: '/bin/bash', argv: [script], extras: { uid: process.getuid!(), tmpdir: os.tmpdir(), home: w.userHome, roots: [w.cwd] } }, 'darwin');
  const r = spawnSync(plan.command, plan.args, { encoding: 'utf8', env: { HOME: w.userHome, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }, timeout: 60_000 });
  out = Object.fromEntries(r.stdout.split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
}, 90_000);

afterAll(async () => {
  server?.close();
  await new Promise<void>((r) => (sock ? sock.close(() => r()) : r()));
  fs.rmSync(sockPath, { force: true });
  if (createdScreenDir) fs.rmSync(screenDir, { recursive: true, force: true });
  w?.cleanup();
});

describe('G-SBX-08 the generated session profile holds (darwin)', () => {
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
