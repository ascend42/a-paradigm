/**
 * University System - Barrel Export
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
} from './types.js';

export {
  loadUniversityIndex,
  loadPackIndex,
  loadNote,
  loadQuiz,
  loadPath,
  loadDiplomas,
  saveNote,
  saveQuiz,
  saveDiploma,
  searchContent,
  searchContentWithMeta,
  rebuildUniversityIndex,
  resolveContentBase,
} from './storage.js';
