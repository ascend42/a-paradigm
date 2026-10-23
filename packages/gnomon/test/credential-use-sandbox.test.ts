// @gnomon-platform: darwin
/**
 * Aegis round 3 H: under the session profile a session cannot USE the human's credentials without reading a file —
 * no connect to launchd's ssh-agent Listeners socket (/private/tmp/com.apple.launchd.*), a 1Password / Secretive agent
 * socket or any SSH_AUTH_SOCK the daemon names; no write in the launchd socket dirs; no run of the keychain credential
 * helper (git-credential-osxkeychain, any copy). The real host agent, when there is one, is tried with ssh-add: refused.
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { darwinFloor, KEYCHAIN_TOKEN_PARTIAL, sessionLaunchPlan } from '../src/kernel/sandbox/session.js';
import { buildSessionPolicy } from '../src/kernel/manifest/policy.js';
import { sessionWorld, type SessionWorld } from './session-helpers.js';

const OK = darwinFloor().ok;
let w: SessionWorld;
const servers: net.Server[] = [];
const launchdDir = `/private/tmp/com.apple.launchd.gnomontest${process.pid}`;
let agentSock = '';
let opSock = '';

const listen = (p: string): Promise<void> =>
  new Promise((res) => {
    const s = net.createServer((c) => c.end('agent'));
    servers.push(s);
    s.listen(p, () => res());
  });

beforeAll(async () => {
  if (!OK) return;
  w = sessionWorld();
  fs.mkdirSync(launchdDir, { mode: 0o700 });
  await listen(path.join(launchdDir, 'Listeners'));
  agentSock = path.join(w.root, 'named-agent.sock');
  await listen(agentSock);
  const op = path.join(w.userHome, 'Library', 'Group Containers', '2BUA8C4S2C.com.1password', 't');
  fs.mkdirSync(op, { recursive: true });
  opSock = path.join(op, 'agent.sock');
  await listen(opSock);
});
afterAll(async () => {
  for (const s of servers) await new Promise<void>((r) => s.close(() => r()));
  fs.rmSync(launchdDir, { recursive: true, force: true });
  w?.cleanup();
});

describe.runIf(OK)('credential use is denied under the session profile', () => {
  it('no agent socket, no launchd socket dir write, no keychain helper; the control socket in the root works', async () => {
    const control = path.join(w.cwd, 'control.sock');
    await listen(control);
    const policy = buildSessionPolicy({ home: w.home, cwd: w.cwd, userClaudeDir: path.join(w.userHome, '.claude'), userHome: w.userHome, managedSettingsPaths: [], linkedFolders: [], endpointPort: null });
    const conn = (n: string, p: string): string => `"${process.execPath}" -e "require('net').connect('${p}').on('connect',()=>{console.log('${n}=open');process.exit(0)}).on('error',(e)=>{console.log('${n}='+e.code);process.exit(0)})"`;
    const helper = ['/Applications/Xcode.app/Contents/Developer/usr/libexec/git-core/git-credential-osxkeychain', '/Library/Developer/CommandLineTools/usr/libexec/git-core/git-credential-osxkeychain', '/opt/homebrew/bin/git-credential-osxkeychain'].find((p) => fs.existsSync(p)) ?? '';
    const hostSock = process.env.SSH_AUTH_SOCK ?? '';
    const script = path.join(w.cwd, 'cred.sh');
    fs.writeFileSync(script, `#!/bin/bash
cd "${w.cwd}"
${conn('launchd', path.join(launchdDir, 'Listeners'))}
${conn('named', agentSock)}
${conn('onepassword', opSock)}
${conn('control', control)}
(echo x > "${launchdDir}/planted") 2>/dev/null && echo "launchd_write=allowed" || echo "launchd_write=blocked"
if [ -e "${helper}" ]; then (printf 'protocol=https\\nhost=github.com\\n\\n' | "${helper}" get) >/dev/null 2>&1; echo "keychain_helper_exit=$?"; cp "${helper}" ./git-credential-osxkeychain 2>/dev/null && (./git-credential-osxkeychain get </dev/null >/dev/null 2>&1; echo "keychain_copy_exit=$?"); fi
${hostSock ? `SSH_AUTH_SOCK="${hostSock}" /usr/bin/ssh-add -l >/dev/null 2>&1; echo "host_agent_exit=$?"` : ''}
`, { mode: 0o755 });
    const plan = sessionLaunchPlan({ policy, binaryReal: '/bin/bash', argv: [script], extras: { uid: process.getuid!(), tmpdir: os.tmpdir(), home: w.userHome, roots: [w.cwd], agentSockets: [agentSock] } }, 'darwin');
    expect(plan.partial).toContain(KEYCHAIN_TOKEN_PARTIAL);
    const r = spawnSync(plan.command, plan.args, { encoding: 'utf8', env: { HOME: w.userHome, PATH: '/usr/bin:/bin' }, timeout: 60_000 });
    const out = Object.fromEntries(r.stdout.split('\n').filter((l) => /^[a-z_]+=/.test(l)).map((l) => l.split('=') as [string, string]));
    expect(out.launchd).not.toBe('open');
    expect(out.named).not.toBe('open');
    expect(out.onepassword).not.toBe('open');
    expect(out.control).toBe('open');
    expect(out.launchd_write).toBe('blocked');
    // exec denied: the shell reports 126 (permission) — never a run that could reach the keychain
    if (helper) {
      expect(out.keychain_helper_exit).toBe('126');
      expect(out.keychain_copy_exit).toBe('126');
    }
    // the real host agent: ssh-add cannot reach it (2 = could not connect)
    if (hostSock) expect(out.host_agent_exit).toBe('2');
  }, 60_000);
});
