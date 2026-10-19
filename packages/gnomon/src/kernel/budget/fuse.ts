/**
 * @symbol #budget-fuse
 *
 * #budget-fuse — a METER, not a fuse (spec §3.4, §4.8, §10 laws 1 and 7, as
 * amended by founder ruling P8-D92 "track everything, enforce nothing").
 *
 * ENFORCES ONLY LAW 7. `permit.reserve` of every kind except
 * `tool.permission` (which starts no process) for `backend: claude-code` runs the billing scan (billing.ts) and is refused
 * BILLING_REFUSED on any API-billing path, unless the kernel's own spawn of
 * the session holds an active per-use api-token card (then
 * `billing: api-token:<cardId>`, the scan still run with only the injected
 * key ignored). No setting changes that (G-LAW-01b).
 *
 * EVERYTHING ELSE IS GRANTED AND TRACKED. Every reserve gets a kernel-signed
 * `permit:v1` (law 1: no spawn without a permit — for attribution, never for
 * rationing). There are no token/USD caps, no concurrency or compute caps,
 * no subscription-window reserve, no breaker pause, no armada pause and no
 * budget card. What is tracked, per UTC day:
 *   - tokens and USD per user (P8-D91: an agent's spend counts in the bucket
 *     of the human it runs for), repo/project, loop, session, model and
 *     backend (claude-code vs local); local-LLM sessions with their model and
 *     project(s);
 *   - ladder rungs 50/75/90/100 % of the config's reference amounts, logged
 *     once per scope per day as `budget.ladder` — informational only;
 *   - the subscription window's usage (measured and shown in status);
 *   - quota errors (recorded `budget.window{quotaError}`, nothing pauses);
 *   - a permit used beyond its own (informational) limits is recorded once
 *     (`budget.usage{overPermit}`), nothing is killed.
 * Usage enters only through `recordStreamUsage` with a `turn.usage` /
 * `turn.result` source (G-BUD-01); a malformed event is logged
 * `budget.usage{malformed}` and dropped — tracking continues (G-BUD-02).
 *
 * M1.7 NOTE: `turn` permits of an api-token session are labelled
 * `subscription`; the per-turn `billing.api.active` row (G-SUB-03) depends on
 * the supervisor reporting usage against the SPAWN permit.
 *
 * TIME (S-L2). A turn counts under the `at` of its own `budget.usage` row:
 * the row is written FIRST, and the day and window entry are taken from the
 * time the log returns for it (the same `at` restore reads back), so runtime
 * and restore agree. Without a log time, the chain's last event time is
 * used. Either time is clamped: later than the wall clock + MAX_CLOCK_SKEW_MS
 * ⇒ the wall clock, reported once through `onClockSkew` (a diag, never a row).
 *
 * BOOT (M1.6 slice 2). `restore(rows, trust)` rebuilds the counters, the
 * subscription window and the announced rungs from the chain — the
 * `budget.usage` rows joined to their `permit.grant` (the permit names every
 * axis, incl. loop) and the `budget.ladder` rows. Only rows the KERNEL wrote
 * count (principal in trust.principals AND signed by a kernel key, Aegis C1:
 * these kinds are not reserved kinds, so the chain alone does not prove the
 * writer), and a usage row's user must be its grant's scope.user. "Today" at
 * restore is the day of the chain's last event (restore runs before
 * daemon.start is written): a counter is keyed by its row's own day, so a
 * restart across midnight shows the new day empty, as runtime would.
 * Malformed, over-permit and grant-less rows count nothing. Permits are not
 * restored: a permit is live for its holder's connection; a restart ends it.
 */
import { canonicalJson, mintId, refuse, RefusedError, type RefusalCode } from '@a-company/gnomon-contracts';
import type { Signer } from '../log/signer.js';
import type { ApiTokenBilling } from '../broker/api-token.js';
import { scanApiBilling, type BillingScanSource } from './billing.js';
import { DEFAULT_FUSE, type FuseConfig, type ScopeName } from './config.js';

export const PERMIT_KINDS = Object.freeze(['session.spawn', 'turn', 'tool.permission', 'tend.llm', 'oracle.reviewer', 'teacher.draft', 'mod.spend'] as const);
export type PermitKind = (typeof PERMIT_KINDS)[number];
export const RUNGS = Object.freeze([0.5, 0.75, 0.9, 1]);
/** Law 7 runs for EVERY claude-code permit kind that can start or drive a Claude process; only tool.permission starts none (Aegis L1). */
const LAW7_EXEMPT_KINDS: readonly string[] = ['tool.permission'];

