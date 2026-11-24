/**
 * The Stop hook's failure output points only at help that exists.
 *
 * It used to end every block with "Help: See .paradigm/docs/troubleshooting.md",
 * whether or not the project had that file. It now names the file only when it
 * is there, and otherwise names `paradigm doctor`, which every install has.
 * Covers both stop hooks (Claude Code and Cursor).
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { SH, SYS_PATH, baseEnv, pathValue, shellPath, tempDir } from '../src/test-shell-utils.js';

const SCRIPTS = path.resolve(__dirname, '..', 'src', 'commands', 'hooks', 'scripts');
const DOC_LINE = 'Help: See .paradigm/docs/troubleshooting.md for step-by-step resolution guides.';
const DOCTOR_LINE = 'Help: Run `paradigm doctor` to check this project\'s setup';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

/** Every check off except Check 1, which blocks. */
const BLOCK_ON_COVERAGE = {
  'purpose-coverage': 'block',
  'purpose-exists': 'off',
  'portal-gates': 'off',
  'aspect-anchors': 'off',
  'purpose-freshness': 'off',
  'aspect-advisory': 'off',
  'lore-required': 'off',
  'habits-blocking': 'off',
  'purpose-required-patterns': 'off',
  'drift-detection': 'off',
  'portal-compliance': 'off',
  'graduation-tracking': 'off',
  'orchestration-required': 'off',
};

/** A stub `paradigm` whose `enforcement resolve --json` returns the map above. */
function stubBin(): string {
  const bin = tempDir('paradigm-help-bin-');
  dirs.push(bin);
  fs.writeFileSync(path.join(bin, 'enforcement.json'), JSON.stringify(BLOCK_ON_COVERAGE, null, 2));
  fs.writeFileSync(
    path.join(bin, 'paradigm'),
    `#!/bin/sh
case "$1" in
  enforcement) cat "${shellPath(path.join(bin, 'enforcement.json'))}" ;;
  compliance-check) echo '{"driftedCount":0,"healedCount":0,"usedButUndeclaredCount":0}' ;;
  internal) echo '[]' ;;
esac
exit 0
`,
  );
  fs.chmodSync(path.join(bin, 'paradigm'), 0o755);
  return bin;
}

/**
 * A committed project with one source file changed and its covering .purpose
 * left alone: Check 1 blocks. `withDoc` adds the troubleshooting guide.
 */
function blockedProject(withDoc: boolean): string {
  const root = tempDir('paradigm-help-');
  dirs.push(root);
  fs.mkdirSync(path.join(root, '.paradigm', 'events'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const x = 1;\n');
  fs.writeFileSync(path.join(root, 'src', '.purpose'), 'version: 2.0.0\ncomponents:\n  x:\n    description: x\n');
  if (withDoc) {
    fs.mkdirSync(path.join(root, '.paradigm', 'docs'), { recursive: true });
    fs.writeFileSync(path.join(root, '.paradigm', 'docs', 'troubleshooting.md'), '# Troubleshooting\n');
  }
  const git = (...args: string[]) =>
    spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...args], { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-q', '-m', 'init');
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const x = 2;\n');
  return root;
}

function runHook(script: string, input: unknown, withDoc: boolean): { status: number | null; stderr: string } {
  const root = blockedProject(withDoc);
  const bin = stubBin();
  const r = spawnSync(SH, [shellPath(path.join(SCRIPTS, script))], {
    input: JSON.stringify(input),
    cwd: root,
    env: { ...baseEnv(), PATH: pathValue([bin, ...SYS_PATH]), HOME: root, CLAUDE_PROJECT_DIR: root },
    encoding: 'utf8',
    timeout: 20_000,
  });
  return { status: r.status, stderr: r.stderr.replace(/\r\n/g, '\n') };
}

describe.each([
  ['claude-code-stop.sh', { stop_hook_active: false }],
  ['cursor-stop.sh', {}],
])('%s: the help line of a blocked Stop', (script, input) => {
  it('names `paradigm doctor`, not a troubleshooting guide the project does not have', () => {
    const r = runHook(script, input, false);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Paradigm compliance check failed');
    expect(r.stderr).toContain(DOCTOR_LINE);
    expect(r.stderr).toContain('`paradigm doctor --explain` describes each issue');
    expect(r.stderr).not.toContain('troubleshooting.md');
  });

  it('names the troubleshooting guide when the project has one', () => {
    const r = runHook(script, input, true);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(DOC_LINE);
    expect(r.stderr).not.toContain(DOCTOR_LINE);
  });
});

describe('no hook script points at the troubleshooting guide unconditionally', () => {
  it.each(['claude-code-stop.sh', 'cursor-stop.sh'])('%s guards the pointer with a file test', (script) => {
    const src = fs.readFileSync(path.join(SCRIPTS, script), 'utf8').replace(/\r\n/g, '\n');
    const lines = src.split('\n');
    const at = lines.findIndex((l) => l.includes(DOC_LINE));
    expect(at).toBeGreaterThan(0);
    expect(lines[at - 1].trim()).toBe('if [ -f "$CWD/.paradigm/docs/troubleshooting.md" ]; then');
    expect(lines.filter((l) => l.includes('troubleshooting.md') && l.trim().startsWith('echo'))).toHaveLength(1);
  });
});
