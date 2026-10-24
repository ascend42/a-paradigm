#!/usr/bin/env node
/**
 * @symbol #gnomon-voice
 *
 * Fill our voice-model Release mirror (TD-2026-10-21-758, 8.0 M4). voice-models.manifest.json `mirror` names a
 * GitHub Release (https://github.com/<owner>/<repo>/releases/download/<tag>); `gnomon-voice models fetch` falls back
 * to it when upstream fails and checks its bytes against the SAME pins. This script makes sure the mirror only ever
 * holds files that hash to those pins: it downloads each model from upstream (or reads `--from <dir>`), refuses the
 * whole run if ANY file misses its size or sha256 pin, and only then uploads them with `gh release upload --clobber`.
 *
 *   node packages/gnomon-voice/scripts/mirror-voice-models.mjs [--from <dir>] [--dry-run]
 * Founder-run (needs `gh auth`); the release must exist (`gh release create <tag> --repo <owner>/<repo>`).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const from = argv.includes('--from') ? path.resolve(argv[argv.indexOf('--from') + 1]) : null;
const dryRun = argv.includes('--dry-run');
const say = (m) => process.stderr.write(`mirror-voice-models: ${m}\n`);

const manifest = JSON.parse(readFileSync(path.join(PKG, 'voice-models.manifest.json'), 'utf8'));
const m = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)$/.exec(manifest.mirror ?? '');
if (!m) {
  say(`the manifest's mirror (${manifest.mirror}) is not a GitHub Release download URL`);
  process.exit(1);
}
const [, repo, tag] = m;
const assetName = (url) => path.posix.basename(new URL(url).pathname);

async function sha256Of(file) {
  const h = createHash('sha256');
  for await (const c of createReadStream(file, { highWaterMark: 1 << 20 })) h.update(c);
  return h.digest('hex');
}

const work = mkdtempSync(path.join(os.tmpdir(), 'gnomon-voice-mirror-'));
try {
  const files = [];
  for (const e of manifest.models) {
    const name = assetName(e.url);
    const file = from ? path.join(from, name) : path.join(work, name);
    if (!from) {
      say(`GET ${e.url}`);
      const r = await fetch(e.url, { redirect: 'follow' });
      if (!r.ok) throw new Error(`${e.url}: HTTP ${r.status}`);
      writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    } else if (!existsSync(file)) throw new Error(`${file} is missing`);
    const got = await sha256Of(file);
    const size = statSync(file).size;
    if (got !== e.sha256 || size !== e.size) throw new Error(`${name} hashes to ${got} (${size} bytes), not the pinned ${e.sha256} (${e.size}); nothing is uploaded`);
    files.push(file);
  }
  say(`all ${files.length} assets match their pins`);
  if (dryRun) say(`dry run: would run gh release upload ${tag} --repo ${repo} --clobber ${files.map((f) => path.basename(f)).join(' ')}`);
  else {
    const r = spawnSync('gh', ['release', 'upload', tag, '--repo', repo, '--clobber', ...files], { stdio: 'inherit' });
    if (r.status !== 0) throw new Error(`gh release upload failed (exit ${r.status})`);
    say(`uploaded to ${manifest.mirror}`);
  }
} catch (e) {
  say(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
