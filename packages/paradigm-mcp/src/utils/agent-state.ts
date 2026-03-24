/**
 * Agent State — per-project + global state tracking for agent continuity
 *
 * Storage:
 *   .paradigm/agent-state/{agent-id}.yaml     (project-scoped, committed)
 *   ~/.paradigm/agents/{agent-id}/state.yaml   (global, cross-project)
 *
 * Project state: what the agent did on THIS project (last session, pending work, patterns)
 * Global state: career stats across all projects (total sessions, project history)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';

// ────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────

export interface AgentSessionSummary {
  date: string;
  sessionId: string;
  summary: string;
  filesReviewed?: string[];
  symbolsTouched?: string[];
  decisions?: string[];
}

export interface AgentProjectState {
  id: string;
  project: string;
  lastSession: AgentSessionSummary;
  pendingWork: string[];
  recentPatterns: string[];
  sessionsOnProject: number;
  lastPurposeUpdate?: string;
}

export interface GlobalAgentState {
  id: string;
  totalSessions: number;
  lastActiveProject: string;
  lastActiveDate: string;
  projectHistory: Array<{
    project: string;
    sessions: number;
    lastActive: string;
  }>;
}

// ────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────

const PROJECT_STATE_DIR = '.paradigm/agent-state';
const GLOBAL_AGENTS_DIR = path.join(os.homedir(), '.paradigm', 'agents');

// ────────────────────────────────────────────────────────
// Project State (per-project)
// ────────────────────────────────────────────────────────

/**
 * Load agent's project-scoped state.
 */
export function loadAgentState(agentId: string, rootDir: string): AgentProjectState | null {
  const statePath = path.join(rootDir, PROJECT_STATE_DIR, `${agentId}.yaml`);
  if (!fs.existsSync(statePath)) return null;

  try {
    const content = fs.readFileSync(statePath, 'utf8');
    return yaml.load(content) as AgentProjectState;
  } catch {
    return null;
  }
}

/**
 * Save agent's project-scoped state.
 */
export function saveAgentState(agentId: string, rootDir: string, state: AgentProjectState): void {
  const stateDir = path.join(rootDir, PROJECT_STATE_DIR);
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  const statePath = path.join(stateDir, `${agentId}.yaml`);
  fs.writeFileSync(statePath, yaml.dump(state, { lineWidth: 120, noRefs: true, sortKeys: false }), 'utf8');
}

/**
 * Update agent's project state with a new session summary.
 * Creates state if it doesn't exist.
 */
export function recordAgentSession(
  agentId: string,
  rootDir: string,
  session: {
    sessionId: string;
    summary: string;
    filesReviewed?: string[];
    symbolsTouched?: string[];
    decisions?: string[];
    pendingWork?: string[];
    patterns?: string[];
  }
): AgentProjectState {
  const existing = loadAgentState(agentId, rootDir);
  const projectName = path.basename(rootDir);

  const state: AgentProjectState = {
    id: agentId,
    project: projectName,
    lastSession: {
      date: new Date().toISOString(),
      sessionId: session.sessionId,
      summary: session.summary,
      filesReviewed: session.filesReviewed,
      symbolsTouched: session.symbolsTouched,
      decisions: session.decisions,
    },
    pendingWork: session.pendingWork || existing?.pendingWork || [],
    recentPatterns: session.patterns || existing?.recentPatterns || [],
    sessionsOnProject: (existing?.sessionsOnProject || 0) + 1,
    lastPurposeUpdate: existing?.lastPurposeUpdate,
  };

  saveAgentState(agentId, rootDir, state);

  // Also update global state
  updateGlobalAgentState(agentId, projectName);

  return state;
}

/**
 * Add pending work items to an agent's project state.
 */
export function addPendingWork(agentId: string, rootDir: string, items: string[]): void {
  const state = loadAgentState(agentId, rootDir);
  if (!state) return;

  state.pendingWork = [...new Set([...state.pendingWork, ...items])];
  saveAgentState(agentId, rootDir, state);
}

/**
 * Remove completed pending work items.
 */
export function completePendingWork(agentId: string, rootDir: string, completedItems: string[]): void {
  const state = loadAgentState(agentId, rootDir);
  if (!state) return;

  const completedSet = new Set(completedItems.map(i => i.toLowerCase()));
  state.pendingWork = state.pendingWork.filter(item => !completedSet.has(item.toLowerCase()));
  saveAgentState(agentId, rootDir, state);
}

/**
 * Record a pattern the agent learned about this project.
 */
export function addProjectPattern(agentId: string, rootDir: string, pattern: string): void {
  const state = loadAgentState(agentId, rootDir);
  if (!state) return;

  if (!state.recentPatterns.includes(pattern)) {
    state.recentPatterns.push(pattern);
    // Keep max 10 recent patterns
    if (state.recentPatterns.length > 10) {
      state.recentPatterns = state.recentPatterns.slice(-10);
    }
    saveAgentState(agentId, rootDir, state);
  }
}

// ────────────────────────────────────────────────────────
// Global State (cross-project)
// ────────────────────────────────────────────────────────

/**
 * Load agent's global state (career stats across all projects).
 */
export function loadGlobalAgentState(agentId: string): GlobalAgentState | null {
  const statePath = path.join(GLOBAL_AGENTS_DIR, agentId, 'state.yaml');
  if (!fs.existsSync(statePath)) return null;

  try {
    const content = fs.readFileSync(statePath, 'utf8');
    return yaml.load(content) as GlobalAgentState;
  } catch {
    return null;
  }
}

/**
 * Update global state when an agent works on a project.
 */
export function updateGlobalAgentState(agentId: string, projectName: string): void {
  const stateDir = path.join(GLOBAL_AGENTS_DIR, agentId);
  if (!fs.existsSync(stateDir)) {
    fs.mkdirSync(stateDir, { recursive: true });
  }

  const statePath = path.join(stateDir, 'state.yaml');
  const existing = loadGlobalAgentState(agentId);
  const now = new Date().toISOString();

  const history = existing?.projectHistory || [];
  const projectEntry = history.find(h => h.project === projectName);
  if (projectEntry) {
    projectEntry.sessions += 1;
    projectEntry.lastActive = now;
  } else {
    history.push({ project: projectName, sessions: 1, lastActive: now });
  }

  // Sort by lastActive descending
  history.sort((a, b) => b.lastActive.localeCompare(a.lastActive));

  const state: GlobalAgentState = {
    id: agentId,
    totalSessions: (existing?.totalSessions || 0) + 1,
    lastActiveProject: projectName,
    lastActiveDate: now,
    projectHistory: history,
  };

  fs.writeFileSync(statePath, yaml.dump(state, { lineWidth: 120, noRefs: true, sortKeys: false }), 'utf8');
}

/**
 * Load all agent states for a project (for listing).
 */
export function loadAllAgentStates(rootDir: string): AgentProjectState[] {
  const stateDir = path.join(rootDir, PROJECT_STATE_DIR);
  if (!fs.existsSync(stateDir)) return [];

  try {
    return fs.readdirSync(stateDir)
      .filter(f => f.endsWith('.yaml'))
      .map(f => {
        try {
          const content = fs.readFileSync(path.join(stateDir, f), 'utf8');
          return yaml.load(content) as AgentProjectState;
        } catch { return null; }
      })
      .filter(Boolean) as AgentProjectState[];
  } catch {
    return [];
  }
}
