/**
 * Lore System - Barrel Export
 */

export type { LoreEntry, LoreType, LoreFilter, LoreTimeline, LoreDecision, LoreError, LoreAssessment, AssessmentVerdict } from './types.js';
export { recordLore, loadLoreEntries, loadLoreEntry, loadLoreTimeline, rebuildTimeline, addReview, addAssessment, updateLoreEntry, deleteLoreEntry, captureGitContext } from './storage.js';
export { applyLoreFilter, searchLoreEntries } from './filter.js';
export { normalizeLoreEntry, inferProvider } from './normalize.js';
export { resolveAuthor, sanitizeAuthor } from './resolve-author.js';
