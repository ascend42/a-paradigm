/**
 * Type definitions for agent scoped permissions, adoption records,
 * and shift recommendations.
 *
 * Part of the Agent Adoption Contracts & Scoped Permissions system.
 * See docs/specs/agent-adoption.md for full specification.
 */

// ============================================================================
// Scoped Permissions
// ============================================================================

/** A single scoped permission declared by an agent */
export interface ScopePermission {
  id: string;
  description: string;
}

/** Scope declaration block within an .agent file */
export interface AgentScopes {
  version: string;
  approved?: string;
  permissions: ScopePermission[];
  dangerous?: string[];
}

// ============================================================================
// Scope Diffing
// ============================================================================

/** A single entry in a scope diff, showing what changed */
export interface ScopeDiffEntry {
  scope: ScopePermission;
  status: 'new' | 'removed' | 'kept' | 'expanded';
}

/** The diff between two scope versions */
export interface ScopeDiff {
  agentId: string;
  previousVersion: string;
  newVersion: string;
  added: ScopePermission[];
  removed: ScopePermission[];
  kept: ScopePermission[];
  entries: ScopeDiffEntry[];
  requiresApproval: boolean;
}

// ============================================================================
// Adoption Records
// ============================================================================

/** Record of a single agent's adoption within a project */
export interface AdoptionRecord {
  adopted: string;
  source: 'core' | 'ecosystem' | 'marketplace';
  version?: string;
  defaultsAccepted: boolean;
  overrides?: Record<string, unknown>;
  scopesApproved?: string;
  detectedFrom?: string[];
}

/** The .paradigm/adoptions.yaml file structure */
export interface AdoptionsFile {
  version: string;
  adoptedAt: string;
  projectType: string;
  agents: Record<string, AdoptionRecord>;
  /** Whether the integrity hash was verified on load */
  verified?: boolean;
  /** SHA-256 hash of the agents record for tamper detection */
  integrityHash?: string;
}

// ============================================================================
// Agent Configurable Behaviors
// ============================================================================

/** A single configurable option declared by an agent */
export interface ConfigurableOption {
  type: 'boolean' | 'string' | 'number' | 'enum';
  default: unknown;
  description: string;
  values?: string[];
}

// ============================================================================
// Shift Recommendations
// ============================================================================

/** A post-shift recommendation shown to the user */
export interface ShiftRecommendation {
  id: string;
  priority: number;
  message: string;
  command?: string;
  type: 'action' | 'info';
}

// ============================================================================
// Approval States
// ============================================================================

/** Scope approval state for an agent */
export type ApprovalState = 'approved' | 'pending' | 'denied';
