/**
 * `_check_severity` must honour `paradigm enforcement resolve --json` whatever
 * its whitespace. The CLI pretty-prints (`"id": "value"`); the hook used to
 * grep only the compact form, so every configured severity was ignored.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { SH, SYS_PATH, WIN, baseEnv, pathValue, shellPath, tempDir } from '../src/test-shell-utils.js';

const COMMON_SH = path.resolve(__dirname, '..', 'src', 'commands', 'hooks', 'scripts', 'paradigm-common.sh');
const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

function severities(enforcementJson: string): Record<string, string> {
  const root = tempDir('paradigm-sev-');
  const bin = tempDir('paradigm-sev-bin-');
  dirs.push(root, bin);
  fs.mkdirSync(path.join(root, '.paradigm', 'events'), { recursive: true });
  fs.writeFileSync(path.join(bin, 'enforcement.json'), enforcementJson);
  fs.writeFileSync(
    path.join(bin, 'paradigm'),
    `#!/bin/sh
case "$1" in
  enforcement) cat "${shellPath(path.join(bin, 'enforcement.json'))}" ;;
  compliance-check) echo '{"driftedCount":0}' ;;
  internal) echo '[]' ;;
esac
exit 0
`,
  );
  fs.chmodSync(path.join(bin, 'paradigm'), 0o755);
  const ids = ['purpose-exists', 'aspect-advisory', 'orchestration-required', 'purpose-coverage', 'not-configured'];
  const script = `cd "${shellPath(root)}"; MODIFIED=""; . "${shellPath(COMMON_SH)}" >/dev/null 2>&1
for id in ${ids.join(' ')}; do echo "$id=$(_check_severity "$id" dflt)"; done
echo "threshold=$ORCH_THRESHOLD"`;
  const r = spawnSync(SH, ['-c', script], { env: { ...baseEnv(), PATH: pathValue([bin, ...SYS_PATH]), HOME: root }, encoding: 'utf8' });
  return Object.fromEntries(r.stdout.trim().split('\n').map((l) => l.split('=') as [string, string]));
}

const MAP = {
  'purpose-exists': 'warn',
  'aspect-advisory': 'off',
  'orchestration-required': 'block',
  'purpose-coverage': 'block',
  orchestrationThreshold: 5,
};
const EXPECTED = {
  'purpose-exists': 'warn',
  'aspect-advisory': 'off',
  'orchestration-required': 'block',
  'purpose-coverage': 'block',
  'not-configured': 'dflt',
  threshold: '5',
};

describe('_check_severity parses enforcement JSON robustly', () => {
  it('pretty-printed JSON (what the CLI emits)', () => {
    expect(severities(JSON.stringify(MAP, null, 2))).toEqual(EXPECTED);
  });
  it('compact JSON', () => {
    expect(severities(JSON.stringify(MAP))).toEqual(EXPECTED);
  });
  it('tabs, CRLF and odd spacing around colons', () => {
    const odd = '{\r\n\t"purpose-exists"  :\t"warn" ,\r\n "aspect-advisory":"off",\n"orchestration-required" : "block",\n"purpose-coverage":   "block",\n "orchestrationThreshold" :  5 }\r\n';
    expect(severities(odd)).toEqual(EXPECTED);
  });
  it('empty output falls back to defaults', () => {
    expect(severities('')).toMatchObject({ 'purpose-exists': 'dflt', threshold: '3' });
  });
});

// ---------------------------------------------------------------------------
// .orchestrated is honoured by TTL (PARADIGM_GATE_TTL_HOURS, default 4h), not
// deleted by the Stop hook. Stop fires per assistant turn, so deleting it on
// every passing turn made Check 13 warn in sessions that did delegate.
// ---------------------------------------------------------------------------

const SCRIPTS = path.resolve(__dirname, '..', 'src', 'commands', 'hooks', 'scripts');
const FIVE_HOURS_AGO = () => new Date(Date.now() - 5 * 60 * 60 * 1000);

function stubBin(): string {
  const bin = tempDir('paradigm-orch-bin-');
  dirs.push(bin);
  fs.writeFileSync(
    path.join(bin, 'paradigm'),
    `#!/bin/sh
case "$1" in
  compliance-check) echo '{"driftedCount":0,"healedCount":0,"usedButUndeclaredCount":0}' ;;
  internal) echo '[]' ;;
esac
exit 0
`,
  );
  fs.chmodSync(path.join(bin, 'paradigm'), 0o755);
  return bin;
}

function orchProject(marker: 'none' | 'fresh' | 'stale'): string {
  const root = tempDir('paradigm-orch-');
  dirs.push(root);
  fs.mkdirSync(path.join(root, '.paradigm', 'events'), { recursive: true });
  const m = path.join(root, '.paradigm', '.orchestrated');
  if (marker !== 'none') {
    fs.writeFileSync(m, '{"type":"orchestrated","verdicts":1,"source":"delegation"}');
    if (marker === 'stale') fs.utimesSync(m, FIVE_HOURS_AGO(), FIVE_HOURS_AGO());
  }
  return root;
}

/** Source paradigm-common.sh with a magnitude-4 change set; return ADVISORY. */
function check13Advisory(root: string): string {
  const bin = stubBin();
  const files = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'];
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  for (const f of files) fs.writeFileSync(path.join(root, f), 'export const x = 1;\n');
  fs.writeFileSync(path.join(root, 'src', '.purpose'), 'version: 2.0.0\ncomponents:\n  x:\n    description: x\n');
  const script = `cd "${shellPath(root)}"; MODIFIED="${[...files, 'src/.purpose'].join('\n')}"; . "${shellPath(COMMON_SH)}" >/dev/null 2>&1
echo "$ADVISORY"`;
  const r = spawnSync(SH, ['-c', script], { env: { ...baseEnv(), PATH: pathValue([bin, ...SYS_PATH]), HOME: root }, encoding: 'utf8' });
  return r.stdout;
}

