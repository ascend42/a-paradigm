/**
 * @symbol #session-runner
 *
 * #session-runner platform backend (TD-2026-10-19-063): who signed the claude
 * binary the kernel is about to pin. The pattern of helper-verifier.ts: one
 * verifier per platform, chosen by `claudeVerifierFor` with the platform
 * passed as data.
 *
 *   darwin  `/usr/bin/codesign` by absolute path, run on the PRIVATE COPY the
 *           kernel will execute (never the source: TOCTOU). `--verify
 *           --strict -R=<requirement>` decides; `-dv --verbose=2` reads the
 *           TeamIdentifier for the card. Notarization is not consulted.
 *   win32   unavailable (Authenticode is the Windows parity phase, P8-D78)
 *   linux   unavailable (no publisher signature on the Linux build)
 *
 * An unavailable verifier reports `verified:false`: the re-pin card then
 * carries the claim-mismatch flag (loud), it never refuses the re-pin itself.
 */
import { spawnSync } from 'node:child_process';

/** Anthropic PBC's Apple Developer team (checked on the native install, 2026-10-19). */
export const CLAUDE_EXPECTED_TEAM = 'Q6L2SF6YDW';
export const CLAUDE_EXPECTED_PUBLISHER = 'Anthropic PBC';

/** The designated requirement a re-pinned claude must satisfy. */
export function claudeRequirement(team: string = CLAUDE_EXPECTED_TEAM): string {
  return `anchor apple generic and certificate leaf[subject.OU] = "${team}"`;
}

export interface ClaudeSignature {
  /** the file satisfies the requirement for the expected team */
  verified: boolean;
  /** the TeamIdentifier the signature names (null: unsigned, ad-hoc or unreadable) */
  team: string | null;
}

export interface PlatformClaudeVerifier {
  readonly kind: 'codesign' | 'unavailable';
  check(exe: string): ClaudeSignature;
  /** why an unverified result happened (for the card) */
  readonly why: string;
}

const TEAM_LINE = /^TeamIdentifier=([A-Z0-9]{10})$/m;

const darwinCodesign: PlatformClaudeVerifier = Object.freeze({
  kind: 'codesign' as const,
  why: 'does not satisfy the expected code-signing requirement',
  check(exe: string): ClaudeSignature {
    const show = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=2', exe], { encoding: 'utf8', timeout: 30_000, cwd: '/' });
    const team = TEAM_LINE.exec(`${show.stderr ?? ''}${show.stdout ?? ''}`)?.[1] ?? null;
    const v = spawnSync('/usr/bin/codesign', ['--verify', '--strict', `-R=${claudeRequirement()}`, exe], { encoding: 'utf8', timeout: 30_000, cwd: '/' });
    return { verified: v.status === 0 && team === CLAUDE_EXPECTED_TEAM, team };
  },
});

function unavailable(platform: string): PlatformClaudeVerifier {
  return Object.freeze({
    kind: 'unavailable' as const,
    why: `has no publisher-signature check on ${platform} yet`,
    check: (): ClaudeSignature => ({ verified: false, team: null }),
  });
}

export function claudeVerifierFor(platform: string): PlatformClaudeVerifier {
  return platform === 'darwin' ? darwinCodesign : unavailable(platform);
}
