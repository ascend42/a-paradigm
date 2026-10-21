// Probe p-session-env (darwin, LIVE Claude Code, 3 short `claude -p` turns on the operator's subscription).
// Question: under the GENERATED session profile, with the session-env carve-back scoped to this session's uuid,
//  (1) does a SessionStart command hook run and can it write CLAUDE_ENV_FILE, and does a LATER Bash command in the
//      same session see what it exported (i.e. Claude Code sources CLAUDE_ENV_FILE as shell before Bash commands)?
//  (2) without the carve-back (the old profile shape), does the hook fail (EPERM) and the Bash command see nothing?
//  (3) does `--resume <uuid>` keep the same live session id (so the uuid-scoped carve still covers it)?
// Run: npx tsx packages/gnomon/probes/p-session-env/probe.mts   (writes probes/results/p-session-env.darwin.json)
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSessionPolicy } from '../../src/kernel/manifest/policy.ts';
import { sessionLaunchPlan } from '../../src/kernel/sandbox/session.ts';
import { ensureSessionEnvDir, ensureTranscriptDir } from '../../src/kernel/supervisor/supervisor.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const home = os.homedir();
const claudeDir = path.join(home, '.claude');
const claudeBin = fs.realpathSync(process.env.CLAUDE_BIN ?? path.join(home, '.local', 'bin', 'claude'));
const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'p-session-env-')));
const settings = path.join(work, 'probe-settings.json');
fs.writeFileSync(settings, JSON.stringify({
  hooks: { SessionStart: [{ hooks: [{ type: 'command', command: `sh -c 'echo "export GNOMON_PROBE=1" >> "$CLAUDE_ENV_FILE" && echo hook-wrote-env-file >&2'` }] }] },
}));
const PROMPT = 'Run exactly this Bash command and then reply with only its output, nothing else: echo PROBE=${GNOMON_PROBE:-unset}';

function run(label: string, uuid: string, carve: boolean, resume: boolean): Record<string, unknown> {
  ensureTranscriptDir(claudeDir);
  const prep = carve ? ensureSessionEnvDir(claudeDir, uuid) : null;
  const policy = buildSessionPolicy({ home: path.join(home, '.gnomon'), cwd: work, userClaudeDir: claudeDir, userHome: home, managedSettingsPaths: [], linkedFolders: [], endpointPort: null, claudeTranscripts: true, ...(carve ? { claudeSessionEnv: uuid } : {}) } as never);
  const argv = ['-p', PROMPT, resume ? '--resume' : '--session-id', uuid, '--settings', settings, '--setting-sources', 'user', '--allowedTools', 'Bash', '--output-format', 'json', '--include-hook-events', '--verbose'];
  const plan = sessionLaunchPlan({ policy, binaryReal: claudeBin, argv, extras: { uid: process.getuid!(), tmpdir: os.tmpdir(), home, roots: [work] } } as never, 'darwin');
  const r = spawnSync(plan.command, plan.args, { cwd: work, encoding: 'utf8', env: { HOME: home, PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: os.tmpdir(), USER: os.userInfo().username, LANG: 'en_US.UTF-8' }, timeout: 180_000 });
  let events: Array<Record<string, unknown>> = [];
  try {
    const parsed = JSON.parse(r.stdout);
    events = Array.isArray(parsed) ? parsed : [parsed];
  } catch { /* keep raw */ }
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init');
  const result = events.find((e) => e.type === 'result');
  const hooks = events.filter((e) => e.type === 'system' && typeof e.subtype === 'string' && (e.subtype as string).startsWith('hook')).map((e) => ({ subtype: e.subtype, hook_name: e.hook_name, outcome: e.outcome, exit_code: e.exit_code, output: String(e.output ?? '').slice(0, 200) }));
  const text = String(result?.result ?? '');
  return {
    label, carve, resume, uuid, prep, sessionEnvRefused: policy.sessionEnvRefused ?? null,
    allowWrite: policy.allowWrite.map((a) => a.path.replace(home, '~')),
    exit: r.status, initSessionId: init?.session_id ?? null, resultSessionId: result?.session_id ?? null,
    sameSessionId: (init?.session_id ?? null) === uuid,
    hooks, bashSaw: (text.match(/PROBE=\S+/) ?? [null])[0], resultText: text.slice(0, 200),
    stderrTail: r.stderr.slice(-400),
  };
}

const uuidA = randomUUID();
const uuidB = randomUUID();
const runs = [
  run('A carve-back on (profile v8): new session', uuidA, true, false),
  run('B carve-back on: --resume the same uuid', uuidA, true, true),
  run('C control, no carve-back (old profile shape)', uuidB, false, false),
];
const out = {
  probe: 'p-session-env', platform: 'darwin', claudeCodeVersion: spawnSync(claudeBin, ['--version'], { encoding: 'utf8' }).stdout.trim(), at: new Date().toISOString(),
  answers: {
    q1HookWritesEnvFileAndBashSeesIt: runs[0].bashSaw === 'PROBE=1',
    q2WithoutCarveHookFailsAndBashSeesNothing: runs[2].bashSaw !== 'PROBE=1',
    q3ResumeKeepsSessionId: runs[1].initSessionId === uuidA,
  },
  runs,
};
const dest = path.join(here, '..', 'results', 'p-session-env.darwin.json');
fs.writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(out.answers)}\n${dest}\n`);
fs.rmSync(work, { recursive: true, force: true });
