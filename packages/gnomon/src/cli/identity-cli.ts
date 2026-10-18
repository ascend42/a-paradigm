/**
 * @symbol #identity
 *
 * `gnomon identity init | status` (spec §3.1 I3 root-signed CLI verbs; M1.3
 * slice 1). Writes to stdio directly: the kernel has zero deps (G-SEC-01).
 *
 * `gnomon identity init [--home <abs>] [--helper <path>] [--name <n>] [--host <h>] [--rotate]`
 * provisions this Mac's REAL root, once:
 *   1. refused from a kernel-spawned shell (GNOMON_HSID set: FORBIDDEN),
 *      while the daemon runs, and when keys/identity.json exists — unless
 *      `--rotate` is given on an interactive terminal with the typed
 *      confirmation `rotate`, which is LOGGED (stderr + a root-signed line
 *      in keys/identity.jsonl, signed by the OLD root with presence);
 *   2. pins the signed helper (codesign requirement, pre-spawn re-check;
 *      fail closed when it is missing or unsigned);
 *   3. creates the root and approvals P-256 keys in the Secure Enclave
 *      under a fresh generation id (no prompt);
 *   4. two root signatures, each with Touch ID / password: the approvals
 *      key's binding to the human principal, and the device row in
 *      keys/registry.jsonl (the device key is created if absent);
 *   5. writes keys/identity.json (O_EXCL, 0600, public material) last.
 * A failure before step 5 deletes the keys it created. The dev/test root
 * (DevTestRootAuthority) is untouched: tests keep using it programmatically.
 */
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRINCIPAL_NAME_PATTERN } from '@a-company/gnomon-contracts';
import {
  APPROVALS_ROW_SCHEMA,
  appendIdentityJournal,
  deviceKeyPath,
  HardwareRootAuthority,
  helperOnceSync,
  HelperProcess,
  helperPublicKey,
  IDENTITY_SCHEMA,
  identityPath,
  loadDeviceKey,
  p256FromX963,
  p256KeyIdOfPem,
  pemOf,
  pinHelper,
  readIdentity,
  registerDevice,
  registryPath,
  writeIdentity,
  writeNewDeviceKey,
  type HelperTransport,
  type HelperVerifier,
  type IdentityRecord,
  type PinnedHelper,
} from '../kernel/identity/index.js';
import { daemonState, resolveGnomonHome } from '../kernel/lifecycle/index.js';

export const EXIT_OK = 0;
export const EXIT_REFUSED = 1;
export const EXIT_USAGE = 64;

export interface IdentityIo {
  stdin: NodeJS.ReadableStream & { isTTY?: boolean };
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

/** Test seams (programmatic only): a dev verifier and a transport factory for a fake helper. */
export interface IdentityDeps {
  env?: Readonly<Record<string, string | undefined>>;
  verifier?: HelperVerifier;
  start?: (pin: PinnedHelper) => HelperTransport;
  once?: (pin: PinnedHelper) => (req: Record<string, unknown>) => Record<string, unknown>;
  /** the typed confirmation for --rotate (default: read a line from stdin on a TTY) */
  confirm?: () => Promise<string>;
  isTty?: boolean;
}

const HELPER_EXE_IN_APP = path.join('Contents', 'MacOS', 'gnomon-helper');

/** The helper next to this package in the monorepo / install (packages/gnomon-helper/bin/darwin). */
export function defaultHelperPath(metaUrl: string = import.meta.url): string {
  const dir = path.dirname(fileURLToPath(metaUrl));
  for (const up of ['../../..', '../../../..', '../..']) {
    const cand = path.resolve(dir, up, 'gnomon-helper', 'bin', 'darwin', 'GnomonHelper.app', HELPER_EXE_IN_APP);
    if (fs.existsSync(cand)) return cand;
    const nm = path.resolve(dir, up, 'node_modules', '@a-company', 'gnomon-helper', 'bin', 'darwin', 'GnomonHelper.app', HELPER_EXE_IN_APP);
    if (fs.existsSync(nm)) return nm;
  }
  return path.resolve(dir, '../../..', 'gnomon-helper', 'bin', 'darwin', 'GnomonHelper.app', HELPER_EXE_IN_APP);
}

function sanitizeName(s: string): string {
  const n = s.toLowerCase().replace(/[^a-z0-9._-]/g, '-').replace(/^[^a-z0-9]+/, '').slice(0, 64);
  return PRINCIPAL_NAME_PATTERN.test(n) ? n : 'founder';
}

function sanitizeHost(s: string): string {
  const h = s.replace(/\.local$/, '').replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 64);
  return h || 'mac';
}

interface InitArgs {
  home?: string;
  helper?: string;
  name?: string;
  host?: string;
  rotate: boolean;
}

