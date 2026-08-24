/**
 * hook-auto-seal-signal.test — the auto-seal hook FAILED SILENTLY, and the only
 * test that would have caught it is one that runs a real `git commit`.
 *
 * THE DEFECT, AS FOUND. `warpline hook install` printed success; `git commit` exited
 * 0; no `.warpline/` was ever created; `warpline status` then reported "clean", exit
 * 0. Trigger: `warpline` not on PATH — the default after a plain local `npm i`, and
 * true in the founder's own repo, which survives only on the `dist/cli.js` fallback.
 * The old block stacked three mutes on one line:
 *
 *     ( $WARPLINE_BIN pick --ref HEAD --quiet >/dev/null 2>&1 || true ) &
 *
 * output discarded, failure swallowed, detached from the commit's status. The
 * pre-existing hook.test.ts asserts install/uninstall/idempotence — all of which
 * PASS on the broken block, because none of them ever executes it. So this file
 * executes it, through git, and asserts what the OPERATOR sees.
 *
 * The property that must survive the fix: a commit is never blocked or failed by
 * Warpline. Both tests below assert `git commit` exit 0 as well as the signal.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { installHook, hookLogPath } from '../src/fabric/hook.js';

/** A minimal, hermetic git repo: no global hooksPath, no signing, no templates. */
function scratchRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-hooksig-'));
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  };
  git('init', '-q');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'Test');
  git('config', 'commit.gpgsign', 'false');
  // Defeat any GLOBAL core.hooksPath on the machine running this suite — otherwise
  // `.git/hooks/post-commit` is never consulted and the test would vacuously pass.
  git('config', 'core.hooksPath', path.join(dir, '.git', 'hooks'));
  return dir;
}

