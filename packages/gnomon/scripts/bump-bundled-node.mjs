#!/usr/bin/env node
/**
 * @symbol #release-darwin
 *
 * Pin the Node that Gnomon.app bundles (T-2026-10-21-029, Aegis M2 review: node supply chain). The ONLY writer of
 * packages/gnomon-wrapper/bundled-node.lock.json:
 *
 *   node packages/gnomon/scripts/bump-bundled-node.mjs --version 24.x.y
 *
 *   1. downloads https://nodejs.org/dist/v<version>/SHASUMS256.txt and SHASUMS256.txt.sig;
 *   2. imports exactly the release keys vendored in packages/gnomon-wrapper/node-release-keys.json (each armored key
 *      fetched by fingerprint and REFUSED unless gpg reports that fingerprint imported) into a throwaway GNUPGHOME;
 *   3. `gpg --verify` the signature; the VALIDSIG primary-key fingerprint must be one of the vendored ones;
 *   4. takes the darwin-arm64 and darwin-x64 .tar.gz hashes from the verified SHASUMS256.txt, downloads both
 *      tarballs and checks them against it;
 *   5. writes the lock with its provenance (method gpg-shasums256, the signer fingerprint, the SHASUMS256.txt sha256).
 * release-darwin.mjs refuses a lock without that provenance or with a signer outside the vendored list.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, renameSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WRAPPER = path.join(PKG, '..', 'gnomon-wrapper');
export const RELEASE_KEYS = path.join(WRAPPER, 'node-release-keys.json');
export const NODE_LOCK = path.join(WRAPPER, 'bundled-node.lock.json');
export const PROVENANCE_METHOD = 'gpg-shasums256';
const DIST = 'https://nodejs.org/dist';

export function releaseKeyFingerprints(file = RELEASE_KEYS) {
  const k = JSON.parse(readFileSync(file, 'utf8'));
  if (k.schema !== 'gnomon-node-release-keys:v1' || !Array.isArray(k.fingerprints) || !k.fingerprints.every((f) => /^[0-9A-F]{40}$/.test(f))) throw new Error(`${file}: malformed release keys`);
  return { source: k.source, fingerprints: k.fingerprints };
}

/** The `VALIDSIG` primary-key fingerprint from gpg --status-fd output, or null. */
export function validSigner(status) {
  const m = /^\[GNUPG:\] VALIDSIG (?:\S+ ){9}([0-9A-F]{40})\s*$/m.exec(status);
  return m ? m[1] : null;
}

/** The darwin .tar.gz entries of a SHASUMS256.txt for `version`. */
export function darwinEntries(shasums, version) {
  const out = {};
  for (const arch of ['arm64', 'x64']) {
    const file = `node-v${version}-darwin-${arch}.tar.gz`;
    const m = new RegExp(`^([0-9a-f]{64})\\s+${file.replace(/\./g, '\\.')}$`, 'm').exec(shasums);
    if (!m) throw new Error(`SHASUMS256.txt has no ${file}`);
    out[`darwin-${arch}`] = { file, sha256: m[1] };
  }
  return out;
}

async function get(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url}: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

const sha = (b) => createHash('sha256').update(b).digest('hex');

async function bump(version) {
  if (!/^24\.\d+\.\d+$/.test(version ?? '')) throw new Error('--version 24.x.y is required (the bundled node is a pinned 24.x)');
  const keys = releaseKeyFingerprints();
  const gnupg = mkdtempSync(path.join(os.tmpdir(), 'gnomon-node-keys-'));
  try {
    const gpg = (args, input) => spawnSync('gpg', ['--homedir', gnupg, '--batch', '--no-autostart', '--status-fd', '1', ...args], { input, encoding: 'utf8' });
    for (const fpr of keys.fingerprints) {
      const r = gpg(['--import'], await get(`${keys.source}/${fpr}.asc`));
      if (!new RegExp(`IMPORT_OK \\d+ ${fpr}`).test(r.stdout)) throw new Error(`the armored key for ${fpr} did not import as that fingerprint`);
    }
    const shasums = await get(`${DIST}/v${version}/SHASUMS256.txt`);
    const sig = await get(`${DIST}/v${version}/SHASUMS256.txt.sig`);
    writeFileSync(path.join(gnupg, 'SHASUMS256.txt'), shasums);
    writeFileSync(path.join(gnupg, 'SHASUMS256.txt.sig'), sig);
    const v = gpg(['--verify', path.join(gnupg, 'SHASUMS256.txt.sig'), path.join(gnupg, 'SHASUMS256.txt')]);
    const signer = validSigner(v.stdout);
    if (v.status !== 0 || !signer || !keys.fingerprints.includes(signer)) throw new Error(`SHASUMS256.txt.sig does not verify against the vendored Node release keys (${signer ?? 'no valid signature'})`);
    const artifacts = darwinEntries(shasums.toString('utf8'), version);
    for (const a of Object.values(artifacts)) {
      const got = sha(await get(`${DIST}/v${version}/${a.file}`));
      if (got !== a.sha256) throw new Error(`${a.file} hashes to ${got}, not the signed SHASUMS256.txt's ${a.sha256}`);
    }
    const lock = {
      schema: 'gnomon-bundled-node-lock:v1',
      comment: 'Written ONLY by packages/gnomon/scripts/bump-bundled-node.mjs (never by hand): SHASUMS256.txt verified with gpg against packages/gnomon-wrapper/node-release-keys.json, both tarballs checked against it. release-darwin.mjs downloads <base>/v<version>/<file> and refuses it unless its sha256 equals the pin.',
      version,
      base: DIST,
      artifacts,
      provenance: { method: PROVENANCE_METHOD, signer, shasumsSha256: sha(shasums), keysSha256: sha(readFileSync(RELEASE_KEYS)), verifiedAt: new Date().toISOString() },
    };
    writeFileSync(`${NODE_LOCK}.part`, `${JSON.stringify(lock, null, 2)}\n`);
    renameSync(`${NODE_LOCK}.part`, NODE_LOCK);
    return lock;
  } finally {
    rmSync(gnupg, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--version');
  bump(i >= 0 ? process.argv[i + 1] : undefined).then(
    (l) => process.stdout.write(`${JSON.stringify({ lock: NODE_LOCK, version: l.version, signer: l.provenance.signer }, null, 2)}\n`),
    (e) => {
      process.stderr.write(`bump-bundled-node: ${e instanceof Error ? e.message : String(e)}\n`);
      process.exitCode = 1;
    },
  );
}
