/**
 * @symbol #kernel-sea
 *
 * #kernel-sea (TD-2026-10-29-746, spec P8-D68 amended, G-ID-13) — the kernel as a signed Node Single Executable
 * Application, `gnomon.kernel` (code identifier gnomon.kernel, team SW4BMQ8PNL, hardened runtime, no get-task-allow;
 * scripts/build-sea.mjs). The helper certifies only a kernel it can identify by code signature, which `node` + a
 * script never is.
 *
 * Under the SEA, process.execPath IS the kernel. A child spawned with it would run the kernel again (its argv is
 * kernel CLI args, never a script), so every node child — sessions' PATH head, the MCP pool's first-party server,
 * gnomon-web, mods, the voice client and model fetch, the local runner, loop checks — runs `childNodePath()`: the
 * signed `gnomon.node`. Only the kernel's own re-execs (the gnomond activator's clean re-exec, the upgrade successor)
 * keep process.execPath, with SEA_GNOMOND_ARG in place of `--disable-sigusr1 <gnomond.js>`.
 *
 * Where gnomon.node is, under the SEA:
 *   - in Gnomon.app: Contents/Resources/node/bin/node (app-bundle.ts AppBundle.node; the SEA is
 *     Contents/Resources/kernel/gnomon.kernel);
 *   - a dev SEA (`npm run build:sea`): `<dir of gnomon.kernel>/node/bin/node` (DEV_CHILD_NODE_REL).
 * Neither present ⇒ SeaChildNodeMissing, fail closed: the kernel never falls back to spawning itself.
 * Not a SEA (npm installs, a checkout's `node dist/cli/gnomon.js`, tests): process.execPath, unchanged.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isSea } from 'node:sea';
import { appBundleOf, type AppBundle } from './app-bundle.js';

/** The SEA's file name and code-signing identifier (scripts/build-sea.mjs, gnomon-wrapper src/layout.rs). */
export const KERNEL_SEA_NAME = 'gnomon.kernel';
export const KERNEL_IDENTIFIER = 'gnomon.kernel';
/** The code-signing identifier of the node the kernel's children run (release-darwin.mjs NODE_IDENTIFIER). */
export const CHILD_NODE_IDENTIFIER = 'gnomon.node';
/** A dev SEA's children's node, relative to the directory holding gnomon.kernel. */
export const DEV_CHILD_NODE_REL = path.join('node', 'bin', 'node');
/** The SEA's first argument that selects the gnomond entry (scripts/sea/sea-prelude.mjs); anything else is the CLI. */
export const SEA_GNOMOND_ARG = '--gnomond';

export class SeaChildNodeMissing extends Error {
  constructor(readonly looked: readonly string[]) {
    super(`the SEA kernel found no gnomon.node for its children (looked at ${looked.join(', ')}); it never spawns itself as node: rebuild (npm run build:sea) or reinstall Gnomon`);
    this.name = 'SeaChildNodeMissing';
  }
}

export interface SeaFacts {
  /** default: node:sea isSea() */
  sea?: boolean;
  /** default: process.execPath */
  execPath?: string;
  /** default: appBundleOf() of this file (null outside Gnomon.app) */
  bundle?: AppBundle | null;
  /** default: a regular-file check */
  isFile?: (p: string) => boolean;
}

/** True when this process is the SEA kernel (node:sea; false under plain node). */
export function runningAsSea(): boolean {
  try {
    return isSea();
  } catch {
    return false;
  }
}

function regularFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function realOr(p: string): string {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return p;
  }
}

/** The candidates childNodePath tries under the SEA, in order (exported for tests and the refusal text). */
export function seaChildNodeCandidates(f: Pick<SeaFacts, 'execPath' | 'bundle'> = {}): string[] {
  const bundle = f.bundle === undefined ? appBundleOf() : f.bundle;
  const out: string[] = [];
  if (bundle) out.push(bundle.node);
  out.push(path.join(path.dirname(realOr(f.execPath ?? process.execPath)), DEV_CHILD_NODE_REL));
  return out;
}

let cached: string | undefined;

/**
 * The node binary every node child of the kernel runs. Not a SEA: process.execPath. SEA: the signed gnomon.node
 * (bundle, else beside the dev SEA); none ⇒ SeaChildNodeMissing. Memoized for the process when called with no facts.
 */
export function childNodePath(f?: SeaFacts): string {
  if (f === undefined && cached !== undefined) return cached;
  const sea = f?.sea ?? runningAsSea();
  const execPath = f?.execPath ?? process.execPath;
  if (!sea) return execPath;
  const isFile = f?.isFile ?? regularFile;
  const looked = seaChildNodeCandidates({ execPath, ...(f && 'bundle' in f ? { bundle: f.bundle ?? null } : {}) });
  const hit = looked.find((p) => isFile(p));
  if (!hit) throw new SeaChildNodeMissing(looked);
  if (f === undefined) cached = hit;
  return hit;
}

/** The gnomond entry a launcher passes: the SEA itself (no script; SEA_GNOMOND_ARG selects it) or the dist script. */
export function gnomondEntryOf(scriptPath: string, f: Pick<SeaFacts, 'sea' | 'execPath'> = {}): string {
  return (f.sea ?? runningAsSea()) ? (f.execPath ?? process.execPath) : scriptPath;
}
