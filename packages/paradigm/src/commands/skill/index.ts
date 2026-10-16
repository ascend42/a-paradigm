/**
 * paradigm skill — human-facing skills CLI (#skill-cli, Skills Phase 1,
 * T-2026-09-26-002).
 *
 * A thin skin over paradigm-mcp's #skill-loader / #skill-projector /
 * !skill-used modules, imported by relative path (same precedent as
 * commands/task/index.ts). Verbs: list, show, lint, check, project, adopt,
 * import (v7.11 — pack skill → provisional project/global copy, TTY-gated),
 * plus the hidden `record-usage` used by the PostToolUse `Skill` hook.
 * `certify` lives in ./certify.ts (TTY-gated, $skill-certification) and
 * `sync-global` in ./sync-global.ts.
 *
 * Output goes through cli-output.ts helpers per CLAUDE.md.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

import {
  resolveSkill,
  listSkillsDetailed,
  lintSkill,
  hasLintErrors,
  checkPins,
  computeStatus,
  computeContentHash,
  parseToolsDump,
  skillKey,
  isValidSkillId,
  loadSkillCertLedger,
  listSkillScripts,
  findPackSkill,
  importPackSkill,
  type SkillEnv,
  type LintIssue,
  type PinReport,
  type ToolLike,
} from '../../../../paradigm-mcp/src/utils/skill-loader.js';
import { projectSkill, adoptSkill, type AdoptResult } from '../../../../paradigm-mcp/src/utils/skill-projector.js';
import { appendSkillUsage, buildSkillUsageRow, resolveHookProjectDir } from '../../../../paradigm-mcp/src/utils/skill-usage.js';
import type { SkillFile, SkillStatus } from '../../../../paradigm-mcp/src/types/skills.js';

import { log } from '../../utils/logger.js';
import { out, success, warn, error, dim, header, kv, json } from '../../utils/cli-output.js';

// ── shared helpers ────────────────────────────────────────

export interface SkillCommonOptions {
  /** Project root (defaults to cwd). */
  project?: string;
  json?: boolean;
}

export function skillEnv(options: SkillCommonOptions = {}): SkillEnv {
  return {
    rootDir: options.project ? path.resolve(options.project) : process.cwd(),
    homedir: os.homedir(),
  };
}

function fail(message: string): void {
  error(message);
  process.exitCode = 1;
}

/** Reject non-kebab ids before they reach any path join (path-traversal guard). */
function badId(id: string | undefined): boolean {
  if (id === undefined || isValidSkillId(id)) return false;
  fail(`Invalid skill id "${id}" (must be kebab-case: a-z, 0-9, single hyphens).`);
  return true;
}

/** paradigm_* tool definitions as the MCP server registers them (lazy: heavy import). */
export async function loadParadigmTools(rootDir: string): Promise<ToolLike[]> {
  const { listToolDefinitions } = await import('../../../../paradigm-mcp/src/tools/index.js');
  return listToolDefinitions(rootDir) as ToolLike[];
}

/** Read a `tools/list` JSON dump for third-party pin checks. Throws on unreadable/invalid JSON. */
export function loadToolsFile(file: string): ToolLike[] {
  const raw = fs.readFileSync(path.resolve(file), 'utf8');
  return parseToolsDump(JSON.parse(raw));
}

function hasParadigmPins(skill: SkillFile): boolean {
  return Object.keys(skill.metadata.paradigm.tools ?? {}).some(t => t.startsWith('paradigm_'));
}

interface Evaluated {
  skill: SkillFile;
  lint: LintIssue[];
  pins: PinReport;
  status: SkillStatus;
}

async function evaluate(
  skills: SkillFile[],
  env: SkillEnv,
  toolsFile?: string,
): Promise<Evaluated[]> {
  const externalTools = toolsFile ? loadToolsFile(toolsFile) : undefined;
  const paradigmTools = skills.some(hasParadigmPins) ? await loadParadigmTools(env.rootDir) : undefined;
  const ledger = loadSkillCertLedger(env);
  return skills.map(skill => {
    const lint = lintSkill(skill, env, { allSkills: skills });
    const pins = checkPins(skill, { paradigmTools, externalTools });
    return { skill, lint, pins, status: computeStatus(skill, { lint, pins, ledger }) };
  });
}

