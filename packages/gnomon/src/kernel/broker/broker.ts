/**
 * @symbol #approval-broker
 *
 * #approval-broker (spec §3.4, §5 verb 8 `approve`, §3.1 approvals key, B1–B10;
 * M1.6). The broker RAISES cards (kernel-composed, sanitized, kernel-signed
 * actions; `approval.request` written before the card exists for anyone) and
 * DECIDES them for the human principal only:
 *
 *   1. principal: only the human class decides (B4); the voice principal's
 *      every `approve` form is FORBIDDEN gate `voice` reason `voice-off`
 *      (no `grant.voice-approvals` row and no arm can exist before Move 4,
 *      G-ABI-02 voice row); a decision `via:'link'` is refused (`peer-via`);
 *   2. card: known, decidable (`isCardDecidable`), the decision valid for
 *      its kind; `peer`-flagged cards refuse `always` (`peer-always`);
 *   3. `decisionSig` by the approvals key over approveMessage(cardId,
 *      decision, contentHash, approver) — bad ⇒ AUTH `bad-signature`
 *      (G-BRK-03); no approvals key (before M1.3) ⇒ UNSUPPORTED `presence`;
 *   4. presence per class: `cached` uses the unlock of THIS connId only
 *      (S25-H1, G-BRK-05) or proves fresh presence and opens one; `fresh`
 *      and `root` always prove fresh presence — `always` under a cached
 *      unlock is refused FORBIDDEN `presence` when no fresh presence comes
 *      (G-BRK-05); `root` additionally signs the decision with the root key
 *      (install, use-api-token). Presence is a PresenceToken BOUND to
 *      {cardId, contentHash(, decision)} and checked on the kernel-trusted
 *      clock (T-2026-10-18-003). The provider is the M1.3 helper; until then
 *      PRESENCE_UNAVAILABLE refuses, so every presence-taking decision
 *      refuses in production; tests drive it with mintTestPresence;
 *   5. `approval.decide` is appended BEFORE the effect and the state change
 *      (log-before-effect); `always` appends `approval.rule.learned`;
 *      `approval.suspect` rows carry connId and client provenance.
 *
 * `approval.decide` is a RECORD, never authority: the effect (grant rows,
 * activation) is the authority; an effect that fails after the row is
 * written is recorded `approval.suspect{why:'effect-failed'}` and the card
 * stays pending (`approval.effect.failed` would be the honest kind; adding it
 * moves clientApiId — reported).
 *
 * Silence never allows (B6, G-BRK-01): `tool.permission` cards expire into
 * deny; `fallback` and `api-token` cards never expire; `decisionOf` of a
 * card the broker does not hold is `deny`.
 */
import {
  CARD_DECISIONS,
  ID_PATTERNS,
  isCardDecidable,
  mintId,
  refuse,
  RefusedError,
  validateCardV1,
  type CardFlag,
  type CardKind,
  type CardV1,
  type RefusalCode,
  type RefusalData,
  type RefusalGate,
} from '@a-company/gnomon-contracts';
import { approveMessage, type KeyRing, type Signer } from '../log/signer.js';
import { consumeBoundPresence, PresenceToken, presenceBindingDigest, requestPresence, type PresenceBinding, type PresencePurpose } from '../identity/presence.js';
import type { RootAuthority } from '../identity/root-authority.js';
import { RootUnavailableError } from '../identity/root-authority.js';
import { baseClass, validDecisions, type DecisionClass } from './classes.js';
import { blockOf, composePresencePrompt, contentHashOf, signActions, type SignedPresencePrompt } from './card.js';
import { UnlockStore } from './unlock.js';

/** A refusal thrown by the broker (reasons are registered refusal reasons; scanned by test/refusal-reasons.test.ts). */
export function fail(code: RefusalCode, reason: string, message: string, data?: RefusalData & { gate?: RefusalGate }): RefusedError {
  const { gate, ...rest } = data ?? {};
  return new RefusedError(refuse({ code, ...(gate ? { gate } : {}), data: { ...rest, reason } }), `#approval-broker: ${message}`);
}

/** The voice principal's every approve form before Move 4 (G-ABI-02 voice row): FORBIDDEN gate voice, reason voice-off (§3.1 I4). */
export function voiceApproveRefusal(): RefusedError {
  return fail('FORBIDDEN', 'voice-off', 'voice approvals are off: no grant.voice-approvals row and no voice arm exist before Move 4 (§14.7)', { gate: 'voice' });
}

