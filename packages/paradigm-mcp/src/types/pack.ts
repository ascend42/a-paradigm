/**
 * Pack manifest constants and convenience re-exports (v6.0).
 *
 * The canonical type definitions live in `./university.ts` alongside the
 * rest of the University domain types. This module provides a small
 * shim for consumers that only care about pack-manifest shape + the
 * well-known filesystem constants.
 */

export type {
  TenantKind,
  Origin,
  PackDependency,
  PackCompliance,
  PackManifest,
  PackLocation,
} from './university.js';

/** Filename of the pack manifest at a pack root. */
export const PACK_MANIFEST_FILENAME = 'pack.yaml' as const;

/** Current pack-manifest schema version. Bump when `pack.yaml` shape changes. */
export const PACK_SCHEMA_VERSION = '1' as const;

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