describe('Check 13 honours .orchestrated by TTL', () => {
  it('no marker → orchestration advisory (control)', () => {
    const out = check13Advisory(orchProject('none'));
    expect(out).toContain('(orchestration) Magnitude');
    expect(out).toContain('delegate to a team agent (Agent tool)');
    expect(out).not.toContain('orchestrate_inline');
  });
  it('fresh marker → no advisory', () => {
    expect(check13Advisory(orchProject('fresh'))).not.toContain('(orchestration)');
  });
  it('marker back-dated beyond the TTL → advisory returns', () => {
    expect(check13Advisory(orchProject('stale'))).toContain('(orchestration) Magnitude');
  });
});

// ---------------------------------------------------------------------------
// Generated state nested in a package (packages/x/.paradigm/events/*.jsonl,
// packages/x/.warpline/*) is Paradigm's own output, never source: it must not
// count toward SOURCE_COUNT, the cross-package signal or Check 13's magnitude.
// ---------------------------------------------------------------------------

describe('nested generated state is not source', () => {
  const NESTED = [
    '.paradigm/events/stream.jsonl',
    '.warpline/fabric.jsonl',
    '.warpline/refs/heads/selvage',
    'packages/paradigm/.paradigm/events/compliance-history.jsonl',
    'packages/paradigm/.paradigm/events/team-funnel.jsonl',
    'packages/paradigm/.paradigm/events/postflight-liveness.jsonl',
    'packages/gnomon/.warpline/refs/selvage',
  ];
  function run(files: string[]): string {
    const root = orchProject('none');
    for (const f of files) {
      fs.mkdirSync(path.dirname(path.join(root, f)), { recursive: true });
      fs.writeFileSync(path.join(root, f), '{}\n');
    }
    const script = `cd "${shellPath(root)}"; MODIFIED="${files.join('\n')}"; . "${shellPath(COMMON_SH)}" >/dev/null 2>&1
echo "generated=$PARADIGM_GENERATED_ONLY source=$SOURCE_COUNT"; echo "$ADVISORY"`;
    return spawnSync(SH, ['-c', script], { env: { ...baseEnv(), PATH: pathValue([stubBin(), ...SYS_PATH]), HOME: root }, encoding: 'utf8' }).stdout;
  }
  it('root and nested state only → generated-only, zero source, no orchestration advisory', () => {
    const out = run(NESTED);
    expect(out).toContain('generated=true source=0');
    expect(out).not.toContain('(orchestration)');
  });
  it('real source beside nested state still counts (control)', () => {
    const out = run([...NESTED, 'packages/gnomon/src/a.ts']);
    expect(out).toContain('generated=false source=1');
  });
});

