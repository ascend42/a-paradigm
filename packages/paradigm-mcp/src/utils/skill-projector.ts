/**
 * #skill-projector — one-way projection of Paradigm skill sources into the
 * host's skill directory, plus `adopt` (the only way downstream edits flow back).
 *
 *   source  <root>/.paradigm/skills/<id>/  or  ~/.paradigm/skills/<id>/
 *   dest    ~/.claude/skills/pdg-<id>/     (target 'user', default)
 *           <root>/.claude/skills/pdg-<id>/ (target 'project')
 *
 * Projected SKILL.md: `name: pdg-<id>`, description + allowed-tools kept, and
 * `metadata` FLATTENED to a string→string map (founder resolution):
 *   { paradigm-id, paradigm-version, paradigm-steward, paradigm-trust, paradigm-source }
 * — never a nested object; `certification` is dropped. A `.pdg-generated.json`
 * sidecar (ProjectionMarker) records ownership + the projected tree hash.
 *
 * HARD RULES: never writes anything under ~/.claude/skills/synced/; ids are
 * KEBAB-validated and meta.id === id === basename(source dir) before any path
 * is built; scripts/ is NEVER projected for a non-certified skill (withheld,
 * marker.scriptsWithheld); any symlink in a projected dir counts as drift.
 * Certification is drift-detection (not tamper-proof); signing = follow-up.
 *
 * Exported API:
 *   projectSkill(idOrSkill, opts: ProjectOptions)  → ProjectionResult
 *   adoptSkill(id, opts: AdoptOptions)             → AdoptResult
 *     opts: { env, target?, force? (source changed since projection),
 *             confirmAllowedTools? (downstream widened allowed-tools) }
 *   parseAllowedTools(value)                       → string[]
 *   flattenMetadata(meta)                          → ProjectedSkillMetadata
 *   unflattenMetadata(flat, base)                  → ParadigmSkillMeta
 *   renderProjectedSkillMd(skill, { banner })      → string
 *   buildProjectedTree(skill, { banner })          → Map<relPath, Buffer>
 *   hashTreeFiles(map) / hashTreeDir(dir)          → "sha256:<hex>" (marker excluded)
 *   readMarker(dir)                                → ProjectionMarker | null
 *   isUnderSynced(dest, homedir)                   → boolean
 *   bumpPatch(version)                             → string
 *   PROVISIONAL_BANNER
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as yaml from 'js-yaml';
import { log } from './mcp-logger.js';
import {
  SKILL_FILE,
  MARKER_FILE,
  VERSIONS_DIR,
  PROJECTED_PREFIX,
  SKILL_RESOURCE_DIRS,
  envHome,
  projectedSkillDir,
  resolveSkill,
  lintSkill,
  hasLintErrors,
  checkPins,
  computeStatus,
  computeContentHash,
  skillResourceFiles,
  listFilesRecursive,
  splitFrontmatter,
  writeSkill,
  isValidSkillId,
  isSemver,
  projectedSkillsRoot,
  symlinksUnder,
  loadSkillCertLedger,
  type SkillEnv,
  type LintIssue,
  type LintOptions,
  type PinReport,
  type ToolLike,
} from './skill-loader.js';
import type {
  SkillFile,
  ParadigmSkillMeta,
  ProjectedSkillMetadata,
  ProjectionMarker,
} from '../types/skills.js';

export const PROVISIONAL_BANNER = 'PROVISIONAL — not certified.';

// ────────────────────────────────────────────────────────
// Flatten / render
// ────────────────────────────────────────────────────────

function flatString(v: unknown): string {
  if (Array.isArray(v)) return v.map(x => String(x)).join(',');
  return v === undefined || v === null ? '' : String(v);
}

/** Nested `metadata.paradigm` → host-conformant string map. Strings only. */
export function flattenMetadata(meta: ParadigmSkillMeta): ProjectedSkillMetadata {
  return {
    'paradigm-id': flatString(meta.id),
    'paradigm-version': flatString(meta.version),
    'paradigm-steward': flatString(meta.steward),
    'paradigm-trust': flatString(meta.trust),
    'paradigm-source': flatString(meta.provenance?.source),
  };
}

