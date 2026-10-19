/**
 * @symbol #approval-broker
 *
 * #approval-broker run modes (spec §3.4 "Run modes (D87)", D86/D87, §11.4–§11.5;
 * contracts RUN_MODES, `session.open{runMode}`, `request.mode.set`,
 * `approval.mode.set`, `approval.auto`). Kernel-owned, per repo and per session.
 *
 *   manual      the session acts only on the human's turn; writes and exec
 *               (Bash, PowerShell, Edit, Write, MultiEdit, NotebookEdit) wait
 *               on an approved `plan` card in that session (the supervisor
 *               denies them with no card until one is approved).
 *   ask         write and exec tools raise `permission` cards (Move 1's
 *               behaviour, the default).
 *   auto-edits  Edit / Write / MultiEdit / NotebookEdit of a path INSIDE the
 *               session's own roots (cwd, worktree), not gate-class (§15.7,
 *               manifest/layers.ts gateClassPathRule) and with no hidden or
 *               bidi characters on its card pass with no card, after
 *               `approval.auto{hsid, tool, path, inputHash, modeRef}`; Bash,
 *               network, every other tool and every other path still ask.
 *
 * SCOPE: a session takes its repo's mode unless one is set for it
 * (`session.open{runMode}` or `request.mode.set{hsid}`); a repo with no mode
 * set is `ask`. The modes are FOLDED from kernel-signed rows only
 * (`approval.mode.set`, `session.open{runMode}`) — RunModeBook, like
 * #always-rules' RuleBook — so a repo's mode persists across sessions and
 * kernel restarts, and `gnomon replay` sees the same chain.
 *
 * CEILING: the effective mode is the stricter of the chosen mode and the
 * repo's strictness ceiling (L0/L1 auto-edits, L2 ask, L3 manual); a request
 * looser than the ceiling is refused FORBIDDEN gate `strictness`, reason
 * `strictness-mode`. Strictness LEVELS are not built yet (M2.10): the level
 * source answers null and the ceiling then permits all three modes (status
 * says `strictness: {built: false}`), so today the refusal is reachable only
 * through the level seam.
 *
 * CHANGING: `request.mode.set{repo, hsid, to}` from a human on a first-party
 * connection (the GUI launch-token session, or this home's human device —
 * `gnomon mode`). The kernel writes the request row, then
 *   - tightening (a stricter mode): `approval.mode.set{scope, from, to, by,
 *     presence:'none'}` at once — no presence, effective on the next
 *     permission request (the book is updated in-process);
 *   - loosening: a `strictness` card (allow | deny; allow is fresh presence
 *     and hand-only in classes.ts, so never a cached unlock, never `always`,
 *     never voice) whose first line names the scope and the step; on allow
 *     its effect re-checks the ceiling and writes `approval.mode.set{…,
 *     presence:'fresh'}`. One pending loosening card per scope: the same
 *     request gets the same card, a different one is refused until it is
 *     decided. Expiry (LOOSEN_TIMEOUT_MS) is deny: the mode stays.
 */
import * as path from 'node:path';
import { failSafeRunMode, HSID_PATTERN, RUN_MODES, type CardV1, type RunMode, type StrictnessLevel } from '@a-company/gnomon-contracts';
import type { KernelLog } from '../log/index.js';
import type { RuleRow, RuleSource } from '../supervisor/rules.js';
import { fail, type ApprovalBroker } from './broker.js';

/** Stricter first: a lower rank takes more away from the agents. */
export const MODE_RANK: Readonly<Record<RunMode, number>> = Object.freeze({ manual: 0, ask: 1, 'auto-edits': 2 });
/** The repo default when no mode was ever set (Move 1's behaviour). */
export const DEFAULT_RUN_MODE: RunMode = 'ask';
/** The ⇧Tab cycle (§11.5): manual → ask → auto-edits → manual. */
export function nextRunMode(m: RunMode): RunMode {
  return m === 'manual' ? 'ask' : m === 'ask' ? 'auto-edits' : 'manual';
}
export function isRunMode(v: unknown): v is RunMode {
  return (RUN_MODES as readonly unknown[]).includes(v);
}
export function stricterMode(a: RunMode, b: RunMode): RunMode {
  return MODE_RANK[a] <= MODE_RANK[b] ? a : b;
}
/** The loosest mode a strictness level allows (§3.4 table). null = strictness not built: every mode. */
export function ceilingOf(level: StrictnessLevel | null): RunMode {
  if (level === 'L3') return 'manual';
  if (level === 'L2') return 'ask';
  return 'auto-edits';
}

