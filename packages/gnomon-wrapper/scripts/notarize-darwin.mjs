#!/usr/bin/env node
// Notarize + staple the signed Gnomon.app (#gnomon-wrapper, OPEN 1, P8-D70).
// OPTIONAL, founder-run, never by tests or CI:
//
//   node packages/gnomon-wrapper/scripts/notarize-darwin.mjs [--app <path to Gnomon.app>]
//
// Uses the notarytool keychain profile `gnomon-notary` (validated by probe
// P00); no credential is read, passed or printed by this script.
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NOTARY_PROFILE, run } from '../../gnomon-helper/scripts/signing.mjs';
import { APP_PATH, WRAPPER_REQUIREMENT } from './build-darwin.mjs';

function fail(m) {
  process.stderr.write(`gnomon-wrapper notarize: ${m}\n`);
  process.exit(1);
}

if (process.platform !== 'darwin') fail('notarization runs on macOS only');
const i = process.argv.indexOf('--app');
const app = path.resolve(i >= 0 ? process.argv[i + 1] : APP_PATH);

const req = run('/usr/bin/codesign', ['--verify', '--strict', `-R=${WRAPPER_REQUIREMENT}`, app]);
if (req.status !== 0) fail(`${app} is not the Developer-ID-signed wrapper (run scripts/build-darwin.mjs without --unsigned first): ${req.stderr.slice(0, 300)}`);

const tmp = mkdtempSync(path.join(os.tmpdir(), 'gnomon-wrapper-notary-')); // per-user $TMPDIR on macOS
const zip = path.join(tmp, 'Gnomon.zip');
try {
  const z = run('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip]);
  if (z.status !== 0) fail(`ditto failed: ${z.stderr}`);
  process.stdout.write('notarytool submit --wait (this takes a few minutes) …\n');
  const sub = run('/usr/bin/xcrun', ['notarytool', 'submit', zip, '--keychain-profile', NOTARY_PROFILE, '--wait', '--output-format', 'json'], { timeout: 1_800_000 });
  let res = null;
  try {
    res = JSON.parse(sub.stdout);
  } catch {
    /* not JSON on error */
  }
  if (sub.status !== 0 || res?.status !== 'Accepted') fail(`notarization did not succeed: ${res?.status ?? sub.stderr.slice(0, 400)}${res?.id ? ` (log: xcrun notarytool log ${res.id} --keychain-profile ${NOTARY_PROFILE})` : ''}`);
  const st = run('/usr/bin/xcrun', ['stapler', 'staple', app]);
  if (st.status !== 0) fail(`stapler failed: ${st.stderr.slice(0, 300)}`);
  const sp = run('/usr/sbin/spctl', ['--assess', '--type', 'execute', '-vv', app]);
  process.stdout.write(`${JSON.stringify({ app, notarization: res.status, id: res.id, spctl: sp.status === 0 ? 'accepted' : sp.stderr.slice(0, 200) }, null, 2)}\n`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
