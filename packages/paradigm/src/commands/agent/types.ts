/**
 * CLI option interfaces for paradigm agent commands
 */

export interface AgentListOptions {
  json?: boolean;
  global?: boolean;
  project?: boolean;
}

export interface AgentShowOptions {
  json?: boolean;
}

export interface AgentCreateOptions {
  role?: string;
  description?: string;
  global?: boolean;
}

export interface AgentSyncOptions {
  dryRun?: boolean;
  json?: boolean;
}
