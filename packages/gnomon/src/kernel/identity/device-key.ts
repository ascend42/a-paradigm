/**
 * @symbol #identity
 *
 * #identity (spec §3.1: "device key — Ed25519, file 0600 (`~/.gnomon/keys/device.key`),
 * authenticates this device's clients on the socket; cannot approve").
 *
 * Loading is fail-closed: the key file must be a regular file (never a
 * symlink) owned by the current user with no group/other bits, inside a
 * `keys/` directory with the same owner-only posture. Writing creates the file
 * O_EXCL at 0600 (an existing key is never overwritten). Registering the key's
 * public half is a ROOT-signed registry row (registry.ts) — `gnomon key device
 * add` with hardware presence lands with M1.3.
 */
import { generateKeyPairSync } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { currentUid } from '../lifecycle/home.js';
import { SoftwareEd25519Signer } from '../log/signer.js';

export const KEYS_DIR = 'keys';
export const DEVICE_KEY_FILE = 'device.key';

export class DeviceKeyError extends Error {
  constructor(
    readonly reason: 'missing' | 'not-a-file' | 'owner' | 'mode' | 'dir-mode' | 'not-ed25519',
    message: string,
  ) {
    super(`#identity: ${message}`);
    this.name = 'DeviceKeyError';
  }
}

export function keysDir(home: string): string {
  return path.join(home, KEYS_DIR);
}

export function deviceKeyPath(home: string): string {
  return path.join(keysDir(home), DEVICE_KEY_FILE);
}

function checkOwnerOnly(p: string, st: fs.Stats, what: 'file' | 'dir'): void {
  const uid = currentUid();
  if (uid !== null && st.uid !== uid) throw new DeviceKeyError('owner', `${p} is owned by uid ${st.uid}, not ${uid}`);
  if ((st.mode & 0o077) !== 0) {
    throw new DeviceKeyError(what === 'dir' ? 'dir-mode' : 'mode', `${p} mode ${(st.mode & 0o777).toString(8)} is not owner-only`);
  }
}

/** Create `<home>/keys` 0700 (mode read back). */
export function ensureKeysDir(home: string): string {
  const dir = keysDir(home);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const st = fs.lstatSync(dir);
  if (!st.isDirectory()) throw new DeviceKeyError('not-a-file', `${dir} is not a directory`);
  checkOwnerOnly(dir, st, 'dir');
  return dir;
}

/** Load this device's key as a `device`-class signer (auth + event domains only). */
export function loadDeviceKey(home: string, file: string = deviceKeyPath(home)): SoftwareEd25519Signer {
  const dir = path.dirname(file);
  let dst: fs.Stats;
  let st: fs.Stats;
  try {
    dst = fs.lstatSync(dir);
    st = fs.lstatSync(file);
  } catch {
    throw new DeviceKeyError('missing', `no device key at ${file}`);
  }
  if (!dst.isDirectory()) throw new DeviceKeyError('not-a-file', `${dir} is not a directory`);
  checkOwnerOnly(dir, dst, 'dir');
  if (!st.isFile()) throw new DeviceKeyError('not-a-file', `${file} is not a regular file`);
  checkOwnerOnly(file, st, 'file');
  try {
    return new SoftwareEd25519Signer(fs.readFileSync(file, 'utf8'), 'device');
  } catch {
    throw new DeviceKeyError('not-ed25519', `${file} is not an Ed25519 private key`);
  }
}

/** Generate and write a device key O_EXCL at 0600; refuses if one exists. */
export function writeNewDeviceKey(home: string, file: string = deviceKeyPath(home)): SoftwareEd25519Signer {
  if (file === deviceKeyPath(home)) ensureKeysDir(home);
  const { privateKey } = generateKeyPairSync('ed25519');
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try {
    fs.writeFileSync(fd, pem);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(file, 0o600);
  return loadDeviceKey(home, file);
}
