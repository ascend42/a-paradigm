/**
 * @symbol #strictness-levels
 *
 * #approval-broker strictness levels, the lite slice (M2.11-lite; spec docs/specs/gnomon.md §3.4 "Strictness and run
 * modes", D86–D88; docs/specs/gnomon-loops.md §3.3; build plan docs/plans/gnomon-loops-build.md step 9).
 *
 * Every repo has a level L0–L3, FOLDED from kernel-signed `approval.strictness.raised | lowered` rows only (a row
 * from any other principal or key is ignored; an unknown `to` from a newer kernel folds as L3, contracts
 * failSafeStrictnessLevel). A repo with no row is at L0 (the lite default; the D87 L1 floor waits on Move 3's
 * reviewer calibration). The level feeds run-mode.ts's `level` seam, so the existing ceiling (L0/L1 auto-edits,
 * L2 ask, L3 manual) applies, and the loop runner's effective autonomy (kernel/loops/strictness-cap.ts).
 *
 * CHANGING: `request.strictness.set{repo, to}` (spec §9.1; `repo` is a repo key or an absolute path, as request.mode.set) from the human on a first-party connection (the GUI
 * launch-token session, or this home's human device: `gnomon strictness set`). Every other principal class and
 * credential is refused FORBIDDEN{matrix} (G-STR-01). The kernel writes the request row, then
 *   - tightening (a higher level): `approval.strictness.raised{repo, from, to, cause:'manual', by, presence:'none'}`
 *     at once, no presence (D86); a pending loosening card for the repo is withdrawn, and `onTighten` runs the
 *     repo brake (the daemon pauses the repo's running loops at once, gnomon-loops.md §3.3);
 *   - loosening (a lower level): ONE level per step (G-STR-04), through a `strictness` card (allow | deny; allow
 *     is fresh presence in classes.ts, never a cached unlock, never `always`, never voice, and `level.loosen` is no
 *     standing tuple; the effect refuses any presence but `fresh`). On allow its effect re-checks the level has not moved and writes
 *     `approval.strictness.lowered{…, presence:'fresh'}`. One pending card per repo. Expiry is deny: the level stays.
 *
 * NOT in the lite slice (8.1 / M2.11 proper): the signal score, hysteresis, evidence and the root-key step below it,
 * the L1 calibration floor, batched landing at L2, the cached-unlock remap (strictness-presence).
 */
import * as path from 'node:path';
import { failSafeStrictnessLevel, STRICTNESS_LEVELS, type CardV1, type StrictnessLevel } from '@a-company/gnomon-contracts';
import type { KernelLog } from '../log/index.js';
import type { RuleRow, RuleSource } from '../supervisor/rules.js';
import { fail, type ApprovalBroker } from './broker.js';
import type { KernelTrustLike, ModeAsker } from './run-mode.js';

/** Stricter is higher. */
export const LEVEL_RANK: Readonly<Record<StrictnessLevel, number>> = Object.freeze({ L0: 0, L1: 1, L2: 2, L3: 3 });
/** The level of a repo no row names (lite: L0; the D87 floor L1 lands with Move 3's calibration). */
export const DEFAULT_STRICTNESS: StrictnessLevel = 'L0';
export const STRICTNESS_KINDS = Object.freeze(['approval.strictness.raised', 'approval.strictness.lowered'] as const);
/** A loosening card nobody decides expires into deny after this long; the level stays. */
export const LEVEL_LOOSEN_TIMEOUT_MS = 2 * 60_000;

export function isStrictnessLevel(v: unknown): v is StrictnessLevel {
  return (STRICTNESS_LEVELS as readonly unknown[]).includes(v);
}

const obj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const REPO_KEY = /^sha256:[0-9a-f]{64}$/;
const SHORT = (s: string): string => (s.length > 16 ? `…${s.slice(-10)}` : s);

/** The levels, DERIVED from kernel-signed rows (never stored elsewhere); replay reproduces them. */
export class StrictnessBook {
  readonly #trust: KernelTrustLike;
  readonly #repos = new Map<string, StrictnessLevel>();
  lastSeq = 0;

  constructor(trust: KernelTrustLike) {
    this.#trust = trust;
  }

