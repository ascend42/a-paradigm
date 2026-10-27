/**
 * hooks-missing-cli.test — how the hooks find the paradigm CLI, and the
 * fail-closed behavior of paradigm-common.sh when it cannot be resolved.
 *
 * paradigm-common.sh resolves the CLI once at the top through paradigm-resolve.sh
 * (shared with the pre-commit hooks and the git hooks):
 *   - the project root's own @a-company/paradigm: node runs the package's own
 *     `paradigm` bin entry (never whatever sits at node_modules/.bin/paradigm),
 *     at $CWD (never $PWD, never a parent folder), never a copy committed to
 *     git. No npx: npm 11 applies the project's devEngines to npx, so a
 *     pnpm-only repo fails EBADDEVENGINES. Else
 *   - `command -v paradigm`. Nothing else: no npx step at all.
 * When neither resolves, PARADIGM_AVAILABLE stays false and the hook:
 *   1. prints a loud stderr banner ("compliance checks were SKIPPED … NOT a
 *      clean pass"), and
 *   2. records a BLOCKING violation (fail-closed), never a silent clean pass.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const SCRIPTS = path.resolve(__dirname, '..', 'src', 'commands', 'hooks', 'scripts');
const COMMON_SH = path.join(SCRIPTS, 'paradigm-common.sh');

let cleanups: Array<() => void> = [];
afterEach(() => { cleanups.forEach((fn) => fn()); cleanups = []; });

/** A dir holding only `node` (the local copy runs through node), so PATH gains nothing else. */
function nodeOnlyDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-node-'));
  fs.symlinkSync(process.execPath, path.join(d, 'node'));
  cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

/**
 * <root>/node_modules/@a-company/paradigm with a `paradigm` bin entry (JS body),
 * and optionally something else at node_modules/.bin/paradigm (sh body).
 */
function installLocal(root: string, entry?: string, dotBin?: string): void {
  if (entry !== undefined) {
    const pkgDir = path.join(root, 'node_modules', '@a-company', 'paradigm');
    fs.mkdirSync(path.join(pkgDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@a-company/paradigm', bin: { paradigm: './dist/index.js' } }));
    fs.writeFileSync(path.join(pkgDir, 'dist', 'index.js'), entry);
  }
  if (dotBin !== undefined) {
    const p = path.join(root, 'node_modules', '.bin', 'paradigm');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, dotBin, { mode: 0o755 });
  }
}

/** A paradigm entry (JS) that answers compliance-check cleanly and drops `$HOME/<marker>` when it runs it. */
const localEntry = (marker: string): string => `
const a = process.argv[2];
if (a === 'compliance-check') {
  require('fs').writeFileSync(require('path').join(process.env.HOME, ${JSON.stringify(marker)}), '');
  process.stdout.write('{"driftedCount":0,"healedCount":0,"usedButUndeclaredCount":0}');
}
`;

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  violationCount: number;
  violations: string;
  paradigmAvailable: string;
  rootDir: string;
}

/**
 * Seed a minimal Paradigm project with a modified-source diff that WOULD block
 * only via a real compliance run, then source paradigm-common.sh with a chosen
 * PATH (plus a dir holding only node). `binDir` may hold stubbed `paradigm` /
 * `npx` executables.
 */
