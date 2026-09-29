/**
 * Pack manifest constants and convenience re-exports (v6.0).
 *
 * The canonical type definitions live in `./university.ts` alongside the
 * rest of the University domain types. This module provides a small
 * shim for consumers that only care about pack-manifest shape + the
 * well-known filesystem constants.
 *
 * MOVED to @a-company/university-core (extract-university-core spec §4.5).
 */

export type {
  TenantKind,
  Origin,
  PackDependency,
  PackCompliance,
  PackManifest,
  PackLocation,
  PackSkillRef,
  // v6.5 sections
  Section,
  SectionStyle,
} from './university.js';

/** Filename of the pack manifest at a pack root. */
export const PACK_MANIFEST_FILENAME = 'pack.yaml' as const;

/** Current pack-manifest schema version. Bump when `pack.yaml` shape changes. */
export const PACK_SCHEMA_VERSION = '2' as const;

/**
 * Manifest schema versions the loader accepts. '1' = pre-skills manifests
 * (still fully supported); '2' = adds the optional `skills:` list.
 */
export const SUPPORTED_PACK_SCHEMA_VERSIONS: ReadonlyArray<string> = ['1', '2'];

/**
 * The package.json field consulted during npm-pack discovery. Value is a
 * relative path from the package root to a directory containing a
 * `pack.yaml` manifest.
 */
export const PACKAGE_JSON_POINTER_FIELD = 'paradigm.universityPack' as const;

/**
 * Well-known first-party pack ids. These short names are reserved; third
 * parties must use reverse-DNS or npm-scope form.
 */
export const FIRST_PARTY_PACK_IDS = {
  paradigm: 'paradigm',
} as const;
