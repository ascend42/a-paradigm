/**
 * Hook timing regression (7.15.2): every Claude Code plugin hook must exit AND
 * close its stdout/stderr pipe promptly. Claude Code waits for EOF on the
 * hook's pipes, not for the script's exit, so a background child that inherits
 * them — or a slow foreground scan — turns into a stall up to the hook timeout
 * (the Stop hook's 30 s) on every turn.
 *
 * The Stop fixture is a git repo with 16 nested agent worktrees (each its own
 * repo full of .purpose files with anchors): the layout that made the old
 * `find`-based discovery + per-line-fork Check 4 take 30 s+.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, execFileSync } from 'child_process';

const PLUGIN_SCRIPTS = path.resolve(__dirname, '..', '..', '..', 'plugins', 'paradigm', 'scripts');
const BUDGET_MS = Number(process.env.PARADIGM_HOOK_BUDGET_MS || 2000);

let root: string;
let binDir: string;

function git(cwd: string, ...args: string[]): void {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'ignore' });
}

function writePurposes(base: string, n: number): void {
  for (let i = 0; i < n; i++) {
    const dir = path.join(base, 'packages', `p${i}`);
    fs.mkdirSync(dir, { recursive: true });
    const anchors = Array.from({ length: 40 }, (_, k) => `      - src/missing-${k}.ts`).join('\n');
    fs.writeFileSync(path.join(dir, '.purpose'), `aspects:\n  a${i}:\n    anchors:\n${anchors}\n`);
  }
}

/** Run a hook the way Claude Code does; resolve when BOTH pipes hit EOF. */
function runHook(script: string, input: object, extraEnv: Record<string, string> = {}): Promise<{ ms: number; code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const start = Date.now();
    const ch = spawn('/bin/sh', [path.join(PLUGIN_SCRIPTS, script)], {
      cwd: root,
      env: { PATH: `${binDir}:/usr/bin:/bin`, HOME: root, ...extraEnv },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    let code: number | null = null;
    let open = 2;
    let exited = false;
    const done = (): void => {
      if (open === 0 && exited) resolve({ ms: Date.now() - start, code, stderr });
    };
    ch.stdout.on('data', () => {});
    ch.stderr.on('data', (d) => (stderr += d));
    ch.stdout.on('close', () => { open--; done(); });
    ch.stderr.on('close', () => { open--; done(); });
    ch.on('exit', (c) => { code = c; exited = true; done(); });
    ch.stdin.end(JSON.stringify({ session_id: 't', cwd: root, ...input }));
  });
}

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-hook-timing-'));
  binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-hook-timing-bin-'));
  fs.mkdirSync(path.join(root, '.paradigm', 'events'), { recursive: true });
  fs.writeFileSync(path.join(root, '.paradigm', 'events', 'verdicts.jsonl'), '{"verdict":"accepted","agent":"x"}\n');
  writePurposes(root, 20);
  fs.mkdirSync(path.join(root, 'packages', 'p0', 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'packages', 'p0', 'src', 'a.ts'), 'export const a = 1;\n');
  git(root, 'init', '-q');
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'init');
  for (let w = 0; w < 16; w++) {
    const wt = path.join(root, '.claude', 'worktrees', `agent-${w}`);
    writePurposes(wt, 20);
    git(wt, 'init', '-q');
  }
  fs.appendFileSync(path.join(root, 'packages', 'p0', 'src', 'a.ts'), '// edit\n');
  // Stub CLI: fast checks, but every "fire-and-forget" verb sleeps 10 s. If any
  // hook backgrounds one without detaching it, the pipe stays open and the
  // EOF-based timing below blows the budget.
  fs.writeFileSync(
    path.join(binDir, 'paradigm'),
    `#!/bin/sh
case "$1 $2" in
  "ambient postflight"|"event emit") sleep 10; exit 0 ;;
esac
case "$1" in
  compliance-check) echo '{"driftedCount":0,"healedCount":0,"usedButUndeclaredCount":0}' ;;
  internal) echo '[]' ;;
esac
exit 0
`,
  );
  fs.chmodSync(path.join(binDir, 'paradigm'), 0o755);
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(binDir, { recursive: true, force: true });
});

describe('plugin hooks close their pipes within budget', () => {
  it('Stop: blocks (missing anchors) and closes the pipe fast, ignoring nested worktrees', async () => {
    const r = await runHook('paradigm-stop.sh', { hook_event_name: 'Stop', stop_hook_active: false });
    expect(r.code).toBe(2); // blocking contract intact
    expect(r.stderr).toContain("Aspect anchor 'src/missing-0.ts' in ./packages/p0/.purpose does not exist");
    expect(r.stderr).not.toContain('.claude/worktrees');
    expect(r.ms).toBeLessThan(BUDGET_MS);
  }, 60_000);

  const cases: Array<[string, string, object]> = [
    ['PreToolUse Bash', 'paradigm-precommit.sh', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }],
    ['PreToolUse Glob', 'paradigm-navigate-remind.sh', { hook_event_name: 'PreToolUse', tool_name: 'Glob', tool_input: { pattern: '*' } }],
    ['PreToolUse Write', 'paradigm-team-gate.sh', { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: '/x/src/a.ts' } }],
    ['UserPromptSubmit', 'paradigm-prompt-gate.sh', { hook_event_name: 'UserPromptSubmit', prompt: 'implement a feature' }],
    ['PostToolUse Write', 'paradigm-postwrite.sh', { hook_event_name: 'PostToolUse', tool_name: 'Write' }],
    ['PostToolUse Skill', 'paradigm-skill-used.sh', { hook_event_name: 'PostToolUse', tool_name: 'Skill', tool_input: { skill: 'pdg-x' } }],
  ];
  for (const [label, script, input] of cases) {
    it(`${label}: exits and closes the pipe within budget`, async () => {
      const r = await runHook(script, input);
      expect(r.code).not.toBeNull();
      expect(r.ms).toBeLessThan(BUDGET_MS);
    }, 30_000);
  }

  it('no plugin hook backgrounds a command without detaching all three fds', () => {
    for (const f of fs.readdirSync(PLUGIN_SCRIPTS).filter((x) => x.endsWith('.sh'))) {
      const lines = fs.readFileSync(path.join(PLUGIN_SCRIPTS, f), 'utf8').split('\n');
      for (const line of lines) {
        const code = line.replace(/^\s*#.*$/, '');
        if (/[^&]&\s*$/.test(code)) {
          expect(code, `${f}: ${line.trim()}`).toMatch(/<\s*\/dev\/null\s*>\s*\/dev\/null\s+2>&1\s*&\s*$/);
        }
      }
    }
  });
});
