/**
 * @symbol #oracle-sandbox
 * @symbol #web-endpoint
 *
 * The `transport` sandbox profile (spec §15.5 row `transport`, §11.2 rule 1b,
 * §16 "Web endpoint" row) for the `gnomon-web` child: listen on loopback,
 * read the pinned GUI bundle directory and `/dev/null`, stdio to the kernel —
 * no other file, no keystore, no `mach-lookup`, no outbound network, no exec,
 * no fork (`G-WEB-07`).
 *
 * PLATFORM REGISTRY (G-WIN-05: no platform branch in kernel code): the
 * backend is looked up in TRANSPORT_BACKENDS by platform. darwin =
 * `sandbox-exec` with the generated SBPL below. win32 = the restricted-token
 * + job-object backend of the Windows parity phase (P8-D78) — not built, so
 * absent. linux has no profile in the spec. A platform with no backend REFUSES
 * (LifecycleRefusal `sandbox-unavailable`): the transport child never runs
 * unsandboxed in production (fail closed, §15.5 "never a silent downgrade").
 *
 * macOS generation rules (§15.5, p10m): every path is realpath'd before it is
 * written. What the Node runtime needs, measured on darwin 24.6 / Node 26:
 * read of `/` (the literal), `/usr/lib`, `/System/Library`, the node binary
 * and its install's `lib/` (a Homebrew build links ~20 dependency kegs, so it
 * also needs `<brew>/Cellar`, `<brew>/opt` and `<brew>/etc/openssl@3` for
 * openssl.cnf — installed software only),
 * `sysctl-read`, and `file-read-metadata` on the ancestors of the paths it
 * resolves (realpath of the entry). NEVER the install prefix itself (Aegis
 * C2: with node at ~/bin/node that prefix is $HOME): every granted read
 * subpath is checked, and one that equals or contains $HOME, the Gnomon home
 * or its keystore dir refuses `sandbox-unavailable`. Residuals, stated: `network-bind`
 * in SBPL names `localhost:*`, which also admits ::1 — the child's code binds
 * the 127.0.0.1 literal only; `file-read-metadata` on ancestor directories
 * reveals their existence; the child may re-exec its own Node binary (same
 * profile inherited) because sandbox-exec needs that one exec — `process-fork`
 * is denied, so it cannot spawn anything.
 */
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { LifecycleRefusal } from '../lifecycle/refusal.js';

export const SANDBOX_PROFILE_NAMES = ['gnomon-oracle', 'gnomon-reviewer', 'git', 'session', 'mod', 'transport', 'voice', 'link'] as const;
export type SandboxProfileName = (typeof SANDBOX_PROFILE_NAMES)[number];

/** The `transport` row of §15.5 as data (versioned; hashed into socket.web.listen as profileHash). */
export const TRANSPORT_PROFILE = Object.freeze({
  name: 'transport' as const,
  version: 1,
  allow: Object.freeze({ listen: '127.0.0.1 ephemeral', read: Object.freeze(['the pinned GUI bundle directory', '/dev/null', 'the Node runtime']), stdio: 'to the kernel' }),
  deny: Object.freeze(['every other file', 'keystore', 'mach-lookup', 'outbound network', 'exec', 'fork', 'home']),
});

export interface TransportLaunchInput {
  /** The child entry (dist/transport/gnomon-web.js of the kernel's own package). */
  scriptPath: string;
  bundleDir: string;
  /** The Node binary (default process.execPath). */
  nodePath?: string;
  /** Directories no granted read subpath may equal or contain (the Gnomon home, its keys dir); $HOME is always added. */
  protectedDirs?: string[];
  /** Trees no granted read subpath may touch at all — neither contain nor lie inside (the keys dir). */
  forbiddenTrees?: string[];
}

export interface ChildLaunchPlan {
  command: string;
  args: string[];
  env: Record<string, string>;
  sandbox: 'full' | 'none';
  profile: string | null;
  profileHash: string | null;
}

const q = (p: string): string => JSON.stringify(p); // SBPL string literal (paths carry no quote by construction)

function ancestors(p: string): string[] {
  const out: string[] = [];
  for (let d = path.dirname(p); ; d = path.dirname(d)) {
    out.push(d);
    if (d === path.dirname(d)) break;
  }
  return out;
}

/** The runtime directories the node binary loads from (realpath'd): its install's lib/, plus Homebrew's kegs. Never the prefix. */
export function nodeRuntimeDirs(nodeReal: string): string[] {
  const dirs = new Set<string>([path.join(path.dirname(path.dirname(nodeReal)), 'lib')]);
  const parts = nodeReal.split(path.sep);
  const cellar = parts.indexOf('Cellar');
  if (cellar > 0) {
    const brew = parts.slice(0, cellar).join(path.sep) || path.sep;
    dirs.add(path.join(brew, 'Cellar')); // dependency kegs (libuv, llhttp, openssl, …)
    dirs.add(path.join(brew, 'opt')); // their opt/ links
    dirs.add(path.join(brew, 'etc', 'openssl@3')); // Homebrew OpenSSL reads its openssl.cnf at startup (measured)
  }
  return [...dirs];
}

