#!/usr/bin/env node
// repin:first-party — after an intended edit to a first-party mod
// (packages/gnomon-mods/*): regenerate the golden renders of the Workshop and
// the Ledger from their pure models. Then the packageHash tests
// (test/workshop-mod.test.ts, test/ledger-mod.test.ts, the kernel's own hash
// code) print the new hash to pin in src/kernel/manifest/install.ts
// FIRST_PARTY_PACKAGE_HASHES; a stale pin never passes CI.
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mods = path.resolve(here, '..', '..', 'gnomon-mods');

for (const mod of ['workshop', 'ledger']) {
  const dir = path.join(mods, mod);
  const model = await import(pathToFileURL(path.join(dir, 'model.mjs')).href);
  for (const f of fs.readdirSync(path.join(dir, 'fixtures')).filter((n) => n.endsWith('.json') && !n.endsWith('.golden.json')).sort()) {
    const fx = JSON.parse(fs.readFileSync(path.join(dir, 'fixtures', f), 'utf8'));
    const s = model.emptyState();
    for (const e of fx.input?.fixtureEvents ?? []) model.apply(s, e);
    // the Workshop has one view (render); the Ledger names its view per fixture (VIEWS[fx.view])
    const block = model.VIEWS ? model.VIEWS[fx.view](s, fx.prefs ?? {}, { ...(typeof fx.input?.hsid === 'string' ? { hsid: fx.input.hsid } : {}) }) : model.render(s, fx.prefs ?? {});
    const out = path.join(dir, 'fixtures', f.replace(/\.json$/, '.golden.json'));
    fs.writeFileSync(out, `${JSON.stringify({ schemaVersion: 'display-block:v1', ...block }, null, 2)}\n`);
    process.stdout.write(`golden  ${path.relative(mods, out)}\n`);
  }
}
process.stdout.write('now run: npx vitest run test/workshop-mod.test.ts test/ledger-mod.test.ts -t packageHash  (it prints the new hash to pin)\n');
