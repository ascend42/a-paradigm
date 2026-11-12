/**
 * #always-on-budget — measures the text that loads into EVERY agent session.
 *
 * Paradigm generates instruction text (CLAUDE.md, AGENTS.md, alwaysApply
 * Cursor rules, projected skill descriptions, the Paradigm plugin's skill
 * descriptions) that a host loads before the first user turn. Nothing else
 * measures it. This module counts chars and an ESTIMATED token count
 * (chars / 4) per file, grouped by the surface that loads it:
 *
 *   claude-code — CLAUDE.md + every surfaced skill description (Claude Code
 *                 lists each skill's `description:` in every session)
 *   cursor      — .cursor/rules/*.mdc with `alwaysApply: true`
 *   agents-md   — AGENTS.md (Codex and other AGENTS.md readers)
 *
 * Only Paradigm-generated text counts toward the cap
 * (`context.always-on-max-chars` in .paradigm/config.yaml, default 12000 —
 * a starting estimate to calibrate). The user's ~/.claude/CLAUDE.md, the
 * project MEMORY.md, non-Paradigm skills and rules are a census only (never
 * warned on). MCP tool schemas also load every session but are not measured.
 *
 * Read-only; never throws.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { log } from '../utils/logger.js';
import { scanWarplineBlocks } from './warpline-detect.js';

/** Starting estimate; calibrate per project via context.always-on-max-chars. */
export const DEFAULT_ALWAYS_ON_MAX_CHARS = 12000;
export const ALWAYS_ON_CAP_KEY = 'context.always-on-max-chars';

export type AlwaysOnSurface = 'claude-code' | 'cursor' | 'agents-md';

export interface AlwaysOnEntry {
  /** Display label (repo-relative path, or a ~-relative path). */
  label: string;
  surface: AlwaysOnSurface;
  chars: number;
  /** chars / 4, rounded up. An estimate, not a tokenizer count. */
  estTokens: number;
  /** Counts toward the cap (Paradigm-generated). */
  paradigm: boolean;
  /** Number of skill descriptions summed into this entry, when it is a skill sum. */
  skillCount?: number;
}

export interface AlwaysOnSurfaceTotal {
  surface: AlwaysOnSurface;
  /** Paradigm-generated chars on this surface. */
  chars: number;
  estTokens: number;
  overCap: boolean;
}

export interface AlwaysOnBudget {
  cap: number;
  entries: AlwaysOnEntry[];
  surfaces: AlwaysOnSurfaceTotal[];
  /** Informational census, outside Paradigm's control. Never warned on. */
  census: AlwaysOnEntry[];
}

export interface AlwaysOnOptions {
  /** Home dir for ~/.claude lookups (tests inject a temp dir). */
  homeDir?: string;
}

export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

/** Read the cap from .paradigm/config.yaml `context.always-on-max-chars`; default otherwise. */
export function readAlwaysOnCap(rootDir: string): number {
  try {
    const raw = yaml.load(fs.readFileSync(path.join(rootDir, '.paradigm', 'config.yaml'), 'utf8')) as Record<string, unknown> | null;
    const ctx = raw && typeof raw.context === 'object' && raw.context ? (raw.context as Record<string, unknown>) : null;
    const v = ctx?.['always-on-max-chars'];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v;
  } catch {
    // missing or unparsable config: default
  }
  return DEFAULT_ALWAYS_ON_MAX_CHARS;
}