  fold(r: RuleRow): void {
    if (typeof r.seq === 'number' && r.seq > this.lastSeq) this.lastSeq = r.seq;
    if (r.principal !== this.#trust.principal || typeof r.keyId !== 'string' || !this.#trust.isKernelKey(r.keyId, r.seq)) return;
    if (r.kind !== 'approval.strictness.raised' && r.kind !== 'approval.strictness.lowered') return;
    const p = obj(r.payload);
    if (!p || typeof p.repo !== 'string' || !('to' in p)) return;
    this.apply(p.repo, failSafeStrictnessLevel(p.to));
  }

  /** Apply a change now (the writer calls this right after its row is written; the fold reaches the same state). */
  apply(repo: string, to: StrictnessLevel): void {
    this.#repos.set(repo, to);
  }

  level(repo: string): StrictnessLevel {
    return this.#repos.get(repo) ?? DEFAULT_STRICTNESS;
  }

  repos(): Array<{ repo: string; level: StrictnessLevel }> {
    return [...this.#repos.entries()].map(([repo, level]) => ({ repo, level }));
  }

  advanceTo(seq: number): void {
    if (seq > this.lastSeq) this.lastSeq = seq;
  }
}

/** The kernel log as a source of the level rows (released head, full view), like run-mode.ts modeSourceOf. */
export function strictnessSourceOf(log: Pick<KernelLog, 'releasedHead' | 'read'>): RuleSource {
  return {
    head: () => log.releasedHead(),
    read: function* (fromSeq, toSeq) {
      for (const v of log.read({ reader: { class: 'human' }, fromSeq, toSeq, kinds: STRICTNESS_KINDS })) {
        if (v.view === 'full') yield { seq: v.event.seq, kind: v.event.kind, principal: v.event.principal, keyId: v.event.keyId, payload: v.event.payload };
      }
    },
  };
}

export interface StrictnessDeps {
  broker: Pick<ApprovalBroker, 'raise' | 'card' | 'strictnessSet'> & Partial<Pick<ApprovalBroker, 'expire'>>;
  /** the book, caught up with the chain */
  book: () => StrictnessBook;
  /** write the kernel-signed request.strictness.set row (must reject if it was not written) */
  logRequest: (payload: { repo: string; to: StrictnessLevel }, ids: { connId: string }) => Promise<void>;
  /** a repo key for an absolute path (repo-hooks.ts repoKeyOf([path])) */
  repoKeyOfPath: (abs: string) => string;
  /** the repo brake: a level rose (the daemon pauses the repo's running loops at once). Its failure never undoes the raise. */
  onTighten?: (repoKey: string, to: StrictnessLevel) => Promise<unknown> | unknown;
  /** any applied change (the supervisor re-reads each live session's ceiling) */
  onChange?: () => void;
  timeoutMs?: number;
}

export type LevelSetResult =
  | { changed: false; repoKey: string; level: StrictnessLevel }
  | { changed: true; applied: true; repoKey: string; from: StrictnessLevel; to: StrictnessLevel; presence: 'none' }
  | { changed: false; pending: true; cardId: string; repoKey: string; from: StrictnessLevel; to: StrictnessLevel };

export class StrictnessControl {
  readonly #d: StrictnessDeps;
  readonly #pending = new Map<string, { cardId: string; to: StrictnessLevel }>();
  #queue: Promise<unknown> = Promise.resolve();

  constructor(d: StrictnessDeps) {
    this.#d = d;
  }

  /** The repo's level (an unreadable book answers L3: an unreadable level never loosens anything). */
  level(repoKey: string): StrictnessLevel {
    try {
      return this.#d.book().level(repoKey);
    } catch {
      return 'L3';
    }
  }

  /** request.strictness.set{repo, to} from a human on a first-party connection (queued: one at a time). */
  request(asker: ModeAsker, payload: unknown): Promise<LevelSetResult> {
    const run = this.#queue.then(() => this.#request(asker, payload));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #request(asker: ModeAsker, payload: unknown): Promise<LevelSetResult> {
    if (asker.principalClass !== 'human' || (asker.credential !== 'gui' && asker.credential !== 'device') || typeof asker.principal !== 'string') {
      throw fail('FORBIDDEN', 'matrix', "a strictness level is set only by the human on a first-party connection (the GUI, or this home's human device)", { verb: 'log.append' });
    }
    const p = obj(payload);
    if (!p) throw fail('BAD_REQUEST', 'bad-params', 'request.strictness.set takes payload {repo, to}');
    const extra = Object.keys(p).filter((k) => k !== 'repo' && k !== 'to');
    if (extra.length) throw fail('BAD_REQUEST', 'bad-params', `request.strictness.set takes only {repo, to} (unknown: ${extra.slice(0, 4).join(', ')})`);
    if (!isStrictnessLevel(p.to)) throw fail('BAD_REQUEST', 'bad-params', `to is one of ${STRICTNESS_LEVELS.join(', ')}`);
    const to = p.to;
    let repoKey: string;
    if (typeof p.repo === 'string' && REPO_KEY.test(p.repo)) repoKey = p.repo;
    else if (typeof p.repo === 'string' && path.isAbsolute(p.repo) && p.repo.length <= 4096 && !p.repo.includes('\u0000')) repoKey = this.#d.repoKeyOfPath(p.repo);
    else throw fail('BAD_REQUEST', 'bad-params', 'repo is a repo key (sha256:…) or an absolute path');

    const from = this.level(repoKey);
    if (to === from) return { changed: false, repoKey, level: to };
    const tighten = LEVEL_RANK[to] > LEVEL_RANK[from];
    if (!tighten) {
      // G-STR-04: one level per step (a step below the evidence with the root key is M2.11 proper)
      if (LEVEL_RANK[from] - LEVEL_RANK[to] > 1) throw fail('BAD_REQUEST', 'bad-params', `loosen one level per step: ${from} → ${STRICTNESS_LEVELS[LEVEL_RANK[from] - 1]} first`, { from, to });
      const still = this.#pending.get(repoKey);
      const stillCard = still ? this.#d.broker.card(still.cardId) : undefined;
      if (still && stillCard?.state === 'pending') {
        if (still.to === to) return { changed: false, pending: true, cardId: still.cardId, repoKey, from, to };
        throw fail('BAD_REQUEST', 'bad-params', `a card loosening this repo to ${still.to} is pending; decide it first`, { cardId: still.cardId });
      }
      if (still) this.#pending.delete(repoKey);
    }
    await this.#d.logRequest({ repo: repoKey, to }, { connId: asker.connId });
    const by = { principal: asker.principal, connId: asker.connId, via: asker.credential === 'gui' ? 'gui' : 'cli' };
    if (tighten) {
      // tightening: one gesture, no presence (D86); effective at once (the book is updated in-process)
      await this.#d.broker.strictnessSet('raised', { repo: repoKey, from, to, cause: 'manual', by, presence: 'none' }, { connId: asker.connId });
      this.#d.book().apply(repoKey, to);
      // a pending card loosening this repo would undo the brake: withdrawn
      const still = this.#pending.get(repoKey);
      if (still) {
        this.#pending.delete(repoKey);
        await this.#d.broker.expire?.(still.cardId, 'level-raised').catch(() => false);
      }
      this.#changed();
      await this.#brake(repoKey, to);
      return { changed: true, applied: true, repoKey, from, to, presence: 'none' };
    }
    const card = await this.#raiseLoosen(asker, repoKey, from, to);
    this.#pending.set(repoKey, { cardId: card.cardId, to });
    return { changed: false, pending: true, cardId: card.cardId, repoKey, from, to };
  }

  async #brake(repoKey: string, to: StrictnessLevel): Promise<void> {
    try {
      await this.#d.onTighten?.(repoKey, to);
    } catch {
      /* the raise is written; the runner's per-node check still pauses the repo's loops before their next node */
    }
  }

  #changed(): void {
    try {
      this.#d.onChange?.();
    } catch {
      /* the level row is written; the next read sees it */
    }
  }

