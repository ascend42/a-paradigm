// p10m-write-allow — T-2026-10-23-004 + Aegis round 2 (L4): session file writes DENY BY DEFAULT, measured on real
// Claude Code (the founder's subscription and home, so auth works) under the generated session profile exactly as the
// supervisor builds it: transcripts + session-env carve-backs, a Gnomon-made 0700 TMPDIR and per-repo tool cache
// (sessionScratchDirs, SESSION_CACHE_ENV), CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1. Each run is one cheap haiku turn
// with a Bash tool call (`npm --version` and a write to ~/gnomon-probe-denied.txt), a stdio MCP server (a tiny node
// server, spawned by Claude inside the sandbox) and a SessionStart command hook (writes into $TMPDIR); then the same
// session is --resume'd for a second turn.
//   AUDIT   the same profile with the default-deny lines removed, and a filesystem snapshot (files newer than a marker
//           under the home and the temp dirs): the MEASURED set of paths a session writes outside the allowlist.
//   ENFORCE the real profile: both turns succeed, the transcript is written, the MCP server connects, the hook runs,
//           and the control write is denied.
// (sandbox-exec denials are not reported to the unified log, measured 2026-10-23, so the audit run is the measurement.)
// Run: npx tsx probes/run.mjs p10m-write-allow --timeout 600000
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mintHsid } from '@a-company/gnomon-contracts';
import { buildSessionPolicy, claudePermissions, SESSION_CACHE_ENV } from '../../src/kernel/manifest/policy.ts';
import { sessionLaunchPlan } from '../../src/kernel/sandbox/session.ts';
import { claudeTmpDirs, ensureSessionEnvDir, ensureTranscriptDir, sessionScratchDirs } from '../../src/kernel/supervisor/supervisor.ts';
import { repoKeyOf } from '../../src/kernel/supervisor/repo-hooks.ts';

export const specRefs = ['§15.5 session profile', 'T-2026-10-23-004 deny-by-default writes', 'Aegis round 2 L4'];

const CLAUDE = [path.join(os.homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude'].find(existsSync);
const PRUNE = ['Library/Containers', 'Library/Group Containers', 'Library/Mail', 'Library/Messages', '.Trash', 'Library/Biome', 'Library/Metadata', 'Library/Daemon Containers', 'Documents', 'Pictures', 'Music', 'Movies'];
const MCP_SERVER = `process.stdin.setEncoding('utf8');let b='';process.stdin.on('data',(d)=>{b+=d;let i;while((i=b.indexOf('\\n'))>=0){const l=b.slice(0,i);b=b.slice(i+1);let m;try{m=JSON.parse(l)}catch{continue}if(m.id===undefined)continue;const r=m.method==='initialize'?{protocolVersion:m.params?.protocolVersion??'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'probe',version:'1'}}:m.method==='tools/list'?{tools:[]}:{};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:r})+'\\n')}});`;

function run(plan, args, cwd, env) {
  return new Promise((resolve) => {
    const c = spawn(plan.command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env });
    let out = '';
    let err = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (err += d));
    const t = setTimeout(() => c.kill('SIGKILL'), 180_000);
    c.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
  });
}