function printIssues(issues: LintIssue[]): void {
  for (const i of issues) {
    const where = i.line ? ` (body line ${i.line})` : '';
    const msg = `${i.code}${where}: ${i.message}`;
    if (i.level === 'error') error(`  ${msg}`);
    else warn(`  ${msg}`);
  }
}

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

function table(rows: string[][]): void {
  const widths = rows[0].map((_, c) => Math.max(...rows.map(r => (r[c] ?? '').length)));
  rows.forEach((r, i) => {
    const line = r.map((cell, c) => pad(cell, widths[c])).join('  ');
    if (i === 0) dim(line);
    else out(line);
  });
}

/** Skill ids an agent profile declares under `skills:` (project › global .agent). */
export function agentSkillIds(agentId: string, env: SkillEnv): string[] {
  const home = env.homedir ?? os.homedir();
  for (const file of [
    path.join(env.rootDir, '.paradigm', 'agents', `${agentId}.agent`),
    path.join(home, '.paradigm', 'agents', `${agentId}.agent`),
  ]) {
    try {
      if (!fs.existsSync(file)) continue;
      const data = yaml.load(fs.readFileSync(file, 'utf8')) as { skills?: Array<{ id?: unknown }> } | null;
      if (Array.isArray(data?.skills)) {
        return data!.skills.map(s => s?.id).filter((x): x is string => typeof x === 'string');
      }
      return [];
    } catch {
      // unreadable profile — fall through
    }
  }
  return [];
}

/** Scope column: `pack:<packId>` for pack skills, else the scope name. */
function scopeLabel(skill: SkillFile): string {
  return skill.scope === 'pack' ? `pack:${skill.packId ?? '?'}` : skill.scope;
}

// ── list ──────────────────────────────────────────────────

export interface SkillListOptions extends SkillCommonOptions {
  agent?: string;
}

export async function skillListCommand(options: SkillListOptions = {}): Promise<void> {
  const env = skillEnv(options);
  const { skills, invalid } = listSkillsDetailed(env);
  let selected = skills;
  if (options.agent) {
    const declared = new Set(agentSkillIds(options.agent, env));
    selected = skills.filter(s => s.metadata.paradigm.steward === options.agent || declared.has(s.metadata.paradigm.id));
  }
  const evaluated = await evaluate(selected, env);
  log.command('skill-list').info('Listed skills', { count: evaluated.length, invalid: invalid.length });

  if (options.json) {
    json({
      skills: evaluated.map(e => ({
        id: e.skill.metadata.paradigm.id,
        version: e.skill.metadata.paradigm.version,
        steward: e.skill.metadata.paradigm.steward,
        trust: e.skill.metadata.paradigm.trust,
        status: e.status,
        scope: e.skill.scope,
        ...(e.skill.packId ? { packId: e.skill.packId } : {}),
        pinsUnverified: e.pins.unverified,
        path: e.skill.dir,
      })),
      invalid,
    });
    return;
  }

  if (evaluated.length === 0 && invalid.length === 0) {
    dim(options.agent ? `No skills for agent "${options.agent}".` : 'No skills found. Run `paradigm skill sync-global` to install the bundled seeds.');
    return;
  }
  header(`Skills (${evaluated.length})`);
  if (evaluated.length > 0) {
    table([
      ['ID', 'VERSION', 'STEWARD', 'TRUST', 'STATUS', 'SCOPE'],
      ...evaluated.map(e => {
        const m = e.skill.metadata.paradigm;
        return [m.id, m.version, m.steward, m.trust, e.status + (e.pins.unverified ? '*' : ''), scopeLabel(e.skill)];
      }),
    ]);
  }
  if (evaluated.some(e => e.skill.scope === 'pack')) {
    dim('pack skills are read-only and external — `paradigm skill import <pack>:<id>` to adopt one');
  }
  if (evaluated.some(e => e.pins.unverified)) {
    warn('* pins unverified — third-party tool pins cannot be checked without `paradigm skill check <id> --tools <file>`');
  }
  for (const bad of invalid) {
    warn(`invalid source ${bad.id} (${bad.scope}): ${bad.error}`);
  }
}

