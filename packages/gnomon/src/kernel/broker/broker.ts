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
 *   4. presence per class: `cached` uses the unlock of THIS GUI DEVICE
 *      (TD-2026-10-20-086 F5, superseding S25-H1: keyed by the launch-token
 *      deviceId via unlockKeyOf, so it survives a reconnect; G-BRK-05) or
 *      proves fresh presence and opens one; `fresh`
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
 * written is recorded `approval.effect.failed{cardId, decision, effect,
 * reason}` (P8-D98, slice A2; effect = the card kind, reason a kebab-case
 * code) and the card stays pending. No `approval.suspect` row: a failed
 * effect is a fact about the kernel, not a suspicion about the decider.
 *
 * decisionSig v2 (P8-D98, slice A2): an `answer` decision signs the v2
 * message (signer decisionMessage) whose last line is the answer digest
 * (sha256 of the note, the noteHash approval.decide records), and the
 * presence binding carries the same answerDigest. What that binds depends
 * on who signs (Aegis M2): when the CLIENT supplies its own decisionSig, the
 * digest is over the text the client signed, so an answer rewritten on the
 * wire after signing fails decisionSig (AUTH bad-signature). On the
 * helper-signs path (no client decisionSig) the KERNEL computes answerDigest
 * from the note it received, so v2 binds "the text the kernel received",
 * NOT "the text the human saw": a rewrite before the note reaches the
 * kernel is not caught by the signature.
 * Every other decision keeps the v1 message.
 *
 * Silence never allows (B6, G-BRK-01): `tool.permission` cards expire into
 * deny; `fallback` and `api-token` cards never expire; `decisionOf` of a
 * card the broker does not hold is `deny`.
 */
import {
  CARD_DECISIONS,
  ID_PATTERNS,
  parseApproveScope,
  scopeDigest,
  isCardDecidable,
  mintId,
  refuse,
  RefusedError,
  validateCardV1,
  type CardFlag,
  type CardDecision,
  type CardKind,
  type CardV1,
  type RefusalCode,
  type RefusalData,
  type RefusalGate,
} from '@a-company/gnomon-contracts';
import { canonicalJson } from '@a-company/gnomon-contracts';
import { createHash } from 'node:crypto';
import { answerDigest, decisionMessage, usesDecisionV2, type KeyRing, type Signer } from '../log/signer.js';
import { consumeBoundPresence, PresenceToken, presenceBindingDigest, requestPresence, type PresenceBinding, type PresencePurpose } from '../identity/presence.js';
import type { RootAuthority } from '../identity/root-authority.js';
import { RootUnavailableError } from '../identity/root-authority.js';
import { HardwarePresenceDenied, HelperUnlockGone, type DecisionBatchRequest, type DecisionBatchResult, type DecisionSignRequest, type DecisionSignResult } from '../identity/hardware.js';
import { decisionRowV2, intentOf, type DecisionRowV2 } from '../identity/decision-batch.js';
import { baseClass, KIND_DECISIONS, validDecisions, type DecisionClass } from './classes.js';
import { blockOf, composePresencePrompt, contentHashOf, signActions, type SignedPresencePrompt } from './card.js';
import { helperBoundsOf, UnlockStore, type UnlockLimits, type UnlockUse } from './unlock.js';
import { SESSION_DISARM_REASON } from './arm-custody.js';
import { simpleArgv } from '../supervisor/shell-readonly.js';
import { prefixRefusal, shownPrefixWords } from '../supervisor/prefix-policy.js';
import type { HelperSessionCause } from '../identity/helper.js';

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
  /**
   * Is there an approvals key at all (default: yes)? Asked BEFORE the
   * decisionSig shape check, so a client with no signing path yet (the GUI
   * before M1.3) sees the presence refusal, not BAD_REQUEST (T-2026-10-18-018 (2)).
   */
  available?(): boolean;
  /**
   * M1.3: a HELPER-HELD approvals key makes the decisionSig itself, after
   * presence (identity/hardware.ts HelperApprovalsKey). When present and the
   * caller sent no decisionSig, the broker asks it to sign: `cached` under the
   * connection's unlock (held in the helper), else `fresh` with the
   * kernel-signed prompt, minting the bound PresenceToken in the same touch.
   */
  signDecision?(req: DecisionSignRequest): Promise<DecisionSignResult>;
  /** TD-2026-10-20-514: the helper takes decision.sign (>= 1.8.0, from info.version only) */
  decisionBatchAvailable?(): Promise<boolean>;
  /** TD-2026-10-20-514: ONE presence signs the decision and every root row */
  signDecisionBatch?(req: DecisionBatchRequest): Promise<DecisionBatchResult>;
  /** Drop a connection's unlock where the key lives (the helper). */
  dropUnlock?(connId: string): Promise<void>;
  /** Helper 1.6.0 (`conn.close`): drop the connection's unlock AND close every voice arm naming it. Preferred over dropUnlock on close. */
  connectionClosed?(connId: string): Promise<void>;
}
export const NO_APPROVALS_KEY: ApprovalsKey = Object.freeze({ verify: () => 'unavailable' as const, available: () => false });

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
export type CardEffect = (
  decision: string,
  ctx: {
    token: PresenceToken | null;
    rootSig: { signer: string; sig: string } | null;
    connId: string;
    decisionSig?: string;
    presence?: string;
    /** TD-2026-10-20-514: the root signature of each prepared row, in order (decision.sign, or the legacy signer) */
    rowSigs?: ReadonlyArray<{ signer: string; sig: string }>;
    /** what RaiseInput.prepare returned for this decision */
    prepared?: PreparedRows;
  },
) => Promise<void> | void;

/**
 * TD-2026-10-20-514: the rows a root-class decision's effect will write, BUILT before the prompt (unsigned), so ONE
 * presence signs the decision and every row. `release` ends the prepare (its lock); the broker calls it in a finally.
 */
export interface PreparedRows {
  rows: Record<string, unknown>[];
  release(): void;
  /** the preparer's own state, handed back to the effect */
  state?: unknown;
}

export const HELPER_BATCH_UNAVAILABLE = 'unavailable (helper <1.8.0)' as const;
export type HelperBatchState = 'available' | typeof HELPER_BATCH_UNAVAILABLE | null;

/** The decisions of `kind` that are root class (the kind's table, plus RaiseInput.rootDecisions). */
export function rootDecisionsOf(kind: string, extra: readonly string[] = []): string[] {
  const t = (KIND_DECISIONS as Record<string, Record<string, string>>)[kind] ?? {};
  return [...new Set([...Object.keys(t).filter((d) => t[d] === 'root'), ...extra])].sort();
}

/**
 * Aegis C1e (TD-2026-10-20-514): a root-capable card's block carries a {type:'root-rows', rootDecisions, detail} node
 * with the card's FULL structured detail, so the GUI verifies it against contentHash and renders detail.rootRows (what
 * the decision signs) in full; it shows no root-class Approve without it.
 */
function rootBlock(block: Record<string, unknown>, detail: Record<string, unknown> | null, rootDecisions: string[]): Record<string, unknown> {
  if (!detail || !Array.isArray(detail.rootRows)) return block;
  const children = [...((block.children as unknown[]) ?? []), { type: 'root-rows', rootDecisions, detail: structuredClone(detail) }];
  return { ...block, children };
}

