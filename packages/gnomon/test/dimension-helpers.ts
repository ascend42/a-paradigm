/**
 * #dimension-mod test rig (S1.3 P2): the REAL mod tree (packages/gnomon-mods/dimension) installed through the real
 * card path into a mod rig, an in-memory log behind the real mod bridge (clamp, stamp and budgets included), and
 * small builders for ids and ops. The mod itself always runs as a real child from its pinned snapshot.
 */
import { PAGE_MAX_BYTES } from '../src/kernel/socket/log-read.js';
import path from 'node:path';
import { DIM_KINDS, foldDim, type DimRow, type DimState } from '@a-company/gnomon-contracts';
import { installPresenceBinding, readStaged, stageInstall } from '../src/kernel/manifest/install.js';
import { createModKernelCall, type ModAppendRow, type ModKernelCall } from '../src/kernel/modhost/index.js';
import { decideInstallCard, mintTestPresence } from '../src/kernel/testing.js';
import { PKG_ROOT } from './helpers.js';
import type { Rig } from './mod-helpers.js';

export const DIMENSION_TREE = path.resolve(PKG_ROOT, '..', 'gnomon-mods', 'dimension');
export const DIMENSION = 'gnomon.dimension';
export const DIM_ROW_KINDS: readonly string[] = [DIM_KINDS.start, DIM_KINDS.attach, DIM_KINDS.op, DIM_KINDS.end];

/** Stage and decide the install card of a mod tree (the human path). The tier comes from the tree's pinned hash. */
export function installTree(r: Rig, source: string, name: string): { manifestHash: string; packageHash: string } {
  const st = stageInstall({ home: r.home, source, via: 'package', requestedBy: 'p:abcdefgh/cli', trust: r.auth });
  if (st.state !== 'staged') throw new Error(`expected staged, got ${st.state}`);
  const bind = installPresenceBinding(st.cardId, readStaged(r.home, name, st.cardId)!.card.contentHash, 'install');
  decideInstallCard(r.home, name, st.cardId, 'install', { presenceToken: mintTestPresence('mod.install', { bind }), authority: r.auth });
  return { manifestHash: st.record.detail.manifestHash, packageHash: st.record.detail.packageHash };
}

export function installDimension(r: Rig): { manifestHash: string; packageHash: string } {
  return installTree(r, DIMENSION_TREE, DIMENSION);
}

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** A deterministic 26-character ULID from a number (first character within 0-7). */
export function ulid(n: number, lead = '01JD1M'): string {
  let s = '';
  let v = n;
  for (let i = 0; i < 26 - lead.length; i++) {
    s = B32[v % 32]! + s;
    v = Math.floor(v / 32);
  }
  return lead + s;
}
export const dimId = (n: number): string => `dim:${ulid(n, '01JD1D')}`;

export const rectOp = (n: number, more: Record<string, unknown> = {}): Record<string, unknown> => ({ type: 'add', node: { id: ulid(n), kind: 'rect', x: n, y: n, z: 'V', w: 10, h: 10, ...more } });

export const FAKE_LOG_ID = 'log:01JD1MFAKE0000000000000001';

export interface FakeLog {
  logId: string;
  rows: Array<ModAppendRow & { seq: number }>;
  /** every log.read params object the mod sent */
  reads: Array<Record<string, unknown>>;
  /** every log.read answers after this many ms (a slow log, for the cancel tests) */
  readDelayMs: number;
  /** set to make the next append(s) fail before anything is written */
  failAppends: number;
  /** set to make the next append(s) land in the log and then report an error to the mod */
  loseReplies: number;
  /** rows of other writers between the mod's rows (advances the seq) */
  pad(n: number): void;
  /** a row of this kind written by someone other than the mod (a forged or replayed row); returns its seq */
  inject(kind: string, payload: Record<string, unknown>): number;
  /** called after each of the mod's appends lands (before its reply), with the row */
  afterAppend: ((row: ModAppendRow & { seq: number }) => void) | null;
  kernelCall: ModKernelCall;
  /** the log.read the mod's kernel calls are answered by (one page), for the harness's own tests */
  readPage(params: Record<string, unknown>): Promise<unknown>;
  /** the rows as a human reader's fold sees them */
  dimRows(): DimRow[];
  fold(dim: string): DimState;
}