/**
 * Flat projected map → nested meta, preserving every source-only field of
 * `base` (triggers, notebooks, tools, …). Only `steward` is taken from the flat
 * map; id stays the source's; version/trust/provenance are the caller's to set.
 * `certification` is always dropped.
 */
export function unflattenMetadata(flat: Record<string, unknown> | undefined, base: ParadigmSkillMeta): ParadigmSkillMeta {
  const { certification: _drop, ...rest } = base;
  const steward = typeof flat?.['paradigm-steward'] === 'string' && flat['paradigm-steward']
    ? (flat['paradigm-steward'] as string)
    : base.steward;
  return { ...rest, steward, provenance: { ...base.provenance } };
}

export function renderProjectedSkillMd(skill: SkillFile, opts: { banner?: boolean } = {}): string {
  const meta = skill.metadata.paradigm;
  const fm: Record<string, unknown> = {
    name: `${PROJECTED_PREFIX}${meta.id}`,
    description: skill.description,
  };
  if (skill['allowed-tools'] !== undefined) fm['allowed-tools'] = skill['allowed-tools'];
  fm.metadata = flattenMetadata(meta);
  const body = opts.banner ? `${PROVISIONAL_BANNER}\n\n${skill.body}` : skill.body;
  return `---\n${yaml.dump(fm, { lineWidth: -1, noRefs: true, sortKeys: false })}---\n${body}`;
}

/** Projected tree in memory: SKILL.md + references/ assets/ scripts/ files. */
export function buildProjectedTree(
  skill: SkillFile,
  opts: { banner?: boolean; withholdScripts?: boolean } = {},
): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  files.set(SKILL_FILE, Buffer.from(renderProjectedSkillMd(skill, opts), 'utf8'));
  for (const rel of skillResourceFiles(skill.dir, { withholdScripts: opts.withholdScripts })) {
    files.set(rel, fs.readFileSync(path.join(skill.dir, rel)));
  }
  return files;
}

export function hashTreeFiles(files: Map<string, Buffer>): string {
  const h = crypto.createHash('sha256');
  for (const rel of [...files.keys()].filter(r => r !== MARKER_FILE).sort()) {
    h.update(`\0file\0${rel}\0`);
    h.update(files.get(rel)!);
  }
  return `sha256:${h.digest('hex')}`;
}

/** Projected tree on disk — dotfiles (marker, .DS_Store …) and symlinks excluded. */
function readTree(dir: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const rel of listFilesRecursive(dir, [], { skipDot: true })) {
    files.set(rel, fs.readFileSync(path.join(dir, rel)));
  }
  return files;
}

export function hashTreeDir(dir: string): string {
  return hashTreeFiles(readTree(dir));
}

/** Drifted = any symlink in the dir (lstat scan) OR tree hash ≠ marker.contentHash. */
export function isDrifted(dir: string, marker: ProjectionMarker): boolean {
  return symlinksUnder(dir).length > 0 || hashTreeDir(dir) !== marker.contentHash;
}