function commit(dir: string, name: string, env: NodeJS.ProcessEnv): ReturnType<typeof spawnSync> {
  fs.writeFileSync(path.join(dir, name), `${name}\n`, 'utf8');
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'pipe' });
  return spawnSync('git', ['commit', '-q', '-m', name], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

const hookOf = (dir: string): string => path.join(dir, '.git', 'hooks', 'post-commit');

/** Poll for the backgrounded seal's log (it is detached from the commit by design). */
async function waitForLog(logPath: string, needle: string, ms = 8_000): Promise<string> {
  const deadline = Date.now() + ms;
  for (;;) {
    const text = fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
    if (text.includes(needle)) return text;
    if (Date.now() > deadline) return text;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe('hook · the unresolvable binary is REPORTED, not swallowed', () => {
  let dir: string;
  beforeEach(() => {
    dir = scratchRepo();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('reproduction: binary unresolvable ⇒ the commit still succeeds AND stderr says so', () => {
    installHook(hookOf(dir));
    // Exactly the found condition: nothing named this on PATH, and the scratch repo
    // has no packages/warpline/dist/cli.js for the monorepo fallback to find.
    const r = commit(dir, 'a.txt', { WARPLINE_BIN: 'warpline-absent-9f3c1e', WARPLINE_AGENT_ID: '' });

    // The property that must NOT regress: warpline never fails a commit.
    expect(r.status).toBe(0);
    expect(
      execFileSync('git', ['rev-list', '--count', 'HEAD'], { cwd: dir, encoding: 'utf8' }).trim(),
    ).toBe('1');

    // The property that was MISSING: the operator is told the seal did not happen.
    expect(r.stderr).toContain('auto-seal SKIPPED');
    expect(r.stderr).toContain('warpline-absent-9f3c1e');
    expect(r.stderr).toContain('NOT sealed');
    // ...and the reason it matters is named, because `status` will disagree.
    expect(r.stderr).toContain('status');

    // Ground truth for "the seal did not happen" — the thing the old surfaces lied about.
    expect(fs.existsSync(path.join(dir, '.warpline'))).toBe(false);
  });

  it('control: a RESOLVABLE binary is silent on stderr and leaves its output in the log', async () => {
    const bin = path.join(dir, 'fake-warpline.sh');
    fs.writeFileSync(bin, '#!/bin/sh\necho "FAKE-SEAL argv: $*"\nexit 0\n', 'utf8');
    fs.chmodSync(bin, 0o755);
    installHook(hookOf(dir));

    const r = commit(dir, 'b.txt', { WARPLINE_BIN: bin, WARPLINE_AGENT_ID: 'agent-zed' });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('auto-seal SKIPPED');

    // The backgrounded seal now writes to <git-dir>/warpline-hook.log, not /dev/null.
    const logPath = hookLogPath(hookOf(dir));
    expect(logPath).toBe(path.join(dir, '.git', 'warpline-hook.log'));
    const text = await waitForLog(logPath, 'FAKE-SEAL');
    expect(text).toContain('FAKE-SEAL argv: pick --ref HEAD --quiet --agent agent-zed');
    expect(text).toMatch(/^--- \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z post-commit [0-9a-f]{7,}$/m);
    expect(text).toContain('exit=0');
  });

  it("control: a resolvable binary that FAILS is recorded too — and still doesn't fail the commit", async () => {
    const bin = path.join(dir, 'failing-warpline.sh');
    fs.writeFileSync(bin, '#!/bin/sh\necho "boom: lock timeout" >&2\nexit 7\n', 'utf8');
    fs.chmodSync(bin, 0o755);
    installHook(hookOf(dir));

    const r = commit(dir, 'c.txt', { WARPLINE_BIN: bin, WARPLINE_AGENT_ID: '' });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('auto-seal SKIPPED'); // it resolved; it just failed

    const text = await waitForLog(hookLogPath(hookOf(dir)), 'exit=7');
    expect(text).toContain('boom: lock timeout'); // stderr is captured, not discarded
    expect(text).toContain('exit=7');
  });
});

describe('hook · the block itself', () => {
  let dir: string;
  let hookPath: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warpline-hookblk-'));
    hookPath = path.join(dir, 'hooks', 'post-commit');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('is valid POSIX shell (`sh -n`) — a syntax error here would break every commit', () => {
    installHook(hookPath);
    const r = spawnSync('sh', ['-n', hookPath], { encoding: 'utf8' });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
  });

  it('never routes the seal to /dev/null, and keeps the seal backgrounded', () => {
    installHook(hookPath);
    const text = fs.readFileSync(hookPath, 'utf8');
    const sealLine = text.split('\n').find((l) => l.includes('pick --ref HEAD --quiet'));
    expect(sealLine).toBeDefined();
    expect(sealLine).not.toContain('/dev/null');
    expect(text).toContain('>>"$_wl_log" 2>&1');
    expect(text).toContain(') &'); // the expensive absorb stays off the commit's path
    // ...while the CHEAP resolution check is foreground: no `&` on the echo branch.
    const warnLine = text.split('\n').find((l) => l.includes('auto-seal SKIPPED'));
    expect(warnLine).toBeDefined();
    expect(warnLine).toContain('>&2');
    expect(warnLine).not.toContain('&\n');
  });

  it('install BOUNDS the log: an oversized log is cut to a tail, and the tail is kept', () => {
    const logPath = hookLogPath(hookPath);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    const filler = 'x'.repeat(1024) + '\n';
    fs.writeFileSync(logPath, `HEAD-OF-LOG\n${filler.repeat(300)}TAIL-OF-LOG\n`, 'utf8');
    const before = fs.statSync(logPath).size;
    expect(before).toBeGreaterThan(65_536);

    installHook(hookPath);

    const after = fs.readFileSync(logPath, 'utf8');
    expect(fs.statSync(logPath).size).toBeLessThan(before);
    expect(fs.statSync(logPath).size).toBeLessThanOrEqual(65_536 + 200);
    expect(after).toContain('log truncated by `hook install`');
    expect(after).toContain('TAIL-OF-LOG'); // the RECENT evidence survives
    expect(after).not.toContain('HEAD-OF-LOG'); // the ancient bytes are what got dropped
  });

  it('control: a small log is left byte-identical by install', () => {
    const logPath = hookLogPath(hookPath);
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.writeFileSync(logPath, 'one small line\n', 'utf8');
    installHook(hookPath);
    expect(fs.readFileSync(logPath, 'utf8')).toBe('one small line\n');
  });

  it('control: install does not CREATE a log where none existed', () => {
    installHook(hookPath);
    expect(fs.existsSync(hookLogPath(hookPath))).toBe(false);
  });
});
