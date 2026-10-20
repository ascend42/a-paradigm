#!/usr/bin/env node
/**
 * @symbol #gnomon-voice
 *
 * After tsup (Aegis V2e M2, TOFU closed): write dist/voice-client.manifest.json
 * {schemaVersion, files: {<package-relative path>: <sha256 hex>}} over EVERY dist file except the manifest itself,
 * plus the package-root files the client reads at runtime (ROOT_FILES). The
 * gnomon kernel's build stamp (packages/gnomon/scripts/build-stamp.mjs) records the sha256 of this manifest, so a
 * kernel only ever copies and spawns the voice client its own build was made with. Build order: gnomon-voice, then
 * gnomon (root build:gnomon).
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST = 'voice-client.manifest.json';
/** package-root files the client reads at runtime (manifest.ts loadManifest) */
export const ROOT_FILES = ['voice-models.manifest.json'];
const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(pkg, 'dist');

function walk(dir, rel = '') {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), r));
    else if (e.isFile() && r !== MANIFEST && !r.startsWith(`${MANIFEST}.`)) out.push(r);
  }
  return out;
}

const files = {};
for (const r of walk(dist).sort()) files[`dist/${r}`] = createHash('sha256').update(readFileSync(path.join(dist, r))).digest('hex');
for (const r of ROOT_FILES) files[r] = createHash('sha256').update(readFileSync(path.join(pkg, r))).digest('hex');
const body = `${JSON.stringify({ schemaVersion: 'gnomon-voice-client:v1', files })}\n`;
const tmp = path.join(dist, `${MANIFEST}.${process.pid}.tmp`);
writeFileSync(tmp, body, { mode: 0o644 });
renameSync(tmp, path.join(dist, MANIFEST));
process.stdout.write(`voice-manifest: ${Object.keys(files).length} files sha256:${createHash('sha256').update(body).digest('hex').slice(0, 12)}\n`);
