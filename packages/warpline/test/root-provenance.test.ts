/**
 * root-provenance.test — `health` says WHICH arm chose the fabric, not just
 * which path it is.
 *
 * THE DEFECT THIS IS ABOUT. `health` printed the resolved root and nothing
 * else, so these two print identically:
 *   - "I passed --root and it took"
 *   - "it silently fell through to the git root, which happens to be correct
 *      today"
 * Only the second is D-7 — the defect where every command targeted the LIVE
 * fabric by default and no surface said so. For a project about to be committed
 * to Warpline, that distinction is the whole point.
 *
 * The two warnings are deliberately NARROW; the anti-noise case at the bottom
 * is as load-bearing as the positive ones. A health verb that warns on the
 * intended path is a health verb people learn to ignore, which is strictly
 * worse than a silent one.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  resolveRootVerbose,
  setExplicitRoot,
  explicitRootOf,
  ROOT_ENV,
} from '../src/root.js';
import { health } from '../src/health.js';

const made: string[] = [];
function tmp(prefix = 'wl-rootprov-'): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  made.push(d);
  return d;
}

afterEach(() => {
  // Process-global state: an escaped --root or $WARPLINE_ROOT would silently
  // retarget every later test in this file.
  setExplicitRoot(null);
  delete process.env[ROOT_ENV];
  while (made.length) fs.rmSync(made.pop()!, { recursive: true, force: true });
});

describe('resolveRootVerbose — the arm, at the chokepoint', () => {
  it('reports `flag` for --root, and the flag still wins over the environment', () => {
    const dir = tmp();
    const other = tmp();
    process.env[ROOT_ENV] = other; // precedence 2, must LOSE
    setExplicitRoot(dir); // precedence 1
    return resolveRootVerbose().then((r) => {
      expect(r.arm).toBe('flag');
      expect(r.root).toBe(fs.realpathSync(dir) === dir ? dir : path.resolve(dir));
      expect(explicitRootOf()).not.toBeNull();
    });
  });

  it('reports `env` for $WARPLINE_ROOT when no flag was given', async () => {
    const dir = tmp();
    process.env[ROOT_ENV] = dir;
    const r = await resolveRootVerbose();
    expect(r.arm).toBe('env');
    expect(r.root).toBe(path.resolve(dir));
  });

  it('reports `git` when nothing explicit was given and git can answer', async () => {
    // The suite runs inside this repository, so the git arm is the live one.
    const r = await resolveRootVerbose();
    expect(r.arm).toBe('git');
    expect(fs.existsSync(path.join(r.root, '.git'))).toBe(true);
  });
});

describe('health — root provenance is on the report', () => {
  it('names the arm and does NOT invent a git toplevel that is not there', async () => {
    const dir = tmp(); // a plain directory: no git, no override
    const report = await health(dir);
    expect(report.rootResolution.arm).toBe('cwd');
    expect(report.rootResolution.explicit).toBe(false);
    expect(report.rootResolution.gitToplevel).toBeNull();
    // The SILENT fallback is the one unexplained arm — it must say so.
    expect(report.warnings.join('\n')).toMatch(/FALLING BACK to the working directory/);
  });

  it('reports the `git` arm and the real toplevel for a genuine repository', async () => {
    const dir = tmp();
    execFileSync('git', ['init', '-q'], { cwd: dir });
    const report = await health(dir);
    expect(report.rootResolution.arm).toBe('git');
    expect(report.rootResolution.gitToplevel).not.toBeNull();
    // macOS reports /var and /private/var for the same directory.
    expect(fs.realpathSync(report.rootResolution.gitToplevel!)).toBe(fs.realpathSync(dir));
    expect(report.warnings.join('\n')).not.toMatch(/FALLING BACK/);
  });

  it('flags a fabric NESTED inside another fabric', async () => {
    const outer = tmp();
    fs.mkdirSync(path.join(outer, '.warpline'), { recursive: true });
    const inner = path.join(outer, 'sub', 'inner');
    fs.mkdirSync(inner, { recursive: true });

    const report = await health(inner);
    expect(report.rootResolution.nestedUnder).toBe(outer);
    expect(report.warnings.join('\n')).toMatch(/NESTED inside another fabric/);
  });

  it('does NOT warn merely because an explicit root was used', async () => {
    // THE ANTI-NOISE CASE. An operator who names a fabric gets that fabric;
    // that is the tool working. If this ever warns, `--root` becomes a reason
    // to stop reading health output — which is how the silent default survived.
    const dir = tmp();
    execFileSync('git', ['init', '-q'], { cwd: dir });
    setExplicitRoot(dir);

    const report = await health(dir);
    expect(report.rootResolution.arm).toBe('flag');
    expect(report.rootResolution.explicit).toBe(true);
    const rootWarnings = report.warnings.filter(
      (w) => /FALLING BACK/.test(w) || /NESTED inside another fabric/.test(w),
    );
    expect(rootWarnings).toEqual([]);
  });

  it('writes nothing — a diagnostic you can run on a full disk (C-13)', async () => {
    const dir = tmp();
    const before = fs.readdirSync(dir);
    await health(dir);
    expect(fs.readdirSync(dir)).toEqual(before);
    expect(fs.existsSync(path.join(dir, '.warpline'))).toBe(false);
  });
});
