// p10m-claude-compat-generated — M1.7's re-run of p10m-claude-compat against the GENERATED `session` profile
// (spec §15.5, §19.1 M1.7, P8-D80; T-2026-10-18-008). Unlike p10m-claude-compat (a hand-written profile), the
// profile here is produced by the kernel from the M1.5 SessionPolicy (dist/: manifestLoader.buildSessionPolicy →
// sessionSandbox.sessionLaunchPlan), so it carries EVERY session deny: ~/.gnomon keys, writes to the whole
// ~/.claude/** and ~/.claude.json, project .claude/** + CLAUDE*, git hooks/config/info, a linked folder, the
// endpoint port, process-info + sysmond, tmux/screen sockets, AppleEvents, mic/camera, and the open/osascript/
// lsregister/launchctl exec denies. claude runs with the ADAPTER's real argv (stream-json in/out,
// --permission-mode default, --permission-prompts none, --settings policy.json, --strict-mcp-config); the
// policy.json is claudePermissions(policy) plus ONE allow rule for `bash check.sh` so the Bash tool can run.
// Ground truth is out.txt written by check.sh. Costs one short turn on the founder's subscription.
// Requires `npm run build` (dist/). Writes nothing under ~/.claude except one probe file the check tries to
// create (removed afterwards if the deny failed).
import { spawn } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const specRefs = ['§15.5 session profile', '§19.1 M1.7', 'P8-D80', 'G-SBX-04', 'G-SBX-06', 'G-SBX-08', 'T-2026-10-18-008'];

const HERE = path.dirname(new URL(import.meta.url).pathname);
const CLAUDE = [path.join(os.homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].find(existsSync);

function parseOut(file) {
  if (!existsSync(file)) return null;
  const kv = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([a-z_]+)=(.*)$/);
    if (m) kv[m[1]] = m[2].trim();
  }
  return kv;
}