function readText(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

/** Parse the leading `---` YAML frontmatter block; null when absent or unparsable. */
export function parseFrontmatter(content: string): Record<string, unknown> | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!m) return null;
  try {
    const fm = yaml.load(m[1]);
    return fm && typeof fm === 'object' ? (fm as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function entry(label: string, surface: AlwaysOnSurface, chars: number, paradigm: boolean, skillCount?: number): AlwaysOnEntry {
  return { label, surface, chars, estTokens: estimateTokens(chars), paradigm, ...(skillCount !== undefined ? { skillCount } : {}) };
}

/** Sum the `description:` frontmatter of every <dir>/<name>/SKILL.md matching `filter`. */
function sumSkillDescriptions(dir: string, filter: (name: string) => boolean): { chars: number; count: number } {
  let chars = 0;
  let count = 0;
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return { chars, count };
  }
  for (const name of names.sort()) {
    if (!filter(name)) continue;
    const content = readText(path.join(dir, name, 'SKILL.md'));
    if (content === null) continue;
    const desc = parseFrontmatter(content)?.description;
    if (typeof desc !== 'string') continue;
    chars += desc.length;
    count++;
  }
  return { chars, count };
}

interface PluginInstall { scope?: string; projectPath?: string; installPath?: string }

/**
 * True when two resolved paths name the same directory. Windows paths are
 * case-insensitive (N3): Claude Code may record `c:\\repo` for `C:\\Repo`.
 */
export function samePath(a: string, b: string, platform: NodeJS.Platform = process.platform): boolean {
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  return platform === 'win32' ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

/**
 * The Paradigm Claude Code plugin's install dir for this project: a
 * project-scope install for rootDir wins over the user-scope one.
 */
export function paradigmPluginInstallPath(
  rootDir: string,
  homeDir: string,
  platform: NodeJS.Platform = process.platform,
): string | null {
  try {
    const file = path.join(homeDir, '.claude', 'plugins', 'installed_plugins.json');
    const plugins = (JSON.parse(fs.readFileSync(file, 'utf8')) as { plugins?: Record<string, PluginInstall[]> }).plugins ?? {};
    for (const [key, entries] of Object.entries(plugins)) {
      if (!key.startsWith('paradigm@') || !Array.isArray(entries)) continue;
      const project = entries.find((e) => e.scope === 'project' && e.projectPath && samePath(e.projectPath, rootDir, platform));
      const pick = project ?? entries.find((e) => e.scope === 'user');
      if (pick?.installPath) return pick.installPath;
    }
  } catch {
    // no install record
  }
  return null;
}

/** Claude Code's per-project dir slug: every non-alphanumeric char becomes '-'. */
function claudeProjectSlug(rootDir: string): string {
  return path.resolve(rootDir).replace(/[^a-zA-Z0-9]/g, '-');
}

function isPdg(name: string): boolean {
  return name.startsWith('pdg-');
}

/**
 * Chars of Warpline blocks in a file (T-2026-11-12-001). The block is
 * Warpline-owned text (`warpline init` writes the same bytes), so it goes to
 * the census instead of counting toward Paradigm's cap.
 */
function warplineChars(content: string): number {
  return scanWarplineBlocks(content).blocks.reduce((n, b) => n + (b.end - b.start), 0);
}

/** Measure every always-on file. Read-only, never throws. */
export function measureAlwaysOn(rootDir: string, options: AlwaysOnOptions = {}): AlwaysOnBudget {
  const homeDir = options.homeDir ?? os.homedir();
  const cap = readAlwaysOnCap(rootDir);
  const entries: AlwaysOnEntry[] = [];
  const census: AlwaysOnEntry[] = [];

  try {
    // Generated instruction files.
    // A Warpline block inside a Paradigm file is split out to the census.
    const pushParadigmFile = (label: string, surface: AlwaysOnSurface, content: string): void => {
      const wl = warplineChars(content);
      entries.push(entry(label, surface, content.length - wl, true));
      if (wl > 0) census.push(entry(`${label} Warpline block (Warpline-owned)`, surface, wl, false));
    };
    const claudeMd = readText(path.join(rootDir, 'CLAUDE.md'));
    if (claudeMd !== null) pushParadigmFile('CLAUDE.md', 'claude-code', claudeMd);
    const agentsMd = readText(path.join(rootDir, 'AGENTS.md'));
    if (agentsMd !== null) pushParadigmFile('AGENTS.md', 'agents-md', agentsMd);

    // Cursor rules with alwaysApply: true. paradigm-*.mdc are Paradigm's; others are the project's.
    const rulesDir = path.join(rootDir, '.cursor', 'rules');
    let rules: string[] = [];
    try {
      rules = fs.readdirSync(rulesDir).filter((n) => n.endsWith('.mdc')).sort();
    } catch {
      // no cursor rules
    }
    for (const name of rules) {
      const content = readText(path.join(rulesDir, name));
      if (content === null || parseFrontmatter(content)?.alwaysApply !== true) continue;
      // paradigm-warpline.mdc carries Warpline's block for Cursor: Warpline-owned text,
      // counted in the census exactly like the CLAUDE.md / AGENTS.md blocks, never against the cap.
      if (name === 'paradigm-warpline.mdc') census.push(entry(`.cursor/rules/${name} (Warpline-owned)`, 'cursor', content.length, false));
      else if (name.startsWith('paradigm-')) pushParadigmFile(`.cursor/rules/${name}`, 'cursor', content);
      else census.push(entry(`.cursor/rules/${name}`, 'cursor', content.length, false));
    }

    // Skill descriptions Claude Code surfaces every session.
    const projectSkills = path.join(rootDir, '.claude', 'skills');
    const userSkills = path.join(homeDir, '.claude', 'skills');
    const pushSkills = (label: string, dir: string, filter: (n: string) => boolean, paradigm: boolean): void => {
      const s = sumSkillDescriptions(dir, filter);
      if (s.count === 0) return;
      (paradigm ? entries : census).push(entry(label, 'claude-code', s.chars, paradigm, s.count));
    };
    pushSkills('.claude/skills/pdg-* descriptions', projectSkills, isPdg, true);
    pushSkills('~/.claude/skills/pdg-* descriptions', userSkills, isPdg, true);
    const plugin = paradigmPluginInstallPath(rootDir, homeDir);
    if (plugin) pushSkills('paradigm plugin skill descriptions', path.join(plugin, 'skills'), () => true, true);
    pushSkills('.claude/skills (project, non-Paradigm) descriptions', projectSkills, (n) => !isPdg(n), false);
    pushSkills('~/.claude/skills (user, non-Paradigm) descriptions', userSkills, (n) => !isPdg(n) && n !== 'synced', false);

    // User-owned always-on text: census only.
    const globalMd = readText(path.join(homeDir, '.claude', 'CLAUDE.md'));
    if (globalMd !== null) census.push(entry('~/.claude/CLAUDE.md', 'claude-code', globalMd.length, false));
    const memory = readText(path.join(homeDir, '.claude', 'projects', claudeProjectSlug(rootDir), 'memory', 'MEMORY.md'));
    if (memory !== null) census.push(entry('MEMORY.md (auto-memory)', 'claude-code', memory.length, false));
  } catch (err) {
    log.component('#always-on-budget').warn('Always-on measurement incomplete', { error: (err as Error).message });
  }

  const surfaces: AlwaysOnSurfaceTotal[] = (['claude-code', 'cursor', 'agents-md'] as AlwaysOnSurface[])
    .map((surface) => {
      const chars = entries.filter((e) => e.surface === surface).reduce((n, e) => n + e.chars, 0);
      return { surface, chars, estTokens: estimateTokens(chars), overCap: chars > cap };
    })
    .filter((s) => s.chars > 0);

  return { cap, entries, surfaces, census };
}

/** Which surface a `paradigm sync` adapter regenerates (null: not measured). */
export function surfaceForAdapter(adapterName: string): AlwaysOnSurface | null {
  switch (adapterName) {
    case 'claude': return 'claude-code';
    case 'cursor': return 'cursor';
    case 'agents': return 'agents-md';
    default: return null;
  }
}

/** One-line over-cap warning for a surface, or null when under the cap. */
export function overCapLine(budget: AlwaysOnBudget, surface: AlwaysOnSurface): string | null {
  const s = budget.surfaces.find((x) => x.surface === surface);
  if (!s || !s.overCap) return null;
  return `Always-on ${surface} text is ${s.chars.toLocaleString('en-US')} chars (~${s.estTokens.toLocaleString('en-US')} tokens est.), over the ${budget.cap.toLocaleString('en-US')} cap (${ALWAYS_ON_CAP_KEY}); see \`paradigm doctor\` always-on-budget`;
}
