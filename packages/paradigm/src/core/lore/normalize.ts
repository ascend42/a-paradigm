/**
 * Lore Normalization - Converts old author format to new author/agent split
 *
 * Old format:  author: { type: 'agent', id: 'claude', model: 'claude-opus-4-6' }
 * New format:  author: 'ascend', agent: { provider: 'anthropic', model: 'claude-opus-4-6' }
 */

import type { LoreEntry } from './types.js';

interface OldAuthorBlock {
  type: 'human' | 'agent';
  id: string;
  model?: string;
}

/**
 * Infer AI provider from a model name string.
 */
export function inferProvider(model: string): string {
  const lower = model.toLowerCase();
  if (lower.includes('claude') || lower.includes('anthropic')) return 'anthropic';
  if (lower.includes('gpt') || lower.includes('openai') || lower.includes('o1') || lower.includes('o3')) return 'openai';
  if (lower.includes('gemini') || lower.includes('google') || lower.includes('palm')) return 'google';
  if (lower.includes('llama') || lower.includes('meta')) return 'meta';
  if (lower.includes('mistral') || lower.includes('mixtral')) return 'mistral';
  if (lower.includes('deepseek')) return 'deepseek';
  if (lower.includes('cohere') || lower.includes('command')) return 'cohere';
  return 'unknown';
}

/**
 * Normalize a raw lore entry from disk into the new author/agent format.
 * Handles both old-format entries (author as object) and new-format entries (author as string).
 * Safe to call multiple times — already-normalized entries pass through unchanged.
 */
export function normalizeLoreEntry(raw: Record<string, unknown>): LoreEntry {
  const entry = raw as Record<string, unknown>;
  const author = entry.author;

  // Already in new format (author is a string)
  if (typeof author === 'string') {
    return raw as unknown as LoreEntry;
  }

  // Old format: author is an object with { type, id, model? }
  if (author && typeof author === 'object' && !Array.isArray(author)) {
    const old = author as OldAuthorBlock;

    if (old.type === 'agent') {
      // Agent entry: set author to 'unknown' (no human info available), populate agent
      entry.author = 'unknown';
      entry.agent = {
        provider: old.model ? inferProvider(old.model) : inferProvider(old.id),
        model: old.model || old.id,
      };
    } else {
      // Human entry: author becomes the human id
      entry.author = old.id || 'unknown';
      // No agent field for human-only entries
    }

    // Remove superseded assistedBy field
    delete entry.assistedBy;
  }

  return entry as unknown as LoreEntry;
}
