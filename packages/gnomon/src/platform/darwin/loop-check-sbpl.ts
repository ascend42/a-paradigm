/**
 * @symbol #loop-check
 *
 * The darwin backend of the `loop-check` sandbox profile (docs/specs/gnomon-loops.md §4 "Sandboxes", §7; the
 * loops' own name for M2.3's `gnomon-oracle` row, spec §15.5 G:1596; TD-2026-10-22-129). DEFAULT-DENY, modelled
 * on the `mod` profile (mod-sbpl.ts), generated from realpath'd inputs:
 *   - exec: the kernel's node, the check's hashed argv0 and its shebang interpreter(s) only, each a literal;
 *     `process-fork` is allowed (test runners fork workers) and every child inherits this profile, so a child
 *     can exec nothing else (osascript, launchctl, open, a shell: G-SBX-04..06 against this profile);
 *   - read: what the Node runtime needs (`/` literal, /dev/null, /dev/urandom, /usr/lib, /System/Library, the
 *     node binary and its install's lib/ + Homebrew kegs — kernel/sandbox/transport.ts nodeRuntimeDirs), the
 *     check COPY, the repo's node_modules dirs (read-only: never in a write rule, and re-denied for write
 *     last), the exec'd files and any extra read roots (the pinned paradigm CLI package); metadata of their
 *     ancestors (realpath resolution);
 *   - write: the check's run dir only (the repo copy and its private HOME and TMPDIR; kernel-owned under the
 *     Gnomon home, `<home>/loop-work/check-<runId>`, disposable and removed after the run) and /dev/null;
 *   - the Gnomon home is denied as a whole, then the run dir (and its ancestors' metadata) re-allowed after it:
 *     SBPL's last matching rule wins;
 *   - network: NO network-* rule at all (G-SBX-07; checks get no network and no keys, §7);
 *   - last, an explicit `file-read*`/`file-write*` DENY of the Gnomon home and the user's credential stores
 *     (~/.ssh, ~/.aws, ~/.gnupg, keychains, browser profiles, ~/.claude …): SBPL's later rule wins, so no
 *     granted path can re-open them.
 * No mach-lookup, no IPC beyond pipes, no AppleEvents, sysctl-read only, signals only within the sandbox.
 */
import * as path from 'node:path';
import { nodeRuntimeDirs } from '../../kernel/sandbox/transport.js';

export const LOOP_CHECK_PROFILE_VERSION = 1;

export interface LoopCheckProfileInput {
  nodeReal: string;
  /** the check copy (read + write) */
  copyReal: string;
  /** node_modules dirs linked into the copy (read only) */
  nodeModulesReal: readonly string[];
  /** argv0 and its shebang interpreter(s): exec + read literals (node is always added) */
  execReal: readonly string[];
  /** extra read-only subpaths (the pinned paradigm CLI package, argv0's runtime dirs) */
  readReal: readonly string[];
  /** the Gnomon home: denied as a whole BEFORE the run dir (inside it) is re-allowed */
  homeReal: string;
  /** credential stores and the Gnomon keys dir: read and write denied last */
  denyReal: readonly string[];
}

export class LoopCheckSbplError extends Error {}

const q = (p: string): string => {
  if (/["\\\n\r]/.test(p)) throw new LoopCheckSbplError(`path not expressible in SBPL: ${JSON.stringify(p)}`);
  return `"${p}"`;
};

function ancestors(p: string): string[] {
  const out: string[] = [];
  for (let d = path.dirname(p); ; d = path.dirname(d)) {
    out.push(d);
    if (d === path.dirname(d)) break;
  }
  return out;
}

const uniq = (xs: readonly string[]): string[] => [...new Set(xs)];

export function loopCheckProfileSbpl(i: LoopCheckProfileInput): string {
  const exec = uniq([i.nodeReal, ...i.execReal]);
  const runtime = uniq(nodeRuntimeDirs(i.nodeReal));
  const reads = [
    '(literal "/")',
    '(literal "/dev/null")',
    '(literal "/dev/urandom")',
    '(literal "/dev/random")',
    '(subpath "/usr/lib")',
    '(subpath "/System/Library")',
    ...runtime.map((d) => `(subpath ${q(d)})`),
    ...exec.map((e) => `(literal ${q(e)})`),
    `(subpath ${q(i.copyReal)})`,
    ...uniq(i.nodeModulesReal).map((d) => `(subpath ${q(d)})`),
    ...uniq(i.readReal).map((d) => `(subpath ${q(d)})`),
  ];
  const meta = uniq([...exec, i.copyReal, ...i.nodeModulesReal, ...i.readReal].flatMap(ancestors));
  const lines = [
    `;; gnomon loop-check profile v${LOOP_CHECK_PROFILE_VERSION} (gnomon-loops.md §4) — generated, default-deny, every path realpath'd`,
    '(version 1)',
    '(deny default)',
    '(allow process-fork)',
    `(allow process-exec ${exec.map((e) => `(literal ${q(e)})`).join(' ')})`,
    '(allow signal (target same-sandbox))',
    '(allow process-info* (target same-sandbox))',
    `(allow file-read* ${reads.join(' ')})`,
    `(allow file-read-metadata ${meta.map((d) => `(literal ${q(d)})`).join(' ')})`,
    '(allow sysctl-read)',
    `(allow file-write* (subpath ${q(i.copyReal)}) (literal "/dev/null"))`,
    '(allow file-ioctl (literal "/dev/null"))',
    // NO network-* rule: a check reaches no host, loopback included (G-SBX-07)
    `(deny file-read* file-write* (subpath ${q(i.homeReal)}))`,
    `(allow file-read* file-write* (subpath ${q(i.copyReal)}))`,
    `(allow file-read-metadata ${ancestors(i.copyReal).map((d) => `(literal ${q(d)})`).join(' ')})`,
  ];
  if (i.nodeModulesReal.length) lines.push(`(deny file-write* ${uniq(i.nodeModulesReal).map((d) => `(subpath ${q(d)})`).join(' ')})`);
  if (i.denyReal.length) lines.push(`(deny file-read* file-write* ${uniq(i.denyReal).map((d) => `(subpath ${q(d)})`).join(' ')})`);
  lines.push('');
  return lines.join('\n');
}