/** File-editing tools auto-edits may pass (with the path key their input names it under). */
export const AUTO_EDIT_TOOLS: Readonly<Record<string, string>> = Object.freeze({ Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' });
/** Writes and exec: what `manual` holds until a plan is approved. */
export const WRITE_EXEC_TOOLS: ReadonlySet<string> = new Set(['Bash', 'PowerShell', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
/** A loosening card nobody decides expires into deny after this long; the mode stays. */
export const LOOSEN_TIMEOUT_MS = 2 * 60_000;
/** Sessions remembered by the book (oldest forgotten first; a forgotten session reads its repo's mode). */
export const MAX_TRACKED_SESSIONS = 4096;

export const MODE_KINDS = Object.freeze(['approval.mode.set', 'session.open'] as const);

const obj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export interface KernelTrustLike {
  principal: string;
  isKernelKey: (keyId: string) => boolean;
}

/**
 * The run modes, DERIVED from kernel-signed rows (never stored elsewhere). A row from any other principal or key is
 * ignored. An unknown `to` from a newer kernel folds as `manual` (contracts failSafeRunMode: never a looser value).
 * A forgotten session (past MAX_TRACKED_SESSIONS) reads its repo's mode; sessions that old have exited.
 */
export class RunModeBook {
  readonly #trust: KernelTrustLike;
  readonly #repos = new Map<string, RunMode>();
  readonly #sessions = new Map<string, RunMode>();
  lastSeq = 0;

  constructor(trust: KernelTrustLike) {
    this.#trust = trust;
  }

  fold(r: RuleRow): void {
    if (typeof r.seq === 'number' && r.seq > this.lastSeq) this.lastSeq = r.seq;
    if (r.principal !== this.#trust.principal || typeof r.keyId !== 'string' || !this.#trust.isKernelKey(r.keyId)) return;
    const p = obj(r.payload);
    if (!p) return;
    if (r.kind === 'approval.mode.set') {
      const scope = obj(p.scope);
      if (!scope || !('to' in p)) return;
      this.apply({ repo: typeof scope.repo === 'string' ? scope.repo : null, hsid: typeof scope.hsid === 'string' ? scope.hsid : null }, failSafeRunMode(p.to));
    } else if (r.kind === 'session.open') {
      if (typeof p.hsid === 'string' && 'runMode' in p && p.runMode !== null && p.runMode !== undefined) this.apply({ repo: null, hsid: p.hsid }, failSafeRunMode(p.runMode));
    }
  }

  /** Apply a change now (the writer calls this right after its row is written; the fold reaches the same state). */
  apply(scope: { repo: string | null; hsid: string | null }, to: RunMode): void {
    if (scope.hsid) {
      this.#sessions.delete(scope.hsid);
      this.#sessions.set(scope.hsid, to);
      while (this.#sessions.size > MAX_TRACKED_SESSIONS) this.#sessions.delete(this.#sessions.keys().next().value!);
    } else if (scope.repo) this.#repos.set(scope.repo, to);
  }

  repoMode(repoKey: string): RunMode | null {
    return this.#repos.get(repoKey) ?? null;
  }

  sessionMode(hsid: string): RunMode | null {
    return this.#sessions.get(hsid) ?? null;
  }

  repos(): Array<{ repo: string; mode: RunMode }> {
    return [...this.#repos.entries()].map(([repo, mode]) => ({ repo, mode }));
  }

  advanceTo(seq: number): void {
    if (seq > this.lastSeq) this.lastSeq = seq;
  }
}

/** The kernel log as a source of the mode rows (released head, full view), like rules.ts ruleSourceOf. */
export function modeSourceOf(log: Pick<KernelLog, 'releasedHead' | 'read'>): RuleSource {
  return {
    head: () => log.releasedHead(),
    read: function* (fromSeq, toSeq) {
      for (const v of log.read({ reader: { class: 'human' }, fromSeq, toSeq, kinds: MODE_KINDS })) {
        if (v.view === 'full') yield { seq: v.event.seq, kind: v.event.kind, principal: v.event.principal, keyId: v.event.keyId, payload: v.event.payload };
      }
    },
  };
}

/** What the supervisor and status read for one session. */
export interface RunModeView {
  /** the mode set for the session, else its repo's, else the default */
  chosen: RunMode;
  source: 'session' | 'repo' | 'default';
  /** the repo's mode (or the default) — what the session falls back to */
  repoMode: RunMode;
  level: StrictnessLevel | null;
  ceiling: RunMode;
  /** stricter of chosen and ceiling: what the permission channel applies */
  effective: RunMode;
}

export interface ModeAsker {
  connId: string;
  principal: string | undefined;
  principalClass: string;
  /** only `gui` (the launch-token GUI session) and `device` (this home's human device) are first-party */
  credential: string | undefined;
}

export interface ModeSessionScope {
  hsid: string;
  repoKey: string;
  cwd: string;
}

export interface RunModeDeps {
  broker: Pick<ApprovalBroker, 'raise' | 'card' | 'modeSet'>;
  /** the book, caught up with the chain */
  book: () => RunModeBook;
  /** a LIVE session's scope (null: unknown or exited) and every live session */
  sessions: { scope(hsid: string): ModeSessionScope | null; live(): ModeSessionScope[] };
  /** the repo's strictness level; absent or null ⇒ strictness not built (the ceiling permits every mode) */
  level?: (repoKey: string) => StrictnessLevel | null;
  /** write the kernel-signed request.mode.set row (must reject if it was not written) */
  logRequest: (payload: { repo: string; hsid: string | null; to: RunMode }, ids: { connId: string; session?: string }) => Promise<void>;
  /** a repo key for an absolute path (repo-hooks.ts repoKeyOf([path])) */
  repoKeyOfPath: (abs: string) => string;
  timeoutMs?: number;
}

export type ModeSetResult =
  | { changed: false; scope: { repo: string; hsid: string | null }; mode: RunMode; effective: RunMode }
  | { changed: true; applied: true; scope: { repo: string; hsid: string | null }; from: RunMode; to: RunMode; effective: RunMode; presence: 'none' }
  | { changed: false; pending: true; cardId: string; scope: { repo: string; hsid: string | null }; from: RunMode; to: RunMode };

const REPO_KEY = /^sha256:[0-9a-f]{64}$/;
const SHORT = (s: string): string => (s.length > 16 ? `…${s.slice(-10)}` : s);

export class RunModeControl {
  readonly #d: RunModeDeps;
  /** pending loosening cards by scope key */
  readonly #pending = new Map<string, { cardId: string; to: RunMode }>();
  /** one change at a time (two quick ⇧Tabs apply in order, each against the mode the last one left) */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(d: RunModeDeps) {
    this.#d = d;
  }

  #level(repoKey: string): StrictnessLevel | null {
    try {
      return this.#d.level?.(repoKey) ?? null;
    } catch {
      return 'L3'; // an unreadable level never loosens anything (fail safe: manual)
    }
  }

  repoView(repoKey: string): { mode: RunMode; level: StrictnessLevel | null; ceiling: RunMode; effective: RunMode } {
    const mode = this.#d.book().repoMode(repoKey) ?? DEFAULT_RUN_MODE;
    const level = this.#level(repoKey);
    const ceiling = ceilingOf(level);
    return { mode, level, ceiling, effective: stricterMode(mode, ceiling) };
  }

  view(hsid: string, repoKey: string): RunModeView {
    const book = this.#d.book();
    const repoMode = book.repoMode(repoKey) ?? DEFAULT_RUN_MODE;
    const own = book.sessionMode(hsid);
    const level = this.#level(repoKey);
    const ceiling = ceilingOf(level);
    const chosen = own ?? repoMode;
    return { chosen, source: own ? 'session' : book.repoMode(repoKey) ? 'repo' : 'default', repoMode, level, ceiling, effective: stricterMode(chosen, ceiling) };
  }

  /**
   * session.open{runMode} admission (§3.4): an unknown mode is BAD_REQUEST, a mode over the ceiling is
   * FORBIDDEN{strictness-mode}; a mode no looser than the repo's is set by the open itself (`direct`, written on
   * session.open{runMode}); a looser one is NOT applied by the open — the session starts at its repo's mode and
   * `loosen` names the step the caller raises a card for (a looser mode always takes fresh presence).
   */
  admitOpen(cwd: string, runMode: unknown): { direct: RunMode | null; loosen: RunMode | null } {
    if (runMode === undefined) return { direct: null, loosen: null };
    if (!isRunMode(runMode)) throw fail('BAD_REQUEST', 'bad-params', `runMode is one of ${RUN_MODES.join(', ')}`);
    const r = this.repoView(this.#d.repoKeyOfPath(cwd));
    if (MODE_RANK[runMode] > MODE_RANK[r.ceiling]) throw this.#overCeiling(runMode, r.ceiling, r.level);
    return MODE_RANK[runMode] <= MODE_RANK[r.mode] ? { direct: runMode, loosen: null } : { direct: null, loosen: runMode };
  }

  #overCeiling(to: RunMode, ceiling: RunMode, level: StrictnessLevel | null): Error {
    return fail('FORBIDDEN', 'strictness-mode', `${to} is looser than the repo's ceiling ${ceiling}${level ? ` at ${level}` : ''}`, { gate: 'strictness', ceiling, ...(level ? { level } : {}) });
  }

  /** request.mode.set{repo?, hsid?, to} from a human on a first-party connection. */
  request(asker: ModeAsker, payload: unknown): Promise<ModeSetResult> {
    const run = this.#queue.then(() => this.#request(asker, payload));
    this.#queue = run.catch(() => undefined);
    return run;
  }

  async #request(asker: ModeAsker, payload: unknown): Promise<ModeSetResult> {
    if (asker.principalClass !== 'human' || (asker.credential !== 'gui' && asker.credential !== 'device') || typeof asker.principal !== 'string') {
      throw fail('FORBIDDEN', 'matrix', 'a run mode is set only by the human on a first-party connection (the GUI, or this home\'s human device)', { verb: 'log.append' });
    }
    const p = obj(payload);
    if (!p) throw fail('BAD_REQUEST', 'bad-params', 'request.mode.set takes payload {to, hsid?, repo?}');
    const extra = Object.keys(p).filter((k) => k !== 'repo' && k !== 'hsid' && k !== 'to');
    if (extra.length) throw fail('BAD_REQUEST', 'bad-params', `request.mode.set takes only {repo, hsid, to} (unknown: ${extra.slice(0, 4).join(', ')})`);
    if (!isRunMode(p.to)) throw fail('BAD_REQUEST', 'bad-params', `to is one of ${RUN_MODES.join(', ')}`);
    const to = p.to;
    let repo: string;
    let hsid: string | null = null;
    if (p.hsid !== undefined && p.hsid !== null) {
      if (typeof p.hsid !== 'string' || !HSID_PATTERN.test(p.hsid)) throw fail('BAD_REQUEST', 'bad-params', 'hsid must be a session id');
      const sc = this.#d.sessions.scope(p.hsid);
      if (!sc) throw fail('NOT_FOUND', 'not-found', `no live session ${p.hsid}`);
      hsid = sc.hsid;
      repo = sc.repoKey;
      if (p.repo !== undefined && p.repo !== null && p.repo !== repo) throw fail('BAD_REQUEST', 'bad-params', 'repo does not name this session\'s repo (send hsid alone for a session, repo alone for a repo)');
    } else if (typeof p.repo === 'string' && REPO_KEY.test(p.repo)) repo = p.repo;
    else if (typeof p.repo === 'string' && path.isAbsolute(p.repo) && p.repo.length <= 4096 && !p.repo.includes('\u0000')) repo = this.#d.repoKeyOfPath(p.repo);
    else throw fail('BAD_REQUEST', 'bad-params', 'name a session (hsid) or a repo (its repo key, or an absolute path)');

    const level = this.#level(repo);
    const ceiling = ceilingOf(level);
    const from = hsid ? this.view(hsid, repo).chosen : (this.#d.book().repoMode(repo) ?? DEFAULT_RUN_MODE);
    const scope = { repo, hsid };
    if (MODE_RANK[to] > MODE_RANK[ceiling]) throw this.#overCeiling(to, ceiling, level);
    if (to === from) return { changed: false, scope, mode: to, effective: stricterMode(to, ceiling) };

    const key = `${repo}|${hsid ?? ''}`;
    const tighten = MODE_RANK[to] < MODE_RANK[from];
    if (!tighten) {
      // one pending loosening card per scope: the same request gets the same card; another waits until it is decided
      const still = this.#pending.get(key);
      const stillCard = still ? this.#d.broker.card(still.cardId) : undefined;
      if (still && stillCard?.state === 'pending') {
        if (still.to === to) return { changed: false, pending: true, cardId: still.cardId, scope, from, to };
        throw fail('BAD_REQUEST', 'bad-params', `a card loosening this ${hsid ? 'session' : 'repo'} to ${still.to} is pending; decide it first`, { cardId: still.cardId });
      }
      if (still) this.#pending.delete(key);
    }
    await this.#d.logRequest({ repo, hsid, to }, { connId: asker.connId, ...(hsid ? { session: hsid } : {}) });
    if (tighten) {
      // tightening: one gesture, no presence (D86/D87)
      await this.#d.broker.modeSet({ scope, from, to, by: { principal: asker.principal, connId: asker.connId, via: asker.credential === 'gui' ? 'gui' : 'cli' }, presence: 'none' }, { connId: asker.connId, ...(hsid ? { session: hsid } : {}) });
      this.#d.book().apply(scope, to);
      return { changed: true, applied: true, scope, from, to, effective: stricterMode(to, ceiling), presence: 'none' };
    }
    // loosening: one gesture plus fresh presence, through a strictness card
    const card = await this.#raiseLoosen(asker, scope, from, to);
    this.#pending.set(key, { cardId: card.cardId, to });
    return { changed: false, pending: true, cardId: card.cardId, scope, from, to };
  }

  /** The loosening card for a session opened with a looser runMode (admitOpen's `loosen`). */
  async loosenOpened(asker: ModeAsker, hsid: string, to: RunMode): Promise<ModeSetResult> {
    return this.request(asker, { hsid, to });
  }

  async #raiseLoosen(asker: ModeAsker, scope: { repo: string; hsid: string | null }, from: RunMode, to: RunMode): Promise<CardV1> {
    const sc = scope.hsid ? this.#d.sessions.scope(scope.hsid) : null;
    const where = scope.hsid ? `session ${SHORT(scope.hsid)}${sc ? ` (${sc.cwd})` : ''}` : `repo ${SHORT(scope.repo)}`;
    const what =
      to === 'auto-edits'
        ? 'auto-edits: Edit / Write / MultiEdit / NotebookEdit inside the session\'s own folder pass with no card (each logged approval.auto); Bash, network, edits outside it and gate-class paths (.claude, CLAUDE*.md, .git, package.json, …) still ask'
        : 'ask: write and exec tools raise a permission card each time';
    return this.#d.broker.raise({
      kind: 'strictness',
      requestedBy: asker.principal!,
      ...(scope.hsid ? { hsid: scope.hsid } : {}),
      attended: true,
      detail: { op: 'mode.loosen', scope: { repo: scope.repo, hsid: scope.hsid }, from, to, connId: asker.connId },
      lines: [`Loosen run mode: ${where} ${from} → ${to}`, what, `scope: ${scope.hsid ? `this session only (repo ${SHORT(scope.repo)})` : 'every session of this repo that has no mode of its own'}`, `Allow needs Touch ID; deny or no answer keeps ${from}`],
      decisions: ['allow', 'deny'],
      timeoutMs: this.#d.timeoutMs ?? LOOSEN_TIMEOUT_MS,
      effect: async (decision, ctx) => {
        if (decision !== 'allow') return;
        const level = this.#level(scope.repo);
        const ceiling = ceilingOf(level);
        if (MODE_RANK[to] > MODE_RANK[ceiling]) throw this.#overCeiling(to, ceiling, level); // the level rose while the card waited
        const cur = scope.hsid ? this.view(scope.hsid, scope.repo).chosen : (this.#d.book().repoMode(scope.repo) ?? DEFAULT_RUN_MODE);
        await this.#d.broker.modeSet({ scope, from: cur, to, by: { principal: asker.principal!, connId: ctx.connId }, presence: 'fresh' }, { connId: ctx.connId, ...(scope.hsid ? { session: scope.hsid } : {}) });
        this.#d.book().apply(scope, to);
      },
    });
  }

  /** status.runModes (human class): the default, whether strictness is built, every set repo and every live session. */
  status(): Record<string, unknown> {
    const live = this.#d.sessions.live();
    return {
      default: DEFAULT_RUN_MODE,
      modes: [...RUN_MODES],
      strictness: { built: this.#d.level === undefined ? false : true, note: this.#d.level === undefined ? 'strictness levels are not built (M2.10): the ceiling permits every mode' : 'level per repo' },
      repos: this.#d.book().repos().map((r) => ({ repo: r.repo, ...this.repoView(r.repo) })),
      sessions: live.map((s) => ({ hsid: s.hsid, repo: s.repoKey, cwd: s.cwd, ...this.view(s.hsid, s.repoKey), ...(this.#pendingFor(s.repoKey, s.hsid) ? { pendingCardId: this.#pendingFor(s.repoKey, s.hsid) } : {}) })),
    };
  }

  #pendingFor(repo: string, hsid: string): string | null {
    const p = this.#pending.get(`${repo}|${hsid}`);
    return p && this.#d.broker.card(p.cardId)?.state === 'pending' ? p.cardId : null;
  }
}
