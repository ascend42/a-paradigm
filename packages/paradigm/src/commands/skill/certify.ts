/**
 * paradigm skill certify — $skill-certification founder sign-off (#skill-cli).
 *
 * CLI-only BY DESIGN: certification requires an interactive TTY and the founder
 * typing the skill id. It is never exposed as an MCP tool, so agents cannot
 * self-certify. Preconditions (all checked by #skill-loader evaluateCertification):
 *   - lint clean, no stale tool pin, not already certified;
 *   - ≥1 scenario with a `fixture`, a NON-steward probe whose learning_ref is
 *     exactly `skill:<id>@<version>`, expected.must = survive, and a
 *     human-confirmed `survived` outcome for that same key.
 * On success: writes the `certification` block + trust certified into the
 * source SKILL.md and appends a kind:'skill' row to the classroom certs ledger.
 * Certification is GLOBAL (founder resolution); `project` is recorded.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';

import {
  resolveSkill,
  lintSkill,
  checkPins,
  evaluateCertification,
  applyCertification,
  buildSkillCertRow,
  writeSkill,
  listSkills,
  listSkillScripts,
  loadSkillCertLedger,
  appendGlobalSkillCertRow,
  isValidSkillId,
  type ToolLike,
} from '../../../../paradigm-mcp/src/utils/skill-loader.js';
import type { SkillFile } from '../../../../paradigm-mcp/src/types/skills.js';
import { loadScenarios, type Scenario } from '../../../../paradigm-mcp/src/utils/scenario-loader.js';
import { appendClassroomCertification } from '../../../../paradigm-mcp/src/utils/field-failures.js';

import { log } from '../../utils/logger.js';
import { out, success, warn, error, dim, header, kv } from '../../utils/cli-output.js';
import { skillEnv, loadParadigmTools, loadToolsFile, type SkillCommonOptions } from './index.js';

export interface SkillCertifyOptions extends SkillCommonOptions {
  scenario?: string[];
  tools?: string;
}

/** Injectable seams so the TTY gate and prompt are testable. */
export interface CertifyDeps {
  tty?: boolean;
  founder?: string;
  prompt?: (question: string) => Promise<string>;
  paradigmTools?: ToolLike[];
  now?: Date;
}

export const CERTIFICATION_POSTURE =
  'Certification is drift-detection, not tamper-proof; signing is a planned follow-up.';

export interface SkillScriptPreview {
  /** Path relative to the skill dir (always under scripts/). */
  name: string;
  /** sha256:<hex> of the file bytes. */
  hash: string;
  bytes: number;
  /** First lines of the file (at most `maxLines`). */
  head: string[];
  totalLines: number;
}

/**
 * Every scripts/ file (via #skill-loader listSkillScripts) with its hash and
 * first lines — shown to the founder BEFORE the confirmation prompt, because a
 * certified skill projects its scripts/ into the host (sign off on what executes).
 */
export function previewSkillScripts(skill: SkillFile, maxLines = 20): SkillScriptPreview[] {
  return listSkillScripts(skill).map(f => {
    let lines: string[] = [];
    try {
      lines = fs.readFileSync(path.join(skill.dir, f.path), 'utf8').split(/\r?\n/);
    } catch {
      // unreadable — show hash only
    }
    return { name: f.path, hash: `sha256:${f.sha256}`, bytes: f.bytes, head: lines.slice(0, maxLines), totalLines: lines.length };
  });
}

/** Founder identity = git user.name (falls back to the OS username). */
export function founderName(): string {
  try {
    const name = execSync('git config user.name', { encoding: 'utf-8', timeout: 3000 }).trim();
    if (name) return name;
  } catch {
    // git missing / unconfigured
  }
  try {
    return os.userInfo().username;
  } catch {
    return '';
  }
}

