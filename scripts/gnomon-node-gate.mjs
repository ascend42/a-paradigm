#!/usr/bin/env node
/**
 * @symbol #gnomon-npm-packaging
 *
 * Root `npm test` runs the Gnomon suites (T-2026-10-21-030, 8.0 M3: Gnomon joined the root build and test). Gnomon
 * packages declare engines.node >= 24 while the repo floor stays >= 20, so on an older Node this prints why the Gnomon
 * suites did not run and exits 0; on Node >= 24 it runs `npm run <script>` (default test:gnomon) and passes its exit
 * code through. CI runs the root test on Node 24 too (ci.yml matrix), so the suites always run somewhere.
 *
 *   node scripts/gnomon-node-gate.mjs [npm-script]
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = process.argv[2] ?? 'test:gnomon';
const major = Number(process.versions.node.split('.')[0]);
if (major < 24) {
  process.stdout.write(`gnomon: skipped ${script} on Node ${process.versions.node}; the Gnomon packages need Node >= 24 (engines)\n`);
} else {
  const r = spawnSync('npm', ['run', script], { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), stdio: 'inherit', shell: process.platform === 'win32' });
  process.exitCode = r.status ?? 1;
}