export function readMarker(dir: string): ProjectionMarker | null {
  const p = path.join(dir, MARKER_FILE);
  if (!fs.existsSync(p)) return null;
  try {
    const m = JSON.parse(fs.readFileSync(p, 'utf8')) as ProjectionMarker;
    return m && typeof m.contentHash === 'string' ? m : null;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────
// Safety
// ────────────────────────────────────────────────────────

/** Resolve symlinks on the nearest existing ancestor, re-append the rest. */
function realpathish(p: string): string {
  let cur = path.resolve(p);
  const tail: string[] = [];
  while (!fs.existsSync(cur)) {
    const parent = path.dirname(cur);
    if (parent === cur) break;
    tail.unshift(path.basename(cur));
    cur = parent;
  }
  try { cur = fs.realpathSync(cur); } catch { /* keep */ }
  return path.join(cur, ...tail);
}

/** True when `dest` is (or resolves to) anything under `<homedir>/.claude/skills/synced`. */
export function isUnderSynced(dest: string, homedir: string): boolean {
  const synced = path.join(homedir, '.claude', 'skills', 'synced');
  const roots = [path.resolve(synced), realpathish(synced)];
  const cands = [path.resolve(dest), realpathish(dest)];
  return cands.some(c => roots.some(r => c === r || c.startsWith(r + path.sep)));
}

const STALE_TEMP_MS = 10 * 60 * 1000;

/** Remove `.pdg-*.tmp-*` / `.pdg-*.old-*` leftovers (older than 10 min) from a crashed commit. */
export function sweepStaleTemps(skillsRoot: string, now = Date.now()): string[] {
  const removed: string[] = [];
  let names: string[] = [];
  try { names = fs.readdirSync(skillsRoot); } catch { return removed; }
  for (const n of names) {
    if (!/^\.pdg-.+\.(tmp|old)-/.test(n)) continue;
    const abs = path.join(skillsRoot, n);
    try {
      if (now - fs.lstatSync(abs).mtimeMs < STALE_TEMP_MS) continue;
      fs.rmSync(abs, { recursive: true, force: true });
      removed.push(n);
    } catch { /* ignore */ }
  }
  return removed;
}

function commitTree(dest: string, files: Map<string, Buffer>, marker: ProjectionMarker): void {
  const parent = path.dirname(dest);
  const base = path.basename(dest);
  fs.mkdirSync(parent, { recursive: true });
  sweepStaleTemps(parent);
  const nonce = `${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const tmp = path.join(parent, `.${base}.tmp-${nonce}`);
  try {
    for (const [rel, buf] of files) {
      const abs = path.join(tmp, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, buf);
    }
    fs.writeFileSync(path.join(tmp, MARKER_FILE), JSON.stringify(marker, null, 2) + '\n', 'utf8');
    if (fs.existsSync(dest)) {
      const old = path.join(parent, `.${base}.old-${nonce}`);
      fs.renameSync(dest, old);
      fs.renameSync(tmp, dest);
      fs.rmSync(old, { recursive: true, force: true });
    } else {
      fs.renameSync(tmp, dest);
    }
  } catch (err) {
    fs.rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
}

// ────────────────────────────────────────────────────────
// Project
// ────────────────────────────────────────────────────────

export interface ProjectOptions {
  env: SkillEnv;
  /** 'user' → ~/.claude/skills (default); 'project' → <root>/.claude/skills. */
  target?: 'user' | 'project';
  /** Let provisional skills through with the PROVISIONAL banner. */
  allowProvisional?: boolean;
  dryRun?: boolean;
  /** From listToolDefinitions() — enables paradigm_* pin checks. */
  paradigmTools?: ToolLike[];
  /** From a `--tools` tools/list dump — enables third-party pin checks. */
  externalTools?: ToolLike[];
  lintOptions?: LintOptions;
  now?: Date;
}

export type ProjectionRefusal =
  | 'invalid-id' | 'id-mismatch' | 'not-found' | 'lint' | 'stale' | 'untrusted' | 'synced' | 'not-ours' | 'drifted';

export interface ProjectionResult {
  ok: boolean;
  skillId: string;
  dest: string;
  message: string;
  refused?: ProjectionRefusal;
  lint: LintIssue[];
  pins?: PinReport;
  marker?: ProjectionMarker;
  /** Dest already matched this exact projection — nothing written. */
  unchanged?: boolean;
  dryRun?: boolean;
  banner?: boolean;
  /** scripts/ withheld because the skill is not certified. */
  scriptsWithheld?: boolean;
  files?: string[];
}

export function projectSkill(idOrSkill: string | SkillFile, opts: ProjectOptions): ProjectionResult {
  const env = opts.env;
  const target = opts.target ?? 'user';
  const id = typeof idOrSkill === 'string' ? idOrSkill : idOrSkill.metadata.paradigm.id;
  if (!isValidSkillId(id)) {
    log.component('#skill-projector').warn('Projection refused', { skillId: String(id), refused: 'invalid-id' });
    return { ok: false, skillId: String(id), dest: '', refused: 'invalid-id', message: `invalid skill id "${id}"`, lint: [] };
  }
  const dest = projectedSkillDir(id, target, env);
  const refuse = (refused: ProjectionRefusal, message: string, extra: Partial<ProjectionResult> = {}): ProjectionResult => {
    log.component('#skill-projector').warn('Projection refused', { skillId: id, refused, dest });
    return { ok: false, skillId: id, dest, refused, message, lint: [], ...extra };
  };
  if (path.dirname(dest) !== projectedSkillsRoot(target, env)) return refuse('invalid-id', `dest escapes the skills root: ${dest}`);
  // Dest safety first — never even evaluate a projection into synced/.
  if (isUnderSynced(dest, envHome(env))) return refuse('synced', `refusing to write under ~/.claude/skills/synced/ (${dest})`);

  const skill = typeof idOrSkill === 'string' ? resolveSkill(idOrSkill, env) : idOrSkill;
  if (!skill) return refuse('not-found', `skill "${id}" not found in project or global sources`);
  // SECURITY: pack skills never project — they are read-only external sources.
  if (skill.scope === 'pack') {
    return refuse('untrusted', `pack skill "${id}" is external and never projects — \`paradigm skill import ${skill.packId ?? '<pack>'}:${id}\` first`);
  }
  if (skill.metadata.paradigm.id !== id || path.basename(skill.dir) !== id) {
    return refuse('id-mismatch', `id "${id}", meta.id "${skill.metadata.paradigm.id}" and dir "${path.basename(skill.dir)}" must match`);
  }

  // 1. lint
  const lint = lintSkill(skill, env, opts.lintOptions);
  if (hasLintErrors(lint)) return refuse('lint', 'lint errors — run `paradigm skill lint`', { lint });

  // 2. pins
  const pins = checkPins(skill, { paradigmTools: opts.paradigmTools, externalTools: opts.externalTools });
  if (pins.stale) return refuse('stale', 'stale tool pin(s) — run `paradigm skill check`', { lint, pins });

  // 3. trust gate
  const meta = skill.metadata.paradigm;
  const status = computeStatus(skill, { lint, pins, ledger: loadSkillCertLedger(env) });
  let banner = false;
  if (status !== 'ok') {
    if (opts.allowProvisional && meta.trust === 'provisional') {
      banner = true; // non-certified ⇒ scripts/ withheld below
    } else {
      const why = meta.trust === 'certified'
        ? 'certification hash mismatch (content changed since sign-off)'
        : `trust is ${meta.trust}`;
      return refuse('untrusted', `${why} — only certified skills project (use --allow-provisional for provisional)`, { lint, pins });
    }
  }


  // 5-6. build tree + marker
  const scriptsWithheld = status !== 'ok';
  const files = buildProjectedTree(skill, { banner, withholdScripts: scriptsWithheld });
  const contentHash = hashTreeFiles(files);
  const sourceHash = computeContentHash(skill);

  // 7. existing dest
  const existing = fs.existsSync(dest) ? readMarker(dest) : null;
  if (fs.existsSync(dest)) {
    if (!existing) return refuse('not-ours', `${dest} exists and was not generated by Paradigm (no ${MARKER_FILE})`, { lint, pins });
    if (isDrifted(dest, existing)) {
      return refuse('drifted', `${dest} was edited downstream: run \`paradigm skill adopt ${id}\``, { lint, pins });
    }
  }

  const marker: ProjectionMarker = {
    skillId: meta.id,
    version: meta.version,
    sourcePath: skill.dir,
    sourceHash,
    contentHash,
    pinsUnverified: pins.unverified,
    scriptsWithheld,
    generatedAt: (opts.now ?? new Date()).toISOString(),
  };
  const base = { skillId: id, dest, lint, pins, banner, scriptsWithheld, files: [...files.keys()] };

  if (existing && existing.contentHash === contentHash && existing.sourceHash === sourceHash
      && existing.pinsUnverified === pins.unverified && !!existing.scriptsWithheld === scriptsWithheld) {
    return { ...base, ok: true, unchanged: true, marker: existing, message: `${dest} already up to date` };
  }
  if (opts.dryRun) return { ...base, ok: true, dryRun: true, marker, message: `would project ${id} → ${dest}` };

  commitTree(dest, files, marker);
  log.component('#skill-projector').info('Skill projected', { skillId: id, version: meta.version, dest, banner });
  return { ...base, ok: true, marker, message: `projected ${id}@${meta.version} → ${dest}` };
}

