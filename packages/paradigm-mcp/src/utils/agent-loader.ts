/**
 * Agent Loader — CRUD for .agent identity files, expertise queries, merge logic
 *
 * Storage layout:
 *   ~/.paradigm/agents/       Global agent identities (travel across projects)
 *     architect.agent
 *     builder.agent
 *
 *   .paradigm/agents/         Project-level overrides
 *     builder.agent            e.g., different model preference for this project
 *
 * Merge priority: project .agent > global .agent > agents.yaml
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as yaml from 'js-yaml';
import type {
  AgentProfile,
  AgentPermissions,
  AgentExpertiseEntry,
  AgentPersonality,
  AgentProjectContext,
} from '../types/agents.js';
import { DEFAULT_PERSONALITIES } from '../types/agents.js';

// ────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────

const GLOBAL_AGENTS_DIR = path.join(os.homedir(), '.paradigm', 'agents');
const PROJECT_AGENTS_DIR = '.paradigm/agents';
const AGENT_EXT = '.agent';

/** Exponential moving average weight for new observations */
const EMA_ALPHA = 0.3;

// ────────────────────────────────────────────────────────
// Read Operations
// ────────────────────────────────────────────────────────

/**
 * Load a single agent profile. Project-level overrides global.
 */
export function loadAgentProfile(rootDir: string, agentId: string): AgentProfile | null {
  // Try project-level first
  const projectPath = path.join(rootDir, PROJECT_AGENTS_DIR, `${agentId}${AGENT_EXT}`);
  if (fs.existsSync(projectPath)) {
    try {
      const content = fs.readFileSync(projectPath, 'utf-8');
      return yaml.load(content) as AgentProfile;
    } catch { /* fall through */ }
  }

  // Try global
  const globalPath = path.join(GLOBAL_AGENTS_DIR, `${agentId}${AGENT_EXT}`);
  if (fs.existsSync(globalPath)) {
    try {
      const content = fs.readFileSync(globalPath, 'utf-8');
      const globalProfile = yaml.load(content) as AgentProfile;

      // If both exist, deep-merge project over global
      if (fs.existsSync(projectPath)) {
        try {
          const projectContent = fs.readFileSync(projectPath, 'utf-8');
          const projectProfile = yaml.load(projectContent) as Partial<AgentProfile>;
          return deepMergeProfiles(globalProfile, projectProfile);
        } catch { /* use global */ }
      }

      return globalProfile;
    } catch { /* fall through */ }
  }

  return null;
}

/**
 * Load all agent profiles from both global and project dirs, deduplicated by id.
 */
export function loadAllAgentProfiles(rootDir: string): AgentProfile[] {
  const profiles = new Map<string, AgentProfile>();

  // Load global profiles first
  if (fs.existsSync(GLOBAL_AGENTS_DIR)) {
    try {
      const files = fs.readdirSync(GLOBAL_AGENTS_DIR)
        .filter(f => f.endsWith(AGENT_EXT));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(GLOBAL_AGENTS_DIR, file), 'utf-8');
          const profile = yaml.load(content) as AgentProfile;
          if (profile?.id) {
            profiles.set(profile.id, profile);
          }
        } catch { /* skip invalid */ }
      }
    } catch { /* dir read error */ }
  }

  // Load project profiles, overriding globals
  const projectDir = path.join(rootDir, PROJECT_AGENTS_DIR);
  if (fs.existsSync(projectDir)) {
    try {
      const files = fs.readdirSync(projectDir)
        .filter(f => f.endsWith(AGENT_EXT));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(projectDir, file), 'utf-8');
          const projectProfile = yaml.load(content) as AgentProfile;
          if (!projectProfile?.id) continue;

          const existing = profiles.get(projectProfile.id);
          if (existing) {
            profiles.set(projectProfile.id, deepMergeProfiles(existing, projectProfile));
          } else {
            profiles.set(projectProfile.id, projectProfile);
          }
        } catch { /* skip invalid */ }
      }
    } catch { /* dir read error */ }
  }

  return Array.from(profiles.values());
}

