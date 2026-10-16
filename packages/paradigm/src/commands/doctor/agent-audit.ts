/**
 * Agent audit (#agent-audit) — pure checks behind the doctor's
 * "Agent profile keys" and "Roster dispatchability" results.
 *
 * TD-2026-09-26-846: roster.yaml + .agent profiles are authoritative for
 * dispatch. A roster member with no profile (and no agents.yaml entry) cannot
 * be dispatched; the orchestrator reports it as `undispatchable`, and doctor
 * surfaces it ahead of time here.
 *
 * Self-contained: packages/paradigm does not import paradigm-mcp.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as yaml from 'js-yaml';

/**
 * Local copy of KNOWN_AGENT_KEYS from
 * packages/paradigm-mcp/src/types/agents.ts — keep the two in sync.
 */
export const KNOWN_AGENT_KEYS: readonly string[] = [
  'id', 'role', 'nickname', 'description', 'version', 'personality', 'expertise',
  'transferable', 'contexts', 'created', 'updated', 'permissions', 'integrityHash',
  'attention', 'learning', 'context', 'reporting', 'collaboration', 'nomination',
  'benched', 'network', 'scopes', 'configurable', 'partners', 'behaviors', 'tags', 'skills',
  // Framework-written metadata not modeled on AgentProfile (registry install
  // provenance + the `protected` flag on core templates).
  'scope', 'registry', 'distribution', 'installedAt', 'protected',
];

/** Keys that are declared but not yet read by any runtime consumer. */
const UNREAD_KEYS = ['behaviors'] as const;

export interface AgentAuditResult {
  unknownKeys: Array<{ file: string; keys: string[] }>;
  unreadKeys: Array<{ file: string; keys: ['behaviors'] }>;
  /** Active roster ids with no .agent in project/global and not in agents.yaml */
  rosterGaps: string[];
  /** Active roster ids whose resolved profile has `benched: true` */
  benchedOnRoster: string[];
  /**
   * `behaviors.<block>` entries still present in a profile whose content has
   * been migrated to a skill (a skill's provenance.migratedFrom is
   * `<file>.agent#behaviors.<block>`). Skills Phase 1.
   */
  migratedBehaviors: Array<{ file: string; block: string; skillId: string }>;
}

/**
 * migratedFrom → skill id, scanned from project `.paradigm/skills/<id>/SKILL.md`
 * and global skill sources. Parses frontmatter directly (no paradigm-mcp import).
 */
export function skillMigrations(rootDir: string, globalSkillsDir: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const dir of [path.join(rootDir, '.paradigm', 'skills'), globalSkillsDir]) {
    let entries: string[] = [];
    try {
      entries = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    } catch {
      continue;
    }
    for (const id of entries) {
      try {
        const file = path.join(dir, id, 'SKILL.md');
        if (!fs.existsSync(file)) continue;
        const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(file, 'utf8'));
        if (!m) continue;
        const fm = yaml.load(m[1]) as { metadata?: { paradigm?: { id?: string; provenance?: { migratedFrom?: string } } } } | null;
        const meta = fm?.metadata?.paradigm;
        const from = meta?.provenance?.migratedFrom;
        // Project scope is scanned first and wins.
        if (typeof from === 'string' && !map.has(from)) map.set(from, meta?.id ?? id);
      } catch {
        // unparseable skill — ignored here (skill lint reports it)
      }
    }
  }
  return map;
}

function readYaml(file: string): Record<string, unknown> | null {
  try {
    const data = yaml.load(fs.readFileSync(file, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function listAgentFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  try {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.agent'))
      .map(f => path.join(dir, f));
  } catch {
    return [];
  }
}

/**
 * Audit agent profiles + roster for a project.
 *
 * Profiles scanned for keys: every project `.paradigm/agents/*.agent`, plus the
 * global profiles relevant to this project (roster members, or all global
 * profiles when there is no roster).
 */
export function auditAgents(rootDir: string, opts: { globalDir?: string; globalSkillsDir?: string } = {}): AgentAuditResult {
  const globalDir = opts.globalDir ?? path.join(os.homedir(), '.paradigm', 'agents');
  const migrations = skillMigrations(rootDir, opts.globalSkillsDir ?? path.join(os.homedir(), '.paradigm', 'skills'));
  const migratedBehaviors: AgentAuditResult['migratedBehaviors'] = [];
  const projectDir = path.join(rootDir, '.paradigm', 'agents');

  const rosterData = readYaml(path.join(rootDir, '.paradigm', 'roster.yaml'));
  const roster = Array.isArray(rosterData?.active)
    ? (rosterData!.active as unknown[]).filter((x): x is string => typeof x === 'string')
    : null;

  const manifest = readYaml(path.join(rootDir, '.paradigm', 'agents.yaml'));
  const manifestAgents = manifest?.agents && typeof manifest.agents === 'object'
    ? Object.keys(manifest.agents as Record<string, unknown>)
    : [];

  const projectFiles = listAgentFiles(projectDir);
  const globalFiles = listAgentFiles(globalDir).filter(f => {
    if (!roster) return true;
    return roster.includes(path.basename(f, '.agent'));
  });

  const known = new Set(KNOWN_AGENT_KEYS);
  const unknownKeys: AgentAuditResult['unknownKeys'] = [];
  const unreadKeys: AgentAuditResult['unreadKeys'] = [];
  for (const file of [...projectFiles, ...globalFiles]) {
    const data = readYaml(file);
    if (!data) continue;
    const keys = Object.keys(data);
    const unknown = keys.filter(k => !known.has(k));
    if (unknown.length > 0) unknownKeys.push({ file, keys: unknown });
    if (UNREAD_KEYS.some(k => keys.includes(k))) unreadKeys.push({ file, keys: ['behaviors'] });
    const behaviors = data.behaviors;
    if (behaviors && typeof behaviors === 'object' && !Array.isArray(behaviors)) {
      for (const block of Object.keys(behaviors)) {
        const skillId = migrations.get(`${path.basename(file)}#behaviors.${block}`);
        if (skillId) migratedBehaviors.push({ file, block, skillId });
      }
    }
  }

  const rosterGaps: string[] = [];
  const benchedOnRoster: string[] = [];
  for (const id of roster ?? []) {
    // A file only counts if it parses AND declares the matching id — the
    // loader keys profiles by `id`, so a file with a missing/mismatched id
    // never resolves for this roster member.
    const projectParsed = readYaml(path.join(projectDir, `${id}.agent`));
    const globalParsed = readYaml(path.join(globalDir, `${id}.agent`));
    const projectData = projectParsed?.id === id ? projectParsed : null;
    const globalData = globalParsed?.id === id ? globalParsed : null;
    if (!projectData && !globalData) {
      if (!manifestAgents.includes(id)) rosterGaps.push(id);
      continue;
    }
    // Project overrides global (mirrors the loader's merge priority)
    const benched = projectData && 'benched' in projectData
      ? projectData.benched
      : globalData?.benched;
    if (benched === true) benchedOnRoster.push(id);
  }

  return { unknownKeys, unreadKeys, rosterGaps, benchedOnRoster, migratedBehaviors };
}