/** Appends a row; may return the row's chain time `at` (the time a turn counts under). */
export type FuseLog = (kind: string, payload: Record<string, unknown>, ids?: { session?: string; connId?: string }) => Promise<void | { at?: string }>;

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
  /** a human client is attached (interactive) — recorded, never a reason to deny */
  attended: boolean;
  kind: string;
  scope: PermitScope;
  backend?: 'claude-code' | 'local';
  model?: string;
  limits?: { tokens?: number; usd?: number; computeSeconds?: number; concurrent?: number };
  tool?: string;
  /** Set ONLY by the kernel's own spawn path (#supervisor, M1.7): the session the kernel is about to spawn (Aegis C3). */
  kernelSpawn?: { hsid: string };
  /** P8-D91 pre-M1.7: the user rung was attributed to the root's human principal. */
  attributed?: 'root-human';
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
  /** informational: what the permit expects to spend; never enforced (P8-D92) */
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

/** A chain row the fuse restores from (#kernel-log full view). */
export interface FuseRow {
  kind: string;
  at: string;
  /** who wrote the row, and the key that signed it (restore counts only the kernel's rows, Aegis C1) */
  principal: string;
  keyId?: string;
  payload: Record<string, unknown>;
}

/** Who the kernel is, for restore: its principals (continuity across root provisioning) and its keys. */
export interface FuseRowTrust {
  principals: readonly string[];
  isKernelKey(keyId: string): boolean;
}

/** A chain time later than the wall clock by more than this is not trusted for the day key (Aegis low). */
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;

/** The kinds `restore` reads (the daemon asks the chain for exactly these). */
export const FUSE_RESTORE_KINDS = Object.freeze(['permit.grant', 'budget.usage', 'budget.ladder'] as const);

export interface FuseOptions {
  kernel: Signer;
  logId: string;
  log: FuseLog;
  config?: FuseConfig;
  billing: BillingScanSource;
  apiTokens?: Pick<ApiTokenBilling, 'billingForKernelSpawn' | 'onTurn'>;
  clock?: () => number;
  /** the chain's last event time (S-L2); default: clock */
  lastEventTime?: () => number;
  permitTtlMs?: number;
  /** a chain time beyond the wall clock + MAX_CLOCK_SKEW_MS was replaced by the wall clock (reported once) */
  onClockSkew?: (d: { chainAt: number; wall: number }) => void;
}

interface Held {
  permit: PermitV1;
  released: boolean;
  used: { tokens: number; usd: number };
  over: boolean;
}

export function fuseFail(code: RefusalCode, message: string, data: Record<string, unknown>): RefusedError {
  return new RefusedError(refuse({ code, data }), `#budget-fuse: ${message}`);
}

/** The tracking axes of a spend (one bucket per axis value per UTC day). */
type Axis = 'user' | 'repo' | 'loop' | 'session' | 'model' | 'backend';

export class BudgetFuse {
  readonly #o: FuseOptions;
  readonly #cfg: FuseConfig;
  readonly #permits = new Map<string, Held>();
  /** `${day}|${dim}|${axis}|${id}` → amount */
  readonly #day = new Map<string, number>();
  readonly #window: Array<{ at: number; tokens: number }> = [];
  readonly #announced = new Set<string>();
  /** local-LLM sessions: hsid (or permitId) → model, projects, tokens */
  readonly #local = new Map<string, { model: string; repos: Set<string>; tokens: number }>();
  #quotaErrors = 0;
  readonly #clock: () => number;

  constructor(o: FuseOptions) {
    this.#o = o;
    this.#cfg = o.config ?? structuredClone(DEFAULT_FUSE);
    this.#clock = o.clock ?? Date.now;
  }

  #skewReported = false;

