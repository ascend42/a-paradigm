/**
 * hook-baked-binary.test — the cold-agent silent-skip fix (T-2026-08-12-002, item 4).
 *
 * THE BUG, EMPIRICALLY FOUND. `warpline hook install` exited 0 and wrote a post-commit
 * hook whose default seal binary was `${WARPLINE_BIN:-warpline}` — a bare name resolved
 * off the committing shell's PATH. A cold agent — any provider, no global install —
 * invokes the CLI as `node /abs/path/dist/cli.js`. That binary IS runnable and IS KNOWN
 * at install time (it is the process doing the installing), yet the hook threw that fact
 * away and guessed `warpline`, which the agent does not have. Every commit then printed
 * SKIPPED and sealed nothing, while `warpline status` still said "clean".
 *
 * THE FIX. `hook install` now BAKES the exact interpreter + CLI running it into the
 * block as its default, so the hook seals with the same binary that installed it. And
 * if it cannot resolve a runnable binary at all, it FAILS LOUDLY rather than write a
 * hook that silently no-ops.
 *
 * The two tests below are the two halves the pre-existing hook tests could not cover:
 *   1. the COLD-AGENT integration — install via an absolute node path, commit with
 *      `warpline` ABSENT from PATH, and assert the fabric ACTUALLY ADVANCED (a strand
 *      was sealed) — i.e. the baked binary fired where a PATH guess would have SKIPPED;
 *   2. the LOUD FAILURE — install with no resolvable binary throws, and does not write
 *      a hook to disk.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { installHook, resolveInvokingBinary, hookLogPath } from '../src/fabric/hook.js';

const PKG_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST_CLI = path.join(PKG_ROOT, 'dist', 'cli.js');

/** The directory holding `git` (and node), so a sanitized PATH keeps them but not warpline. */
function dirOnPath(cmd: string): string | null {
  for (const d of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!d) continue;
    try {
      if (fs.statSync(path.join(d, cmd)).isFile()) return d;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/**
 * A PATH with git + node but WITHOUT `warpline` — the cold-agent situation. The
 * developer machine running this suite may have `warpline` globally linked; if that
 * leaked in, the block's `path` fallback arm could mask the `baked` arm under test.
 */
function coldAgentPath(): string {
  const dirs = new Set<string>();
  const git = dirOnPath('git');
  const node = dirOnPath('node');
  if (git) dirs.add(git);
  if (node) dirs.add(path.dirname(process.execPath));
  if (node) dirs.add(node);
  return [...dirs].join(path.delimiter);
}

/** A minimal hermetic git repo (no global hooksPath, no signing, no templates). */
function scratchRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-baked-'));
  const git = (...args: string[]): void => void execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  git('config', 'core.hooksPath', path.join(dir, '.git', 'hooks'));
  return dir;
}

const hookOf = (dir: string): string => path.join(dir, '.git', 'hooks', 'post-commit');

async function waitFor(pred: () => boolean, ms = 15_000): Promise<boolean> {
  const deadline = Date.now() + ms;
  for (;;) {
    if (pred()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('hook · baking the install-time binary (the cold-agent fix)', () => {
  beforeAll(() => {
    // The seal binary the hook bakes is the built CLI; build it if this is a
    // src-only checkout so the integration test is self-contained.
    if (!fs.existsSync(DIST_CLI)) {
      execFileSync('npm', ['run', 'build'], { cwd: PKG_ROOT, stdio: 'pipe' });
    }
  }, 180_000);

  let dir: string;
  beforeEach(() => {
    dir = scratchRepo();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('COLD AGENT: install via an absolute node path ⇒ commit SEALS even with `warpline` off PATH', async () => {
    // Simulate exactly the cold-agent invocation: `node /abs/path/dist/cli.js hook install`.
    // The install RESOLVES that argv into the baked binary and writes it into the hook.
    const baked = resolveInvokingBinary([process.execPath, DIST_CLI]);
    expect(baked, 'the built CLI must resolve to a runnable baked binary').not.toBeNull();
    installHook(hookOf(dir), baked);

    // The baked default is the absolute node + cli.js — NOT a bare `warpline` guess.
    const hookText = fs.readFileSync(hookOf(dir), 'utf8');
    expect(hookText).toContain(`_wl_script='${baked!.script}'`);
    expect(hookText).not.toMatch(/WARPLINE_BIN="\$\{WARPLINE_BIN:-warpline\}"/);

    // Commit with `warpline` ABSENT from PATH and no WARPLINE_BIN override — the ONLY
    // arm that can resolve is the baked one. (Precede-check: warpline is not findable.)
    const env = { ...process.env, PATH: coldAgentPath(), WARPLINE_BIN: '', WARPLINE_AGENT_ID: '' };
    expect(spawnSync('warpline', ['--version'], { env, stdio: 'ignore' }).error, 'warpline must be absent from the cold PATH')
      .toBeTruthy();

    fs.writeFileSync(path.join(dir, 'a.txt'), 'hello\n');
    execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'pipe' });
    const commit = spawnSync('git', ['commit', '-q', '-m', 'first'], { cwd: dir, encoding: 'utf8', env });

    // The commit must not be blocked or failed by warpline, and must NOT print SKIPPED.
    expect(commit.status).toBe(0);
    expect(commit.stderr).not.toContain('auto-seal SKIPPED');

    // THE HEADLINE ASSERTION: the fabric actually advanced — a strand was sealed by the
    // backgrounded hook. This is exactly what the PATH-guess hook silently never did.
    const fabricPath = path.join(dir, '.warpline', 'fabric.jsonl');
    const sealed = await waitFor(() => fs.existsSync(fabricPath) && fs.readFileSync(fabricPath, 'utf8').trim().length > 0);
    const log = fs.existsSync(hookLogPath(hookOf(dir))) ? fs.readFileSync(hookLogPath(hookOf(dir)), 'utf8') : '(no log)';
    expect(sealed, `no strand sealed — hook log was:\n${log}`).toBe(true);

    // Ground-truth the seal: at least one fabric line and a clean exit in the hook log.
    expect(fs.readFileSync(fabricPath, 'utf8').split('\n').filter(Boolean).length).toBeGreaterThan(0);
    expect(log).toContain('exit=0');
  }, 60_000);

  it('LOUD FAILURE: install cannot resolve a runnable binary ⇒ it throws and writes NO hook', () => {
    // resolveInvokingBinary returns null exactly when argv/execPath name nothing runnable.
    expect(resolveInvokingBinary([process.execPath])).toBeNull(); // no argv[1]
    expect(resolveInvokingBinary([process.execPath, path.join(os.tmpdir(), 'no-such-cli-xyz.js')])).toBeNull();
    expect(resolveInvokingBinary(['', ''])).toBeNull();

    // installHook must REFUSE (throw) rather than write a hook that resolves to nothing.
    const hookPath = hookOf(dir);
    expect(() => installHook(hookPath, null)).toThrow(/resolve the running warpline binary/i);
    expect(fs.existsSync(hookPath), 'no hook may be written when the binary is unresolvable').toBe(false);
  });
});
