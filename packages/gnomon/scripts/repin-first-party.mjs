#!/usr/bin/env node
// repin:first-party — after an intended edit to a first-party mod
// (packages/gnomon-mods/*): regenerate the golden renders of the Workshop,
// the Ledger and Paradigm Context from their pure models. Then the packageHash tests
// (test/workshop-mod.test.ts, test/ledger-mod.test.ts, the kernel's own hash
// code) print the new hash to pin in src/kernel/manifest/install.ts
// FIRST_PARTY_PACKAGE_HASHES; a stale pin never passes CI.
import * as fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mods = path.resolve(here, '..', '..', 'gnomon-mods');

for (const mod of ['workshop', 'ledger', 'paradigm-context']) {
  const dir = path.join(mods, mod);
  const model = await import(pathToFileURL(path.join(dir, 'model.mjs')).href);
  for (const f of fs.readdirSync(path.join(dir, 'fixtures')).filter((n) => n.endsWith('.json') && !n.endsWith('.golden.json')).sort()) {
    const fx = JSON.parse(fs.readFileSync(path.join(dir, 'fixtures', f), 'utf8'));
    // Paradigm Context is stateless: its view renders the host-composed input (input.paradigm) directly
    const s = model.emptyState ? model.emptyState() : null;
    if (s) for (const e of fx.input?.fixtureEvents ?? []) model.apply(s, e);
    // the Workshop has one view (render); the Ledger names its view per fixture (VIEWS[fx.view])
    const block = !s ? model.VIEWS[fx.view](fx.input ?? {}, fx.prefs ?? {}) : model.VIEWS ? model.VIEWS[fx.view](s, fx.prefs ?? {}, { ...(typeof fx.input?.hsid === 'string' ? { hsid: fx.input.hsid } : {}) }) : model.render(s, fx.prefs ?? {});
    const out = path.join(dir, 'fixtures', f.replace(/\.json$/, '.golden.json'));
    fs.writeFileSync(out, `${JSON.stringify({ schemaVersion: 'display-block:v1', ...block }, null, 2)}\n`);
    process.stdout.write(`golden  ${path.relative(mods, out)}\n`);
  }
}
// the Desk mods (#neurons-mod, #constellation-mod) have no view: their fixtures are model replies carrying one
// ```offer block, and the golden is what that block resolves to against the mod's own manifest (offer-golden.mjs)
const { offerGolden } = await import(pathToFileURL(path.join(here, 'offer-golden.mjs')).href);
for (const mod of ['neurons', 'constellation']) {
  const dir = path.join(mods, mod);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'gnomon-manifest.json'), 'utf8'));
  for (const f of fs.readdirSync(path.join(dir, 'fixtures')).filter((n) => n.endsWith('.json') && !n.endsWith('.golden.json')).sort()) {
    const fx = JSON.parse(fs.readFileSync(path.join(dir, 'fixtures', f), 'utf8'));
    const out = path.join(dir, 'fixtures', f.replace(/\.json$/, '.golden.json'));
    fs.writeFileSync(out, `${JSON.stringify(offerGolden(manifest, fx.reply), null, 2)}\n`);
    process.stdout.write(`golden  ${path.relative(mods, out)}\n`);
  }
}
process.stdout.write('now run: npx vitest run test/workshop-mod.test.ts test/ledger-mod.test.ts test/paradigm-context-mod.test.ts test/neurons-mod.test.ts test/constellation-mod.test.ts -t packageHash  (it prints the new hash to pin)\n');
