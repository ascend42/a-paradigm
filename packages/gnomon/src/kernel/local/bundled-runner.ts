/**
 * @symbol #local-config-request
 * @symbol #local-runner
 *
 * The gnomon-local runner that SHIPS with this kernel (TD-2026-10-22-769: nobody builds anything). The build copies
 * gnomon-local's single-file `dist/cli.js` into the kernel's own `dist/gnomon-local/` (tsup.config.ts, the
 * bundle-gnomon-local plugin), so it rides inside the npm tarball's `dist`, the signed app's
 * `Contents/Resources/kernel/dist` (covered by the wrapper's kernel tree hash and the app seal) and nothing else. The
 * same build compiles the copy's tree hash (runner-pin.ts treeHash) into the kernel as
 * __GNOMON_LOCAL_TREE_SHA256__, so the default runner is VERIFIED AT LOAD: a bundled dir that does not hash to the
 * compiled pin is never offered (fail closed, "reinstall Gnomon"). A build without the define (tests from src, a
 * build before gnomon-local was built) falls back to this clone's gnomon-local/dist, reported `clone` and unpinned;
 * the root-signed config pins whatever the human allows either way (its tree hash is on the card).
 * A typed absolute runner dir overrides the default (config-request.ts).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { treeHash } from './runner-pin.js';

/** Replaced by tsup `define` when the build found gnomon-local/dist/cli.js; undeclared everywhere else. */
declare const __GNOMON_LOCAL_TREE_SHA256__: string | undefined;

export const BUNDLED_RUNNER_DIR = 'gnomon-local';
export const BUNDLED_RUNNER_ENTRY = 'cli.js';

/** The tree hash this build compiled for its bundled runner, or null (no bundled runner in this build). */
export function compiledLocalRunnerPin(): string | null {
  const v = typeof __GNOMON_LOCAL_TREE_SHA256__ === 'string' ? __GNOMON_LOCAL_TREE_SHA256__ : null;
  return v !== null && /^[0-9a-f]{64}$/.test(v) ? v : null;
}

export type DefaultRunner =
  | { ok: true; dir: string; source: 'bundled'; treeSha256: string }
  | { ok: true; dir: string; source: 'clone'; treeSha256: null }
  | { ok: false; why: string };

const hasEntry = (d: string): boolean => {
  try {
    return fs.lstatSync(path.join(d, BUNDLED_RUNNER_ENTRY)).isFile();
  } catch {
    return false;
  }
};

/**
 * The default runner dir. `from` is the directory of the running kernel module (dist/ or dist/cli/ in a build,
 * src/kernel/local in tests); `pin` defaults to the compiled one.
 */
export function defaultLocalRunner(from: string = path.dirname(fileURLToPath(import.meta.url)), pin: string | null = compiledLocalRunnerPin()): DefaultRunner {
  if (pin !== null) {
    const dir = ['.', '..'].map((up) => path.resolve(from, up, BUNDLED_RUNNER_DIR)).find(hasEntry);
    if (!dir) return { ok: false, why: 'this Gnomon build names a bundled gnomon-local runner but it is not next to the kernel: reinstall Gnomon' };
    let got: string;
    try {
      got = treeHash(dir);
    } catch (err) {
      return { ok: false, why: `the bundled gnomon-local runner cannot be read (${err instanceof Error ? err.message.slice(0, 120) : 'unreadable'}): reinstall Gnomon` };
    }
    if (got !== pin) return { ok: false, why: "the bundled gnomon-local runner does not match this build's pin: reinstall Gnomon" };
    return { ok: true, dir, source: 'bundled', treeSha256: got };
  }
  // a dev build or a test from src: this clone's built gnomon-local (never verified against a compiled pin)
  for (const up of ['../../..', '../../../..', '../..']) {
    const d = path.resolve(from, up, 'gnomon-local', 'dist');
    if (hasEntry(d)) return { ok: true, dir: d, source: 'clone', treeSha256: null };
  }
  return { ok: false, why: 'no gnomon-local runner ships with this build and none is built in this clone (npm run build -w @a-company/gnomon-local), or name one with --runner <abs dir>' };
}

/** Replaced by tsup `define` with gnomon-local's package version when the build bundled it. */
declare const __GNOMON_LOCAL_VERSION__: string | undefined;

/**
 * The gnomon-local version of a runner dir, for the card and status.local: the compiled one when `tree` is this
 * build's bundled pin; else the `@a-company/gnomon-local` package.json one level up (a clone's dist); else null.
 */
export function runnerVersionOf(dir: string, tree: string | null): string | null {
  if (tree !== null && tree === compiledLocalRunnerPin() && typeof __GNOMON_LOCAL_VERSION__ === 'string' && /^\d+\.\d+\.\d+/.test(__GNOMON_LOCAL_VERSION__)) return __GNOMON_LOCAL_VERSION__;
  try {
    const p = JSON.parse(fs.readFileSync(path.join(dir, '..', 'package.json'), 'utf8')) as { name?: unknown; version?: unknown };
    return p.name === '@a-company/gnomon-local' && typeof p.version === 'string' && /^\d+\.\d+\.\d+$/.test(p.version) ? p.version : null;
  } catch {
    return null;
  }
}

/** The pinned node's version when it is the kernel's own node (the bundled one in the app), else null (never exec'd to ask). */
export function nodeVersionOf(node: string): string | null {
  try {
    return fs.realpathSync.native(node) === fs.realpathSync.native(process.execPath) ? process.versions.node : null;
  } catch {
    return null;
  }
}