// ────────────────────────────────────────────────────────
// Adopt
// ────────────────────────────────────────────────────────

export function bumpPatch(version: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) return version;
  return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
}

export interface AdoptOptions {
  env: SkillEnv;
  target?: 'user' | 'project';
  /** Adopt even though the SOURCE changed since projection (downstream edits win). */
  force?: boolean;
  /** Accept a downstream WIDENING of allowed-tools. */
  confirmAllowedTools?: boolean;
  now?: Date;
}

export type AdoptRefusal =
  | 'invalid-id' | 'id-mismatch' | 'invalid-version' | 'not-found' | 'not-projected' | 'not-ours'
  | 'symlink' | 'no-changes' | 'invalid-projection' | 'source-changed' | 'allowed-tools-widened';

export interface FrontmatterDiff {
  description?: { from: string; to: string };
  allowedTools?: { from?: string; to?: string; added: string[]; removed: string[]; widened: boolean };
}

export interface AdoptResult {
  ok: boolean;
  skillId: string;
  dest: string;
  message: string;
  refused?: AdoptRefusal;
  fromVersion?: string;
  toVersion?: string;
  archivedTo?: string;
  diff?: { added: string[]; removed: string[]; modified: string[] };
  /** description / allowed-tools changes between downstream and source (also set on refusals). */
  frontmatterDiff?: FrontmatterDiff;
  /** The rewritten source. */
  skill?: SkillFile;
  marker?: ProjectionMarker;
  lint?: LintIssue[];
  /** False when the adopted source has lint errors — source written, dest left as-is. */
  reprojected?: boolean;
}