// ── show ──────────────────────────────────────────────────

export async function skillShowCommand(id: string, options: SkillCommonOptions & { tools?: string } = {}): Promise<void> {
  if (badId(id)) return;
  const env = skillEnv(options);
  const skill = resolveSkill(id, env);
  if (!skill) return fail(`Skill "${id}" not found (project .paradigm/skills or ~/.paradigm/skills).`);
  const [e] = await evaluate([skill], env, options.tools);
  const m = skill.metadata.paradigm;

  if (options.json) {
    json({ ...m, name: skill.name, description: skill.description, scope: skill.scope, dir: skill.dir,
      status: e.status, contentHash: computeContentHash(skill), pins: e.pins, lint: e.lint });
    return;
  }

  header(`${m.id} @ ${m.version}`);
  kv('name', skill.name);
  kv('description', skill.description.replace(/\s+/g, ' ').trim());
  kv('steward', m.steward);
  kv('trust', m.trust);
  kv('status', e.status);
  kv('scope', `${scopeLabel(skill)} (${skill.dir})`);
  kv('key', skillKey(m.id, m.version));
  kv('content hash', computeContentHash(skill));
  kv('provenance', [m.provenance.source, `by ${m.provenance.createdBy}`, m.provenance.migratedFrom ? `migrated from ${m.provenance.migratedFrom}` : '']
    .filter(Boolean).join(', '));
  if (m.hosts?.length) kv('hosts', m.hosts.join(', '));
  if (m.triggers?.concepts?.length) kv('concepts', m.triggers.concepts.join(', '));
  if (m.certification) {
    kv('certified', `${m.certification.approvedBy} @ ${m.certification.approvedAt} in ${m.certification.project}`);
  }

  header('Tool pins');
  if (e.pins.results.length === 0) dim('  (none)');
  else table([['  TOOL', 'PIN', 'STATE'], ...e.pins.results.map(r => [`  ${r.tool}`, r.pin, r.state])]);

  header('Cited notebooks');
  if (!m.notebooks?.length) dim('  (none)');
  const missing = new Set(e.lint.filter(i => i.code === 'NOTEBOOK_MISSING').map(i => i.message));
  for (const nb of m.notebooks ?? []) {
    const isMissing = [...missing].some(msg => msg.endsWith(nb));
    if (isMissing) warn(`  ${nb} (missing)`);
    else out(`  ${nb}`);
  }
  if (m.protocols?.length) {
    header('Protocols');
    for (const p of m.protocols) out(`  ${p}`);
  }
  if (e.lint.length > 0) {
    header('Lint');
    printIssues(e.lint);
  }
}

// ── lint ──────────────────────────────────────────────────

export interface SkillLintOptions extends SkillCommonOptions {
  all?: boolean;
}

export async function skillLintCommand(id: string | undefined, options: SkillLintOptions = {}): Promise<void> {
  if (badId(id)) return;
  const env = skillEnv(options);
  const { skills: all, invalid } = listSkillsDetailed(env);
  let targets: SkillFile[];
  if (options.all || !id) {
    targets = all;
  } else {
    const s = resolveSkill(id, env);
    if (!s) return fail(`Skill "${id}" not found.`);
    targets = [s];
  }

  const results = targets.map(skill => ({ skill, issues: lintSkill(skill, env, { allSkills: all }) }));
  const errorCount = results.reduce((n, r) => n + r.issues.filter(i => i.level === 'error').length, 0)
    + ((options.all || !id) ? invalid.length : 0);
  log.command('skill-lint').info('Linted skills', { count: targets.length, errors: errorCount });

  if (options.json) {
    json({ results: results.map(r => ({ id: r.skill.metadata.paradigm.id, issues: r.issues })), invalid });
  } else {
    if (targets.length === 0 && invalid.length === 0) dim('No skills to lint.');
    for (const r of results) {
      const m = r.skill.metadata.paradigm;
      if (r.issues.length === 0) success(`${m.id}@${m.version} — clean`);
      else if (!hasLintErrors(r.issues)) warn(`${m.id}@${m.version} — ${r.issues.length} warning(s)`);
      else error(`${m.id}@${m.version} — ${r.issues.filter(i => i.level === 'error').length} error(s)`);
      printIssues(r.issues);
    }
    if (options.all || !id) for (const bad of invalid) error(`invalid source ${bad.id} (${bad.scope}): ${bad.error}`);
  }
  if (errorCount > 0) process.exitCode = 1;
}