// ────────────────────────────────────────────────────────
// Write Operations
// ────────────────────────────────────────────────────────

/**
 * Save an agent profile to the specified scope.
 */
export function saveAgentProfile(
  agentId: string,
  profile: AgentProfile,
  scope: 'global' | 'project',
  rootDir?: string
): string {
  const dir = scope === 'global'
    ? GLOBAL_AGENTS_DIR
    : path.join(rootDir || process.cwd(), PROJECT_AGENTS_DIR);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const filePath = path.join(dir, `${agentId}${AGENT_EXT}`);

  // Auto-compute integrity hash if permissions are set
  if (profile.permissions) {
    profile.integrityHash = computeIntegrityHash(profile);
  }

  profile.updated = new Date().toISOString();

  const content = yaml.dump(profile, {
    lineWidth: 120,
    noRefs: true,
    sortKeys: false,
  });

  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

/**
 * Create a new agent profile with sensible defaults.
 */
export function createAgentProfile(
  agentId: string,
  opts: {
    role?: string;
    description?: string;
    scope?: 'global' | 'project';
    rootDir?: string;
  } = {}
): { profile: AgentProfile; filePath: string } {
  const now = new Date().toISOString();

  const profile: AgentProfile = {
    id: agentId,
    role: opts.role || `${agentId.charAt(0).toUpperCase() + agentId.slice(1)} agent`,
    description: opts.description || `Persistent identity for the ${agentId} agent role`,
    version: '1.0.0',
    personality: DEFAULT_PERSONALITIES[agentId] || {
      style: 'balanced' as 'deliberate',
      risk: 'balanced',
      verbosity: 'concise',
    },
    expertise: [],
    transferable: [],
    contexts: {},
    created: now,
    updated: now,
  };

  // Fix: use a valid default if not in DEFAULT_PERSONALITIES
  if (!DEFAULT_PERSONALITIES[agentId]) {
    profile.personality = { style: 'deliberate', risk: 'balanced', verbosity: 'concise' };
  }

  const scope = opts.scope || 'global';
  const filePath = saveAgentProfile(agentId, profile, scope, opts.rootDir);

  return { profile, filePath };
}

// ────────────────────────────────────────────────────────
// Expertise Queries
// ────────────────────────────────────────────────────────

/**
 * Find the best agents for a given symbol, sorted by confidence.
 */
export function queryExpertise(
  rootDir: string,
  symbol: string
): Array<{ agentId: string; entry: AgentExpertiseEntry }> {
  const profiles = loadAllAgentProfiles(rootDir);
  const results: Array<{ agentId: string; entry: AgentExpertiseEntry }> = [];

  for (const profile of profiles) {
    const entry = (profile.expertise || []).find(e => e.symbol === symbol);
    if (entry) {
      results.push({ agentId: profile.id, entry });
    }
  }

  return results.sort((a, b) => b.entry.confidence - a.entry.confidence);
}

// ────────────────────────────────────────────────────────
// Expertise Auto-Update
// ────────────────────────────────────────────────────────

/**
 * Update agent expertise from a lore entry.
 * Uses exponential moving average for confidence scores.
 */
export function updateExpertiseFromLore(
  rootDir: string,
  agentId: string,
  loreData: {
    symbols_touched: string[];
    confidence?: number;
  }
): boolean {
  const profile = loadAgentProfile(rootDir, agentId);
  if (!profile) return false;

  const now = new Date().toISOString();
  const expertise = profile.expertise || [];

  for (const symbol of loreData.symbols_touched) {
    const existing = expertise.find(e => e.symbol === symbol);

    if (existing) {
      existing.sessions++;
      existing.lastTouch = now;
      if (loreData.confidence != null) {
        existing.confidence = (1 - EMA_ALPHA) * existing.confidence + EMA_ALPHA * loreData.confidence;
      }
    } else {
      expertise.push({
        symbol,
        confidence: loreData.confidence ?? 0.5,
        sessions: 1,
        lastTouch: now,
      });
    }
  }

  profile.expertise = expertise;

  // Update project context
  const projectName = detectProjectName(rootDir);
  if (projectName) {
    const ctx = profile.contexts[projectName] || { focus: [], sessionsInProject: 0 };
    ctx.lastActive = now;
    ctx.sessionsInProject = (ctx.sessionsInProject || 0) + 1;
    profile.contexts[projectName] = ctx;
  }

  // Determine scope — save to whichever location already has the file, or global
  const projectPath = path.join(rootDir, PROJECT_AGENTS_DIR, `${agentId}${AGENT_EXT}`);
  const scope = fs.existsSync(projectPath) ? 'project' as const : 'global' as const;
  saveAgentProfile(agentId, profile, scope, rootDir);

  return true;
}

/**
 * Update expertise based on a lore assessment verdict.
 */
export function updateExpertiseFromAssessment(
  rootDir: string,
  agentId: string,
  data: {
    symbols_touched: string[];
    verdict: 'correct' | 'partial' | 'incorrect';
  }
): boolean {
  const profile = loadAgentProfile(rootDir, agentId);
  if (!profile) return false;

  const verdictScore = { correct: 1.0, partial: 0.5, incorrect: 0.0 };
  const score = verdictScore[data.verdict];

  for (const symbol of data.symbols_touched) {
    const existing = (profile.expertise || []).find(e => e.symbol === symbol);
    if (existing) {
      // Nudge confidence toward the assessment verdict
      existing.confidence = (1 - EMA_ALPHA) * existing.confidence + EMA_ALPHA * score;
    }
  }

  const projectPath = path.join(rootDir, PROJECT_AGENTS_DIR, `${agentId}${AGENT_EXT}`);
  const scope = fs.existsSync(projectPath) ? 'project' as const : 'global' as const;
  saveAgentProfile(agentId, profile, scope, rootDir);

  return true;
}

// ────────────────────────────────────────────────────────
// Orchestration Merge
// ────────────────────────────────────────────────────────

/**
 * Merge an agents.yaml AgentDefinition with an .agent profile.
 * Returns enriched data for prompt building.
 */
export function mergeAgentProfileWithManifest(
  agentDef: { name: string; role: string; defaultModel?: string },
  profile: AgentProfile | null,
  projectName: string
): {
  personality: AgentPersonality | null;
  topExpertise: AgentExpertiseEntry[];
  projectContext: AgentProjectContext | null;
  transferablePatterns: Array<{ id: string; description: string; successRate: number }>;
} {
  if (!profile) {
    return {
      personality: null,
      topExpertise: [],
      projectContext: null,
      transferablePatterns: [],
    };
  }

  return {
    personality: profile.personality || null,
    topExpertise: (profile.expertise || [])
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10),
    projectContext: profile.contexts?.[projectName] || null,
    transferablePatterns: (profile.transferable || [])
      .filter(p => p.successRate >= 0.7)
      .map(p => ({ id: p.id, description: p.description, successRate: p.successRate })),
  };
}