/** Split an allowed-tools string ("Read Bash(git:*), Grep") into tool tokens. */
export function parseAllowedTools(value: string | undefined): string[] {
  if (!value) return [];
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ',' || /\s/.test(ch))) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return [...new Set(out)];
}

function stripBanner(body: string): { body: string; had: boolean } {
  for (const sep of ['\n\n', '\n']) {
    if (body.startsWith(PROVISIONAL_BANNER + sep)) return { body: body.slice(PROVISIONAL_BANNER.length + sep.length), had: true };
  }
  return { body, had: false };
}

function diffTrees(a: Map<string, Buffer>, b: Map<string, Buffer>): { added: string[]; removed: string[]; modified: string[] } {
  const added = [...b.keys()].filter(k => !a.has(k)).sort();
  const removed = [...a.keys()].filter(k => !b.has(k)).sort();
  const modified = [...b.keys()].filter(k => a.has(k) && !a.get(k)!.equals(b.get(k)!)).sort();
  return { added, removed, modified };
}

/**
 * Pull downstream edits of a projected skill back into its source: patch+1,
 * trust provisional, provenance.source 'adopted', certification dropped, prior
 * source archived to `<skilldir>/.versions/<old>/`, metadata un-flattened, then
 * linted and — only if lint-clean — re-projected (PROVISIONAL banner, scripts/
 * withheld) under a fresh marker.
 *
 * Refuses: invalid id / id≠meta.id≠dir, non-semver source version, unmarked or
 * symlinked dest, no downstream changes, source changed since projection
 * (unless force), allowed-tools widened downstream (unless confirmAllowedTools).
 */
