/**
 * #skill-loader — the ONE loader/validator for Paradigm skill sources
 * (Skills Phase 1, T-2026-09-26-002). The CLI (`paradigm skill …`, #skill-cli)
 * imports this module by relative path; it must stay free of MCP-server state.
 *
 * Sources: `<root>/.paradigm/skills/<id>/SKILL.md` (project) overrides
 * `<globalDir>/<id>/SKILL.md` (global, default `~/.paradigm/skills`).
 *
 * Exported API (all sync, all accept an injectable `SkillEnv` — tests never
 * touch the real home directory):
 *
 *   parseSkill(content, dir, scope)          → SkillFile          (throws SkillParseError)
 *   serializeSkill(skill)                    → string             (canonical SKILL.md)
 *   loadSkillFromDir(dir, scope)             → SkillFile          (throws SkillParseError)
 *   writeSkill(skill)                        → string             (path of SKILL.md written)
 *   resolveSkill(id, env)                    → SkillFile | null   (project › global)
 *   listSkills(env)                          → SkillFile[]        (merged, project wins)
 *   listSkillsDetailed(env)                  → { skills, invalid }
 *   lintSkill(skill, env, opts?)             → LintIssue[]
 *   computeContentHash(skill)                → "sha256:<hex>"     (excludes `certification`)
 *   hashToolSchema(inputSchema)              → "sha256:<hex>"
 *   parseToolsDump(json)                     → ToolLike[]         (tools/list dump → list)
 *   checkPins(skill, { paradigmTools?, externalTools? }) → PinReport
 *   computeStatus(skill, { lint?, pins?, ledger? }) → SkillStatus  (ledger REQUIRED for 'ok')
 *   loadSkillCertLedger(env)                 → ClassroomCertRow[] (project ledger + global skill ledger)
 *   appendGlobalSkillCertRow(env, row)       → void   (certify MUST call this AND appendClassroomCertification)
 *   listSkillScripts(skill)                  → { path, sha256, bytes }[]  (show at certify time)
 *   isValidSkillId(id) / assertSkillId(id)   → KEBAB guard (path-traversal defence)
 *   resolveAgentSkills(profile, env)         → SkillSummary[]   (cached structural lint; pins/notebooks NOT checked)
 *   skillKey(id, version)                    → "skill:<id>@<version>"  (Loid join key)
 *   projectedSkillDir(id, target, env)       → absolute dest dir
 *   evaluateCertification(skill, scenarios, opts) → CertificationEvaluation (pure)
 *   applyCertification(skill, cert)          → SkillFile          (trust certified + block)
 *   buildSkillCertRow(skill, cert)           → ClassroomCertRow   (kind 'skill')
 *
 * SECURITY POSTURE: certification is drift-detection (not tamper-proof) — a
 * valid certification needs BOTH the SKILL.md block AND a matching kind:'skill'
 * ledger row (same entryId + contentHash). Anyone with write access to both can
 * forge; signing = follow-up.
 *
 * `paradigmTools` for checkPins comes from `listToolDefinitions()`
 * (src/tools/index.ts) — injected, not imported, to keep this module light.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import * as yaml from 'js-yaml';
import { log } from './mcp-logger.js';
import type {
  SkillFile,
  SkillScope,
  SkillStatus,
  SkillSummary,
  SkillCertification,
  ParadigmSkillMeta,
  SkillFrontmatter,
} from '../types/skills.js';
import type { AgentProfile } from '../types/agents.js';
import type { Scenario } from './scenario-loader.js';
import { readClassroomCertifications, type ClassroomCertRow } from './field-failures.js';

// ────────────────────────────────────────────────────────
// Constants / env
// ────────────────────────────────────────────────────────

export const SKILL_FILE = 'SKILL.md';
export const PROJECT_SKILLS_DIR = '.paradigm/skills';
export const PROJECTED_PREFIX = 'pdg-';
export const MARKER_FILE = '.pdg-generated.json';
export const VERSIONS_DIR = '.versions';
/** Sub-dirs whose files are part of the content hash and the projected tree. */
export const SKILL_RESOURCE_DIRS = ['references', 'assets', 'scripts'] as const;
export const OWNED_SKILL_CAP = 5;

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const TRUSTS = ['certified', 'provisional', 'external'];
const SOURCES = ['bundled', 'authored', 'adopted', 'registry'];

export interface SkillEnv {
  rootDir: string;
  /** Defaults to os.homedir(). Inject in tests. */
  homedir?: string;
  /** Global skill sources. Defaults to `<homedir>/.paradigm/skills`. */
  globalDir?: string;
}

export function envHome(env: SkillEnv): string {
  return env.homedir ?? os.homedir();
}

export function envGlobalDir(env: SkillEnv): string {
  return env.globalDir ?? path.join(envHome(env), '.paradigm', 'skills');
}

export class SkillIdError extends Error {
  constructor(id: string) {
    super(`invalid skill id "${id}" — must be kebab-case ([a-z0-9-])`);
    this.name = 'SkillIdError';
  }
}