function run(opts: {
  path: string;                        // PATH for the shell
  binScripts?: Record<string, string>; // name → sh body (chmod +x)
  localEntry?: string;                 // JS body of node_modules/@a-company/paradigm's paradigm bin
  dotBin?: string;                     // sh body for node_modules/.bin/paradigm (another package's)
  rootPrefix?: string;
  modified?: string[];
  subdir?: string;                     // run from <root>/<subdir> (CWD stays the root)
  gitTracked?: boolean;                // git init the root and `git add -f` the local package
}): RunResult {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), opts.rootPrefix ?? 'paradigm-nocli-'));
  const binDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-nocli-bin-'));
  cleanups.push(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  });

  fs.mkdirSync(path.join(rootDir, '.paradigm', 'events'), { recursive: true });
  // A modified source file with NO covering .purpose — a real compliance run is
  // not what makes this block; the missing-CLI fail-closed path is.
  fs.mkdirSync(path.join(rootDir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(rootDir, 'src', 'foo.ts'), 'export const x = 1;\n');
  if (opts.subdir) fs.mkdirSync(path.join(rootDir, opts.subdir), { recursive: true });
  installLocal(rootDir, opts.localEntry, opts.dotBin);
  if (opts.gitTracked) {
    spawnSync('git', ['init', '-q', rootDir]);
    spawnSync('git', ['add', '-f', 'node_modules/@a-company/paradigm'], { cwd: rootDir, env: { PATH: '/usr/bin:/bin', HOME: rootDir } });
  }

  for (const [name, body] of Object.entries(opts.binScripts ?? {})) {
    const p = path.join(binDir, name);
    fs.writeFileSync(p, body, 'utf8');
    fs.chmodSync(p, 0o755);
  }

  const script = `
set +e
cd "${opts.subdir ? path.join(rootDir, opts.subdir) : rootDir}"
. "${COMMON_SH}"
echo "===PARADIGM_AVAILABLE==="
echo "$PARADIGM_AVAILABLE"
echo "===VIOLATION_COUNT==="
echo "$VIOLATION_COUNT"
echo "===VIOLATIONS==="
echo "$VIOLATIONS"
`;
  const res = spawnSync('bash', ['-c', script], {
    encoding: 'utf8',
    env: {
      PATH: [...(opts.binScripts ? [binDir] : []), nodeOnlyDir(), opts.path].join(':'),
      HOME: rootDir,
      CWD: rootDir,
      MODIFIED: (opts.modified ?? ['src/foo.ts']).join('\n'),
    },
  });

  const sections = (res.stdout ?? '').split(/===([A-Z_]+)===\n/);
  const out: Record<string, string> = {};
  for (let i = 1; i < sections.length; i += 2) out[sections[i]] = (sections[i + 1] ?? '').trimEnd();
  return {
    status: res.status,
    stdout: res.stdout ?? '',
    stderr: res.stderr ?? '',
    violationCount: Number(out.VIOLATION_COUNT?.trim() ?? '0') || 0,
    violations: out.VIOLATIONS ?? '',
    paradigmAvailable: out.PARADIGM_AVAILABLE?.trim() ?? '',
    rootDir,
  };
}

const ran = (r: RunResult, marker: string): boolean => fs.existsSync(path.join(r.rootDir, marker));

