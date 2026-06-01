/**
 * University Types — back-compat re-export shim.
 *
 * The canonical type module moved to `@a-company/university-core`
 * (src/types/university.ts) when the content-loading contract was extracted
 * (extract-university-core spec §4.1, §4.5 — core is the MCP superset). This
 * shim is retained so the ~type importers across paradigm-mcp stay untouched.
 * Prefer importing from `@a-company/university-core` directly in new code.
 */

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
} from '@a-company/university-core';
