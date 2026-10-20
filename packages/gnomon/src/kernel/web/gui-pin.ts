/**
 * @symbol #web-endpoint
 *
 * #web-endpoint: the built-in #gui bundle pin (M1.10 slice 1). Kept OUT of
 * bundle.ts on purpose: the transport child imports bundle.ts, and its import
 * closure must stay the framing, the channel and the tree hash
 * (test/seams-fence.test.ts) — the GUI bytes are the kernel's to materialize,
 * never the child's to carry.
 */
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GUI_BUNDLE_FILES_B64, GUI_BUNDLE_HASH } from './gui-bundle.js';

export { GUI_BUNDLE_HASH };

/** The pinned GUI bundle's files (opaque bytes; the kernel never reads them as code). */
export function guiBundleFiles(): Map<string, Buffer> {
  return new Map(Object.entries(GUI_BUNDLE_FILES_B64).map(([k, v]) => [k, Buffer.from(v, 'base64')]));
}

/** Write the GUI bundle under `<home>/gui/bundle/` (dir 0700, files 0600) and return its directory. */
export function materializeGuiBundle(home: string): string {
  const dir = path.join(home, 'gui', 'bundle');
  rmSync(dir, { recursive: true, force: true }); // a stale extra file would (correctly) fail the pin
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(path.join(home, 'gui'), 0o700);
  chmodSync(dir, 0o700);
  for (const [name, bytes] of guiBundleFiles()) {
    // names are relative POSIX paths (e.g. fonts/JetBrainsMono-Regular.woff2, S1); the tree hash's SAFE_PATH already
    // refuses `..`, so a sub-directory stays under dir. The 0700 mode is best-effort (ignored on Windows, never relied on).
    const file = path.join(dir, ...name.split('/'));
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    writeFileSync(file, bytes, { mode: 0o600 });
  }
  return dir;
}
