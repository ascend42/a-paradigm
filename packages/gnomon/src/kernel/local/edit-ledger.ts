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
 * dir in its roots counts too). It also lists, informationally, every edit under `dir` in the last RECENT_EDIT_DAYS.
 *
 * Aegis should-fix (size): a ledger over LEDGER_MAX_BYTES is read from its tail only, and readLedger reports
 * `incompleteSince` = the oldest row it read. When that is AFTER `since`, rows in the window may be missing, so
 * localWritesUnder reports `incomplete` and the stage counts it as local-writes (overridable only with force). Chosen
 * over compaction: compaction rewrites a kernel ledger (an atomic rewrite that can itself lose rows, and a summary that
 * must stay correct for every future `since`), while an honest "incomplete" fails closed with no rewrite and leaves
 * the human the force override. Aegis should-fix (append): appendLedger reports failure; a local session whose `open`
 * row cannot be written is refused (LocalLane), so the ledger never misses a session that could write.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export const EDIT_LEDGER_FILE = 'local-edits.jsonl';
export const LEDGER_MAX_BYTES = 4 * 1024 * 1024;
export const RECENT_EDIT_DAYS = 7;

export type LedgerRecord = { kind: 'open'; hsid: string; at: number; roots: string[] } | { kind: 'close'; hsid: string; at: number } | { kind: 'edit'; hsid: string; at: number; path: string };

const within = (p: string, root: string): boolean => {
  const r = path.relative(root, p);
  return r === '' || (!r.startsWith('..') && !path.isAbsolute(r));
};

/** Append one row; false when it could not be written (the caller decides: an `open` refuses the session). */
export function appendLedger(home: string, rec: LedgerRecord): boolean {
  try {
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    const p = path.join(home, EDIT_LEDGER_FILE);
    try {
      if (fs.lstatSync(p).isSymbolicLink()) fs.rmSync(p);
    } catch {
      /* absent */
    }
    fs.appendFileSync(p, `${JSON.stringify(rec)}\n`, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

export function readLedger(home: string, maxBytes = LEDGER_MAX_BYTES): { records: LedgerRecord[]; incompleteSince: number | null } {
  const p = path.join(home, EDIT_LEDGER_FILE);
  let text: string;
  let truncated = false;
  try {
    const st = fs.lstatSync(p);
    if (!st.isFile()) return { records: [], incompleteSince: null };
    const fd = fs.openSync(p, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      const len = Math.min(st.size, maxBytes);
      truncated = st.size > maxBytes;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, st.size - len);
      text = buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { records: [], incompleteSince: null };
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
  // a truncated read starts mid-file: its oldest row is the horizon (a read with no row at all is incomplete since now)
  return { records: out, incompleteSince: truncated ? (out[0]?.at ?? Date.now()) : null };
}

export interface LocalWrites {
  edits: Array<{ hsid: string; path: string; at: number }>;
  sessions: Array<{ hsid: string; roots: string[] }>;
  /** the ledger was read from its tail and may miss rows in the window: rows are complete only since this time */
  incomplete: number | null;
  /** informational: every edit under the dir in the last RECENT_EDIT_DAYS, whatever the build time */
  recent: Array<{ hsid: string; path: string; at: number }>;
}

export function localWritesUnder(home: string, dir: string, sinceMs: number, o: { now?: number; maxBytes?: number } = {}): LocalWrites {
  const { records: recs, incompleteSince } = readLedger(home, o.maxBytes);
  const now = o.now ?? Date.now();
  const edits = recs.filter((r): r is Extract<LedgerRecord, { kind: 'edit' }> => r.kind === 'edit' && r.at >= sinceMs && within(r.path, dir)).map((r) => ({ hsid: r.hsid, path: r.path, at: r.at }));
  const closed = new Map(recs.filter((r) => r.kind === 'close').map((r) => [r.hsid, r.at]));
  const sessions = recs
    .filter((r): r is Extract<LedgerRecord, { kind: 'open' }> => r.kind === 'open' && r.roots.some((x) => within(dir, x) || within(x, dir)))
    .filter((r) => (closed.get(r.hsid) ?? Number.POSITIVE_INFINITY) >= sinceMs)
    .map((r) => ({ hsid: r.hsid, roots: r.roots }));
  const recent = recs
    .filter((r): r is Extract<LedgerRecord, { kind: 'edit' }> => r.kind === 'edit' && r.at >= now - RECENT_EDIT_DAYS * 86_400_000 && within(r.path, dir))
    .map((r) => ({ hsid: r.hsid, path: r.path, at: r.at }));
  return { edits: edits.slice(-50), sessions: sessions.slice(-50), incomplete: incompleteSince !== null && incompleteSince > sinceMs ? incompleteSince : null, recent: recent.slice(-50) };
}
