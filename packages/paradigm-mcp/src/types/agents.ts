/**
 * Agent Identity Types — persistent, transferable agent profiles
 *
 * .agent files are YAML identity files stored in:
 *   ~/.paradigm/agents/       (global, travels across projects)
 *   .paradigm/agents/         (project-level overrides)
 *
 * Merge priority: project .agent > global .agent > agents.yaml
 */

// ────────────────────────────────────────────────────────
// Core Profile
// ────────────────────────────────────────────────────────

export interface AgentProfile {
  /** Agent identifier (e.g., "architect", "builder") */
  id: string;
  /** Human-readable role description */
  role: string;
  /** Extended description of capabilities */
  description: string;
  /** Profile schema version */
  version: string;
  /** Personality configuration for prompt enrichment */
  personality: AgentPersonality;
  /** Per-symbol expertise entries */
  expertise: AgentExpertiseEntry[];
  /** Cross-project reusable patterns */
  transferable: TransferablePattern[];
  /** Per-project adaptations keyed by project name */
  contexts: Record<string, AgentProjectContext>;
  /** ISO date of creation */
  created: string;
  /** ISO date of last update */
  updated: string;
}

export interface AgentPersonality {
  style: 'deliberate' | 'rapid' | 'exploratory' | 'methodical';
  risk: 'conservative' | 'balanced' | 'aggressive';
  verbosity: 'minimal' | 'concise' | 'detailed';
}

// ────────────────────────────────────────────────────────
// Expertise
// ────────────────────────────────────────────────────────

export interface AgentExpertiseEntry {
  /** Symbol name (e.g., "#auth-middleware") */
  symbol: string;
  /** Confidence score 0.0-1.0, exponential moving average from lore */
  confidence: number;
  /** Count of lore entries touching this symbol */
  sessions: number;
  /** ISO date of last interaction */
  lastTouch: string;
}

// ────────────────────────────────────────────────────────
// Transferable Patterns
// ────────────────────────────────────────────────────────

export interface TransferablePattern {
  /** Pattern identifier (e.g., "portal-gate-pattern") */
  id: string;
  /** What this pattern does */
  description: string;
  /** Project where first encountered */
  learnedIn: string;
  /** Projects where successfully applied */
  appliedIn: string[];
  /** Success rate 0.0-1.0 */
  successRate: number;
  /** Optional linked protocol ID */
  linkedProtocol?: string;
  /** Optional linked lore entry IDs */
  linkedLore?: string[];
}

// ────────────────────────────────────────────────────────
// Per-Project Context
// ────────────────────────────────────────────────────────

export interface AgentProjectContext {
  /** Areas of focus in this project */
  focus: string[];
  /** Preferred model for this project */
  defaultModel?: 'opus' | 'sonnet' | 'haiku';
  /** Project-specific habits */
  habits?: string[];
  /** ISO date of last activity */
  lastActive?: string;
  /** Number of sessions in this project */
  sessionsInProject?: number;
}

// ────────────────────────────────────────────────────────
// Defaults
// ────────────────────────────────────────────────────────

export const DEFAULT_PERSONALITIES: Record<string, AgentPersonality> = {
  architect: { style: 'deliberate', risk: 'conservative', verbosity: 'detailed' },
  builder: { style: 'rapid', risk: 'balanced', verbosity: 'concise' },
  tester: { style: 'methodical', risk: 'conservative', verbosity: 'concise' },
  reviewer: { style: 'deliberate', risk: 'conservative', verbosity: 'detailed' },
  security: { style: 'methodical', risk: 'conservative', verbosity: 'detailed' },
};
