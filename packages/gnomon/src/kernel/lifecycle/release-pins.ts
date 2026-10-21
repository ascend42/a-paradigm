/**
 * @symbol #release-pins
 *
 * #release-pins (TD-2026-10-21-758 zero-build, G-HLP-01; T-2026-10-21-028) — the exact native bytes THIS kernel
 * build accepts. The pins are COMPILED INTO THE BUNDLE, never read from a file at runtime (Aegis M1 review):
 * `npm run build:release` (scripts/build-release.mjs) writes a release-manifest:v1 (gnomon-contracts) from the signed
 * bin/ outputs, then rebuilds with tsup `define` (tsup.config.ts, env GNOMON_RELEASE_MANIFEST):
 * __GNOMON_RELEASE__ = true and __GNOMON_RELEASE_MANIFEST__ = the manifest JSON.
 *
 *   - release: every helper pin (identity/helper.ts pinHelper) and every voice-io install and pre-spawn re-check
 *     (voice/voice-install.ts) must match the compiled sha256 for this arch, ON TOP of the code-signing requirement
 *     and the version floor. A mismatch, or no entry for this arch, is refused `checksum`. Deleting or editing
 *     dist/build-id.json, loading dist/index.js, or copying dist elsewhere changes nothing: the hashes travel with
 *     the code (the stamp's `release` copy is informational only, for status and the upgrade card).
 *   - broken: compiled as a release but the compiled manifest is missing or invalid: EVERY pin is refused; a
 *     release never degrades to dev.
 *   - dev: not compiled as a release (a plain `npm run build`, a test run from src): signature plus version floor
 *     only. `gnomon daemon status` says `build: dev` and the setup helper row says so.
 * Residual: a dev tree's dist is session-writable, so its code (and so its pins) is only as strong as the tree; the
 * signed app bundle's seal is what makes a release's compiled pins hold.
 */
import { releaseArtifactFor, validateReleaseManifestV1, type ReleaseArtifactName, type ReleaseArtifactV1, type ReleaseManifestV1 } from '@a-company/gnomon-contracts';

/** Replaced by tsup `define` in a release build only; undeclared (typeof 'undefined') everywhere else. */
declare const __GNOMON_RELEASE__: boolean | undefined;
declare const __GNOMON_RELEASE_MANIFEST__: string | undefined;

export type ReleasePins =
  | { readonly mode: 'release'; readonly manifest: ReleaseManifestV1 }
  | { readonly mode: 'dev'; readonly why: string }
  | { readonly mode: 'broken'; readonly why: string };

export type ReleaseMode = ReleasePins['mode'];

export const DEV_PINS: ReleasePins = Object.freeze({ mode: 'dev', why: 'not a release build (signature and version floor only)' });

/** The pins a build carries: not a release ⇒ dev; a release ⇒ its compiled manifest must be present and valid, else broken. */
export function releasePinsFromCompiled(release: boolean, manifestJson: string | null | undefined): ReleasePins {
  if (!release) return DEV_PINS;
  if (typeof manifestJson !== 'string') return Object.freeze({ mode: 'broken', why: 'this release build carries no compiled release manifest' });
  let m: unknown;
  try {
    m = JSON.parse(manifestJson);
  } catch {
    return Object.freeze({ mode: 'broken', why: 'the compiled release manifest is not JSON' });
  }
  const errors = validateReleaseManifestV1(m);
  if (errors.length) return Object.freeze({ mode: 'broken', why: `the compiled release manifest is invalid (${errors.slice(0, 3).join('; ')})` });
  return Object.freeze({ mode: 'release', manifest: m as ReleaseManifestV1 });
}

let loaded: ReleasePins | null = null;

/** The pins compiled into the bundle this process runs (computed once). */
export function loadedReleasePins(): ReleasePins {
  loaded ??= releasePinsFromCompiled(
    typeof __GNOMON_RELEASE__ !== 'undefined' && __GNOMON_RELEASE__ === true,
    typeof __GNOMON_RELEASE_MANIFEST__ === 'string' ? __GNOMON_RELEASE_MANIFEST__ : null,
  );
  return loaded;
}

/** What a verifier must enforce for one artifact on this arch. */
export type ArtifactPin = { readonly kind: 'dev' } | { readonly kind: 'pinned'; readonly artifact: ReleaseArtifactV1 } | { readonly kind: 'refuse'; readonly why: string };

export function artifactPin(pins: ReleasePins, name: ReleaseArtifactName, arch: string = process.arch): ArtifactPin {
  if (pins.mode === 'dev') return { kind: 'dev' };
  if (pins.mode === 'broken') return { kind: 'refuse', why: pins.why };
  const artifact = releaseArtifactFor(pins.manifest, name, arch);
  if (!artifact) return { kind: 'refuse', why: `release ${pins.manifest.release} pins no ${name} for ${arch}` };
  return { kind: 'pinned', artifact };
}

/** One line for status surfaces: `release 8.0.0 (sha256-pinned)`, `dev (…)`, `broken (…)`. */
export function describeReleasePins(pins: ReleasePins): string {
  if (pins.mode === 'release') return `release ${pins.manifest.release} (helper and voice-io sha256-pinned)`;
  return `${pins.mode} (${pins.why})`;
}