/** KEBAB guard — the path-traversal defence for every id that becomes a path segment. */
export function isValidSkillId(id: unknown): id is string {
  return typeof id === 'string' && KEBAB.test(id);
}

export function assertSkillId(id: unknown): asserts id is string {
  if (!isValidSkillId(id)) throw new SkillIdError(String(id));
}

export function isSemver(v: unknown): v is string {
  return typeof v === 'string' && SEMVER.test(v);
}

/** `~/.claude/skills` (target user) or `<root>/.claude/skills` (target project). */
export function projectedSkillsRoot(target: 'user' | 'project', env: SkillEnv): string {
  const base = target === 'project' ? env.rootDir : envHome(env);
  return path.join(base, '.claude', 'skills');
}

export function skillKey(id: string, version: string): string {
  return `skill:${id}@${version}`;
}

/** Destination dir of a projection: `~/.claude/skills/pdg-<id>` or `<root>/.claude/skills/pdg-<id>`. */
export function projectedSkillDir(id: string, target: 'user' | 'project', env: SkillEnv): string {
  assertSkillId(id);
  const root = projectedSkillsRoot(target, env);
  const dest = path.join(root, `${PROJECTED_PREFIX}${id}`);
  if (path.dirname(dest) !== root) throw new SkillIdError(id);
  return dest;
}

// ────────────────────────────────────────────────────────
// Parse / serialize
// ────────────────────────────────────────────────────────

export class SkillParseError extends Error {
  constructor(message: string, public readonly dir: string) {
    super(message);
    this.name = 'SkillParseError';
  }
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;

/** Split a markdown file into raw frontmatter object + body. Throws on missing frontmatter. */
export function splitFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) throw new Error('missing YAML frontmatter (--- … ---)');
  const data = yaml.load(m[1]);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('frontmatter is not a YAML mapping');
  }
  return { data: data as Record<string, unknown>, body: m[2] };
}

function validateFrontmatter(data: Record<string, unknown>): string[] {
  const errs: string[] = [];
  if (typeof data.name !== 'string' || !data.name) errs.push('name is required');
  if (typeof data.description !== 'string' || !data.description) errs.push('description is required');
  if (data['allowed-tools'] !== undefined && typeof data['allowed-tools'] !== 'string') {
    errs.push('allowed-tools must be a string');
  }
  const md = data.metadata as Record<string, unknown> | undefined;
  const meta = md?.paradigm as Record<string, unknown> | undefined;
  if (!meta || typeof meta !== 'object') {
    errs.push('metadata.paradigm is required');
    return errs;
  }
  for (const k of ['id', 'version', 'steward']) {
    if (typeof meta[k] !== 'string' || !meta[k]) errs.push(`metadata.paradigm.${k} is required`);
  }
  if (!TRUSTS.includes(meta.trust as string)) errs.push(`metadata.paradigm.trust must be one of ${TRUSTS.join('|')}`);
  const prov = meta.provenance as Record<string, unknown> | undefined;
  if (!prov || typeof prov !== 'object') {
    errs.push('metadata.paradigm.provenance is required');
  } else {
    if (!SOURCES.includes(prov.source as string)) errs.push(`provenance.source must be one of ${SOURCES.join('|')}`);
    if (typeof prov.createdBy !== 'string' || !prov.createdBy) errs.push('provenance.createdBy is required');
  }
  if (meta.tools !== undefined) {
    if (!meta.tools || typeof meta.tools !== 'object' || Array.isArray(meta.tools)) {
      errs.push('metadata.paradigm.tools must be a map');
    } else {
      for (const [k, v] of Object.entries(meta.tools)) {
        if (typeof v !== 'string') errs.push(`tools.${k} pin must be a string`);
      }
    }
  }
  return errs;
}

/** Parse SKILL.md content. Throws SkillParseError on structural problems. */
export function parseSkill(content: string, dir: string, scope: SkillScope): SkillFile {
  let split: { data: Record<string, unknown>; body: string };
  try {
    split = splitFrontmatter(content);
  } catch (err) {
    throw new SkillParseError(err instanceof Error ? err.message : String(err), dir);
  }
  const errs = validateFrontmatter(split.data);
  if (errs.length > 0) throw new SkillParseError(errs.join('; '), dir);
  const fm = split.data as unknown as SkillFrontmatter;
  const skill: SkillFile = {
    name: fm.name,
    description: fm.description,
    metadata: { paradigm: fm.metadata.paradigm },
    body: split.body,
    dir: path.resolve(dir),
    scope,
  };
  if (fm['allowed-tools'] !== undefined) skill['allowed-tools'] = fm['allowed-tools'];
  return skill;
}