async function runOnce(mode) {
  const bin = realpathSync(CLAUDE);
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-pwa-')));
  const cwd = path.join(root, 'repo');
  const ghome = path.join(root, 'gnomon');
  mkdirSync(cwd);
  mkdirSync(ghome);
  const userHome = os.homedir();
  const userClaudeDir = path.join(userHome, '.claude');
  const uuid = randomUUID();
  const hsid = mintHsid();
  ensureTranscriptDir(userClaudeDir);
  ensureSessionEnvDir(userClaudeDir, uuid);
  const scratch = sessionScratchDirs(hsid, repoKeyOf([cwd]));
  // Aegis round 3 M: as the supervisor builds it — only this session's subtree of /private/tmp/claude-<uid> is writable
  const claudeTmp = claudeTmpDirs(process.getuid(), uuid, [cwd]) ? { claudeTmp: { uid: process.getuid(), uuid, cwds: [cwd] } } : {};
  const policy = buildSessionPolicy({ home: ghome, cwd, userClaudeDir, userHome, managedSettingsPaths: [], linkedFolders: [], endpointPort: null, claudeTranscripts: true, claudeSessionEnv: uuid, tmpdir: scratch.tmp, sessionCache: scratch.cache, memorySubtree: cwd, ...claudeTmp });
  const settings = path.join(root, 'policy.json');
  const hookOut = path.join(scratch.tmp, 'hook-ran.txt');
  // the deny mirror only (no `ask` list): this probe measures the SANDBOX, so its Bash command runs with no host
  const cacheEnv = Object.fromEntries(Object.entries(SESSION_CACHE_ENV).map(([k, sub]) => [k, path.join(scratch.cache, sub)]));
  // as the supervisor writes it: the cache vars ride the settings env block too (Claude Code drops npm_config_* from its own env)
  writeFileSync(settings, JSON.stringify({ permissions: { deny: claudePermissions(policy, 'darwin').permissions.deny }, env: { ...claudePermissions(policy, 'darwin').env, ...cacheEnv }, hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `echo ran > "${hookOut}"` }] }] } }));
  const server = path.join(scratch.tmp, 'mcp-server.cjs');
  writeFileSync(server, MCP_SERVER);
  const mcp = path.join(root, 'mcp.json');
  writeFileSync(mcp, JSON.stringify({ mcpServers: { probe: { type: 'stdio', command: process.execPath, args: [server] } } }));
  const common = ['--model', 'haiku', '--output-format', 'stream-json', '--verbose', '--settings', settings, '--setting-sources', 'user', '--mcp-config', mcp, '--strict-mcp-config', '--dangerously-skip-permissions', '--max-turns', '4'];
  const first = ['-p', 'Run this exact Bash command once: `npm --version; (echo x > ~/gnomon-probe-denied.txt) 2>/dev/null; echo done`. Then run the Bash command `sleep 1; echo bg` with run_in_background true, read its output once, and reply with only the word ok.', '--session-id', uuid, ...common];
  const env = { HOME: userHome, PATH: `${path.dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`, TMPDIR: scratch.tmp, USER: os.userInfo().username, LANG: 'en_US.UTF-8', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', ...Object.fromEntries(Object.entries(SESSION_CACHE_ENV).map(([k, sub]) => [k, path.join(scratch.cache, sub)])) };
  const plan = sessionLaunchPlan({ policy, binaryReal: bin, argv: first, extras: { uid: process.getuid(), tmpdir: os.tmpdir(), home: userHome, roots: [cwd] } }, 'darwin');
  const strip = (a) => (mode === 'audit' ? a.split('\n').filter((l) => l !== '(deny file-write*)' && !l.startsWith('(allow file-write* (literal "/dev/null")')).join('\n') : a);
  const args1 = [...plan.args];
  args1[1] = strip(args1[1]);
  const marker = path.join(root, 'marker');
  writeFileSync(marker, '');
  const t0 = new Date(Date.now() - 1000);
  utimesSync(marker, t0, t0);
  const r1 = await run(plan, args1, cwd, env);
  // the --resume turn under the same profile
  const plan2 = sessionLaunchPlan({ policy, binaryReal: bin, argv: ['-p', 'Reply with only the word again.', '--resume', uuid, ...common], extras: { uid: process.getuid(), tmpdir: os.tmpdir(), home: userHome, roots: [cwd] } }, 'darwin');
  const args2 = [...plan2.args];
  args2[1] = strip(args2[1]);
  const r2 = await run(plan2, args2, cwd, env);
  const lines = (o) => o.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const init = lines(r1.out).find((m) => m.type === 'system' && m.subtype === 'init');
  const res1 = lines(r1.out).find((m) => m.type === 'result');
  const res2 = lines(r2.out).find((m) => m.type === 'result');
  let written = [];
  // Aegis round 3 M: what Claude Code writes under /private/tmp itself (shared with the human's own Claude Code), measured whole
  const tmpClaude = spawnSync('/usr/bin/find', ['/private/tmp', '-maxdepth', '6', '-newer', marker, '-path', '*claude*', '-print'], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).map((p) => p.replace(uuid, '<uuid>').replace(cwd.replace(/[^A-Za-z0-9]/g, '-'), '<enc-cwd>')).sort();
  if (mode === 'audit') {
    const prune = PRUNE.flatMap((p) => ['-path', path.join(userHome, p), '-prune', '-o']);
    const f = spawnSync('/usr/bin/find', [userHome, '-xdev', ...prune, '-newer', marker, '-type', 'f', '-print'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 300_000 });
    const t = spawnSync('/usr/bin/find', [realpathSync(os.tmpdir()), '/private/tmp', '-newer', marker, '-type', 'f', '-print'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const allow = (policy.writeAllow ?? []).map((a) => a.path).concat(policy.allowWrite.map((a) => a.path));
    const inside = (p) => allow.some((a) => p === a || p.startsWith(`${a}/`));
    written = [...new Set(`${f.stdout}\n${t.stdout}`.split('\n').filter(Boolean).filter((p) => !inside(p) && !p.startsWith(`${root}/`)))]
      .map((p) => p.replace(userHome, '~').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>'))
      .sort();
  }
  const enc = cwd.replace(/[^A-Za-z0-9]/g, '-');
  const transcript = existsSync(path.join(userClaudeDir, 'projects', enc)) && readdirSync(path.join(userClaudeDir, 'projects', enc)).some((f) => f.startsWith(uuid));
  const control = existsSync(path.join(userHome, 'gnomon-probe-denied.txt'));
  const hookRan = existsSync(hookOut);
  rmSync(path.join(userHome, 'gnomon-probe-denied.txt'), { force: true });
  rmSync(path.join(userClaudeDir, 'projects', enc), { recursive: true, force: true });
  rmSync(path.join(userClaudeDir, 'session-env', uuid), { recursive: true, force: true });
  rmSync(scratch.tmp, { recursive: true, force: true });
  rmSync(path.join(`/private/tmp/claude-${process.getuid()}`, cwd.replace(/[^A-Za-z0-9]/g, '-')), { recursive: true, force: true });
  rmSync(scratch.cache, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
  return {
    exit: [r1.code, r2.code],
    first: res1 ? { isError: res1.is_error, text: String(res1.result ?? '').slice(0, 120) } : null,
    resumed: res2 ? { isError: res2.is_error, text: String(res2.result ?? '').slice(0, 120) } : null,
    mcp: (init?.mcp_servers ?? []).map((m) => `${m.name}:${m.status}`),
    hookRan,
    transcript,
    controlWritten: control,
    written,
    tmpClaude,
    stderr: `${r1.err}${r2.err}`.slice(0, 800),
  };
}

export default async function probe() {
  if (!CLAUDE) return { verdict: 'fail', evidence: { error: 'claude binary not found' } };
  const audit = await runOnce('audit');
  const enforce = await runOnce('enforce');
  // other processes on the host write in the same window (a browser, desktop apps): only paths that can be the session's are kept in the record
  const mine = (p) => /claude|npm|gnomon/i.test(p) && !/Application Support\/Claude|Logs\/Claude/.test(p);
  audit.written = audit.written.filter(mine);
  // ~/.npm/_logs files in the window are the probe runner's own `npx tsx` (its log names `npm exec tsx probes/run.mjs`), not the session
  const unexplained = audit.written.filter((p) => p !== '~/gnomon-probe-denied.txt' && !/^~\/\.claude(\.json|\/)/.test(p) && !/^~\/\.npm\/_logs\//.test(p));
  const ok = enforce.exit[0] === 0 && enforce.exit[1] === 0 && enforce.first?.isError === false && enforce.resumed?.isError === false && enforce.transcript && enforce.hookRan && enforce.mcp.includes('probe:connected') && !enforce.controlWritten && audit.controlWritten;
  return { verdict: ok ? 'pass' : 'fail', evidence: { claude: path.basename(realpathSync(CLAUDE)), audit, enforce, unexplained } };
}
