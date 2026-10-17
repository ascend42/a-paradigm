/**
 * @symbol #kernel-log
 *
 * #kernel-log (spec §3.2 "Signatures and anchors", §16 "Chain anchor" row,
 * G-LOG-06) — the chain-head anchors.
 *
 * After every commit the head `{log, segment, seq, hash, at}` is written to
 * TWO anchors: the file `<home>/head` and the OS keystore item `gnomon-head`
 * (Keychain generic password on macOS / Credential Manager generic credential
 * on Windows), the latter written by the signed helper with no presence.
 *
 * PR-4 ships `FileAnchorStore`. `KeystoreAnchorStore` is the SEAM for the
 * helper-backed anchor: until the helper exists (probes P04/P02, M1.3) it
 * reports `unavailable` and the log records that honestly in its open report
 * rather than pretending a second anchor exists.
 *
 * File anchor durability: written as tmp + rename (atomic: a reader sees the
 * old or the new head, never a torn one) and NOT fsynced per commit — on
 * macOS node's fsync is F_FULLFSYNC (~5 ms, measured), which alone would
 * blow the 5 ms p99 append budget. It is fsynced at genesis, rotation and
 * close. After a crash the anchor may therefore LAG the db (never lead it:
 * the db commit is durable before the anchor is written); the log accepts a
 * lagging anchor only if the row at the anchor's seq has the anchor's hash.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export const HEAD_SCHEMA = 'gnomonHead:v1' as const;

export interface HeadAnchor {
  schemaVersion: typeof HEAD_SCHEMA;
  log: string;
  segment: number;
  /** 0 = genesis, no row yet; `hash` is then the genesis prev. */
  seq: number;
  hash: string;
  at: string;
}

export type AnchorReadResult = { state: 'present'; head: HeadAnchor } | { state: 'absent' } | { state: 'unavailable'; why: string } | { state: 'malformed'; why: string };

export interface AnchorStore {
  readonly name: 'file' | 'keystore';
  read(): AnchorReadResult;
  /** `durable` = fsync before returning (genesis, rotation, close). */
  write(head: HeadAnchor, durable: boolean): void;
}

function isHead(v: unknown): v is HeadAnchor {
  if (!v || typeof v !== 'object') return false;
  const h = v as Record<string, unknown>;
  return (
    h.schemaVersion === HEAD_SCHEMA &&
    typeof h.log === 'string' &&
    Number.isSafeInteger(h.segment) &&
    Number.isSafeInteger(h.seq) &&
    (h.seq as number) >= 0 &&
    typeof h.hash === 'string' &&
    typeof h.at === 'string'
  );
}

export class FileAnchorStore implements AnchorStore {
  readonly name = 'file' as const;
  readonly path: string;

  constructor(home: string) {
    this.path = path.join(home, 'head');
  }

  read(): AnchorReadResult {
    let text: string;
    try {
      text = fs.readFileSync(this.path, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'absent' };
      throw err;
    }
    try {
      const v: unknown = JSON.parse(text);
      return isHead(v) ? { state: 'present', head: v } : { state: 'malformed', why: 'not a gnomonHead:v1 record' };
    } catch {
      return { state: 'malformed', why: 'not JSON' };
    }
  }

  write(head: HeadAnchor, durable: boolean): void {
    const tmp = `${this.path}.tmp`;
    const fd = fs.openSync(tmp, 'w', 0o600);
    try {
      fs.writeSync(fd, `${JSON.stringify(head)}\n`);
      if (durable) fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, this.path);
    if (durable) fsyncDir(path.dirname(this.path));
  }
}

/**
 * The helper-backed keystore anchor (`gnomon-head`). SEAM ONLY in PR-4: the
 * signed helper that owns the Keychain / Credential Manager item does not
 * exist yet, so reads report `unavailable` and writes are no-ops. Never
 * falls back to a second file — a second file in the same home would add no
 * protection against a same-user rewrite (§3.2 scope statement).
 */
export class KeystoreAnchorStore implements AnchorStore {
  readonly name = 'keystore' as const;
  read(): AnchorReadResult {
    return { state: 'unavailable', why: 'helper-backed keystore anchor pending probes P04/P02 (M1.3)' };
  }
  write(): void {
    /* helper pending: nothing to write to */
  }
}

/** fsync a directory so a rename inside it is durable (no-op where unsupported). */
export function fsyncDir(dir: string): void {
  let fd: number | undefined;
  try {
    fd = fs.openSync(dir, 'r');
    fs.fsyncSync(fd);
  } catch {
    /* directories cannot be fsynced on every platform; the rename stays atomic */
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}
