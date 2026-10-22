/**
 * @symbol #dev-launch
 *
 * #dev-launch (spec §2.4 rule 6) — the DEV home behind `gnomon dev init` and
 * `gnomon dev up`: the unsigned, DEV-ONLY dogfood path until #identity M1.3
 * (hardware root, signed helper). NEVER PRODUCTION.
 *
 * A dev home holds a SOFTWARE P-256 root (DevTestRootAuthority, behind the
 * literal DEV_TEST_ROOT_ACK), a software kernel key, a device key and the
 * root-signed registry rows for the kernel key and ONE human device. Every
 * key file is O_EXCL 0600 in the owner-only `<home>/keys/` dir (which the
 * `session` profile read-denies). The marker `<home>/DEV-ONLY-gnomon-home.json`
 * is written LAST, so a half-provisioned home has no marker and every later
 * init/up refuses it (fail closed).
 *
 * GUARDS (each has a falsifier in test/dev-launch.test.ts):
 *   - the production home (`~/.gnomon`, and anything inside it or containing
 *     it) is refused: `production-home`;
 *   - a home whose `keys/registry.jsonl` this tool did not write (no marker) is
 *     refused: `production-root` — it may be signed by the production root;
 *   - any other non-empty unmarked home is refused: `home-not-empty`;
 *   - `up` loads only a home whose marker carries the ack, whose root and
 *     kernel keys match the marker, and whose registry resolves with ZERO
 *     rejected rows: else `not-a-dev-home` / `dev-home-damaged`.
 * Nothing here is read by `gnomond` or by `startDaemon` on its own: the
 * production daemon's root stays UnprovisionedRootAuthority whatever files a
 * home holds. No key or PEM is ever printed or logged.
 */
import { createPrivateKey, generateKeyPairSync } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  DEV_TEST_ROOT_ACK,
  DevTestRootAuthority,
  ensureKeysDir,
  keysDir,
  readRegistry,
  registerDevice,
  registerKernelKey,
  registryPath,
  writeNewDeviceKey,
  deviceKeyPath,
} from '../kernel/identity/index.js';
import { currentUid, ensureGnomonHome } from '../kernel/lifecycle/home.js';
import { SoftwareEd25519Signer } from '../kernel/log/signer.js';
import { isOwnerOnly } from '../platform/owner-only.js';

export const DEV_HOME_SCHEMA = 'gnomon-dev-home:v1' as const;
export const DEV_HOME_MARKER = 'DEV-ONLY-gnomon-home.json';
export const DEV_ROOT_KEY_FILE = 'DEV-ONLY-root-p256.pem';
export const DEV_KERNEL_KEY_FILE = 'DEV-ONLY-kernel-ed25519.pem';
export const DEV_HOME_DIRNAME = '.gnomon-dev';
export const DEV_PRINCIPAL_NAME = 'founder';

export type DevHomeRefusalReason = 'unsafe-home' | 'production-home' | 'production-root' | 'home-not-empty' | 'not-a-dev-home' | 'dev-home-damaged';

export class DevHomeRefusal extends Error {
  constructor(
    readonly reason: DevHomeRefusalReason,
    message: string,
    readonly next: readonly string[] = [],
  ) {
    super(message);
    this.name = 'DevHomeRefusal';
  }
}

export interface DevHomeRecord {
  schemaVersion: typeof DEV_HOME_SCHEMA;
  ack: typeof DEV_TEST_ROOT_ACK;
  notice: string;
  rootKeyId: string;
  kernelKeyId: string;
  deviceId: string;
  principalId: string;
  createdAt: string;
}

export interface LoadedDevHome {
  home: string;
  record: DevHomeRecord;
  root: DevTestRootAuthority;
  kernel: SoftwareEd25519Signer;
  kernelKey: { keyId: string; publicKeyPem: string };
  device: { kind: 'device'; deviceId: string; principalId: string; privateKeyPem: string };
}

export interface DevHomeOptions {
  /** The user's home (the production home is `<userHome>/.gnomon`); default os.homedir(). */
  userHome?: string;
  /** Path case-folding follows the platform (darwin folds); default process.platform. */
  platform?: string;
}

