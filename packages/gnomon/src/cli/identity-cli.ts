/**
 * @symbol #identity
 *
 * `gnomon identity init | status` (spec §3.1 I3 root-signed CLI verbs; M1.3
 * slice 1). Writes to stdio directly: the kernel has zero deps (G-SEC-01).
 *
 * `gnomon identity init [--home <abs>] [--helper <path>] [--name <n>] [--host <h>] [--rotate | --recover]`
 * provisions this Mac's REAL root, once:
 *   1. refused while the daemon runs and when keys/identity.json exists —
 *      unless `--rotate` (the OLD root, present in the Secure Enclave, signs
 *      a gnomon-root-rotate:v1 statement the helper requires before it
 *      creates the new generation; Aegis H4/H2) or `--recover` (the old root
 *      is LOST: a new namespace, logged as not signed by it), each on an
 *      interactive terminal with the typed word. The GNOMON_HSID refusal is
 *      hygiene, not a security control: presence is the boundary;
 *   2. pins the signed helper (fail closed) and asks it which Gnomon keys the
 *      Secure Enclave holds: any other generation refuses (purge-keys first);
 *   3. creates the root and approvals keys under a fresh generation (no prompt);
 *   4. two root signatures with presence (approvals binding, device row); the
 *      prompt text and stderr name the digest the helper's own line shows (H3);
 *   5. commits: old record moved aside (rotate/recover), identity.json
 *      written, THEN the registry row appended (R3), then the journal.
 * A failure before identity.json is written restores the moved files (R2)
 * and deletes the keys it created — through the live helper, or a fresh one
 * that asks for presence (R4); after it, keys are never deleted. Ctrl-C stops
 * at the next step and cleans up the same way; a second Ctrl-C exits.
 * `gnomon identity purge-keys --gen <g>` deletes another generation's keys,
 * each with fresh presence. The dev/test root
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
  appendSignedRegistryRow,
  deviceRowFor,
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
  /** the typed confirmation for --rotate / --recover (default: read a line from stdin on a TTY) */
  confirm?: () => Promise<string>;
  isTty?: boolean;
  /** after a successful rotate: the answer to "purge the old generation now?" (default: read a line on a TTY) */
  confirmPurge?: () => Promise<string>;
  /** install the SIGINT handler (default true; tests pass false and drive `interrupt`) */
  handleSignals?: boolean;
  /** tests: report an interrupt at the next step boundary */
  interrupt?: () => boolean;
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
  recover: boolean;
  gen?: string;
}

