/**
 * Loader for agents.yaml and team-state.yaml
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  AgentsManifest,
  TeamState,
  Handoff,
  DEFAULT_AGENTS,
  AgentDefinition,
} from './types.js';

/**
 * Get the .paradigm directory path
 */
export function getParadigmDir(rootDir: string): string {
  return path.join(rootDir, '.paradigm');
}

/**
 * Check if .paradigm directory exists
 */
export function paradigmExists(rootDir: string): boolean {
  return fs.existsSync(getParadigmDir(rootDir));
}

/**
 * Get agents.yaml path
 */
export function getAgentsPath(rootDir: string): string {
  return path.join(getParadigmDir(rootDir), 'agents.yaml');
}

/**
 * Get team-state.yaml path
 */
export function getTeamStatePath(rootDir: string): string {
  return path.join(getParadigmDir(rootDir), 'team-state.yaml');
}

/**
 * Get handoffs directory path
 */
export function getHandoffsDir(rootDir: string): string {
  return path.join(getParadigmDir(rootDir), 'handoffs');
}

/**
 * Check if agents are configured
 */
export function agentsConfigured(rootDir: string): boolean {
  return fs.existsSync(getAgentsPath(rootDir));
}

/**
 * Load agents.yaml
 */
export function loadAgentsManifest(rootDir: string): AgentsManifest | null {
  const agentsPath = getAgentsPath(rootDir);
  
  if (!fs.existsSync(agentsPath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(agentsPath, 'utf8');
    return yaml.load(content) as AgentsManifest;
  } catch {
    return null;
  }
}

/**
 * Save agents.yaml
 */
export function saveAgentsManifest(rootDir: string, manifest: AgentsManifest): void {
  const agentsPath = getAgentsPath(rootDir);
  const paradigmDir = getParadigmDir(rootDir);
  
  if (!fs.existsSync(paradigmDir)) {
    fs.mkdirSync(paradigmDir, { recursive: true });
  }
  
  const content = yaml.dump(manifest, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
  });
  
  fs.writeFileSync(agentsPath, content);
}

/**
 * Load team-state.yaml
 */
export function loadTeamState(rootDir: string): TeamState {
  const statePath = getTeamStatePath(rootDir);
  
  if (!fs.existsSync(statePath)) {
    return {
      current: null,
      queue: [],
      recent: [],
      blocked: [],
    };
  }
  
  try {
    const content = fs.readFileSync(statePath, 'utf8');
    return yaml.load(content) as TeamState;
  } catch {
    return {
      current: null,
      queue: [],
      recent: [],
      blocked: [],
    };
  }
}

/**
 * Save team-state.yaml
 */
export function saveTeamState(rootDir: string, state: TeamState): void {
  const statePath = getTeamStatePath(rootDir);
  const paradigmDir = getParadigmDir(rootDir);
  
  if (!fs.existsSync(paradigmDir)) {
    fs.mkdirSync(paradigmDir, { recursive: true });
  }
  
  const content = yaml.dump(state, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
  });
  
  fs.writeFileSync(statePath, content);
}

/**
 * Load a specific handoff
 */
export function loadHandoff(rootDir: string, handoffId: string): Handoff | null {
  const handoffPath = path.join(getHandoffsDir(rootDir), `${handoffId}.yaml`);
  
  if (!fs.existsSync(handoffPath)) {
    return null;
  }
  
  try {
    const content = fs.readFileSync(handoffPath, 'utf8');
    return yaml.load(content) as Handoff;
  } catch {
    return null;
  }
}

/**
 * Save a handoff
 */
export function saveHandoff(rootDir: string, handoff: Handoff): void {
  const handoffsDir = getHandoffsDir(rootDir);
  
  if (!fs.existsSync(handoffsDir)) {
    fs.mkdirSync(handoffsDir, { recursive: true });
  }
  
  const handoffPath = path.join(handoffsDir, `${handoff.id}.yaml`);
  const content = yaml.dump(handoff, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
  });
  
  fs.writeFileSync(handoffPath, content);
}

/**
 * List all handoffs
 */
export function listHandoffs(rootDir: string): Handoff[] {
  const handoffsDir = getHandoffsDir(rootDir);
  
  if (!fs.existsSync(handoffsDir)) {
    return [];
  }
  
  const files = fs.readdirSync(handoffsDir).filter(f => f.endsWith('.yaml'));
  const handoffs: Handoff[] = [];
  
  for (const file of files) {
    const handoffId = file.replace('.yaml', '');
    const handoff = loadHandoff(rootDir, handoffId);
    if (handoff) {
      handoffs.push(handoff);
    }
  }
  
  return handoffs.sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

/**
 * Get pending handoffs
 */
export function getPendingHandoffs(rootDir: string): Handoff[] {
  return listHandoffs(rootDir).filter(h => h.status === 'pending');
}

/**
 * Generate default agents.yaml content
 */
export function generateDefaultManifest(projectName: string = 'project'): AgentsManifest {
  const agents: Record<string, AgentDefinition> = {};
  
  for (const [name, def] of Object.entries(DEFAULT_AGENTS)) {
    agents[name] = {
      name,
      ...def,
    };
  }
  
  return {
    version: '1.0.0',
    team: {
      name: `${projectName}-team`,
      default_agent: 'architect',
      require_handoff: false,
    },
    agents,
  };
}

/**
 * Get an agent definition by name
 */
export function getAgent(rootDir: string, agentName: string): AgentDefinition | null {
  const manifest = loadAgentsManifest(rootDir);
  if (!manifest) return null;
  
  return manifest.agents[agentName] || null;
}

/**
 * Add activity to team state
 */
export function addActivity(
  rootDir: string,
  activity: Omit<import('./types.js').TeamActivity, 'timestamp'>
): void {
  const state = loadTeamState(rootDir);
  
  state.recent.unshift({
    ...activity,
    timestamp: new Date().toISOString(),
  });
  
  // Keep last 20 activities
  state.recent = state.recent.slice(0, 20);
  
  saveTeamState(rootDir, state);
}

/**
 * Set current agent and task
 */
export function setCurrentAgent(
  rootDir: string,
  agent: string,
  task: string
): void {
  const state = loadTeamState(rootDir);
  
  state.current = {
    agent,
    task,
    started: new Date().toISOString(),
    symbols_touched: [],
  };
  
  saveTeamState(rootDir, state);
}

/**
 * Clear current agent (task completed)
 */
export function clearCurrentAgent(rootDir: string): void {
  const state = loadTeamState(rootDir);
  state.current = null;
  saveTeamState(rootDir, state);
}
