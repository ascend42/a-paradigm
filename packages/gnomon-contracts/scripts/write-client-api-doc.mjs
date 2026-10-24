// Regenerates docs/specs/gnomon-client-api.md from the built package (dist/). Run after `npm run build`.
// The committed file must equal this output (test/client-api-doc.test.ts, fixed point, G-HON-04 rule).
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CLIENT_API_DOC_PATH, renderClientApiDoc } from '../dist/index.js';

writeFileSync(fileURLToPath(new URL(`../../../${CLIENT_API_DOC_PATH}`, import.meta.url)), renderClientApiDoc());
process.stdout.write(`wrote ${CLIENT_API_DOC_PATH}\n`);
