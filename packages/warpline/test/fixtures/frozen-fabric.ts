/**
 * I8 — the FROZEN fabric fixture: the first 15 v1 strands + the first 20 v2
 * strands of this repo's ledger (byte-exact) and fabric-legacy.json. Tests never
 * read the live .warpline/ (a per-clone cache since warpline 0.3.0).
 *
 * The real binding objects (≈12 MB) are NOT committed (W2 review item 5). A v1
 * strand's binding is excluded from its pickId and from the grandfathered body
 * hash, so `withSyntheticBindings` points every binding at one tiny synthetic
 * tree written into the test's own object store: verify still walks and
 * re-hashes a real tree. The real-object case runs only when WARPLINE_REAL_OBJECTS
 * names an object store that holds them (e.g. a checkout's .warpline/objects).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectStore } from '../../src/warp/object-store.js';

export const FROZEN_WDIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'frozen-fabric');

/** An object store holding the real v1 binding objects, or null (then the real-object test skips). */
export const REAL_OBJECTS: string | null = (() => {
  const p = process.env.WARPLINE_REAL_OBJECTS;
  return p && fs.existsSync(path.join(p, 'trees')) ? p : null;
})();

/** Write a tiny real tree into `root`'s store and rebind every bound strand line to it. */
export function withSyntheticBindings(root: string, lines: string[]): string[] {
  const store = new ObjectStore(root);
  const blob = store.putBlob(Buffer.from('warpline frozen-fabric synthetic binding\n'));
  const treeId = store.putTree([{ mode: '100644', name: 'README', id: blob }]);
  return lines.map((l) => {
    const s = JSON.parse(l) as { binding?: { treeId: string } };
    if (!s.binding) return l;
    return JSON.stringify({ ...s, binding: { ...s.binding, treeId } });
  });
}

/** Copy a real object store (WARPLINE_REAL_OBJECTS) into `<wdir>/objects`. */
export function copyRealObjects(wdir: string): void {
  if (REAL_OBJECTS === null) throw new Error('WARPLINE_REAL_OBJECTS is not set');
  fs.cpSync(REAL_OBJECTS, path.join(wdir, 'objects'), { recursive: true });
}

/**
 * A SMALL generated tip state (no objects) under the tip's recorded stateId — the
 * seal only needs a loadable parent; the 13 MB real snapshot is not committed.
 */
export function writeStubState(wdir: string, stateId: string): void {
  const safe = stateId.replace(/[^a-zA-Z0-9._-]/g, '_');
  fs.mkdirSync(path.join(wdir, 'states'), { recursive: true });
  fs.writeFileSync(
    path.join(wdir, 'states', `${safe}.json`),
    JSON.stringify({ ref: 'HEAD', treeSha: null, stateId, absorbedAt: '2026-01-01T00:00:00.000Z', objects: [] }),
  );
}