/** The row-table kind (decision-batch.ts ROW_TABLE_KINDS) of a root-class card: its kind, or a grant/strictness card's action. */
export function rootKindOf(kind: string, detail: Record<string, unknown>): string {
  if (kind === 'grant') return detail.action === 'mod.uninstall' ? 'uninstall' : detail.action === 'mod.mcp.config' ? 'mod.mcp.config' : 'grant';
  if (kind === 'strictness' && detail.op === 'voice.enrol') return 'voice.enrol';
  return kind;
}

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
  /**
   * TD-2026-10-20-514: build the rows the effect writes for `decision` (unsigned; null = none). Root-class decisions
   * only. The rows (createdAt dropped) must equal detail.rootRows, which the card shows (Aegis C1).
   */
  prepare?: (decision: string) => PreparedRows | null | Promise<PreparedRows | null>;
  /** Aegis Q3: decisions of this card that are ROOT class whatever the kind's table says (voice.enrol allow) */
  rootDecisions?: readonly string[];
  /** voice never decides this card, deny included (§14.7); a gate-class card with detail.target 'claude-binary' is always hand-only (TD-2026-10-19-063 M3) */
  handOnly?: boolean;
  /**
   * TD-2026-10-20-086 F6 (Aegis open point 1): this `grant` card mints a standing grant (#standing-grant only).
   * Its `allow` is FRESH class (one presence, no root signature) and its touch keeps the device's cached unlock;
   * every other `grant` card keeps the root class.
   */
  standingGrant?: boolean;
  /**
   * P8-D96: the decisions this card offers, a subset of its kind's (permission
   * slice cards: allow | deny, never `always`). Only these are signed as
   * actions; `approve` refuses any other with bad-params.
   */
  decisions?: readonly CardDecision[];
  /**
   * ask-user: the kernel's check of a decision's note against what the card
   * holds (the questions), run BEFORE presence and before approval.decide; a
   * string is the refusal (BAD_REQUEST bad-params). Absent ⇒ no check.
   */
  checkNote?: (decision: string, note: string | undefined) => string | null;
  /** The note is the human's private answer: approval.decide carries {noteHash, noteBytes}, never the text. */
  privateNote?: boolean;
  /** `always` (S-L1): the repo the standing rule is scoped to; carried on approval.rule.learned. A card without it never takes `always`. */
  ruleScope?: { repoKey: string };
}

/** #standing-grant (TD-2026-10-20-086 F6): the live grant that covers a decision. */
export interface StandingMatch {
  grantId: string;
  tuple: string;
  repo: string | null;
}

/** The broker's seam to #standing-grant (standing-grant.ts StandingGrants): asked before presence, told after the decide row. */
export interface StandingSeam {
  match(ctx: DecideContext, card: CardV1, decision: string, detail: Record<string, unknown>, ruleRepo: string | null): StandingMatch | null;
  used(m: StandingMatch, d: { cardId: string; decision: string; hsid: string | null; connId: string }): Promise<void>;
  /** the session ended (lock, sleep, user switch) or the helper exited: every grant ends */
  endAll?(reason: 'screen-lock' | 'display-sleep' | 'system-sleep' | 'user-switch' | 'helper-exit'): Promise<unknown>;
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
  /**
   * F5 (TD-2026-10-20-086): the device the connection authenticated as (a GUI session: the launch-token deviceId).
   * A gui credential's cached unlock is keyed by it (unlockKeyOf), so the unlock survives a reconnect.
   */
  deviceId?: string;
  /** Is the connection still open? Checked before an unlock opens and before approval.decide (default: live). */
  isLive?: () => boolean;
}

interface CardRecord {
  card: CardV1;
  /** the raise detail (inside contentHash): #standing-grant reads what the card asserts from it */
  detail: Record<string, unknown>;
  /** TD-2026-10-19-063 M3: voice-hand-only for every decision */
  handOnly?: boolean;
  tool?: string;
  presence?: RaiseInput['presence'];
  effect?: CardEffect;
  prepare?: RaiseInput['prepare'];
  rootDecisions?: readonly string[];
  waiters: Array<(d: string) => void>;
  outcome?: string;
  /** Aegis A3: the decision claimed synchronously after approve's last re-check (before approval.decide); cleared if that row or the effect fails */
  claim?: string;
  /** an expire() that arrived while a decision was in flight: applied if that decision does not settle the card */
  expireAfter?: string;
  decisions?: readonly string[];
  note?: string;
  checkNote?: RaiseInput['checkNote'];
  privateNote?: boolean;
  ruleScope?: { repoKey: string };
  /** F6: a standing-grant card (RaiseInput.standingGrant): allow is fresh, not root */
  standingGrant?: boolean;
  /** TD-2026-10-20-294: the argv of a Bash permission card's command when it is ONE literal simple command (simpleArgv), else absent */
  bashArgv?: readonly string[];
}

/** The extra presence-binding field of a v2 decision: the answer digest, or a prefix always's scope digest. */
type BindingExtra = { answerDigest: string } | { scopeDigest: string };

/** tool.permission default timeout (expires into deny). Other kinds wait. */
export const PERMISSION_TIMEOUT_MS = 10 * 60_000;
/**
 * T-2026-10-18-028 L2: presence prompts are rate-limited PER CONNECTION. At most ONE fresh prompt is
 * outstanding on a connection (a second is refused while the first is on screen), and after a prompt
 * the human was shown and did not prove (declined at the prompt) the connection waits
 * PROMPT_COOLDOWN_MS before it can raise another — so a holder of the connection cannot stack prompts
 * or re-raise one the instant the human dismisses it (prompt fatigue). A prompt the human ACCEPTED
 * starts no cooldown (consecutive deliberate decisions stay fast). Refused FORBIDDEN{presence} with
 * data.why prompt-outstanding | prompt-cooldown (no new wire reason: clientApiId unmoved).
 */
export const PROMPT_COOLDOWN_MS = 3_000;

/** L2: a prompt refused by the rate limit (nothing was shown); passes through the presence error mapping unchanged. */
export class PromptRateLimited extends RefusedError {}
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
  /** T-2026-10-18-028 M2: absolute TTL + signature cap per unlock (defaults UNLOCK_ABSOLUTE_MS / UNLOCK_MAX_SIGNATURES). */
  unlockLimits?: UnlockLimits;
  /** open GUI sessions {n} for the prompt (#web-endpoint) */
  guiSessions?: () => number;
  /** CLI peer provenance (M1.3/M1.7); default unknown */
  provenanceOf?: (connId: string) => CliProvenance | null;
  /** live session pgids (#supervisor, M1.7): a CLI decision from inside a session's job is suspect */
  liveSessionPgids?: () => ReadonlySet<number>;
}

const APPROVE_KEYS = ['cardId', 'decision', 'note', 'decisionSig', 'via', 'voice', 'scope'] as const;

/** TD-2026-10-20-294: the shown command's argv when a Bash permission card's command is one literal simple command. */
function bashArgvOf(kind: string, tool: string | undefined, input: unknown): string[] | null {
  if (kind !== 'permission' || tool !== 'Bash' || input === null || typeof input !== 'object' || Array.isArray(input)) return null;
  const c = (input as Record<string, unknown>).command;
  return typeof c === 'string' ? simpleArgv(c) : null;
}

/** The contracts KEBAB_64 shape of approval.effect.failed `effect` / `reason`. */
const KEBAB_64 = /^[a-z][a-z0-9-]{0,63}$/;
const kebab64 = (v: unknown): string | undefined => (typeof v === 'string' && KEBAB_64.test(v) ? v : undefined);

/** approval.effect.failed `effect` (P8-D98): the card kind names the effect (install grants, api-token activation, tool answer). */
function effectNameOf(card: CardV1): string {
  return kebab64(String(card.kind)) ?? 'card-effect';
}

