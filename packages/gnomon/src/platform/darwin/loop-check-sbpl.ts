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
 *   - network: by default NO network-* rule at all (G-SBX-07). TD-2026-10-23-268: a loop with `network: on` (on its
 *     trust card) gets outbound IP connects (`remote ip "*:*"`) and DNS (the mDNSResponder socket), then
 *     the kernel's listener ports (web, mod proxies, local-model endpoints) are denied again on every address
 *     (`remote ip "*:PORT"`); every other unix socket (the kernel socket included) stays unreachable, and nothing may
 *     listen;
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
  /** TD-2026-10-23-268: the loop's `network: on`; absent: no network rule at all */
  network?: { denyLoopbackPorts: readonly number[] };
}

export class LoopCheckSbplError extends Error {}

const q = (p: string): string => {
  if (/["\\\n\r]/.test(p)) throw new LoopCheckSbplError(`path not expressible in SBPL: ${JSON.stringify(p)}`);
  return `"${p}"`;
};

function ancestors(p: string): string[] {
  const out: string[] = [];
  // darwin SBPL: POSIX path rules on every host (the profile is generated in tests on Windows too)
  for (let d = path.posix.dirname(p); ; d = path.posix.dirname(d)) {
    out.push(d);
    if (d === path.posix.dirname(d)) break;
  }
  return out;
}

const uniq = (xs: readonly string[]): string[] => [...new Set(xs)];

/**
 * `network: on`: outbound IP and DNS only; the kernel's listener ports denied after on every address (the later rule
 * wins). DNS is the mDNSResponder socket alone. Aegis L2: no `system-socket`, no mach-lookup and no /etc read: the
 * darwin sandbox test resolves a name and connects without them (each was tried and dropped).
 */
function networkRules(denyPorts: readonly number[]): string[] {
  for (const p of denyPorts) if (!Number.isInteger(p) || p <= 0 || p > 65535) throw new LoopCheckSbplError(`not a port: ${p}`);
  return [
    '(allow network-outbound (remote ip "*:*"))',
    '(allow network-outbound (remote unix-socket (path-literal "/private/var/run/mDNSResponder")))',
    // getaddrinfo asks mDNSResponder over its socket; reaching it resolves the /var link (metadata only)
    '(allow file-read-metadata (literal "/var"))',
    // Aegis M1: a kernel listener's port is denied on EVERY address (127.0.0.1, 0.0.0.0, ::ffff:127.0.0.1, the LAN IP)
    ...[...new Set(denyPorts)].map((p) => `(deny network-outbound (remote ip "*:${p}"))`),
  ];
}

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
    // by default NO network-* rule: a check reaches no host, loopback included (G-SBX-07)
    ...(i.network ? networkRules(i.network.denyLoopbackPorts) : []),
    `(deny file-read* file-write* (subpath ${q(i.homeReal)}))`,
    `(allow file-read* file-write* (subpath ${q(i.copyReal)}))`,
    `(allow file-read-metadata ${ancestors(i.copyReal).map((d) => `(literal ${q(d)})`).join(' ')})`,
  ];
  if (i.nodeModulesReal.length) lines.push(`(deny file-write* ${uniq(i.nodeModulesReal).map((d) => `(subpath ${q(d)})`).join(' ')})`);
  if (i.denyReal.length) lines.push(`(deny file-read* file-write* ${uniq(i.denyReal).map((d) => `(subpath ${q(d)})`).join(' ')})`);
  lines.push('');
  return lines.join('\n');
}
