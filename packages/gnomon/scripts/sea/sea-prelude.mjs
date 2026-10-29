/**
 * @symbol #kernel-sea
 *
 * The first module the signed SEA kernel (`gnomon.kernel`, TD-2026-10-29-746, spec P8-D68) evaluates, before any
 * kernel code. ESM evaluates imports in order, so sea-main.mjs imports this first and every side effect below has
 * happened before dist/cli/gnomon.js or gnomond.js runs.
 *
 * 1. Env. The SEA is built with `execArgvExtension: "none"` (scripts/build-sea.mjs), so node itself never reads
 *    NODE_OPTIONS: no `--require`, `--import`, `--inspect` or loader can be injected through the environment
 *    (measured by test/sea-kernel.test.ts and probe p15). The variables are also DELETED here so nothing the kernel
 *    spawns inherits them and the kernel's own unsafe-env guard (launch-tty.ts unsafeRuntime) sees a clean env.
 *    NODE_PATH has no effect on a SEA (its require() loads built-ins only) and is deleted for the children.
 *    NODE_EXTRA_CA_CERTS is read by node's TLS at process start, before any JS: it is deleted here so no child
 *    inherits it; the kernel's own launch paths (the wrapper's env allowlist, gnomond's clean re-exec) never pass
 *    it. It changes TLS trust, not the code the helper certifies.
 * 2. argv. A SEA's argv is [execPath, argv0, ...args] (argv0 as typed, possibly relative). The first user arg
 *    `--gnomond` selects the daemon entry (env.ts SEA_GNOMOND_ARG); anything else runs the `gnomon` CLI. argv is
 *    rewritten to [execPath, execPath, ...args] so the kernel's existing "argv[1] is execPath ⇒ SEA" checks hold.
 * 3. import.meta.url. Each dist entry finds its siblings (transport/gnomon-web.js, build-id.json, gnomon-local,
 *    app-bundle.ts) from import.meta.url. The SEA defines it as `<dir of realpath(execPath)>/dist/cli/<entry>.js`:
 *    the SEA sits at the kernel package root (`Contents/Resources/kernel/gnomon.kernel` in Gnomon.app,
 *    `packages/gnomon/gnomon.kernel` in a checkout), beside dist/ and package.json.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';

export const STRIPPED_ENV = Object.freeze(['NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS']);

for (const k of STRIPPED_ENV) delete process.env[k];

const args = process.argv.slice(2);
const entry = args[0] === '--gnomond' ? 'gnomond' : 'gnomon';
if (entry === 'gnomond') args.shift();
process.argv = [process.execPath, process.execPath, ...args];

let exe = process.execPath;
try {
  exe = fs.realpathSync.native(process.execPath);
} catch {
  // keep execPath as given
}
globalThis.__gnomonSeaEntry = entry;
globalThis.__gnomonSeaMetaUrl = pathToFileURL(path.join(path.dirname(exe), 'dist', 'cli', `${entry}.js`)).href;