const within = (p: string, dir: string): boolean => p === dir || p.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep);

/** Refuse when a granted read subpath equals or contains a protected directory (Aegis C2). */
export function assertNoProtectedGrant(grants: string[], protectedDirs: string[], forbiddenTrees: string[] = []): void {
  for (const g of grants) for (const f of forbiddenTrees) {
    // reverse containment: no grant may lie INSIDE a forbidden tree (the keystore dir), Aegis round 3
    if (within(g, f)) throw new LifecycleRefusal('sandbox-unavailable', `the transport profile would grant read of ${g}, inside ${f}`, { grant: g, forbidden: f });
  }
  for (const g of grants) for (const p of [...protectedDirs, ...forbiddenTrees]) {
    if (within(p, g)) throw new LifecycleRefusal('sandbox-unavailable', `the transport profile would grant read of ${g}, which contains ${p}`, { grant: g, protected: p });
  }
}

/** The SBPL text of the transport profile for these (realpath'd) inputs. */
export function transportProfileSbpl(i: { nodeReal: string; scriptReal: string; bundleReal: string; protectedDirs?: string[]; forbiddenTrees?: string[] }): string {
  for (const p of [i.nodeReal, i.scriptReal, i.bundleReal]) if (/["\\\n]/.test(p)) throw new LifecycleRefusal('sandbox-unavailable', `path not expressible in SBPL: ${p}`);
  const scriptDir = path.dirname(i.scriptReal);
  const subpaths = ['/usr/lib', '/System/Library', ...nodeRuntimeDirs(i.nodeReal), scriptDir, i.bundleReal];
  const real = (d: string): string => (existsSync(d) ? realpathSync(d) : d);
  assertNoProtectedGrant(subpaths, [real(homedir()), ...(i.protectedDirs ?? []).map(real)], (i.forbiddenTrees ?? []).map(real));
  const pkgJsons = ancestors(i.scriptReal).map((d) => path.join(d, 'package.json'));
  const meta = new Set<string>([...ancestors(i.scriptReal), ...ancestors(i.bundleReal), ...ancestors(i.nodeReal)]);
  const reads = [
    '(literal "/")',
    '(literal "/dev/null")',
    '(literal "/dev/urandom")',
    '(subpath "/usr/lib")',
    '(subpath "/System/Library")',
    ...nodeRuntimeDirs(i.nodeReal).map((d) => `(subpath ${q(d)})`),
    `(literal ${q(i.nodeReal)})`,
    `(subpath ${q(scriptDir)})`,
    ...pkgJsons.map((p) => `(literal ${q(p)})`),
    `(subpath ${q(i.bundleReal)})`,
  ];
  return [
    `;; gnomon transport profile v${TRANSPORT_PROFILE.version} (spec §15.5) — generated, every path realpath'd`,
    '(version 1)',
    '(deny default)',
    `(allow process-exec (literal ${q(i.nodeReal)}))`,
    `(allow file-read* ${reads.join(' ')})`,
    `(allow file-read-metadata ${[...meta].map((d) => `(literal ${q(d)})`).join(' ')})`,
    '(allow sysctl-read)',
    '(allow network-bind (local ip "localhost:*"))',
    '(allow network-inbound (local ip "localhost:*"))',
    '',
  ].join('\n');
}

const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

function darwinTransport(input: TransportLaunchInput): ChildLaunchPlan {
  if (!existsSync(SANDBOX_EXEC)) throw new LifecycleRefusal('sandbox-unavailable', `${SANDBOX_EXEC} is missing`);
  const nodeReal = realpathSync(input.nodePath ?? process.execPath);
  const scriptReal = realpathSync(input.scriptPath);
  const bundleReal = realpathSync(input.bundleDir);
  const profile = transportProfileSbpl({ nodeReal, scriptReal, bundleReal, ...(input.protectedDirs ? { protectedDirs: input.protectedDirs } : {}), ...(input.forbiddenTrees ? { forbiddenTrees: input.forbiddenTrees } : {}) });
  return {
    command: SANDBOX_EXEC,
    args: ['-p', profile, nodeReal, scriptReal],
    env: {}, // no home, no PATH, no GNOMON_*: the child needs nothing from the environment
    sandbox: 'full',
    profile,
    profileHash: `sha256:${createHash('sha256').update(profile).digest('hex')}`,
  };
}

/** Platform registry of transport sandbox backends (G-WIN-05). */
export const TRANSPORT_BACKENDS: Readonly<Partial<Record<string, (input: TransportLaunchInput) => ChildLaunchPlan>>> = Object.freeze({
  darwin: darwinTransport,
  // win32: restricted token + job object, Windows parity phase (P8-D78) — not built.
});

/** The launch plan for the transport child on `platform`; refuses where no profile can be applied. */
export function transportLaunchPlan(input: TransportLaunchInput, platform: string = process.platform): ChildLaunchPlan {
  const backend = TRANSPORT_BACKENDS[platform];
  if (!backend) throw new LifecycleRefusal('sandbox-unavailable', `no transport sandbox profile on ${platform} (§15.5; Windows parity phase P8-D78)`, { platform, profile: 'transport' });
  return backend(input);
}