/** `~/.gnomon-dev`: the default DEV home. */
export function defaultDevHome(userHome: string = os.homedir()): string {
  return path.join(userHome, DEV_HOME_DIRNAME);
}

const markerPath = (home: string): string => path.join(home, DEV_HOME_MARKER);
const rootKeyPath = (home: string): string => path.join(keysDir(home), DEV_ROOT_KEY_FILE);
const kernelKeyPath = (home: string): string => path.join(keysDir(home), DEV_KERNEL_KEY_FILE);

/** realpath of `p`, or of its nearest existing ancestor with the rest re-joined (the home may not exist yet). */
function realLoose(p: string): string {
  const rest: string[] = [];
  let cur = path.resolve(p);
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(cur), ...rest.reverse());
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return path.resolve(p);
      rest.push(path.basename(cur));
      cur = parent;
    }
  }
}

const within = (inner: string, outer: string): boolean => inner === outer || inner.startsWith(outer.endsWith(path.sep) ? outer : `${outer}${path.sep}`);

/**
 * Every spelling of the production home that must be refused: `<userHome>/.gnomon` lexically and
 * realpath'd, and, when it is a symlink (dangling included), its link target lexically and realpath'd.
 */
function productionHomes(userHome: string): string[] {
  const raw = path.join(userHome, '.gnomon');
  const out = new Set<string>([path.resolve(raw), realLoose(raw)]);
  let st: fs.Stats | null = null;
  try {
    st = fs.lstatSync(raw);
  } catch {
    st = null;
  }
  if (st?.isSymbolicLink()) {
    const target = path.resolve(path.dirname(raw), fs.readlinkSync(raw));
    out.add(target);
    out.add(realLoose(target));
  }
  return [...out];
}

/**
 * Refuse the production home (and anything inside it or containing it). On darwin the
 * comparison is case-folded on darwin and win32 (APFS and NTFS are case-insensitive by default), so `~/.GNOMON` is refused
 * even before `~/.gnomon` exists.
 */
export function refuseProductionHome(home: string, opts: DevHomeOptions = {}): string {
  if (!path.isAbsolute(home)) throw new DevHomeRefusal('unsafe-home', `--home must be an absolute path`, ['gnomon dev init --home /absolute/path']);
  const plat = opts.platform ?? process.platform;
  const fold = plat === 'darwin' || plat === 'win32' ? (p: string): string => p.toLowerCase() : (p: string): string => p;
  const mine = [path.resolve(home), realLoose(home)].map(fold);
  const prods = productionHomes(opts.userHome ?? os.homedir()).map(fold);
  if (mine.some((m) => prods.some((q) => within(m, q) || within(q, m)))) {
    throw new DevHomeRefusal('production-home', `${home} is (or holds) the production Gnomon home; the dev path never touches it`, [
      `use the default dev home: gnomon dev init   (${DEV_HOME_DIRNAME} in your home)`,
      'or name another one: gnomon dev init --home /absolute/dev/path',
    ]);
  }
  return realLoose(home);
}

/** A dev home is a plain directory, never a symlink. */
function refuseSymlinkHome(home: string): void {
  let st: fs.Stats | null = null;
  try {
    st = fs.lstatSync(home);
  } catch {
    return;
  }
  if (st.isSymbolicLink()) throw new DevHomeRefusal('unsafe-home', `${home} is a symlink; a dev home must be a plain directory`, ['name the real directory with --home']);
}

/** Read an owner-only regular file inside the owner-only keys dir (the device-key posture). */
function readOwnerOnly(file: string): string {
  const uid = currentUid();
  for (const [p, dir] of [[path.dirname(file), true], [file, false]] as const) {
    let st: fs.Stats;
    try {
      st = fs.lstatSync(p);
    } catch {
      throw new DevHomeRefusal('dev-home-damaged', `missing ${path.basename(p)}`);
    }
    if (dir ? !st.isDirectory() : !st.isFile()) throw new DevHomeRefusal('dev-home-damaged', `${path.basename(p)} is not a plain ${dir ? 'directory' : 'file'}`);
    if (uid !== null && st.uid !== uid) throw new DevHomeRefusal('dev-home-damaged', `${path.basename(p)} is not owned by you`);
    if (!isOwnerOnly(p, st, { strict: true })) throw new DevHomeRefusal('dev-home-damaged', `${path.basename(p)} is not owner-only`);
  }
  return fs.readFileSync(file, 'utf8');
}

