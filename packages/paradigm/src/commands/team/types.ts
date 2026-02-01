/**
 * Types for Paradigm Multi-Agent Team Orchestration
 */

export interface AgentFocus {
  reads: string[];    // Symbol patterns this agent can read (e.g., "@features", "^gates")
  writes: string[];   // File patterns this agent can write (e.g., "src/**", ".purpose")
}

export interface AgentTrigger {
  type: 'keyword' | 'symbol' | 'handoff' | 'schedule';
  match?: string[];   // For keyword/symbol triggers
  from?: string;      // For handoff triggers
  cron?: string;      // For schedule triggers
}

export interface AgentDefinition {
  name: string;
  role: string;       // Multi-line description of agent's role
  focus: AgentFocus;
  triggers: AgentTrigger[];
  handoff_to: string[];  // Agents this one can hand off to
}

export interface TeamConfig {
  name: string;
  default_agent: string;
  require_handoff: boolean;
}

export interface AgentsManifest {
  version: string;
  team: TeamConfig;
  agents: Record<string, AgentDefinition>;
}

export interface TeamActivity {
  agent: string;
  task: string;
  timestamp: string;
  result?: 'success' | 'failed' | 'blocked';
  artifacts?: string[];
  handed_to?: string;
  note?: string;
}

export interface QueueItem {
  agent: string;
  waiting_for: string;
  task: string;
}

export interface BlockedItem {
  agent: string;
  reason: string;
  since: string;
}

export interface TeamState {
  current: {
    agent: string;
    task: string;
    started: string;
    symbols_touched: string[];
  } | null;
  queue: QueueItem[];
  recent: TeamActivity[];
  blocked: BlockedItem[];
}

export interface HandoffContext {
  summary: string;
  key_symbols: Array<{
    symbol: string;
    relevance: string;
  }>;
  warnings: string[];
  suggested_approach?: string;
}

export interface Handoff {
  id: string;
  from: string;
  to: string;
  timestamp: string;
  status: 'pending' | 'accepted' | 'completed' | 'rejected';
  completed: {
    symbols: string[];
    artifacts: Array<{
      path: string;
      description: string;
    }>;
  };
  context: HandoffContext;
  accepted_at?: string;
  accepted_by?: string;
  acceptance_note?: string;
}

// Default agent definitions
export const DEFAULT_AGENTS: Record<string, Omit<AgentDefinition, 'name'>> = {
  architect: {
    role: `You design system architecture, write specifications, and plan features.
You do NOT write implementation code - that's the Builder's job.
When your spec is ready, hand off to Builder with 'paradigm team handoff --to builder'.`,
    focus: {
      reads: ['@features', '$flows', 'specs/*.md', 'health.yaml'],
      writes: ['specs/*.md', '.purpose'],
    },
    triggers: [
      { type: 'keyword', match: ['design', 'architect', 'plan', 'spec'] },
      { type: 'symbol', match: ['@*', '$*'] },
    ],
    handoff_to: ['builder', 'reviewer'],
  },
  builder: {
    role: `You implement code based on specifications from the Architect.
Follow the spec exactly. If spec is unclear, hand back to Architect.
When implementation is ready, hand off to Reviewer with 'paradigm team handoff --to reviewer'.`,
    focus: {
      reads: ['#components', 'specs/*.md', 'src/**', 'tests/**'],
      writes: ['src/**', 'tests/**'],
    },
    triggers: [
      { type: 'keyword', match: ['implement', 'build', 'code', 'fix'] },
      { type: 'handoff', from: 'architect' },
    ],
    handoff_to: ['reviewer', 'architect'],
  },
  reviewer: {
    role: `You review code for correctness, security, and adherence to specs.
Check all ^gate requirements are met.
Approve or request changes. Do NOT implement fixes yourself.
Hand back to Builder for fixes, or to Tester when approved.`,
    focus: {
      reads: ['^gates', '!signals', 'portal.yaml', 'src/**', 'specs/*.md'],
      writes: ['reviews/*.md'],
    },
    triggers: [
      { type: 'keyword', match: ['review', 'check', 'audit', 'approve'] },
      { type: 'handoff', from: 'builder' },
    ],
    handoff_to: ['builder', 'tester'],
  },
  tester: {
    role: `You verify implementations work correctly.
Run tests, check portal validations, verify health status.
Report issues back to Builder. Update health.yaml when verified.`,
    focus: {
      reads: ['tests/**', 'portal.yaml', 'health.yaml', '#components'],
      writes: ['tests/**', 'health.yaml'],
    },
    triggers: [
      { type: 'keyword', match: ['test', 'verify', 'qa', 'validate'] },
      { type: 'handoff', from: 'reviewer' },
    ],
    handoff_to: ['builder', 'architect'],
  },
  security: {
    role: `You audit for security issues, especially around ^gates.
Review auth flows, check for vulnerabilities.
Flag issues but do NOT implement fixes - hand to Builder for that.`,
    focus: {
      reads: ['^gates', '!signals', 'portal.yaml', 'src/**'],
      writes: ['security/*.md'],
    },
    triggers: [
      { type: 'keyword', match: ['security', 'audit', 'vulnerability', 'auth'] },
    ],
    handoff_to: ['builder', 'architect'],
  },
};
