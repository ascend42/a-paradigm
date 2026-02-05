/**
 * Task Classifier
 *
 * Detects task types to right-size agent selection and cost estimation.
 * Classification is language-agnostic, based on keywords and Paradigm symbols.
 */

import { AgentModel } from './agent-provider.js';

// ============================================================================
// Types
// ============================================================================

export type TaskType = 'analysis' | 'bugfix' | 'feature' | 'refactor' | 'documentation';

export type TaskComplexity = 'low' | 'medium' | 'high';

export interface TaskClassification {
  /** Type of task detected */
  type: TaskType;
  /** Estimated complexity */
  complexity: TaskComplexity;
  /** Recommended agents for this task type */
  recommendedAgents: string[];
  /** Whether security agent should be involved */
  securityRequired: boolean;
  /** Estimated cost range as multiplier of full team baseline */
  costMultiplier: { min: number; max: number };
  /** Keywords that triggered this classification */
  matchedKeywords: string[];
  /** Symbols found in task */
  symbols: string[];
}

export interface ProjectContext {
  /** Root directory of the project */
  rootDir?: string;
  /** Files that might be affected */
  affectedFiles?: string[];
  /** Whether project has portal.yaml */
  hasPortalYaml?: boolean;
}

// ============================================================================
// Constants
// ============================================================================

/** Keywords that indicate an analysis task (no code changes) */
const ANALYSIS_KEYWORDS = [
  'should',
  'what',
  'how',
  'why',
  'recommend',
  'analyze',
  'compare',
  'evaluate',
  'assess',
  'review',
  'explain',
  'describe',
  'investigate',
  'which',
  'best practice',
  'trade-off',
  'tradeoff',
  'pros and cons',
  'decision',
];

/** Keywords that indicate documentation task */
const DOCUMENTATION_KEYWORDS = [
  'document',
  'write docs',
  'readme',
  '.purpose',
  'purpose file',
  'jsdoc',
  'tsdoc',
  'comments',
  'docstring',
  'api docs',
  'changelog',
  'architecture doc',
];

/** Keywords that indicate a bug fix */
const BUGFIX_KEYWORDS = [
  'bug',
  'fix',
  'broken',
  'not working',
  'issue',
  'error',
  'crash',
  'fails',
  'failing',
  'wrong',
  'incorrect',
  'doesn\'t work',
  'doesn\'t',
  'cant',
  'can\'t',
  'regression',
  'patch',
];

/** Keywords that indicate refactoring */
const REFACTOR_KEYWORDS = [
  'rename',
  'refactor',
  'migrate',
  'restructure',
  'move',
  'reorganize',
  'clean up',
  'cleanup',
  'consolidate',
  'extract',
  'inline',
  'simplify',
  'modularize',
  'decouple',
  'split',
  'merge',
];

/** Keywords that indicate security-sensitive operations */
const SECURITY_KEYWORDS = [
  'auth',
  'authentication',
  'authorization',
  'permission',
  'admin',
  'delete',
  'purge',
  'password',
  'credential',
  'token',
  'secret',
  'key',
  'encrypt',
  'decrypt',
  'hash',
  'session',
  'oauth',
  'jwt',
  'api key',
  'role',
  'access',
  'gate',
  'portal',
  'sensitive',
  'private',
  'security',
  'vulnerability',
  'xss',
  'sql injection',
  'csrf',
];

