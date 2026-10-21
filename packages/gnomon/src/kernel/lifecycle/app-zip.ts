/**
 * @symbol #gnomon-npm-packaging
 *
 * The published Gnomon.app.zip check (T-2026-10-21-030, TD-2026-10-21-758; Aegis M3 high 2). npm installs the zip in
 * @a-company/gnomon-darwin-<arch>; before ANYTHING unpacks it (the M4 installer, `gnomon app verify`), its sha256
 * must equal the value COMPILED INTO this build (release-manifest:v1 `appZips`, #release-pins). The `.sha256` file
 * shipped beside the zip is never read: whoever can swap the zip can swap that file too.
 *
 *   - release build with an appZips entry for this arch: the zip must hash to it, else refused `checksum`;
 *   - release build without one: refused `unpinned` (a release never degrades to trusting the sidecar);
 *   - broken release: refused `broken`; dev build: refused `dev` (only a published release installs the app).
 * The platform package is resolved from this module, then realpath'd and its package.json name checked, so a
 * planted directory higher in the path or on NODE_PATH that is not the expected package is refused `missing`.
 */
import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, readSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { releaseAppZipFor } from '@a-company/gnomon-contracts';
import { loadedReleasePins, type ReleasePins } from './release-pins.js';

export type AppZipRefusal = 'dev' | 'broken' | 'unpinned' | 'missing' | 'checksum';

export class AppZipRefused extends Error {
  constructor(
    readonly reason: AppZipRefusal,
    message: string,
  ) {
    super(message);
    this.name = 'AppZipRefused';
  }
}

/** The sha256 this build accepts for `arch`'s published zip, or the refusal. */
export function appZipPin(pins: ReleasePins, arch: string): { kind: 'pinned'; sha256: string } | { kind: 'refuse'; reason: AppZipRefusal; why: string } {
  if (pins.mode === 'dev') return { kind: 'refuse', reason: 'dev', why: 'a dev build pins no Gnomon.app zip; only a published release installs the app' };
  if (pins.mode === 'broken') return { kind: 'refuse', reason: 'broken', why: pins.why };
  const sha256 = releaseAppZipFor(pins.manifest, arch);
  if (!sha256) return { kind: 'refuse', reason: 'unpinned', why: `release ${pins.manifest.release} pins no Gnomon.app zip for ${arch}` };
  return { kind: 'pinned', sha256 };
}

/** Streamed sha256 of a file (the zip is tens of MB). */
export function sha256OfFile(file: string): string {
  const h = createHash('sha256');
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.allocUnsafe(1 << 20);
    for (let n = readSync(fd, buf, 0, buf.length, null); n > 0; n = readSync(fd, buf, 0, buf.length, null)) h.update(buf.subarray(0, n));
  } finally {
    closeSync(fd);
  }
  return h.digest('hex');
}

/**
 * The installed @a-company/gnomon-darwin-<arch> zip, resolved from `from` (this module by default). Refused `missing`
 * when npm skipped the package or the resolved package.json is not that package.
 */
export function platformPackageZip(arch: string, from: string = import.meta.url): string {
  const name = `@a-company/gnomon-darwin-${arch}`;
  let pj: string;
  try {
    pj = realpathSync(createRequire(from).resolve(`${name}/package.json`));
  } catch {
    throw new AppZipRefused('missing', `${name} is not installed (Gnomon runs on macOS only in 8.0)`);
  }
  let got: unknown;
  try {
    got = (JSON.parse(readFileSync(pj, 'utf8')) as { name?: unknown }).name;
  } catch {
    got = undefined;
  }
  if (got !== name) throw new AppZipRefused('missing', `${pj} is not ${name}`);
  return path.join(path.dirname(pj), 'Gnomon.app.zip');
}

/** Refuse unless `zipPath` hashes to the sha256 compiled into this build for `arch`. Returns the digest. */
export function verifyAppZip(zipPath: string, { arch = process.arch, pins = loadedReleasePins() }: { arch?: string; pins?: ReleasePins } = {}): string {
  const pin = appZipPin(pins, arch);
  if (pin.kind === 'refuse') throw new AppZipRefused(pin.reason, pin.why);
  let got: string;
  try {
    got = sha256OfFile(zipPath);
  } catch {
    throw new AppZipRefused('missing', `no Gnomon.app zip at ${zipPath}`);
  }
  if (got !== pin.sha256) throw new AppZipRefused('checksum', `${zipPath} hashes to ${got}, not the compiled ${pin.sha256}; refused`);
  return got;
}
