/**
 * Pack manifest constants and convenience re-exports — back-compat shim.
 *
 * The canonical definitions moved to `@a-company/university-core`
 * (src/types/pack.ts + src/types/university.ts) during the content-loading
 * extraction (extract-university-core spec §4.1). This shim is retained so
 * existing importers stay untouched (the MCP-local pack-loader was deleted in
 * v7.11 — discovery is single-sourced in university-core). Prefer importing from `@a-company/university-core` directly in
 * new code.
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
} from '@a-company/university-core';

export {
  PACK_MANIFEST_FILENAME,
  PACK_SCHEMA_VERSION,
  SUPPORTED_PACK_SCHEMA_VERSIONS,
  PACKAGE_JSON_POINTER_FIELD,
  FIRST_PARTY_PACK_IDS,
} from '@a-company/university-core';