export function adoptSkill(id: string, opts: AdoptOptions): AdoptResult {
  const env = opts.env;
  const target = opts.target ?? 'user';
  if (!isValidSkillId(id)) {
    log.component('#skill-projector').warn('Adopt refused', { skillId: String(id), refused: 'invalid-id' });
    return { ok: false, skillId: String(id), dest: '', refused: 'invalid-id', message: `invalid skill id "${id}"` };
  }
  const dest = projectedSkillDir(id, target, env);
  const refuse = (refused: AdoptRefusal, message: string, extra: Partial<AdoptResult> = {}): AdoptResult => {
    log.component('#skill-projector').warn('Adopt refused', { skillId: id, refused, dest });
    return { ok: false, skillId: id, dest, refused, message, ...extra };
  };
  if (path.dirname(dest) !== projectedSkillsRoot(target, env)) return refuse('invalid-id', `dest escapes the skills root: ${dest}`);
  if (isUnderSynced(dest, envHome(env))) return refuse('not-ours', `refusing to touch ~/.claude/skills/synced/`);

  const source = resolveSkill(id, env);
  // Pack sources are read-only — adopt never writes into a pack.
  if (!source || source.scope === 'pack') return refuse('not-found', `skill "${id}" not found in project or global sources`);
  if (source.metadata.paradigm.id !== id || path.basename(source.dir) !== id) {
    return refuse('id-mismatch', `id "${id}", meta.id "${source.metadata.paradigm.id}" and dir "${path.basename(source.dir)}" must match`);
  }
  const fromVersion = source.metadata.paradigm.version;
  if (!isSemver(fromVersion)) return refuse('invalid-version', `source version "${fromVersion}" is not semver`);

  if (!fs.existsSync(path.join(dest, SKILL_FILE))) return refuse('not-projected', `${dest} has no projected SKILL.md`);
  const marker = readMarker(dest);
  if (!marker) return refuse('not-ours', `${dest} was not generated by Paradigm (no ${MARKER_FILE})`);
  if (marker.skillId !== id) return refuse('id-mismatch', `marker skillId "${marker.skillId}" ≠ "${id}"`);
  const links = symlinksUnder(dest);
  if (links.length > 0) return refuse('symlink', `projected dir contains symlink(s): ${links.join(', ')}`);

  const destTree = readTree(dest);
  if (hashTreeFiles(destTree) === marker.contentHash) return refuse('no-changes', `${dest} has no downstream edits`);

  if (!opts.force && marker.sourceHash !== computeContentHash(source)) {
    return refuse('source-changed', `source of ${id} changed since projection — re-run with force to let downstream edits win`);
  }

  let parsed: { data: Record<string, unknown>; body: string };
  try {
    parsed = splitFrontmatter(destTree.get(SKILL_FILE)!.toString('utf8'));
  } catch (err) {
    return refuse('invalid-projection', `projected SKILL.md unreadable: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Frontmatter diff (description / allowed-tools).
  const frontmatterDiff: FrontmatterDiff = {};
  const newDesc = typeof parsed.data.description === 'string' ? parsed.data.description : source.description;
  if (newDesc !== source.description) frontmatterDiff.description = { from: source.description, to: newDesc };
  const newAllowed = typeof parsed.data['allowed-tools'] === 'string' ? (parsed.data['allowed-tools'] as string) : undefined;
  if (newAllowed !== source['allowed-tools']) {
    const before = parseAllowedTools(source['allowed-tools']);
    const after = parseAllowedTools(newAllowed);
    const added = after.filter(t => !before.includes(t));
    const removed = before.filter(t => !after.includes(t));
    frontmatterDiff.allowedTools = { from: source['allowed-tools'], to: newAllowed, added, removed, widened: added.length > 0 };
  }
  if (frontmatterDiff.allowedTools?.widened && !opts.confirmAllowedTools) {
    return refuse('allowed-tools-widened',
      `downstream widened allowed-tools (+${frontmatterDiff.allowedTools.added.join(', ')}) — re-run with confirmAllowedTools`,
      { frontmatterDiff });
  }

  const { body, had } = stripBanner(parsed.body);
  const withheld = !!marker.scriptsWithheld;
  const diff = diffTrees(buildProjectedTree(source, { banner: had, withholdScripts: withheld }), destTree);

  // Archive prior source.
  const toVersion = bumpPatch(fromVersion);
  const versionsRoot = path.join(source.dir, VERSIONS_DIR);
  let archivedTo = path.join(versionsRoot, fromVersion);
  if (path.dirname(archivedTo) !== versionsRoot) return refuse('invalid-version', `bad archive path for "${fromVersion}"`);
  if (fs.existsSync(archivedTo)) archivedTo = `${archivedTo}-${Date.now()}`;
  fs.mkdirSync(archivedTo, { recursive: true });
  fs.copyFileSync(path.join(source.dir, SKILL_FILE), path.join(archivedTo, SKILL_FILE));
  for (const rel of skillResourceFiles(source.dir)) {
    fs.mkdirSync(path.dirname(path.join(archivedTo, rel)), { recursive: true });
    fs.copyFileSync(path.join(source.dir, rel), path.join(archivedTo, rel));
  }

  // Un-flatten into the nested source form.
  const baseMeta = unflattenMetadata(parsed.data.metadata as Record<string, unknown> | undefined, source.metadata.paradigm);
  const meta: ParadigmSkillMeta = {
    ...baseMeta,
    version: toVersion,
    trust: 'provisional',
    provenance: { ...baseMeta.provenance, source: 'adopted' },
  };
  const adopted: SkillFile = {
    name: source.name,
    description: newDesc,
    metadata: { paradigm: meta },
    body,
    dir: source.dir,
    scope: source.scope,
  };
  if (newAllowed !== undefined) adopted['allowed-tools'] = newAllowed;

  // Mirror resource dirs from dest. scripts/ is kept from the SOURCE when the
  // projection withheld it (downstream never saw it).
  const mirrored = SKILL_RESOURCE_DIRS.filter(sub => !(withheld && sub === 'scripts'));
  for (const sub of mirrored) fs.rmSync(path.join(source.dir, sub), { recursive: true, force: true });
  for (const [rel, buf] of destTree) {
    if (!mirrored.some(sub => rel.startsWith(`${sub}/`))) continue;
    const abs = path.join(source.dir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
  }
  writeSkill(adopted);

  const common = { skillId: id, dest, fromVersion, toVersion, archivedTo, diff, frontmatterDiff, skill: adopted };

  // Lint BEFORE re-projecting.
  const lint = lintSkill(adopted, env);
  if (hasLintErrors(lint)) {
    log.component('#skill-projector').warn('Adopted source has lint errors — not re-projected', { skillId: id, toVersion });
    return {
      ...common, ok: true, lint, reprojected: false,
      message: `adopted ${id} ${fromVersion} → ${toVersion} (provisional) but lint errors block re-projection — fix and run \`paradigm skill project ${id} --allow-provisional\``,
    };
  }

  // Re-project (forced over the drifted dest) with a fresh marker.
  const files = buildProjectedTree(adopted, { banner: true, withholdScripts: true });
  const newMarker: ProjectionMarker = {
    skillId: meta.id,
    version: toVersion,
    sourcePath: adopted.dir,
    sourceHash: computeContentHash(adopted),
    contentHash: hashTreeFiles(files),
    pinsUnverified: checkPins(adopted).unverified,
    scriptsWithheld: true,
    generatedAt: (opts.now ?? new Date()).toISOString(),
  };
  commitTree(dest, files, newMarker);
  log.component('#skill-projector').info('Skill adopted', { skillId: id, fromVersion, toVersion, archivedTo });
  return {
    ...common, ok: true, marker: newMarker, lint, reprojected: true,
    message: `adopted ${id} ${fromVersion} → ${toVersion} (provisional); prior archived to ${archivedTo}`,
  };
}
