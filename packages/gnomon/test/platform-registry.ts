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

export const PLATFORM_REGISTRY: PlatformRow[] = [];