describe('a passing Stop leaves .orchestrated in place', () => {
  for (const script of ['claude-code-stop.sh', 'cursor-stop.sh']) {
    it(script, () => {
      const root = orchProject('fresh');
      const bin = stubBin();
      const git = (...args: string[]) =>
        spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: root, encoding: 'utf8' });
      fs.writeFileSync(path.join(root, 'README.md'), 'a\n');
      fs.writeFileSync(path.join(root, '.paradigm', '.session-started'), '');
      git('init', '-q');
      git('add', 'README.md');
      git('commit', '-qm', 'init');
      fs.writeFileSync(path.join(root, 'README.md'), 'b\n'); // a non-source change → passing Stop
      const r = spawnSync(SH, [shellPath(path.join(SCRIPTS, script))], {
        input: JSON.stringify({ cwd: root, hook_event_name: 'Stop', stop_hook_active: false }),
        env: { ...baseEnv(), PATH: pathValue([bin, ...SYS_PATH]), HOME: root },
        encoding: 'utf8',
        cwd: root,
      });
      expect(r.status, r.stderr).toBe(0);
      // the pass-cleanup block ran …
      expect(fs.existsSync(path.join(root, '.paradigm', '.session-started'))).toBe(false);
      // … and the orchestration marker survived it
      expect(fs.existsSync(path.join(root, '.paradigm', '.orchestrated'))).toBe(true);
    });
  }
});

describe('team-gate and prompt-gate honour .orchestrated by TTL', () => {
  function runGate(script: string, root: string, input: object): { status: number | null; stdout: string; stderr: string } {
    const r = spawnSync(SH, [shellPath(path.join(SCRIPTS, script))], {
      input: JSON.stringify({ cwd: root, ...input }),
      cwd: root, // the hook monitor writes its ring under $PWD/.paradigm
      env: { ...baseEnv(), PATH: pathValue(SYS_PATH), HOME: root },
      encoding: 'utf8',
    });
    return { status: r.status, stdout: r.stdout, stderr: r.stderr };
  }
  const team = (root: string) => runGate('claude-code-team-gate.sh', root, { tool_name: 'Write', tool_input: { file_path: path.join(root, 'src', 'a.ts') } });
  const prompt = (root: string) => runGate('claude-code-prompt-gate.sh', root, { prompt: 'please implement the export feature for reports' });

  it('team-gate: fresh marker → silent', () => {
    const r = team(orchProject('fresh'));
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('without team orchestration');
  });
  it('team-gate: stale marker → advisory', () => {
    const r = team(orchProject('stale'));
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('Source edit without team orchestration');
  });
  it('prompt-gate: fresh marker → no directive', () => {
    const r = prompt(orchProject('fresh'));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });
  it('prompt-gate: stale marker → directive injected', () => {
    const r = prompt(orchProject('stale'));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('orchestration-eligible');
  });
});

// ---------------------------------------------------------------------------
// T-2026-10-27-005 / T-2026-10-28-002: the Stop hook judges the session's own
// Write/Edit files at the project root; markers live at the root; one block per
// violation set; pre-commit never stages; SessionStart rebuilds a fresh clone.
// Violations come from a Check 14 guard remediation (stub CLI), so the only
// variable is whether a modified file is judged at all.
// ---------------------------------------------------------------------------

/**
 * PATH without jq (exercises the grep fallbacks) but with git. POSIX: every
 * system tool but jq, symlinked into one dir. Windows: Git Bash's tools, which
 * include no jq.
 */
let noJqDir = '';
function noJqPath(): string {
  if (WIN) return pathValue(SYS_PATH);
  if (!noJqDir) {
    noJqDir = tempDir('paradigm-nojq-');
    for (const d of SYS_PATH) {
      for (const name of fs.readdirSync(d)) {
        if (name === 'jq' || fs.existsSync(path.join(noJqDir, name))) continue;
        try { fs.symlinkSync(path.join(d, name), path.join(noJqDir, name)); } catch { /* skip unreadable */ }
      }
    }
  }
  return noJqDir;
}

