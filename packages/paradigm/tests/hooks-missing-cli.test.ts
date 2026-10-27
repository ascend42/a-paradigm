/**
 * hooks-missing-cli.test — fail-closed behavior of paradigm-common.sh when the
 * paradigm CLI cannot be resolved.
 *
 * The fix (paradigm-common.sh:42-108) resolves the CLI once at the top:
 *   - `command -v paradigm`, else
 *   - the project's own node_modules/.bin/paradigm (no npx: npm 11 applies the
 *     project's devEngines to npx, so a pnpm-only repo fails EBADDEVENGINES), else
 *   - `npx --no-install paradigm --version` (the `--no-install` flag guarantees
 *     npx NEVER auto-installs the unrelated public `paradigm` registry package).
 * When neither resolves, PARADIGM_AVAILABLE stays false and the hook:
 *   1. prints a loud stderr banner ("compliance checks were SKIPPED … NOT a
 *      clean pass"), and
 *   2. records a BLOCKING violation (fail-closed), never a silent clean pass.
 *
 * Also pins the KNOWN double-report: with the CLI absent, TWO blocking
 * violations fire — the upfront missing-CLI one AND the existing exit-127
 * compliance-run branch. This test documents that as the current behavior so a
 * future dedup is a deliberate, visible change.
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';

const COMMON_SH = path.resolve(
  __dirname, '..', 'src', 'commands', 'hooks', 'scripts', 'paradigm-common.sh',
);

let cleanups: Array<() => void> = [];
afterEach(() => { cleanups.forEach((fn) => fn()); cleanups = []; });

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
 * PATH. `binDir` may hold stubbed `paradigm` / `npx` executables.
 */
function run(opts: {
  path: string;                       // PATH for the shell
  binScripts?: Record<string, string>; // name → sh body (chmod +x)
  localParadigm?: string;              // sh body for <root>/node_modules/.bin/paradigm
  rootPrefix?: string;
  modified?: string[];
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

  if (opts.localParadigm !== undefined) {
    const p = path.join(rootDir, 'node_modules', '.bin', 'paradigm');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, opts.localParadigm, 'utf8');
    fs.chmodSync(p, 0o755);
  }

  for (const [name, body] of Object.entries(opts.binScripts ?? {})) {
    const p = path.join(binDir, name);
    fs.writeFileSync(p, body, 'utf8');
    fs.chmodSync(p, 0o755);
  }

  const script = `
set +e
cd "${rootDir}"
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
      PATH: opts.binScripts ? `${binDir}:${opts.path}` : opts.path,
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

describe('paradigm-common.sh — missing-CLI fail-closed', () => {
  it('no paradigm AND no npx → loud banner + blocking violation (NOT a clean pass)', () => {
    const r = run({ path: '/usr/bin:/bin' }); // neither paradigm nor npx resolvable
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

  it('npx probe uses --no-install and NEVER auto-installs', () => {
    // A stub npx that records the flags it was called with. If it is ever
    // invoked WITHOUT --no-install (an auto-install attempt) it writes a marker.
    const marker = 'AUTO_INSTALL_ATTEMPTED';
    const npxStub = `#!/bin/sh
if [ "$1" != "--no-install" ]; then
  echo "${marker}" > "$HOME/.npx-autoinstall-marker"
fi
# --no-install with no locally-installed paradigm → npx exits non-zero.
exit 1
`;
    const r = run({ path: '/usr/bin:/bin', binScripts: { npx: npxStub } });
    // The probe ran, npx refused (exit 1) → CLI still unavailable, fail-closed.
    expect(r.paradigmAvailable).toBe('false');
    expect(r.violations).toContain('paradigm CLI not found');
    // Crucially: npx was NEVER called without --no-install (no auto-install).
    expect(fs.existsSync(path.join(r.rootDir, '.npx-autoinstall-marker'))).toBe(false);
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

  it("the project's own node_modules/.bin/paradigm resolves without npx, even under a path with spaces", () => {
    // npx fails the way npm 11 does in a repo whose devEngines require pnpm.
    const npxStub = `#!/bin/sh
echo "npm error EBADDEVENGINES" >&2
exit 1
`;
    const local = `#!/bin/sh
[ "$1" = "compliance-check" ] && : > "$HOME/.local-paradigm-ran"
case "$1" in
  compliance-check) echo '{"driftedCount":0,"healedCount":0,"usedButUndeclaredCount":0}' ;;
esac
exit 0
`;
    const r = run({ path: '/usr/bin:/bin', binScripts: { npx: npxStub }, localParadigm: local, rootPrefix: 'paradigm local-' });
    expect(r.paradigmAvailable).toBe('true');
    expect(r.violations).not.toContain('compliance checks were SKIPPED');
    expect(r.violations).not.toContain('compliance-check failed to run');
    expect(fs.existsSync(path.join(r.rootDir, '.local-paradigm-ran'))).toBe(true);
  });
});
