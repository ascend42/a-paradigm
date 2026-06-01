/**
 * @a-company/university-core
 *
 * Lean, dependency-light shared core for Paradigm University content + pack
 * loading. ZERO @a-company dependencies (js-yaml + zod leaf deps only). Owns
 * the content-loading contract once so the MCP / CLI / serve consumers stop
 * drifting (extract-university-core spec).
 */

// ── Logger seam (§2) ─────────────────────────────────────
export type { UniversityCoreLogger } from './logger.js';
export { setUniversityCoreLogger, getUniversityCoreLogger } from './logger.js';

// ── Types (§4.5 — core is the MCP superset) ──────────────
export type {
  UniversityContentType,
  Difficulty,
  DiplomaType,
  TenantKind,
  Origin,
  PackDependency,
  PackCompliance,
  SectionStyle,
  Section,
  PackManifest,
  PackLocation,
  UniversityFrontmatter,
  UniversityNote,
  QuizQuestion,
  UniversityQuiz,
  LearningPathStep,
  LearningPath,
  Diploma,
  PolicyComplianceFields,
  UniversityIndexEntry,
  UniversityIndex,
  UniversityFilter,
  UniversityBranding,
  UniversityTheme,
  UniversityContentCategory,
  UniversityConfig,
  UniversityValidationIssue,
  UniversityValidationResult,
} from './types/university.js';

// ── Pack manifest constants (§1.3) ───────────────────────
export {
  PACK_MANIFEST_FILENAME,
  PACK_SCHEMA_VERSION,
  PACKAGE_JSON_POINTER_FIELD,
  FIRST_PARTY_PACK_IDS,
} from './types/pack.js';

// ── Pack schema (§1.5 Option B — copied zod schema) ──────
export {
  SECTION_ID_RE,
  SECTION_STYLES as PACK_SCHEMA_SECTION_STYLES,
  MAX_SECTIONS_PER_PACK,
  SectionSchema,
  SectionsArraySchema,
  PackManifestSectionsSchema,
  EntrySectionRefSchema,
} from './pack-schema.js';

// ── Slim pack-discovery (§1.4) ───────────────────────────
export {
  PackLoadError,
  loadPackManifest,
  safeLoadPackId,
  normalizeSections,
  SECTION_STYLES,
  discoverPacks,
  resolveEntryAddress,
} from './pack-discovery.js';
export type {
  PackLoadErrorClass,
  ResolvedEntryAddress,
  AddressContext,
} from './pack-discovery.js';

// ── Content loader / writer (§1.3) ───────────────────────
export {
  // pack resolution
  resolveDefaultPackRoot,
  loadOrFabricatePackManifest,
  discoverDisciplineSubPacks,
  packDeclaresSections,
  // config
  loadUniversityConfig,
  loadPackConfig,
  // index
  loadUniversityIndex,
  loadPackIndex,
  rebuildUniversityIndex,
  // content base
  resolveContentBase,
  countPackEntries,
  // notes / policies
  loadNote,
  saveNote,
  // quizzes
  loadQuiz,
  saveQuiz,
  // learning paths
  loadPath,
  savePath,
  // diplomas
  loadDiplomas,
  saveDiploma,
  // search
  searchContent,
  searchContentWithMeta,
  // validation
  validateUniversityContent,
  // ripple integration
  getAffectedUniversityContent,
  // onboarding
  getOnboardingSequence,
} from './loader.js';
export type {
  SaveOptions,
  AffectedUniversityContent,
  OnboardingSequence,
} from './loader.js';
