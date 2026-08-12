/**
 * #warpline-init — THE ONBOARDING VERB (T-2026-08-12-002, cold-agent dogfood).
 *
 * A new project was usable on Warpline only by knowing that the FIRST
 * `pick`/`propose` silently bootstraps genesis — an undiscoverable ritual. `init`
 * makes onboarding one explicit, idempotent command:
 *
 *   1. SEAL GENESIS via the native path (proposeNative → admitNative fast-forwards
 *      refs/heads/selvage), so the fabric exists and `status` has a base to diff
 *      against — git ABSENT (this is native-first; git is optional).
 *   2. WRITE A STARTER `.warpignore` (only when absent) — Warpline's own,
 *      git-independent ignore file, with commented examples so the syntax is
 *      visible. Built-in defaults (.git/.warpline/.warpline-judge/node_modules)
 *      are implicit in the handler; the file is for the user's own rules.
 *   3. KEEP `.warpline/` OUT OF GIT: append `.warpline/` + `.warpline-judge/` to
 *      an existing `.gitignore` (idempotent — never duplicated), or create one
 *      when the project looks like a git repo (a `.git` is present). Warpline
 *      still writes THIS git line so a coexisting `git add -A` never swallows the
 *      fabric — but its OWN skips are governed by `.warpignore`, never git.
 *
 * IDEMPOTENT: re-running on an initialized project seals no second genesis and
 * duplicates no line — it reports `alreadyInitialized` and re-asserts the
 * ignore files. Library code: no console output (the CLI prints the next steps).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { warplineDirOf, readSelvage } from './fabric.js';
import { readRef } from './refs.js';
import { proposeNative, admitNative } from './native.js';
import { WARPIGNORE_FILE } from '../warp/warpignore.js';

/** The identity that seals the genesis strand (an onboarding act, not an agent's work). */
const INIT_ACTOR = 'warpline-init' as const;

/** The git lines Warpline keeps present so git never swallows the fabric. */
const GITIGNORE_LINES = ['.warpline/', '.warpline-judge/'] as const;
const GITIGNORE_BANNER = '# Warpline — never let git swallow the native fabric' as const;

/** The starter `.warpignore` — defaults are implicit; the examples teach the syntax. */
const WARPIGNORE_STARTER = [
  '# .warpignore — Warpline\'s native ignore file (governs what Warpline skips; git-independent).',
  '# gitignore-style syntax. The defaults .git, .warpline, .warpline-judge and node_modules are',
  '# ALWAYS skipped at any depth and need no entry here. Add your own below — for example:',
  '# dist/',
  '# *.log',
  '',
].join('\n');

export interface InitResult {
  root: string;
  /** true when a selvage already existed — no second genesis was sealed. */
  alreadyInitialized: boolean;
  /** the genesis strand's pickId when newly sealed; null when already initialized. */
  genesisPickId: string | null;
  /** true when a starter `.warpignore` was written (absent before). */
  warpignoreWritten: boolean;
  /** what happened to `.gitignore`. */
  gitignore: { action: 'created' | 'appended' | 'present' | 'skipped'; addedLines: string[] };
}

/** Ensure `.warpline/` + `.warpline-judge/` are git-ignored, idempotently. */
function ensureGitignore(root: string): InitResult['gitignore'] {
  const gp = path.join(root, '.gitignore');
  let current: string | null = null;
  try {
    if (fs.statSync(gp).isFile()) current = fs.readFileSync(gp, 'utf8');
  } catch {
    current = null;
  }
  if (current !== null) {
    const present = new Set(current.split(/\r?\n/).map((l) => l.trim()));
    const toAdd = GITIGNORE_LINES.filter((l) => !present.has(l));
    if (toAdd.length === 0) return { action: 'present', addedLines: [] };
    const sep = current.length > 0 && !current.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(gp, `${sep}${GITIGNORE_BANNER}\n${toAdd.join('\n')}\n`, 'utf8');
    return { action: 'appended', addedLines: [...toAdd] };
  }
  // No `.gitignore`: create one only when the project LOOKS LIKE a git repo — a
  // pure native project has no git to defend the fabric from.
  if (fs.existsSync(path.join(root, '.git'))) {
    fs.writeFileSync(gp, `${GITIGNORE_BANNER}\n${GITIGNORE_LINES.join('\n')}\n`, 'utf8');
    return { action: 'created', addedLines: [...GITIGNORE_LINES] };
  }
  return { action: 'skipped', addedLines: [] };
}

/**
 * Initialize a project onto Warpline. Idempotent — safe to re-run.
 *
 * ORDER IS LOAD-BEARING: `.warpignore` is written BEFORE genesis is sealed, so
 * the genesis snapshot already honors it (a `dist/` the user uncomments after
 * init is respected on the next seal; the starter is all-comments so it changes
 * nothing today, but the ordering is the contract).
 */
export async function initWarpline(root: string, opts: { worktree?: string } = {}): Promise<InitResult> {
  const worktree = opts.worktree ?? root;
  const wdir = warplineDirOf(root);
  const alreadyInitialized = readRef(wdir, 'selvage') !== null || readSelvage(wdir) !== null;

  // 1. Starter `.warpignore` (only when absent — init ONLY ever writes .warpignore).
  const warpignorePath = path.join(root, WARPIGNORE_FILE);
  let warpignoreWritten = false;
  if (!fs.existsSync(warpignorePath)) {
    fs.writeFileSync(warpignorePath, WARPIGNORE_STARTER, 'utf8');
    warpignoreWritten = true;
  }

  // 2. Genesis — only when the fabric has no selvage yet.
  let genesisPickId: string | null = null;
  if (!alreadyInitialized) {
    const proposed = await proposeNative(root, {
      worktree,
      agentId: INIT_ACTOR,
      intent: 'warpline init — genesis fabric',
      actor: INIT_ACTOR,
    });
    // A truly empty worktree still seals a (zero-object) genesis strand; only a
    // pre-existing selvage yields noop, and that path is guarded above.
    const admitted = await admitNative(root, { worktree, agentId: INIT_ACTOR, noRestore: true });
    genesisPickId = admitted.strand?.pickId ?? proposed.strand?.pickId ?? null;
  }

  // 3. Keep the fabric out of git.
  const gitignore = ensureGitignore(root);

  return { root, alreadyInitialized, genesisPickId, warpignoreWritten, gitignore };
}