  async #raiseLoosen(asker: ModeAsker, repoKey: string, from: StrictnessLevel, to: StrictnessLevel): Promise<CardV1> {
    return this.#d.broker.raise({
      kind: 'strictness',
      requestedBy: asker.principal!,
      attended: true,
      detail: { op: 'level.loosen', repo: repoKey, from, to, connId: asker.connId },
      lines: [
        `Loosen strictness: repo ${SHORT(repoKey)} ${from} → ${to}`,
        to === 'L2' ? 'L2: loops propose and land nothing alone; sessions take the ask ceiling' : to === 'L1' ? 'L1: loops may act; at most 2 loops at once in this repo; gate-class and high-risk lands still propose' : 'L0: loops run as declared',
        `Allow needs Touch ID; deny or no answer keeps ${from}`,
      ],
      decisions: ['allow', 'deny'],
      handOnly: true,
      timeoutMs: this.#d.timeoutMs ?? LEVEL_LOOSEN_TIMEOUT_MS,
      effect: async (decision, ctx) => {
        if (decision !== 'allow') return;
        const cur = this.level(repoKey);
        if (cur !== from) throw fail('BAD_REQUEST', 'bad-params', `the level moved to ${cur} while the card waited; ask again`, { from, to, now: cur });
        // Aegis (step 9 review): fresh, hand-only presence is the ONLY presence a loosening takes; a standing grant,
        // a cached unlock or anything else is refused here, whatever the class table or a future tuple says
        if (ctx.presence !== 'fresh') throw fail('FORBIDDEN', 'presence', `lowering a strictness level takes fresh presence (got ${String(ctx.presence ?? 'none').slice(0, 40)})`, { from, to });
        await this.#d.broker.strictnessSet('lowered', { repo: repoKey, from, to, cause: 'manual', by: { principal: asker.principal!, connId: ctx.connId }, presence: 'fresh' }, { connId: ctx.connId });
        this.#d.book().apply(repoKey, to);
        this.#pending.delete(repoKey);
        this.#changed();
      },
    });
  }

  /** status.strictness (human class): built, the default, every repo with a level and its pending loosening card. */
  status(): Record<string, unknown> {
    let repos: Array<{ repo: string; level: StrictnessLevel }> = [];
    try {
      repos = this.#d.book().repos();
    } catch {
      repos = [];
    }
    return {
      built: true,
      lite: true,
      default: DEFAULT_STRICTNESS,
      levels: [...STRICTNESS_LEVELS],
      repos: repos.map((r) => {
        const p = this.#pending.get(r.repo);
        return { repoKey: r.repo, level: r.level, ...(p && this.#d.broker.card(p.cardId)?.state === 'pending' ? { pendingCardId: p.cardId, pendingTo: p.to } : {}) };
      }),
    };
  }
}
