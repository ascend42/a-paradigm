/**
 * G-WIN-05 registry (spec §16 rule; research 29 §1). Every test file marked
 * platform-specific needs a row here naming either a sibling test file that
 * covers the other platform(s), or `na` with a reason.
 *
 * Marking: a test file is platform-specific when it carries the comment
 *   // @gnomon-platform: darwin            (or win32, linux; comma-separated)
 * Any test file that branches on `process.platform` must carry the marker
 * (test/platform-registry.test.ts enforces both directions).
 *
 * The marker is ENFORCED, not just documentation (T-2026-10-17-011):
 * vitest.config.ts excludes every test file whose marker does not list the
 * running `process.platform` (excludedTestFiles below). This registry stays
 * the record of WHY each exclusion exists; the registry test proves, for
 * every platform, that the excluded set equals the rows that do not list it.
 *
 * Zero imports beyond node builtins: vitest.config.ts loads this module.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export type Platform = 'darwin' | 'win32' | 'linux';

export interface PlatformRow {
  /** Test file, relative to packages/gnomon (posix separators). */
  test: string;
  platforms: Platform[];
  /** Sibling test file covering the remaining platform(s). */
  sibling?: string;
  /** Why no sibling exists. Required when `sibling` is absent. */
  na?: string;
}

export const PLATFORMS: Platform[] = ['darwin', 'win32', 'linux'];

/** The marker line: `// @gnomon-platform: <p>[, <p>…]` at the start of any line. */
export const PLATFORM_MARKER = /^\s*\/\/\s*@gnomon-platform:\s*([a-z0-9, ]+)$/m;

/** The platforms a test source is marked for, or null when unmarked (= every platform). */
export function parsePlatformMarker(source: string): string[] | null {
  const m = PLATFORM_MARKER.exec(source);
  return m ? m[1]!.split(',').map((s) => s.trim()).filter(Boolean) : null;
}

/**
 * Test files (posix paths relative to `pkgRoot`, e.g. `test/x.test.ts`) that
 * are marked platform-specific and do NOT list `platform` — vitest.config.ts
 * excludes exactly these on that platform.
 */
export function excludedTestFiles(pkgRoot: string, platform: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) visit(full);
      else if (name.endsWith('.test.ts')) {
        const marked = parsePlatformMarker(readFileSync(full, 'utf8'));
        if (marked && !marked.includes(platform)) out.push(path.relative(pkgRoot, full).split(path.sep).join('/'));
      }
    }
  };
  visit(path.join(pkgRoot, 'test'));
  return out.sort();
}

export const PLATFORM_REGISTRY: PlatformRow[] = [
  // PR-5 $daemon-lifecycle core + #socket, macOS-first (P8-D78).
  { test: 'test/daemon-lifecycle.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): unix-socket endpoint only; the named pipe via the signed helper waits for probe P03' },
  { test: 'test/socket-server.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): unix-socket endpoint only; the named pipe via the signed helper waits for probe P03' },
  { test: 'test/idle-exit.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): unix-socket endpoint only; the named pipe via the signed helper waits for probe P03' },
  // PR-4 #kernel-log, macOS-first (P8-D78): file modes, kill -9, p99 + per-OS memory metric.
  { test: 'test/kernel-log-posix.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): owner-only ACLs instead of modes, and the private-bytes memory metric (§16 memory row) are measured there' },
  // T-2026-10-17-011: runs on ALL three platforms; marked only because it branches on process.platform.
  { test: 'test/boot-session.test.ts', platforms: ['darwin', 'linux', 'win32'], na: 'no sibling needed: one file asserts every platform inline — a UUID on macOS (kern.bootsessionuuid) / Linux (boot_id), `unknown` on win32 until the helper boot id of the parity phase (P8-D78, P8-D83)' },
];
