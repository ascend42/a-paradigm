/**
 * University Types — re-export shim over `@a-company/university-core`.
 *
 * The CLI's local type module was a strict subset of the canonical types. As of
 * the extract-university-core refactor (spec §4.2 / §4.5) the canonical types
 * (the MCP superset) live in `@a-company/university-core`; this module re-
 * exports them so existing CLI importers (`storage.ts`, command files via the
 * barrel) stay untouched. CLI consumers gain optional fields (`category`,
 * `author?`/`track?` on filters, etc.) + a `returned` key on searchContentWithMeta
 * — additive and safe; no CLI code asserts exact-shape on these types.
 */
export type {
  UniversityContentType,
  Difficulty,
  DiplomaType,
  UniversityFrontmatter,
  UniversityNote,
  QuizQuestion,
  UniversityQuiz,
  LearningPathStep,
  LearningPath,
  Diploma,
  UniversityIndex,
  UniversityIndexEntry,
  UniversityFilter,
} from '@a-company/university-core';
