/**
 * Pack manifest constants and convenience re-exports — back-compat shim.
 *
 * The canonical definitions moved to `@a-company/university-core`
 * (src/types/pack.ts + src/types/university.ts) during the content-loading
 * extraction (extract-university-core spec §4.1). This shim is retained so
 * existing importers (`pack-loader.ts`, `university-metrics.ts`) stay
 * untouched. Prefer importing from `@a-company/university-core` directly in
 * new code.
 */

export type {
  TenantKind,
  Origin,
  PackDependency,
  PackCompliance,
  PackManifest,
  PackLocation,
  // v6.5 sections
  Section,
  SectionStyle,
} from '@a-company/university-core';

export {
  PACK_MANIFEST_FILENAME,
  PACK_SCHEMA_VERSION,
  PACKAGE_JSON_POINTER_FIELD,
  FIRST_PARTY_PACK_IDS,
} from '@a-company/university-core';