/**
 * Build prompt enrichment text from agent profile for orchestration.
 */
export function buildProfileEnrichment(
  profile: AgentProfile,
  relevantSymbols: string[],
  notebookEntries?: Array<{ context: string; snippet: string; concepts: string[] }>
): string {
  const parts: string[] = [];

  // Personality section
  if (profile.personality) {
    const p = profile.personality;
    parts.push(`## Agent Identity: ${profile.id}`);
    parts.push(`**Style:** ${p.style} | **Risk:** ${p.risk} | **Verbosity:** ${p.verbosity}`);
    parts.push('');
  }

  // Relevant expertise
  const relevant = (profile.expertise || [])
    .filter(e => relevantSymbols.length === 0 || relevantSymbols.includes(e.symbol))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 8);

  if (relevant.length > 0) {
    parts.push('## Your Expertise on Relevant Symbols');
    for (const e of relevant) {
      parts.push(`- \`${e.symbol}\`: confidence ${e.confidence.toFixed(2)} (${e.sessions} sessions)`);
    }
    parts.push('');
  }

  // Transferable patterns
  const patterns = (profile.transferable || []).filter(p => p.successRate >= 0.7);
  if (patterns.length > 0) {
    parts.push('## Transferable Patterns');
    for (const p of patterns) {
      const appliedCount = p.appliedIn?.length || 0;
      parts.push(`- ${p.id}: ${(p.successRate * 100).toFixed(0)}% success (learned in ${p.learnedIn}${appliedCount > 0 ? `, applied in ${appliedCount} projects` : ''})`);
    }
    parts.push('');
  }

  // Notebook entries (curated snippets)
  if (notebookEntries && notebookEntries.length > 0) {
    parts.push('## Relevant Notebook Entries');
    for (const nb of notebookEntries.slice(0, 5)) {
      parts.push(`### ${nb.context}`);
      parts.push(`Concepts: ${nb.concepts.join(', ')}`);
      parts.push('```');
      // Truncate long snippets
      const snippet = nb.snippet.length > 300 ? nb.snippet.slice(0, 300) + '...' : nb.snippet;
      parts.push(snippet);
      parts.push('```');
      parts.push('');
    }
  }

  return parts.join('\n');
}

