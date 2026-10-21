// @symbol #gnomon-darwin-arm64
// The zipped Gnomon.app for darwin-arm64 (TD-2026-10-21-758; T-2026-10-21-030). packages/gnomon/scripts/release-darwin.mjs
// copies the zip and its .sha256 in at release time; the repo never tracks them. TRUST (Aegis M3 high 2): the zip is
// checked against the sha256 COMPILED INTO @a-company/gnomon (release-manifest:v1 appZips; its verifyAppZip), never
// against the .sha256 file shipped beside it, which is informational only. verifyZip(expected) takes that compiled
// value and refuses a missing argument.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const platform = 'darwin';
export const arch = 'arm64';
/** Absolute path of the ditto zip holding Gnomon.app (ditto -c -k --keepParent; unpack with ditto -x -k). */
export const zipPath = fileURLToPath(new URL('./Gnomon.app.zip', import.meta.url));
/** Absolute path of the informational sha256 line `<hex>  Gnomon.app.zip` (NOT a trust anchor). */
export const sha256Path = `${zipPath}.sha256`;

/** Throws unless the zip hashes to `expectedSha256` (the value compiled into @a-company/gnomon). Returns the digest. */
export function verifyZip(expectedSha256) {
  if (typeof expectedSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(expectedSha256)) throw new Error('verifyZip needs the sha256 compiled into @a-company/gnomon');
  const got = createHash('sha256').update(readFileSync(zipPath)).digest('hex');
  if (got !== expectedSha256) throw new Error(`Gnomon.app.zip hashes to ${got}, not the compiled ${expectedSha256}; refused`);
  return got;
}