// ── check (pins) ──────────────────────────────────────────

export async function skillCheckCommand(id: string, options: SkillCommonOptions & { tools?: string } = {}): Promise<void> {
  if (badId(id)) return;
  const env = skillEnv(options);
  const skill = resolveSkill(id, env);
  if (!skill) return fail(`Skill "${id}" not found.`);
  let externalTools: ToolLike[] | undefined;
  try {
    externalTools = options.tools ? loadToolsFile(options.tools) : undefined;
  } catch (err) {
    return fail(`Could not read --tools file: ${(err as Error).message}`);
  }
  const paradigmTools = await loadParadigmTools(env.rootDir);
  const pins = checkPins(skill, { paradigmTools, externalTools });
  log.command('skill-check').info('Checked pins', { id, stale: pins.stale, unverified: pins.unverified });

  if (options.json) {
    json(pins);
  } else {
    header(`Tool pins — ${id}`);
    if (pins.results.length === 0) dim('  (no pinned tools)');
    else table([['  TOOL', 'PIN', 'STATE', 'ACTUAL'], ...pins.results.map(r => [`  ${r.tool}`, r.pin, r.state, r.actual ?? ''])]);
    if (pins.stale) error('STALE — a pinned paradigm tool changed or disappeared; re-pin before projecting.');
    else if (pins.unverified) warn('Some pins are unverified (third-party tools). Pass `--tools <tools/list dump>` to check them.');
    else success('All checkable pins match.');
  }
  if (pins.stale) process.exitCode = 1;
}

function hasScripts(id: string, env: SkillEnv): boolean {
  const skill = resolveSkill(id, env);
  return !!skill && listSkillScripts(skill).length > 0;
}

const PROJECT_FIX: Record<string, string> = {
  'invalid-id': 'use a kebab-case skill id',
  'id-mismatch': 'the SKILL.md metadata.paradigm.id must equal its directory name',
  'not-found': '`paradigm skill list` to see available skills (or `paradigm skill sync-global`)',
  lint: '`paradigm skill lint <id>` and fix the errors',
  stale: '`paradigm skill check <id>` and re-pin the changed tools',
  untrusted: 'certify it (`paradigm skill certify <id>`) or pass --allow-provisional (pack skills: `paradigm skill import <pack>:<id>` first)',
  synced: 'never project into ~/.claude/skills/synced/ — choose another target',
  'not-ours': 'the destination was not created by Paradigm — move it aside first',
  drifted: 'the projection was edited downstream — `paradigm skill adopt <id>` to pull the edits back',
};

// ── project ───────────────────────────────────────────────

export interface SkillProjectOptions extends SkillCommonOptions {
  all?: boolean;
  target?: string;
  allowProvisional?: boolean;
  dryRun?: boolean;
  tools?: string;
}

