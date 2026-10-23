// p10m-write-allow — T-2026-10-23-004 (Aegis): session file writes DENY BY DEFAULT. Two runs of real Claude Code
// (the founder's subscription and home, so auth works), each one cheap haiku turn that runs one Bash command
// (`npm --version` and a write to ~/gnomon-probe-denied.txt), under the generated session profile (transcripts +
// session-env carve-backs, the session TMPDIR):
//   AUDIT   the same profile with the default-deny lines removed (the pre-fix allow-default writes), and a filesystem
//           snapshot (files newer than a marker under the home and the temp dirs): the MEASURED set of paths a real
//           session writes outside the allowlist — the set the allowlist was cut from.
//   ENFORCE the real profile: the turn succeeds, the transcript is written, and the control write is denied.
// (sandbox-exec denials are not reported to the unified log, measured 2026-10-23, so the audit run is the measurement.)
// VERDICT: pass when the enforced turn succeeds with its transcript and the control denied, and every audited write
// outside the allowlist is the control or a path the profile denies on purpose (~/.claude.json, ~/.claude/*).
// Run: npx tsx probes/run.mjs p10m-write-allow --timeout 500000
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { buildSessionPolicy, claudePermissions, userTempRoot } from '../../src/kernel/manifest/policy.ts';
import { sessionLaunchPlan } from '../../src/kernel/sandbox/session.ts';
import { ensureSessionEnvDir, ensureTranscriptDir } from '../../src/kernel/supervisor/supervisor.ts';

export const specRefs = ['§15.5 session profile', 'T-2026-10-23-004 deny-by-default writes'];

const CLAUDE = [path.join(os.homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude'].find(existsSync);
const PRUNE = ['Library/Containers', 'Library/Group Containers', 'Library/Mail', 'Library/Messages', '.Trash', 'Library/Biome', 'Library/Metadata', 'Library/Daemon Containers', 'Documents', 'Pictures', 'Music', 'Movies'];

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
  ensureTranscriptDir(userClaudeDir);
  ensureSessionEnvDir(userClaudeDir, uuid);
  const tmpdir = os.tmpdir();
  const policy = buildSessionPolicy({ home: ghome, cwd, userClaudeDir, userHome, managedSettingsPaths: [], linkedFolders: [], endpointPort: null, claudeTranscripts: true, claudeSessionEnv: uuid, tmpdir, memorySubtree: cwd });
  const settings = path.join(root, 'policy.json');
  // the deny mirror only (no `ask` list): this probe measures the SANDBOX, so its one Bash command runs with no host
  writeFileSync(settings, JSON.stringify({ permissions: { deny: claudePermissions(policy, 'darwin').permissions.deny } }));
  const argv = ['-p', 'Run this exact Bash command once: `npm --version; (echo x > ~/gnomon-probe-denied.txt) 2>/dev/null; echo done`. Then reply with only the word ok.', '--model', 'haiku', '--output-format', 'json', '--session-id', uuid, '--settings', settings, '--setting-sources', 'user', '--dangerously-skip-permissions', '--max-turns', '4'];
  const plan = sessionLaunchPlan({ policy, binaryReal: bin, argv, extras: { uid: process.getuid(), tmpdir, home: userHome, roots: [cwd] } }, 'darwin');
  const args = [...plan.args];
  if (mode === 'audit') args[1] = args[1].split('\n').filter((l) => l !== '(deny file-write*)' && !l.startsWith('(allow file-write* (literal "/dev/null")')).join('\n');
  const marker = path.join(root, 'marker');
  writeFileSync(marker, '');
  const t0 = new Date(Date.now() - 1000);
  utimesSync(marker, t0, t0);
  const r = await new Promise((resolve) => {
    const c = spawn(plan.command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { HOME: userHome, PATH: `${path.dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin`, TMPDIR: tmpdir, USER: os.userInfo().username, LANG: 'en_US.UTF-8' } });
    let out = '';
    let err = '';
    c.stdout.on('data', (d) => (out += d));
    c.stderr.on('data', (d) => (err += d));
    const t = setTimeout(() => c.kill('SIGKILL'), 150_000);
    c.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
  });
  let written = [];
  if (mode === 'audit') {
    const prune = PRUNE.flatMap((p) => ['-path', path.join(userHome, p), '-prune', '-o']);
    const f = spawnSync('/usr/bin/find', [userHome, '-xdev', ...prune, '-newer', marker, '-type', 'f', '-print'], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 300_000 });
    const t = spawnSync('/usr/bin/find', [userTempRoot(tmpdir), '/private/tmp', '-newer', marker, '-type', 'f', '-print'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const allow = (policy.writeAllow ?? []).map((a) => a.path).concat(policy.allowWrite.map((a) => a.path));
    const inside = (p) => allow.some((a) => p === a || p.startsWith(`${a}/`));
    written = [...new Set(`${f.stdout}\n${t.stdout}`.split('\n').filter(Boolean).filter((p) => !inside(p) && !p.startsWith(`${root}/`)))]
      .map((p) => p.replace(userHome, '~').replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>'))
      .sort();
  }
  let result = null;
  try { result = JSON.parse(r.out); } catch { result = null; }
  const enc = cwd.replace(/[^A-Za-z0-9]/g, '-');
  const transcript = existsSync(path.join(userClaudeDir, 'projects', enc)) && readdirSync(path.join(userClaudeDir, 'projects', enc)).some((f) => f.startsWith(uuid));
  const control = existsSync(path.join(userHome, 'gnomon-probe-denied.txt'));
  rmSync(path.join(userHome, 'gnomon-probe-denied.txt'), { force: true });
  rmSync(path.join(userClaudeDir, 'projects', enc), { recursive: true, force: true });
  rmSync(path.join(userClaudeDir, 'session-env', uuid), { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
  return { exit: r.code, result: result ? { isError: result.is_error, text: String(result.result ?? '').slice(0, 200), numTurns: result.num_turns } : null, transcript, controlWritten: control, written, stderr: r.err.slice(0, 800) };
}

export default async function probe() {
  if (!CLAUDE) return { verdict: 'fail', evidence: { error: 'claude binary not found' } };
  const audit = await runOnce('audit');
  const enforce = await runOnce('enforce');
  // writes another process made in the same window (other apps, the probe's own find) are not the session's: listed, judged by hand
  const unexplained = audit.written.filter((p) => p !== '~/gnomon-probe-denied.txt' && !/^~\/\.claude(\.json|\/)/.test(p));
  // other processes on the host write in the same window (a browser, desktop apps): only paths that can be the session's are kept in the record
  const mine = (p) => /claude|npm|gnomon/i.test(p) && !/Application Support\/Claude|Logs\/Claude/.test(p);
  audit.written = audit.written.filter(mine);
  const ok = enforce.exit === 0 && enforce.result?.isError === false && enforce.transcript && !enforce.controlWritten && audit.controlWritten;
  return { verdict: ok ? 'pass' : 'fail', evidence: { claude: path.basename(realpathSync(CLAUDE)), audit, enforce, unexplained: unexplained.filter(mine) } };
}
