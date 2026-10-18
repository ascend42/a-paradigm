/**
 * @symbol #mod-host
 *
 * The darwin backend of the `mod` sandbox profile (spec §15.5 row `mod`,
 * §3.8). DEFAULT-DENY (unlike `session`'s allow-default), generated from the
 * platform-neutral ModProfileInput, every path realpath'd by the caller:
 *   - exec: the node binary only (sandbox-exec needs that one exec);
 *     `process-fork` is not allowed, so the mod cannot spawn anything;
 *   - read: what the Node runtime needs (`/` literal, /dev/null,
 *     /dev/urandom, /usr/lib, /System/Library, the node binary and its install's
 *     lib/ + Homebrew kegs — kernel/sandbox/transport.ts nodeRuntimeDirs, the
 *     measured set) + the mod's PINNED SNAPSHOT + its state dir + the
 *     `read:[paths]` of its `knowledge:provide` grant; metadata of the ancestors
 *     of those paths (realpath resolution);
 *   - write: `<home>/mods/<name>/state/` and `blobs/` — ONLY when the mod's
 *     effects in force include `write` (a read-only or dev-mode mod gets no
 *     file-write at all; G-MOD-02 "write outside its dir", and inside it too);
 *   - network: `network-outbound` to `localhost:<egress proxy port>` only, and
 *     only when the mod holds `network` + a granted host; otherwise none;
 *   - last, an explicit `file-read*` DENY of the linked source folder (its
 *     `.git/**` included): SBPL's later rule wins, so no granted read path can
 *     re-open the folder a running child must never read (§12.5).
 * No mach-lookup, no sysctl beyond `sysctl-read`, no IPC, no AppleEvents.
 */
import * as path from 'node:path';
import { nodeRuntimeDirs } from '../../kernel/sandbox/transport.js';

export const MOD_PROFILE_VERSION = 1;

export interface ModProfileInput {
  nodeReal: string;
  snapshotReal: string;
  stateReal: string;
  blobsReal: string;
  /** knowledge:provide read paths (realpath'd) */
  readPaths: readonly string[];
  /** grant file-write to state/ + blobs/ */
  write: boolean;
  /** the egress proxy port, or null for no network at all */
  proxyPort: number | null;
  /** the linked source folder (realpath'd) — explicitly unreadable */
  denyRead: readonly string[];
}

export class ModSbplError extends Error {}

const q = (p: string): string => {
  if (/["\\\n\r]/.test(p)) throw new ModSbplError(`path not expressible in SBPL: ${JSON.stringify(p)}`);
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

export function modProfileSbpl(i: ModProfileInput): string {
  if (i.proxyPort !== null && !(Number.isInteger(i.proxyPort) && i.proxyPort > 0 && i.proxyPort < 65536)) throw new ModSbplError(`bad proxy port ${i.proxyPort}`);
  const runtime = nodeRuntimeDirs(i.nodeReal);
  const reads = [
    '(literal "/")',
    '(literal "/dev/null")',
    '(literal "/dev/urandom")',
    '(subpath "/usr/lib")',
    '(subpath "/System/Library")',
    ...runtime.map((d) => `(subpath ${q(d)})`),
    `(literal ${q(i.nodeReal)})`,
    `(subpath ${q(i.snapshotReal)})`,
    `(subpath ${q(i.stateReal)})`,
    ...i.readPaths.map((p) => `(subpath ${q(p)})`),
  ];
  const meta = new Set<string>([...ancestors(i.nodeReal), ...ancestors(i.snapshotReal), ...ancestors(i.stateReal), ...i.readPaths.flatMap(ancestors)]);
  const lines = [
    `;; gnomon mod profile v${MOD_PROFILE_VERSION} (spec §15.5) — generated, default-deny, every path realpath'd`,
    '(version 1)',
    '(deny default)',
    `(allow process-exec (literal ${q(i.nodeReal)}))`,
    `(allow file-read* ${reads.join(' ')})`,
    `(allow file-read-metadata ${[...meta].map((d) => `(literal ${q(d)})`).join(' ')})`,
    '(allow sysctl-read)',
  ];
  if (i.write) lines.push(`(allow file-write* (subpath ${q(i.stateReal)}) (subpath ${q(i.blobsReal)}))`);
  if (i.proxyPort !== null) lines.push(`(allow network-outbound (remote ip "localhost:${i.proxyPort}"))`);
  if (i.denyRead.length) lines.push(`(deny file-read* file-write* ${i.denyRead.map((d) => `(subpath ${q(d)})`).join(' ')})`);
  lines.push('');
  return lines.join('\n');
}
