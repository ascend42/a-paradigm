/**
 * #warpline-root — THE ROOT CHOKEPOINT (soundness audit D-7).
 *
 * Every skin used to resolve its target repository as
 * `await repoRoot().catch(() => process.cwd())`, inline, at ~31 independent
 * call sites. `repoRoot()` shells `git rev-parse --show-toplevel`, so the
 * `process.cwd()` fallback fires ONLY when git fails — which means every
 * command, including every experiment anyone runs while learning the tool,
 * targeted the LIVE fabric by default. There was no `--root` and no
 * `WARPLINE_ROOT`. That is why every agent auditing this system had to be
 * handed explicit `os.tmpdir()` discipline, and it is a hard prerequisite for
 * the F4 runner (whose fixtures live inside the repo — the moment a scratch
 * FABRIC lands there, root resolves to the live one and stages strands into it
 * silently).
 *
 * The fix is a chokepoint, not 31 patches: a per-site fix is how the 32nd site
 * gets missed. Every write verb resolves its root through `resolveRoot()`.
 *
 * PRECEDENCE (explicit beats inference, always):
 *   1. `--root <dir>`      an explicit flag, anywhere on the command line
 *   2. `WARPLINE_ROOT`     an explicit environment variable
 *   3. `repoRoot()`        `git rev-parse --show-toplevel`
 *   4. `process.cwd()`     git absent or not a repo
 *
 * With neither 1 nor 2 set, behaviour is byte-identical to the pre-D-7 code.
 *
 * An explicit root must ALREADY EXIST and be a real directory: a typo must
 * refuse, never silently mint a second fabric somewhere.
 *
 * Library code: no console output — the CLI prints.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { repoRoot } from './git/git-exec.js';

/** The environment variable that overrides `repoRoot()` (precedence 2). */
export const ROOT_ENV = 'WARPLINE_ROOT';

/** The explicit `--root` value for this process, once parsed (precedence 1). */
let explicitRoot: string | null = null;

/**
 * Record the explicit `--root` for this process. Passing null/undefined clears
 * it (tests). The value is resolved to an absolute path and validated eagerly
 * so a typo refuses at argument-parse time, not halfway through a write.
 */
export function setExplicitRoot(dir: string | null | undefined): void {
  explicitRoot = dir === null || dir === undefined ? null : assertUsableRoot(dir, '--root');
}

/** The explicit `--root` in force, or null. Absolute when set. */
export function explicitRootOf(): string | null {
  return explicitRoot;
}

/**
 * WHICH arm of the precedence chain above actually decided the root.
 *   'flag' `--root <dir>`   (1) explicit, on the command line
 *   'env'  `WARPLINE_ROOT`  (2) explicit, in the environment
 *   'git'  `repoRoot()`     (3) inferred from git
 *   'cwd'  `process.cwd()`  (4) git absent or not a repo — the SILENT fallback
 */
export type RootArm = 'flag' | 'env' | 'git' | 'cwd';

/** A resolved root together with the arm that produced it. */
export interface RootResolution {
  root: string;
  arm: RootArm;
}

/**
 * Resolve the root AND report which arm won.
 *
 * The path alone is not the interesting fact. "I passed --root and it took" and
 * "it silently fell through to the git root, which happens to be correct today"
 * print the same string, and only the second is D-7 — the defect where every
 * command targeted the live fabric by default and no surface said so. A reader
 * that cannot distinguish them cannot catch the recurrence.
 */
export async function resolveRootVerbose(): Promise<RootResolution> {
  if (explicitRoot !== null) return { root: explicitRoot, arm: 'flag' };
  const fromEnv = process.env[ROOT_ENV];
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return { root: assertUsableRoot(fromEnv, `${ROOT_ENV}`), arm: 'env' };
  }
  return repoRoot()
    .then((root): RootResolution => ({ root, arm: 'git' }))
    .catch((): RootResolution => ({ root: process.cwd(), arm: 'cwd' }));
}

/**
 * Resolve the repository root every verb operates on, honouring the precedence
 * above. THE one place any skin may ask "which fabric?".
 *
 * Kept as the one-line projection of `resolveRootVerbose` ON PURPOSE: adding
 * the arm must not become a reason to touch ~31 call sites, which is the
 * per-site drift D-7 was a chokepoint against in the first place.
 */
export async function resolveRoot(): Promise<string> {
  return (await resolveRootVerbose()).root;
}

/**
 * Absolutize and validate an explicit root. Fails closed on a path that does
 * not exist or is not a real directory — an explicit target that isn't there is
 * a typo, and silently creating it is exactly the class of accident D-7 is
 * about.
 */
function assertUsableRoot(dir: string, source: string): string {
  const abs = path.resolve(dir);
  let st: fs.Stats;
  try {
    st = fs.lstatSync(abs);
  } catch {
    throw new Error(`warpline: ${source} ${abs} does not exist (create it first — an explicit root is never auto-created)`);
  }
  if (st.isSymbolicLink() || !st.isDirectory()) {
    throw new Error(`warpline: ${source} ${abs} is not a real directory`);
  }
  return abs;
}

/**
 * Pull `--root <dir>` / `--root=<dir>` out of a user argv, wherever it appears.
 *
 * Commander only accepts program-level options BEFORE the subcommand, and
 * `warpline pick --root /tmp/x` failing with "unknown option" is exactly the
 * kind of papercut that sends a user back to the unguarded default. Extracting
 * it here makes the flag positional-agnostic; the program-level registration in
 * cli.ts exists so it appears in `--help`.
 *
 * A bare `--` terminates scanning: everything after it is data.
 */
export function extractRootFlag(argv: readonly string[]): { argv: string[]; root: string | null } {
  const out: string[] = [];
  let root: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--') {
      out.push(...argv.slice(i));
      break;
    }
    if (a === '--root') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('-')) {
        throw new Error('warpline: --root needs a directory argument');
      }
      root = value;
      i++;
      continue;
    }
    if (a.startsWith('--root=')) {
      const value = a.slice('--root='.length);
      if (value === '') throw new Error('warpline: --root needs a directory argument');
      root = value;
      continue;
    }
    out.push(a);
  }
  return { argv: out, root };
}