/** Symbol pattern for extracting Paradigm symbols */
const SYMBOL_PATTERN = /[@#$%^!?&~][a-zA-Z0-9_-]+/g;

// ============================================================================
// Agent Mapping by Task Type
// ============================================================================

interface AgentMapping {
  agents: string[];
  models: Record<string, AgentModel>;
  costMultiplier: { min: number; max: number };
}

const TASK_AGENT_MAPPING: Record<TaskType, AgentMapping> = {
  analysis: {
    agents: ['architect'],
    models: { architect: 'opus' },
    costMultiplier: { min: 0.3, max: 0.5 },
  },
  documentation: {
    agents: ['architect'],
    models: { architect: 'sonnet' },
    costMultiplier: { min: 0.25, max: 0.45 },
  },
  bugfix: {
    agents: ['security', 'builder'],
    models: { security: 'opus', builder: 'haiku' },
    costMultiplier: { min: 0.5, max: 0.8 },
  },
  refactor: {
    agents: ['architect', 'builder'],
    models: { architect: 'opus', builder: 'haiku' },
    costMultiplier: { min: 0.6, max: 0.85 },
  },
  feature: {
    agents: ['architect', 'security', 'builder', 'tester'],
    models: { architect: 'opus', security: 'opus', builder: 'haiku', tester: 'haiku' },
    costMultiplier: { min: 0.8, max: 1.2 },
  },
};

// ============================================================================
// Classification Logic
// ============================================================================

/**
 * Extract Paradigm symbols from text
 */
export function extractSymbols(text: string): string[] {
  const matches = text.match(SYMBOL_PATTERN) || [];
  return [...new Set(matches)];
}

/**
 * Check if text contains any keywords from a list (case-insensitive)
 */
function matchesKeywords(text: string, keywords: string[]): string[] {
  const textLower = text.toLowerCase();
  return keywords.filter(keyword => textLower.includes(keyword.toLowerCase()));
}

/**
 * Determine task complexity based on various signals
 */
function determineComplexity(
  task: string,
  type: TaskType,
  symbols: string[],
  context?: ProjectContext
): TaskComplexity {
  let score = 0;

  // More symbols = more complexity
  if (symbols.length >= 5) score += 2;
  else if (symbols.length >= 2) score += 1;

  // Long task descriptions often indicate complexity
  const wordCount = task.split(/\s+/).length;
  if (wordCount >= 100) score += 2;
  else if (wordCount >= 50) score += 1;

  // Multiple feature types mentioned
  const prefixes = new Set(symbols.map(s => s[0]));
  if (prefixes.size >= 4) score += 2;
  else if (prefixes.size >= 2) score += 1;

  // Gate symbols indicate auth complexity
  if (symbols.some(s => s.startsWith('^'))) score += 1;

  // Flow symbols indicate multi-step complexity
  if (symbols.some(s => s.startsWith('$'))) score += 1;

  // Task type baseline
  if (type === 'feature') score += 1;
  if (type === 'refactor') score += 1;

  // Many affected files
  if (context?.affectedFiles && context.affectedFiles.length > 10) score += 2;
  else if (context?.affectedFiles && context.affectedFiles.length > 5) score += 1;

  // Map score to complexity
  if (score >= 5) return 'high';
  if (score >= 2) return 'medium';
  return 'low';
}

/**
 * Check if security agent should be involved based on task content and context
 */
function shouldInvolveSecurity(
  task: string,
  symbols: string[],
  context?: ProjectContext
): boolean {
  // Check for security keywords
  const securityMatches = matchesKeywords(task, SECURITY_KEYWORDS);
  if (securityMatches.length > 0) return true;

  // Check for gate symbols (^)
  if (symbols.some(s => s.startsWith('^'))) return true;

  // Check for sensitive file paths
  if (context?.affectedFiles) {
    const sensitivePathPatterns = [
      /auth/i,
      /middleware/i,
      /security/i,
      /gate/i,
      /permission/i,
      /admin/i,
    ];

    for (const file of context.affectedFiles) {
      if (sensitivePathPatterns.some(pattern => pattern.test(file))) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Classify a task to determine the appropriate agents and resources
 *
 * @param task - The task description
 * @param context - Optional project context for better classification
 * @returns Task classification with recommended agents and cost estimate
 */
export function classifyTask(task: string, context?: ProjectContext): TaskClassification {
  const symbols = extractSymbols(task);

  // Check each task type in priority order
  const analysisMatches = matchesKeywords(task, ANALYSIS_KEYWORDS);
  const documentationMatches = matchesKeywords(task, DOCUMENTATION_KEYWORDS);
  const bugfixMatches = matchesKeywords(task, BUGFIX_KEYWORDS);
  const refactorMatches = matchesKeywords(task, REFACTOR_KEYWORDS);

  // Determine task type based on keyword matches
  // Priority: analysis > documentation > bugfix > refactor > feature
  let type: TaskType;
  let matchedKeywords: string[];

  if (analysisMatches.length > 0 && bugfixMatches.length === 0 && refactorMatches.length === 0) {
    // Analysis: questions about the codebase without implementation
    type = 'analysis';
    matchedKeywords = analysisMatches;
  } else if (documentationMatches.length > 0 && bugfixMatches.length === 0) {
    // Documentation: writing docs without code changes
    type = 'documentation';
    matchedKeywords = documentationMatches;
  } else if (bugfixMatches.length > 0) {
    // Bug fix: fixing existing broken functionality
    type = 'bugfix';
    matchedKeywords = bugfixMatches;
  } else if (refactorMatches.length > 0) {
    // Refactor: restructuring without changing behavior
    type = 'refactor';
    matchedKeywords = refactorMatches;
  } else {
    // Feature: default for implementation tasks
    type = 'feature';
    matchedKeywords = [];
  }

  // Get agent mapping for this task type
  const mapping = TASK_AGENT_MAPPING[type];

  // Determine if security should be involved
  const securityRequired = shouldInvolveSecurity(task, symbols, context);

  // Adjust agents if security is required but not in default mapping
  let recommendedAgents = [...mapping.agents];
  if (securityRequired && !recommendedAgents.includes('security')) {
    // Insert security at the beginning for early review
    recommendedAgents = ['security', ...recommendedAgents];
  }

  // Determine complexity
  const complexity = determineComplexity(task, type, symbols, context);

  // Adjust cost multiplier based on complexity
  let costMultiplier = { ...mapping.costMultiplier };
  if (complexity === 'high') {
    costMultiplier.min *= 1.2;
    costMultiplier.max *= 1.3;
  } else if (complexity === 'low') {
    costMultiplier.min *= 0.8;
    costMultiplier.max *= 0.9;
  }

  // If security was added, increase cost estimate
  if (securityRequired && !mapping.agents.includes('security')) {
    costMultiplier.min += 0.15;
    costMultiplier.max += 0.2;
  }

  return {
    type,
    complexity,
    recommendedAgents,
    securityRequired,
    costMultiplier,
    matchedKeywords,
    symbols,
  };
}

/**
 * Get the recommended model for an agent based on task classification
 */
export function getRecommendedModel(
  agentName: string,
  classification: TaskClassification
): AgentModel {
  const mapping = TASK_AGENT_MAPPING[classification.type];

  // If security was escalated for a task that doesn't normally have it,
  // use opus for security
  if (agentName === 'security' && classification.securityRequired) {
    return 'opus';
  }

  return mapping.models[agentName] || 'sonnet';
}

/**
 * Format classification for display
 */
export function formatClassification(classification: TaskClassification): string {
  const lines: string[] = [];

  lines.push(`Task Type: ${classification.type}`);
  lines.push(`Complexity: ${classification.complexity}`);
  lines.push(`Security Required: ${classification.securityRequired ? 'Yes' : 'No'}`);
  lines.push(`Recommended Agents: ${classification.recommendedAgents.join(', ')}`);
  lines.push(`Cost Multiplier: ${classification.costMultiplier.min.toFixed(2)}x - ${classification.costMultiplier.max.toFixed(2)}x`);

  if (classification.matchedKeywords.length > 0) {
    lines.push(`Matched Keywords: ${classification.matchedKeywords.slice(0, 5).join(', ')}`);
  }

  if (classification.symbols.length > 0) {
    lines.push(`Symbols: ${classification.symbols.slice(0, 10).join(', ')}`);
  }

  return lines.join('\n');
}