/** approval.effect.failed `reason` (P8-D98): a kebab-case code, never free text — a refusal's reason or gate, else `effect-threw`. */
function effectFailureReason(err: unknown): string {
  if (err instanceof RefusedError) return kebab64(err.refusal.data?.reason) ?? kebab64(err.refusal.gate) ?? 'effect-refused';
  if (err instanceof RootUnavailableError) return 'root-unavailable';
  return 'effect-threw';
}

const CONN_ID = /^conn:[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * F5 (TD-2026-10-20-086): the key a cached unlock is held under. A gui credential WITH a deviceId: `udev:` + 40 hex
 * of sha256 over the deviceId (fits the helper's connId shape [A-Za-z0-9:_-]{1,128}, names no raw device id), so
 * every GUI session of that device shares it and a reconnect finds it. Anything else: the connId (a CLI connection
 * never holds an unlock; a gui context without a deviceId keeps the old per-connection behaviour).
 */
export function unlockKeyOf(ctx: Pick<DecideContext, 'connId' | 'credential' | 'deviceId'>): string {
  if (ctx.credential === 'gui' && typeof ctx.deviceId === 'string' && ctx.deviceId.length > 0 && ctx.deviceId.length <= 256) {
    return `udev:${createHash('sha256').update(`gnomon-unlock-device:v1\n${ctx.deviceId}`, 'utf8').digest('hex').slice(0, 40)}`;
  }
  return ctx.connId;
}

export class ApprovalBroker {
  readonly #o: BrokerOptions;
  readonly #cards = new Map<string, CardRecord>();
  readonly unlocks: UnlockStore;
  readonly #presence: PresenceProvider;
  readonly #approvals: ApprovalsKey;
  readonly #clock: () => number;
  readonly #mono: () => number;
  /** L2: connections with a fresh prompt on screen now */
  readonly #prompting = new Set<string>();
  /** L2: per connection, when its last unproved prompt ended (mono) */
  readonly #cooldownFrom = new Map<string, number>();
  #standing: StandingSeam | null = null;
  /** #standing-grant (F6): the daemon wires the grants after the broker exists. */
  setStanding(s: StandingSeam | null): void {
    this.#standing = s;
  }
  /** F5: the last connection that opened or used each unlock key (named on its approval.unlock.dropped row) */
  readonly #lastConn = new Map<string, string>();
  /** Aegis M1: per device unlock key, the connections already reported joined (and the opener) */
  readonly #joined = new Map<string, Set<string>>();

  /** approval.unlock.dropped for an unlock key: the payload names the last connection (and scope device for a device key). */
  async #droppedRow(key: string, reason: string, extra: Record<string, unknown> = {}): Promise<void> {
    const conn = this.#lastConn.get(key) ?? key;
    this.#lastConn.delete(key);
    this.#joined.delete(key);
    await this.#o.log('approval.unlock.dropped', { connId: conn, reason, ...extra, ...(key.startsWith('udev:') ? { scope: 'device' } : {}) }, CONN_ID.test(conn) ? { connId: conn } : {});
  }

  constructor(o: BrokerOptions) {
    this.#o = o;
    this.#presence = o.presence ?? PRESENCE_UNAVAILABLE;
    this.#approvals = o.approvals ?? NO_APPROVALS_KEY;
    this.#clock = o.clock ?? Date.now;
    const mono = o.mono ?? (() => performance.now());
    this.#mono = mono;
    this.unlocks = new UnlockStore(mono, o.unlockIdleMs, o.unlockLimits);
  }

  /* ── raise ──────────────────────────────────────────────────────────── */

  #helperBatch: HelperBatchState = null;

  /**
   * Q2 (TD-2026-10-20-514): status.helper.batch. Can this helper sign a decision and its rows in ONE touch
   * (decision.sign, info.version >= 1.8.0)? Probed when the daemon starts and before every root decision;
   * null = no helper-held approvals key.
   */
  helperBatch(): HelperBatchState {
    return this.#helperBatch;
  }

  async refreshHelperBatch(): Promise<HelperBatchState> {
    if (typeof this.#approvals.decisionBatchAvailable !== 'function') return (this.#helperBatch = null);
    const ok = await this.#approvals.decisionBatchAvailable().catch(() => false);
    return (this.#helperBatch = ok ? 'available' : HELPER_BATCH_UNAVAILABLE);
  }

  async raise(input: RaiseInput): Promise<CardV1> {
    const cardId = input.cardId ?? mintId('card');
    if (!ID_PATTERNS.card.test(cardId)) throw fail('BAD_REQUEST', 'bad-params', 'cardId must be card:<ULID>');
    if (this.#cards.has(cardId)) return this.#cards.get(cardId)!.card;
    // Aegis M3 guard: a rule-scoped card (one an `always` can learn from) never carries an effect — a learned rule
    // auto-allows later WITHOUT running that effect, so the two together would let a rule stand in for an effect
    if (input.ruleScope && input.effect) throw fail('BAD_REQUEST', 'bad-params', 'a card carries a ruleScope or an effect, never both');
    if (input.decisions !== undefined) {
      const valid = validDecisions(input.kind);
      if (input.decisions.length === 0 || input.decisions.some((d) => !valid.includes(d))) throw fail('BAD_REQUEST', 'bad-params', `decisions must be a non-empty subset of ${valid.join(', ')}`);
    }
    // Aegis C1a (TD-2026-10-20-514): every root-class card's detail carries rootRows (what its decision signs, inside
    // contentHash); a card whose decision writes no row shows an empty list
    const rootCapable = Object.values((KIND_DECISIONS as Record<string, Record<string, string>>)[input.kind] ?? {}).includes('root') || (input.rootDecisions?.length ?? 0) > 0;
    if (rootCapable && !input.prepare && !Array.isArray(input.detail.rootRows)) input = { ...input, detail: { ...input.detail, rootRows: [] } };
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
      block: rootBlock(input.block ?? rendered.block, rootCapable ? input.detail : null, rootDecisionsOf(input.kind, input.rootDecisions).filter((d) => !(input.standingGrant && d === 'allow'))),
      contentHash,
      ...(flags.length ? { flags } : {}),
      actions: signActions(this.#o.kernel, cardId, input.kind, contentHash, input.decisions),
      state: 'pending',
      ...(timeoutMs !== undefined ? { timeoutAt: new Date(now + timeoutMs).toISOString() } : {}),
    };
    const errors = validateCardV1(card, { mode: 'strict' });
    if (errors.length) throw fail('BAD_REQUEST', 'bad-params', `card does not validate: ${errors.join('; ')}`);
    // log before the card exists for anyone (B3: only the broker appends approval.*)
    await this.#o.log('approval.request', { card, flags, ...(input.toolInput !== undefined ? { tool_input: input.toolInput } : {}), ...(input.tool ? { tool: input.tool } : {}) }, input.hsid ? { session: input.hsid } : {});
    if (input.standingGrant && input.kind !== 'grant') throw fail('BAD_REQUEST', 'bad-params', 'standingGrant is a grant card');
    this.#cards.set(cardId, { card, detail: input.detail, ...(input.standingGrant ? { standingGrant: true } : {}), ...(input.tool ? { tool: input.tool } : {}), ...(input.presence ? { presence: input.presence } : {}), ...(input.effect ? { effect: input.effect } : {}), ...(input.prepare ? { prepare: input.prepare } : {}), ...(input.rootDecisions ? { rootDecisions: [...input.rootDecisions] } : {}), ...(input.decisions ? { decisions: [...input.decisions] } : {}), ...(input.checkNote ? { checkNote: input.checkNote } : {}), ...(input.privateNote ? { privateNote: true } : {}), ...(input.ruleScope ? { ruleScope: { repoKey: input.ruleScope.repoKey } } : {}), ...((): { bashArgv?: string[] } => { const a = input.ruleScope ? bashArgvOf(input.kind, input.tool, input.toolInput) : null; return a ? { bashArgv: a } : {}; })(), ...(input.handOnly || (input.kind === 'gate-class' && input.detail?.target === 'claude-binary') ? { handOnly: true } : {}), waiters: [] });
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

  /** The human's note on a decided card (P8-D96: a plan reject's note goes back to the session). */
  noteOf(cardId: string): string | undefined {
    return this.#cards.get(cardId)?.note;
  }

  /**
   * Expire ONE pending card now (P8-D96: the session cancelled the request, or
   * exited). Into deny, never allow; logged approval.expire{…, into, why}.
   * A card that already has an outcome (or a claimed decision) is left alone
   * (false). Like expireDue, a card with a decision in flight is not expired
   * under it (Aegis A3): the expiry is remembered and applied when that
   * decision ends without settling the card.
   */
  async expire(cardId: string, why: string): Promise<boolean> {
    const r = this.#cards.get(cardId);
    if (!r || r.outcome || r.claim || r.card.state !== 'pending') return false;
    if (this.#deciding.has(cardId)) {
      r.expireAfter ??= why;
      return false;
    }
    const into = 'deny';
    r.outcome = into; // claimed before the await: a racing approve re-checks r.outcome and refuses
    await this.#o.log('approval.expire', { cardId, kind: r.card.kind, into, why }, r.card.hsid ? { session: r.card.hsid } : {}).catch(() => undefined);
    r.card = { ...r.card, state: 'expired' };
    for (const w of r.waiters.splice(0)) w(into);
    return true;
  }

  /**
   * §2.4 rule 11 / founder ruling F4 (TD-2026-10-19-528; T-2026-10-19-014 B1): at a drain, every pending card
   * bound to a session (it has an hsid: permission, ask-user, plan, ...) expires with `why` (`session-drained`).
   * A card bound to no session (install, api-token, fallback, daemon-stop) is left pending: the new kernel raises
   * it again and asks for presence afresh. Returns the expired cardIds.
   */
  async expireSessionBound(why: string): Promise<string[]> {
    const out: string[] = [];
    for (const card of this.cards()) {
      if (card.state !== 'pending' || typeof card.hsid !== 'string') continue;
      if (await this.expire(card.cardId, why)) out.push(card.cardId);
    }
    return out;
  }

  /**
   * §2.4 rule 11 (T-2026-10-19-014 B2; F4, TD-2026-10-19-528): retire a card an EARLIER kernel raised and left
   * pending. This broker never held it, so no decision against its id can land here (decide/approve answer
   * NOT_FOUND{not-found}); the row closes it on the chain (and in every GUI's stack) as `approval.expire{why}`,
   * deny. A cardId this broker holds is refused: a live card expires through expire(). B3: only the broker
   * appends approval.*.
   */
  async retireForeign(card: { cardId: string; kind: string; hsid?: string }, why: string): Promise<void> {
    if (!ID_PATTERNS.card.test(card.cardId)) throw fail('BAD_REQUEST', 'bad-params', 'cardId must be card:<ULID>');
    if (this.#cards.has(card.cardId)) throw fail('BAD_REQUEST', 'bad-params', `card ${card.cardId} is live in this kernel; expire it instead`);
    await this.#o.log('approval.expire', { cardId: card.cardId, kind: card.kind, into: 'deny', why }, card.hsid ? { session: card.hsid } : {});
  }

  /**
   * approval.auto (§9.1, B3): a request answered allow with NO card because a
   * kernel-derived standing rule matched it exactly. Carries the inputHash
   * (a sensitive FIELD label), never the tool input. Must reject if the row
   * was not written (the caller answers only after it).
   */
  async auto(p: { hsid: string; tool: string; inputHash: string; modeRef: string; path?: string }): Promise<void> {
    await this.#o.log('approval.auto', { hsid: p.hsid, tool: p.tool, ...(p.path !== undefined ? { path: p.path } : {}), inputHash: p.inputHash, modeRef: p.modeRef }, { session: p.hsid });
  }

  /**
   * approval.mode.set (§3.4 run modes, B3: only the broker appends approval.*): a run mode changed for a repo or
   * one session. Tightening is written with presence `none`; a loosening only from its strictness card's effect,
   * after fresh presence. Must reject if the row was not written (the caller changes nothing then).
   */
  async modeSet(p: { scope: { repo: string; hsid: string | null }; from: string; to: string; by: Record<string, unknown>; presence: 'none' | 'fresh' | `standing:${string}` }, ids: { connId?: string; session?: string } = {}): Promise<void> {
    await this.#o.log('approval.mode.set', { scope: { repo: p.scope.repo, ...(p.scope.hsid ? { hsid: p.scope.hsid } : {}) }, from: p.from, to: p.to, by: p.by, presence: p.presence }, ids);
  }

  /** approval.suspect from the kernel's own observation (B3: only the broker appends approval.*). */
  async suspect(why: string, data: Record<string, unknown>, hsid?: string): Promise<void> {
    await this.#o.log('approval.suspect', { why, ...data }, hsid ? { session: hsid } : {});
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
      if (r.card.state !== 'pending' || r.outcome || r.claim || !r.card.timeoutAt || Date.parse(r.card.timeoutAt) > now) continue;
      if (this.#deciding.has(r.card.cardId)) continue; // a decision is in flight: it settles the card (or the next sweep expires it)
      const into = 'deny'; // never into allow (B6); tool.permission expires into deny
      await this.#o.log('approval.expire', { cardId: r.card.cardId, kind: r.card.kind, into }, r.card.hsid ? { session: r.card.hsid } : {});
      r.card = { ...r.card, state: 'expired' };
      this.#settle(r, into);
      out.push(r.card.cardId);
    }
    for (const { connId, reason } of this.unlocks.ended()) {
      this.unlocks.drop(connId);
      await this.#dropHelperUnlock(connId);
      await this.#droppedRow(connId, reason);
    }
    return out;
  }

  /**
   * A connection closed: an unlock keyed by THAT connection is gone. F5: an unlock keyed by the GUI device
   * (unlockKeyOf) is not: the device's next connection uses it (it ends at lock, sleep, user switch or a cap).
   * T-2026-10-18-028 M3: the helper is told ALWAYS, whether or not the broker holds an unlock for the
   * connection — the two records can diverge (a fresh sign whose `kept` reply raced a close or a
   * failure), and the helper's is the one that signs.
   */
  async connectionClosed(connId: string): Promise<void> {
    this.#cooldownFrom.delete(connId); // L2 state is per connection; a connId is never reused
    const had = this.unlocks.drop(connId);
    if (this.#approvals.connectionClosed) await this.#approvals.connectionClosed(connId).catch(() => undefined);
    else await this.#dropHelperUnlock(connId);
    if (had) await this.#droppedRow(connId, 'closed').catch(() => undefined);
  }

  /** T-2026-10-18-028 M3: tell the helper to drop `connId`'s unlock. Never throws; the helper side escalates a failed drop (hardware.ts). */
  async #dropHelperUnlock(connId: string): Promise<void> {
    await this.#approvals.dropUnlock?.(connId).catch(() => undefined);
  }

  /** The helper exited: every unlock it held is gone (§3.1 failure modes); the next decision on each connection prompts again. */
  async helperExited(): Promise<void> {
    for (const connId of this.unlocks.connIds()) {
      if (this.unlocks.drop(connId)) await this.#droppedRow(connId, 'helper-exit').catch(() => undefined);
    }
    await this.#standing?.endAll?.('helper-exit').catch(() => undefined); // F6: a grant never outlives the unlock it signs under
  }

  /**
   * Helper 1.6.0 session push (screen lock, screensaver, display or system sleep, user switch; §14.7, §A.1):
   * logs approval.unlock.dropped{reason: SESSION_DISARM_REASON[cause], cause}, the same mapping as the disarm rows.
   * logs approval.unlock.dropped{reason: 'screen-lock'} (every session cause, as for the disarm rows).
   */
  async helperSessionEnded(cause: HelperSessionCause): Promise<void> {
    for (const connId of this.unlocks.connIds()) {
      if (this.unlocks.drop(connId)) await this.#droppedRow(connId, SESSION_DISARM_REASON[cause], { cause }).catch(() => undefined);
    }
    // F6: every standing grant ends at the next screen lock, sleep or user switch
    await this.#standing?.endAll?.(SESSION_DISARM_REASON[cause] as 'screen-lock').catch(() => undefined);
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
      if (typeof id === 'string') {
        this.#deciding.delete(id);
        const r = this.#cards.get(id);
        if (r?.expireAfter && !r.outcome && !r.claim) {
          const why = r.expireAfter;
          delete r.expireAfter;
          await this.expire(id, why);
        }
      }
    }
  }

  async #approve(ctx: DecideContext, params: unknown): Promise<CardV1> {
    // 1. principal (B4): voice first — every approve form refuses until an arm can exist (Move 4)
    // TD-2026-10-19-063 M3: a hand-only card (the claude-binary re-pin) names its own refusal, whatever voice's state
    const handOnly = (): boolean => {
      const id = params !== null && typeof params === 'object' ? (params as { cardId?: unknown }).cardId : undefined;
      return typeof id === 'string' && this.#cards.get(id)?.handOnly === true;
    };
    const voiceHandOnly = (): RefusedError => fail('FORBIDDEN', 'voice-hand-only', 'this card is decided by hand only, never by voice (§14.7: the claude-binary re-pin)', { gate: 'voice' });
    if (ctx.principalClass === 'voice') throw handOnly() ? voiceHandOnly() : voiceApproveRefusal();
    if (ctx.principalClass !== 'human') throw fail('FORBIDDEN', 'matrix', `approve is human-only; a ${ctx.principalClass} principal never decides a card (B4)`);
    if (params === null || typeof params !== 'object' || Array.isArray(params)) throw fail('BAD_REQUEST', 'bad-params', 'approve takes {cardId, decision, note?, decisionSig}');
    const p = params as Record<string, unknown>;
    const extra = Object.keys(p).filter((k) => !(APPROVE_KEYS as readonly string[]).includes(k));
    if (extra.length) throw fail('BAD_REQUEST', 'bad-params', `unknown approve params: ${extra.join(', ')}`);
    if ((p.via === 'voice' || 'voice' in p) && handOnly()) throw voiceHandOnly();
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
    // F6 (Aegis open point 1): ONLY the standing-grant card's allow is fresh (one presence, no root key); other grants stay root
    // Aegis Q3: a decision whose effect uses the root key is root class (never standing, never by voice)
    const cls = r.rootDecisions?.includes(decision) ? 'root' : r.standingGrant && decision === 'allow' ? 'fresh' : baseClass(String(card.kind), decision, flags);
    if (cls === undefined) throw fail('BAD_REQUEST', 'bad-params', `${decision} is not a decision of a ${String(card.kind)} card (valid: ${validDecisions(String(card.kind)).join(', ')})`, { cardId });
    if (r.decisions && decision !== 'withdraw' && !r.decisions.includes(decision)) throw fail('BAD_REQUEST', 'bad-params', `${decision} is not one of this card's actions (${r.decisions.join(', ')})`, { cardId });
    if (decision === 'always' && !r.ruleScope) throw fail('BAD_REQUEST', 'bad-params', 'this card has no rule scope: always is not available on it', { cardId });
    // TD-2026-10-20-294: a prefix scope only with always on a Bash permission card whose SHOWN command is one literal
    // simple command starting with exactly those words (the human never approves a prefix the command does not have)
    let prefix: string[] | null = null;
    if (p.scope !== undefined) {
      const sc = parseApproveScope(p.scope);
      if (!sc) throw fail('BAD_REQUEST', 'bad-params', "scope is {kind:'exact'} or {kind:'prefix', prefix:[1-3 words]}", { cardId });
      if (decision !== 'always') throw fail('BAD_REQUEST', 'bad-params', 'a scope is taken only with always', { cardId });
      if (sc.kind === 'prefix') {
        const argv = r.bashArgv;
        if (String(card.kind) !== 'permission' || r.tool !== 'Bash' || !argv) throw fail('BAD_REQUEST', 'bad-params', 'a prefix scope needs a Bash card whose command is one simple command of literal words', { cardId });
        if (sc.prefix.length > argv.length || !sc.prefix.every((w, i) => argv[i] === w)) throw fail('BAD_REQUEST', 'bad-params', 'the prefix is not a prefix of the command on this card', { cardId });
        // Aegis H1: a prefix that equals arbitrary code execution is never a rule (#prefix-policy; kernel-enforced here)
        const why = prefixRefusal(sc.prefix);
        if (why) throw fail('BAD_REQUEST', 'bad-params', `this prefix cannot be a standing rule: ${why}`, { cardId });
        prefix = sc.prefix;
      }
    }
    if (r.checkNote) {
      const why = r.checkNote(decision, typeof p.note === 'string' ? p.note : undefined);
      if (why !== null) throw fail('BAD_REQUEST', 'bad-params', why, { cardId });
    }

    // 3. decisionSig by the approvals key (approver in the preimage, Q5). No key at all (before M1.3) is
    //    answered FIRST, so a decision with no decisionSig (the GUI has no signing path yet) sees the
    //    presence refusal the human can act on, not BAD_REQUEST (T-2026-10-18-018 item 2)
    if (this.#approvals.available?.() === false) throw fail('UNSUPPORTED', 'presence', 'the approvals key lives behind the signed helper (M1.3); no software fallback', { milestone: 'M1.3', cardId });
    // P8-D98 v2: an answer binds its text (the digest), so an answer carries it in note or is refused here
    if (usesDecisionV2(decision) && (typeof p.note !== 'string' || p.note.length === 0)) throw fail('BAD_REQUEST', 'bad-params', `a ${decision} decision carries its text in note`, { cardId });
    const sDigest = prefix ? scopeDigest({ kind: 'prefix', prefix }) : undefined;
    const digest: BindingExtra | undefined = usesDecisionV2(decision) ? { answerDigest: answerDigest(String(p.note)) } : sDigest ? { scopeDigest: sDigest } : undefined;
    const message = decisionMessage({ cardId, decision, cardContentHash: card.contentHash, approverPrincipalId: ctx.principal, ...(digest ?? {}) });
    // M1.3: no decisionSig from the caller + a helper-held key => the helper signs it after presence (step 4)
    const helperSigns = p.decisionSig === undefined && typeof this.#approvals.signDecision === 'function' && cls !== 'none';
    let decisionSig = typeof p.decisionSig === 'string' ? p.decisionSig : '';
    if (!helperSigns) {
      if (typeof p.decisionSig !== 'string' || p.decisionSig.length === 0 || p.decisionSig.length > 1024) throw fail('BAD_REQUEST', 'bad-params', 'decisionSig is required (approvals key over cardId, decision, contentHash, approver)');
      const v = this.#approvals.verify(ctx.principal, message, p.decisionSig);
      if (v === 'unavailable') throw fail('UNSUPPORTED', 'presence', 'the approvals key lives behind the signed helper (M1.3); no software fallback', { milestone: 'M1.3', cardId });
      if (v !== 'ok') throw fail('AUTH', 'bad-signature', 'decisionSig does not verify for this card, decision and approver', { cardId });
    }

    // 4. TD-2026-10-20-514: a root-class decision BUILDS its rows first (prepare), so ONE presence signs everything;
    //    the broker releases the prepare in a finally, whatever happens below
    let prepared: PreparedRows | null = null;
    let decisionRow: DecisionRowV2 | null = null;
    let batch = false;
    if (cls === 'root') {
      const rootRows = r.detail.rootRows;
      if (!Array.isArray(rootRows)) throw fail('BAD_REQUEST', 'bad-params', 'this root-class card shows no rootRows: it cannot be decided (Aegis C1)', { cardId });
      prepared = r.prepare ? await r.prepare(decision) : null;
    }
    try {
    if (cls === 'root') {
      const rootRows = r.detail.rootRows as unknown[];
      if (canonicalJson((prepared?.rows ?? []).map(intentOf)) !== canonicalJson(rootRows)) throw fail('BAD_REQUEST', 'bad-params', 'the rows this decision would sign are not the rows the card shows (Aegis C1b)', { cardId });
      decisionRow = decisionRowV2({ cardId, cardKind: rootKindOf(String(card.kind), r.detail), decision, contentHash: card.contentHash, approver: ctx.principal, rootRows });
      // Aegis C6: the path comes from info.version ONLY; a decision.sign error on a >= 1.8.0 helper refuses, never falls back
      // Aegis F6: a client-supplied decisionSig (verified above) takes the ROOT-ONLY form: no approve message, the
      // presence and every root row still in the ONE touch
      batch = typeof this.#approvals.signDecisionBatch === 'function' && (await this.refreshHelperBatch()) === 'available';
    }

    // 4b. presence per class
    const isCli = ctx.credential !== 'gui'; // Aegis C1: the credential decides, never the self-declared surface
    const uk = unlockKeyOf(ctx); // F5: the GUI device's unlock (the connId for anything else)
    const live = (): void => {
      if (ctx.isLive && !ctx.isLive()) throw fail('ENGINE', 'gone', 'the connection closed during the decision', { cardId });
    };
    let presence: string;
    let token: PresenceToken | null = null;
    let helperCached = false;
    // F6 (#standing-grant): a live standing grant of THIS GUI device covering (card, decision) replaces the prompt.
    // Never for root class, a hand-only card or withdraw; the decisionSig is still the approvals key's (the helper
    // signs under the device's cached unlock, which the grant's touch kept; no unlock ⇒ the normal prompt below).
    let standing: StandingMatch | null = null;
    if (this.#standing && !isCli && cls !== 'root' && cls !== 'none' && !r.handOnly) {
      const m = this.#standing.match(ctx, card, decision, r.detail, r.ruleScope?.repoKey ?? null);
      if (m && !helperSigns) standing = m; // a client-supplied decisionSig was verified above
      else if (m && (await this.#useUnlock(uk, ctx.connId)) === 'ok') {
        try {
          decisionSig = (await this.#approvals.signDecision!({ connId: ctx.connId, unlockKey: uk, approver: ctx.principal, message, mode: 'cached' })).decisionSig;
          standing = m;
        } catch (err) {
          this.unlocks.drop(uk);
          await this.#dropHelperUnlock(uk);
          if (!(err instanceof HelperUnlockGone)) throw this.#helperFailure(err, cardId);
          await this.#droppedRow(uk, 'helper-lost');
        }
      }
    }
    // F6: the grant card's own touch keeps the device's unlock, so the standing uses it mints can be signed
    const keepForGrant = r.standingGrant === true;
    if (!standing && helperSigns && cls === 'cached' && !isCli && (await this.#useUnlock(uk, ctx.connId)) === 'ok') {
      try {
        decisionSig = (await this.#approvals.signDecision!({ connId: ctx.connId, unlockKey: uk, approver: ctx.principal, message, mode: 'cached' })).decisionSig;
        helperCached = true;
      } catch (err) {
        // the helper lost the unlock (exit, idle, screen lock): drop ours too and take fresh presence below
        if (!(err instanceof HelperUnlockGone)) {
          this.unlocks.drop(uk); // M3: a failed cached sign ends the unlock on both sides
          await this.#dropHelperUnlock(uk);
          throw this.#helperFailure(err, cardId);
        }
        this.unlocks.drop(uk);
        await this.#dropHelperUnlock(uk);
        await this.#droppedRow(uk, 'helper-lost');
      }
    }
    let rootSig: { signer: string; sig: string } | null = null;
    let rowSigs: Array<{ signer: string; sig: string }> | undefined;
    if (batch) {
      // TD-2026-10-20-514: ONE fresh prompt: decisionSig + presence + the decision row + every prepared row
      const hadUnlock = this.unlocks.has(uk);
      const prompt = this.#promptOf(r, decision, ctx, cls, prefix);
      let res: DecisionBatchResult;
      try {
        res = await this.#freshPrompt(ctx, cardId, () =>
          this.#approvals.signDecisionBatch!({ connId: ctx.connId, approver: ctx.principal, ...(helperSigns ? { message } : {}), prompt: prompt.text, presence: { purpose: r.presence?.purpose ?? 'approval.decide', binding: this.#binding(r, decision, digest) }, rows: [decisionRow!, ...(prepared?.rows ?? [])], intent: r.detail.rootRows as unknown[], root: this.#o.root ?? { rootKeyId: null, verifyRow: () => false } }),
        );
      } catch (err) {
        if (err instanceof HardwarePresenceDenied) throw await this.#presenceDenied(card, ctx, err.why, hadUnlock);
        if (err instanceof RootUnavailableError) throw err;
        throw this.#helperFailure(err, cardId);
      }
      if (!res.token || (helperSigns && res.decisionSig === null)) throw await this.#presenceDenied(card, ctx, 'no presence attestation', hadUnlock);
      token = res.token;
      if (helperSigns) decisionSig = res.decisionSig!; // the root-only form keeps the client's verified decisionSig
      presence = isCli ? 'cli' : 'fresh';
      if (!r.presence?.consumedByEffect) {
        const used = consumeBoundPresence(token, r.presence?.purpose ?? 'approval.decide', this.#binding(r, decision, digest));
        if (used !== 'ok') throw await this.#presenceDenied(card, ctx, `presence token ${used}`, hadUnlock);
      }
      rootSig = res.rootSigs[0]!;
      rowSigs = res.rootSigs.slice(1);
    } else if (standing) {
      presence = `standing:${standing.grantId}`;
    } else if (cls === 'none') {
      presence = 'fresh'; // unreachable in M1.6 (no held cards); withdraw takes no presence
    } else if (helperCached) {
      presence = 'cached';
    } else if (helperSigns) {
      const hadUnlock = this.unlocks.has(uk);
      const keep = (cls === 'cached' || keepForGrant) && !isCli;
      const prompt = this.#promptOf(r, decision, ctx, cls, prefix);
      let res: DecisionSignResult;
      try {
        res = await this.#freshPrompt(ctx, cardId, () => this.#approvals.signDecision!({ connId: ctx.connId, unlockKey: uk, approver: ctx.principal, message, mode: 'fresh', prompt: prompt.text, keepUnlock: keep, presence: { purpose: r.presence?.purpose ?? 'approval.decide', binding: this.#binding(r, decision, digest) } }));
      } catch (err) {
        // M3: a keep request that failed (timeout, refusal) may still have left an unlock in the helper
        if (keep && !this.unlocks.has(uk)) await this.#dropHelperUnlock(uk);
        if (err instanceof HardwarePresenceDenied) throw await this.#presenceDenied(card, ctx, err.why, hadUnlock);
        throw this.#helperFailure(err, cardId);
      }
      // M3: from here, any failure before the broker records the unlock drops the helper's copy too
      let recorded = !res.kept || this.unlocks.has(uk);
      try {
        if (!res.token) throw await this.#presenceDenied(card, ctx, 'no presence attestation', hadUnlock);
        token = res.token;
        decisionSig = res.decisionSig;
        presence = isCli ? 'cli' : 'fresh';
        if (!r.presence?.consumedByEffect) {
          const used = consumeBoundPresence(token, r.presence?.purpose ?? 'approval.decide', this.#binding(r, decision, digest));
          if (used !== 'ok') throw await this.#presenceDenied(card, ctx, `presence token ${used}`, hadUnlock);
        }
        if (keep && res.kept && !this.unlocks.has(uk)) {
          live();
          // F4: the helper's own bounds (1.7.0 reports them; an older helper is LEGACY_HELPER_BOUNDS) lower ours
          this.unlocks.open(uk, helperBoundsOf(res.bounds));
          this.#lastConn.set(uk, ctx.connId);
          recorded = true;
          await this.#o.log('approval.unlock', { connId: ctx.connId, cardId, ...(uk !== ctx.connId ? { scope: 'device' } : {}) }, { connId: ctx.connId });
        }
      } finally {
        if (!recorded) await this.#dropHelperUnlock(uk);
      }
    } else if (cls === 'cached' && !isCli && (await this.#useUnlock(uk, ctx.connId)) === 'ok') {
      presence = 'cached';
    } else {
      const hadUnlock = this.unlocks.has(uk);
      token = await this.#prove(r, decision, ctx, cls, hadUnlock, digest, prefix);
      presence = isCli ? 'cli' : 'fresh';
      if (!r.presence?.consumedByEffect) {
        const used = consumeBoundPresence(token, r.presence?.purpose ?? 'approval.decide', this.#binding(r, decision, digest));
        if (used !== 'ok') throw await this.#presenceDenied(card, ctx, `presence token ${used}`, hadUnlock);
      }
      if ((cls === 'cached' || keepForGrant) && !isCli && !this.unlocks.has(uk)) {
        live();
        this.unlocks.open(uk);
        this.#lastConn.set(uk, ctx.connId);
        await this.#o.log('approval.unlock', { connId: ctx.connId, cardId, ...(uk !== ctx.connId ? { scope: 'device' } : {}) }, { connId: ctx.connId });
      }
    }
    if (cls === 'root' && !batch) {
      // the legacy path (a helper < 1.8.0, a client-supplied decisionSig, a software root): the SAME prepared rows,
      // the same commit — only the signing step is one root signature per row (Aegis C6)
      const root = this.#o.root;
      if (!root) throw new RootUnavailableError(`the ${decision} decision`);
      try {
        const sign = async (row: unknown) => (root.signRowAsync ? await root.signRowAsync(row) : root.signRow(row));
        rootSig = await sign(decisionRow);
        rowSigs = [];
        for (const row of prepared?.rows ?? []) rowSigs.push(await sign(row));
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
    if (r.outcome || r.claim || r.card.state !== 'pending' || !isCardDecidable(r.card, decision)) throw fail('BAD_REQUEST', 'bad-params', `card ${cardId} is no longer pending`, { cardId, state: String(r.card.state) });
    // Aegis A3: claimed SYNCHRONOUSLY after the re-check — no expire() can interleave from here to the settle
    r.claim = decision;
    try {
      await this.#decideAndApply(r, ctx, p, { prefix, cardId, decision, decisionSig, presence, via, cli, prov, cls, isCli, token, rootSig, card, standing, ...(rowSigs ? { rowSigs } : {}), ...(prepared ? { prepared } : {}), ...(decisionRow ? { decisionRow } : {}) });
    } catch (err) {
      delete r.claim; // the row or the effect failed: the card stays pending (approval.decide is a record, never authority)
      throw err;
    }
    if (typeof p.note === 'string' && p.note) r.note = p.note;
    r.card = { ...card, state: 'decided', decidedBy: ctx.principal, decidedAt: new Date(now).toISOString(), decisionSig, presence: presence as CardV1['presence'], via, cli };
    delete r.claim;
    this.#settle(r, decision);
    return r.card;
    } finally {
      prepared?.release();
    }
  }

  async #decideAndApply(
    r: CardRecord,
    ctx: DecideContext,
    p: Record<string, unknown>,
    d: { prefix: string[] | null; cardId: string; decision: string; decisionSig: string; presence: string; via: string; cli: unknown; prov: CliProvenance | null; cls: DecisionClass; isCli: boolean; token: PresenceToken | null; rootSig: { signer: string; sig: string } | null; card: CardV1; standing: StandingMatch | null; rowSigs?: Array<{ signer: string; sig: string }>; prepared?: PreparedRows; decisionRow?: DecisionRowV2 },
  ): Promise<void> {
    const { prefix, cardId, decision, decisionSig, presence, via, cli, prov, cls, isCli, token, rootSig, card, standing, rowSigs, prepared, decisionRow } = d;
    await this.#o.log(
      'approval.decide',
      { cardId, decision, by: ctx.principal, decisionSig, presence, via, connId: ctx.connId, cli, contentHash: card.contentHash, ...(prefix ? { scope: { kind: 'prefix', prefix } } : {}), ...(rootSig ? { rootSig } : {}), ...(decisionRow ? { rowsDigest: decisionRow.rowsDigest, rootKind: decisionRow.cardKind } : {}), ...(p.note ? (r.privateNote ? { noteHash: `sha256:${createHash('sha256').update(String(p.note), 'utf8').digest('hex')}`, noteBytes: Buffer.byteLength(String(p.note), 'utf8') } : { note: p.note }) : {}) },
      { connId: ctx.connId, ...(card.hsid ? { session: card.hsid } : {}) },
    );
    // F6: the notify row of a standing use, right after the record it notifies about (the GUI's feed + Revoke)
    if (standing && this.#standing) await this.#standing.used(standing, { cardId, decision, hsid: card.hsid ?? null, connId: ctx.connId });
    if (decision === 'always') {
      const match = prefix ? { match: 'prefix', prefix } : { matchExact: true };
      await this.#o.log('approval.rule.learned', { cardId, tool: r.tool ?? null, ...match, presence, repoKey: r.ruleScope?.repoKey ?? null }, { connId: ctx.connId });
    }
    for (const why of this.#suspicions(ctx, isCli, prov, presence, cls)) {
      await this.#o.log('approval.suspect', { cardId, connId: ctx.connId, why, provenance: cli }, { connId: ctx.connId });
    }
    if (r.effect) {
      try {
        await r.effect(decision, { token, rootSig, connId: ctx.connId, decisionSig, presence, ...(rowSigs ? { rowSigs } : {}), ...(prepared ? { prepared } : {}) });
      } catch (err) {
        // P8-D98 (slice A2): the honest kind, exactly one row, no suspect row; the card stays pending (approve's catch)
        await this.#o.log('approval.effect.failed', { cardId, decision, effect: effectNameOf(card), reason: effectFailureReason(err) }, { connId: ctx.connId, ...(card.hsid ? { session: card.hsid } : {}) }).catch(() => undefined);
        throw err;
      }
    }
  }

  /** Use the unlock under `key` (F5: the GUI device's); an ended one (idle | expired | exhausted, M2) is dropped on both sides and logged approval.unlock.dropped{reason}. */
  async #useUnlock(key: string, connId: string): Promise<UnlockUse> {
    const u = this.unlocks.use(key);
    if (u === 'ok') {
      // Aegis M1: a NEW connection of the device joins its unlock — a kernel row, shown in the GUI notify feed
      const last = this.#lastConn.get(key);
      if (key.startsWith('udev:') && last !== undefined && last !== connId && !this.#joined.get(key)?.has(connId)) {
        let set = this.#joined.get(key);
        if (!set) this.#joined.set(key, (set = new Set()));
        set.add(connId);
        await this.#o.log('approval.unlock.joined', { connId, scope: 'device' }, CONN_ID.test(connId) ? { connId } : {});
      }
      this.#lastConn.set(key, connId);
    }
    if (u !== 'ok' && u !== 'none') {
      await this.#dropHelperUnlock(key); // M3: an unlock that ended here ends in the helper too
      await this.#droppedRow(key, u);
    }
    return u;
  }

  /** status.guiSessions[].unlock (§5) for a GUI connection: its device's unlock (F5), else its own. */
  unlockStateFor(connId: string, deviceId?: string): { state: 'cached'; idleLeftMs: number } | null {
    return this.unlocks.state(unlockKeyOf({ connId, credential: 'gui', ...(deviceId ? { deviceId } : {}) }));
  }

  /** The presence binding; an answer (v2) adds its answerDigest, so the token binds the text too (P8-D98). */
  #binding(r: CardRecord, decision: string, digest: BindingExtra | undefined): PresenceBinding {
    const b = r.presence ? r.presence.binding(decision) : { action: 'approval.decide', cardId: r.card.cardId, contentHash: r.card.contentHash, decision };
    return digest ? { ...b, ...digest } : b;
  }

  /** Expected binding digest for a decision (tests: mint a token bound to it). */
  bindingFor(cardId: string, decision: string, answer?: string, prefix?: readonly string[]): { purpose: PresencePurpose; binding: PresenceBinding; digest: string } {
    const digest: BindingExtra | undefined = usesDecisionV2(decision) && answer !== undefined ? { answerDigest: answerDigest(answer) } : decision === 'always' && prefix ? { scopeDigest: scopeDigest({ kind: 'prefix', prefix: [...prefix] }) } : undefined;
    const r = this.#cards.get(cardId);
    if (!r) throw fail('NOT_FOUND', 'not-found', `no card ${cardId}`);
    const binding = this.#binding(r, decision, digest);
    return { purpose: r.presence?.purpose ?? 'approval.decide', binding, digest: presenceBindingDigest(binding) };
  }

  /** The kernel-signed prompt for (card, decision) on this connection. */
  #promptOf(r: CardRecord, decision: string, ctx: DecideContext, cls: DecisionClass, prefix: readonly string[] | null = null): SignedPresencePrompt {
    const reason =
      decision === 'always' && prefix
        ? `fresh presence: always allow Bash commands whose words start ${shownPrefixWords(prefix)} (${prefix.length} words) in this repo`
        : decision === 'always'
        ? 'fresh presence: always is a standing rule'
        : cls === 'root'
          ? 'fresh presence and the root key'
          : cls === 'cached'
            ? 'presence unlocks this device until the screen locks (12 h at most)'
            : `fresh presence: ${String(r.card.kind)}`;
    return composePresencePrompt(this.#o.kernel, r.card, { decision, connId: ctx.connId, guiSessions: this.#o.guiSessions?.() ?? 0, reason });
  }

  /** A helper that is missing, unsigned, exited or answering nonsense: UNSUPPORTED presence (fail closed, no software fallback). */
  #helperFailure(err: unknown, cardId: string): RefusedError {
    if (err instanceof RefusedError) return err;
    void this.#o.log('approval.presence.denied', { cardId, why: 'unavailable', milestone: 'M1.3' }).catch(() => undefined);
    return fail('UNSUPPORTED', 'presence', `the signed helper could not sign the decision (${err instanceof Error ? err.message.slice(0, 160) : 'helper error'}); there is no software fallback`, { cardId });
  }

  async #prove(r: CardRecord, decision: string, ctx: DecideContext, cls: DecisionClass, hadUnlock: boolean, digest: BindingExtra | undefined, prefix: readonly string[] | null = null): Promise<PresenceToken> {
    // Aegis M1: the same prompt as the helper path, so a prefix always shows its words quoted and escaped
    const prompt = this.#promptOf(r, decision, ctx, cls, prefix);
    const purpose = r.presence?.purpose ?? 'approval.decide';
    const binding = this.#binding(r, decision, digest);
    let token: PresenceToken;
    try {
      token = await this.#freshPrompt(ctx, r.card.cardId, () => this.#presence.prove({ purpose, binding, prompt, connId: ctx.connId }));
    } catch (err) {
      if (err instanceof PromptRateLimited) throw err; // L2: nothing was shown
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

  /**
   * L2: raise ONE fresh prompt on `ctx.connId` through `show`. Refused (before anything is shown) while
   * another is outstanding on the connection, or inside the cooldown after an unproved one.
   */
  async #freshPrompt<T>(ctx: DecideContext, cardId: string, show: () => Promise<T>): Promise<T> {
    const conn = ctx.connId;
    if (this.#prompting.has(conn)) {
      await this.#o.log('approval.presence.denied', { cardId, connId: conn, why: 'prompt-outstanding' }, { connId: conn }).catch(() => undefined);
      const f = fail('FORBIDDEN', 'presence', 'a presence prompt is already open on this connection; answer it first', { cardId, why: 'prompt-outstanding' });
      throw new PromptRateLimited(f.refusal, f.message);
    }
    const from = this.#cooldownFrom.get(conn);
    const left = from === undefined ? 0 : PROMPT_COOLDOWN_MS - (this.#mono() - from);
    if (left > 0) {
      await this.#o.log('approval.presence.denied', { cardId, connId: conn, why: 'prompt-cooldown' }, { connId: conn }).catch(() => undefined);
      const f = fail('FORBIDDEN', 'presence', `the last presence prompt on this connection was not proved; wait ${Math.ceil(left / 1000)} s`, { cardId, why: 'prompt-cooldown', retryAfterMs: Math.ceil(left) });
      throw new PromptRateLimited(f.refusal, f.message);
    }
    this.#cooldownFrom.delete(conn);
    this.#prompting.add(conn);
    try {
      const out = await show();
      return out;
    } catch (err) {
      // only a prompt the human was shown and did not prove starts the cooldown (never an unavailable helper)
      if (err instanceof PresenceDenied || err instanceof HardwarePresenceDenied) this.#cooldownFrom.set(conn, this.#mono());
      throw err;
    } finally {
      this.#prompting.delete(conn);
    }
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

  /**
   * status.cards (F4: status is the man page, scoped by class). The human —
   * the only class that decides — gets the full inbox: `pendingForYou` and
   * the inbox by kind. Every other class gets counts only (`n`, `held`): what
   * is being asked of the human, and by which kind, is not theirs to see
   * (Aegis low, M1.6 slice 1).
   */
  status(forHuman: boolean): { n: number; pendingForYou: number; held: number; byKind?: Record<string, number> } {
    const all = this.cards();
    const held = all.filter((c) => c.state === 'held').length;
    if (!forHuman) return { n: this.#cards.size, pendingForYou: 0, held };
    const pending = all.filter((c) => c.state === 'pending');
    const byKind: Record<string, number> = {};
    for (const c of pending) byKind[String(c.kind)] = (byKind[String(c.kind)] ?? 0) + 1;
    return { n: this.#cards.size, pendingForYou: pending.length, held, byKind };
  }
}