export async function skillProjectCommand(id: string | undefined, options: SkillProjectOptions = {}): Promise<void> {
  if (badId(id)) return;
  const env = skillEnv(options);
  const target = (options.target ?? 'user') as 'user' | 'project';
  if (target !== 'user' && target !== 'project') return fail(`--target must be "user" or "project" (got "${options.target}")`);
  if (!id && !options.all) return fail('Specify a skill id or --all.');

  let externalTools: ToolLike[] | undefined;
  try {
    externalTools = options.tools ? loadToolsFile(options.tools) : undefined;
  } catch (err) {
    return fail(`Could not read --tools file: ${(err as Error).message}`);
  }
  const paradigmTools = await loadParadigmTools(env.rootDir);
  // --all never includes pack skills (read-only, external — they never project).
  const ids = options.all
    ? listSkillsDetailed(env).skills.filter(s => s.scope !== 'pack').map(s => s.metadata.paradigm.id)
    : [id!];

  const results = ids.map(sid => projectSkill(sid, {
    env, target, allowProvisional: !!options.allowProvisional, dryRun: !!options.dryRun, paradigmTools, externalTools,
  }));
  log.command('skill-project').info('Projected skills', {
    count: results.length, ok: results.filter(r => r.ok).length, dryRun: !!options.dryRun,
  });

  if (options.json) {
    json(results);
  } else {
    for (const r of results) {
      if (r.ok) {
        const tag = r.dryRun ? 'would project' : r.unchanged ? 'unchanged' : 'projected';
        success(`${r.skillId} — ${tag} → ${r.dest}${r.banner ? ' (PROVISIONAL banner)' : ''}`);
        if (r.marker?.pinsUnverified) warn('  pins unverified (third-party tools not checked)');
        if ((r.scriptsWithheld ?? r.marker?.scriptsWithheld) && hasScripts(r.skillId, env)) {
          warn('  scripts/ withheld — only certified skills project executables');
        }
        if (r.dryRun && r.files?.length) dim(`  files: ${r.files.join(', ')}`);
      } else {
        error(`${r.skillId} — refused (${r.refused}): ${r.message}`);
        if (r.lint.length) printIssues(r.lint);
        const hint = r.refused ? PROJECT_FIX[r.refused] : undefined;
        if (hint) dim(`  fix: ${hint}`);
      }
    }
  }
  if (results.some(r => !r.ok)) process.exitCode = 1;
}

// ── adopt ──────────────────────────────────────────────

export interface SkillAdoptOptions extends SkillCommonOptions {
  target?: string;
  /** Adopt even though the source changed since projection. */
  force?: boolean;
  /** Accept a downstream widening of allowed-tools (required when not on a TTY). */
  confirmAllowedTools?: boolean;
}

export interface AdoptDeps {
  tty?: boolean;
  prompt?: (question: string) => Promise<string>;
}

const ADOPT_FIX: Record<string, string> = {
  'source-changed': 'the source changed since projection — re-run with --force to let the downstream edits win',
  'allowed-tools-widened': 're-run on a TTY and type the id, or pass --confirm-allowed-tools after reviewing the added tools',
  symlink: 'the projected dir contains a symlink — replace it with a regular file, then re-run',
  'invalid-version': 'the source version is not semver — fix metadata.paradigm.version',
  'id-mismatch': 'the projected metadata paradigm-id does not match — re-project with `paradigm skill project <id>`',
  'invalid-id': 'use a kebab-case skill id',
  'not-found': 'no source for this id — `paradigm skill list`',
  'not-projected': 'nothing projected yet — `paradigm skill project <id>` first',
  'not-ours': 'the destination has no Paradigm marker — it was not projected by Paradigm',
  'no-changes': 'the projection matches the source — nothing to adopt',
  'invalid-projection': 'the projected SKILL.md does not parse — fix or re-project it',
};

function printAdoptDiff(r: AdoptResult): void {
  if (r.diff && (r.diff.added.length + r.diff.removed.length + r.diff.modified.length) > 0) {
    header('Files');
    for (const f of r.diff.added) out(`  + ${f}`);
    for (const f of r.diff.removed) out(`  - ${f}`);
    for (const f of r.diff.modified) out(`  ~ ${f}`);
  }
  const fd = r.frontmatterDiff;
  if (fd?.description) {
    header('description');
    dim(`  - ${fd.description.from}`);
    out(`  + ${fd.description.to}`);
  }
  if (fd?.allowedTools) {
    const at = fd.allowedTools;
    header(`allowed-tools${at.widened ? ' (WIDENED)' : ''}`);
    kv('from', at.from ?? '(unset — host default)');
    kv('to', at.to ?? '(unset — host default)');
    if (at.added.length) warn(`  added: ${at.added.join(', ')}`);
    if (at.removed.length) dim(`  removed: ${at.removed.join(', ')}`);
  }
}

