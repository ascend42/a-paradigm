/**
 * @symbol #web-endpoint
 *
 * #web-endpoint bundle pin (spec §11.2 rule 1a, `G-WEB-08`; §2.1 "served as
 * opaque bytes"). The GUI bundle directory and its tree hash `gui.bundleHash`
 * are root-signed config; the transport child hashes the directory at start,
 * keeps exactly the bytes it hashed in memory and serves only those, and the
 * kernel refuses to open the endpoint on a mismatch
 * (`socket.web.bundle.mismatch`). The kernel never evaluates, imports or
 * inspects GUI code: it compares a digest.
 *
 * Tree hash (`gnomon-bundle-tree:v1`): every regular file under the directory,
 * relative POSIX path, sorted by UTF-8 bytes; each line is
 * `<path>\0<sha256 hex of the bytes>\n`; the hash is "sha256:" + hex(sha256 of
 * the concatenated lines, prefixed by the domain line). A symlink, a non-regular
 * entry, a path that is not plain printable ASCII, more than MAX_BUNDLE_FILES
 * files or more than MAX_BUNDLE_BYTES bytes ⇒ the tree does not hash (fail
 * closed).
 *
 * Since M1.10 slice 1 the endpoint pins the built-in #gui bundle
 * (`@a-company/gnomon-gui`, embedded as opaque base64 bytes in the generated
 * gui-bundle.ts) by GUI_BUNDLE_HASH; until the root-signed config
 * (`gnomon gui pin`, after #identity M1.3) that literal is the pin. The
 * PLACEHOLDER bundle below stays as a minimal fixture bundle, pinned by the
 * literal PLACEHOLDER_BUNDLE_HASH
 * (test/web-units.test.ts proves the literal equals the hash of the bytes).
 * It is materialized under `<home>/gui/` (0700) at endpoint start and hashed by
 * the child, so a same-user write between the two is caught as a mismatch.
 *
 * ZERO kernel imports: the transport child imports this file.
 */
import { createHash } from 'node:crypto';
import { chmodSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const BUNDLE_TREE_DOMAIN = 'gnomon-bundle-tree:v1';
export const MAX_BUNDLE_FILES = 10_000;
export const MAX_BUNDLE_BYTES = 64 * 1024 * 1024;
const SAFE_PATH = /^[A-Za-z0-9._@+-]+(\/[A-Za-z0-9._@+-]+)*$/;

export class BundleError extends Error {
  constructor(readonly why: string) {
    super(`gnomon-web bundle: ${why}`);
    this.name = 'BundleError';
  }
}

export interface HashedBundle {
  hash: string;
  /** relative POSIX path → the exact bytes that were hashed (served from memory, never re-read). */
  files: Map<string, Buffer>;
}

/** Hash a bundle tree from in-memory files (the definition both sides share). */
export function treeHashOf(files: ReadonlyMap<string, Buffer>): string {
  const names = [...files.keys()].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const h = createHash('sha256').update(`${BUNDLE_TREE_DOMAIN}\n`);
  for (const n of names) {
    if (!SAFE_PATH.test(n) || n.split('/').some((s) => s === '.' || s === '..')) throw new BundleError(`unsafe path ${JSON.stringify(n)}`);
    h.update(`${n}\0${createHash('sha256').update(files.get(n)!).digest('hex')}\n`);
  }
  return `sha256:${h.digest('hex')}`;
}

/** Read and hash a bundle directory; refuses symlinks, special files and oversize trees. */
export function hashBundleDir(dir: string): HashedBundle {
  const files = new Map<string, Buffer>();
  let total = 0;
  const visit = (abs: string, rel: string): void => {
    for (const name of readdirSync(abs).sort()) {
      const full = path.join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatSync(full);
      if (st.isSymbolicLink()) throw new BundleError(`symlink in bundle: ${r}`);
      if (st.isDirectory()) visit(full, r);
      else if (st.isFile()) {
        if (files.size >= MAX_BUNDLE_FILES) throw new BundleError(`more than ${MAX_BUNDLE_FILES} files`);
        const bytes = readFileSync(full);
        total += bytes.length;
        if (total > MAX_BUNDLE_BYTES) throw new BundleError(`more than ${MAX_BUNDLE_BYTES} bytes`);
        files.set(r, bytes);
      } else throw new BundleError(`not a regular file: ${r}`);
    }
  };
  const root = lstatSync(dir);
  if (!root.isDirectory()) throw new BundleError('bundle root is not a directory');
  visit(dir, '');
  if (!files.has('index.html')) throw new BundleError('bundle has no index.html');
  return { hash: treeHashOf(files), files };
}

/* ── the built-in placeholder bundle (until M1.10) ───────────────────────── */

/** No inline script, no eval, no data: URL — the page loads under the §11.2 rule 6 CSP as is. */
export const PLACEHOLDER_FILES: Readonly<Record<string, string>> = Object.freeze({
  'index.html':
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<title>Gnomon</title>\n<script src="/app.js" defer></script>\n</head>\n<body>\n<main id="gnomon"><p>Gnomon: the GUI arrives with M1.10. This is the pinned placeholder bundle.</p></main>\n</body>\n</html>\n',
  // §11.2 rule 2: the fragment is cleared before any other script runs (the real read-and-clear is the M1.10 SPA's).
  // /diag and /blob/<sha> are POST with the GUI token in X-Gnomon-Token and referrerPolicy 'same-origin' (under the
  // page's no-referrer policy a POST would carry Origin: null and fail the rule-3 origin lock).
  'app.js':
    "'use strict';\nif (location.hash) history.replaceState(null, '', location.pathname + location.search);\n" +
    "globalThis.gnomonPost = (path, token, body) => fetch(path, { method: 'POST', referrerPolicy: 'same-origin', headers: { 'X-Gnomon-Token': token }, body });\n",
});

/** The pin of the placeholder bundle (root-signed `gui.bundleHash` replaces it after M1.3 / M1.10). */
export const PLACEHOLDER_BUNDLE_HASH = 'sha256:505caa75462b7a666fc71be806790b0950494f304b968f21edca7dcc5db0e1d9';

export function placeholderFiles(): Map<string, Buffer> {
  return new Map(Object.entries(PLACEHOLDER_FILES).map(([k, v]) => [k, Buffer.from(v, 'utf8')]));
}

/** Write the placeholder bundle under `<home>/gui/placeholder/` (dir 0700, files 0600) and return its directory. */
export function materializePlaceholderBundle(home: string): string {
  const dir = path.join(home, 'gui', 'placeholder');
  rmSync(dir, { recursive: true, force: true }); // a stale extra file would (correctly) fail the pin
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(path.join(home, 'gui'), 0o700);
  chmodSync(dir, 0o700);
  for (const [name, bytes] of placeholderFiles()) writeFileSync(path.join(dir, name), bytes, { mode: 0o600 });
  return dir;
}

