/**
 * @symbol #gnomon-trace
 *
 * Per-project trace mode (minimal copy, gnomon/trace-cli branch): which
 * folders a human switched raw-stream capture on for. State is
 * `<home>/trace-folders.json` (0600, the home 0700), keyed by the folder's
 * realpath: `{"v":1,"folders":{"<realpath>":{"since":"<ISO>"}}}`. The capture
 * itself is written by the session side to `<folder>/.gnomon/trace/<hsid>.jsonl`.
 * Another builder writes the full module with these exact signatures; the two
 * are reconciled at merge (same behaviour).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export const TRACE_FOLDERS_FILE = 'trace-folders.json';

interface TraceFolders {
  v: 1;
  folders: Record<string, { since: string }>;
}

function real(folder: string): string {
  try {
    return fs.realpathSync.native(path.resolve(folder));
  } catch {
    return path.resolve(folder);
  }
}

function read(home: string): TraceFolders {
  try {
    const o = JSON.parse(fs.readFileSync(path.join(home, TRACE_FOLDERS_FILE), 'utf8')) as Partial<TraceFolders>;
    if (o && o.v === 1 && o.folders && typeof o.folders === 'object' && !Array.isArray(o.folders)) return { v: 1, folders: o.folders };
  } catch {
    /* absent or unreadable: nothing is traced */
  }
  return { v: 1, folders: {} };
}

/** Switch trace mode for a folder (by realpath). Writes `<home>/trace-folders.json` 0600 via a temp file + rename. */
export function setTraceMode(home: string, folder: string, on: boolean): void {
  const state = read(home);
  const key = real(folder);
  if (on) state.folders[key] ??= { since: new Date().toISOString() };
  else delete state.folders[key];
  fs.mkdirSync(home, { recursive: true, mode: 0o700 });
  const file = path.join(home, TRACE_FOLDERS_FILE);
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

/** Is trace mode on for this folder (by realpath)? */
export function traceModeOf(home: string, folder: string): boolean {
  return Object.hasOwn(read(home).folders, real(folder));
}

/** Every traced folder (realpaths), sorted. */
export function tracedFolders(home: string): string[] {
  return Object.keys(read(home).folders).sort();
}
