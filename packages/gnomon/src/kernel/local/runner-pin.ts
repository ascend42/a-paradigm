/**
 * @symbol #local-runner
 * @symbol ^subscription-only
 *
 * The gnomon-local runner PIN (M1.8 slice 2 round 2, Aegis H1). A session can
 * write wherever its repo is, so a runner that lives there could be swapped
 * by one local session and exec'd by the next. The root-signed config
 * therefore pins the WHOLE runner and the kernel never execs the source:
 *   - `dir` + `treeSha256`: the runner package directory (gnomon-local's
 *     dist/, or a single-file bundle in a dir). The tree hash is
 *     sha256 over the sorted lines `<posix rel path>\0<sha256 of bytes>\n`;
 *     a symlink or any non-regular entry refuses (fail closed); at most
 *     MAX_FILES files and MAX_BYTES bytes.
 *   - `node` + `nodeSha256`: the interpreter binary, by sha256.
 *   - `entry`: the script inside `dir` (relative, no `..`).
 * prepareRunner COPIES the tree into `<home>/runners/<treeSha256>/` FIRST and
 * hashes the COPY (no time-of-check/time-of-use gap on the tree: what is
 * hashed is what runs); the home is write-denied to every session by the
 * session profile (§15.5), so a copy that verified stays what it was — it
 * is re-verified on every spawn anyway. The child is exec'd as
 * `<realpath node> <realpath copied entry> …`.
 * RESIDUAL (reported): node is verified by sha256 immediately before spawn
 * but exec'd IN PLACE — Homebrew's node is a 68 KB launcher that loads
 * `@loader_path/../lib/libnode.dylib`, so copying the binary alone breaks
 * it, and its dylibs are not pinned. A single-file SEA runner closes this.
 */
import { createHash, randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { refuse, RefusedError } from '@a-company/gnomon-contracts';

export interface LocalRunnerPin {
  /** absolute path of the node binary */
  node: string;
  nodeSha256: string;
  /** absolute path of the runner package dir (e.g. …/gnomon-local/dist) */
  dir: string;
  treeSha256: string;
  /** entry script, relative to dir, posix separators */
  entry: string;
}

export const MAX_FILES = 2048;
export const MAX_BYTES = 256 << 20;
export const RUNNERS_DIR = 'runners';

export class RunnerPinError extends Error {
  constructor(readonly part: 'node' | 'tree' | 'entry', message: string) {
    super(message);
  }
}

function pinRefused(part: string, message: string): RefusedError {
  return new RefusedError(refuse({ code: 'PERMIT_REQUIRED', data: { why: 'runner-pin-mismatch', part } }), `#local-runner: ${message}`);
}

export function sha256File(p: string): string {
  return createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

/** The regular files of a tree, sorted by posix rel path. Symlinks and special files throw. */
function treeFiles(dir: string): Array<{ rel: string; abs: string }> {
  const out: Array<{ rel: string; abs: string }> = [];
  let bytes = 0;
  const walk = (d: string, prefix: string): void => {
    for (const name of fs.readdirSync(d).sort()) {
      const abs = path.join(d, name);
      const rel = prefix ? `${prefix}/${name}` : name;
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) throw new RunnerPinError('tree', `runner tree holds a symlink: ${rel.slice(0, 200)}`);
      if (st.isDirectory()) walk(abs, rel);
      else if (st.isFile()) {
        bytes += st.size;
        if (out.length >= MAX_FILES || bytes > MAX_BYTES) throw new RunnerPinError('tree', 'runner tree is too large');
        out.push({ rel, abs });
      } else throw new RunnerPinError('tree', `runner tree holds a non-regular entry: ${rel.slice(0, 200)}`);
    }
  };
  walk(dir, '');
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}

/** sha256 over `<rel>\0<sha256>\n` per file, sorted. */
export function treeHash(dir: string): string {
  const h = createHash('sha256');
  for (const f of treeFiles(dir)) h.update(`${f.rel}\0${sha256File(f.abs)}\n`);
  return h.digest('hex');
}

const safeEntry = (e: string): boolean => e.length > 0 && !e.startsWith('/') && !/^[A-Za-z]:/.test(e) && !e.split(/[\\/]/).some((c) => c === '..' || c === '');

/** A test/root-act helper: the pin of a runner as it is on disk now. */
export function pinOf(dir: string, entry: string, node: string = process.execPath): LocalRunnerPin {
  return { node, nodeSha256: sha256File(node), dir, treeSha256: treeHash(dir), entry };
}

/**
 * Verify and stage the runner: copy `dir` into `<home>/runners/<treeSha256>/` (atomic rename), hash the COPY,
 * verify node; returns the realpaths to exec. Any mismatch refuses PERMIT_REQUIRED{runner-pin-mismatch, part}.
 */
export function prepareRunner(home: string, pin: LocalRunnerPin): { command: string; entry: string; copy: string } {
  if (!safeEntry(pin.entry)) throw pinRefused('entry', 'the runner entry must be a relative path inside the pinned dir');
  const runners = path.join(home, RUNNERS_DIR);
  fs.mkdirSync(runners, { recursive: true, mode: 0o700 });
  const dest = path.join(runners, pin.treeSha256.toLowerCase());
  const verify = (d: string): boolean => {
    try {
      return treeHash(d) === pin.treeSha256.toLowerCase();
    } catch {
      return false;
    }
  };
  if (!fs.existsSync(dest) || !verify(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
    const tmp = path.join(runners, `.tmp-${randomBytes(8).toString('hex')}`);
    try {
      fs.mkdirSync(tmp, { mode: 0o700 });
      let files: Array<{ rel: string; abs: string }>;
      try {
        files = treeFiles(pin.dir);
      } catch (err) {
        throw pinRefused('tree', err instanceof Error ? err.message : 'runner tree unreadable');
      }
      for (const f of files) {
        const to = path.join(tmp, ...f.rel.split('/'));
        fs.mkdirSync(path.dirname(to), { recursive: true, mode: 0o700 });
        fs.copyFileSync(f.abs, to);
        fs.chmodSync(to, 0o600);
      }
      // what is hashed is what runs: the COPY, never the source after the check
      if (!verify(tmp)) throw pinRefused('tree', 'the runner package does not match its root-signed tree hash');
      fs.renameSync(tmp, dest);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  const entry = path.join(dest, ...pin.entry.split('/'));
  if (!fs.existsSync(entry)) throw pinRefused('entry', 'the runner entry is not in the pinned tree');
  let node: string;
  try {
    node = fs.realpathSync.native(pin.node);
  } catch {
    throw pinRefused('node', 'the pinned node binary is missing');
  }
  let got: string | null = null;
  try {
    got = sha256File(node);
  } catch {
    got = null;
  }
  if (got !== pin.nodeSha256.toLowerCase()) throw pinRefused('node', 'the node binary does not match its root-signed sha256 pin');
  return { command: node, entry: fs.realpathSync.native(entry), copy: fs.realpathSync.native(dest) };
}
