// p01-claude-cli — Arky P01 (research 29 §2; spec §19.1 M1.0 P01, §3.3, OPEN 8).
// READ-ONLY and free: records `claude --version` and checks `claude --help` for
// the flags the #claude-adapter spawn line (§3.3) depends on. It never starts a
// session (no paid turn). The live items — hook stdin session_id, the
// stream-json control_request interrupt, --setting-sources semantics, the
// loopback-override refusal — are recorded as pending-manual.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const specRefs = ['§3.3 spawn line', '§3.3 FORBIDDEN_FLAGS', '§10 law 7', '§19.1 M1.0 P01', 'OPEN 8', 'G-SUB-01', 'research 29 §2 P01'];

const MIN_VERSION = [2, 1, 288]; // OPEN 8: "hook stdin session_id on 2.1.288+"

function findClaude() {
  const w = spawnSync('/usr/bin/which', ['claude'], { encoding: 'utf8' });
  if (w.status === 0 && w.stdout.trim()) return { path: w.stdout.trim(), via: 'PATH' };
  for (const p of [path.join(os.homedir(), '.local/bin/claude'), path.join(os.homedir(), '.claude/local/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude']) {
    if (existsSync(p)) return { path: p, via: 'known-location (not on PATH)' };
  }
  return null;
}

const cmp = (a, b) => {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
};

// The help text wraps descriptions; collect each flag's block of lines.
function flagBlock(help, flag) {
  const lines = help.split('\n');
  const i = lines.findIndex((l) => new RegExp(`^\\s*(-\\w, )?${flag.replace(/-/g, '\\-')}(\\W|$)`).test(l));
  if (i < 0) return null;
  const block = [lines[i]];
  for (let j = i + 1; j < lines.length && /^\s{20,}\S/.test(lines[j]); j++) block.push(lines[j]);
  return block.map((l) => l.trim()).join(' ').replace(/\s+/g, ' ');
}

export default async function probe() {
  const found = findClaude();
  if (!found) return { verdict: 'fail', evidence: { claudeFound: false } };
  const ver = spawnSync(found.path, ['--version'], { encoding: 'utf8', timeout: 20_000 });
  const help = spawnSync(found.path, ['--help'], { encoding: 'utf8', timeout: 20_000 });
  const versionLine = (ver.stdout || '').trim();
  const v = (/(\d+)\.(\d+)\.(\d+)/.exec(versionLine) ?? []).slice(1, 4).map(Number);
  const versionOk = v.length === 3 && cmp(v, MIN_VERSION) >= 0;
  const text = help.stdout || '';

  const wanted = [
    '--print',
    '--setting-sources',
    '--resume',
    '--fork-session',
    '--output-format',
    '--input-format',
    '--include-partial-messages',
    '--replay-user-messages',
    '--verbose',
    '--mcp-config',
    '--strict-mcp-config',
    '--no-session-persistence',
  ];
  const flags = Object.fromEntries(wanted.map((f) => [f, flagBlock(text, f)]));
  const present = Object.fromEntries(wanted.map((f) => [f, flags[f] !== null]));
  const streamJsonOut = /stream-json/.test(flags['--output-format'] ?? '');
  const streamJsonIn = /stream-json/.test(flags['--input-format'] ?? '');
  const settingSourcesValues = (/\(([^)]*)\)/.exec(flags['--setting-sources'] ?? '') ?? [])[1] ?? null;
  // §3.3 FORBIDDEN_FLAGS — still exist in this CLI (so the throw-check is meaningful).
  const forbidden = Object.fromEntries(['--dangerously-skip-permissions', '--allowedTools', '--bare'].map((f) => [f, flagBlock(text, f) !== null]));

  const allFlags = Object.values(present).every(Boolean) && streamJsonOut && streamJsonIn;
  return {
    verdict: !allFlags || !versionOk ? 'fail' : 'partial',
    evidence: {
      claude: { path: found.path.replace(os.homedir(), '~'), via: found.via, version: versionLine, minRequired: MIN_VERSION.join('.'), versionOk },
      flagsPresent: present,
      flagHelp: flags,
      streamJson: { output: streamJsonOut, input: streamJsonIn },
      settingSourcesDocumentedValues: settingSourcesValues,
      forbiddenFlagsStillExist: forbidden,
      pendingManual: {
        hookStdinSessionId: 'Run one interactive/`-p` turn with a SessionStart/PreToolUse hook that dumps stdin; confirm `session_id` is present on 2.1.288+ (OPEN 8). Costs one turn.',
        controlRequestInterrupt: 'Spawn the §3.3 stream-json line, send {"type":"control_request","request_id":"…","request":{"subtype":"interrupt"}} mid-turn; record the control_response and that the turn stops (A23-4, G-RUN-03). Costs one turn.',
        settingSourcesSemantics: 'Verify which layers `--setting-sources user,project,local` (and an empty list) actually load, and whether managed settings and CLAUDE.md are unaffected (§3.3 layersHash). Help text lists only user, project, local.',
        loopbackOverrideRefusal: 'G-SUB-01 / law 7: confirm ANTHROPIC_BASE_URL pointing at loopback is refused by the adapter preflight (kernel-side; needs the adapter).',
        resumeForkAcrossMachines: 'research 31: transplant a transcript + `--resume`/`--fork-session` across machines/OS.',
        runInsideSessionProfile: 'p10m claudeCompat: a real `claude -p` Bash turn under the session sandbox profile.',
      },
    },
    toolVersions: { claude: versionLine },
  };
}
