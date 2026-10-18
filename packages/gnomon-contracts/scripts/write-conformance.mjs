// Regenerates conformance/display.v1.json from the built package (dist/). Run after `npm run build`.
// The committed file must equal this output (test/display.test.ts, fixed point).
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serializeDisplayVectors } from '../dist/index.js';

mkdirSync(fileURLToPath(new URL('../conformance/', import.meta.url)), { recursive: true });
writeFileSync(fileURLToPath(new URL('../conformance/display.v1.json', import.meta.url)), serializeDisplayVectors());
process.stdout.write('wrote conformance/display.v1.json\n');