function ttyQuestion(question: string): Promise<string> {
  return new Promise(resolve => {
    import('readline').then(readline => {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(question, answer => { rl.close(); resolve(answer); });
    }).catch(() => resolve(''));
  });
}

export async function skillAdoptCommand(id: string, options: SkillAdoptOptions = {}, deps: AdoptDeps = {}): Promise<boolean> {
  if (badId(id)) return false;
  const env = skillEnv(options);
  const target = (options.target ?? 'user') as 'user' | 'project';
  const base = { env, target, force: !!options.force, confirmAllowedTools: !!options.confirmAllowedTools };
  let r = adoptSkill(id, base);

  // Widened allowed-tools: interactive confirmation on a TTY, else the flag is required.
  if (!r.ok && r.refused === 'allowed-tools-widened') {
    const tty = deps.tty ?? !!process.stdin.isTTY;
    if (!options.json) printAdoptDiff(r);
    if (tty && !options.json) {
      warn('The downstream edit WIDENS allowed-tools — the skill could run tools it was not granted.');
      const answer = (await (deps.prompt ?? ttyQuestion)(`Type the skill id (${id}) to accept the wider allowed-tools: `)).trim();
      if (answer === id) r = adoptSkill(id, { ...base, confirmAllowedTools: true });
      else r = { ...r, message: 'allowed-tools widening not confirmed — nothing adopted' };
    } else {
      r = { ...r, message: `${r.message} (non-interactive: pass --confirm-allowed-tools)` };
    }
  }
  log.command('skill-adopt').info('Adopt', { id, ok: r.ok, refused: r.refused });

  if (options.json) {
    json({ ...r, skill: r.skill ? { dir: r.skill.dir, version: r.skill.metadata.paradigm.version } : undefined });
  } else if (r.ok) {
    success(`${id}: adopted downstream edits ${r.fromVersion} → ${r.toVersion} (provisional)`);
    if (r.archivedTo) kv('archived', r.archivedTo);
    printAdoptDiff(r);
    if (r.reprojected === false) warn('  adopted source has lint errors — projection left as-is until fixed');
    dim('  Re-certify with `paradigm skill certify` before it projects without --allow-provisional.');
  } else {
    if (r.refused !== 'allowed-tools-widened') printAdoptDiff(r);
    error(`${id}: adopt refused (${r.refused}): ${r.message}`);
    const hint = r.refused ? ADOPT_FIX[r.refused] : undefined;
    if (hint) dim(`  fix: ${hint}`);
  }
  if (!r.ok) process.exitCode = 1;
  return r.ok;
}

// ── import (pack skill → provisional copy) ─────────────

export interface SkillImportOptions extends SkillCommonOptions {
  /** Import into ~/.paradigm/skills instead of the project. */
  global?: boolean;
}

export interface ImportDeps {
  tty?: boolean;
  prompt?: (question: string) => Promise<string>;
  /** Injected in tests (never touch the real home directory). */
  homedir?: string;
  globalDir?: string;
}

/**
 * `paradigm skill import <packId>:<id> [--global]` — the ONLY way a pack skill
 * leaves the read-only `pack` scope. Interactive TTY only: shows allowed-tools
 * and the scripts/ list, requires the id typed back, then copies the skill as
 * trust provisional / provenance.source pack. Returns true on import.
 */