  /** A chain time, clamped to the wall clock + MAX_CLOCK_SKEW_MS (a future-dated chain never moves the day). */
  #clamp(t: number): number {
    const wall = this.#clock();
    if (!(t > wall + MAX_CLOCK_SKEW_MS)) return t;
    if (!this.#skewReported) {
      this.#skewReported = true;
      this.#o.onClockSkew?.({ chainAt: t, wall });
    }
    return wall;
  }

  /** The chain's last event time (S-L2), clamped. */
  #now(): number {
    return this.#clamp(this.#o.lastEventTime?.() ?? this.#clock());
  }

  /** UTC calendar day of the chain's last event time (S-L2). */
  #dayKey(): string {
    return new Date(this.#now()).toISOString().slice(0, 10);
  }

  #axes(p: PermitV1): Array<[Axis, string]> {
    const out: Array<[Axis, string]> = [['user', p.scope.user], ['model', p.model], ['backend', p.backend]];
    if (p.scope.repo) out.push(['repo', p.scope.repo]);
    if (p.scope.loop) out.push(['loop', p.scope.loop]);
    if (p.scope.session) out.push(['session', p.scope.session]);
    return out;
  }

  #windowUsed(): number {
    const now = this.#now();
    const from = now - this.#cfg.subscription.windowMs;
    while (this.#window.length && this.#window[0]!.at < from) this.#window.shift();
    return this.#window.reduce((a, e) => a + e.tokens, 0);
  }

  /** Is this requester part of the armada (agent/session principal, or unattended)? Recorded for attribution only. */
  static isArmada(r: Pick<ReserveRequest, 'principalClass' | 'attended'>): boolean {
    return r.principalClass !== 'human' || !r.attended;
  }

  async reserve(req: ReserveRequest): Promise<PermitV1> {
    if (!(PERMIT_KINDS as readonly string[]).includes(req.kind)) throw fuseFail('BAD_REQUEST', `unknown permit kind ${String(req.kind).slice(0, 64)}`, { kinds: [...PERMIT_KINDS] });
    await this.#o.log('permit.reserve', { kind: req.kind, principal: req.principal, scope: req.scope, backend: req.backend ?? null, user: req.scope.user, armada: BudgetFuse.isArmada(req), ...(req.attributed ? { attributed: req.attributed } : {}) }, req.scope.session ? { session: req.scope.session } : {});
    const backend = req.backend ?? 'claude-code';
    // law 7 — the ONE enforced rule (P8-D92): no API-billing path for a kernel-spawned Claude session
    let billing = backend === 'local' ? 'local' : 'subscription';
    if (backend === 'claude-code' && !LAW7_EXEMPT_KINDS.includes(req.kind)) {
      const token = req.kernelSpawn && req.kind === 'session.spawn' ? (this.#o.apiTokens?.billingForKernelSpawn(req.kernelSpawn.hsid, req.principal) ?? null) : null;
      if (token) billing = token;
      // under an api-token the scan still runs; only the injected key is ignored
      const hits = scanApiBilling(this.#o.billing, token ? { ignoreEnv: ['ANTHROPIC_API_KEY'] } : {});
      if (hits.length) {
        await this.#o.log('billing.api.refused', { where: hits.map((h) => h.where), keys: hits.map((h) => h.key) }).catch(() => undefined);
        await this.#o.log('permit.deny', { kind: req.kind, principal: req.principal, why: 'api-billing-path' }, req.scope.session ? { session: req.scope.session } : {}).catch(() => undefined);
        throw fuseFail('BILLING_REFUSED', `${req.kind} refused: an API-billing path would bill credits (law 7)`, { dimension: 'api-billing-path', hits: hits.map((h) => ({ where: h.where, key: h.key })) });
      }
    }
    const now = this.#clock();
    const day = this.#dayKey();
    const ladder: Record<string, number | null> = { user: null, repo: null, loop: null, session: null, subscriptionWindow: this.#windowUsed() / this.#cfg.subscription.windowTokens };
    for (const [name, id] of [['user', req.scope.user], ['repo', req.scope.repo], ['loop', req.scope.loop], ['session', req.scope.session]] as Array<[ScopeName, string | undefined]>) {
      if (id) ladder[name] = (this.#day.get(`${day}|tokens|${name}|${id}`) ?? 0) / this.#cfg.tokens[name];
    }
    const positive = (v: number | undefined, d: number): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);
    const limits = {
      tokens: positive(req.limits?.tokens, this.#cfg.tokens.session),
      usd: positive(req.limits?.usd, this.#cfg.usd.session),
      computeSeconds: positive(req.limits?.computeSeconds, 600),
      concurrent: positive(req.limits?.concurrent, 1),
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
    this.#permits.set(permit.permitId, { permit, released: false, used: { tokens: 0, usd: 0 }, over: false });
    try {
      await this.#o.log('permit.grant', { permit }, permit.hsid ? { session: permit.hsid } : {});
    } catch (err) {
      this.#permits.delete(permit.permitId); // never a permit without its row
      throw err;
    }
    if (backend === 'local' && req.kind === 'session.spawn') {
      const key = permit.hsid ?? permit.permitId;
      const l = this.#local.get(key) ?? { model: permit.model, repos: new Set<string>(), tokens: 0 };
      if (permit.scope.repo) l.repos.add(permit.scope.repo);
      this.#local.set(key, l);
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

  /**
   * §2.4 rule 11 (TD-2026-10-19-908; T-2026-10-19-014 B2): re-attribute a drained session's spawn permit to its
   * resumed session — NEVER a fresh mint (no permit.reserve, no permit.grant). The caller hands the permit object
   * read back from the old kernel's KERNEL-signed permit.grant row. The checks of a spawn re-run: a claude-code
   * session.spawn permit for exactly this hsid, subscription billing, not expired, this log, and law 7 (the
   * billing scan, as reserve runs it). Any failure refuses PERMIT_REQUIRED / BILLING_REFUSED and nothing is held.
   * On success the permit is live again under its own id and `permit.reattributed{permitId, hsid, drainedEventId}`
   * is written (the row cites the session.drained row it rests on; chain write before the permit is usable).
   */
  async reattribute(permit: PermitV1, p: { hsid: string; drainedEventId: string }): Promise<PermitV1> {
    const unfit = (cause: string): RefusedError => fuseFail('PERMIT_REQUIRED', `the drained session's permit cannot be re-attributed: ${cause}`, { cause });
    if (!permit || permit.schemaVersion !== 'permit:v1' || typeof permit.permitId !== 'string') throw unfit('not-a-permit');
    if (permit.kind !== 'session.spawn' || permit.backend !== 'claude-code' || permit.hsid !== p.hsid || permit.scope?.session !== p.hsid) throw unfit('not-this-session');
    if (permit.billing !== 'subscription') throw unfit('not-subscription');
    if (permit.log !== this.#o.logId) throw unfit('other-log');
    if (!(Date.parse(permit.expiresAt) > this.#clock())) throw unfit('expired');
    const live = this.#permits.get(permit.permitId);
    if (live && !live.released) throw unfit('already-live');
    const hits = scanApiBilling(this.#o.billing);
    if (hits.length) {
      await this.#o.log('billing.api.refused', { where: hits.map((h) => h.where), keys: hits.map((h) => h.key) }).catch(() => undefined);
      throw fuseFail('BILLING_REFUSED', 'resume refused: an API-billing path would bill credits (law 7)', { dimension: 'api-billing-path', hits: hits.map((h) => ({ where: h.where, key: h.key })) });
    }
    const held: Held = { permit, released: false, used: live?.used ?? { tokens: 0, usd: 0 }, over: live?.over ?? false };
    this.#permits.set(permit.permitId, held);
    try {
      await this.#o.log('permit.reattributed', { permitId: permit.permitId, hsid: p.hsid, drainedEventId: p.drainedEventId }, { session: p.hsid });
    } catch (err) {
      if (live) this.#permits.set(permit.permitId, live);
      else this.#permits.delete(permit.permitId); // never a live permit without its row
      throw err;
    }
    return permit;
  }

  permit(permitId: string): PermitV1 | undefined {
    return this.#permits.get(permitId)?.permit;
  }

  /** G-BUD-01: the ONLY usage input — a stream event from the supervisor. Malformed ⇒ logged and dropped (G-BUD-02); tracking continues. */
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
      await this.#o.log('budget.usage', { malformed: true, permitId: typeof ev?.permitId === 'string' ? ev.permitId.slice(0, 80) : null, why: !ok ? 'shape' : 'unknown-permit' }).catch(() => undefined);
      return;
    }
    const usd = ev.usd ?? 0;
    // the row first: the turn counts under the row's own chain time (restore reads the same `at`)
    const wrote = await this.#o.log(
      'budget.usage',
      { permitId: ev.permitId, hsid: h.permit.hsid, source: ev.source, tokens: ev.tokens, usd, user: h.permit.scope.user, repo: h.permit.scope.repo, model: h.permit.model, backend: h.permit.backend },
      h.permit.hsid ? { session: h.permit.hsid } : {},
    );
    const rowAt = wrote && typeof wrote.at === 'string' ? Date.parse(wrote.at) : NaN;
    const at = Number.isFinite(rowAt) ? this.#clamp(rowAt) : this.#now();
    h.used.tokens += ev.tokens;
    h.used.usd += usd;
    const day = new Date(at).toISOString().slice(0, 10);
    for (const [axis, id] of this.#axes(h.permit)) {
      for (const [dim, amt] of [['tokens', ev.tokens], ['usd', usd]] as const) {
        const k = `${day}|${dim}|${axis}|${id}`;
        const v = (this.#day.get(k) ?? 0) + amt;
        this.#day.set(k, v);
        if (axis !== 'model' && axis !== 'backend') await this.#announce(day, dim, axis, id, v / this.#cfg[dim][axis as ScopeName]);
      }
    }
    if (h.permit.backend === 'claude-code') this.#window.push({ at, tokens: ev.tokens });
    else {
      const l = this.#local.get(h.permit.hsid ?? h.permit.permitId) ?? { model: h.permit.model, repos: new Set<string>(), tokens: 0 };
      l.tokens += ev.tokens;
      if (h.permit.scope.repo) l.repos.add(h.permit.scope.repo);
      this.#local.set(h.permit.hsid ?? h.permit.permitId, l);
    }
    if (h.permit.billing.startsWith('api-token:') && h.permit.hsid) await this.#o.apiTokens?.onTurn(h.permit.hsid);
    if (!h.over && (h.used.tokens > h.permit.limits.tokens || h.used.usd > h.permit.limits.usd)) {
      h.over = true; // informational (P8-D92): recorded once, nothing is killed
      await this.#o.log('budget.usage', { permitId: ev.permitId, hsid: h.permit.hsid, overPermit: true, used: { tokens: h.used.tokens, usd: h.used.usd }, limits: { tokens: h.permit.limits.tokens, usd: h.permit.limits.usd } }, h.permit.hsid ? { session: h.permit.hsid } : {});
    }
  }

  async #announce(day: string, dim: string, scope: string, id: string, frac: number): Promise<void> {
    for (const rung of RUNGS) {
      const k = `${day}|${dim}|${scope}|${id}|${rung}`;
      if (frac >= rung && !this.#announced.has(k)) {
        this.#announced.add(k);
        await this.#o.log('budget.ladder', { scope, id, dimension: dim, rung, day, informational: true });
      }
    }
  }

  /** `quota.error` from the adapter: RECORDED (P8-D92), nothing pauses. */
  async quotaError(hsid: string | null): Promise<void> {
    this.#quotaErrors++;
    await this.#o.log('budget.window', { quotaError: true, hsid, used: this.#windowUsed(), of: this.#cfg.subscription.windowTokens });
  }

  /**
   * Rebuild today's counters, the window and the announced rungs from chain
   * rows in chain order (boot, before the first reserve). Idempotent only on
   * a fresh fuse: it adds to what is there.
   */
  restore(rows: Iterable<FuseRow>, trust: FuseRowTrust): { usage: number; ladder: number; untrusted: number } {
    const now = this.#now();
    const today = new Date(now).toISOString().slice(0, 10);
    const from = now - this.#cfg.subscription.windowMs;
    const grants = new Map<string, PermitV1>();
    const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 256 ? v : null);
    const amount = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : -1);
    let usage = 0;
    let ladder = 0;
    let untrusted = 0;
    for (const row of rows) {
      // Aegis C1: only the kernel's own signed rows count — these kinds are not reserved, so anyone could write one
      if (!trust.principals.includes(row.principal) || typeof row.keyId !== 'string' || !trust.isKernelKey(row.keyId)) {
        untrusted++;
        continue;
      }
      const p = row.payload ?? {};
      if (row.kind === 'permit.grant') {
        const permit = p.permit as PermitV1 | undefined;
        if (permit && typeof permit.permitId === 'string' && permit.scope && typeof permit.scope.user === 'string') grants.set(permit.permitId, permit);
        continue;
      }
      const at = Date.parse(row.at);
      if (!Number.isFinite(at)) continue;
      const day = new Date(at).toISOString().slice(0, 10);
      if (row.kind === 'budget.ladder') {
        const scope = str(p.scope), id = str(p.id), dim = str(p.dimension);
        if (p.day === today && day === today && scope && id && dim && typeof p.rung === 'number' && RUNGS.includes(p.rung)) {
          this.#announced.add(`${today}|${dim}|${scope}|${id}|${p.rung}`);
          ladder++;
        }
        continue;
      }
      if (row.kind !== 'budget.usage' || p.malformed === true || p.overPermit === true) continue;
      const tokens = amount(p.tokens);
      const usd = p.usd === undefined ? 0 : amount(p.usd);
      if (tokens < 0 || usd < 0 || (p.source !== 'turn.usage' && p.source !== 'turn.result')) continue;
      const permit = typeof p.permitId === 'string' ? grants.get(p.permitId) : undefined;
      if (!permit) continue; // a usage row with no grant on the chain attributes to nothing (never guessed)
      if (p.user !== permit.scope.user) continue; // the row's user must be its grant's user
      const backend = permit.backend;
      if (backend === 'claude-code' && at >= from && at <= now) this.#window.push({ at, tokens });
      if (day !== today) continue;
      usage++;
      for (const [axis, id] of this.#axes(permit)) {
        for (const [dim, amt] of [['tokens', tokens], ['usd', usd]] as const) {
          const k = `${today}|${dim}|${axis}|${id}`;
          this.#day.set(k, (this.#day.get(k) ?? 0) + amt);
        }
      }
      if (backend === 'local') {
        const key = permit.hsid ?? permit.permitId;
        const l = this.#local.get(key) ?? { model: permit.model, repos: new Set<string>(), tokens: 0 };
        l.tokens += tokens;
        if (permit.scope.repo) l.repos.add(permit.scope.repo);
        this.#local.set(key, l);
      }
    }
    this.#window.sort((a, b) => a.at - b.at);
    return { usage, ladder, untrusted };
  }

  /** Today's spend for one axis value (tests, status). */
  spent(axis: Axis, id: string, dim: 'tokens' | 'usd' = 'tokens'): number {
    return this.#day.get(`${this.#dayKey()}|${dim}|${axis}|${id}`) ?? 0;
  }

  /** status.budget: the spend breakdown (P8-D92). */
  status(): Record<string, unknown> {
    const day = this.#dayKey();
    const by = (axis: Axis): Record<string, { tokens: number; usd: number }> => {
      const out: Record<string, { tokens: number; usd: number }> = {};
      for (const [k, v] of this.#day) {
        const [d, dim, a, ...rest] = k.split('|');
        if (d !== day || a !== axis) continue;
        const id = rest.join('|');
        out[id] ??= { tokens: 0, usd: 0 };
        out[id]![dim as 'tokens' | 'usd'] += v;
      }
      return out;
    };
    const used = this.#windowUsed();
    return {
      mode: 'meter',
      enforced: ['law-7'],
      day,
      spend: { byUser: by('user'), byRepo: by('repo'), byLoop: by('loop'), bySession: by('session'), byModel: by('model'), byBackend: by('backend') },
      local: [...this.#local.entries()].map(([key, l]) => ({ session: key, model: l.model, repos: [...l.repos].sort(), tokens: l.tokens })),
      subscriptionWindow: { used: { n: used, of: this.#cfg.subscription.windowTokens }, windowMs: this.#cfg.subscription.windowMs },
      quotaErrors: { n: this.#quotaErrors },
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
  const attributed = principalClass !== 'human' ? ('root-human' as const) : undefined;
  if (p.scope !== undefined) {
    if (p.scope === null || typeof p.scope !== 'object' || Array.isArray(p.scope)) throw bad('bad-params', 'scope must be an object');
    for (const [k, v] of Object.entries(p.scope as Record<string, unknown>)) {
      if (k === 'user') {
        if (v !== scope.user) throw bad('bad-params', 'the user scope is the caller');
        continue;
      }
      if (!(SCOPE_KEYS as readonly string[]).includes(k) || typeof v !== 'string' || v.length === 0 || v.length > 256) throw bad('bad-params', `bad scope.${k}`);
      // Aegis C3/C6: the kernel binds an agent's repo/loop/session (from its session, M1.7); a caller-chosen one is refused
      if (principalClass !== 'human') throw bad('bad-params', `scope.${k} is bound by the kernel for a ${principalClass} principal (M1.7), never named by the caller`);
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
      ...(attributed ? { attributed } : {}),
      ...(p.backend ? { backend: p.backend as 'claude-code' | 'local' } : {}),
      ...(typeof p.model === 'string' ? { model: p.model } : {}),
      ...(limits ? { limits } : {}),
      ...(typeof p.tool === 'string' ? { tool: p.tool } : {}),
    },
  };
}
