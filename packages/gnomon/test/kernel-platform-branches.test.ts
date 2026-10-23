/**
 * G-WIN-05 for kernel CODE (PR #52 review: "inline platform branches vs G-WIN-05"). New platform behaviour in
 * src/kernel goes in a platform REGISTRY keyed by platform (TRANSPORT_BACKENDS, PROCESS_CONTROL, BOOT_SOURCES,
 * WRITE_THROUGH_RENAMES, SESSION_DENY_REALISATION, CLAUDE_CODE_PLATFORMS, the platform/ modules), never a new inline
 * comparison of the platform against a name. This is a ratchet: the inline branches that exist today (2026-10-23) are counted per
 * file below; a new file with one, or a file with more than its count, fails. Fewer is always fine — lower the count
 * when you move one into a registry. Raising a count needs a reason in the commit (a path separator, a POSIX-only
 * chmod, an `.exe` suffix: data, not behaviour).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PKG_ROOT, rel, walk } from './helpers.js';

const BRANCH = /process\.platform\s*(===|!==)\s*'(win32|darwin|linux)'|platform\s*(===|!==)\s*'win32'/g;

/** The baseline (counts only ever go down). */
const BASELINE: Readonly<Record<string, number>> = {
  'src/kernel/broker/run-mode.ts': 1,
  'src/kernel/budget/config.ts': 1,
  'src/kernel/desk/mcp-passthrough.ts': 1,
  'src/kernel/lifecycle/daemon.ts': 2,
  'src/kernel/lifecycle/endpoint.ts': 1,
  'src/kernel/lifecycle/home.ts': 1,
  'src/kernel/lifecycle/ready.ts': 1,
  'src/kernel/local/config-request.ts': 1,
  'src/kernel/log/anchor.ts': 1,
  'src/kernel/loops/loop-env.ts': 1,
  'src/kernel/manifest/grant-lock.ts': 1,
  'src/kernel/manifest/policy.ts': 1,
  'src/kernel/modhost/paradigm-slice.ts': 2,
  'src/kernel/runner/binary.ts': 3,
  'src/kernel/runner/env.ts': 5,
  'src/kernel/supervisor/auto-edits.ts': 2,
  'src/kernel/supervisor/local-session.ts': 5,
  'src/kernel/supervisor/permission.ts': 1,
  'src/kernel/supervisor/prefix-policy.ts': 1,
  'src/kernel/supervisor/shell-readonly.ts': 4,
  'src/kernel/supervisor/supervisor.ts': 8,
  'src/kernel/trace/capture.ts': 1,
  'src/kernel/trace/mode.ts': 1,
};

/** Inline platform branches per kernel file. */
export function countBranches(files: ReadonlyArray<{ file: string; src: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { file, src } of files) {
    const n = (src.match(BRANCH) ?? []).length;
    if (n > 0) out[file] = n;
  }
  return out;
}

/** The files over their baseline (a new file's baseline is 0). */
export function overBaseline(counts: Record<string, number>, baseline: Readonly<Record<string, number>>): string[] {
  return Object.entries(counts)
    .filter(([f, n]) => n > (baseline[f] ?? 0))
    .map(([f, n]) => `${f}: ${n} inline platform branch(es), baseline ${baseline[f] ?? 0} — use a platform registry`);
}

describe('G-WIN-05: no new inline platform branch in kernel code (ratchet)', () => {
  it('the checker fails a new file and a raised count, and passes a lowered one', () => {
    // built, not written: this file must not itself read as platform-branching to the test registry (G-WIN-05)
    const pp = ['process', 'platform'].join('.');
    const counts = countBranches([
      { file: 'src/kernel/a.ts', src: `if (${pp} === 'win32') x(); if (platform !== 'win32') y();` },
      { file: 'src/kernel/b.ts', src: `if (${pp} === 'darwin') z();` },
      { file: 'src/kernel/c.ts', src: 'const p = PROCESS_CONTROL[process.platform];' },
    ]);
    expect(counts).toEqual({ 'src/kernel/a.ts': 2, 'src/kernel/b.ts': 1 });
    expect(overBaseline(counts, { 'src/kernel/a.ts': 2 })).toEqual([expect.stringMatching(/^src\/kernel\/b\.ts: 1/)]);
    expect(overBaseline(counts, { 'src/kernel/a.ts': 1, 'src/kernel/b.ts': 1 })).toEqual([expect.stringMatching(/^src\/kernel\/a\.ts: 2/)]);
    expect(overBaseline({ 'src/kernel/a.ts': 1 }, { 'src/kernel/a.ts': 2 })).toEqual([]);
  });

  it('src/kernel holds no inline platform branch beyond the baseline', () => {
    const files = walk(path.join(PKG_ROOT, 'src', 'kernel'), (f) => f.endsWith('.ts')).map((f) => ({ file: rel(f).split(path.sep).join('/'), src: readFileSync(f, 'utf8') }));
    expect(overBaseline(countBranches(files), BASELINE)).toEqual([]);
  });
});