function parse(argv: readonly string[]): InitArgs | string {
  const out: InitArgs = { rotate: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const v = (): string | undefined => argv[++i];
    if (a === '--rotate') out.rotate = true;
    else if (a === '--home') {
      const h = v();
      if (!h || !path.isAbsolute(h)) return '--home needs an absolute path';
      out.home = h;
    } else if (a === '--helper') {
      const h = v();
      if (!h || !path.isAbsolute(h)) return '--helper needs an absolute path (the GnomonHelper.app or its executable)';
      out.helper = h.endsWith('.app') || h.endsWith('.app/') ? path.join(h, HELPER_EXE_IN_APP) : h;
    } else if (a === '--name') {
      const n = v();
      if (!n || !PRINCIPAL_NAME_PATTERN.test(n)) return '--name must match [a-z0-9][a-z0-9._-]{0,63}';
      out.name = n;
    } else if (a === '--host') {
      const n = v();
      if (!n || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(n)) return '--host must match [A-Za-z0-9][A-Za-z0-9._-]{0,63}';
      out.host = n;
    } else return `unknown argument ${a}`;
  }
  return out;
}

function say(io: IdentityIo, obj: Record<string, unknown>): void {
  io.stdout.write(`${JSON.stringify(obj)}\n`);
}

function refused(io: IdentityIo, reason: string, message: string, extra: Record<string, unknown> = {}): number {
  io.stderr.write(`${JSON.stringify({ refused: true, reason, message, ...extra })}\n`);
  return EXIT_REFUSED;
}

function readLine(stdin: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve) => {
    let buf = '';
    const onData = (d: Buffer | string): void => {
      buf += d.toString();
      const i = buf.indexOf('\n');
      if (i >= 0) {
        stdin.off('data', onData);
        stdin.pause?.();
        resolve(buf.slice(0, i).trim());
      }
    };
    stdin.on('data', onData);
    stdin.once('end', () => resolve(buf.trim()));
  });
}

const GEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
function newGeneration(): string {
  return Array.from(randomBytes(12), (b) => GEN_ALPHABET[b % 36]).join('');
}