export default async function probe() {
  if (!CLAUDE) return { verdict: 'fail', evidence: { error: 'claude binary not found' } };
  const dist = path.join(HERE, '..', '..', 'dist', 'index.js');
  if (!existsSync(dist)) return { verdict: 'fail', evidence: { error: 'dist/ missing: npm run build first' } };
  const g = await import(pathToFileURL(dist).href);
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-p10m-gen-')));
  let hits = 0;
  const server = http.createServer((_q, s) => { hits++; s.end('gnomon-endpoint-standin'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const claudeDir = path.join(os.homedir(), '.claude');
  const claudeProbeFile = path.join(claudeDir, `.gnomon-p10m-write-${process.pid}`);
  try {
    const home = path.join(root, 'gnomon-home');
    const work = path.join(root, 'work');
    const linked = path.join(root, 'linked-mod');
    for (const d of [home, path.join(home, 'keys'), work, path.join(work, '.claude'), linked]) mkdirSync(d, { recursive: true });
    writeFileSync(path.join(home, 'keys', 'device.key'), 'secret');
    // round 2 (Aegis H1/M2): the kernel runs a PRIVATE COPY of the verified claude bytes from <home>/bin (write-denied),
    // and the profile write-denies the binary, its versions dir, its known-location links and the persistence paths
    const claudeReal = realpathSync(CLAUDE);
    mkdirSync(path.join(home, 'bin'), { recursive: true });
    const privateCopy = path.join(home, 'bin', 'claude-probe');
    copyFileSync(claudeReal, privateCopy);
    chmodSync(privateCopy, 0o500);
    const extraDenyWrite = g.binaryDenies(g.CLAUDE_CODE_PLATFORMS.darwin, os.homedir(), claudeReal);
    const policy = g.manifestLoader.buildSessionPolicy({ home, cwd: work, userClaudeDir: claudeDir, userHome: os.homedir(), managedSettingsPaths: [], linkedFolders: [linked], endpointPort: port, extraDenyWrite, homeReadable: [{ path: privateCopy, match: 'literal' }] }); // T-2026-10-18-010: the home is read-denied but the exec'd copy
    const perms = g.manifestLoader.claudePermissions(policy);
    const policyPath = path.join(root, 'policy.json');
    const mcpPath = path.join(root, 'mcp.json');
    writeFileSync(policyPath, JSON.stringify({ permissions: { ...perms.permissions, allow: ['Bash(bash check.sh)'] } }));
    writeFileSync(mcpPath, JSON.stringify({ mcpServers: {} }));
    writeFileSync(path.join(work, 'check.sh'), `#!/bin/bash
{
echo "node=$(node --version 2>&1 | head -1)"
echo "git=$(git --version 2>&1 | head -1)"
echo hi > ./wrote.txt 2>/dev/null && echo "write_work=ok" || echo "write_work=fail"
(echo x > "${linked}/x.txt") 2>/dev/null && echo "write_linked=allowed" || echo "write_linked=blocked"
(echo x > "${claudeProbeFile}") 2>/dev/null && echo "write_user_claude=allowed" || echo "write_user_claude=blocked"
(echo x > "${work}/.claude/settings.json") 2>/dev/null && echo "write_project_claude=allowed" || echo "write_project_claude=blocked"
(cat "${home}/keys/device.key") >/dev/null 2>&1 && echo "read_keys=allowed" || echo "read_keys=blocked"
sleep 30 & C=$!; if kill $C 2>/dev/null; then wait $C 2>/dev/null; echo "child_spawn_kill=ok"; else echo "child_spawn_kill=fail"; fi
code=$(curl -s -m 3 -o /dev/null -w "%{http_code}" http://127.0.0.1:${port}/ 2>/dev/null); echo "port_http=\${code:-none} curl_exit=$?"
n=$(pgrep -fl . 2>/dev/null | wc -l | tr -d ' '); echo "pgrep_lines=$n"
/usr/bin/open -h >/dev/null 2>&1; echo "open_exit=$?"
/usr/bin/osascript -e 'return 1' >/dev/null 2>&1; echo "osascript_exit=$?"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -h >/dev/null 2>&1; echo "lsregister_exit=$?"
/bin/launchctl list >/dev/null 2>&1; echo "launchctl_exit=$?"
(echo x >> "${claudeReal}") 2>/dev/null && echo "write_claude_binary=allowed" || echo "write_claude_binary=blocked"
(echo x >> "$HOME/.zshrc") 2>/dev/null && echo "write_zshrc=allowed" || echo "write_zshrc=blocked"
/bin/cp /bin/launchctl ./lc 2>/dev/null; ./lc list >/dev/null 2>&1; echo "copied_launchctl_exit=$?"
python3 -c "print('py_ok')" 2>/dev/null | sed 's/^/python=/' || echo "python=fail"
} 2>&1 | tee out.txt
`);
    const argv = g.claudeAdapter.buildClaudeArgv({ uuid: randomUUID(), policyPath, mcpConfigPath: mcpPath, settingSources: ['user', 'project', 'local'], extra: ['--max-turns', '8'] });
    const plan = g.sessionSandbox.sessionLaunchPlan({ policy, binaryReal: privateCopy, argv, extras: { uid: process.getuid(), tmpdir: os.tmpdir(), home: os.homedir(), roots: [work] } });
    const t0 = Date.now();
    const lines = [];
    const exit = await new Promise((resolve) => {
      const child = spawn(plan.command, plan.args, { cwd: work, env: { HOME: os.homedir(), USER: os.userInfo().username, PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: process.env.LANG ?? 'en_US.UTF-8', TMPDIR: os.tmpdir(), SHELL: '/bin/bash' }, stdio: ['pipe', 'pipe', 'pipe'] });
      let buf = '';
      let stderr = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (c) => {
        buf += c;
        for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
          const l = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (!l.trim()) continue;
          lines.push(l);
          try { if (JSON.parse(l).type === 'result') child.stdin.end(); } catch { /* tolerant */ }
        }
      });
      child.stderr.on('data', (c) => { stderr += c; });
      child.stdin.write(g.claudeAdapter.userMessageLine('Run exactly this command with your Bash tool: bash check.sh — then reply with its output verbatim and nothing else.'));
      const timer = setTimeout(() => child.kill('SIGKILL'), 240_000);
      child.on('exit', (code, sig) => { clearTimeout(timer); resolve({ code, sig, stderrTail: stderr.slice(-1500) }); });
    });
    const parsed = lines.map((l) => g.claudeAdapter.parseStreamLine(l));
    const result = parsed.find((e) => e.kind === 'result') ?? null;
    const init = parsed.find((e) => e.kind === 'init') ?? null;
    const c = parseOut(path.join(work, 'out.txt')) ?? {};
    const userClaudeWritten = existsSync(claudeProbeFile);
    if (userClaudeWritten) rmSync(claudeProbeFile, { force: true });
    const claudeWorks = exit.code === 0 && result !== null && result.isError === false && Object.keys(c).length > 0;
    const bashWorks = c.write_work === 'ok' && c.child_spawn_kill === 'ok' && /^v\d/.test(c.node ?? '');
    const execDenied = ['open_exit', 'osascript_exit', 'lsregister_exit', 'launchctl_exit', 'copied_launchctl_exit'].every((k) => c[k] !== undefined && c[k] !== '0');
    const deniesHold = hits === 0 && (c.port_http ?? '').startsWith('000') && c.write_linked === 'blocked' && c.write_user_claude === 'blocked' && !userClaudeWritten &&
      c.write_project_claude === 'blocked' && c.read_keys === 'blocked' && c.write_claude_binary === 'blocked' && c.write_zshrc === 'blocked' && Number(c.pgrep_lines ?? '1') === 0 && execDenied;
    const verdict = claudeWorks && bashWorks && deniesHold ? 'pass' : claudeWorks ? 'partial' : 'fail';
    return {
      verdict,
      evidence: {
        claudeBinary: CLAUDE.replace(os.homedir(), '~'),
        criteria: { claudeWorks, bashWorks, deniesHold, execDenied },
        ms: Date.now() - t0,
        exit,
        init: init ? { apiKeySource: init.apiKeySource, model: init.model } : null,
        result,
        eventKinds: [...new Set(parsed.map((e) => e.type))],
        check: c,
        endpointHitsDuringRun: hits,
        profileHash: plan.profileHash,
        profile: plan.profile.replaceAll(root, '<tmp>').replaceAll(os.homedir(), '~'),
        notes: [
          'claude ran with the adapter argv (stream-json) and NO per-session CLAUDE_CONFIG_DIR: a custom CLAUDE_CONFIG_DIR loses subscription auth (auth status: loggedIn false, authMethod none — the OAuth keychain item is keyed by the config dir), so it is not used.',
          'round 2: claude ran as a PRIVATE COPY under <gnomon home>/bin with the binary, versions dir, known-location links and user persistence paths (rc files, ~/.ssh, LaunchAgents, git config) write-denied.',
          'ps is not tested (setuid; fails under any sandbox-exec profile).',
          'Ground truth is out.txt written by check.sh, not the model reply.',
          'copied-launcher protection depends on SIP enabled + macOS 15+ + Apple\'s per-binary launch-constraint coverage (spec §A.2(iv)); re-run on every macOS update (the revisit trigger).',
          'The earlier copied-osascript check (`tell application "System Events" to get name`, test/session-sandbox.test.ts; CI runs 39100281741, 39100811385 "reached System Events") PROVED NOTHING: AppleScript answers `get name` without sending an AppleEvent (measured 2026-10-17: stock osascript returns it under a deny-all mach-lookup profile). Its exit is recorded, never asserted; non-Apple AppleEvent senders are spec OPEN 5.',
        ],
      },
    };
  } finally {
    server.close();
    if (existsSync(claudeProbeFile)) rmSync(claudeProbeFile, { force: true });
    rmSync(root, { recursive: true, force: true });
  }
}
