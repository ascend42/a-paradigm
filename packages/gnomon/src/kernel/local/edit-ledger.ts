/**
 * @symbol #paradigm-stage
 *
 * TD-2026-10-27-833 (Aegis H3): the kernel's ledger of what LOCAL sessions could write and did write, so staging the
 * first-party Paradigm MCP from a linked checkout can refuse a tree a local model may have written.
 *
 *   <home>/local-edits.jsonl (0600, append-only, kernel-written; every session profile denies the Gnomon home)
 *     {kind: 'open', hsid, at, roots}   a local session opened with these writable roots
 *     {kind: 'close', hsid, at}         it ended
 *     {kind: 'edit', hsid, at, path}    an edit tool ended successfully on this realpath
 *   Only the newest LEDGER_MAX_BYTES are read; a line that does not parse is skipped.
 *
 * localWritesUnder(dir, since) names every edit under `dir` at or after `since`, and every session whose roots
 * overlap `dir` and that was live at or after `since` (a shell write is not an edit row, so a live session with the
 * dir in its roots counts too).
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export const EDIT_LEDGER_FILE = 'local-edits.jsonl';
export const LEDGER_MAX_BYTES = 4 * 1024 * 1024;

export type LedgerRecord = { kind: 'open'; hsid: string; at: number; roots: string[] } | { kind: 'close'; hsid: string; at: number } | { kind: 'edit'; hsid: string; at: number; path: string };

const within = (p: string, root: string): boolean => {
  const r = path.relative(root, p);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
};

export function appendLedger(home: string, rec: LedgerRecord): void {
  try {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    const p = path.join(home, EDIT_LEDGER_FILE);
    try {
      if (fs.lstatSync(p).isSymbolicLink()) fs.rmSync(p);
    } catch {
      /* absent */
    }
    fs.appendFileSync(p, `${JSON.stringify(rec)}\n`, { mode: 0o600 });
  } catch {
    /* best effort: a missing ledger makes staging refuse nothing it would have refused for a session it never saw */
  }
}

export function readLedger(home: string): LedgerRecord[] {
  const p = path.join(home, EDIT_LEDGER_FILE);
  let text: string;
  try {
    const st = fs.lstatSync(p);
    if (!st.isFile()) return [];
    const fd = fs.openSync(p, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      const len = Math.min(st.size, LEDGER_MAX_BYTES);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, st.size - len);
      text = buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return [];
  }
  const out: LedgerRecord[] = [];
  for (const line of text.split('\n')) {
    try {
      const r = JSON.parse(line) as LedgerRecord;
      if (r && typeof r.hsid === 'string' && typeof r.at === 'number' && (r.kind === 'open' ? Array.isArray(r.roots) : r.kind === 'edit' ? typeof r.path === 'string' : r.kind === 'close')) out.push(r);
    } catch {
      /* a torn or foreign line */
    }
  }
  return out;
}

export function localWritesUnder(home: string, dir: string, sinceMs: number): { edits: Array<{ hsid: string; path: string; at: number }>; sessions: Array<{ hsid: string; roots: string[] }> } {
  const recs = readLedger(home);
  const edits = recs.filter((r): r is Extract<LedgerRecord, { kind: 'edit' }> => r.kind === 'edit' && r.at >= sinceMs && within(r.path, dir)).map((r) => ({ hsid: r.hsid, path: r.path, at: r.at }));
  const closed = new Map(recs.filter((r) => r.kind === 'close').map((r) => [r.hsid, r.at]));
  const sessions = recs
    .filter((r): r is Extract<LedgerRecord, { kind: 'open' }> => r.kind === 'open' && r.roots.some((x) => within(dir, x) || within(x, dir)))
    .filter((r) => (closed.get(r.hsid) ?? Number.POSITIVE_INFINITY) >= sinceMs)
    .map((r) => ({ hsid: r.hsid, roots: r.roots }));
  return { edits: edits.slice(-50), sessions: sessions.slice(-50) };
}