export async function runIdentityCommand(argv: readonly string[], io: IdentityIo, deps: IdentityDeps = {}): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === 'status') return identityStatus(rest, io);
  if (sub !== 'init') {
    io.stderr.write('usage: gnomon identity init [--home <abs>] [--helper <abs>] [--name <n>] [--host <h>] [--rotate]\n       gnomon identity status [--home <abs>]\n');
    return EXIT_USAGE;
  }
  const args = parse(rest);
  if (typeof args === 'string') {
    io.stderr.write(`gnomon identity: ${args}\n`);
    return EXIT_USAGE;
  }
  const env = deps.env ?? process.env;
  // §3.1 I3: a root-signed verb is refused from a kernel-spawned shell
  if (env.GNOMON_HSID) return refused(io, 'forbidden', 'gnomon identity init is a human-only, root-signed verb; it is refused from a kernel-spawned shell');
  const home = args.home ?? resolveGnomonHome({ env });
  if (daemonState(home).state === 'running') return refused(io, 'daemon-running', 'stop the daemon first (it would keep running on the old root)');

  let existing: IdentityRecord | null;
  try {
    existing = readIdentity(home);
  } catch (e) {
    return refused(io, 'identity-malformed', e instanceof Error ? e.message : 'identity.json is unreadable', { path: identityPath(home) });
  }
  if (existing && !args.rotate) return refused(io, 'exists', `a root already exists for this home (${existing.rootKeyId}); rotating it is explicit: gnomon identity init --rotate`, { rootKeyId: existing.rootKeyId });
  if (args.rotate && !existing) return refused(io, 'nothing-to-rotate', 'no identity to rotate; run gnomon identity init');
  if (args.rotate) {
    const tty = deps.isTty ?? io.stdin.isTTY === true;
    if (!tty && !deps.confirm) return refused(io, 'not-interactive', '--rotate needs an interactive terminal and a typed confirmation');
    io.stderr.write(`ROTATE the root of ${home} (${existing!.rootKeyId}). Every registry row is re-issued under the new root; the old registry is kept as evidence. Type "rotate" to continue:\n> `);
    const answer = await (deps.confirm ?? (() => readLine(io.stdin)))();
    if (answer !== 'rotate') return refused(io, 'not-confirmed', 'rotate was not confirmed');
  }

  // 2. pin the signed helper (fail closed)
  const helperPath = args.helper ?? (existing?.helperPath && !args.helper ? existing.helperPath : defaultHelperPath());
  let pin: PinnedHelper;
  try {
    pin = pinHelper(helperPath, deps.verifier ? { verifier: deps.verifier } : {});
  } catch (e) {
    return refused(io, 'helper-unavailable', e instanceof Error ? e.message : 'the helper could not be pinned', { helperPath });
  }
  const helper = deps.start ? deps.start(pin) : HelperProcess.start(pin);
  const once = deps.once ? deps.once(pin) : helperOnceSync(pin);
  const gen = newGeneration();
  const created: Array<'root' | 'approvals'> = [];
  try {
    // rotate: the OLD root signs the statement naming what replaces it (presence), before anything changes
    let oldRoot: HardwareRootAuthority | null = null;
    if (existing) {
      const pem = await helperPublicKey(helper, 'root', existing.gen).catch(() => null);
      if (pem && p256KeyIdOfPem(pem) === existing.rootKeyId) oldRoot = new HardwareRootAuthority({ gen: existing.gen, rootPublicKeyPem: existing.rootPublicKeyPem }, { helper, once });
    }

    // 3. Secure Enclave keys (no prompt)
    const keys: Record<'root' | 'approvals', string> = { root: '', approvals: '' };
    for (const k of ['root', 'approvals'] as const) {
      const r = await helper.request({ op: 'key.create', key: k, gen });
      created.push(k);
      keys[k] = pemOf(p256FromX963(String(r.publicKey)));
    }
    const root = new HardwareRootAuthority({ gen, rootPublicKeyPem: keys.root }, { helper, once });
    const name = args.name ?? sanitizeName(os.userInfo().username);
    const host = args.host ?? sanitizeHost(os.hostname());
    const principalId = `p:${root.ns}/${name}`;

    if (existing) {
      const statement = { schemaVersion: 'gnomon-root-rotate:v1', from: existing.rootKeyId, to: root.rootKeyId, gen, at: new Date().toISOString() };
      io.stderr.write(`Touch ID: the OLD root signs the rotation to ${root.rootKeyId.slice(0, 26)}…\n`);
      const signed = oldRoot ? await oldRoot.signRowAsync(statement) : null;
      appendIdentityJournal(home, { op: 'rotate', row: statement, ...(signed ?? { signer: null, sig: null, note: 'old root not reachable in the Secure Enclave: rotation not signed by it' }) });
      io.stderr.write(`${JSON.stringify({ logged: 'identity.rotate', from: existing.rootKeyId, to: root.rootKeyId, signedByOldRoot: signed !== null })}\n`);
      // the new root cannot verify the old registry: keep it aside as evidence, re-issue below
      const reg = registryPath(home);
      if (fs.existsSync(reg)) fs.renameSync(reg, `${reg}.rotated-${new Date().toISOString().replace(/[:.]/g, '-')}`);
      fs.renameSync(identityPath(home), `${identityPath(home)}.rotated-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    }

    // 4a. the approvals key bound to the human (root signature 1: Touch ID)
    const row = { schemaVersion: APPROVALS_ROW_SCHEMA, keyId: p256KeyIdOfPem(keys.approvals), publicKeyPem: keys.approvals, principalId, gen };
    io.stderr.write('Touch ID 1/2: the root signs your approvals key\n');
    const binding = await root.signRowAsync(row);
    // 4b. the device key and its registry row (root signature 2: Touch ID)
    let device;
    try {
      device = loadDeviceKey(home);
    } catch {
      device = writeNewDeviceKey(home);
    }
    io.stderr.write('Touch ID 2/2: the root signs this device\n');
    const entry = registerDevice(home, root, { host, name, principalKind: 'human', publicKeyPem: device.publicKeyPem });

    // 5. the record, last
    const rec: IdentityRecord = {
      schemaVersion: IDENTITY_SCHEMA,
      gen,
      rootKeyId: root.rootKeyId,
      rootPublicKeyPem: keys.root,
      ns: root.ns,
      approvals: { row, ...binding },
      principalId,
      deviceId: entry.deviceId,
      helperPath: pin.exe,
      createdAt: new Date().toISOString(),
      ...(existing ? { rotatedFrom: existing.rootKeyId } : {}),
    };
    writeIdentity(home, rec);
    appendIdentityJournal(home, { op: existing ? 'rotated' : 'init', gen, rootKeyId: root.rootKeyId, approvalsKeyId: row.keyId, principalId, deviceId: entry.deviceId, at: rec.createdAt });
    if (existing) {
      for (const k of ['approvals', 'root'] as const) await helper.request({ op: 'key.delete', key: k, gen: existing.gen }).catch(() => undefined);
    }
    say(io, { provisioned: true, home, rootKeyId: root.rootKeyId, ns: root.ns, principalId, deviceId: entry.deviceId, approvalsKeyId: row.keyId, helper: pin.exe, deviceKey: deviceKeyPath(home), rotated: existing !== null });
    return EXIT_OK;
  } catch (e) {
    for (const k of created) await helper.request({ op: 'key.delete', key: k, gen }).catch(() => undefined);
    return refused(io, 'provision-failed', e instanceof Error ? e.message : 'provisioning failed', { createdKeysDeleted: created });
  } finally {
    await helper.close().catch(() => undefined);
  }
}

function identityStatus(argv: readonly string[], io: IdentityIo): number {
  const args = parse(argv);
  if (typeof args === 'string') {
    io.stderr.write(`gnomon identity: ${args}\n`);
    return EXIT_USAGE;
  }
  const home = args.home ?? resolveGnomonHome();
  try {
    const r = readIdentity(home);
    say(io, r ? { state: 'hardware', home, rootKeyId: r.rootKeyId, ns: r.ns, principalId: r.principalId, deviceId: r.deviceId, approvalsKeyId: r.approvals.row.keyId, helper: r.helperPath, createdAt: r.createdAt } : { state: 'unprovisioned', home });
    return EXIT_OK;
  } catch (e) {
    return refused(io, 'identity-malformed', e instanceof Error ? e.message : 'identity.json is unreadable');
  }
}
