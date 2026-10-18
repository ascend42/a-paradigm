/**
 * @symbol #budget-fuse
 *
 * #budget-fuse (spec §3.4 "The fuse — four dimensions", §4.8 `permit:v1`,
 * §10 laws 1, 5 and 7; B1–B3, B5; M1.6). Every spend is a permit; the fuse
 * reserves, grants or denies, and meters ONLY from stream events.
 *
 *   (1) tokens per user / repo / loop / session per day;
 *   (2) notional USD on the same ladder;
 *   (3) compute: concurrent local sessions per machine (CPU seconds per hour
 *       and wall time per local turn are carried for #local-runner, M1.8);
 *   (4) subscription windows (D35): a rolling window of `turn.usage` tokens;
 *       the founder-interactive share (30 %, OPEN 6) is never consumed by the
 *       armada (agent or session principals, or unattended work) — at the
 *       threshold the armada pauses with ONE `budget` card while an attended
 *       human session still gets a permit (G-SUB-04).
 *
 * Ladder user → repo → loop → session; rungs 50/75/90/100 % announced once
 * per scope per day (`budget.ladder`). Breaker on `quota.error`: 60 min or a
 * human `resume`. Day windows use `lastEventTime()` (the chain's last event
 * time, S-L2); days are UTC calendar days. Concurrency counts unreleased,
 * unexpired `session.spawn` permits. Day caps and the window threshold count
 * the outstanding headroom of live permits, and a new permit's limits are
 * clamped to what is left (Aegis C6).
 *
 * DEFERRED (reported): the day and window counters live in memory; rebuilding
 * them from `budget.usage` rows at boot is the next slice (beside S-L2), so a
 * daemon restart today forgets the day's usage.
 *
 * Law 7: `session.spawn`/`turn` for `backend: claude-code` runs the billing
 * scan (billing.ts) and is refused BILLING_REFUSED on any hit, unless the
 * session holds an active per-use api-token card (then
 * `billing: api-token:<cardId>`). No setting turns either off (G-LAW-01b):
 * the fuse reads only its root-signed config (config.ts).
 *
 * G-BUD-01: usage enters only through `recordStreamUsage` with a
 * `turn.usage` / `turn.result` source; `permit.reserve` params carry no
 * usage. G-BUD-02: a malformed usage event or a corrupt signed config makes
 * the fuse corrupt, and a corrupt fuse denies every reserve. G-BUD-03: usage
 * that breaches a permit mid-turn calls `onBreach` (the #supervisor kills the
 * session's process group, M1.7) and pauses the session.
 */
import { canonicalJson, mintId, refuse, RefusedError, type RefusalCode } from '@a-company/gnomon-contracts';
import type { Signer } from '../log/signer.js';
import type { ApprovalBroker } from '../broker/broker.js';
import type { ApiTokenBilling } from '../broker/api-token.js';
import { scanApiBilling, type BillingScanSource } from './billing.js';
import { DEFAULT_FUSE, HUMAN_RESERVE, type FuseConfig, type ScopeName } from './config.js';

export const PERMIT_KINDS = Object.freeze(['session.spawn', 'turn', 'tool.permission', 'tend.llm', 'oracle.reviewer', 'teacher.draft', 'mod.spend'] as const);
export type PermitKind = (typeof PERMIT_KINDS)[number];
export const RUNGS = Object.freeze([0.5, 0.75, 0.9, 1]);
const LAW7_KINDS: readonly string[] = ['session.spawn', 'turn'];

export type FuseLog = (kind: string, payload: Record<string, unknown>, ids?: { session?: string; connId?: string }) => Promise<void>;

export interface PermitScope {
  user: string;
  repo?: string;
  loop?: string;
  session?: string;
  machine?: string;
}