/**
 * An in-memory log behind the REAL mod bridge: `log.append` goes through clampModAppend (stamp, size and key
 * checks, budgets on a clock that moves a second per append) and `log.read` pages the way socket/log-read.ts
 * does for a mod (cursor `since`, `until`, `kinds`, `limit`, rows as `{seq, view: 'full', event}`).
 */
export function fakeLog(opts: { pageScan?: number; pageBytes?: number; now?: () => number } = {}): FakeLog {
  let seq = 0;
  let clock = 0;
  const pageScan = opts.pageScan ?? 10_000;
  const pageBytes = opts.pageBytes ?? PAGE_MAX_BYTES;
  const log: FakeLog = {
    logId: FAKE_LOG_ID,
    rows: [],
    reads: [],
    failAppends: 0,
    readDelayMs: 0,
    loseReplies: 0,
    pad: (n) => void (seq += n),
    inject: (kind, payload) => {
      seq += 1;
      log.rows.push({ kind, principal: 'p:00000000/forger', payload: JSON.parse(JSON.stringify(payload)) as Record<string, unknown>, seq });
      return seq;
    },
    afterAppend: null,
    kernelCall: undefined as unknown as ModKernelCall,
    readPage: async () => ({}),
    dimRows: () => log.rows.map((r) => ({ seq: r.seq, kind: r.kind, payload: r.payload })),
    fold: (dim) => foldDim(log.dimRows().filter((r) => (r.payload as { dim?: string }).dim === dim)),
  };
  log.kernelCall = createModKernelCall(
    {
      append: async (row) => {
        if (log.failAppends > 0) {
          log.failAppends -= 1;
          throw new Error('append failed (test)');
        }
        seq += 1;
        const mine = seq;
        log.rows.push({ ...row, payload: JSON.parse(JSON.stringify(row.payload)) as Record<string, unknown>, seq: mine });
        log.afterAppend?.(log.rows[log.rows.length - 1]!);
        if (log.loseReplies > 0) {
          log.loseReplies -= 1;
          throw new Error('reply lost (test)');
        }
        return { seq: mine };
      },
      callAs: async (_principal, verb, params) => (verb === 'log.read' ? log.readPage(params as Record<string, unknown>) : {}),
    },
    { now: opts.now ?? (() => (clock += 1_000)) },
  );
  log.readPage = async (params) => {
      {
        if (log.readDelayMs > 0) await new Promise((res) => setTimeout(res, log.readDelayMs));
        log.reads.push(params);
        const since = params.since === undefined ? 0 : (params.since as { logId: string; seq: number }).seq;
        if (params.since !== undefined && (params.since as { logId: string }).logId !== log.logId) throw new Error('cursor-epoch');
        const until = typeof params.until === 'number' ? params.until : seq;
        const limit = typeof params.limit === 'number' ? params.limit : 256;
        const kinds = Array.isArray(params.kinds) ? (params.kinds as string[]) : null;
        const out: unknown[] = [];
        let next = since;
        const stop = Math.min(until, since + pageScan);
        // a page holds at most PAGE_MAX_BYTES of rows, as socket/log-read.ts: the row that crosses it ends the page,
        // and `next` is the last row scanned (Probe F2)
        let bytes = 0;
        let full = false;
        for (const r of log.rows) {
          if (r.seq <= since) continue;
          if (r.seq > stop || out.length >= limit) break;
          next = r.seq;
          if (kinds && !kinds.includes(r.kind)) continue;
          const row = { seq: r.seq, view: 'full', event: { kind: r.kind, principal: r.principal, payload: r.payload, ...(r.scope ? { scope: r.scope } : {}) } };
          out.push(row);
          bytes += Buffer.byteLength(JSON.stringify(row));
          if (bytes >= pageBytes) {
            full = true;
            break;
          }
        }
        if (out.length < limit && !full) next = Math.max(next, stop);
        return { rows: out, next, cursor: { logId: log.logId, seq: next }, logId: log.logId, head: seq, caughtUp: next >= seq, projection: 'mod', withheld: 0 };
      }
  };
  // (the default clock above moves a second per append, so the row budgets never bind; a test of the budgets
  // passes a real-window clock, opts.now, or it would pass vacuously)
  return log;
}