export type BrokerLog = (kind: string, payload: Record<string, unknown>, ids?: { connId?: string; session?: string }) => Promise<void>;

export interface PresenceRequest {
  purpose: PresencePurpose;
  binding: PresenceBinding;
  prompt: SignedPresencePrompt;
  connId: string;
}

/** The human declined (or the helper timed out): FORBIDDEN{presence}, logged approval.presence.denied. */
export class PresenceDenied extends Error {
  constructor(message = 'presence denied') {
    super(message);
    this.name = 'PresenceDenied';
  }
}

/** Proves presence for one decision. M1.3: the signed helper's prompt. */
export interface PresenceProvider {
  prove(req: PresenceRequest): Promise<PresenceToken>;
}

/** Production before M1.3: no presence prompt exists (requestPresence refuses UNSUPPORTED). */
export const PRESENCE_UNAVAILABLE: PresenceProvider = Object.freeze({ prove: (req: PresenceRequest) => requestPresence(req.purpose) });

/** The approvals key (hardware P-256 behind the helper, M1.3): verifies decisionSig. */
export interface ApprovalsKey {
  verify(approverPrincipalId: string, message: string, sigB64: string): 'ok' | 'bad' | 'unavailable';
}
export const NO_APPROVALS_KEY: ApprovalsKey = Object.freeze({ verify: () => 'unavailable' as const });

/** An approvals key from a ring: the approver's key id (tests: a software P-256 stands in for the hardware key). */
export function approvalsKeyFrom(ring: KeyRing, keyIdOf: (principal: string) => string | undefined): ApprovalsKey {
  return {
    verify(approver, message, sigB64) {
      const keyId = keyIdOf(approver);
      if (!keyId) return 'bad';
      return ring.verify(keyId, 'approve', message, Buffer.from(sigB64, 'base64')) === 'ok' ? 'ok' : 'bad';
    },
  };
}

/** The process provenance of a CLI connection (pid/ppid/pgid/tty), when the kernel can learn it (peer credentials: M1.3/M1.7). */
export type CliProvenance = { pid: number; ppid: number; pgid: number; tty: string | null };

/** What happens when a card is decided (install: the grant rows; api-token: activation). Runs AFTER approval.decide is logged. */
export type CardEffect = (decision: string, ctx: { token: PresenceToken | null; rootSig: { signer: string; sig: string } | null; connId: string }) => Promise<void> | void;

export interface RaiseInput {
  kind: CardKind;
  requestedBy: string;
  hsid?: string;
  attended: boolean;
  /** what the card asserts: inside contentHash */
  detail: Record<string, unknown>;
  /** display lines (sanitized here) */
  lines: readonly string[];
  flags?: CardFlag[];
  /** tool.permission: the tool input (labelled sensitive on approval.request) */
  toolInput?: unknown;
  tool?: string;
  timeoutMs?: number;
  /** install mirrors the staged card's id (broker/install-card.ts); otherwise minted */
  cardId?: string;
  /** a pre-rendered block (install: rendered from the RE-DERIVED detail) */
  block?: Record<string, unknown>;
  /** a pre-computed contentHash (install: sha256 of the re-derived detail, as the staged decision expects) */
  contentHash?: string;
  /** presence purpose/binding override (install: mod.install bound to {cardId, contentHash}) */
  presence?: { purpose: PresencePurpose; binding: (decision: string) => PresenceBinding; consumedByEffect: boolean };
  effect?: CardEffect;
}

export interface DecideContext {
  connId: string;
  principal: string;
  /** dispatch matrix class: human | agent | session | mod | voice | readToken | peer */
  principalClass: string;
  /** hello client.surface (browser | wrapper | cli | conductor | …): SELF-DECLARED, display only, never a security input */
  surface: string | null;
  /**
   * How the connection authenticated (Aegis C1): only `gui` (a launch-token
   * GUI session of #web-endpoint) is an attached GUI that may hold a cached
   * unlock; every other credential is treated as a CLI invocation (prompts
   * every time, provenance + suspect rows).
   */
  credential: 'gui' | 'device' | 'read-token' | string;
  /** Is the connection still open? Checked before an unlock opens and before approval.decide (default: live). */
  isLive?: () => boolean;
}

