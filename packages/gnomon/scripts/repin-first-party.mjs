#!/usr/bin/env node
// repin:first-party — after an intended edit to a first-party mod
// (packages/gnomon-mods/*): regenerate the Workshop's golden renders from its
// pure model. Then the packageHash test (test/workshop-mod.test.ts, the
// kernel's own hash code) prints the new hash to pin in
// src/kernel/manifest/install.ts FIRST_PARTY_PACKAGE_HASHES; a stale pin never
// passes CI.
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mods = path.resolve(here, '..', '..', 'gnomon-mods');
const workshop = path.join(mods, 'workshop');

const { apply, emptyState, render } = await import(pathToFileURL(path.join(workshop, 'model.mjs')).href);
for (const f of fs.readdirSync(path.join(workshop, 'fixtures')).filter((n) => n.endsWith('.json') && !n.endsWith('.golden.json')).sort()) {
  const fx = JSON.parse(fs.readFileSync(path.join(workshop, 'fixtures', f), 'utf8'));
  const s = emptyState();
  for (const e of fx.input?.fixtureEvents ?? []) apply(s, e);
  const out = path.join(workshop, 'fixtures', f.replace(/\.json$/, '.golden.json'));
  fs.writeFileSync(out, `${JSON.stringify({ schemaVersion: 'display-block:v1', ...render(s, fx.prefs ?? {}) }, null, 2)}\n`);
  process.stdout.write(`golden  ${path.relative(mods, out)}\n`);
}
process.stdout.write('now run: npx vitest run test/workshop-mod.test.ts -t packageHash  (it prints the new hash to pin)\n');