function ttyPrompt(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

/** Returns true when the skill was certified. */
export async function skillCertifyCommand(
  id: string,
  options: SkillCertifyOptions = {},
  deps: CertifyDeps = {},
): Promise<boolean> {
  const env = skillEnv(options);
  const tty = deps.tty ?? !!process.stdin.isTTY;
  const refuse = (msg: string): boolean => {
    error(msg);
    process.exitCode = 1;
    log.command('skill-certify').warn('Certification refused', { id, reason: msg });
    return false;
  };

  // TTY gate first — before any other work (agents never reach the prompt).
  if (!tty) return refuse('`paradigm skill certify` requires an interactive terminal (founder sign-off). Refusing.');

  if (!isValidSkillId(id)) return refuse(`Invalid skill id "${id}" (must be kebab-case).`);
  const skill = resolveSkill(id, env);
  if (!skill) return refuse(`Skill "${id}" not found.`);

  let externalTools: ToolLike[] | undefined;
  try {
    externalTools = options.tools ? loadToolsFile(options.tools) : undefined;
  } catch (err) {
    return refuse(`Could not read --tools file: ${(err as Error).message}`);
  }
  const paradigmTools = deps.paradigmTools ?? await loadParadigmTools(env.rootDir);
  const lint = lintSkill(skill, env, { allSkills: listSkills(env) });
  const pins = checkPins(skill, { paradigmTools, externalTools });

  let scenarios: Scenario[] = await loadScenarios(env.rootDir);
  if (options.scenario?.length) {
    const wanted = new Set(options.scenario);
    const missing = [...wanted].filter(s => !scenarios.some(sc => sc.id === s));
    if (missing.length) return refuse(`Scenario(s) not found: ${missing.join(', ')}`);
    scenarios = scenarios.filter(sc => wanted.has(sc.id));
  }

  const founder = deps.founder ?? founderName();
  const project = path.basename(env.rootDir);
  const ledger = loadSkillCertLedger(env);
  const base = { env, ledger, founder, tty, project, lint, pins, now: deps.now };

  // Pass 1 — every precondition except the typed confirmation.
  const pre = evaluateCertification(skill, scenarios, base);
  const meta = skill.metadata.paradigm;
  header(`Certify ${pre.entryId}`);
  kv('steward', meta.steward);
  kv('approver', founder || '(unknown)');
  for (const q of pre.qualifying) out(`  ✓ scenario ${q}`);
  for (const r of pre.rejected) dim(`  ✗ scenario ${r.id}: ${r.why}`);
  if (!pre.ok) {
    for (const r of pre.reasons) warn(`  ${r}`);
    return refuse(`Cannot certify ${pre.entryId}.`);
  }

  // Show exactly what will execute once certified: every scripts/ file.
  const scripts = previewSkillScripts(skill);
  header(`scripts/ (${scripts.length} file${scripts.length === 1 ? '' : 's'})`);
  if (scripts.length === 0) dim('  (none — prose-only skill)');
  for (const sc of scripts) {
    out(`  ${sc.name}  ${sc.hash}`);
    for (const line of sc.head) dim(`    │ ${line}`);
    if (sc.totalLines > sc.head.length) dim(`    │ … ${sc.totalLines - sc.head.length} more line(s)`);
  }
  warn(CERTIFICATION_POSTURE);

  // Pass 2 — founder types the skill id.
  const typed = await (deps.prompt ?? ttyPrompt)(`Type the skill id (${meta.id}) to certify it globally: `);
  const final = evaluateCertification(skill, scenarios, { ...base, confirmation: typed });
  if (!final.ok || !final.certification) {
    for (const r of final.reasons) warn(`  ${r}`);
    return refuse('Certification aborted.');
  }

  const certified = applyCertification(skill, final.certification);
  const file = writeSkill(certified);
  const row = buildSkillCertRow(certified, final.certification);
  // Both ledgers: project classroom certs + the global skill ledger that
  // isCertificationValid cross-checks from any project.
  appendClassroomCertification(env.rootDir, row);
  appendGlobalSkillCertRow(env, row);
  log.command('skill-certify').info('Skill certified', {
    entryId: final.entryId, approvedBy: final.certification.approvedBy, scenarios: final.qualifying,
  });
  success(`${final.entryId} certified by ${final.certification.approvedBy}`);
  kv('source', file);
  kv('content hash', final.certification.contentHash);
  dim('  Project it with `paradigm skill project ' + meta.id + '`.');
  return true;
}
