// Materialize the authored catalog (seeds.mjs) → seed-catalog.jsonl (the artifact
// the file-plan §5 names). One JSON object per line, verbatim from the authored
// SEEDS array. Run: node build-catalog.mjs
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEEDS } from './seeds.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'seed-catalog.jsonl');
fs.writeFileSync(out, SEEDS.map((s) => JSON.stringify(s)).join('\n') + '\n');
console.log(`wrote ${SEEDS.length} seeds -> ${out}`);