// ────────────────────────────────────────────────────────
// Sync from Lore
// ────────────────────────────────────────────────────────

/**
 * Bootstrap expertise from existing lore entries for a given agent.
 * Returns the number of entries processed.
 */
export async function syncExpertiseFromLore(
  rootDir: string,
  agentId: string,
  dryRun = false
): Promise<{ entriesProcessed: number; symbolsUpdated: number }> {
  // Dynamic import to avoid circular deps
  const { loadLoreEntries } = await import('./lore-loader.js');

  const entries = await loadLoreEntries(rootDir, { limit: 500 });
  let entriesProcessed = 0;
  let symbolsUpdated = new Set<string>();

  const profile = loadAgentProfile(rootDir, agentId) ||
    createAgentProfile(agentId, { rootDir }).profile;

  const expertise = profile.expertise || [];

  for (const entry of entries) {
    if (!entry.symbols_touched || entry.symbols_touched.length === 0) continue;

    entriesProcessed++;

    for (const symbol of entry.symbols_touched) {
      symbolsUpdated.add(symbol);
      const existing = expertise.find(e => e.symbol === symbol);

      if (existing) {
        existing.sessions++;
        existing.lastTouch = entry.timestamp;
        if (entry.confidence != null) {
          existing.confidence = (1 - EMA_ALPHA) * existing.confidence + EMA_ALPHA * entry.confidence;
        }
      } else {
        expertise.push({
          symbol,
          confidence: entry.confidence ?? 0.5,
          sessions: 1,
          lastTouch: entry.timestamp,
        });
      }
    }
  }

  profile.expertise = expertise;

  if (!dryRun) {
    const projectPath = path.join(rootDir, PROJECT_AGENTS_DIR, `${agentId}${AGENT_EXT}`);
    const scope = fs.existsSync(projectPath) ? 'project' as const : 'global' as const;
    saveAgentProfile(agentId, profile, scope, rootDir);
  }

  return { entriesProcessed, symbolsUpdated: symbolsUpdated.size };
}

// ────────────────────────────────────────────────────────
// Permission Checking
// ────────────────────────────────────────────────────────

/**
 * Check if an agent has permission to access a file path.
 * Deny patterns always override allow patterns.
 */
export function checkPathPermission(
  profile: AgentProfile,
  filePath: string,
  mode: 'read' | 'write'
): { allowed: boolean; reason?: string } {
  if (!profile.permissions?.paths) {
    return { allowed: true }; // No permissions = unrestricted
  }

  const { read, write, deny } = profile.permissions.paths;

  // Check deny first — deny always wins
  if (deny && deny.length > 0) {
    for (const pattern of deny) {
      if (matchGlob(pattern, filePath)) {
        return { allowed: false, reason: `Path denied by pattern: ${pattern}` };
      }
    }
  }

  // Check mode-specific patterns
  const allowPatterns = mode === 'read' ? read : write;
  if (allowPatterns && allowPatterns.length > 0) {
    for (const pattern of allowPatterns) {
      if (matchGlob(pattern, filePath)) {
        return { allowed: true };
      }
    }
    // Has allow patterns but none matched
    return { allowed: false, reason: `No ${mode} pattern matches: ${filePath}` };
  }

  return { allowed: true }; // No allow patterns = unrestricted for this mode
}