export async function skillImportCommand(ref: string, options: SkillImportOptions = {}, deps: ImportDeps = {}): Promise<boolean> {
  const m = /^([^:\s]+):([^:\s]+)$/.exec(ref ?? '');
  if (!m) { fail(`Expected <pack-id>:<skill-id> (got "${ref}").`); return false; }
  const [, packId, id] = m;
  if (badId(id)) return false;

  const tty = deps.tty ?? !!process.stdin.isTTY;
  if (!tty) {
    fail('`paradigm skill import` requires an interactive terminal (human confirmation). Refusing.');
    log.command('skill-import').warn('Refused non-TTY import', { packId, id });
    return false;
  }

  const env: SkillEnv = {
    ...skillEnv(options),
    ...(deps.homedir ? { homedir: deps.homedir } : {}),
    ...(deps.globalDir ? { globalDir: deps.globalDir } : {}),
  };
  const entry = findPackSkill(packId, id, env);
  if (!entry) { fail(`Pack skill "${packId}:${id}" not found (\`paradigm skill list\` shows pack skills).`); return false; }

  const skill = entry.skill;
  // Hash what the human reviews; importPackSkill refuses if the pack changes before the copy.
  const expectedHash = computeContentHash(skill);
  const scope = options.global ? 'global' : 'project';
  header(`Import ${packId}:${id} @ ${skill.metadata.paradigm.version} → ${scope}`);
  kv('description', skill.description.replace(/\s+/g, ' ').trim());
  kv('allowed-tools', skill['allowed-tools'] ?? '(unset — host default)');
  const scripts = listSkillScripts(skill);
  if (scripts.length === 0) {
    kv('scripts', '(none)');
  } else {
    warn(`scripts/ (${scripts.length}) — executables the skill ships:`);
    for (const sc of scripts) out(`  ${sc.path}  ${sc.bytes}B  sha256:${sc.sha256.slice(0, 16)}`);
  }
  dim('The copy is trust provisional (provenance.source: pack); certify it before it projects without --allow-provisional.');

  const answer = (await (deps.prompt ?? ttyQuestion)(`Type the skill id (${id}) to import it: `)).trim();
  if (answer !== id) {
    warn('Not confirmed — nothing imported.');
    log.command('skill-import').info('Import not confirmed', { packId, id });
    return false;
  }

  const r = importPackSkill(packId, id, { env, scope, expectedHash });
  log.command('skill-import').info('Import', { packId, id, scope, ok: r.ok, refused: r.refused });
  if (!r.ok) { fail(`${packId}:${id}: import refused (${r.refused}): ${r.message}`); return false; }
  success(`${r.message} → ${r.dest}`);
  return true;
}

// ── record-usage (hidden; PostToolUse `Skill` hook) ──────

/**
 * Record a host Skill invocation. Input is the Claude Code hook payload
 * (`{tool_name:'Skill', tool_input:{skill:'pdg-<id>'}, cwd}`). Never throws,
 * never prints, never sets a failing exit code — a hook must not fail loudly.
 * Returns true when a row was appended.
 */
export function recordSkillUsageFromHook(payload: unknown, opts: { homedir?: string } = {}): boolean {
  try {
    const p = payload as { tool_name?: unknown; tool_input?: { skill?: unknown }; cwd?: unknown } | null;
    if (!p || p.tool_name !== 'Skill') return false;
    const name = p.tool_input?.skill;
    if (typeof name !== 'string') return false;
    // CLAUDE_PROJECT_DIR (set by the host) wins over the payload's cwd, which
    // follows the session's working directory and may be a subdirectory.
    const rootDir = resolveHookProjectDir({
      env: process.env,
      payloadCwd: typeof p.cwd === 'string' ? p.cwd : undefined,
    }) ?? process.cwd();
    if (!fs.existsSync(path.join(rootDir, '.paradigm'))) return false;
    const row = buildSkillUsageRow(name, {
      rootDir,
      homedir: opts.homedir ?? os.homedir(),
      host: 'claude-code',
      agent: process.env.PARADIGM_AGENT || undefined,
      orchestrationId: process.env.PARADIGM_ORCHESTRATION_ID || undefined,
    });
    if (!row) return false;
    appendSkillUsage(rootDir, row);
    return true;
  } catch {
    return false;
  }
}

export async function skillRecordUsageCommand(): Promise<void> {
  try {
    if (process.stdin.isTTY) return; // no hook payload
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) return;
    recordSkillUsageFromHook(JSON.parse(raw));
  } catch {
    // silent by contract
  }
}