interface CardRecord {
  card: CardV1;
  tool?: string;
  presence?: RaiseInput['presence'];
  effect?: CardEffect;
  waiters: Array<(d: string) => void>;
  outcome?: string;
}

/** tool.permission default timeout (expires into deny). Other kinds wait. */
export const PERMISSION_TIMEOUT_MS = 10 * 60_000;
const NEVER_EXPIRE: readonly string[] = ['fallback', 'api-token'];

export interface BrokerOptions {
  kernel: Signer;
  kernelPrincipal: string;
  log: BrokerLog;
  presence?: PresenceProvider;
  approvals?: ApprovalsKey;
  root?: RootAuthority;
  /** epoch ms for card times (default Date.now) */
  clock?: () => number;
  /** monotonic ms for unlock idle (default performance.now via Date.now fallback) */
  mono?: () => number;
  unlockIdleMs?: number;
  /** open GUI sessions {n} for the prompt (#web-endpoint) */
  guiSessions?: () => number;
  /** CLI peer provenance (M1.3/M1.7); default unknown */
  provenanceOf?: (connId: string) => CliProvenance | null;
  /** live session pgids (#supervisor, M1.7): a CLI decision from inside a session's job is suspect */
  liveSessionPgids?: () => ReadonlySet<number>;
}

const APPROVE_KEYS = ['cardId', 'decision', 'note', 'decisionSig', 'via', 'voice'] as const;

export class ApprovalBroker {
  readonly #o: BrokerOptions;
  readonly #cards = new Map<string, CardRecord>();
  readonly unlocks: UnlockStore;
  readonly #presence: PresenceProvider;
  readonly #approvals: ApprovalsKey;
  readonly #clock: () => number;

  constructor(o: BrokerOptions) {
    this.#o = o;
    this.#presence = o.presence ?? PRESENCE_UNAVAILABLE;
    this.#approvals = o.approvals ?? NO_APPROVALS_KEY;
    this.#clock = o.clock ?? Date.now;
    const mono = o.mono ?? (() => performance.now());
    this.unlocks = new UnlockStore(mono, o.unlockIdleMs);
  }

  /* ── raise ──────────────────────────────────────────────────────────── */