/**
 * Check if an agent has permission to use a tool.
 * Deny patterns always override allow patterns.
 */
export function checkToolPermission(
  profile: AgentProfile,
  toolName: string
): { allowed: boolean; reason?: string } {
  if (!profile.permissions?.tools) {
    return { allowed: true }; // No permissions = unrestricted
  }

  const { allow, deny } = profile.permissions.tools;

  // Check deny first
  if (deny && deny.length > 0) {
    for (const pattern of deny) {
      if (matchGlob(pattern, toolName)) {
        return { allowed: false, reason: `Tool denied by pattern: ${pattern}` };
      }
    }
  }

  // Check allow
  if (allow && allow.length > 0) {
    for (const pattern of allow) {
      if (matchGlob(pattern, toolName)) {
        return { allowed: true };
      }
    }
    return { allowed: false, reason: `Tool not in allow list: ${toolName}` };
  }

  return { allowed: true };
}

/**
 * Compute integrity hash from profile id, role, and permissions.
 */
export function computeIntegrityHash(profile: AgentProfile): string {
  const payload = JSON.stringify({
    id: profile.id,
    role: profile.role,
    permissions: profile.permissions || null,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

/**
 * Verify profile integrity — stored hash vs computed.
 */
export function verifyIntegrity(profile: AgentProfile): { valid: boolean; reason?: string } {
  if (!profile.integrityHash) {
    return { valid: true, reason: 'No integrity hash stored (pre-4.0 profile)' };
  }

  const computed = computeIntegrityHash(profile);
  if (computed === profile.integrityHash) {
    return { valid: true };
  }

  return {
    valid: false,
    reason: 'Integrity hash mismatch — profile may have been tampered with',
  };
}

// ────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────

/**
 * Simple glob pattern matching (supports * wildcard).
 */
function matchGlob(pattern: string, value: string): boolean {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`).test(value);
}

function deepMergeProfiles(base: AgentProfile, override: Partial<AgentProfile>): AgentProfile {
  const merged = { ...base };

  if (override.role) merged.role = override.role;
  if (override.description) merged.description = override.description;
  if (override.version) merged.version = override.version;

  if (override.personality) {
    merged.personality = { ...base.personality, ...override.personality };
  }

  // Merge expertise: override entries win for same symbol
  if (override.expertise) {
    const expertiseMap = new Map(base.expertise.map(e => [e.symbol, e]));
    for (const entry of override.expertise) {
      expertiseMap.set(entry.symbol, entry);
    }
    merged.expertise = Array.from(expertiseMap.values());
  }

  // Merge transferable: override entries win for same id
  if (override.transferable) {
    const patternMap = new Map(base.transferable.map(p => [p.id, p]));
    for (const pattern of override.transferable) {
      patternMap.set(pattern.id, pattern);
    }
    merged.transferable = Array.from(patternMap.values());
  }

  // Merge contexts: deep merge per project
  if (override.contexts) {
    merged.contexts = { ...base.contexts };
    for (const [project, ctx] of Object.entries(override.contexts)) {
      merged.contexts[project] = { ...merged.contexts[project], ...ctx };
    }
  }

  return merged;
}

function detectProjectName(rootDir: string): string {
  // Try config.yaml first
  try {
    const configPath = path.join(rootDir, '.paradigm', 'config.yaml');
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const config = yaml.load(content) as Record<string, unknown>;
      if (config?.project && typeof config.project === 'string') return config.project;
    }
  } catch { /* fall through */ }

  // Fall back to directory name
  return path.basename(rootDir);
}