function writeExcl(file: string, text: string): void {
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try {
    fs.writeFileSync(fd, text);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(file, 0o600);
}

/** A registry-safe device host label from the machine name. */
export function deviceHostLabel(hostname: string = os.hostname()): string {
  const s = hostname.split('.')[0]!.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 64);
  return s.length > 0 ? s : 'dev-mac';
}

/** The hint every unmarked-home refusal carries (a half-provisioned home has no marker by design). */
export function interruptedInitHint(home: string): string {
  return `if this is an interrupted \`gnomon dev init\`, remove ${home} and re-run gnomon dev init`;
}

/** A dev root key without the marker: `gnomon dev init` stopped before its last write. */
function looksInterrupted(home: string): boolean {
  return fs.existsSync(rootKeyPath(home)) && !fs.existsSync(markerPath(home));
}

/** Is `home` an initialized dev home (marker present)? */
export function isDevHome(home: string): boolean {
  return fs.existsSync(markerPath(home));
}

/**
 * `gnomon dev init`: provision a DEV home. Refuses the production home, a home
 * holding a registry this tool did not write, and any other non-empty
 * unmarked home. Returns `{created:false}` for an already-initialized dev
 * home that loads cleanly.
 */
export function provisionDevHome(home: string, opts: DevHomeOptions & { host?: string; now?: Date } = {}): { created: boolean; loaded: LoadedDevHome } {
  refuseProductionHome(home, opts);
  refuseSymlinkHome(home);
  if (isDevHome(home)) return { created: false, loaded: loadDevHome(home, opts) };
  if (fs.existsSync(home)) {
    const st = fs.lstatSync(home);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new DevHomeRefusal('unsafe-home', `${home} is not a plain directory`);
    if (looksInterrupted(home)) {
      throw new DevHomeRefusal('home-not-empty', `${home} is a half-provisioned dev home (a dev root key, no ${DEV_HOME_MARKER}): an earlier gnomon dev init was interrupted`, [interruptedInitHint(home)]);
    }
    if (fs.existsSync(registryPath(home))) {
      throw new DevHomeRefusal('production-root', `${home} holds a key registry that gnomon dev init did not write; it may be signed by a production root`, [
        'pick another --home; the dev path never adds a dev root beside another root',
        interruptedInitHint(home),
      ]);
    }
    if (fs.readdirSync(home).length > 0) {
      throw new DevHomeRefusal('home-not-empty', `${home} is not empty and is not a dev home`, ['pick an empty or new --home', interruptedInitHint(home)]);
    }
  }
  ensureGnomonHome(home);
  ensureKeysDir(home);
  const now = opts.now ?? new Date();
  const root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK);
  writeExcl(rootKeyPath(home), root.exportPrivateKeyPem(DEV_TEST_ROOT_ACK));
  const kernelPem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  writeExcl(kernelKeyPath(home), kernelPem);
  const kernel = new SoftwareEd25519Signer(kernelPem, 'kernel');
  const kernelKeyId = registerKernelKey(home, root, kernel.publicKeyPem, now);
  const device = writeNewDeviceKey(home);
  const entry = registerDevice(home, root, { host: opts.host ?? deviceHostLabel(), name: DEV_PRINCIPAL_NAME, principalKind: 'human', publicKeyPem: device.publicKeyPem, now });
  const record: DevHomeRecord = {
    schemaVersion: DEV_HOME_SCHEMA,
    ack: DEV_TEST_ROOT_ACK,
    notice: 'DEV ONLY: software root, kernel and device keys for the unsigned dogfood path (gnomon dev up). Never a production home.',
    rootKeyId: root.rootKeyId,
    kernelKeyId,
    deviceId: entry.deviceId,
    principalId: entry.principalId,
    createdAt: now.toISOString(),
  };
  writeExcl(markerPath(home), `${JSON.stringify(record, null, 2)}\n`); // LAST: no marker ⇒ not a dev home
  return { created: true, loaded: loadDevHome(home, opts) };
}

