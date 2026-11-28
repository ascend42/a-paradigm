/**
 * Warnings from every check reach the hook's output. ADVISORY used to be reset
 * to "" at Check 6, so a check 1-5 configured at `warn` (and the missing-CLI
 * warning) computed its message and then lost it: `warn` behaved like `off`.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { SH, SYS_PATH, baseEnv, pathValue, shellPath, tempDir } from '../src/test-shell-utils.js';

const SCRIPTS = path.resolve(__dirname, '..', 'src', 'commands', 'hooks', 'scripts');
const COMMON_SH = path.join(SCRIPTS, 'paradigm-common.sh');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

/** A stub `paradigm` whose `enforcement resolve --json` returns `map`. */
function stubBin(map: Record<string, string>): string {
  const bin = tempDir('paradigm-adv-bin-');
  dirs.push(bin);
  fs.writeFileSync(path.join(bin, 'enforcement.json'), JSON.stringify(map, null, 2));
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

/** One modified source file under src/, whose covering src/.purpose was NOT updated. */
function project(opts: { covered?: boolean } = {}): string {
  const root = tempDir('paradigm-adv-');
  dirs.push(root);
  fs.mkdirSync(path.join(root, '.paradigm', 'events'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const x = 1;\n');
  if (opts.covered !== false) {
    fs.writeFileSync(path.join(root, 'src', '.purpose'), 'version: 2.0.0\ncomponents:\n  x:\n    description: x\n');
  }
  return root;
}

const ALL_OFF = {
  'purpose-coverage': 'off',
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

/** Source paradigm-common.sh for the project; return ADVISORY and the violation count. */
function run(map: Record<string, string>, opts: { covered?: boolean } = {}): { advisory: string; violations: number } {
  const root = project(opts);
  const bin = stubBin(map);
  const script = `SCRIPT_DIR="${shellPath(SCRIPTS)}"; cd "${shellPath(root)}"; MODIFIED="src/a.ts"; . "${shellPath(COMMON_SH)}" >/dev/null 2>&1
echo "VC=$VIOLATION_COUNT"; echo "$ADVISORY"`;
  const r = spawnSync(SH, ['-c', script], {
    env: { ...baseEnv(), PATH: pathValue([bin, ...SYS_PATH]), HOME: root },
    encoding: 'utf8',
  });
  const out = r.stdout.replace(/\r\n/g, '\n');
  return { advisory: out, violations: Number(/VC=(\d+)/.exec(out)?.[1] ?? -1) };
}

describe('a `warn` severity on an early check reaches the output', () => {
  it('Check 1 (purpose-coverage: warn) is in ADVISORY after all checks ran', () => {
    const { advisory, violations } = run({ ...ALL_OFF, 'purpose-coverage': 'warn' });
    expect(violations).toBe(0);
    expect(advisory).toContain('(warn) Source files in 1 director(ies) modified without .purpose updates');
  });

  it('Check 2 (purpose-exists: warn) is in ADVISORY after all checks ran', () => {
    const { advisory, violations } = run({ ...ALL_OFF, 'purpose-exists': 'warn' }, { covered: false });
    expect(violations).toBe(0);
    expect(advisory).toContain('(warn) Directories with modified source files that no .purpose documents');
  });

  it('with every check off there is no warning (control)', () => {
    const { advisory, violations } = run(ALL_OFF);
    expect(violations).toBe(0);
    expect(advisory).not.toContain('(warn)');
  });

  it('the script initialises ADVISORY once, beside VIOLATIONS, and never resets it', () => {
    const src = fs.readFileSync(COMMON_SH, 'utf8').replace(/\r\n/g, '\n');
    const resets = src.split('\n').filter((l) => /^\s*ADVISORY=""\s*$/.test(l));
    expect(resets).toHaveLength(1);
    expect(src.indexOf('\nADVISORY=""')).toBeLessThan(src.indexOf('_check_severity()'));
    // every other assignment appends
    const assigns = src.split('\n').filter((l) => /^\s*ADVISORY="/.test(l) && !/^\s*ADVISORY=""\s*$/.test(l));
    for (const l of assigns) expect(l.trim().startsWith('ADVISORY="$ADVISORY')).toBe(true);
  });
});

describe('the Stop hook prints an early-check warning', () => {
  it('claude-code-stop.sh passes (exit 0) and prints the Check 1 warning under "Advisory:"', () => {
    const root = project();
    const bin = stubBin({ ...ALL_OFF, 'purpose-coverage': 'warn' });
    // The Stop hook judges `git diff HEAD`: commit the tree, then change the source file.
    const git = (...args: string[]) =>
      spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'core.autocrlf=false', ...args], { cwd: root, encoding: 'utf8' });
    git('init', '-q');
    git('add', '-A');
    git('commit', '-q', '-m', 'init');
    fs.writeFileSync(path.join(root, 'src', 'a.ts'), 'export const x = 2;\n');
    const r = spawnSync(SH, [shellPath(path.join(SCRIPTS, 'claude-code-stop.sh'))], {
      input: JSON.stringify({ stop_hook_active: false }),
      cwd: root,
      env: { ...baseEnv(), PATH: pathValue([bin, ...SYS_PATH]), HOME: root, CLAUDE_PROJECT_DIR: root },
      encoding: 'utf8',
      timeout: 20_000,
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('[paradigm] Advisory:');
    expect(r.stderr).toContain('(warn) Source files in');
  });
});
