/**
 * !skill-used — append-only skill usage ledger (Skills Phase 1).
 *
 *   <root>/.paradigm/events/skill-usage.jsonl   (pruned to the last 500 rows)
 *
 * Modelled on appendFieldFailure (field-failures.ts). Rows carry
 * `entryId: skill:<id>@<version>` — the SAME key as the scenario probe
 * learning_ref and the classroom cert row (Loid join invariant).
 *
 * Exported API:
 *   appendSkillUsage(rootDir, row)                      → void (non-throwing)
 *   readSkillUsage(rootDir)                             → SkillUsageRow[]
 *   skillIdFromProjectedName(name)                      → string | null   ("pdg-x" → "x")
 *   buildSkillUsageRow(skillName, opts)                 → SkillUsageRow | null
 *     (for the PostToolUse `Skill` hook: KEBAB-validates the id, reads skillId +
 *      version from the projection sidecar in <projectDir>/.claude/skills or
 *      <homedir>/.claude/skills — the MARKER's skillId is authoritative)
 *   resolveHookProjectDir({ env?, payloadCwd? })       → string | undefined
 *     (prefer $CLAUDE_PROJECT_DIR over the hook payload's cwd)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { log } from './mcp-logger.js';
import { MARKER_FILE, PROJECTED_PREFIX, skillKey, isValidSkillId, isSemver } from './skill-loader.js';
import type { SkillUsageRow, ProjectionMarker } from '../types/skills.js';

const EVENTS_DIR = '.paradigm/events';
export const SKILL_USAGE_FILE = 'skill-usage.jsonl';
const MAX_ENTRIES = 500;

export function appendSkillUsage(rootDir: string, row: SkillUsageRow): void {
  try {
    const dir = path.join(rootDir, EVENTS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, SKILL_USAGE_FILE);
    const full: SkillUsageRow = { ...row, entryId: row.entryId ?? skillKey(row.skillId, row.version) };
    fs.appendFileSync(filePath, JSON.stringify(full) + '\n', 'utf8');
    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(l => l.trim());
    if (lines.length > MAX_ENTRIES) {
      fs.writeFileSync(filePath, lines.slice(-MAX_ENTRIES).join('\n') + '\n', 'utf8');
    }
    log.signal('!skill-used').info('Skill used', { skillId: row.skillId, version: row.version, host: row.host });
  } catch (err) {
    log.component('#skill-loader').warn('failed to record skill usage', {
      skillId: row.skillId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function readSkillUsage(rootDir: string): SkillUsageRow[] {
  const filePath = path.join(rootDir, EVENTS_DIR, SKILL_USAGE_FILE);
  try {
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, 'utf8').trim().split('\n').filter(l => l.trim())
      .map(l => { try { return JSON.parse(l) as SkillUsageRow; } catch { return null; } })
      .filter((r): r is SkillUsageRow => r !== null);
  } catch {
    return [];
  }
}

/** "pdg-<id>" (optionally plugin-qualified "x:pdg-<id>") → "<id>"; anything else → null. */
export function skillIdFromProjectedName(name: string): string | null {
  const bare = name.includes(':') ? name.slice(name.lastIndexOf(':') + 1) : name;
  return bare.startsWith(PROJECTED_PREFIX) && bare.length > PROJECTED_PREFIX.length
    ? bare.slice(PROJECTED_PREFIX.length)
    : null;
}

/** Project dir for a hook: $CLAUDE_PROJECT_DIR wins over the (payload-supplied, less trusted) cwd. */
export function resolveHookProjectDir(opts: { env?: NodeJS.ProcessEnv; payloadCwd?: string } = {}): string | undefined {
  const env = opts.env ?? process.env;
  const fromEnv = env.CLAUDE_PROJECT_DIR;
  if (fromEnv && fromEnv.trim()) return fromEnv;
  return opts.payloadCwd && opts.payloadCwd.trim() ? opts.payloadCwd : undefined;
}

/** Build a usage row for a host Skill invocation, or null if it isn't a (valid) Paradigm projection. */
export function buildSkillUsageRow(
  skillName: string,
  opts: {
    /** Project root. Hooks should pass resolveHookProjectDir(...) (CLAUDE_PROJECT_DIR first). */
    rootDir: string;
    homedir?: string;
    host?: string;
    agent?: string;
    orchestrationId?: string;
    now?: Date;
  },
): SkillUsageRow | null {
  const id = skillIdFromProjectedName(skillName);
  if (!id || !isValidSkillId(id)) return null;
  const home = opts.homedir ?? os.homedir();
  let marker: ProjectionMarker | null = null;
  for (const base of [opts.rootDir, home]) {
    const p = path.join(base, '.claude', 'skills', `${PROJECTED_PREFIX}${id}`, MARKER_FILE);
    try {
      if (!fs.existsSync(p)) continue;
      const m = JSON.parse(fs.readFileSync(p, 'utf8')) as ProjectionMarker;
      if (m && m.skillId === id && isValidSkillId(m.skillId) && isSemver(m.version)) { marker = m; break; }
    } catch { /* try next */ }
  }
  if (!marker) return null;
  const row: SkillUsageRow = {
    ts: (opts.now ?? new Date()).toISOString(),
    skillId: marker.skillId,
    version: marker.version,
    host: opts.host ?? 'claude-code',
    entryId: skillKey(marker.skillId, marker.version),
  };
  if (opts.agent) row.agent = opts.agent;
  if (opts.orchestrationId) row.orchestrationId = opts.orchestrationId;
  return row;
}