  async raise(input: RaiseInput): Promise<CardV1> {
    const cardId = input.cardId ?? mintId('card');
    if (!ID_PATTERNS.card.test(cardId)) throw fail('BAD_REQUEST', 'bad-params', 'cardId must be card:<ULID>');
    if (this.#cards.has(cardId)) return this.#cards.get(cardId)!.card;
    const rendered = blockOf(input.lines);
    const flags = [...new Set<CardFlag>([...(input.flags ?? []), ...rendered.flags])].sort();
    const contentHash = input.contentHash ?? contentHashOf({ kind: input.kind, requestedBy: input.requestedBy, ...(input.hsid ? { hsid: input.hsid } : {}), detail: input.detail, flags });
    const now = this.#clock();
    const timeoutMs = NEVER_EXPIRE.includes(input.kind) ? undefined : (input.timeoutMs ?? (input.kind === 'permission' ? PERMISSION_TIMEOUT_MS : undefined));
    const card: CardV1 = {
      schemaVersion: 'card:v1',
      cardId,
      kind: input.kind,
      requestedBy: input.requestedBy,
      ...(input.hsid ? { hsid: input.hsid } : {}),
      attended: input.attended,
      approverPolicy: { kind: 'self' },
      block: input.block ?? rendered.block,
      contentHash,
      ...(flags.length ? { flags } : {}),
      actions: signActions(this.#o.kernel, cardId, input.kind, contentHash),
      state: 'pending',
      ...(timeoutMs !== undefined ? { timeoutAt: new Date(now + timeoutMs).toISOString() } : {}),
    };
    const errors = validateCardV1(card, { mode: 'strict' });
    if (errors.length) throw fail('BAD_REQUEST', 'bad-params', `card does not validate: ${errors.join('; ')}`);
    // log before the card exists for anyone (B3: only the broker appends approval.*)
    await this.#o.log('approval.request', { card, flags, ...(input.toolInput !== undefined ? { tool_input: input.toolInput } : {}), ...(input.tool ? { tool: input.tool } : {}) }, input.hsid ? { session: input.hsid } : {});
    this.#cards.set(cardId, { card, ...(input.tool ? { tool: input.tool } : {}), ...(input.presence ? { presence: input.presence } : {}), ...(input.effect ? { effect: input.effect } : {}), waiters: [] });
    return card;
  }

  card(cardId: string): CardV1 | undefined {
    return this.#cards.get(cardId)?.card;
  }

  cards(): CardV1[] {
    return [...this.#cards.values()].map((r) => r.card);
  }

  /** The decision of a card, waiting for it; silence and unknown cards resolve `deny` (B6, broker unreachable ⇒ deny). */
  decisionOf(cardId: string): Promise<string> {
    const r = this.#cards.get(cardId);
    if (!r) return Promise.resolve('deny');
    if (r.outcome) return Promise.resolve(r.outcome);
    return new Promise((res) => r.waiters.push(res));
  }

  /** The presence prompt the helper would show for (card, decision) on a connection. */
  promptFor(cardId: string, decision: string, connId: string, reason = 'fresh presence'): SignedPresencePrompt {
    const r = this.#cards.get(cardId);
    if (!r) throw fail('NOT_FOUND', 'not-found', `no card ${cardId}`);
    return composePresencePrompt(this.#o.kernel, r.card, { decision, connId, guiSessions: this.#o.guiSessions?.() ?? 0, reason });
  }

  /* ── expire (B6) ────────────────────────────────────────────────────── */

  async expireDue(): Promise<string[]> {
    const now = this.#clock();
    const out: string[] = [];
    for (const r of this.#cards.values()) {
      if (r.card.state !== 'pending' || r.outcome || !r.card.timeoutAt || Date.parse(r.card.timeoutAt) > now) continue;
      if (this.#deciding.has(r.card.cardId)) continue; // a decision is in flight: it settles the card (or the next sweep expires it)
      const into = 'deny'; // never into allow (B6); tool.permission expires into deny
      await this.#o.log('approval.expire', { cardId: r.card.cardId, kind: r.card.kind, into }, r.card.hsid ? { session: r.card.hsid } : {});
      r.card = { ...r.card, state: 'expired' };
      this.#settle(r, into);
      out.push(r.card.cardId);
    }
    for (const connId of this.unlocks.idle()) {
      this.unlocks.drop(connId);
      await this.#o.log('approval.unlock.dropped', { connId, reason: 'idle' }, { connId });
    }
    return out;
  }

  /** The kernel retires a card nobody needs to decide any more (e.g. the budget pause cleared): expired, outcome `withdrawn`. */
  async withdrawByKernel(cardId: string, why: string): Promise<void> {
    const r = this.#cards.get(cardId);
    if (!r || r.outcome || r.card.state !== 'pending') return;
    await this.#o.log('approval.expire', { cardId, kind: r.card.kind, into: 'withdrawn', why }, r.card.hsid ? { session: r.card.hsid } : {});
    r.card = { ...r.card, state: 'expired' };
    this.#settle(r, 'withdrawn');
  }

  /** A connection closed: its cached unlock is gone (never usable from another connection). */
  async connectionClosed(connId: string): Promise<void> {
    if (this.unlocks.drop(connId)) await this.#o.log('approval.unlock.dropped', { connId, reason: 'closed' }, { connId }).catch(() => undefined);
  }

  #settle(r: CardRecord, outcome: string): void {
    if (r.outcome) return; // one terminal outcome per card
    r.outcome = outcome;
    for (const w of r.waiters.splice(0)) w(outcome);
  }

  /* ── decide ─────────────────────────────────────────────────────────── */

  readonly #deciding = new Set<string>();

  /** One decision in flight per card: a concurrent second approve is refused (never two decisions on one card). */
  async approve(ctx: DecideContext, params: unknown): Promise<CardV1> {
    const id = params !== null && typeof params === 'object' ? (params as { cardId?: unknown }).cardId : undefined;
    if (typeof id === 'string' && this.#deciding.has(id)) throw fail('BAD_REQUEST', 'bad-params', `card ${id} has a decision in flight`, { cardId: id });
    if (typeof id === 'string') this.#deciding.add(id);
    try {
      return await this.#approve(ctx, params);
    } finally {
      if (typeof id === 'string') this.#deciding.delete(id);
    }
  }

  async #approve(ctx: DecideContext, params: unknown): Promise<CardV1> {
    // 1. principal (B4): voice first — every approve form refuses until an arm can exist (Move 4)
    if (ctx.principalClass === 'voice') throw voiceApproveRefusal();
    if (ctx.principalClass !== 'human') throw fail('FORBIDDEN', 'matrix', `approve is human-only; a ${ctx.principalClass} principal never decides a card (B4)`);
    if (params === null || typeof params !== 'object' || Array.isArray(params)) throw fail('BAD_REQUEST', 'bad-params', 'approve takes {cardId, decision, note?, decisionSig}');
    const p = params as Record<string, unknown>;
    const extra = Object.keys(p).filter((k) => !(APPROVE_KEYS as readonly string[]).includes(k));
    if (extra.length) throw fail('BAD_REQUEST', 'bad-params', `unknown approve params: ${extra.join(', ')}`);
    if (p.via === 'voice' || 'voice' in p) throw fail('FORBIDDEN', 'voice-off', 'the voice intent form is refused: voice approvals are off (§14.7)', { gate: 'voice' });
    if (p.via === 'link') throw fail('FORBIDDEN', 'peer-via', 'no decision ever arrives over a link (§3.9)', { gate: 'link' });
    if (p.via !== undefined) throw fail('BAD_REQUEST', 'bad-params', 'via is set by the kernel from the connection, not by the caller');
    if (typeof p.cardId !== 'string' || !ID_PATTERNS.card.test(p.cardId)) throw fail('BAD_REQUEST', 'bad-params', 'cardId must be card:<ULID>');
    if (typeof p.decision !== 'string' || !(CARD_DECISIONS as readonly string[]).includes(p.decision)) throw fail('BAD_REQUEST', 'bad-params', 'decision is not a card:v1 decision');
    if (p.note !== undefined && (typeof p.note !== 'string' || p.note.length > 4096)) throw fail('BAD_REQUEST', 'bad-params', 'note must be a string of at most 4096 characters');
    const cardId = p.cardId;
    const decision = p.decision;

    // 2. the card
    const r = this.#cards.get(cardId);
    if (!r) throw fail('NOT_FOUND', 'not-found', `no card ${cardId}`, { cardId });
    const card = r.card;
    if (card.state === 'held' && decision !== 'withdraw') throw fail('FORBIDDEN', 'held', 'a held card takes only withdraw', { cardId });
    if (!isCardDecidable(card, decision)) throw fail('BAD_REQUEST', 'bad-params', `card ${cardId} is ${String(card.state)}: not decidable with ${decision}`, { cardId, state: String(card.state) });
    const flags = (card.flags ?? []) as string[];
    if (decision === 'always' && flags.includes('peer')) throw fail('FORBIDDEN', 'peer-always', 'a peer-flagged card never takes always', { gate: 'link', cardId });
    const cls = baseClass(String(card.kind), decision, flags);
    if (cls === undefined) throw fail('BAD_REQUEST', 'bad-params', `${decision} is not a decision of a ${String(card.kind)} card (valid: ${validDecisions(String(card.kind)).join(', ')})`, { cardId });

    // 3. decisionSig by the approvals key (approver in the preimage, Q5)
    if (typeof p.decisionSig !== 'string' || p.decisionSig.length === 0 || p.decisionSig.length > 1024) throw fail('BAD_REQUEST', 'bad-params', 'decisionSig is required (approvals key over cardId, decision, contentHash, approver)');
    const v = this.#approvals.verify(ctx.principal, approveMessage({ cardId, decision, cardContentHash: card.contentHash, approverPrincipalId: ctx.principal }), p.decisionSig);
    if (v === 'unavailable') throw fail('UNSUPPORTED', 'presence', 'the approvals key lives behind the signed helper (M1.3); no software fallback', { milestone: 'M1.3', cardId });
    if (v !== 'ok') throw fail('AUTH', 'bad-signature', 'decisionSig does not verify for this card, decision and approver', { cardId });

    // 4. presence per class
    const isCli = ctx.credential !== 'gui'; // Aegis C1: the credential decides, never the self-declared surface
    const live = (): void => {
      if (ctx.isLive && !ctx.isLive()) throw fail('ENGINE', 'gone', 'the connection closed during the decision', { cardId });
    };
    let presence: 'fresh' | 'cached' | 'cli';
    let token: PresenceToken | null = null;
    if (cls === 'none') {
      presence = 'fresh'; // unreachable in M1.6 (no held cards); withdraw takes no presence
    } else if (cls === 'cached' && !isCli && (await this.#useUnlock(ctx.connId)) === 'ok') {
      presence = 'cached';
    } else {
      const hadUnlock = this.unlocks.has(ctx.connId);
      token = await this.#prove(r, decision, ctx, cls, hadUnlock);
      presence = isCli ? 'cli' : 'fresh';
      if (!r.presence?.consumedByEffect) {
        const used = consumeBoundPresence(token, r.presence?.purpose ?? 'approval.decide', this.#binding(r, decision));
        if (used !== 'ok') throw await this.#presenceDenied(card, ctx, `presence token ${used}`, hadUnlock);
      }
      if (cls === 'cached' && !isCli && !this.unlocks.has(ctx.connId)) {
        live();
        this.unlocks.open(ctx.connId);
        await this.#o.log('approval.unlock', { connId: ctx.connId, cardId }, { connId: ctx.connId });
      }
    }
    let rootSig: { signer: string; sig: string } | null = null;
    if (cls === 'root') {
      const root = this.#o.root;
      if (!root) throw new RootUnavailableError(`the ${decision} decision`);
      try {
        rootSig = root.signRow({ schemaVersion: 'gnomon-root-decision:v1', cardId, decision, contentHash: card.contentHash, approver: ctx.principal });
      } catch (err) {
        if (err instanceof RootUnavailableError) throw err;
        throw fail('UNSUPPORTED', 'root-unprovisioned', 'the root key could not sign the decision', { cardId });
      }
    }

    // 5. log, then effect, then state (log-before-effect)
    const now = this.#clock();
    const via = isCli ? 'cli' : 'gui'; // from the credential (Aegis C1)
    const prov = isCli ? (this.#o.provenanceOf?.(ctx.connId) ?? null) : null;
    const cli = isCli ? (prov ?? { client: 'cli', connId: ctx.connId }) : { client: 'gui', connId: ctx.connId };
    // re-check after the last await (expiry, a racing decision, a closed connection): exactly one terminal row
    live();
    if (r.outcome || r.card.state !== 'pending' || !isCardDecidable(r.card, decision)) throw fail('BAD_REQUEST', 'bad-params', `card ${cardId} is no longer pending`, { cardId, state: String(r.card.state) });
    await this.#o.log(
      'approval.decide',
      { cardId, decision, by: ctx.principal, decisionSig: p.decisionSig, presence, via, connId: ctx.connId, cli, contentHash: card.contentHash, ...(rootSig ? { rootSig } : {}), ...(p.note ? { note: p.note } : {}) },
      { connId: ctx.connId, ...(card.hsid ? { session: card.hsid } : {}) },
    );
    if (decision === 'always') await this.#o.log('approval.rule.learned', { cardId, tool: r.tool ?? null, matchExact: true, presence }, { connId: ctx.connId });
    for (const why of this.#suspicions(ctx, isCli, prov, presence, cls)) {
      await this.#o.log('approval.suspect', { cardId, connId: ctx.connId, why, provenance: cli }, { connId: ctx.connId });
    }
    if (r.effect) {
      try {
        await r.effect(decision, { token, rootSig, connId: ctx.connId });
      } catch (err) {
        await this.#o.log('approval.suspect', { cardId, connId: ctx.connId, why: 'effect-failed', decision, error: err instanceof Error ? err.message.slice(0, 200) : 'effect failed' }, { connId: ctx.connId }).catch(() => undefined);
        throw err;
      }
    }
    r.card = { ...card, state: 'decided', decidedBy: ctx.principal, decidedAt: new Date(now).toISOString(), decisionSig: p.decisionSig, presence, via, cli };
    this.#settle(r, decision);
    return r.card;
  }

  /** Use this connection's unlock; an idle one is dropped and logged (approval.unlock.dropped{idle}). */
  async #useUnlock(connId: string): Promise<'ok' | 'none' | 'idle'> {
    const u = this.unlocks.use(connId);
    if (u === 'idle') await this.#o.log('approval.unlock.dropped', { connId, reason: 'idle' }, { connId });
    return u;
  }

  #binding(r: CardRecord, decision: string): PresenceBinding {
    return r.presence ? r.presence.binding(decision) : { action: 'approval.decide', cardId: r.card.cardId, contentHash: r.card.contentHash, decision };
  }

  /** Expected binding digest for a decision (tests: mint a token bound to it). */
  bindingFor(cardId: string, decision: string): { purpose: PresencePurpose; binding: PresenceBinding; digest: string } {
    const r = this.#cards.get(cardId);
    if (!r) throw fail('NOT_FOUND', 'not-found', `no card ${cardId}`);
    const binding = this.#binding(r, decision);
    return { purpose: r.presence?.purpose ?? 'approval.decide', binding, digest: presenceBindingDigest(binding) };
  }

  async #prove(r: CardRecord, decision: string, ctx: DecideContext, cls: DecisionClass, hadUnlock: boolean): Promise<PresenceToken> {
    const reason =
      decision === 'always'
        ? 'fresh presence: always is a standing rule'
        : cls === 'root'
          ? 'fresh presence and the root key'
          : cls === 'cached'
            ? 'presence unlocks this connection for 15 min'
            : `fresh presence: ${String(r.card.kind)}`;
    const prompt = composePresencePrompt(this.#o.kernel, r.card, { decision, connId: ctx.connId, guiSessions: this.#o.guiSessions?.() ?? 0, reason });
    const purpose = r.presence?.purpose ?? 'approval.decide';
    const binding = this.#binding(r, decision);
    let token: PresenceToken;
    try {
      token = await this.#presence.prove({ purpose, binding, prompt, connId: ctx.connId });
    } catch (err) {
      if (err instanceof PresenceDenied) throw await this.#presenceDenied(r.card, ctx, err.message, hadUnlock);
      await this.#o.log('approval.presence.denied', { cardId: r.card.cardId, connId: ctx.connId, why: 'unavailable', milestone: 'M1.3' }, { connId: ctx.connId }).catch(() => undefined);
      if (hadUnlock && cls !== 'cached') throw fail('FORBIDDEN', 'presence', `${decision} takes fresh presence; the cached unlock of this connection does not carry it`, { cardId: r.card.cardId });
      throw fail('UNSUPPORTED', 'presence', 'no presence prompt exists before the signed helper (M1.3); there is no software fallback', { cardId: r.card.cardId, milestone: 'M1.3' });
    }
    if (!PresenceToken.is(token) || PresenceToken.bindingOf(token) !== presenceBindingDigest(binding) || token.purpose !== purpose) {
      throw await this.#presenceDenied(r.card, ctx, 'presence token does not bind this decision', hadUnlock);
    }
    return token;
  }

  async #presenceDenied(card: CardV1, ctx: DecideContext, why: string, _hadUnlock: boolean): Promise<RefusedError> {
    await this.#o.log('approval.presence.denied', { cardId: card.cardId, connId: ctx.connId, why }, { connId: ctx.connId }).catch(() => undefined);
    return fail('FORBIDDEN', 'presence', `presence was not proved for ${card.cardId} (${why})`, { cardId: card.cardId });
  }

  /** approval.suspect `why` values (the spec names these in prose only; not added to the registered reason enum, see report). */
  #suspicions(_ctx: DecideContext, isCli: boolean, prov: CliProvenance | null, presence: string, cls: DecisionClass): string[] {
    const out: string[] = [];
    if (isCli && !prov) out.push('cli-provenance-unknown');
    if (prov && prov.tty === null) out.push('no-tty');
    if (prov && this.#o.liveSessionPgids?.().has(prov.pgid)) out.push('cli-ancestry-session');
    if (presence === 'cached' && cls !== 'cached') out.push('unlock-beyond-class');
    return out;
  }

  /* ── status ─────────────────────────────────────────────────────────── */

  status(forHuman: boolean): { n: number; pendingForYou: number; held: number; byKind: Record<string, number> } {
    const pending = this.cards().filter((c) => c.state === 'pending');
    const byKind: Record<string, number> = {};
    for (const c of pending) byKind[String(c.kind)] = (byKind[String(c.kind)] ?? 0) + 1;
    return { n: this.#cards.size, pendingForYou: forHuman ? pending.length : 0, held: 0, byKind };
  }
}
