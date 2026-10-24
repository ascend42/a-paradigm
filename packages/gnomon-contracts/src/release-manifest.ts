/**
 * release-manifest:v1 — the native artifacts one Gnomon release ships, with
 * the exact bytes the kernel accepts (TD-2026-10-21-758 zero-build, G-HLP-01;
 * T-2026-10-21-028). Mirrors schemas/release-manifest.v1.schema.json (built
 * from RELEASE_MANIFEST_V1_SCHEMA in schemas.ts); test/release-manifest.test.ts
 * keeps the two in lockstep.
 *
 * Written once per release by packages/gnomon/scripts/write-release-manifest.mjs
 * from the signed bin/ outputs, embedded in the kernel's build stamp, and read
 * by the kernel at boot: with a manifest present every helper and voice-io
 * executable must satisfy BOTH its code-signing requirement AND the pinned
 * sha256. A build without one is a dev build (signature + version floor only).
 *
 * Hard contract: additive changes or a version bump (spec §4 preamble).
 */
import { isPlainObject } from './internal.js';

export const RELEASE_MANIFEST_V1 = 'gnomon-release-manifest:v1' as const;

/** The native executables a release pins (closed: a new artifact is a contract change). */
export const RELEASE_ARTIFACT_NAMES = ['gnomon-helper', 'gnomon-voice-io'] as const;
export type ReleaseArtifactName = (typeof RELEASE_ARTIFACT_NAMES)[number];

/** Node's process.arch names; `universal` = a fat Mach-O holding both. */
export const RELEASE_ARCHES = ['arm64', 'x64', 'universal'] as const;
export type ReleaseArch = (typeof RELEASE_ARCHES)[number];

/**
 * The designated requirement GnomonVoiceIO.app is signed against and verified by: Apple anchor, a Developer ID
 * Application leaf issued by the Developer ID CA, team SW4BMQ8PNL, identifier gnomon.voice-io. ONE constant shared
 * by the build (packages/gnomon-voice/scripts/build-voice-io.mjs) and the kernel (voice/voice-install.ts), so the
 * requirement a binary is built to and the one it is checked against cannot drift (Aegis M1 review, T-2026-10-21-028).
 */
export const VOICE_IO_TEAM = 'SW4BMQ8PNL' as const;
export const VOICE_IO_IDENTIFIER = 'gnomon.voice-io' as const;
export const VOICE_IO_REQUIREMENT =
  `anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "${VOICE_IO_TEAM}" and identifier "${VOICE_IO_IDENTIFIER}"`;

export const RELEASE_VERSION_PATTERN = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
export const ARTIFACT_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
/** Plain lowercase hex (the kernel's pin compares hex digests). */
export const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;
export const RELEASE_REQUIREMENT_MAX = 1024;
export const RELEASE_ARTIFACTS_MAX = 8;

export interface ReleaseArtifactV1 {
  name: ReleaseArtifactName;
  /** what the executable answers to `--version` */
  version: string;
  /** sha256 (hex) of the executable inside its signed .app */
  sha256: string;
  /** the code-signing designated requirement it was verified against at manifest time */
  requirement: string;
  arch: ReleaseArch;
}

/** The arches an npm platform package ships a zipped Gnomon.app for (T-2026-10-21-030; never `universal`). */
export const APP_ZIP_ARCHES = ['arm64', 'x64'] as const;
export type AppZipArch = (typeof APP_ZIP_ARCHES)[number];

/**
 * The sha256 of one arch's `Gnomon.app.zip` (@a-company/gnomon-darwin-<arch>), compiled into the @a-company/gnomon
 * that npm publishes beside it (T-2026-10-21-030, Aegis M3 high 2). The zip is checked against THIS before it is
 * unpacked, never against the .sha256 file shipped next to it. Additive (optional) to release-manifest:v1.
 */
export interface ReleaseAppZipV1 {
  arch: AppZipArch;
  /** sha256 (hex) of the ditto zip as published */
  sha256: string;
}

export interface ReleaseManifestV1 {
  schemaVersion: typeof RELEASE_MANIFEST_V1;
  /** the Gnomon release these artifacts ship in */
  release: string;
  artifacts: ReleaseArtifactV1[];
  /** OPTIONAL (additive, M3): the published app zips, at most one per arch */
  appZips?: ReleaseAppZipV1[];
}

/** The REQUIRED top-level keys; RELEASE_MANIFEST_V1_OPTIONAL_KEYS may also appear. */
export const RELEASE_MANIFEST_V1_KEYS = ['schemaVersion', 'release', 'artifacts'] as const;
export const RELEASE_MANIFEST_V1_OPTIONAL_KEYS = ['appZips'] as const;
export const RELEASE_APP_ZIP_V1_KEYS = ['arch', 'sha256'] as const;
export const RELEASE_ARTIFACT_V1_KEYS = ['name', 'version', 'sha256', 'requirement', 'arch'] as const;

