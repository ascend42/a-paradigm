/**
 * Agent Registry — resolves the dispatchable agent set (#agent-registry).
 *
 * TD-2026-09-26-846: roster.yaml + loaded .agent profiles are AUTHORITATIVE for
 * which agents can be dispatched. `.paradigm/agents.yaml` is demoted to an
 * optional overlay (back-compat read + one-time deprecation warning). Agents
 * that cannot be dispatched are REPORTED via `undispatchable`, never silently
 * dropped.
 *
 * The orchestration config block (default_mode, budget) is still read from
 * agents.yaml. This module never deletes or rewrites agents.yaml.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { log } from './mcp-logger.js';
import { loadAllAgentProfiles, loadProjectRoster } from './agent-loader.js';
import { ROLE_PROMPTS } from './role-prompts.js';
import type { AgentProfile } from '../types/agents.js';
import type {
  AgentDefinition,
  AgentManifest,
  UndispatchableAgent,
} from '../tools/orchestration.js';

export const AGENTS_YAML_DEPRECATION =
  'agents.yaml is deprecated; roster.yaml + .agent profiles are authoritative (TD-2026-09-26-846)';

export interface ResolvedAgents {
  agents: Record<string, AgentDefinition>;
  undispatchable: UndispatchableAgent[];
  manifestUsed: boolean;
  deprecation?: string;
  orchestration?: AgentManifest['orchestration'];
  /** The parsed agents.yaml (null when absent) — reuse instead of re-reading */
  manifest: AgentManifest | null;
}

export interface ResolveOptions {
  /** Test injection — defaults to loadAllAgentProfiles(rootDir) */
  profiles?: AgentProfile[];
  /** Test injection — defaults to reading .paradigm/agents.yaml (null = absent) */
  manifest?: AgentManifest | null;
  /** Test injection — defaults to loadProjectRoster(rootDir) (null = no roster) */
  roster?: string[] | null;
}

let deprecationLogged = false;

function readManifest(rootDir: string): AgentManifest | null {
  const manifestPath = path.join(rootDir, '.paradigm', 'agents.yaml');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return (yaml.load(fs.readFileSync(manifestPath, 'utf-8')) as AgentManifest) ?? null;
  } catch {
    return null;
  }
}

/**
 * String-only view of a profile list field. Hand-edited / legacy profiles can
 * carry null or non-string entries (e.g. a bare `- ` YAML item); those would
 * crash downstream consumers like suggestAgentsForTask's keyword matcher.
 */
function strings(arr: unknown): string[] {
  return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string' && x.length > 0) : [];
}

function buildDefinition(
  id: string,
  manifestDef: AgentDefinition | undefined,
  profile: AgentProfile | undefined,
): AgentDefinition {
  const role = manifestDef?.role || ROLE_PROMPTS[id] || profile?.role || `${id} agent`;

  const attentionPaths = strings(profile?.attention?.paths);
  const focus = manifestDef?.focus || {
    reads: attentionPaths.length > 0 ? attentionPaths : ['**/*'],
    writes: ['**/*'],
  };

  let triggers = manifestDef?.triggers;
  if (!triggers) {
    const derived: NonNullable<AgentDefinition['triggers']> = [];
    const concepts = strings(profile?.attention?.concepts);
    const symbols = strings(profile?.attention?.symbols);
    if (concepts.length > 0) derived.push({ type: 'keyword', match: concepts, derived: true });
    if (symbols.length > 0) derived.push({ type: 'symbol', match: symbols, derived: true });
    if (derived.length > 0) triggers = derived;
  }

  let handoffTo = manifestDef?.handoff_to;
  if (!handoffTo) {
    const partnerIds = strings((profile?.partners ?? []).map(p => p?.id));
    if (partnerIds.length > 0) {
      handoffTo = partnerIds;
    } else {
      const collabWith = Object.keys(profile?.collaboration?.with ?? {});
      if (collabWith.length > 0) handoffTo = collabWith;
    }
  }

  const def: AgentDefinition = {
    name: id,
    role,
    focus,
  };
  const description = profile?.description || manifestDef?.description;
  if (description) def.description = description;
  if (triggers) def.triggers = triggers;
  if (handoffTo) def.handoff_to = handoffTo;
  if (manifestDef?.defaultModel) def.defaultModel = manifestDef.defaultModel;
  if (manifestDef?.context) def.context = manifestDef.context;
  if (manifestDef?.protocol) def.protocol = manifestDef.protocol;
  return def;
}

/**
 * Resolve the dispatchable agent set for a project.
 *
 * Candidates: roster ids when roster.yaml exists, else the union of loaded
 * profile ids and agents.yaml ids. Each candidate is either turned into an
 * AgentDefinition (agents.yaml fields override profile-derived ones) or
 * reported as undispatchable ('benched' | 'no-profile').
 */
export function resolveDispatchableAgents(rootDir: string, opts: ResolveOptions = {}): ResolvedAgents {
  const profiles = opts.profiles ?? loadAllAgentProfiles(rootDir);
  const manifest = opts.manifest !== undefined ? opts.manifest : readManifest(rootDir);
  const roster = opts.roster !== undefined ? opts.roster : loadProjectRoster(rootDir);

  const profileById = new Map<string, AgentProfile>();
  for (const p of profiles) {
    if (p?.id) profileById.set(p.id, p);
  }
  const manifestAgents: Record<string, AgentDefinition> = manifest?.agents ?? {};

  const candidates: string[] = roster
    ? [...new Set(roster)]
    : [...new Set([...profileById.keys(), ...Object.keys(manifestAgents)])];

  const agents: Record<string, AgentDefinition> = {};
  const undispatchable: UndispatchableAgent[] = [];

  for (const id of candidates) {
    const profile = profileById.get(id);
    const manifestDef = manifestAgents[id];
    if (profile?.benched) {
      undispatchable.push({ name: id, reason: 'benched' });
      continue;
    }
    if (!profile && !manifestDef) {
      undispatchable.push({ name: id, reason: 'no-profile' });
      continue;
    }
    agents[id] = buildDefinition(id, manifestDef, profile);
  }

  const manifestUsed = manifest != null;
  const result: ResolvedAgents = { agents, undispatchable, manifestUsed, manifest: manifest ?? null };
  if (manifestUsed) {
    result.deprecation = AGENTS_YAML_DEPRECATION;
    if (!deprecationLogged) {
      deprecationLogged = true;
      log.component('#agent-registry').warn(AGENTS_YAML_DEPRECATION, { rootDir });
    }
    if (manifest?.orchestration) result.orchestration = manifest.orchestration;
  }
  return result;
}

/** Format an undispatchable list as a one-line note. */
export function formatUndispatchableNote(list: UndispatchableAgent[]): string {
  return `${list.length} agent(s) could not be dispatched: ${list.map(u => `${u.name} (${u.reason})`).join(', ')}`;
}
