/**
 * G-WIN-05 registry (spec §16 rule; research 29 §1). Every test file marked
 * platform-specific needs a row here naming either a sibling test file that
 * covers the other platform(s), or `na` with a reason.
 *
 * Marking: a test file is platform-specific when it carries the comment
 *   // @gnomon-platform: darwin            (or win32, linux; comma-separated)
 * Any test file that branches on `process.platform` must carry the marker
 * (test/platform-registry.test.ts enforces both directions).
 */
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

export const PLATFORM_REGISTRY: PlatformRow[] = [
  // PR-5 $daemon-lifecycle core + #socket, macOS-first (P8-D78).
  { test: 'test/daemon-lifecycle.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): unix-socket endpoint only; the named pipe via the signed helper waits for probe P03' },
  { test: 'test/socket-server.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): unix-socket endpoint only; the named pipe via the signed helper waits for probe P03' },
  { test: 'test/idle-exit.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): unix-socket endpoint only; the named pipe via the signed helper waits for probe P03' },
  // PR-4 #kernel-log, macOS-first (P8-D78): file modes, kill -9, p99 + per-OS memory metric.
  { test: 'test/kernel-log-posix.test.ts', platforms: ['darwin', 'linux'], na: 'Windows parity phase (P8-D78): owner-only ACLs instead of modes, and the private-bytes memory metric (§16 memory row) are measured there' },
];
