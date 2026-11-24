/**
 * #dimension-mod test rig (S1.3 P2): the REAL mod tree (packages/gnomon-mods/dimension) installed through the real
 * card path into a mod rig, an in-memory log behind the real mod bridge (clamp, stamp and budgets included), and
 * small builders for ids and ops. The mod itself always runs as a real child from its pinned snapshot.
 */
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

export interface FakeLog {
  logId: string;
  rows: Array<ModAppendRow & { seq: number }>;
  /** every log.read params object the mod sent */
  reads: Array<Record<string, unknown>>;
  /** set to make the next append(s) fail before anything is written */
  failAppends: number;
  /** rows of other writers between the mod's rows (advances the seq) */
  pad(n: number): void;
  kernelCall: ModKernelCall;
  /** the rows as a human reader's fold sees them */
  dimRows(): DimRow[];
  fold(dim: string): DimState;
}

/**
 * An in-memory log behind the REAL mod bridge: `log.append` goes through clampModAppend (stamp, size and key
 * checks, budgets on a clock that moves a second per append) and `log.read` pages the way socket/log-read.ts
 * does for a mod (cursor `since`, `until`, `kinds`, `limit`, rows as `{seq, view: 'full', event}`).
 */
export function fakeLog(opts: { pageScan?: number } = {}): FakeLog {
  let seq = 0;
  let clock = 0;
  const pageScan = opts.pageScan ?? 10_000;
  const log: FakeLog = {
    logId: 'log:01JD1MFAKE0000000000000001',
    rows: [],
    reads: [],
    failAppends: 0,
    pad: (n) => void (seq += n),
    kernelCall: undefined as unknown as ModKernelCall,
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
        log.rows.push({ ...row, payload: JSON.parse(JSON.stringify(row.payload)) as Record<string, unknown>, seq });
        return { seq };
      },
      callAs: async (_principal, verb, params) => {
        if (verb !== 'log.read') return {};
        log.reads.push(params);
        const since = params.since === undefined ? 0 : (params.since as { logId: string; seq: number }).seq;
        if (params.since !== undefined && (params.since as { logId: string }).logId !== log.logId) throw new Error('cursor-epoch');
        const until = typeof params.until === 'number' ? params.until : seq;
        const limit = typeof params.limit === 'number' ? params.limit : 256;
        const kinds = Array.isArray(params.kinds) ? (params.kinds as string[]) : null;
        const out: unknown[] = [];
        let next = since;
        const stop = Math.min(until, since + pageScan);
        for (const r of log.rows) {
          if (r.seq <= since) continue;
          if (r.seq > stop || out.length >= limit) break;
          next = r.seq;
          if (kinds && !kinds.includes(r.kind)) continue;
          out.push({ seq: r.seq, view: 'full', event: { kind: r.kind, principal: r.principal, payload: r.payload, ...(r.scope ? { scope: r.scope } : {}) } });
        }
        if (out.length < limit) next = Math.max(next, stop);
        return { rows: out, next, cursor: { logId: log.logId, seq: next }, logId: log.logId, head: seq, caughtUp: next >= seq, projection: 'mod', withheld: 0 };
      },
    },
    { now: () => (clock += 1_000) },
  );
  return log;
}
