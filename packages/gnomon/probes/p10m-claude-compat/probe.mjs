// p10m-claude-compat — does Claude Code still work inside the macOS `session`
// sandbox profile (§15.5) once the p10m fixes are added (sysmond mach-lookup
// deny, tmux/screen unix-socket denies), and do the denies still hold when the
// commands come from Claude's own Bash tool?
//
// Method: the same `claude -p` turn runs twice — once unsandboxed (control) and
// once under `sandbox-exec` with the hardened session profile. The model only
// runs `bash check.sh`; the script writes its own results to out.txt, which this
// probe reads directly (ground truth is the file, not the model's summary).
// Costs two short turns on the founder's subscription (--max-turns 8 each).
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export const specRefs = ['§15.5 session profile', '§11.2 rule 2b', '§3.3', 'G-SBX-08', 'M1.7', 'p10m-sbx-deny-mac'];

const CLAUDE = [path.join(os.homedir(), '.local/bin/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].find(existsSync);

function run(cmd, args, opts) {
  return new Promise((resolve) => {
    execFile(cmd, args, { ...opts, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : -1) : 0, stdout: String(stdout), stderr: String(stderr).slice(-2000), killed: !!err?.killed });
    });
  });
}

function parseOut(file) {
  if (!existsSync(file)) return null;
  const kv = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([a-z_]+)=(.*)$/);
    if (m) kv[m[1]] = m[2].trim();
  }
  return kv;
}

function summarizeClaude(r) {
  let j = null;
  try { j = JSON.parse(r.stdout); } catch { /* not json */ }
  return {
    exit: r.code,
    killed: r.killed,
    isError: j?.is_error ?? null,
    subtype: j?.subtype ?? null,
    numTurns: j?.num_turns ?? null,
    costUsd: j?.total_cost_usd ?? null,
    resultTail: typeof j?.result === 'string' ? j.result.slice(-600) : r.stdout.slice(-600),
    stderrTail: r.stderr,
  };
}

export default async function probe() {
  if (!CLAUDE) return { verdict: 'fail', evidence: { error: 'claude binary not found' } };
  // realpath: /var/folders is a symlink to /private/var/folders and SBPL matches resolved paths.
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'gnomon-p10m-claude-')));
  let hits = 0;
  const server = http.createServer((_q, s) => { hits++; s.end('gnomon-endpoint-standin'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const runOnce = async (label, sandboxed) => {
    const work = path.join(root, label, 'work');
    const denied = path.join(root, label, 'denied');
    mkdirSync(work, { recursive: true });
    mkdirSync(denied, { recursive: true });
    writeFileSync(path.join(work, 'check.sh'), `#!/bin/bash
{
echo "node=$(node --version 2>&1 | head -1)"
echo "git=$(git --version 2>&1 | head -1)"
echo hi > ./wrote.txt 2>/dev/null && echo "write_work=ok" || echo "write_work=fail"
(echo x > "${denied}/x.txt") 2>/dev/null && echo "write_denied=allowed" || echo "write_denied=blocked"
sleep 30 & C=$!; if kill $C 2>/dev/null; then wait $C 2>/dev/null; echo "child_spawn_kill=ok"; else echo "child_spawn_kill=fail"; fi
code=$(curl -s -m 3 -o /dev/null -w "%{http_code}" http://127.0.0.1:${port}/ 2>/dev/null); echo "port_http=\${code:-none} curl_exit=$?"
n=$(pgrep -fl . 2>/dev/null | wc -l | tr -d ' '); echo "pgrep_lines=$n"
ps -p $$ >/dev/null 2>&1 && echo "ps=ok" || echo "ps=fail"
python3 -c "print('py_ok')" 2>/dev/null | sed 's/^/python=/' || echo "python=fail"
} 2>&1 | tee out.txt
`);
    const prompt = 'Run exactly this command with your Bash tool: bash check.sh — then reply with its output verbatim and nothing else.';
    const args = ['-p', prompt, '--output-format', 'json', '--max-turns', '8', '--allowedTools', 'Bash'];
    const profile = '(version 1)(allow default)' +
      `(deny network-outbound (remote ip "localhost:${port}"))` +
      '(deny process-info*)(allow process-info* (target self))' +
      '(deny sysctl-read (sysctl-name-prefix "kern.proc"))' +
      '(deny mach-lookup (global-name "com.apple.sysmond"))' +
      `(deny network-outbound (remote unix-socket (subpath "/private/tmp/tmux-${process.getuid()}")))` +
      `(deny file-write* (subpath "${denied}"))`;
    const t0 = Date.now();
    const before = hits;
    const r = sandboxed
      ? await run('/usr/bin/sandbox-exec', ['-p', profile, CLAUDE, ...args], { cwd: work, timeout: 240000 })
      : await run(CLAUDE, args, { cwd: work, timeout: 240000 });
    return {
      sandboxed,
      ms: Date.now() - t0,
      endpointHitsDuringRun: hits - before,
      claude: summarizeClaude(r),
      check: parseOut(path.join(work, 'out.txt')),
      profile: sandboxed ? profile.replaceAll(root, '<tmp>') : null,
    };
  };

  try {
    // GNOMON_PROBE_REUSE_CONTROL=1 reuses the last committed control run (saves one paid turn).
    const prev = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'results', 'p10m-claude-compat.darwin.json');
    const control = process.env.GNOMON_PROBE_REUSE_CONTROL === '1' && existsSync(prev)
      ? { ...JSON.parse(readFileSync(prev, 'utf8')).evidence.control, reused: true }
      : await runOnce('control', false);
    const sandboxed = await runOnce('sandboxed', true);
    const c = sandboxed.check ?? {};
    const claudeWorks = sandboxed.claude.exit === 0 && sandboxed.claude.isError === false && !!sandboxed.check;
    const bashWorks = c.write_work === 'ok' && c.child_spawn_kill === 'ok' && /^v\d/.test(c.node ?? '');
    const deniesHold = sandboxed.endpointHitsDuringRun === 0 && (c.port_http ?? '').startsWith('000') &&
      c.write_denied === 'blocked' && Number(c.pgrep_lines ?? '1') === 0;
    const verdict = claudeWorks && bashWorks && deniesHold ? 'pass' : (claudeWorks ? 'partial' : 'fail');
    return {
      verdict,
      evidence: {
        claudeBinary: CLAUDE.replace(os.homedir(), '~'),
        criteria: { claudeWorks, bashWorks, deniesHold },
        control,
        sandboxed,
        notes: [
          'ps is expected to fail under any sandbox-exec profile (setuid; see p10m-sbx-deny-mac).',
          'Ground truth is out.txt written by check.sh, not the model reply.',
        ],
      },
    };
  } finally {
    server.close();
    rmSync(root, { recursive: true, force: true });
  }
}