/** The frontmatter object of a skill (no body/dir/scope), undefined fields dropped. */
export function skillFrontmatter(skill: SkillFile): SkillFrontmatter {
  const fm: SkillFrontmatter = {
    name: skill.name,
    description: skill.description,
    metadata: { paradigm: skill.metadata.paradigm },
  };
  if (skill['allowed-tools'] !== undefined) fm['allowed-tools'] = skill['allowed-tools'];
  return fm;
}

/** Canonical SKILL.md text. parseSkill(serializeSkill(s)) round-trips. */
export function serializeSkill(skill: SkillFile): string {
  const dumped = yaml.dump(JSON.parse(JSON.stringify(skillFrontmatter(skill))), {
    lineWidth: -1,
    noRefs: true,
    sortKeys: false,
  });
  return `---\n${dumped}---\n${skill.body}`;
}

export function loadSkillFromDir(dir: string, scope: SkillScope): SkillFile {
  const file = path.join(dir, SKILL_FILE);
  if (!fs.existsSync(file)) throw new SkillParseError(`${SKILL_FILE} not found`, dir);
  return parseSkill(fs.readFileSync(file, 'utf8'), dir, scope);
}

/** Write the skill's SKILL.md into `skill.dir`. Returns the file path. */
export function writeSkill(skill: SkillFile): string {
  fs.mkdirSync(skill.dir, { recursive: true });
  const file = path.join(skill.dir, SKILL_FILE);
  fs.writeFileSync(file, serializeSkill(skill), 'utf8');
  return file;
}

// ────────────────────────────────────────────────────────
// Resolve / list
// ────────────────────────────────────────────────────────

function scopeDirs(env: SkillEnv): Array<{ dir: string; scope: SkillScope }> {
  return [
    { dir: path.join(env.rootDir, PROJECT_SKILLS_DIR), scope: 'project' },
    { dir: envGlobalDir(env), scope: 'global' },
  ];
}

