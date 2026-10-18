/**
 * @symbol #identity
 *
 * #identity platform backend (M1.3 slice 1 round 2, reviewer R6): how the
 * kernel checks that a file — and, after spawn, a running process — is the
 * signed helper. One verifier per platform, chosen by `helperVerifierFor`
 * with the platform passed as data (the pattern of processControlFor):
 *
 *   darwin  `codesign --verify --strict -R=<HELPER_REQUIREMENT>` on the file,
 *           and on the child's pid right after spawn (dynamic validity)
 *   win32   unavailable until the Rust helper (P8-D71, parity phase P8-D78)
 *   linux   unavailable (no signed helper on Linux in 8.0)
 *
 * An unavailable verifier refuses every helper: fail closed.
 */
import { spawnSync } from 'node:child_process';

export interface PlatformHelperVerifier {
  readonly kind: 'codesign' | 'unavailable' | 'dev-test';
  /** true = the file at `exe` satisfies `requirement`. */
  verifyFile(exe: string, requirement: string): boolean;
  /** true = the RUNNING process `pid` satisfies `requirement` (null: the platform cannot check). */
  verifyPid(pid: number, requirement: string): boolean | null;
  /** Why it refused (for the error message). */
  readonly why: string;
}

const darwinCodesign: PlatformHelperVerifier = Object.freeze({
  kind: 'codesign' as const,
  why: 'does not satisfy the code-signing requirement',
  verifyFile(exe: string, requirement: string): boolean {
    const r = spawnSync('/usr/bin/codesign', ['--verify', '--strict', `-R=${requirement}`, exe], { encoding: 'utf8', timeout: 30_000 });
    return r.status === 0;
  },
  verifyPid(pid: number, requirement: string): boolean {
    const r = spawnSync('/usr/bin/codesign', ['--verify', `-R=${requirement}`, String(pid)], { encoding: 'utf8', timeout: 30_000 });
    return r.status === 0;
  },
});

function unavailable(platform: string): PlatformHelperVerifier {
  return Object.freeze({
    kind: 'unavailable' as const,
    why: `has no signed-helper check on ${platform} yet (Windows parity phase, P8-D78)`,
    verifyFile: () => false,
    verifyPid: () => false,
  });
}

export function helperVerifierFor(platform: string): PlatformHelperVerifier {
  return platform === 'darwin' ? darwinCodesign : unavailable(platform);
}
