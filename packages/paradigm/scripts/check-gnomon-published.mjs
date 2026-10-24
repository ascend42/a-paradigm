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
import { spawnSync } from 'node:child_process';
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

// Always ask for --json and parse it: inside `npm publish --json` (changesets runs exactly that) npm hands
// npm_config_json=true to this lifecycle script, so a plain `npm view … version` prints "8.0.2" WITH quotes and a
// string compare reports a published version as missing (8.0.2 release). Same contract as scripts/release.mjs
// npmHasVersion: E404 means not published; any other failure fails closed with npm's own words.
const r = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['view', `@a-company/gnomon@${want}`, 'version', '--json'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
const out = String(r.stdout ?? '').trim();
let published = false;
if (r.status === 0) {
  let v = '';
  try {
    v = out === '' ? '' : JSON.parse(out);
  } catch {
    fail(`npm view @a-company/gnomon@${want} returned unparseable output: ${out.slice(0, 200)}`);
  }
  published = Array.isArray(v) ? v.includes(want) : v === want;
} else {
  const text = `${out}\n${String(r.stderr ?? '')}`;
  if (!/\bE404\b/.test(text)) fail(`cannot confirm @a-company/gnomon@${want} is on npm (npm view exit ${r.status ?? r.signal}): ${text.trim().split('\n').slice(-3).join(' | ')}`);
}
if (!published) {
  fail(`@a-company/gnomon@${want} is not on npm. Publish Gnomon first (npm run publish:gnomon from the repo root), then paradigm.`);
}
