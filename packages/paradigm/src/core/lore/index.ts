/**
 * Lore System - Barrel Export
 */

export type { LoreEntry, LoreFilter, LoreTimeline, LoreDecision, LoreError } from './types.js';
export { recordLore, loadLoreEntries, loadLoreEntry, loadLoreTimeline, rebuildTimeline, addReview, updateLoreEntry, deleteLoreEntry, captureGitContext } from './storage.js';
export { applyLoreFilter, searchLoreEntries } from './filter.js';
export { normalizeLoreEntry, inferProvider } from './normalize.js';
export { resolveAuthor, sanitizeAuthor } from './resolve-author.js';