/** Problems (empty = valid). Hand-written, zero deps; the same rules as the JSON Schema plus one per (name, arch). */
export function validateReleaseManifestV1(value: unknown): string[] {
  if (!isPlainObject(value)) return ['release-manifest:v1 must be an object'];
  const errors: string[] = [];
  for (const k of Object.keys(value)) if (![...RELEASE_MANIFEST_V1_KEYS, ...RELEASE_MANIFEST_V1_OPTIONAL_KEYS].includes(k as never)) errors.push(`unknown property "${k}"`);
  for (const k of RELEASE_MANIFEST_V1_KEYS) if (!(k in value)) errors.push(`missing property "${k}"`);
  if ('schemaVersion' in value && value.schemaVersion !== RELEASE_MANIFEST_V1) errors.push(`schemaVersion must be ${RELEASE_MANIFEST_V1}`);
  if ('release' in value && (typeof value.release !== 'string' || !RELEASE_VERSION_PATTERN.test(value.release))) errors.push('release must be a semver version');
  if ('appZips' in value) errors.push(...appZipErrors(value.appZips));
  if (!('artifacts' in value)) return errors;
  const arts = value.artifacts;
  if (!Array.isArray(arts) || arts.length < 1 || arts.length > RELEASE_ARTIFACTS_MAX) return [...errors, `artifacts must be an array of 1..${RELEASE_ARTIFACTS_MAX}`];
  const seen = new Map<string, Set<string>>();
  arts.forEach((a: unknown, i) => {
    const at = `artifacts[${i}]`;
    if (!isPlainObject(a)) return void errors.push(`${at} must be an object`);
    for (const k of Object.keys(a)) if (!(RELEASE_ARTIFACT_V1_KEYS as readonly string[]).includes(k)) errors.push(`${at}: unknown property "${k}"`);
    for (const k of RELEASE_ARTIFACT_V1_KEYS) if (!(k in a)) errors.push(`${at}: missing property "${k}"`);
    if ('name' in a && !(RELEASE_ARTIFACT_NAMES as readonly unknown[]).includes(a.name)) errors.push(`${at}: name must be one of ${RELEASE_ARTIFACT_NAMES.join('|')}`);
    if ('version' in a && (typeof a.version !== 'string' || !ARTIFACT_VERSION_PATTERN.test(a.version))) errors.push(`${at}: version must be a.b.c`);
    if ('sha256' in a && (typeof a.sha256 !== 'string' || !SHA256_HEX_PATTERN.test(a.sha256))) errors.push(`${at}: sha256 must be 64 lowercase hex`);
    if ('requirement' in a && (typeof a.requirement !== 'string' || a.requirement.length < 1 || a.requirement.length > RELEASE_REQUIREMENT_MAX)) errors.push(`${at}: requirement must be a string of 1..${RELEASE_REQUIREMENT_MAX}`);
    if ('arch' in a && !(RELEASE_ARCHES as readonly unknown[]).includes(a.arch)) errors.push(`${at}: arch must be one of ${RELEASE_ARCHES.join('|')}`);
    if (typeof a.name === 'string' && typeof a.arch === 'string') {
      const arches = seen.get(a.name) ?? new Set<string>();
      // one entry per (name, arch); `universal` covers every arch, so it stands alone
      if (arches.has(a.arch) || (a.arch === 'universal' && arches.size > 0) || arches.has('universal')) errors.push(`${at}: more than one ${a.name} entry for ${a.arch}`);
      arches.add(a.arch);
      seen.set(a.name, arches);
    }
  });
  return errors;
}

function appZipErrors(zips: unknown): string[] {
  if (!Array.isArray(zips) || zips.length < 1 || zips.length > APP_ZIP_ARCHES.length) return [`appZips must be an array of 1..${APP_ZIP_ARCHES.length}`];
  const errors: string[] = [];
  const seen = new Set<unknown>();
  zips.forEach((z: unknown, i) => {
    const at = `appZips[${i}]`;
    if (!isPlainObject(z)) return void errors.push(`${at} must be an object`);
    for (const k of Object.keys(z)) if (!(RELEASE_APP_ZIP_V1_KEYS as readonly string[]).includes(k)) errors.push(`${at}: unknown property "${k}"`);
    for (const k of RELEASE_APP_ZIP_V1_KEYS) if (!(k in z)) errors.push(`${at}: missing property "${k}"`);
    if ('arch' in z && !(APP_ZIP_ARCHES as readonly unknown[]).includes(z.arch)) errors.push(`${at}: arch must be one of ${APP_ZIP_ARCHES.join('|')}`);
    if ('sha256' in z && (typeof z.sha256 !== 'string' || !SHA256_HEX_PATTERN.test(z.sha256))) errors.push(`${at}: sha256 must be 64 lowercase hex`);
    if (seen.has(z.arch)) errors.push(`${at}: more than one app zip for ${String(z.arch)}`);
    seen.add(z.arch);
  });
  return errors;
}

/** The compiled sha256 of `arch`'s published Gnomon.app.zip, or null when the manifest pins none. */
export function releaseAppZipFor(m: ReleaseManifestV1, arch: string): string | null {
  return m.appZips?.find((z) => z.arch === arch)?.sha256 ?? null;
}

export function isReleaseManifestV1(value: unknown): value is ReleaseManifestV1 {
  return validateReleaseManifestV1(value).length === 0;
}

/** The entry that pins `name` on `arch` (an exact arch entry, else a universal one), or null. */
export function releaseArtifactFor(m: ReleaseManifestV1, name: ReleaseArtifactName, arch: string): ReleaseArtifactV1 | null {
  return m.artifacts.find((a) => a.name === name && a.arch === arch) ?? m.artifacts.find((a) => a.name === name && a.arch === 'universal') ?? null;
}