describe('paradigm-common.sh — missing-CLI fail-closed', () => {
  it('no paradigm → loud banner + blocking violation (NOT a clean pass)', () => {
    const r = run({ path: '/usr/bin:/bin' });
    expect(r.paradigmAvailable).toBe('false');
    // Loud stderr banner.
    expect(r.stderr).toContain('paradigm CLI not found');
    expect(r.stderr).toContain('NOT a clean pass');
    // Fail-closed: at least one blocking violation citing the missing CLI.
    expect(r.violationCount).toBeGreaterThanOrEqual(1);
    expect(r.violations).toContain('paradigm CLI not found');
  });

  it('deduped: missing CLI reports ONCE (upfront), not the misleading exit-127 bullet', () => {
    const r = run({ path: '/usr/bin:/bin' });
    // The upfront missing-CLI violation fires, with an actionable install hint.
    expect(r.violations).toContain('compliance checks were SKIPPED');
    // The exit-127 compliance-run branch is gated on PARADIGM_AVAILABLE=true, so
    // when the CLI is absent it does NOT ALSO fire — no "run paradigm
    // compliance-check manually" bullet for a CLI that does not exist to run.
    expect(r.violations).not.toContain('compliance-check failed to run (exit 127)');
    // The missing-CLI root cause is reported EXACTLY ONCE (other violations in
    // the fixture, e.g. uncovered modified source, are counted separately).
    const skippedBullets = r.violations.split('compliance checks were SKIPPED').length - 1;
    expect(skippedBullets).toBe(1);
  });

  it('npx is never called: with only npx available the hook fails closed', () => {
    // A stub npx that would "find" paradigm; it must never be asked.
    const npxStub = `#!/bin/sh
echo "$*" >> "$HOME/.npx-calls"
exit 0
`;
    const r = run({ path: '/usr/bin:/bin', binScripts: { npx: npxStub } });
    expect(r.paradigmAvailable).toBe('false');
    expect(r.violations).toContain('paradigm CLI not found');
    expect(ran(r, '.npx-calls')).toBe(false);
  });

  it('with a working paradigm stub present → no missing-CLI violation, PARADIGM_AVAILABLE=true', () => {
    // Minimal stub answering the calls paradigm-common.sh makes.
    const stub = `#!/bin/sh
case "$1" in
  --version) echo "9.9.9"; exit 0 ;;
  enforcement) exit 0 ;;
  compliance-check) echo '{"driftedCount":0,"healedCount":0,"usedButUndeclaredCount":0}'; exit 0 ;;
  internal) exit 0 ;;
  *) exit 0 ;;
esac
`;
    const r = run({ path: '/usr/bin:/bin', binScripts: { paradigm: stub } });
    expect(r.paradigmAvailable).toBe('true');
    expect(r.stderr).not.toContain('paradigm CLI not found');
    expect(r.violations).not.toContain('compliance checks were SKIPPED');
    expect(r.violations).not.toContain('compliance-check failed to run');
  });
});

describe('paradigm-resolve.sh — the project copy', () => {
  it("the project's own @a-company/paradigm runs without npx, even under a path with spaces", () => {
    // npx fails the way npm 11 does in a repo whose devEngines require pnpm.
    const npxStub = `#!/bin/sh
echo "npm error EBADDEVENGINES" >&2
exit 1
`;
    const r = run({ path: '/usr/bin:/bin', binScripts: { npx: npxStub }, localEntry: localEntry('.local-ran'), rootPrefix: 'paradigm local-' });
    expect(r.paradigmAvailable).toBe('true');
    expect(r.violations).not.toContain('compliance checks were SKIPPED');
    expect(r.violations).not.toContain('compliance-check failed to run');
    expect(ran(r, '.local-ran')).toBe(true);
  });

  it('a bare node_modules/.bin/paradigm without the @a-company/paradigm package is not run', () => {
    const r = run({ path: '/usr/bin:/bin', dotBin: '#!/bin/sh\n: > "$HOME/.planted-ran"\nexit 0\n' });
    expect(r.paradigmAvailable).toBe('false');
    expect(ran(r, '.planted-ran')).toBe(false);
  });

  it("the package's own entry runs, not a .bin/paradigm another package put there", () => {
    const r = run({
      path: '/usr/bin:/bin',
      localEntry: localEntry('.local-ran'),
      dotBin: '#!/bin/sh\n: > "$HOME/.planted-ran"\nexit 0\n',
    });
    expect(r.paradigmAvailable).toBe('true');
    expect(ran(r, '.local-ran')).toBe(true);
    expect(ran(r, '.planted-ran')).toBe(false);
  });

  it('wins over a global paradigm on PATH', () => {
    const r = run({
      path: '/usr/bin:/bin',
      binScripts: { paradigm: '#!/bin/sh\n: > "$HOME/.global-ran"\nexit 0\n' },
      localEntry: localEntry('.local-ran'),
    });
    expect(r.paradigmAvailable).toBe('true');
    expect(ran(r, '.local-ran')).toBe(true);
    expect(ran(r, '.global-ran')).toBe(false);
  });

  it('looks in the project root ($CWD), not the directory the hook runs in', () => {
    const r = run({ path: '/usr/bin:/bin', localEntry: localEntry('.local-ran'), subdir: 'src/deep' });
    expect(r.paradigmAvailable).toBe('true');
    expect(ran(r, '.local-ran')).toBe(true);
  });

  it('a copy committed to git is never run (the global one is used instead)', () => {
    const r = run({
      path: '/usr/bin:/bin',
      binScripts: { paradigm: '#!/bin/sh\n: > "$HOME/.global-ran"\nexit 0\n' },
      localEntry: localEntry('.local-ran'),
      gitTracked: true,
    });
    expect(r.paradigmAvailable).toBe('true');
    expect(ran(r, '.local-ran')).toBe(false);
    expect(ran(r, '.global-ran')).toBe(true);
  });
});

