/**
 * session-recovery.test — the checkpoint/breadcrumb recovery fixes.
 *
 * Covers the three compounding bugs behind "MCP can't recover my checkpoints,
 * something around the Claude directory location":
 *   1. project root resolved from an unstable cwd → wrong ~/.paradigm/sessions
 *      bucket → recovery misses (resolveProjectRoot).
 *   2. loadPreviousSession returned the CURRENT (empty) session because the live
 *      breadcrumbs file is clobbered before recover reads it (rotation + .prev).
 *   3. a checkpoint older than the max age silently vanished (30-day window).
 *
 * HOME is sandboxed to a temp dir per test so the global store (~/.paradigm) is
 * hermetic and never touches the real one.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveProjectRoot, getProjectHash } from './global-store.js';
import { SessionTracker } from './session-tracker.js';

let tmp: string;
let homeBak: string | undefined;
let cwdBak: string;
let envBak: Record<string, string | undefined>;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'paradigm-recovery-'));
  cwdBak = process.cwd();
  homeBak = process.env.HOME;
  envBak = {
    HOME: process.env.HOME,
    PARADIGM_PROJECT_DIR: process.env.PARADIGM_PROJECT_DIR,
    CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR,
  };
  // Sandbox the global store (~/.paradigm resolves via os.homedir() → $HOME).
  process.env.HOME = path.join(tmp, 'home');
  fs.mkdirSync(process.env.HOME, { recursive: true });
  delete process.env.PARADIGM_PROJECT_DIR;
  delete process.env.CLAUDE_PROJECT_DIR;
});

afterEach(() => {
  try { process.chdir(cwdBak); } catch { /* ignore */ }
  for (const [k, v] of Object.entries(envBak)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  process.env.HOME = homeBak;
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Make `dir` look like a Paradigm project. */
function initProject(dir: string): string {
  fs.mkdirSync(path.join(dir, '.paradigm'), { recursive: true });
  return dir;
}

describe('resolveProjectRoot — stable project root, independent of cwd', () => {
  it('an explicit hint that is a Paradigm project wins', () => {
    const proj = initProject(path.join(tmp, 'proj'));
    expect(resolveProjectRoot(proj)).toBe(path.resolve(proj));
  });

  it('walks UP from a nested subdir to the ancestor holding .paradigm', () => {
    const proj = initProject(path.join(tmp, 'proj'));
    const nested = path.join(proj, 'src', 'deep', 'here');
    fs.mkdirSync(nested, { recursive: true });
    expect(resolveProjectRoot(nested)).toBe(path.resolve(proj));
  });

  it('CLAUDE_PROJECT_DIR wins when the hint is "." (the plugin case)', () => {
    const proj = initProject(path.join(tmp, 'claudeproj'));
    process.env.CLAUDE_PROJECT_DIR = proj;
    // hint "." would otherwise resolve to cwd — the exact bug.
    expect(resolveProjectRoot('.')).toBe(path.resolve(proj));
  });

  it('PARADIGM_PROJECT_DIR takes precedence over CLAUDE_PROJECT_DIR', () => {
    const a = initProject(path.join(tmp, 'a'));
    const b = initProject(path.join(tmp, 'b'));
    process.env.PARADIGM_PROJECT_DIR = a;
    process.env.CLAUDE_PROJECT_DIR = b;
    expect(resolveProjectRoot('.')).toBe(path.resolve(a));
  });

  it('a named-but-uninitialised project beats a random cwd', () => {
    const proj = path.join(tmp, 'fresh'); // no .paradigm yet
    fs.mkdirSync(proj, { recursive: true });
    process.env.CLAUDE_PROJECT_DIR = proj;
    // cwd is somewhere with no .paradigm ancestor
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'elsewhere-'));
    process.chdir(elsewhere);
    try {
      expect(resolveProjectRoot('.')).toBe(path.resolve(proj));
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('getProjectHash is stable for one path and differs across paths', () => {
    const a = path.join(tmp, 'a');
    const b = path.join(tmp, 'b');
    expect(getProjectHash(a)).toBe(getProjectHash(a));       // deterministic
    expect(getProjectHash(a)).not.toBe(getProjectHash(b));   // path-sensitive
    // resolve-invariant: "." from inside the dir hashes the same as its own cwd
    // (use process.cwd() as the oracle — os.tmpdir() may be a symlink, so the
    // raw `a` string need not equal its realpath).
    process.chdir(initProject(a));
    expect(getProjectHash('.')).toBe(getProjectHash(process.cwd()));
  });
});

describe('breadcrumb rotation — recover never returns the CURRENT session', () => {
  it('preserves the prior session and loadPreviousSession returns IT, not the current one', () => {
    const proj = initProject(path.join(tmp, 'proj'));
    // A prior run left its breadcrumbs on disk (local).
    const prior = {
      sessionId: 'sPREVIOUS',
      startTime: Date.now() - 3600_000,
      lastActivity: Date.now() - 1800_000,
      breadcrumbs: [{ timestamp: Date.now() - 1800_000, action: 'tool-call', tool: 'x' }],
      symbolsModified: ['#alpha'],
      filesExplored: ['a.ts'],
    };
    fs.writeFileSync(path.join(proj, '.paradigm', 'session-breadcrumbs.json'), JSON.stringify(prior));

    const tracker = new SessionTracker(); // fresh session, its own sessionId
    tracker.setRootDir(proj);             // rotation fires here

    // The .prev file now holds the prior session…
    expect(fs.existsSync(path.join(proj, '.paradigm', 'session-breadcrumbs.prev.json'))).toBe(true);
    // …and loadPreviousSession returns the PRIOR session, never the current one.
    const prev = tracker.loadPreviousSession();
    expect(prev?.sessionId).toBe('sPREVIOUS');
    expect(prev?.symbolsModified).toEqual(['#alpha']);

    // Even after the current session records its own breadcrumbs (clobbering the
    // live file), the previous session is still recoverable.
    tracker.addBreadcrumb({ action: 'tool-call', tool: 'y', summary: 'current work' });
    const prevAfter = tracker.loadPreviousSession();
    expect(prevAfter?.sessionId).toBe('sPREVIOUS');
  });

  it('no prior breadcrumbs → loadPreviousSession is null (not the empty current session)', () => {
    const proj = initProject(path.join(tmp, 'proj'));
    const tracker = new SessionTracker();
    tracker.setRootDir(proj);
    tracker.addBreadcrumb({ action: 'tool-call', tool: 'y' });
    expect(tracker.loadPreviousSession()).toBeNull();
  });
});

describe('checkpoint expiry — 30-day window, not 7', () => {
  it('a 10-day-old checkpoint is still recovered (would have vanished at 7)', () => {
    const proj = initProject(path.join(tmp, 'proj'));
    const tracker = new SessionTracker();
    tracker.setRootDir(proj);
    const cp = {
      phase: 'complete', context: 'old but valid',
      timestamp: Date.now() - 10 * 24 * 3600_000,
      sessionId: 'sOLD', recentBreadcrumbs: [],
    };
    fs.writeFileSync(path.join(proj, '.paradigm', 'session-checkpoint.json'), JSON.stringify(cp));
    const loaded = tracker.loadCheckpoint();
    expect(loaded?.context).toBe('old but valid');
  });

  it('a 40-day-old checkpoint is discarded', () => {
    const proj = initProject(path.join(tmp, 'proj'));
    const tracker = new SessionTracker();
    tracker.setRootDir(proj);
    const cp = {
      phase: 'complete', context: 'ancient',
      timestamp: Date.now() - 40 * 24 * 3600_000,
      sessionId: 'sANCIENT', recentBreadcrumbs: [],
    };
    fs.writeFileSync(path.join(proj, '.paradigm', 'session-checkpoint.json'), JSON.stringify(cp));
    expect(tracker.loadCheckpoint()).toBeNull();
  });
});