/** Resolve a skill source: project `.paradigm/skills/<id>` › global. Invalid sources are skipped (logged). */
export function resolveSkill(id: string, env: SkillEnv): SkillFile | null {
  if (!isValidSkillId(id)) {
    log.component('#skill-loader').warn('Rejected invalid skill id', { id: String(id) });
    return null;
  }
  for (const { dir, scope } of scopeDirs(env)) {
    const skillDir = path.join(dir, id);
    if (!fs.existsSync(path.join(skillDir, SKILL_FILE))) continue;
    try {
      return loadSkillFromDir(skillDir, scope);
    } catch (err) {
      log.component('#skill-loader').warn('Skill source failed to parse', {
        id, scope, error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return null;
}

export interface InvalidSkillSource {
  id: string;
  dir: string;
  scope: SkillScope;
  error: string;
}

/** Every skill across scopes (project overrides global by dir name) + the sources that failed to parse. */
export function listSkillsDetailed(env: SkillEnv): { skills: SkillFile[]; invalid: InvalidSkillSource[] } {
  const byId = new Map<string, SkillFile>();
  const invalid = new Map<string, InvalidSkillSource>();
  // Global first, project second so project wins.
  for (const { dir, scope } of scopeDirs(env).reverse()) {
    if (!fs.existsSync(dir)) continue;
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir).filter(n => !n.startsWith('.')).sort();
    } catch { continue; }
    for (const name of names) {
      const skillDir = path.join(dir, name);
      if (!fs.existsSync(path.join(skillDir, SKILL_FILE))) continue;
      try {
        byId.set(name, loadSkillFromDir(skillDir, scope));
        invalid.delete(name);
      } catch (err) {
        byId.delete(name);
        invalid.set(name, { id: name, dir: skillDir, scope, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  return {
    skills: [...byId.values()].sort((a, b) => a.metadata.paradigm.id.localeCompare(b.metadata.paradigm.id)),
    invalid: [...invalid.values()],
  };
}

export function listSkills(env: SkillEnv): SkillFile[] {
  return listSkillsDetailed(env).skills;
}

// ────────────────────────────────────────────────────────
// Hashing
// ────────────────────────────────────────────────────────

/** Deterministic JSON: object keys sorted, undefined dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(v => canonicalJson(v === undefined ? null : v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort();
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}

/** Relative (posix) paths of every file under `dir`, sorted. Skips names in `skip` at any depth. */
export function listFilesRecursive(dir: string, skip: string[] = [], opts: { skipDot?: boolean } = {}): string[] {
  const out: string[] = [];
  const walk = (abs: string, rel: string) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (skip.includes(e.name)) continue;
      if (opts.skipDot && e.name.startsWith('.')) continue;
      // Symlinks are neither followed nor listed (see symlinksUnder).
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(abs, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  };
  if (fs.existsSync(dir)) walk(dir, '');
  return out.sort();
}

/**
 * Files that belong to a skill beyond SKILL.md: everything under references/
 * assets/ scripts/ (dotfiles and symlinks excluded). `withholdScripts` drops scripts/.
 */
export function skillResourceFiles(dir: string, opts: { withholdScripts?: boolean } = {}): string[] {
  const out: string[] = [];
  for (const sub of SKILL_RESOURCE_DIRS) {
    if (opts.withholdScripts && sub === 'scripts') continue;
    const subDir = path.join(dir, sub);
    if (isSymlink(subDir)) continue;
    for (const rel of listFilesRecursive(subDir, [], { skipDot: true })) out.push(`${sub}/${rel}`);
  }
  return out.sort();
}

function isSymlink(p: string): boolean {
  try { return fs.lstatSync(p).isSymbolicLink(); } catch { return false; }
}

/** Relative paths of every symlink under `dir` (lstat scan, not followed), incl. `dir` itself as ''. */
export function symlinksUnder(dir: string): string[] {
  const out: string[] = [];
  if (isSymlink(dir)) return [''];
  const walk = (abs: string, rel: string) => {
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) out.push(r);
      else if (e.isDirectory()) walk(path.join(abs, e.name), r);
    }
  };
  if (fs.existsSync(dir)) walk(dir, '');
  return out.sort();
}

/** scripts/ files with hashes — what a certifier is signing off on executing. */
export function listSkillScripts(skill: SkillFile): Array<{ path: string; sha256: string; bytes: number }> {
  return skillResourceFiles(skill.dir)
    .filter(rel => rel.startsWith('scripts/'))
    .map(rel => {
      const buf = fs.readFileSync(path.join(skill.dir, rel));
      return { path: rel, sha256: crypto.createHash('sha256').update(buf).digest('hex'), bytes: buf.length };
    });
}

/**
 * sha256 over canonical frontmatter MINUS `certification` + body + every file
 * under references/ assets/ scripts/ (sorted paths). Returns `sha256:<hex>`.
 */
export function computeContentHash(skill: SkillFile): string {
  const { certification: _omit, ...meta } = skill.metadata.paradigm;
  const fm = { ...skillFrontmatter(skill), metadata: { paradigm: meta } };
  const h = crypto.createHash('sha256');
  h.update('frontmatter\0');
  h.update(canonicalJson(fm));
  h.update('\0body\0');
  h.update(skill.body);
  for (const rel of skillResourceFiles(skill.dir)) {
    h.update(`\0file\0${rel}\0`);
    h.update(fs.readFileSync(path.join(skill.dir, rel)));
  }
  return `sha256:${h.digest('hex')}`;
}

export function hashToolSchema(inputSchema: unknown): string {
  return `sha256:${crypto.createHash('sha256').update(canonicalJson(inputSchema ?? {})).digest('hex')}`;
}

// ────────────────────────────────────────────────────────
// Lint
// ────────────────────────────────────────────────────────

export interface LintIssue {
  level: 'error' | 'warn';
  code:
    | 'SKILL_IS_PROTOCOL'
    | 'SKILL_IS_NOTEBOOK'
    | 'OWNED_SKILL_CAP'
    | 'NOTEBOOK_MISSING'
    | 'NOTEBOOK_REF_MALFORMED'
    | 'PROTOCOL_MISSING'
    | 'STEWARD_UNRESOLVED'
    | 'NAME_NOT_KEBAB'
    | 'ID_NOT_KEBAB'
    | 'VERSION_NOT_SEMVER'
    | 'DIR_ID_MISMATCH'
    | 'RESOURCE_SYMLINK';
  message: string;
  /** 1-based body line, when applicable. */
  line?: number;
}

export interface LintOptions {
  /** All skills for the OWNED_SKILL_CAP count. Defaults to listSkills(env) (+ this skill). */
  allSkills?: SkillFile[];
  /** Agent ids treated as resolvable stewards in addition to .agent files on disk. */
  knownAgents?: string[];
  /**
   * Cheap structural lint only: skip notebook/protocol/steward resolution and
   * the OWNED_SKILL_CAP scan (used by enrichment, which runs per dispatch).
   */
  structuralOnly?: boolean;
}

export function hasLintErrors(issues: LintIssue[]): boolean {
  return issues.some(i => i.level === 'error');
}

const STEP_LINE = /^\s*(\d+[.)]|[-*+])\s+/;
const OWN_RESOURCE = /^(\.\/)?(references|scripts|assets)\//;
const REPO_DIR_TOKEN = /^(packages|src|apps|lib)\/\S+/;
const SOURCE_FILE_TOKEN = /\S+\/\S+\.(ts|tsx|js|swift|py|yaml)$/;

/** Repo-path tokens on a step line (the SKILL_IS_PROTOCOL detector). Exported for tests/CLI. */
export function repoPathTokens(line: string): string[] {
  if (!STEP_LINE.test(line)) return [];
  const hits: string[] = [];
  for (const raw of line.split(/\s+/)) {
    const tok = raw.replace(/^[`'"([<*_]+|[`'")\]>*_,;:.!?]+$/g, '');
    if (!tok || tok.includes('://') || OWN_RESOURCE.test(tok)) continue;
    if (REPO_DIR_TOKEN.test(tok) || SOURCE_FILE_TOKEN.test(tok)) hits.push(tok);
  }
  return hits;
}

function notebookExists(agent: string, nbId: string, env: SkillEnv): boolean {
  const home = envHome(env);
  const dirs = [
    path.join(env.rootDir, '.paradigm', 'notebooks', agent),
    path.join(home, '.paradigm', 'notebooks', agent),
    path.join(env.rootDir, '.paradigm', 'agents', agent, 'notebooks'),
    path.join(home, '.paradigm', 'agents', agent, 'notebooks'),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    if (fs.existsSync(path.join(dir, `${nbId}.yaml`))) return true;
    try {
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.yaml')) continue;
        try {
          const e = yaml.load(fs.readFileSync(path.join(dir, f), 'utf8')) as { id?: string } | null;
          if (e?.id === nbId) return true;
        } catch { /* skip */ }
      }
    } catch { /* skip */ }
  }
  return false;
}

function agentExists(agent: string, env: SkillEnv, known?: string[]): boolean {
  if (known?.includes(agent)) return true;
  return [
    path.join(env.rootDir, '.paradigm', 'agents', `${agent}.agent`),
    path.join(envHome(env), '.paradigm', 'agents', `${agent}.agent`),
  ].some(p => fs.existsSync(p));
}

/** Lint a parsed skill. Errors block projection and certification. */
export function lintSkill(skill: SkillFile, env: SkillEnv, opts: LintOptions = {}): LintIssue[] {
  const issues: LintIssue[] = [];
  const meta = skill.metadata.paradigm;

  if (!KEBAB.test(skill.name)) issues.push({ level: 'error', code: 'NAME_NOT_KEBAB', message: `name "${skill.name}" is not kebab-case` });
  if (!KEBAB.test(meta.id)) issues.push({ level: 'error', code: 'ID_NOT_KEBAB', message: `id "${meta.id}" is not kebab-case` });
  if (!SEMVER.test(meta.version)) issues.push({ level: 'error', code: 'VERSION_NOT_SEMVER', message: `version "${meta.version}" is not semver` });
  // Key invariant: the source directory name IS the id (skill:<id>@<ver> joins depend on it).
  if (path.basename(skill.dir) !== meta.id) {
    issues.push({ level: 'error', code: 'DIR_ID_MISMATCH', message: `directory "${path.basename(skill.dir)}" does not match id "${meta.id}"` });
  }
  for (const sub of SKILL_RESOURCE_DIRS) {
    for (const rel of symlinksUnder(path.join(skill.dir, sub))) {
      issues.push({ level: 'error', code: 'RESOURCE_SYMLINK', message: `symlink in resource dir: ${rel ? `${sub}/${rel}` : sub}` });
    }
  }

  // SKILL_IS_PROTOCOL — steps that reference repo paths make this a protocol.
  const lines = skill.body.split(/\r?\n/);
  lines.forEach((line, i) => {
    const toks = repoPathTokens(line);
    if (toks.length > 0) {
      issues.push({
        level: 'error', code: 'SKILL_IS_PROTOCOL', line: i + 1,
        message: `step references repo path(s) ${toks.join(', ')} — repo-specific procedure belongs in a protocol`,
      });
    }
  });

  // SKILL_IS_NOTEBOOK — too thin to be a procedure.
  if (lines.filter(l => l.trim()).length < 3) {
    issues.push({ level: 'warn', code: 'SKILL_IS_NOTEBOOK', message: 'body has fewer than 3 non-blank lines — a single insight belongs in a notebook' });
  }

  if (opts.structuralOnly) return issues;

  // OWNED_SKILL_CAP
  const all = opts.allSkills ?? listSkills(env);
  const owned = new Set(all.filter(s => s.metadata.paradigm.steward === meta.steward).map(s => s.metadata.paradigm.id));
  owned.add(meta.id);
  if (owned.size > OWNED_SKILL_CAP) {
    issues.push({ level: 'warn', code: 'OWNED_SKILL_CAP', message: `steward ${meta.steward} owns ${owned.size} skills (cap ${OWNED_SKILL_CAP})` });
  }

  for (const ref of meta.notebooks ?? []) {
    const m = /^([^/\s]+)\/([^/\s]+)$/.exec(ref);
    if (!m) {
      issues.push({ level: 'error', code: 'NOTEBOOK_REF_MALFORMED', message: `notebook ref "${ref}" must be "<agent>/<nb-id>"` });
    } else if (!notebookExists(m[1], m[2], env)) {
      // Bundled seeds ship before the user's notebooks exist → warn, not error.
      const level = meta.provenance?.source === 'bundled' ? 'warn' : 'error';
      issues.push({ level, code: 'NOTEBOOK_MISSING', message: `Notebook source missing: ${ref}` });
    }
  }
  for (const p of meta.protocols ?? []) {
    if (!fs.existsSync(path.join(env.rootDir, '.paradigm', 'protocols', `${p}.protocol`))) {
      issues.push({ level: 'error', code: 'PROTOCOL_MISSING', message: `Protocol missing: ${p}` });
    }
  }
  if (!agentExists(meta.steward, env, opts.knownAgents)) {
    issues.push({ level: 'error', code: 'STEWARD_UNRESOLVED', message: `steward "${meta.steward}" has no .agent profile (project or global)` });
  }
  return issues;
}

// ────────────────────────────────────────────────────────
// Tool pins
// ────────────────────────────────────────────────────────

export interface ToolLike {
  name: string;
  inputSchema?: unknown;
}

/** ok/mismatch/missing = checked; unknown = uncheckable here; host/any = never checked. */
export type PinState = 'ok' | 'mismatch' | 'missing' | 'unknown' | 'host' | 'any';

export interface PinResult {
  tool: string;
  pin: string;
  state: PinState;
  actual?: string;
}

export interface PinReport {
  results: PinResult[];
  /** Any mismatch/missing → the skill is `stale`; projection refuses. */
  stale: boolean;
  /** Any `unknown` → projection proceeds; marker records pinsUnverified. */
  unverified: boolean;
}

/** Accepts a `tools/list` response dump: `{ tools: [...] }`, `{ result: { tools } }` or a bare array. */
export function parseToolsDump(json: unknown): ToolLike[] {
  const j = json as any;
  const arr = Array.isArray(j) ? j : Array.isArray(j?.tools) ? j.tools : Array.isArray(j?.result?.tools) ? j.result.tools : [];
  return arr.filter((t: any) => t && typeof t.name === 'string') as ToolLike[];
}

export function checkPins(
  skill: SkillFile,
  opts: { paradigmTools?: ToolLike[]; externalTools?: ToolLike[] } = {},
): PinReport {
  const results: PinResult[] = [];
  const pTools = opts.paradigmTools ? new Map(opts.paradigmTools.map(t => [t.name, t])) : null;
  const xTools = opts.externalTools ? new Map(opts.externalTools.map(t => [t.name, t])) : null;

  for (const [tool, pin] of Object.entries(skill.metadata.paradigm.tools ?? {})) {
    if (pin === 'host') { results.push({ tool, pin, state: 'host' }); continue; }
    if (pin === '*') { results.push({ tool, pin, state: 'any' }); continue; }
    const isParadigm = tool.startsWith('paradigm_');
    const table = isParadigm ? pTools : xTools;
    if (!table || !pin.startsWith('sha256:')) { results.push({ tool, pin, state: 'unknown' }); continue; }
    const def = table.get(tool);
    if (!def) {
      // A paradigm tool absent from the server's own list was removed → stale.
      // A third-party tool absent from a dump may be another server → unknown.
      results.push({ tool, pin, state: isParadigm ? 'missing' : 'unknown' });
      continue;
    }
    const actual = hashToolSchema(def.inputSchema);
    results.push({ tool, pin, state: actual === pin ? 'ok' : 'mismatch', actual });
  }
  return {
    results,
    stale: results.some(r => r.state === 'mismatch' || r.state === 'missing'),
    unverified: results.some(r => r.state === 'unknown'),
  };
}

// ────────────────────────────────────────────────────────
// Status
// ────────────────────────────────────────────────────────

export const GLOBAL_SKILL_LEDGER = 'skill-certifications.jsonl';

function globalLedgerPath(env: SkillEnv): string {
  return path.join(envHome(env), '.paradigm', 'events', GLOBAL_SKILL_LEDGER);
}

/**
 * Skill cert rows from the project classroom ledger PLUS the global skill
 * ledger (`~/.paradigm/events/skill-certifications.jsonl`) — certification is
 * GLOBAL, so a sign-off in project A must validate in project B.
 */
export function loadSkillCertLedger(env: SkillEnv): ClassroomCertRow[] {
  const rows = readClassroomCertifications(env.rootDir).filter(r => r.kind === 'skill');
  try {
    const p = globalLedgerPath(env);
    if (fs.existsSync(p)) {
      for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line) as ClassroomCertRow;
          if (r?.kind === 'skill') rows.push(r);
        } catch { /* skip */ }
      }
    }
  } catch { /* unreadable → no rows */ }
  return rows;
}

/** Append a skill cert row to the GLOBAL skill ledger (certify calls this AND appendClassroomCertification). */
export function appendGlobalSkillCertRow(env: SkillEnv, row: ClassroomCertRow): void {
  try {
    const p = globalLedgerPath(env);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, JSON.stringify(row) + '\n', 'utf8');
  } catch (err) {
    log.component('#skill-loader').warn('failed to record global skill certification', {
      entryId: row.entryId, error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Drift-detection (not tamper-proof; signing = follow-up): trust=certified AND
 * the SKILL.md certification hash matches the content AND a kind:'skill' ledger
 * row exists with the same entryId + contentHash (not overturned). No ledger → false.
 */
export function isCertificationValid(skill: SkillFile, ledger: ClassroomCertRow[] = []): boolean {
  const meta = skill.metadata.paradigm;
  const cert = meta.certification;
  if (meta.trust !== 'certified' || !cert) return false;
  if (cert.contentHash !== computeContentHash(skill)) return false;
  const key = skillKey(meta.id, meta.version);
  return ledger.some(r => r.kind === 'skill' && r.entryId === key
    && r.contentHash === cert.contentHash && r.outcome !== 'overturned');
}

/**
 * Computed, never stored. invalid › stale › ok › uncertified.
 * 'ok' requires `ledger` (loadSkillCertLedger) — omitted ledger ⇒ never 'ok'.
 */
export function computeStatus(
  skill: SkillFile,
  checks: { lint?: LintIssue[]; pins?: PinReport; ledger?: ClassroomCertRow[] } = {},
): SkillStatus {
  if (checks.lint && hasLintErrors(checks.lint)) return 'invalid';
  if (checks.pins?.stale) return 'stale';
  return isCertificationValid(skill, checks.ledger) ? 'ok' : 'uncertified';
}

const structuralLintCache = new Map<string, { mtimeMs: number; lint: LintIssue[] }>();

/** Structural lint cached per process by skill dir + SKILL.md mtime. */
function cachedStructuralLint(skill: SkillFile, env: SkillEnv): LintIssue[] {
  let mtimeMs = -1;
  try { mtimeMs = fs.statSync(path.join(skill.dir, SKILL_FILE)).mtimeMs; } catch { /* uncached */ }
  const hit = structuralLintCache.get(skill.dir);
  if (hit && hit.mtimeMs === mtimeMs && mtimeMs >= 0) return hit.lint;
  const lint = lintSkill(skill, env, { structuralOnly: true });
  structuralLintCache.set(skill.dir, { mtimeMs, lint });
  return lint;
}

/**
 * Summaries for an agent's declared `skills:` (unresolvable ids are logged and
 * skipped). Runs per dispatch, so it is deliberately cheap: STRUCTURAL lint only
 * (cached; no notebook/protocol/steward scans) and pins are NOT checked — so
 * status here is ok | uncertified | invalid, never stale. `paradigm skill list`
 * is the authoritative full check.
 */
export function resolveAgentSkills(profile: AgentProfile, env: SkillEnv): SkillSummary[] {
  const out: SkillSummary[] = [];
  const refs = Array.isArray(profile.skills) ? profile.skills : [];
  if (refs.length === 0) return out;
  let ledger: ClassroomCertRow[] | undefined;
  for (const ref of refs) {
    if (!ref || typeof ref.id !== 'string') continue;
    const skill = resolveSkill(ref.id, env);
    if (!skill) {
      log.component('#skill-loader').warn('Agent references unresolvable skill', { agent: profile.id, skill: ref.id });
      continue;
    }
    ledger ??= loadSkillCertLedger(env);
    const status = computeStatus(skill, { lint: cachedStructuralLint(skill, env), ledger });
    const meta = skill.metadata.paradigm;
    const projected = [projectedSkillDir(meta.id, 'user', env), projectedSkillDir(meta.id, 'project', env)]
      .find(d => fs.existsSync(path.join(d, SKILL_FILE)));
    out.push({
      id: meta.id,
      name: projected ? `${PROJECTED_PREFIX}${meta.id}` : skill.name,
      description: skill.description,
      path: projected ?? skill.dir,
      trust: meta.trust,
      status,
      role: ref.role === 'owns' ? 'owns' : 'uses',
      steward: meta.steward,
      version: meta.version,
    });
  }
  return out;
}

// ────────────────────────────────────────────────────────
// Certification ($skill-certification) — pure verification
// ────────────────────────────────────────────────────────

export interface CertifyOptions {
  /** Resolves probe agents (peer must be a known profile) and fixture paths (relative to rootDir). */
  env: SkillEnv;
  /** Extra agent ids treated as known profiles. */
  knownAgents?: string[];
  /** Skill cert ledger (loadSkillCertLedger) — used for the "already certified" check. */
  ledger?: ClassroomCertRow[];
  /** Human approver recorded as certification.approvedBy. */
  founder: string;
  /** process.stdin.isTTY — certification is TTY-only (agents cannot self-certify). */
  tty: boolean;
  /** Project the sign-off happens in (recorded; certification is global). */
  project: string;
  /** What the founder typed. When provided it must equal the skill id. */
  confirmation?: string;
  /** lintSkill result — errors refuse. */
  lint: LintIssue[];
  /** checkPins result — stale refuses. */
  pins: PinReport;
  now?: Date;
}

export interface CertificationEvaluation {
  ok: boolean;
  /** Why certification is refused (empty when ok). */
  reasons: string[];
  /** `skill:<id>@<version>` */
  entryId: string;
  qualifying: string[];
  rejected: Array<{ id: string; why: string }>;
  /** Present when ok — the block to write via applyCertification. */
  certification?: SkillCertification;
}

/** Why a scenario does NOT qualify for this skill version, or null when it does. */
export function scenarioDisqualifier(
  scenario: Scenario,
  skill: SkillFile,
  ctx: { env: SkillEnv; knownAgents?: string[] },
): string | null {
  const meta = skill.metadata.paradigm;
  const key = skillKey(meta.id, meta.version);
  if (!scenario.fixture) return 'no fixture (planted-defect path) declared';
  if (!fs.existsSync(path.resolve(ctx.env.rootDir, scenario.fixture))) return `fixture not found: ${scenario.fixture}`;
  if (scenario.status === 'retired') return 'scenario is retired';
  if (scenario.expected?.must !== 'survive') return 'expected.must is not "survive"';
  const probes = (scenario.probes ?? []).filter(p => p.learning_ref === key);
  if (probes.length === 0) return `no probe targets ${key}`;
  const peers = probes.filter(p => typeof p.agent === 'string' && p.agent.trim() !== '' && p.agent !== meta.steward);
  if (peers.length === 0) return `no peer probe (probe agent missing or only steward ${meta.steward})`;
  if (!peers.some(p => isValidSkillId(p.agent) && agentExists(p.agent, ctx.env, ctx.knownAgents))) {
    return `probe agent(s) ${peers.map(p => p.agent).join(', ')} do not resolve to a known profile`;
  }
  const confirmed = (scenario.outcome_history ?? []).some(o =>
    o.term === key && o.result === 'survived' && o.human_confirmed === true);
  if (!confirmed) return `no human-confirmed survival for ${key}`;
  return null;
}

/**
 * Verify every $skill-certification precondition. Pure — the CLI supplies
 * tty/founder/confirmation, lint and pins, and writes the result via
 * applyCertification + writeSkill + appendClassroomCertification(buildSkillCertRow(...)).
 */
export function evaluateCertification(
  skill: SkillFile,
  scenarios: Scenario[],
  opts: CertifyOptions,
): CertificationEvaluation {
  const meta = skill.metadata.paradigm;
  const entryId = skillKey(meta.id, meta.version);
  const reasons: string[] = [];

  if (!opts.tty) reasons.push('certification requires an interactive TTY (founder sign-off)');
  if (!opts.founder || !opts.founder.trim()) reasons.push('approver (founder) is required');
  if (meta.trust === 'external') reasons.push('external skills cannot be certified — adopt first');
  if (isCertificationValid(skill, opts.ledger)) reasons.push(`${entryId} is already certified`);
  if (hasLintErrors(opts.lint)) reasons.push('lint errors must be fixed first');
  if (opts.pins.stale) reasons.push('stale tool pin(s) must be re-pinned first');
  if (opts.confirmation !== undefined && opts.confirmation.trim() !== meta.id) {
    reasons.push(`confirmation "${opts.confirmation}" does not match skill id "${meta.id}"`);
  }

  const qualifying: string[] = [];
  const rejected: Array<{ id: string; why: string }> = [];
  for (const sc of scenarios) {
    const why = scenarioDisqualifier(sc, skill, { env: opts.env, knownAgents: opts.knownAgents });
    if (why) rejected.push({ id: sc.id, why });
    else qualifying.push(sc.id);
  }
  if (qualifying.length === 0) {
    reasons.push('no qualifying scenario (needs fixture + peer probe on this version + human-confirmed survival)');
  }

  if (reasons.length > 0) return { ok: false, reasons, entryId, qualifying, rejected };

  const certifiedForm: SkillFile = { ...skill, metadata: { paradigm: { ...meta, trust: 'certified', certification: undefined } } };
  const certification: SkillCertification = {
    approvedBy: opts.founder.trim(),
    approvedAt: (opts.now ?? new Date()).toISOString(),
    project: opts.project,
    scenarios: qualifying,
    contentHash: computeContentHash(certifiedForm),
  };
  return { ok: true, reasons, entryId, qualifying, rejected, certification };
}

/** Return a copy with trust certified + the certification block (write with writeSkill). */
export function applyCertification(skill: SkillFile, certification: SkillCertification): SkillFile {
  return {
    ...skill,
    metadata: { paradigm: { ...skill.metadata.paradigm, trust: 'certified', certification } },
  };
}

/** The classroom-certifications ledger row for a skill certification (append via appendClassroomCertification). */
export function buildSkillCertRow(skill: SkillFile, certification: SkillCertification): ClassroomCertRow {
  const meta: ParadigmSkillMeta = skill.metadata.paradigm;
  return {
    ts: certification.approvedAt,
    agent: meta.steward,
    entryId: skillKey(meta.id, meta.version),
    concepts: meta.triggers?.concepts ?? [],
    confidenceAtCert: 1,
    certifiedBy: 'peer',
    outcome: 'pending',
    kind: 'skill',
    approvedBy: certification.approvedBy,
    contentHash: certification.contentHash,
  };
}