/** `gnomon dev up`: load and verify a DEV home (fail closed). */
export function loadDevHome(home: string, opts: DevHomeOptions = {}): LoadedDevHome {
  refuseProductionHome(home, opts);
  refuseSymlinkHome(home);
  let record: DevHomeRecord;
  try {
    record = JSON.parse(fs.readFileSync(markerPath(home), 'utf8')) as DevHomeRecord;
  } catch {
    throw new DevHomeRefusal('not-a-dev-home', `${home} has no readable ${DEV_HOME_MARKER}${looksInterrupted(home) ? ' (a dev root key is there: an earlier gnomon dev init was interrupted)' : ''}`, ['gnomon dev init' + (home === defaultDevHome(opts.userHome) ? '' : ` --home ${home}`), interruptedInitHint(home)]);
  }
  if (record?.schemaVersion !== DEV_HOME_SCHEMA || record.ack !== DEV_TEST_ROOT_ACK) {
    throw new DevHomeRefusal('not-a-dev-home', `${DEV_HOME_MARKER} in ${home} does not carry the dev-test acknowledgement`);
  }
  const damaged = (why: string): DevHomeRefusal =>
    new DevHomeRefusal('dev-home-damaged', `the dev home ${home} does not verify: ${why}`, [`remove ${home} and run gnomon dev init again (it is dev-only state)`]);
  let root: DevTestRootAuthority;
  let kernel: SoftwareEd25519Signer;
  try {
    root = new DevTestRootAuthority(DEV_TEST_ROOT_ACK, { privateKeyPem: readOwnerOnly(rootKeyPath(home)) });
    kernel = new SoftwareEd25519Signer(readOwnerOnly(kernelKeyPath(home)), 'kernel');
  } catch (e) {
    throw damaged(e instanceof DevHomeRefusal ? e.message : 'a key file does not parse');
  }
  if (root.rootKeyId !== record.rootKeyId) throw damaged('the root key is not the one the marker names');
  if (kernel.keyId !== record.kernelKeyId) throw damaged('the kernel key is not the one the marker names');
  const reg = readRegistry(home, root);
  if (reg.rejected.length > 0) throw damaged(`${reg.rejected.length} registry row(s) do not verify against the dev root (${[...new Set(reg.rejected.map((r) => r.reason))].join(', ')})`);
  if (reg.kernelKeys.get(kernel.keyId) !== kernel.publicKeyPem) throw damaged('the kernel key has no registry row');
  const dev = reg.devices.get(record.deviceId);
  // the device key is read ONCE, through the owner-only check, and those same bytes are both verified and handed out
  let devicePem: string;
  let deviceSigner: SoftwareEd25519Signer;
  try {
    devicePem = readOwnerOnly(deviceKeyPath(home));
    deviceSigner = new SoftwareEd25519Signer(devicePem, 'device');
  } catch (e) {
    throw damaged(e instanceof DevHomeRefusal ? e.message : 'the device key does not load');
  }
  if (!dev || dev.principalKind !== 'human' || dev.principalId !== record.principalId || dev.keyId !== deviceSigner.keyId) throw damaged('the device has no matching human registry row');
  return {
    home,
    record,
    root,
    kernel,
    kernelKey: { keyId: kernel.keyId, publicKeyPem: kernel.publicKeyPem },
    device: { kind: 'device', deviceId: dev.deviceId, principalId: dev.principalId, privateKeyPem: devicePem },
  };
}

/** Self-check for the PEM shape (used by tests to prove output never carries key material). */
export function looksLikeKeyMaterial(s: string): boolean {
  if (/PRIVATE KEY/.test(s)) return true;
  try {
    createPrivateKey(s);
    return true;
  } catch {
    return false;
  }
}