/**
 * The pre-commit hooks resolve the CLI through the same paradigm-resolve.sh and
 * run from the project root, even when `git commit` runs in a subdirectory.
 */
describe.skipIf(process.platform === 'win32')('pre-commit hooks — local CLI from the project root', () => {
  const ENTRY = `
if (process.argv[2] === 'index') require('fs').writeFileSync(require('path').join(process.env.HOME, '.local-index-ran'), process.cwd());
`;

  function precommit(
    hook: string,
    input: (root: string) => object,
    env: (root: string) => Record<string, string> = () => ({}),
    git = true, // false: no repo, so only the input / env can name the root
  ) {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm precommit-')));
    cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, '.paradigm'), { recursive: true });
    fs.mkdirSync(path.join(root, 'packages', 'app'), { recursive: true });
    installLocal(root, ENTRY);
    if (git) spawnSync('git', ['init', '-q', root]);
    const res = spawnSync('sh', [path.join(SCRIPTS, hook)], {
      cwd: path.join(root, 'packages', 'app'),
      input: JSON.stringify(input(root)),
      encoding: 'utf8',
      env: { PATH: `${nodeOnlyDir()}:/usr/bin:/bin`, HOME: root, PARADIGM_HOOK_MONITOR_OFF: '1', ...env(root) },
    });
    const marker = path.join(root, '.local-index-ran');
    return { status: res.status, ranIn: fs.existsSync(marker) ? fs.realpathSync(fs.readFileSync(marker, 'utf8').trim()) : null, root };
  }

  it('without a repo or project dir, a subdirectory is not mistaken for the root', () => {
    const r = precommit('claude-code-precommit.sh', () => ({ tool_input: { command: 'git commit -m x' } }), undefined, false);
    expect(r.status).toBe(0);
    expect(r.ranIn).toBeNull();
  });

  it('claude-code-precommit.sh run from a subdirectory (git toplevel) runs the local CLI in the root', () => {
    const r = precommit('claude-code-precommit.sh', () => ({ tool_input: { command: 'git commit -m x' } }));
    expect(r.status).toBe(0);
    expect(r.ranIn).toBe(r.root);
  });

  it('claude-code-precommit.sh prefers CLAUDE_PROJECT_DIR', () => {
    const r = precommit('claude-code-precommit.sh', () => ({ tool_input: { command: 'git commit -m x' } }), (root) => ({ CLAUDE_PROJECT_DIR: root }), false);
    expect(r.ranIn).toBe(r.root);
  });

  it('cursor-precommit.sh run from a subdirectory (git toplevel) runs the local CLI in the root', () => {
    const r = precommit('cursor-precommit.sh', () => ({ command: 'git commit -m x' }));
    expect(r.status).toBe(0);
    expect(r.ranIn).toBe(r.root);
  });

  it("cursor-precommit.sh uses the input's cwd", () => {
    const r = precommit('cursor-precommit.sh', (root) => ({ command: 'git commit -m x', cwd: root }), undefined, false);
    expect(r.ranIn).toBe(r.root);
  });
});
