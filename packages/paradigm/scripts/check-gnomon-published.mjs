#!/usr/bin/env node
/**
 * @symbol #publish-gnomon
 *
 * prepublishOnly guard for @a-company/paradigm. Paradigm 8 depends on an exact @a-company/gnomon version;
 * publishing paradigm before that version is on npm breaks every new install (it happened on 2026-10-22:
 * paradigm 8.0.0 went out first and had to be unpublished, burning the version). A direct `npm publish` in
 * packages/paradigm skips scripts/release.mjs, so the check lives here too. Set PARADIGM_SKIP_GNOMON_CHECK=1
 * only for a dry run.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
const want = pkg.dependencies?.['@a-company/gnomon'];

function fail(msg) {
  process.stderr.write(`check-gnomon-published: ${msg}\n`);
  process.exit(1);
}

if (process.env.PARADIGM_SKIP_GNOMON_CHECK === '1') process.exit(0);
if (!want) process.exit(0); // no gnomon dependency (7.x): nothing to check
if (!/^\d+\.\d+\.\d+$/.test(want)) fail(`@a-company/gnomon must be an exact version, got "${want}"`);

let published;
try {
  published = execFileSync('npm', ['view', `@a-company/gnomon@${want}`, 'version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
} catch {
  published = '';
}
if (published !== want) {
  fail(`@a-company/gnomon@${want} is not on npm. Publish Gnomon first (npm run publish:gnomon from the repo root), then paradigm.`);
}
