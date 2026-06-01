/**
 * university-loader — back-compat shim.
 *
 * The implementation moved to `@a-company/university-core` (src/loader.ts) when
 * the content-loading contract was extracted into a lean, zero-@a-company-dep
 * shared core (extract-university-core spec §4.1). This module is retained so
 * existing importers (`tools/reindex.ts`, `tools/ripple.ts`, `tools/university.ts`)
 * keep working untouched. Prefer importing from `@a-company/university-core`
 * directly in new code.
 *
 * The `saveNote`/`saveQuiz` 4th argument is now a union — a legacy positional
 * `packRoot` string OR a `SaveOptions` object — so every existing positional
 * call site stays byte-identical while the options form is available for the
 * unified write contract (spec §3).
 */

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
} from '@a-company/university-core';

export type {
  SaveOptions,
  AffectedUniversityContent,
  OnboardingSequence,
} from '@a-company/university-core';