export interface ReserveRequest {
  principal: string;
  /** dispatch matrix class of the requester */
  principalClass: string;
  /** a human client is attached (interactive): may use the human reserve */
  attended: boolean;
  kind: string;
  scope: PermitScope;
  backend?: 'claude-code' | 'local';
  model?: string;
  limits?: { tokens?: number; usd?: number; computeSeconds?: number; concurrent?: number };
  tool?: string;
  /**
   * Set ONLY by the kernel's own spawn path (#supervisor, M1.7), never by
   * parseReserveParams: the session the kernel is about to spawn, for which
   * an api-token card may bill (Aegis C3).
   */
  kernelSpawn?: { hsid: string };
}

export interface PermitV1 {
  schemaVersion: 'permit:v1';
  permitId: string;
  log: string;
  principal: string;
  hsid: string | null;
  scope: { org: null; team: null; user: string; repo: string | null; loop: string | null; session: string | null; machine: string | null };
  kind: PermitKind;
  backend: 'claude-code' | 'local';
  model: string;
  billing: string;
  limits: { tokens: number; usd: number; computeSeconds: number; concurrent: number };
  issuedAt: string;
  expiresAt: string;
  ladder: Record<string, number | null>;
  decision: 'allow';
  sig: string;
}

export interface StreamUsage {
  source: 'turn.usage' | 'turn.result';
  permitId: string;
  hsid?: string;
  tokens: number;
  usd?: number;
}

export interface FuseOptions {
  kernel: Signer;
  logId: string;
  log: FuseLog;
  config?: FuseConfig;
  /** the signed config was invalid: deny everything (B5) */
  corrupt?: boolean;
  billing: BillingScanSource;
  apiTokens?: ApiTokenBilling;
  broker?: ApprovalBroker;
  kernelPrincipal?: string;
  clock?: () => number;
  /** the chain's last event time (S-L2); default: clock */
  lastEventTime?: () => number;
  /** G-BUD-03: a permit was breached mid-turn — the supervisor kills the session's pgid (M1.7) */
  onBreach?: (b: { permitId: string; hsid: string | null; dimension: 'tokens' | 'usd' }) => void;
  permitTtlMs?: number;
}

interface Held {
  permit: PermitV1;
  released: boolean;
  used: { tokens: number; usd: number };
  breached: boolean;
}

export function fuseFail(code: RefusalCode, message: string, data: Record<string, unknown>): RefusedError {
  return new RefusedError(refuse({ code, data }), `#budget-fuse: ${message}`);
}

export class BudgetFuse {
  readonly #o: FuseOptions;
  readonly #cfg: FuseConfig;
  readonly #permits = new Map<string, Held>();
  /** `${day}|${dim}|${scope}|${id}` → amount */
  readonly #day = new Map<string, number>();
  readonly #window: Array<{ at: number; tokens: number }> = [];
  readonly #announced = new Set<string>();
  #corrupt: boolean;
  #breakerUntil = 0;
  #armadaPaused = false;
  #budgetCardId: string | null = null;
  /** a human resume grants the armada one window of allowance (logged), never erases the window */
  #allowanceUntil = 0;
  readonly #clock: () => number;

  constructor(o: FuseOptions) {
    this.#o = o;
    this.#cfg = o.config ?? structuredClone(DEFAULT_FUSE);
    this.#corrupt = o.corrupt ?? false;
    this.#clock = o.clock ?? Date.now;
  }

  get corrupt(): boolean {
    return this.#corrupt;
  }

  #dayKey(): string {
    return new Date(this.#o.lastEventTime?.() ?? this.#clock()).toISOString().slice(0, 10);
  }