function parse(argv: readonly string[]): InitArgs | string {
  const out: InitArgs = { rotate: false, recover: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const v = (): string | undefined => argv[++i];
    if (a === '--rotate') out.rotate = true;
    else if (a === '--recover') out.recover = true;
    else if (a === '--gen') {
      const g = v();
      if (!g || !/^[a-z0-9]{4,32}$/.test(g)) return '--gen must match [a-z0-9]{4,32}';
      out.gen = g;
    }
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

const USAGE =
  'usage: gnomon identity init [--home <abs>] [--helper <abs>] [--name <n>] [--host <h>] [--rotate | --recover]\n' +
  '       gnomon identity purge-keys --gen <gen> [--home <abs>] [--helper <abs>]\n' +
  '       gnomon identity status [--home <abs>]\n';

class Interrupted extends Error {
  constructor() {
    super('interrupted (Ctrl-C)');
    this.name = 'Interrupted';
  }
}

type KeyEntry = { gen: string; key: string };

async function listKeys(helper: HelperTransport): Promise<KeyEntry[]> {
  const r = await helper.request({ op: 'key.list' });
  return Array.isArray(r.keys) ? (r.keys as KeyEntry[]).filter((k) => typeof k?.gen === 'string' && typeof k?.key === 'string') : [];
}

const gensOf = (keys: KeyEntry[]): string[] => [...new Set(keys.map((k) => k.gen))].sort();

export async function runIdentityCommand(argv: readonly string[], io: IdentityIo, deps: IdentityDeps = {}): Promise<number> {
  const [sub, ...rest] = argv;
  if (sub === 'status') return identityStatus(rest, io);
  if (sub === 'purge-keys') return purgeKeys(rest, io, deps);
  if (sub !== 'init') {
    io.stderr.write(USAGE);
    return EXIT_USAGE;
  }
  const args = parse(rest);
  if (typeof args === 'string' || args.gen !== undefined || (args.rotate && args.recover)) {
    io.stderr.write(`gnomon identity: ${typeof args === 'string' ? args : 'init takes at most one of --rotate / --recover, and no --gen'}\n${USAGE}`);
    return EXIT_USAGE;
  }
  const env = deps.env ?? process.env;
  // §3.1 I3: refused from a kernel-spawned shell. Hygiene, NOT a security control (Aegis H4): env -u
  // defeats it; the boundary is the presence prompt on every root signature.
  if (env.GNOMON_HSID) return refused(io, 'forbidden', 'gnomon identity init is a human-only, root-signed verb; it is refused from a kernel-spawned shell');
  const home = args.home ?? resolveGnomonHome({ env });
  if (daemonState(home).state === 'running') return refused(io, 'daemon-running', 'stop the daemon first (it would keep running on the old root)');

  let existing: IdentityRecord | null;
  try {
    existing = readIdentity(home);
  } catch (e) {
    return refused(io, 'identity-malformed', e instanceof Error ? e.message : 'identity.json is unreadable', { path: identityPath(home) });
  }
  const mode: 'init' | 'rotate' | 'recover' = args.rotate ? 'rotate' : args.recover ? 'recover' : 'init';
  if (existing && mode === 'init') return refused(io, 'exists', `a root already exists for this home (${existing.rootKeyId}); rotating it is explicit: gnomon identity init --rotate`, { rootKeyId: existing.rootKeyId });
  if (!existing && mode !== 'init') return refused(io, 'nothing-to-rotate', `no identity to ${mode}; run gnomon identity init`);
  if (mode !== 'init') {
    const tty = deps.isTty ?? io.stdin.isTTY === true;
    if (!tty && !deps.confirm) return refused(io, 'not-interactive', `--${mode} needs an interactive terminal and a typed confirmation`);
    io.stderr.write(
      mode === 'rotate'
        ? `ROTATE the root of ${home} (${existing!.rootKeyId}). The OLD root signs the change; every registry row is re-issued under the new root; the old registry is kept as evidence. Type "rotate" to continue:\n> `
        : `RECOVER ${home}: the root ${existing!.rootKeyId} is LOST. A new root starts a NEW namespace; nothing signed by the lost root carries over, and the recovery is logged as unsigned by it. Type "recover" to continue:\n> `,
    );
    const answer = await (deps.confirm ?? (() => readLine(io.stdin)))();
    if (answer !== mode) return refused(io, 'not-confirmed', `${mode} was not confirmed`);
  }

  // pin the signed helper (fail closed)
  const helperPath = args.helper ?? existing?.helperPath ?? defaultHelperPath();
  let pin: PinnedHelper;
  try {
    pin = pinHelper(helperPath, deps.verifier ? { verifier: deps.verifier } : {});
  } catch (e) {
    return refused(io, 'helper-unavailable', e instanceof Error ? e.message : 'the helper could not be pinned', { helperPath });
  }
  const startHelper = (): HelperTransport => (deps.start ? deps.start(pin) : HelperProcess.start(pin));
  let helper = startHelper();
  const once = deps.once ? deps.once(pin) : helperOnceSync(pin);

  // Ctrl-C (R4): the first one stops at the next step boundary and cleans up; a second exits at once
  let interrupted = false;
  const onSigint = (): void => {
    if (interrupted) {
      io.stderr.write('gnomon identity: interrupted twice; exiting without cleanup\n');
      process.exit(130);
    }
    interrupted = true;
    io.stderr.write('gnomon identity: interrupted — cancel any open Touch ID prompt; cleaning up after the current step\n');
  };
  if (deps.handleSignals !== false) process.on('SIGINT', onSigint);
  const step = (): void => {
    if (interrupted || deps.interrupt?.()) throw new Interrupted();
  };

  const gen = newGeneration();
  const created: Array<'root' | 'approvals'> = [];
  const moved: Array<{ from: string; to: string }> = [];
  let recordWritten = false;
  try {
    // H4: what the Secure Enclave already holds decides what may happen
    const keys = await listKeys(helper);
    const others = gensOf(keys.filter((k) => k.gen !== existing?.gen));
    if (others.length) return refused(io, 'keys-exist', `the Secure Enclave already holds Gnomon keys of generation(s) ${others.join(', ')}; remove them first: gnomon identity purge-keys --gen <gen>`, { gens: others });
    const oldRootHeld = existing ? keys.some((k) => k.gen === existing!.gen && k.key === 'root') : false;
    let oldRoot: HardwareRootAuthority | null = null;
    if (mode === 'rotate') {
      if (!oldRootHeld) return refused(io, 'old-root-missing', `the old root (${existing!.rootKeyId}) is not in the Secure Enclave, so it cannot sign the rotation; if it is lost use: gnomon identity init --recover`);
      const pem = await helperPublicKey(helper, 'root', existing!.gen);
      if (!pem || p256KeyIdOfPem(pem) !== existing!.rootKeyId) return refused(io, 'old-root-mismatch', 'the Secure Enclave root of this generation does not match identity.json');
      oldRoot = new HardwareRootAuthority({ gen: existing!.gen, rootPublicKeyPem: existing!.rootPublicKeyPem }, { helper, once });
    }
    if (mode === 'recover') {
      if (keys.some((k) => k.gen === existing!.gen)) return refused(io, 'old-root-present', `keys of the old generation ${existing!.gen} are still in the Secure Enclave: use --rotate (root present) or purge-keys --gen ${existing!.gen}`);
    }

    // rotate (H4/H2): the OLD root signs the statement that lets the helper create the new generation
    let rotation: { row: Record<string, unknown>; statement: string; sig: string } | null = null;
    if (oldRoot) {
      const row = { schemaVersion: 'gnomon-root-rotate:v1', fromKeyId: existing!.rootKeyId, fromGen: existing!.gen, toGen: gen, at: new Date().toISOString() };
      io.stderr.write(`Touch ID: the OLD root signs the rotation (the prompt must end with ${oldRoot.digestFor(row)})\n`);
      step();
      rotation = { row, ...(await oldRoot.signForHelper(row)) };
    }

    // the Secure Enclave keys of the new generation (no prompt)
    const pubs: Record<'root' | 'approvals', string> = { root: '', approvals: '' };
    for (const k of ['root', 'approvals'] as const) {
      step();
      const r = await helper.request({ op: 'key.create', key: k, gen, ...(rotation ? { rotate: { fromGen: existing!.gen, statement: rotation.statement, sig: rotation.sig } } : {}) });
      created.push(k);
      pubs[k] = pemOf(p256FromX963(String(r.publicKey)));
    }
    const root = new HardwareRootAuthority({ gen, rootPublicKeyPem: pubs.root }, { helper, once });
    const name = args.name ?? sanitizeName(os.userInfo().username);
    const host = args.host ?? sanitizeHost(os.hostname());
    const principalId = `p:${root.ns}/${name}`;

    // two root signatures, each with presence; nothing is written yet
    const row = { schemaVersion: APPROVALS_ROW_SCHEMA, keyId: p256KeyIdOfPem(pubs.approvals), publicKeyPem: pubs.approvals, principalId, gen };
    io.stderr.write(`Touch ID 1/2: the root signs your approvals key (the prompt must end with ${root.digestFor(row)})\n`);
    step();
    const binding = await root.signRowAsync(row);
    let device;
    try {
      device = loadDeviceKey(home);
    } catch {
      device = writeNewDeviceKey(home);
    }
    const deviceRow = deviceRowFor(root.ns, { host, name, principalKind: 'human', publicKeyPem: device.publicKeyPem });
    io.stderr.write(`Touch ID 2/2: the root signs this device (the prompt must end with ${root.digestFor(deviceRow)})\n`);
    step();
    const deviceSig = await root.signRowAsync(deviceRow);
    step();

    // commit: move the old record aside, write the new one, THEN the registry row (R3: no orphan row)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (existing) {
      for (const f of [identityPath(home), registryPath(home)]) {
        if (!fs.existsSync(f)) continue;
        const to = `${f}.${mode === 'rotate' ? 'rotated' : 'recovered'}-${stamp}`;
        fs.renameSync(f, to);
        moved.push({ from: f, to });
      }
    }
    const rec: IdentityRecord = {
      schemaVersion: IDENTITY_SCHEMA,
      gen,
      rootKeyId: root.rootKeyId,
      rootPublicKeyPem: pubs.root,
      ns: root.ns,
      approvals: { row, ...binding },
      principalId,
      deviceId: deviceRow.deviceId!,
      helperPath: pin.exe,
      createdAt: new Date().toISOString(),
      ...(existing && mode === 'rotate' ? { rotatedFrom: existing.rootKeyId } : {}),
      ...(existing && mode === 'recover' ? { recoveredFrom: existing.rootKeyId } : {}),
    };
    writeIdentity(home, rec);
    recordWritten = true; // from here on, keys are never deleted (R2): the record names them
    appendSignedRegistryRow(home, deviceRow, deviceSig);
    if (rotation) {
      appendIdentityJournal(home, { op: 'rotate', row: rotation.row, signer: existing!.rootKeyId, statement: rotation.statement, sig: rotation.sig });
      io.stderr.write(`${JSON.stringify({ logged: 'identity.rotate', from: existing!.rootKeyId, to: root.rootKeyId, signedByOldRoot: true })}\n`);
    }
    if (mode === 'recover') {
      appendIdentityJournal(home, { op: 'recover', lostRoot: existing!.rootKeyId, lostNs: existing!.ns, newRoot: root.rootKeyId, newNs: root.ns, signedByLostRoot: false, at: rec.createdAt });
      io.stderr.write(`${JSON.stringify({ logged: 'identity.recover', lost: existing!.rootKeyId, newRoot: root.rootKeyId, newNamespace: root.ns, signedByLostRoot: false })}\n`);
    }
    appendIdentityJournal(home, { op: mode === 'init' ? 'init' : mode === 'rotate' ? 'rotated' : 'recovered', gen, rootKeyId: root.rootKeyId, approvalsKeyId: row.keyId, principalId, deviceId: rec.deviceId, at: rec.createdAt });
    // Aegis round 3 (optional): offer to retire the old generation's keys in the same run. Never automatic:
    // each delete is a fresh touch, and a decline or failure leaves the rotate itself done.
    let purgedOld: string[] | null = null;
    if (mode === 'rotate' && (deps.confirmPurge || (deps.isTty ?? io.stdin.isTTY === true))) {
      io.stderr.write(`Delete the OLD generation ${existing!.gen} from the Secure Enclave now (one touch per key)? Type "purge" to delete, anything else to keep it:\n> `);
      const ans = await (deps.confirmPurge ?? (() => readLine(io.stdin)))();
      if (ans === 'purge') {
        purgedOld = [];
        for (const k of ['approvals', 'root'] as const) {
          try {
            io.stderr.write(`Touch ID: delete the old ${k} key of generation ${existing!.gen}\n`);
            await helper.request({ op: 'key.delete', key: k, gen: existing!.gen, reason: `Gnomon: delete the old ${k} key of generation ${existing!.gen}` }, 120_000);
            purgedOld.push(k);
          } catch {
            break; // reported: the remaining key stays, purge-keys can remove it later
          }
        }
        appendIdentityJournal(home, { op: 'purge', gen: existing!.gen, deleted: purgedOld, at: new Date().toISOString() });
      }
    }
    say(io, {
      provisioned: true,
      home,
      rootKeyId: root.rootKeyId,
      ns: root.ns,
      principalId,
      deviceId: rec.deviceId,
      approvalsKeyId: row.keyId,
      helper: pin.exe,
      deviceKey: deviceKeyPath(home),
      mode,
      ...(mode === 'rotate' ? { retiredGen: existing!.gen, ...(purgedOld?.length === 2 ? { purgedOld } : { purge: `gnomon identity purge-keys --gen ${existing!.gen}`, ...(purgedOld ? { purgedOld } : {}) }) } : {}),
    });
    return EXIT_OK;
  } catch (e) {
    let leftover: string | null = null;
    if (!recordWritten) {
      // R2: put the old record back exactly as it was
      for (const m of moved.reverse()) {
        try {
          fs.renameSync(m.to, m.from);
        } catch {
          /* reported below */
        }
      }
      // R4: remove the keys this attempt created — through the live helper (no prompt: it created them),
      // else through a FRESH helper, which asks for presence (H2)
      if (created.length) {
        if (!helper.alive) {
          try {
            helper = startHelper();
          } catch {
            /* reported below */
          }
        }
        let ok = true;
        for (const k of [...created].reverse()) {
          try {
            await helper.request({ op: 'key.delete', key: k, gen, reason: 'Gnomon: remove the keys of a failed identity init' });
          } catch {
            ok = false;
          }
        }
        if (!ok) leftover = gen;
      }
    }
    return refused(io, e instanceof Interrupted ? 'interrupted' : 'provision-failed', e instanceof Error ? e.message : 'provisioning failed', {
      recordWritten,
      restored: !recordWritten && moved.length > 0,
      ...(leftover ? { leftoverGen: leftover, purge: `gnomon identity purge-keys --gen ${leftover}` } : { createdKeysDeleted: recordWritten ? [] : created }),
    });
  } finally {
    if (deps.handleSignals !== false) process.off('SIGINT', onSigint);
    await helper.close().catch(() => undefined);
  }
}

/** `gnomon identity purge-keys --gen <g>`: delete one generation's SE keys, each with fresh presence (H2). Never the live identity's. */
async function purgeKeys(argv: readonly string[], io: IdentityIo, deps: IdentityDeps): Promise<number> {
  const args = parse(argv);
  if (typeof args === 'string' || !args.gen) {
    io.stderr.write(`gnomon identity: ${typeof args === 'string' ? args : 'purge-keys needs --gen <gen>'}\n${USAGE}`);
    return EXIT_USAGE;
  }
  const env = deps.env ?? process.env;
  // the same refusals as init (reviewer round 3): kernel-spawned shell (hygiene), a running daemon, a malformed record
  if (env.GNOMON_HSID) return refused(io, 'forbidden', 'gnomon identity purge-keys is a human-only verb; it is refused from a kernel-spawned shell');
  const home = args.home ?? resolveGnomonHome({ env });
  if (daemonState(home).state === 'running') return refused(io, 'daemon-running', 'stop the daemon first');
  let existing: IdentityRecord | null;
  try {
    existing = readIdentity(home);
  } catch (e) {
    // a record we cannot read might name the generation asked for: never purge blind
    return refused(io, 'identity-malformed', e instanceof Error ? e.message : 'identity.json is unreadable', { path: identityPath(home) });
  }
  if (existing?.gen === args.gen) return refused(io, 'in-use', `generation ${args.gen} is this home's live identity; rotate or recover instead`);
  let pin: PinnedHelper;
  try {
    pin = pinHelper(args.helper ?? existing?.helperPath ?? defaultHelperPath(), deps.verifier ? { verifier: deps.verifier } : {});
  } catch (e) {
    return refused(io, 'helper-unavailable', e instanceof Error ? e.message : 'the helper could not be pinned');
  }
  const helper = deps.start ? deps.start(pin) : HelperProcess.start(pin);
  try {
    const held = (await listKeys(helper)).filter((k) => k.gen === args.gen);
    if (!held.length) return refused(io, 'not-found', `no Gnomon keys of generation ${args.gen} in the Secure Enclave`);
    const deleted: string[] = [];
    // approvals first, so the root of the generation is still there to sign the root's own delete statement
    for (const k of ['approvals', 'root'].filter((x) => held.some((h) => h.key === x))) {
      io.stderr.write(`Touch ID: delete the ${k} key of generation ${args.gen}\n`);
      await helper.request({ op: 'key.delete', key: k, gen: args.gen, reason: `Gnomon: delete the ${k} key of generation ${args.gen}` }, 120_000);
      deleted.push(k);
    }
    appendIdentityJournal(home, { op: 'purge', gen: args.gen, deleted, at: new Date().toISOString() });
    say(io, { purged: true, gen: args.gen, deleted });
    return EXIT_OK;
  } catch (e) {
    return refused(io, 'purge-failed', e instanceof Error ? e.message : 'purge failed');
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
