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
import { execFile, type ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { isSea } from 'node:sea';
import { appBundleOf, type AppBundle } from './app-bundle.js';

/** The SEA's file name and code-signing identifier (scripts/build-sea.mjs, gnomon-wrapper src/layout.rs). */
export const KERNEL_SEA_NAME = 'gnomon.kernel';
export const KERNEL_IDENTIFIER = 'gnomon.kernel';
/** A dev SEA's identifier (npm run build:sea; Aegis S0 H2): never meets the release requirement. */
export const KERNEL_DEV_IDENTIFIER = 'gnomon.kernel.dev';
/** The code-signing identifier of the node the kernel's children run (release-darwin.mjs NODE_IDENTIFIER). */
export const CHILD_NODE_IDENTIFIER = 'gnomon.node';
/** A dev SEA's children's node identifier. */
export const CHILD_NODE_DEV_IDENTIFIER = 'gnomon.node.dev';
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

/**
 * Aegis S0 H1: the checks the signed SEA carries (scripts/sea/sea-prelude.mjs, frozen on globalThis.__gnomonSea
 * before any kernel code runs): checkDist (dist/ + package.json beside the SEA hash to the tree baked in at build)
 * and checkChildNode (the child node meets the cdhash-pinned requirement baked in at build). Both throw.
 */
export interface SeaGuard {
  readonly profile: 'release' | 'dev';
  readonly distTree: string;
  readonly childNodeRequirement: string;
  checkDist(): void;
  checkChildNode(node: string): void;
  /** helper 1.11.0 slice: the pinned voice client dir (`gnomon-voice` beside the kernel dir) and its tree check. */
  readonly voiceRoot?: string;
  checkVoice?(): void;
}

/** The SEA's guard, or null (plain node, or a SEA built without one). */
export function seaGuard(): SeaGuard | null {
  const g = (globalThis as { __gnomonSea?: SeaGuard }).__gnomonSea;
  return g && typeof g.checkDist === 'function' && typeof g.checkChildNode === 'function' ? g : null;
}

/** A child node (or the kernel files beside the SEA) the SEA's guard refused: fail closed, no child is spawned. */
export class SeaChildNodeRefused extends Error {
  constructor(readonly node: string | null, why: string) {
    super(`the SEA kernel refuses to spawn a child: ${why}; rebuild (npm run build:sea) or reinstall Gnomon`);
    this.name = 'SeaChildNodeRefused';
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
  /** default: seaGuard() */
  guard?: SeaGuard | null;
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

/**
 * The node binary every node child of the kernel runs, checked RIGHT BEFORE the caller spawns (every call site is a
 * spawn or the PATH/profile built for one). Not a SEA: process.execPath. SEA: the signed gnomon.node (bundle, else
 * beside the dev SEA); none ⇒ SeaChildNodeMissing. Aegis S0 H1: then the SEA's guard re-checks the kernel files
 * beside it (checkDist) and the node's cdhash-pinned code requirement (checkChildNode); no guard, or either check
 * failing ⇒ SeaChildNodeRefused. Never falls back to execPath.
 */
export function childNodePath(f?: SeaFacts): string {
  const sea = f?.sea ?? runningAsSea();
  const execPath = f?.execPath ?? process.execPath;
  if (!sea) return execPath;
  const isFile = f?.isFile ?? regularFile;
  const looked = seaChildNodeCandidates({ execPath, ...(f && 'bundle' in f ? { bundle: f.bundle ?? null } : {}) });
  const hit = looked.find((p) => isFile(p));
  if (!hit) throw new SeaChildNodeMissing(looked);
  const guard = f && 'guard' in f ? (f.guard ?? null) : seaGuard();
  if (!guard) throw new SeaChildNodeRefused(hit, 'this SEA carries no build guard (dist tree, child-node requirement)');
  try {
    guard.checkDist();
    guard.checkChildNode(hit);
  } catch (e) {
    throw new SeaChildNodeRefused(hit, e instanceof Error ? e.message : String(e));
  }
  return hit;
}

/** The voice client (or its entry) the SEA's pin refused: no voice child and no model fetch. */
export class SeaVoiceClientRefused extends Error {
  constructor(why: string) {
    super(`the SEA kernel refuses to start the voice client: ${why}; reinstall Gnomon`);
    this.name = 'VoiceClientRefused';
  }
}

/**
 * TD-2026-10-29-746 (helper 1.11.0 slice, kernel side): before each voice spawn and each model fetch, the SEA re-checks
 * the voice client tree baked in at build (package.json, dist, node_modules with the .node and .dylib addons; stat
 * cached) and that `entry` is inside it. Not a SEA: nothing to check (npm installs keep the install-time pin only).
 */
export function checkVoiceClient(entry: string, f: Pick<SeaFacts, 'sea' | 'guard'> = {}): void {
  const sea = f.sea ?? runningAsSea();
  if (!sea) return;
  const guard = 'guard' in f ? (f.guard ?? null) : seaGuard();
  if (!guard || typeof guard.checkVoice !== 'function' || typeof guard.voiceRoot !== 'string') throw new SeaVoiceClientRefused('this SEA carries no voice client pin');
  try {
    guard.checkVoice();
  } catch (e) {
    throw new SeaVoiceClientRefused(e instanceof Error ? e.message : String(e));
  }
  const root = realOr(guard.voiceRoot);
  const real = realOr(entry);
  if (!real.startsWith(root + path.sep)) throw new SeaVoiceClientRefused(`${entry} is outside the pinned voice client ${guard.voiceRoot}`);
}

/** Runs `codesign --verify -R=<req> <pid>`; resolves to the exit status (tests stub it). */
export type RunningChildVerifier = (pid: number, requirement: string) => Promise<number>;
/**
 * Aegis S2 L-3: the running-child codesign check gives up (a failure: SIGKILL) before the voice client's 15 s RPC
 * timeout (gnomon-voice kernel-link.ts FdRpc), so a stalled check never outlives the call waiting on it.
 */
export const RUNNING_CHILD_CODESIGN_TIMEOUT_MS = 10_000;
/** Aegis S2 L-3: the bytes a gated child may write before its check passes; past it the child is killed, nothing delivered. */
export const GATE_MAX_HELD_BYTES = 1 << 20;
const codesignPid: RunningChildVerifier = (pid, requirement) =>
  new Promise((resolve) => {
    execFile('/usr/bin/codesign', ['--verify', `-R=${requirement}`, String(pid)], { timeout: RUNNING_CHILD_CODESIGN_TIMEOUT_MS }, (err) => {
      resolve(err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code) : 1) : 0);
    });
  });

/**
 * TD-2026-10-29-746 + Aegis S1 M2: a gnomon.node child is verified RUNNING before anything it says is trusted. The
 * child's stdout (its only channel to the kernel: mod RPC, the voice client's lines, gnomon-web's ready line) is
 * swapped for a gate that HOLDS every byte; on the first byte the child has exec'd node (directly, or through
 * sandbox-exec, whose pid it keeps), so `codesign --verify -R=<child-node requirement> <pid>` runs on that pid. Pass:
 * the held bytes flow, in order, and the stream is piped through. Fail (or no guard, or no pid): SIGKILL, and nothing
 * it wrote is ever delivered. Call it right after spawn, before any listener is attached. Not a SEA: null (no-op).
 * Only for children whose program is gnomon.node (voice client, model fetch, gnomon-web, mods); never for loop checks
 * or sessions, which run other programs. Resolves true (verified) or false (killed).
 */
export function gateRunningChild(child: Pick<ChildProcess, 'pid' | 'kill' | 'stdout' | 'stdio'>, f: Pick<SeaFacts, 'sea' | 'guard'> & { verify?: RunningChildVerifier; maxHeldBytes?: number } = {}): Promise<boolean> | null {
  const sea = f.sea ?? runningAsSea();
  if (!sea) return null;
  const guard = 'guard' in f ? (f.guard ?? null) : seaGuard();
  const kill = (): false => {
    try {
      child.kill('SIGKILL');
    } catch {
      // already gone
    }
    return false;
  };
  const src = child.stdout;
  const held = new PassThrough();
  try {
    Object.defineProperty(child, 'stdout', { value: held, configurable: true, writable: true });
    if (Array.isArray(child.stdio)) (child.stdio as unknown[])[1] = held;
  } catch {
    return Promise.resolve(kill());
  }
  if (!guard || !src || typeof child.pid !== 'number' || child.pid <= 0) {
    src?.resume();
    held.destroy();
    return Promise.resolve(kill());
  }
  const pid = child.pid;
  const requirement = guard.childNodeRequirement;
  const buf: Buffer[] = [];
  let heldBytes = 0;
  let overflow = false;
  let ended = false;
  let verdict: Promise<boolean> | null = null;
  let settle!: (ok: boolean) => void;
  const result = new Promise<boolean>((r) => (settle = r));
  const start = (): void => {
    if (verdict) return;
    verdict = (f.verify ?? codesignPid)(pid, requirement).then((code) => code === 0, () => false);
    void verdict.then((ok) => {
      if (overflow) return; // already killed and settled false
      if (!ok) {
        kill();
        src.removeAllListeners('data');
        src.resume(); // drain and drop, never delivered
        held.destroy();
        return settle(false);
      }
      src.removeListener('data', onData);
      for (const c of buf.splice(0)) held.write(c);
      if (ended) held.end();
      else src.pipe(held);
      settle(true);
    });
  };
  const onData = (c: Buffer): void => {
    if (overflow) return;
    heldBytes += c.length;
    if (heldBytes > (f.maxHeldBytes ?? GATE_MAX_HELD_BYTES)) {
      // Aegis S2 L-3: an unverified child cannot grow the kernel's memory: kill it, drop what it wrote
      overflow = true;
      buf.length = 0;
      kill();
      src.removeAllListeners('data');
      src.resume();
      held.destroy();
      settle(false);
      return;
    }
    buf.push(c);
    start();
  };
  src.on('data', onData);
  src.once('end', () => {
    ended = true;
    if (overflow) return;
    if (!verdict) {
      // it said nothing and exited: nothing to deliver, nothing to trust
      held.end();
      settle(false);
    }
  });
  return result;
}

/**
 * Aegis S1 M2 for a child whose kernel link is a DUPLEX socket (the voice client's fd 3): resolve only when the child's
 * first bytes are buffered (unread) on `sock` AND the running pid meets the child-node requirement; the caller attaches
 * the socket only after true. Fail: SIGKILL, false. Not a SEA: null.
 */
export function gateRunningSocket(child: Pick<ChildProcess, 'pid' | 'kill'>, sock: NodeJS.ReadableStream & { once: (e: string, l: () => void) => unknown; removeListener: (e: string, l: () => void) => unknown }, f: Pick<SeaFacts, 'sea' | 'guard'> & { verify?: RunningChildVerifier } = {}): Promise<boolean> | null {
  const sea = f.sea ?? runningAsSea();
  if (!sea) return null;
  const guard = 'guard' in f ? (f.guard ?? null) : seaGuard();
  const kill = (): false => {
    try {
      child.kill('SIGKILL');
    } catch {
      // already gone
    }
    return false;
  };
  if (!guard || typeof child.pid !== 'number' || child.pid <= 0) return Promise.resolve(kill());
  const pid = child.pid;
  return new Promise<boolean>((resolve) => {
    const onEnd = (): void => {
      sock.removeListener('readable', onReadable);
      resolve(kill());
    };
    const onReadable = (): void => {
      sock.removeListener('end', onEnd);
      sock.removeListener('readable', onReadable); // nothing is read here: the bytes stay buffered for the caller
      (f.verify ?? codesignPid)(pid, guard.childNodeRequirement).then(
        (code) => resolve(code === 0 ? true : kill()),
        () => resolve(kill()),
      );
    };
    sock.once('end', onEnd);
    sock.once('readable', onReadable);
  });
}

/** The gnomond entry a launcher passes: the SEA itself (no script; SEA_GNOMOND_ARG selects it) or the dist script. */
export function gnomondEntryOf(scriptPath: string, f: Pick<SeaFacts, 'sea' | 'execPath'> = {}): string {
  return (f.sea ?? runningAsSea()) ? (f.execPath ?? process.execPath) : scriptPath;
}
