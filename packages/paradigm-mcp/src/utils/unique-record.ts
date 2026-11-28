/**
 * Write a new record file whose id carries a short numeric suffix, without ever
 * overwriting an existing record.
 *
 * The loaders used to build an id from a timestamp plus a random 1-999 and then
 * `writeFileSync` it: two records in the same id window (one second for the
 * journal, one DAY for decisions and work logs) that drew the same number
 * silently replaced one another. Here the file is created exclusively (`wx`),
 * so a taken id is detected by the filesystem (safe across processes too) and
 * another suffix is tried:
 *
 *   1. a random 3-digit suffix (001-999) — the historical id shape;
 *   2. on collision, the next suffixes in order, wrapping, until all 999 are tried;
 *   3. when all 999 are taken, a random 6-digit suffix (the id only gets longer;
 *      every reader matches the suffix as `\d+`).
 */

import * as fs from 'fs';
import * as path from 'path';

const SHORT_SPACE = 999;
const LONG_TRIES = 200;

function isExists(e: unknown): boolean {
  return (e as NodeJS.ErrnoException)?.code === 'EEXIST';
}

/**
 * Create `<dir>/<id><ext>` for the first free id and return that id.
 * `idFor(suffix)` builds the id; `contentFor(id)` builds the file body.
 */
export function writeUniqueRecord(
  dir: string,
  idFor: (suffix: string) => string,
  contentFor: (id: string) => string,
  ext = '.yaml',
): string {
  fs.mkdirSync(dir, { recursive: true });
  const tryWrite = (suffix: string): string | null => {
    const id = idFor(suffix);
    try {
      fs.writeFileSync(path.join(dir, `${id}${ext}`), contentFor(id), { encoding: 'utf8', flag: 'wx' });
      return id;
    } catch (e) {
      if (isExists(e)) return null;
      throw e;
    }
  };

  const start = Math.floor(Math.random() * SHORT_SPACE);
  for (let i = 0; i < SHORT_SPACE; i++) {
    const n = ((start + i) % SHORT_SPACE) + 1;
    const id = tryWrite(String(n).padStart(3, '0'));
    if (id) return id;
  }
  for (let i = 0; i < LONG_TRIES; i++) {
    const n = Math.floor(Math.random() * 900000) + 100000;
    const id = tryWrite(String(n));
    if (id) return id;
  }
  throw new Error(`Could not allocate a unique record id in ${dir}`);
}
