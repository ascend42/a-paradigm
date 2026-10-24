/**
 * @symbol #loop-act
 *
 * The darwin backend of the `loop-act` sandbox profile (docs/specs/gnomon-loops.md §4 "Sandboxes": write checks and
 * act nodes run the `session` profile in the scratch worktree, with no network except the model endpoint; build
 * plan step 10). It is the generated `session` SBPL (session-sbpl.ts, unchanged) with a TAIL appended; SBPL's last
 * matching rule wins, so the tail narrows it:
 *   - network: every outbound connect is denied (unix sockets too, so the kernel socket is unreachable, LL5), then
 *     exactly `localhost:<port>` of the configured local endpoint is re-allowed (a `loops: true` endpoint on
 *     loopback; LAN endpoints in act nodes land in 8.1);
 *   - exec: denied except the pinned runner's node (8.0 act nodes have no bash tool);
 *   - write: denied everywhere, then re-allowed in the scratch worktree, the run's private tmp and /dev/null;
 *     the linked node_modules (realpaths in the human repo) are re-denied;
 *   - read: the human repo is denied (the act session reads the scratch, its copy), then its node_modules are
 *     re-allowed (read only); the scratch run dir is re-allowed inside the Gnomon home the session profile denies,
 *     with metadata on its ancestors;
 *   - no fork (gnomon-local forks nothing; with no fork there is no descendant to outlive the step), signals only
 *     to itself and the sandbox (never the daemon or other processes), no executable mapping of the scratch or tmp
 *     (a dylib written there cannot be loaded);
 *   - reads of the repo's git common dir and its other worktrees are denied with the repo;
 *   - the session profile's loopback denies (the kernel's own ports) are appended again AFTER the endpoint allow;
 *     an endpoint on one of those ports is refused before this (sandbox/loop-act.ts);
 *   - last: the Gnomon keys dir and the credential stores, read and write.
 */
import { nodeRuntimeDirs } from '../../kernel/sandbox/transport.js';

export const LOOP_ACT_PROFILE_VERSION = 1;

export interface LoopActTailInput {
  /** the scratch worktree (read + write) */
  scratchReal: string;
  /** the run dir `<home>/loop-work/act-<runId>` (read) */
  runDirReal: string;
  /** the run's private TMPDIR (read + write) */
  tmpReal: string;
  /** the human repo (read denied) */
  repoReal: string;
  /** node_modules dirs linked into the scratch (read only) */
  nodeModulesReal: readonly string[];
  /** the runner's node (the one exec) */
  nodeReal: string;
  /** the configured local endpoint's loopback port */
  endpointPort: number;
  /** the session profile's denied loopback ports (the kernel's): re-denied after the endpoint allow */
  denyLoopbackPorts?: readonly number[];
  /** the repo's git common dir and its sibling worktrees: read denied */
  gitDenyReal?: readonly string[];
  /** the Gnomon keys dir and credential stores: read and write denied last */
  denyReal: readonly string[];
}

export class LoopActSbplError extends Error {}

const q = (p: string): string => {
  if (/["\\\n\r]/.test(p)) throw new LoopActSbplError(`path not expressible in SBPL: ${JSON.stringify(p)}`);
  return `"${p}"`;
};

function ancestors(p: string): string[] {
  const out: string[] = [];
  for (let d = p.slice(0, p.lastIndexOf('/')) || '/'; ; d = d.slice(0, d.lastIndexOf('/')) || '/') {
    out.push(d);
    if (d === '/') break;
  }
  return out;
}

const uniq = (xs: readonly string[]): string[] => [...new Set(xs)];

/** The tail appended to the session SBPL. */
export function loopActTailSbpl(i: LoopActTailInput): string[] {
  if (!Number.isInteger(i.endpointPort) || i.endpointPort < 1 || i.endpointPort > 65535) throw new LoopActSbplError(`endpoint port ${String(i.endpointPort)} is not a TCP port`);
  if ((i.denyLoopbackPorts ?? []).includes(i.endpointPort)) throw new LoopActSbplError(`endpoint port ${i.endpointPort} is a port the kernel denies to sessions`);
  const nm = uniq(i.nodeModulesReal);
  const lines = [
    `;; gnomon loop-act tail v${LOOP_ACT_PROFILE_VERSION} (gnomon-loops.md §4) — appended to the session profile; last match wins`,
    '(deny network-outbound)',
    `(allow network-outbound (remote ip "localhost:${i.endpointPort}"))`,
    ...(i.denyLoopbackPorts ?? []).map((p) => `(deny network-outbound (remote ip "localhost:${p}"))`),
    '(deny process-fork)',
    '(deny signal)',
    '(allow signal (target self))',
    '(deny process-exec)',
    `(allow process-exec (literal ${q(i.nodeReal)}))`,
    `(deny file-read* ${uniq([i.repoReal, ...(i.gitDenyReal ?? [])]).map((d) => `(subpath ${q(d)})`).join(' ')})`,
    `(allow file-read* (subpath ${q(i.runDirReal)})${nm.map((d) => ` (subpath ${q(d)})`).join('')}${uniq(nodeRuntimeDirs(i.nodeReal)).map((d) => ` (subpath ${q(d)})`).join('')})`,
    `(allow file-read-metadata ${uniq(ancestors(i.runDirReal)).map((d) => `(literal ${q(d)})`).join(' ')})`,
    '(deny file-write*)',
    `(allow file-write* (subpath ${q(i.scratchReal)}) (subpath ${q(i.tmpReal)}) (literal "/dev/null"))`,
  ];
  if (nm.length) lines.push(`(deny file-write* ${nm.map((d) => `(subpath ${q(d)})`).join(' ')})`);
  lines.push(`(deny file-map-executable (subpath ${q(i.scratchReal)}) (subpath ${q(i.tmpReal)}))`);
  // the scratch and tmp dirs themselves can be neither removed, renamed nor swapped (their contents can)
  lines.push(`(deny file-write* (literal ${q(i.scratchReal)}) (literal ${q(i.tmpReal)}))`);
  if (i.denyReal.length) lines.push(`(deny file-read* file-write* ${uniq(i.denyReal).map((d) => `(subpath ${q(d)})`).join(' ')})`);
  return lines;
}
