/**
 * Agent Matcher Module
 *
 * Suggests which agents should handle a task based on:
 * - Keyword triggers in task description
 * - Symbol patterns (@features, ^gates, etc.)
 * - Agent handoff patterns
 */

import type { AgentDefinition, AgentTrigger } from '../commands/team/types.js';

// ============================================================================
// Types
// ============================================================================

export interface AgentSuggestion {
  /** Agent name (e.g., "architect", "builder") */
  name: string;
  /** Human-readable reason for the suggestion */
  reason: string;
  /** Confidence level based on match count/quality */
  confidence: 'high' | 'medium' | 'low';
  /** List of triggers that matched */
  triggers_matched: string[];
}

// ============================================================================
// Constants
// ============================================================================

const SYMBOL_PATTERN = /[@#$%^!?&~][a-zA-Z0-9_-]+/g;

// ============================================================================
// Main Function
// ============================================================================

/**
 * Suggest agents for a given task based on triggers defined in agents.yaml
 *
 * @param task - The task description to analyze
 * @param agents - Record of agent definitions from agents.yaml
 * @returns Sorted array of agent suggestions (highest confidence first)
 */
export function suggestAgentsForTask(
  task: string,
  agents: Record<string, AgentDefinition>
): AgentSuggestion[] {
  const suggestions: AgentSuggestion[] = [];
  const taskLower = task.toLowerCase();
  const symbols = extractSymbols(task);

  for (const [name, agent] of Object.entries(agents)) {
    const matched: string[] = [];

    // Check each trigger
    for (const trigger of agent.triggers || []) {
      const triggerMatches = matchTrigger(trigger, taskLower, symbols);
      matched.push(...triggerMatches);
    }

    // Only suggest if we have matches
    if (matched.length > 0) {
      suggestions.push({
        name,
        reason: buildReason(name, agent, matched),
        confidence: calculateConfidence(matched),
        triggers_matched: matched,
      });
    }
  }

  // Sort by confidence (high > medium > low)
  return suggestions.sort(
    (a, b) => confidenceScore(b.confidence) - confidenceScore(a.confidence)
  );
}

// ============================================================================
// Trigger Matching
// ============================================================================

/**
 * Match a single trigger against task content
 */
function matchTrigger(
  trigger: AgentTrigger,
  taskLower: string,
  symbols: string[]
): string[] {
  const matched: string[] = [];

  switch (trigger.type) {
    case 'keyword':
      if (trigger.match) {
        for (const keyword of trigger.match) {
          if (taskLower.includes(keyword.toLowerCase())) {
            matched.push(`keyword:${keyword}`);
          }
        }
      }
      break;

    case 'symbol':
      if (trigger.match) {
        for (const pattern of trigger.match) {
          const matchingSymbols = symbols.filter((s) =>
            matchSymbolPattern(s, pattern)
          );
          for (const s of matchingSymbols) {
            matched.push(`symbol:${s}`);
          }
        }
      }
      break;

    case 'handoff':
      // Handoff triggers are for receiving handoffs, not task matching
      // They're handled separately in orchestration
      break;

    case 'schedule':
      // Schedule triggers are for cron-based execution, not task matching
      break;
  }

  return matched;
}

/**
 * Match a symbol against a pattern (e.g., "@checkout" matches "@*")
 */
function matchSymbolPattern(symbol: string, pattern: string): boolean {
  // Pattern like "@*" matches any @symbol
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return symbol.startsWith(prefix);
  }

  // Pattern like "^*" matches any ^gate
  if (pattern.startsWith('^') && pattern === '^*') {
    return symbol.startsWith('^');
  }

  // Exact match
  return symbol === pattern;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Extract Paradigm symbols from text
 */
function extractSymbols(text: string): string[] {
  const matches = text.match(SYMBOL_PATTERN) || [];
  return [...new Set(matches)];
}

/**
 * Build a human-readable reason for the suggestion
 */
function buildReason(
  name: string,
  agent: AgentDefinition,
  matched: string[]
): string {
  const keywordMatches = matched.filter((m) => m.startsWith('keyword:'));
  const symbolMatches = matched.filter((m) => m.startsWith('symbol:'));

  const parts: string[] = [];

  if (keywordMatches.length > 0) {
    const keywords = keywordMatches.map((m) => m.split(':')[1]);
    parts.push(`keywords: ${keywords.join(', ')}`);
  }

  if (symbolMatches.length > 0) {
    const symbols = symbolMatches.map((m) => m.split(':')[1]);
    parts.push(`symbols: ${symbols.join(', ')}`);
  }

  // Add role summary
  const roleFirstLine = agent.role.split('\n')[0].trim();
  const roleSnippet =
    roleFirstLine.length > 60
      ? roleFirstLine.slice(0, 57) + '...'
      : roleFirstLine;

  return `Matched ${parts.join('; ')}. ${roleSnippet}`;
}

/**
 * Calculate confidence based on match count and quality
 */
function calculateConfidence(
  matched: string[]
): 'high' | 'medium' | 'low' {
  // High: 3+ matches or multiple match types
  // Medium: 2 matches
  // Low: 1 match

  const keywordCount = matched.filter((m) => m.startsWith('keyword:')).length;
  const symbolCount = matched.filter((m) => m.startsWith('symbol:')).length;

  // Multiple match types increases confidence
  const hasMultipleTypes = keywordCount > 0 && symbolCount > 0;

  if (matched.length >= 3 || hasMultipleTypes) {
    return 'high';
  }

  if (matched.length >= 2) {
    return 'medium';
  }

  return 'low';
}

/**
 * Convert confidence to numeric score for sorting
 */
function confidenceScore(confidence: 'high' | 'medium' | 'low'): number {
  switch (confidence) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
  }
}

// ============================================================================
// Exports for Testing
// ============================================================================

export {
  extractSymbols,
  matchSymbolPattern,
  calculateConfidence,
  confidenceScore,
};
