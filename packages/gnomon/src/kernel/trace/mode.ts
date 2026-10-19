/**
 * @symbol #trace-capture
 *
 * #trace-capture, the per-project toggle. Trace capture is a CORE audit mode: on any home and any build, the
 * human switches it on for one project folder and every Claude session the kernel opens (or resumes) with that
 * folder as its cwd records its raw stream-json traffic to `<project>/.gnomon/trace/` (capture.ts).
 *
 * The state lives ONLY in the Gnomon home: `<home>/trace-folders.json`, owner-only (0600) in the owner-only (0700)
 * home, keyed by each folder's realpath. Nothing a project holds is read: no project file and no project config
 * can switch it on. The session profile read- and write-denies the whole Gnomon home (manifest/policy.ts,
 * `gnomon-home`), so a session cannot flip its own tracing (falsifier: test/trace-capture.test.ts).
 *
 * The kernel reads the mode at every session.open and every resume, for the session's cwd (exact realpath match).
 * The CLI `gnomon trace on|off|status` calls these three functions.
 *
 * A damaged file (not a plain owner-only file, unparseable, wrong schema) reads as "no folder traced", and the
 * next setTraceMode rewrites it. Writes go to an exclusive O_NOFOLLOW temp file, fsync'd, then renamed over.
 */
import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { currentUid, ensureGnomonHome } from '../lifecycle/home.js';

export const TRACE_FOLDERS_FILE = 'trace-folders.json';
export const TRACE_FOLDERS_SCHEMA = 'gnomon-trace-folders:v1' as const;

interface TraceFoldersDoc {
  schemaVersion: typeof TRACE_FOLDERS_SCHEMA;
  folders: string[];
}

const O_NOFOLLOW: number = fs.constants.O_NOFOLLOW ?? 0;
const POSIX = process.platform !== 'win32';

export const traceFoldersPath = (home: string): string => path.join(home, TRACE_FOLDERS_FILE);

/** The realpath of an existing absolute directory; throws TypeError otherwise. */
function folderKey(folder: string): string {
  if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw new TypeError(`#trace-capture: the folder must be an absolute path (got ${JSON.stringify(String(folder).slice(0, 128))})`);
  const real = fs.realpathSync.native(folder);
  if (!fs.statSync(real).isDirectory()) throw new TypeError(`#trace-capture: ${folder} is not a directory`);
  return real;
}

function readDoc(home: string): string[] {
  let fd: number;
  try {
    fd = fs.openSync(traceFoldersPath(home), fs.constants.O_RDONLY | O_NOFOLLOW);
  } catch {
    return [];
  }
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) return [];
    const uid = currentUid();
    if (uid !== null && st.uid !== uid) return [];
    if (POSIX && (st.mode & 0o077) !== 0) return [];
    const doc = JSON.parse(fs.readFileSync(fd, 'utf8')) as Partial<TraceFoldersDoc>;
    if (doc?.schemaVersion !== TRACE_FOLDERS_SCHEMA || !Array.isArray(doc.folders)) return [];
    return doc.folders.filter((f): f is string => typeof f === 'string' && path.isAbsolute(f));
  } catch {
    return [];
  } finally {
    fs.closeSync(fd);
  }
}

function writeDoc(home: string, folders: string[]): void {
  ensureGnomonHome(home);
  const doc: TraceFoldersDoc = { schemaVersion: TRACE_FOLDERS_SCHEMA, folders: [...new Set(folders)].sort() };
  const tmp = path.join(home, `.${TRACE_FOLDERS_FILE}.${randomBytes(6).toString('hex')}.tmp`);
  const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | O_NOFOLLOW, 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(doc, null, 2)}\n`);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    if (POSIX) fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, traceFoldersPath(home));
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/** Switch trace capture on or off for one project folder (an existing absolute directory, keyed by its realpath). */
export function setTraceMode(home: string, folder: string, on: boolean): void {
  const key = folderKey(folder);
  const now = readDoc(home);
  const next = on ? [...now, key] : now.filter((f) => f !== key);
  if (on === now.includes(key) && fs.existsSync(traceFoldersPath(home))) return;
  writeDoc(home, next);
}

/** Is trace capture on for this folder (exact realpath match)? An unresolvable folder or a damaged file reads false. */
export function traceModeOf(home: string, folder: string): boolean {
  let key: string;
  try {
    key = folderKey(folder);
  } catch {
    return false;
  }
  return readDoc(home).includes(key);
}

/** Every traced folder (realpaths, sorted). */
export function tracedFolders(home: string): string[] {
  return [...new Set(readDoc(home))].sort();
}
