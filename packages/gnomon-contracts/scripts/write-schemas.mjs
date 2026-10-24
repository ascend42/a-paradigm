// Regenerates schemas/*.json from the built package (dist/). Run after `npm run build`.
// The committed files must equal this output (test/schemas.test.ts, fixed point).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { BUILD_SCHEMAS, CONTRACT_SCHEMAS, serializeSchema, KIT_ID, CLIENT_API_ID } from '../dist/index.js';

const dir = fileURLToPath(new URL('../schemas/', import.meta.url));
const all = { ...CONTRACT_SCHEMAS, ...BUILD_SCHEMAS };
for (const [name, schema] of Object.entries(all)) {
  writeFileSync(dir + name, serializeSchema(schema));
}
writeFileSync(dir + 'client-api.ids.json', `${JSON.stringify({ kitId: KIT_ID, clientApiId: CLIENT_API_ID }, null, 2)}\n`);
process.stdout.write(`wrote ${Object.keys(all).length + 1} files to schemas/\n`);