describe('session attribution and the project root', () => {
  const sh = (cwd: string, ...args: string[]) =>
    spawnSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8' });

  function repo(): { root: string; bin: string; worktree: string } {
    const root = tempDir('paradigm-attr-');
    const bin = tempDir('paradigm-attr-bin-');
    dirs.push(root, bin);
    fs.writeFileSync(
      path.join(bin, 'paradigm'),
      `#!/bin/sh
case "$1" in
  compliance-check) echo '{"driftedCount":0,"healedCount":0,"usedButUndeclaredCount":0}' ;;
  internal) echo '[{"id":"rmd-0","severity":"guard","claimant":"compliance","reason":"guard violation"}]' ;;
  index) pwd > "$PM_INDEX_MARK" ;;
esac
exit 0
`,
    );
    fs.chmodSync(path.join(bin, 'paradigm'), 0o755);
    fs.mkdirSync(path.join(root, '.paradigm', 'events'), { recursive: true });
    fs.writeFileSync(path.join(root, '.paradigm', 'config.yaml'), 'version: "1.0"\n');
    fs.writeFileSync(path.join(root, 'README.md'), 'a\n');
    fs.writeFileSync(path.join(root, 'NOTES.md'), 'a\n');
    sh(root, 'init', '-q');
    sh(root, 'add', '-A');
    sh(root, 'commit', '-qm', 'init');
    const worktree = path.join(root, '.claude', 'worktrees', 'agent-1');
    sh(root, 'worktree', 'add', '-q', '-b', 'agent-1', worktree);
    return { root, bin, worktree };
  }
  const ledger = (root: string, sid: string, files: string[]) => {
    fs.mkdirSync(path.join(root, '.paradigm', '.sessions'), { recursive: true });
    fs.writeFileSync(path.join(root, '.paradigm', '.sessions', `${sid}.touched`), files.map((f) => `${f}\n`).join(''));
  };
  function stop(bin: string, cwd: string, input: object) {
    return spawnSync(SH, [shellPath(path.join(SCRIPTS, 'claude-code-stop.sh'))], {
      input: JSON.stringify({ cwd, hook_event_name: 'Stop', ...input }),
      cwd,
      env: { ...baseEnv(), PATH: pathValue([bin, ...SYS_PATH]), HOME: cwd },
      encoding: 'utf8',
    });
  }

  it('a worktree cwd is judged at the project root', () => {
    const { root, bin, worktree } = repo();
    expect(fs.existsSync(path.join(worktree, '.paradigm', 'config.yaml'))).toBe(true);
    fs.writeFileSync(path.join(root, 'README.md'), 'b\n');
    ledger(root, 's1', ['README.md']);
    const r = stop(bin, worktree, { session_id: 's1', stop_hook_active: false });
    expect(r.status, r.stderr).toBe(2);
    expect(r.stderr).toContain('guard violation');
    // the block fingerprint is kept at the root, not in the worktree
    expect(fs.existsSync(path.join(root, '.paradigm', '.sessions', 's1.stop-fp'))).toBe(true);
    expect(fs.existsSync(path.join(worktree, '.paradigm', '.sessions'))).toBe(false);
  });

  it('only ledger files count; the rest is advisory', () => {
    const { root, bin } = repo();
    fs.writeFileSync(path.join(root, 'README.md'), 'b\n'); // edited by Bash / another session
    ledger(root, 's2', ['NOTES.md']); // this session touched NOTES.md, which is unchanged
    const pass = stop(bin, root, { session_id: 's2', stop_hook_active: false });
    expect(pass.status, pass.stderr).toBe(0);
    expect(pass.stderr).toContain('not edited through Write/Edit in this session');
    expect(pass.stderr).toContain('  - README.md');
    ledger(root, 's2', ['NOTES.md', 'README.md']);
    expect(stop(bin, root, { session_id: 's2', stop_hook_active: false }).status).toBe(2);
  });

  it('postwrite records the edited file in the session ledger, relative to the root', () => {
    const { root } = repo();
    const r = spawnSync(SH, [shellPath(path.join(SCRIPTS, 'claude-code-postwrite.sh'))], {
      input: JSON.stringify({ session_id: 's3', cwd: root, tool_name: 'Edit', tool_input: { file_path: path.join(root, 'README.md') } }),
      cwd: root,
      env: { ...baseEnv(), PATH: pathValue(SYS_PATH), HOME: root },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stdout + r.stderr).toBe('');
    expect(fs.readFileSync(path.join(root, '.paradigm', '.sessions', 's3.touched'), 'utf8')).toBe('README.md\n');
  });

  it('a second block under stop_hook_active becomes advisory, and stays advisory next turn', () => {
    const { root, bin } = repo();
    fs.writeFileSync(path.join(root, 'README.md'), 'b\n');
    ledger(root, 's4', ['README.md']);
    expect(stop(bin, root, { session_id: 's4', stop_hook_active: false }).status).toBe(2);
    const retry = stop(bin, root, { session_id: 's4', stop_hook_active: true });
    expect(retry.status, retry.stderr).toBe(0);
    expect(retry.stderr).toContain('unresolved after a fix attempt');
    const nextTurn = stop(bin, root, { session_id: 's4', stop_hook_active: false });
    expect(nextTurn.status, nextTurn.stderr).toBe(0);
    expect(nextTurn.stderr).toContain('already reported this session');
    // a new session blocks once again
    ledger(root, 's5', ['README.md']);
    expect(stop(bin, root, { session_id: 's5', stop_hook_active: false }).status).toBe(2);
  });

  it('a marker written at the root is honoured from a worktree (team gate + prompt gate)', () => {
    const { root, worktree } = repo();
    const gate = (script: string, input: object) =>
      spawnSync(SH, [shellPath(path.join(SCRIPTS, script))], {
        input: JSON.stringify({ session_id: 's6', cwd: worktree, ...input }),
        cwd: worktree,
        env: { ...baseEnv(), PATH: pathValue(SYS_PATH), HOME: worktree },
        encoding: 'utf8',
      });
    const team = () => gate('claude-code-team-gate.sh', { tool_name: 'Write', tool_input: { file_path: path.join(worktree, 'src', 'a.ts') } });
    const prompt = () => gate('claude-code-prompt-gate.sh', { prompt: 'please implement the export feature for reports' });
    fs.mkdirSync(path.join(root, '.paradigm', '.sessions'), { recursive: true });
    fs.writeFileSync(path.join(root, '.paradigm', '.sessions', 's6.orchestrated'), '{}');
    expect(team().stderr).not.toContain('without team orchestration');
    expect(prompt().stdout).toBe('');
    // control: without the root marker the gates speak, once per session, recommending a team agent
    fs.rmSync(path.join(root, '.paradigm', '.sessions', 's6.orchestrated'));
    const t = team();
    expect(t.stderr).toContain('delegate to a team agent');
    expect(t.stderr).not.toContain('orchestrate_inline');
    expect(team().stderr).toBe('');
    const p = prompt();
    expect(p.stdout).toContain('Delegate to a team agent');
    expect(p.stdout).not.toContain('orchestrate_inline');
    expect(fs.existsSync(path.join(root, '.paradigm', '.sessions', 's6.team-reminded'))).toBe(true);
  });

  it('no .paradigm file is staged after a commit', () => {
    const { root } = repo();
    fs.writeFileSync(path.join(root, '.paradigm', 'scan-index.json'), '{"generatedAt":"x"}\n');
    fs.writeFileSync(path.join(root, '.paradigm', 'navigator.yaml'), 'generatedAt: x\n');
    const r = spawnSync(SH, [shellPath(path.join(SCRIPTS, 'claude-code-precommit.sh'))], {
      input: JSON.stringify({ cwd: root, tool_input: { command: 'git commit -m x' } }),
      cwd: root,
      env: { ...baseEnv(), PATH: pathValue(SYS_PATH), HOME: root, CLAUDE_PROJECT_DIR: root },
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(sh(root, 'diff', '--cached', '--name-only').stdout.trim()).toBe('');
  });

  const postwrite = (root: string, input: object, opts: { noJq?: boolean } = {}) =>
    spawnSync(SH, [shellPath(path.join(SCRIPTS, 'claude-code-postwrite.sh'))], {
      input: JSON.stringify({ cwd: root, ...input }),
      cwd: root,
      env: { ...baseEnv(), PATH: opts.noJq ? noJqPath() : pathValue(SYS_PATH), HOME: root },
      encoding: 'utf8',
    });
  const backdate = (f: string) => { const t = new Date(Date.now() - 60_000); fs.utimesSync(f, t, t); };

  it('session id with no ledger: files changed since the session started are judged, older ones advisory', () => {
    const { root, bin } = repo();
    fs.writeFileSync(path.join(root, 'README.md'), 'b\n'); // changed before this session
    backdate(path.join(root, 'README.md'));
    fs.mkdirSync(path.join(root, '.paradigm', '.sessions'), { recursive: true });
    const started = path.join(root, '.paradigm', '.sessions', 'n1.started');
    fs.writeFileSync(started, '');
    fs.utimesSync(started, new Date(Date.now() - 30_000), new Date(Date.now() - 30_000));
    const before = stop(bin, root, { session_id: 'n1', stop_hook_active: false });
    expect(before.status, before.stderr).toBe(0);
    expect(before.stderr).toContain('  - README.md');
    fs.writeFileSync(path.join(root, 'NOTES.md'), 'b\n'); // changed by Bash during the session (no ledger)
    const r = stop(bin, root, { session_id: 'n1', stop_hook_active: false });
    expect(r.status, r.stderr).toBe(2);
  });

  it('session id with no ledger and no known start: the whole tree is judged (and the start is recorded)', () => {
    const { root, bin } = repo();
    fs.writeFileSync(path.join(root, 'README.md'), 'b\n');
    expect(stop(bin, root, { session_id: 'n2', stop_hook_active: false }).status).toBe(2);
    expect(fs.existsSync(path.join(root, '.paradigm', '.sessions', 'n2.started'))).toBe(true);
  });

  it('SessionStart records the session start', () => {
    const { root } = repo();
    spawnSync(SH, [shellPath(path.join(SCRIPTS, 'claude-code-session-start.sh'))], {
      input: JSON.stringify({ session_id: 'n3' }),
      cwd: root,
      env: { ...baseEnv(), PATH: pathValue(SYS_PATH), HOME: root, CLAUDE_PROJECT_DIR: root },
      encoding: 'utf8',
    });
    expect(fs.existsSync(path.join(root, '.paradigm', '.sessions', 'n3.started'))).toBe(true);
  });

  it('a Paradigm project in a subfolder of its repository is found and judged (--relative)', () => {
    const { root, bin } = repo();
    const sub = path.join(root, 'apps', 'web');
    fs.mkdirSync(path.join(sub, '.paradigm'), { recursive: true });
    fs.rmSync(path.join(root, '.paradigm'), { recursive: true });
    fs.writeFileSync(path.join(sub, 'page.md'), 'a\n');
    sh(root, 'add', '-A');
    sh(root, 'commit', '-qm', 'sub');
    fs.writeFileSync(path.join(sub, 'page.md'), 'b\n');
    // the cwd is a folder inside the project; the ledger holds project-relative paths
    fs.mkdirSync(path.join(sub, 'src'), { recursive: true });
    expect(postwrite(path.join(sub, 'src'), { session_id: 'p1', tool_name: 'Write', tool_input: { file_path: path.join(sub, 'page.md') } }).status).toBe(0);
    expect(fs.readFileSync(path.join(sub, '.paradigm', '.sessions', 'p1.touched'), 'utf8')).toBe('page.md\n');
    const r = stop(bin, path.join(sub, 'src'), { session_id: 'p1', stop_hook_active: false });
    expect(r.status, r.stderr).toBe(2);
  });

  it('CLAUDE_PROJECT_DIR wins over the cwd and the git root', () => {
    const { root, bin, worktree } = repo();
    fs.writeFileSync(path.join(worktree, 'README.md'), 'w\n');
    fs.mkdirSync(path.join(worktree, '.paradigm', '.sessions'), { recursive: true });
    fs.writeFileSync(path.join(worktree, '.paradigm', '.sessions', 'c1.touched'), 'README.md\n');
    // a session started in the worktree judges the worktree, even from the root's cwd
    const r = spawnSync(SH, [shellPath(path.join(SCRIPTS, 'claude-code-stop.sh'))], {
      input: JSON.stringify({ cwd: root, hook_event_name: 'Stop', session_id: 'c1' }),
      cwd: root,
      env: { ...baseEnv(), PATH: pathValue([bin, ...SYS_PATH]), HOME: root, CLAUDE_PROJECT_DIR: worktree },
      encoding: 'utf8',
    });
    expect(r.status, r.stderr).toBe(2);
    expect(fs.existsSync(path.join(worktree, '.paradigm', '.sessions', 'c1.stop-fp'))).toBe(true);
    expect(fs.existsSync(path.join(root, '.paradigm', '.sessions', 'c1.stop-fp'))).toBe(false);
  });

  it('no git: the cwd holding .paradigm is the root, and the postwrite ledger still works', () => {
    const root = tempDir('paradigm-nogit-');
    dirs.push(root);
    fs.mkdirSync(path.join(root, '.paradigm'), { recursive: true });
    expect(postwrite(root, { session_id: 'g1', tool_name: 'Write', tool_input: { file_path: path.join(root, 'a.md') } }).status).toBe(0);
    expect(fs.readFileSync(path.join(root, '.paradigm', '.sessions', 'g1.touched'), 'utf8')).toBe('a.md\n');
  });

  for (const noJq of [false, true]) {
    it(`postwrite ${noJq ? 'without jq' : 'with jq'}: NotebookEdit, MultiEdit, spaces and Windows backslashes`, () => {
      const { root } = repo();
      const nb = path.join(root, 'notes', 'my book.ipynb');
      fs.mkdirSync(path.dirname(nb), { recursive: true });
      postwrite(root, { session_id: 'w1', tool_name: 'NotebookEdit', tool_input: { notebook_path: nb } }, { noJq });
      postwrite(root, { session_id: 'w1', tool_name: 'MultiEdit', tool_input: { file_path: path.join(root, 'two words.md'), edits: [] } }, { noJq });
      // Claude Code on Windows sends backslash paths; they are normalised to forward slashes
      const win = path.join(root, 'src', 'w.ts').replace(/\//g, '\\');
      postwrite(root, { session_id: 'w1', tool_name: 'Edit', tool_input: { file_path: win } }, { noJq });
      postwrite(root, { session_id: 'w1', tool_name: 'Edit', tool_input: { file_path: path.join(root, 'two words.md') } }, { noJq }); // deduped
      expect(fs.readFileSync(path.join(root, '.paradigm', '.sessions', 'w1.touched'), 'utf8'))
        .toBe('notes/my book.ipynb\ntwo words.md\nsrc/w.ts\n');
    });
  }

  it('a changed file with spaces in its name is attributed by the Stop hook', () => {
    const { root, bin } = repo();
    fs.writeFileSync(path.join(root, 'my notes.md'), 'a\n');
    sh(root, 'add', '-A');
    sh(root, 'commit', '-qm', 'space');
    fs.writeFileSync(path.join(root, 'my notes.md'), 'b\n');
    ledger(root, 'sp', ['NOTES.md']);
    const pass = stop(bin, root, { session_id: 'sp', stop_hook_active: false });
    expect(pass.status, pass.stderr).toBe(0);
    expect(pass.stderr).toContain('  - my notes.md');
    ledger(root, 'sp', ['my notes.md']);
    expect(stop(bin, root, { session_id: 'sp', stop_hook_active: false }).status).toBe(2);
  });

  it('without a session id the identical set blocks again on a later turn (no shared silencing)', () => {
    const { root, bin } = repo();
    fs.writeFileSync(path.join(root, 'README.md'), 'b\n');
    expect(stop(bin, root, { stop_hook_active: false }).status).toBe(2);
    expect(stop(bin, root, { stop_hook_active: false }).status).toBe(2);
  });

  it('a fresh clone rebuilds the index at SessionStart; an indexed one does not', async () => {
    const { root, bin } = repo();
    const mark = path.join(bin, 'index-ran');
    const start = () =>
      spawnSync(SH, [shellPath(path.join(SCRIPTS, 'claude-code-session-start.sh'))], {
        input: JSON.stringify({ session_id: 's7' }),
        cwd: root,
        env: { ...baseEnv(), PATH: pathValue([bin, ...SYS_PATH]), HOME: root, CLAUDE_PROJECT_DIR: root, PM_INDEX_MARK: mark },
        encoding: 'utf8',
        timeout: 10_000,
      });
    expect(start().status).toBe(0);
    for (let i = 0; i < 50 && !fs.existsSync(mark); i++) await new Promise((r) => setTimeout(r, 100));
    expect(fs.realpathSync(fs.readFileSync(mark, 'utf8').trim())).toBe(fs.realpathSync(root));
    fs.rmSync(mark);
    fs.writeFileSync(path.join(root, '.paradigm', 'scan-index.json'), '{}');
    fs.writeFileSync(path.join(root, '.paradigm', 'navigator.yaml'), 'a: 1\n');
    expect(start().status).toBe(0);
    await new Promise((r) => setTimeout(r, 500));
    expect(fs.existsSync(mark)).toBe(false);
  });
});