  #scopes(s: PermitScope): Array<[ScopeName, string]> {
    const out: Array<[ScopeName, string]> = [['user', s.user]];
    if (s.repo) out.push(['repo', s.repo]);
    if (s.loop) out.push(['loop', s.loop]);
    if (s.session) out.push(['session', s.session]);
    return out;
  }

  #windowUsed(): number {
    const now = this.#o.lastEventTime?.() ?? this.#clock();
    const from = now - this.#cfg.subscription.windowMs;
    while (this.#window.length && this.#window[0]!.at < from) this.#window.shift();
    return this.#window.reduce((a, e) => a + e.tokens, 0);
  }

  /** Is this requester part of the armada (cannot consume the human reserve)? */
  static isArmada(r: Pick<ReserveRequest, 'principalClass' | 'attended'>): boolean {
    return r.principalClass !== 'human' || !r.attended;
  }

  async #deny(req: ReserveRequest, code: RefusalCode, why: string, data: Record<string, unknown> = {}): Promise<never> {
    await this.#o.log('permit.deny', { kind: req.kind, principal: req.principal, why, ...data }, req.scope.session ? { session: req.scope.session } : {}).catch(() => undefined);
    throw fuseFail(code, `${req.kind} denied: ${why}`, { dimension: why, ...data });
  }

  async reserve(req: ReserveRequest): Promise<PermitV1> {
    if (!(PERMIT_KINDS as readonly string[]).includes(req.kind)) throw fuseFail('BAD_REQUEST', `unknown permit kind ${String(req.kind).slice(0, 64)}`, { kinds: [...PERMIT_KINDS] });
    await this.#o.log('permit.reserve', { kind: req.kind, principal: req.principal, scope: req.scope, backend: req.backend ?? null }, req.scope.session ? { session: req.scope.session } : {});
    if (this.#corrupt) return this.#deny(req, 'BUDGET_DENIED', 'corrupt-state');
    const backend = req.backend ?? 'claude-code';
    // law 7 (inside the broker): no API-billing path for a kernel-spawned Claude session
    let billing = backend === 'local' ? 'local' : 'subscription';
    if (backend === 'claude-code' && LAW7_KINDS.includes(req.kind)) {
      const token = req.kernelSpawn && req.kind === 'session.spawn' ? (this.#o.apiTokens?.billingForKernelSpawn(req.kernelSpawn.hsid, req.principal) ?? null) : null;
      if (token) billing = token;
      {
        // under an api-token the scan still runs; only the injected key is ignored (reviewer 4)
        const hits = scanApiBilling(this.#o.billing, token ? { ignoreEnv: ['ANTHROPIC_API_KEY'] } : {});
        if (hits.length) {
          await this.#o.log('billing.api.refused', { where: hits.map((h) => h.where), keys: hits.map((h) => h.key) }).catch(() => undefined);
          return this.#deny(req, 'BILLING_REFUSED', 'api-billing-path', { hits: hits.map((h) => ({ where: h.where, key: h.key })) });
        }
      }
    }
    const now = this.#clock();
    if (backend === 'claude-code' && now < this.#breakerUntil) return this.#deny(req, 'BUDGET_DENIED', 'breaker', { until: new Date(this.#breakerUntil).toISOString() });
    // (4) subscription window: the armada never eats the human reserve
    const live = (h: Held): boolean => !h.released && Date.parse(h.permit.expiresAt) > now;
    const headroomOf = (h: Held, dim: 'tokens' | 'usd'): number => Math.max(0, h.permit.limits[dim] - h.used[dim]);
    let windowLeft = Number.POSITIVE_INFINITY;
    if (backend === 'claude-code' && BudgetFuse.isArmada(req)) {
      const threshold = (1 - HUMAN_RESERVE) * this.#cfg.subscription.windowTokens;
      const committed = [...this.#permits.values()].filter((h) => live(h) && h.permit.backend === 'claude-code').reduce((a, h) => a + headroomOf(h, 'tokens'), 0);
      const used = this.#windowUsed();
      windowLeft = threshold - used - committed;
      if (used < threshold && this.#armadaPaused) await this.#unpauseArmada('window');
      if (now >= this.#allowanceUntil && (used >= threshold || windowLeft <= 0)) {
        await this.#pauseArmada(used);
        return this.#deny(req, 'BUDGET_DENIED', 'subscription-window', { used: { n: used, of: this.#cfg.subscription.windowTokens }, reservedForHuman: HUMAN_RESERVE, ...(this.#budgetCardId ? { cardId: this.#budgetCardId } : {}) });
      }
    }
    // concurrency (session.spawn) per scope, and (3) compute: local sessions per machine
    if (req.kind === 'session.spawn') {
      const spawns = [...this.#permits.values()].filter((h) => live(h) && h.permit.kind === 'session.spawn');
      for (const [name, id] of this.#scopes(req.scope)) {
        const n = spawns.filter((h) => (h.permit.scope as Record<string, string | null>)[name] === id).length;
        if (n >= this.#cfg.concurrent[name]) return this.#deny(req, 'BUDGET_DENIED', 'concurrent', { scope: name, n: { n, of: this.#cfg.concurrent[name] } });
      }
      if (backend === 'local') {
        const n = spawns.filter((h) => h.permit.backend === 'local' && h.permit.scope.machine === (req.scope.machine ?? null)).length;
        if (n >= this.#cfg.compute.concurrentLocalPerMachine) return this.#deny(req, 'BUDGET_DENIED', 'compute', { n: { n, of: this.#cfg.compute.concurrentLocalPerMachine } });
      }
    }
    // (1)(2) tokens and USD per scope per day
    const day = this.#dayKey();
    const ladder: Record<string, number | null> = { user: null, repo: null, loop: null, session: null, machine: null, subscriptionWindow: this.#windowUsed() / this.#cfg.subscription.windowTokens };
    const left = { tokens: windowLeft, usd: Number.POSITIVE_INFINITY };
    for (const [name, id] of this.#scopes(req.scope)) {
      for (const dim of ['tokens', 'usd'] as const) {
        const used = this.#day.get(`${day}|${dim}|${name}|${id}`) ?? 0;
        const of = this.#cfg[dim][name];
        const committed = [...this.#permits.values()].filter((h) => live(h) && (h.permit.scope as Record<string, string | null>)[name] === id).reduce((a, h) => a + headroomOf(h, dim), 0);
        if (used + committed >= of) return this.#deny(req, 'BUDGET_DENIED', dim, { scope: name, used: { n: used, of }, committed });
        left[dim] = Math.min(left[dim], of - used - committed);
        ladder[name] = Math.max(ladder[name] ?? 0, used / of);
      }
    }
    const limits = {
      tokens: Math.min(req.limits?.tokens ?? this.#cfg.tokens.session, this.#cfg.tokens.session, left.tokens),
      usd: Math.min(req.limits?.usd ?? this.#cfg.usd.session, this.#cfg.usd.session, left.usd),
      computeSeconds: Math.min(req.limits?.computeSeconds ?? this.#cfg.compute.wallSecondsPerLocalTurn, this.#cfg.compute.wallSecondsPerLocalTurn),
      concurrent: Math.min(req.limits?.concurrent ?? 1, this.#cfg.concurrent.session),
    };
    const unsigned: Omit<PermitV1, 'sig'> = {
      schemaVersion: 'permit:v1',
      permitId: mintId('permit'),
      log: this.#o.logId,
      principal: req.principal,
      hsid: req.scope.session ?? null,
      scope: { org: null, team: null, user: req.scope.user, repo: req.scope.repo ?? null, loop: req.scope.loop ?? null, session: req.scope.session ?? null, machine: req.scope.machine ?? null },
      kind: req.kind as PermitKind,
      backend,
      model: req.model ?? 'any',
      billing,
      limits,
      issuedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + (this.#o.permitTtlMs ?? 60 * 60_000)).toISOString(),
      ladder,
      decision: 'allow',
    };
    const permit: PermitV1 = { ...unsigned, sig: Buffer.from(this.#o.kernel.sign('permit', canonicalJson(unsigned))).toString('base64') };
    // held synchronously with the checks above (no await between them), so concurrent reserves cannot all pass one limit
    this.#permits.set(permit.permitId, { permit, released: false, used: { tokens: 0, usd: 0 }, breached: false });
    try {
      await this.#o.log('permit.grant', { permit }, permit.hsid ? { session: permit.hsid } : {});
    } catch (err) {
      this.#permits.delete(permit.permitId); // never a permit without its row
      throw err;
    }
    return permit;
  }

  async release(permitId: string, by: string): Promise<void> {
    const h = this.#permits.get(permitId);
    if (!h || h.released) throw fuseFail('NOT_FOUND', `no live permit ${String(permitId).slice(0, 64)}`, {});
    if (h.permit.principal !== by) throw fuseFail('FORBIDDEN', 'a permit is released by its holder', {});
    h.released = true; // before the await: no concurrent double release (rolled back if the row fails)
    try {
      await this.#o.log('permit.release', { permitId }, h.permit.hsid ? { session: h.permit.hsid } : {});
    } catch (err) {
      h.released = false;
      throw err;
    }
  }

  permit(permitId: string): PermitV1 | undefined {
    return this.#permits.get(permitId)?.permit;
  }

  /** G-BUD-01: the ONLY usage input — a stream event from the supervisor. Malformed ⇒ corrupt (G-BUD-02). */
  async recordStreamUsage(ev: StreamUsage): Promise<void> {
    const ok =
      ev !== null &&
      typeof ev === 'object' &&
      (ev.source === 'turn.usage' || ev.source === 'turn.result') &&
      typeof ev.tokens === 'number' &&
      Number.isFinite(ev.tokens) &&
      ev.tokens >= 0 &&
      (ev.usd === undefined || (typeof ev.usd === 'number' && Number.isFinite(ev.usd) && ev.usd >= 0));
    const h = ok ? this.#permits.get(ev.permitId) : undefined;
    if (!ok || !h) {
      this.#corrupt = true;
      await this.#o.log('budget.usage', { corrupt: true, permitId: typeof ev?.permitId === 'string' ? ev.permitId.slice(0, 80) : null }).catch(() => undefined);
      return;
    }
    const usd = ev.usd ?? 0;
    h.used.tokens += ev.tokens;
    h.used.usd += usd;
    const day = this.#dayKey();
    for (const [name, id] of this.#scopes({ user: h.permit.scope.user, ...(h.permit.scope.repo ? { repo: h.permit.scope.repo } : {}), ...(h.permit.scope.loop ? { loop: h.permit.scope.loop } : {}), ...(h.permit.scope.session ? { session: h.permit.scope.session } : {}) })) {
      for (const [dim, amt] of [['tokens', ev.tokens], ['usd', usd]] as const) {
        const k = `${day}|${dim}|${name}|${id}`;
        const v = (this.#day.get(k) ?? 0) + amt;
        this.#day.set(k, v);
        await this.#announce(day, dim, name, id, v / this.#cfg[dim][name]);
      }
    }
    if (h.permit.backend === 'claude-code') this.#window.push({ at: this.#o.lastEventTime?.() ?? this.#clock(), tokens: ev.tokens });
    await this.#o.log('budget.usage', { permitId: ev.permitId, hsid: h.permit.hsid, source: ev.source, tokens: ev.tokens, usd }, h.permit.hsid ? { session: h.permit.hsid } : {});
    if (h.permit.billing.startsWith('api-token:') && h.permit.hsid) await this.#o.apiTokens?.onTurn(h.permit.hsid);
    const dim = h.used.tokens > h.permit.limits.tokens ? 'tokens' : h.used.usd > h.permit.limits.usd ? 'usd' : null;
    if (dim && !h.breached) {
      h.breached = true;
      await this.#o.log('budget.pause', { scope: 'session', hsid: h.permit.hsid, permitId: ev.permitId, reason: 'breach', dimension: dim }, h.permit.hsid ? { session: h.permit.hsid } : {});
      this.#o.onBreach?.({ permitId: ev.permitId, hsid: h.permit.hsid, dimension: dim });
    }
  }

  async #announce(day: string, dim: string, scope: string, id: string, frac: number): Promise<void> {
    for (const rung of RUNGS) {
      const k = `${day}|${dim}|${scope}|${id}|${rung}`;
      if (frac >= rung && !this.#announced.has(k)) {
        this.#announced.add(k);
        await this.#o.log('budget.ladder', { scope, id, dimension: dim, rung, day });
      }
    }
  }

  async #pauseArmada(used: number): Promise<void> {
    if (this.#armadaPaused) return;
    this.#armadaPaused = true;
    await this.#o.log('budget.window', { used, of: this.#cfg.subscription.windowTokens, reservedForHuman: HUMAN_RESERVE });
    await this.#o.log('budget.pause', { scope: 'armada', reason: 'subscription-window' });
    if (this.#o.broker) {
      const card = await this.#o.broker.raise({
        kind: 'budget',
        requestedBy: this.#o.kernelPrincipal ?? 'p:00000000/kernel',
        attended: false,
        detail: { reason: 'subscription-window', used, of: this.#cfg.subscription.windowTokens, reservedForHuman: HUMAN_RESERVE },
        lines: [`Armada paused: subscription window at ${Math.round((used / this.#cfg.subscription.windowTokens) * 100)} %`, `${Math.round(HUMAN_RESERVE * 100)} % is reserved for your interactive sessions`],
      });
      this.#budgetCardId = card.cardId;
      // resume ⇒ one-window allowance; deny/expired ⇒ stay paused until the window falls under the threshold
      void this.#o.broker
        .decisionOf(card.cardId)
        .then((d) => (d === 'resume' ? this.resume('card') : undefined))
        .catch(() => undefined);
    }
  }

  /** `quota.error` from the adapter: the breaker opens for breakerMs (or until a human resume). */
  async quotaError(hsid: string | null): Promise<void> {
    this.#breakerUntil = this.#clock() + this.#cfg.breakerMs;
    await this.#o.log('budget.breaker.open', { hsid, until: new Date(this.#breakerUntil).toISOString() });
  }

  /** The window fell under the threshold: the pause ends; a re-crossing raises a new card. */
  async #unpauseArmada(by: string): Promise<void> {
    this.#armadaPaused = false;
    this.#budgetCardId = null;
    await this.#o.log('budget.resume', { by: `kernel:${by}` });
  }

  /**
   * A human resume (the budget card's `resume`, or the GUI control): closes
   * the breaker and grants the armada ONE window of allowance, logged; the
   * window's usage is kept (reviewer 6).
   */
  async resume(by: string): Promise<void> {
    if (this.#breakerUntil > this.#clock()) await this.#o.log('budget.breaker.close', { by });
    this.#breakerUntil = 0;
    this.#allowanceUntil = this.#clock() + this.#cfg.subscription.windowMs;
    this.#armadaPaused = false;
    this.#budgetCardId = null;
    await this.#o.log('budget.resume', { by, allowance: { until: new Date(this.#allowanceUntil).toISOString(), windowMs: this.#cfg.subscription.windowMs } });
  }

  status(): Record<string, unknown> {
    const used = this.#windowUsed();
    return {
      corrupt: this.#corrupt,
      armadaPaused: this.#armadaPaused,
      breaker: this.#breakerUntil > this.#clock() ? { open: true, until: new Date(this.#breakerUntil).toISOString() } : { open: false },
      subscriptionWindow: { used: { n: used, of: this.#cfg.subscription.windowTokens }, reservedForHuman: HUMAN_RESERVE },
      permits: { n: [...this.#permits.values()].filter((h) => !h.released).length },
    };
  }
}

/* ── permit.reserve params (§5 verb 7) ───────────────────────────────────── */

function bad(reason: 'bad-params', message: string): RefusedError {
  return new RefusedError(refuse({ code: 'BAD_REQUEST', data: { reason } }), `#budget-fuse: ${message}`);
}

const RESERVE_KEYS = ['kind', 'scope', 'backend', 'model', 'limits', 'tool', 'input'] as const;
const SCOPE_KEYS = ['repo', 'loop', 'session', 'machine'] as const;

/**
 * Parse `permit.reserve` params for a caller. The user scope is the CALLER's
 * (never named by the caller); usage is never a parameter (G-BUD-01): an
 * unknown key is BAD_REQUEST. `{op:'release', permitId}` is the release form.
 */
/**
 * P8-D91 (founder ruling): an agent's spend counts in the SAME user bucket as
 * the human it runs for. `userOf` resolves a caller to that human principal;
 * the human is their own user. Before M1.7 an agent's parent is not known at
 * dispatch, so the daemon attributes it to the root's human principal (the
 * founder; 8.0 has one human). No resolvable human ⇒ refused (fail closed).
 */
export type UserOf = (principal: string, principalClass: string) => string | null;
export const humanOnlyUser: UserOf = (p, cls) => (cls === 'human' ? p : null);

export function parseReserveParams(principal: string, principalClass: string, params: unknown, userOf: UserOf = humanOnlyUser): { op: 'reserve'; req: ReserveRequest } | { op: 'release'; permitId: string } {
  if (params === null || typeof params !== 'object' || Array.isArray(params)) throw bad('bad-params', 'permit.reserve takes {kind, scope, backend?, model?, limits?} or {op:"release", permitId}');
  const p = params as Record<string, unknown>;
  if (p.op === 'release') {
    if (Object.keys(p).some((k) => k !== 'op' && k !== 'permitId') || typeof p.permitId !== 'string') throw bad('bad-params', 'release takes {op:"release", permitId}');
    return { op: 'release', permitId: p.permitId };
  }
  const extra = Object.keys(p).filter((k) => !(RESERVE_KEYS as readonly string[]).includes(k));
  if (extra.length) throw bad('bad-params', `unknown permit.reserve params: ${extra.join(', ')} (usage comes only from stream events)`);
  if (typeof p.kind !== 'string') throw bad('bad-params', 'kind is required');
  // the user rung is the human the caller runs for (P8-D91): one bucket for the human and their agents
  const user = principalClass === 'human' ? principal : userOf(principal, principalClass);
  if (!user) throw bad('bad-params', `no human principal to attribute a ${principalClass} principal's spend to (P8-D91)`);
  const scope: PermitScope = { user };
  if (p.scope !== undefined) {
    if (p.scope === null || typeof p.scope !== 'object' || Array.isArray(p.scope)) throw bad('bad-params', 'scope must be an object');
    for (const [k, v] of Object.entries(p.scope as Record<string, unknown>)) {
      if (k === 'user') {
        if (v !== scope.user) throw bad('bad-params', 'the user scope is the caller');
        continue;
      }
      if (!(SCOPE_KEYS as readonly string[]).includes(k) || typeof v !== 'string' || v.length === 0 || v.length > 256) throw bad('bad-params', `bad scope.${k}`);
      // Aegis C3/C6: the kernel binds an agent's repo/loop/session (from its session, M1.7); a caller-chosen one is refused
      if (principalClass !== 'human' && k !== 'machine') throw bad('bad-params', `scope.${k} is bound by the kernel for a ${principalClass} principal (M1.7), never named by the caller`);
      (scope as unknown as Record<string, string>)[k] = v;
    }
  }
  if (p.backend !== undefined && p.backend !== 'claude-code' && p.backend !== 'local') throw bad('bad-params', 'backend is claude-code or local');
  if (p.model !== undefined && typeof p.model !== 'string') throw bad('bad-params', 'model must be a string');
  let limits: ReserveRequest['limits'];
  if (p.limits !== undefined) {
    if (p.limits === null || typeof p.limits !== 'object') throw bad('bad-params', 'limits must be an object');
    limits = {};
    for (const [k, v] of Object.entries(p.limits as Record<string, unknown>)) {
      if (!['tokens', 'usd', 'computeSeconds', 'concurrent'].includes(k) || typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw bad('bad-params', `bad limits.${k}`);
      (limits as Record<string, number>)[k] = v;
    }
  }
  return {
    op: 'reserve',
    req: {
      principal,
      principalClass,
      attended: principalClass === 'human',
      kind: p.kind,
      scope,
      ...(p.backend ? { backend: p.backend as 'claude-code' | 'local' } : {}),
      ...(typeof p.model === 'string' ? { model: p.model } : {}),
      ...(limits ? { limits } : {}),
      ...(typeof p.tool === 'string' ? { tool: p.tool } : {}),
    },
  };
}
