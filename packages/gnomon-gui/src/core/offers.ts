/**
 * @symbol #gui-offer-slip
 *
 * The Desk's margin slip (TD-2026-10-20-812 O1; Luna's comp .atelier/sessions/2026-10-20-gnomon-mod-invitations,
 * refs/flow.html). PURE: the slip model, folded from the kernel's offer rows of ONE conversation (hsid).
 *
 *   - A slip exists only because the kernel wrote `offer.shown` (the #offer-router disposed the model's ```offer
 *     block). It is NEVER derived from reply text: a reply that merely contains an offer block shows no slip.
 *     Every offer row must come from the kernel principal (`p:<ns>/kernel`) and name this conversation's hsid.
 *   - It is mounted under the reply that offered: the last assistant item before the offer.shown row (its
 *     `replyTurnId` must name the same hsid).
 *   - Live only on the latest reply: inert once the human sends anything after it or a newer reply lands, and
 *     only the newest open slip is live. A composer draft is never read or written by a slip.
 *   - Two-step open (A5): the first trusted click / ↵ ARMS the slip (it then shows `takes: <contextIn> · ↵ to open`,
 *     the contextIn tokens the KERNEL copied from the mod's manifest onto offer.shown, never model text), the second
 *     trusted gesture sends `log.append{kind:'request.offer.decide', payload:{offerId, decision:'open'}}`. Aegis M1:
 *     a key repeat or a multi-click (detail > 1) is never a gesture; the send needs >= OFFER_ARM_GAP_MS after the
 *     arm; an arm older than OFFER_ARM_TTL_MS is gone (the next press arms again).
 *   - "not now" sends `{decision:'not-now'}`; folding `offer.decided{not-now}` quiets that mod's later slips for the
 *     rest of the conversation (L4); `stop-here` quiets every later slip. Folding any offer.decided closes the slip.
 *   - Voice (L1): dismiss only. Aegis M2 (TD-2026-10-20-125): only a forwardable, non-intercepted PUSH-TO-TALK row
 *     saying "not now" dismisses, and only the slip that was live when that row arrived; ambient speech only shows
 *     "click not now to dismiss". A heard "open" only shows "click or ↵ to open".
 */

import {
  CONTEXT_SOURCES,
  HSID_PATTERN,
  OFFER_DECISIONS,
  OFFER_ID_PATTERN,
  OFFER_MOD_PATTERN,
  OFFER_PHASES,
  OFFER_TOKEN_PATTERN,
  TURN_ID_PATTERN,
  isOfferQuestion,
  isOfferTitle,
  offerBlockOf,
  type ContextSource,
  type OfferDecision,
  type OfferPhase,
} from '@a-company/gnomon-contracts';
import { pttTurn } from './dictation.js';
import { modLabel, type PublisherDisplay } from './mod-label.js';

export { modLabel } from './mod-label.js';

export { OFFER_DECISIONS, type OfferDecision };

/** contracts KIND_PAYLOADS['offer.shown'] (the kernel's row; shownOf validates every field before a slip exists). */
export interface OfferShown {
  offerId: string;
  hsid: string;
  mod: string;
  kind: string;
  phase: OfferPhase;
  title: string;
  question: string;
  replyTurnId: string;
  /** kernel-copied from the manifest; null: the row carries none (an older kernel) => "takes: unknown" */
  contextIn: string[] | null;
}
/** How the slip names each contracts CONTEXT_SOURCES token; a token outside it shows as unknown. */
export const CONTEXT_SOURCE_LABELS: Readonly<Record<ContextSource, string>> = Object.freeze({
  'recent-messages': 'recent messages',
  'open-files': 'open files',
  'repo-path': 'the repo path',
  selection: 'the selection',
  'session-summary': 'a session summary',
});
const isContextSource = (t: string): t is ContextSource => (CONTEXT_SOURCES as readonly string[]).includes(t);
/** Aegis M1: the send needs this long after the arm; an arm older than the TTL is dropped. */
export const OFFER_ARM_GAP_MS = 400;
export const OFFER_ARM_TTL_MS = 15_000;
const CONTEXT_SHOWN_MAX = 8;
/** contracts KIND_PAYLOADS['offer.decided']. */
export interface OfferDecided {
  offerId: string;
  hsid: string;
  decision: OfferDecision;
}
/** contracts KIND_PAYLOADS['offer.kept']. */
export interface OfferKept {
  offerId: string;
  hsid: string;
  mod: string;
  tool: string;
}
/** contracts KIND_PAYLOADS['request.offer.decide']. */
export interface OfferDecideRequest {
  kind: 'request.offer.decide';
  payload: { offerId: string; decision: OfferDecision };
}
/** The offer row kinds a store folds. */
export const OFFER_ROW_KINDS: ReadonlySet<string> = new Set(['offer.shown', 'offer.decided', 'offer.kept', 'offer.retired']);

const KERNEL = /^p:[0-9a-z]{8}\/kernel$/;
const VOICE = /^p:[0-9a-z]{8}\/voice$/;

export interface OfferRow {
  seq: number;
  kind: string;
  principal?: string;
  session?: string;
  payload?: unknown;
}

export interface Slip extends OfferShown {
  /** the offer.shown row's seq (the slip mounts under the last assistant item before it) */
  seq: number;
  decided: OfferDecision | null;
  kept: boolean;
  /** re-review M-2: the kernel's offer.retired (the reply it answered continued): closed, never live, a trace only */
  retired: boolean;
  /** shown after a not-now for this mod (or a stop-here): never drawn (L4) */
  quiet: boolean;
  /** a heard "open" after it: show the hint (L1) */
  openHint: boolean;
  /** ambient speech said "not now": show "click not now to dismiss", send nothing (M2) */
  ambientHint: boolean;
  /** a heard "not now" after it (seq of the voice row), for the page's one dismissal request */
  voiceDismiss: number | null;
}

export interface OfferBook {
  slips: Slip[];
  /** mods quieted for this conversation (L4) */
  muted: Set<string>;
  /** a stop-here: every later slip is quiet */
  stopped: boolean;
}

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** A validated offer.shown payload for this hsid, or null (anything off ⇒ no slip). */
export function shownOf(r: OfferRow, hsid: string): OfferShown | null {
  if (r.kind !== 'offer.shown' || typeof r.principal !== 'string' || !KERNEL.test(r.principal)) return null;
  const p = obj(r.payload);
  if (!p || p.hsid !== hsid) return null;
  const { offerId, mod, kind, phase, title, question, replyTurnId } = p;
  if (typeof offerId !== 'string' || !OFFER_ID_PATTERN.test(offerId) || !HSID_PATTERN.test(hsid)) return null;
  if (typeof mod !== 'string' || !OFFER_MOD_PATTERN.test(mod) || typeof kind !== 'string' || !OFFER_TOKEN_PATTERN.test(kind)) return null;
  if (!(OFFER_PHASES as readonly unknown[]).includes(phase)) return null;
  if (!isOfferTitle(title) || !isOfferQuestion(question)) return null;
  const t = typeof replyTurnId === 'string' ? TURN_ID_PATTERN.exec(replyTurnId) : null;
  if (!t || t[1] !== hsid) return null;
  let contextIn: string[] | null = null;
  if (Array.isArray(p.contextIn)) contextIn = p.contextIn.slice(0, 64).map((t) => (typeof t === 'string' && OFFER_TOKEN_PATTERN.test(t) ? t : '?'));
  return { offerId, hsid, mod, kind, phase: phase as OfferPhase, title, question, replyTurnId: replyTurnId as string, contextIn };
}

/** What a heard utterance means to a live slip (L1): `dismiss` ("not now", "no thanks", "dismiss"), `open-hint`
 * ("open", "open it", "yes open"), else null. Voice never opens. */
export function voiceOfferIntent(text: string): 'dismiss' | 'open-hint' | null {
  const t = text.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(?:not now|no thanks|no thank you|dismiss|dismiss it|not right now)$/.test(t)) return 'dismiss';
  if (/^(?:open|open it|open that|yes open|yes open it|go ahead and open it)$/.test(t)) return 'open-hint';
  return null;
}

/** Aegis M2: a dismissing voice row is a forwardable, non-intercepted push-to-talk turn (dictation.ts pttTurn). */
export function pttDismissable(payload: unknown): boolean {
  const p = obj(payload);
  if (!p || !pttTurn(p) || p.forwardable !== true || p.partial === true) return false;
  return p.intercepted === undefined || p.intercepted === null || p.intercepted === false;
}

/** A row that ends a reply's liveness: a human message (typed, replayed or sent) or a newer reply with text. */
function turnActivity(r: OfferRow & { connId?: string }): boolean {
  if (r.connId === 'local' && r.kind === 'composer') return true;
  if (r.kind === 'turn.sent') return true;
  if (r.kind !== 'turn.event') return false;
  const p = obj(r.payload);
  if (typeof p?.line !== 'string') return false;
  try {
    const m = obj(obj(JSON.parse(p.line))?.message);
    const c = m?.content;
    return (m?.role === 'assistant' || m?.role === 'user') && (typeof c === 'string' ? c.trim().length > 0 : Array.isArray(c) && c.some((x) => obj(x)?.type === 'text'));
  } catch {
    return false;
  }
}

/** Fold a conversation's rows (seq order) into its slips. */
export function foldOffers(rows: readonly OfferRow[], hsid: string): OfferBook {
  const book: OfferBook = { slips: [], muted: new Set(), stopped: false };
  const byId = new Map<string, Slip>();
  let live: Slip | null = null; // the slip live as of the row being folded (M2: a voice row acts only on it)
  for (const r of rows) {
    if (turnActivity(r)) live = null;
    if (r.kind === 'offer.shown') {
      const s = shownOf(r, hsid);
      if (!s || byId.has(s.offerId)) continue;
      const slip: Slip = { ...s, seq: r.seq, decided: null, kept: false, retired: false, quiet: book.stopped || book.muted.has(s.mod), openHint: false, ambientHint: false, voiceDismiss: null };
      byId.set(s.offerId, slip);
      book.slips.push(slip);
      if (!slip.quiet) live = slip;
    } else if (r.kind === 'offer.decided' || r.kind === 'offer.kept') {
      if (typeof r.principal !== 'string' || !KERNEL.test(r.principal)) continue;
      const p = obj(r.payload);
      if (!p || p.hsid !== hsid || typeof p.offerId !== 'string') continue;
      const slip = byId.get(p.offerId);
      if (!slip) continue;
      if (r.kind === 'offer.kept') {
        slip.kept = true;
        continue;
      }
      if (slip.decided !== null || !(OFFER_DECISIONS as readonly unknown[]).includes(p.decision)) continue;
      slip.decided = p.decision as OfferDecision;
      if (live === slip) live = null;
      if (slip.decided === 'not-now') book.muted.add(slip.mod);
      if (slip.decided === 'stop-here') book.stopped = true;
    } else if (r.kind === 'offer.retired') {
      // re-review M-2: a continuation retired an undecided offer: the slip closes and leaves a "retired" trace
      if (typeof r.principal !== 'string' || !KERNEL.test(r.principal)) continue;
      const p = obj(r.payload);
      if (!p || p.hsid !== hsid || typeof p.offerId !== 'string' || p.why !== 'continued') continue;
      const slip = byId.get(p.offerId);
      if (!slip || slip.decided !== null) continue;
      slip.retired = true;
      if (live === slip) live = null;
    } else if (r.kind === 'voice.turn.user') {
      const p = obj(r.payload);
      if (!p || p.partial === true || typeof p.text !== 'string' || typeof r.principal !== 'string' || !VOICE.test(r.principal)) continue;
      const open = live;
      if (!open || open.decided !== null || open.retired) continue;
      const intent = voiceOfferIntent(p.text);
      if (intent === 'dismiss') {
        if (pttDismissable(p)) {
          if (open.voiceDismiss === null) open.voiceDismiss = r.seq;
        } else open.ambientHint = true; // TD-2026-10-20-125: ambient speech never acts
      }
      if (intent === 'open-hint') open.openHint = true;
    }
  }
  return book;
}

/** The transcript items the slips anchor to (store.ts ChatItem's shape). */
export interface AnchorItem {
  key: string;
  seq: number;
  role: string;
}

export interface SlipView {
  slip: Slip;
  /** the reply item it mounts under */
  itemKey: string;
  live: boolean;
}

/**
 * Where each drawn slip mounts and which one is live. A quiet slip, or one with no assistant item before it, is not
 * drawn. Live: undecided, the newest drawn slip, its reply is the LAST assistant item, and no user item follows it.
 */
export function slipViews(book: OfferBook, items: readonly AnchorItem[]): SlipView[] {
  const out: SlipView[] = [];
  for (const slip of book.slips) {
    if (slip.quiet) continue;
    let anchor: AnchorItem | null = null;
    for (const it of items) {
      if (it.seq >= slip.seq) break;
      if (it.role === 'assistant') anchor = it;
    }
    if (anchor) out.push({ slip, itemKey: anchor.key, live: false });
  }
  const last = out[out.length - 1];
  if (last && last.slip.decided === null && !last.slip.retired) {
    let lastReply: AnchorItem | null = null;
    let userAfter = false;
    for (const it of items) {
      if (it.role === 'assistant') {
        lastReply = it;
        userAfter = false;
      } else if (it.role === 'user' && lastReply) userAfter = true;
    }
    if (lastReply && lastReply.key === last.itemKey && !userAfter) last.live = true;
  }
  return out;
}

/** The "takes:" line, from the offer.shown row's kernel-copied contextIn (never model text). A token outside
 * the contracts CONTEXT_SOURCES shows as "unknown"; past 8, "+N more"; no contextIn on the row => "unknown (not reported ...)". */
export function takesLine(contextIn: readonly string[] | null): string {
  if (contextIn === null) return 'takes: unknown (not reported by the kernel) · ↵ to open';
  const words = contextIn.map((t) => (isContextSource(t) ? CONTEXT_SOURCE_LABELS[t] : 'unknown'));
  const shown = words.slice(0, CONTEXT_SHOWN_MAX);
  const more = words.length - shown.length;
  return `takes: ${shown.length ? shown.join(' · ') : 'nothing'}${more > 0 ? ` · +${more} more` : ''} · ↵ to open`;
}

export type OpenStep = 'refused' | 'armed' | 'wait' | 'send';
/** The page's arm: which slip and when (ms). */
export interface OfferArm {
  offerId: string;
  at: number;
}
/** A press as openStep sees it: trust, and the repeat / multi-click marks (Aegis M1). */
export interface OpenGesture {
  isTrusted: boolean;
  /** KeyboardEvent.repeat */
  repeat?: boolean;
  /** MouseEvent.detail (2 = the second click of a double-click) */
  detail?: number;
}

/** Is the arm still standing at `now` (same slip, younger than the TTL)? */
export function armStanding(arm: OfferArm | null, offerId: string, now: number): boolean {
  return arm !== null && arm.offerId === offerId && now - arm.at >= 0 && now - arm.at <= OFFER_ARM_TTL_MS;
}

/**
 * A press of Open (click or ↵ on the slip). Untrusted, a key repeat, a multi-click, or not the live slip => refused.
 * No standing arm => armed. Armed less than OFFER_ARM_GAP_MS ago => wait (nothing sent, the arm stays). Else send.
 */
export function openStep(e: OpenGesture, offerId: string, liveOfferId: string | null, arm: OfferArm | null, now: number): OpenStep {
  if (!e.isTrusted || e.repeat === true || (typeof e.detail === 'number' && e.detail > 1)) return 'refused';
  if (liveOfferId === null || offerId !== liveOfferId) return 'refused';
  if (!armStanding(arm, offerId, now)) return 'armed';
  return now - arm!.at < OFFER_ARM_GAP_MS ? 'wait' : 'send';
}

/** The one request a slip decision sends. */
export function decideRequest(offerId: string, decision: OfferDecision): OfferDecideRequest {
  return { kind: 'request.offer.decide', payload: { offerId, decision } };
}

/** A closed slip's trace text (the comp's `.slip.gone`). */
export function traceText(s: Pick<Slip, 'decided' | 'mod' | 'kept'> & { retired?: boolean }, pd?: PublisherDisplay | null): string {
  const label = modLabel(s.mod, pd);
  if (s.decided === null && s.retired === true) return `retired · the reply continued · mod:${label}`;
  if (s.decided === 'open') return `${s.kept ? 'kept in' : 'opened'} mod:${label}`;
  if (s.decided === 'stop-here') return `offers off in this thread · mod:${label}`;
  if (s.decided === 'not-now') return `not now · mod:${label}`;
  return `offer · mod:${label}`;
}

/** The reply items stripOfferBlocks rewrites (store.ts ChatItem's shape). */
export interface ReplyItem extends AnchorItem {
  text: string;
}

/**
 * The reply text the transcript renders. A reply's trailing ```offer block is hidden ONLY when the kernel wrote a
 * valid `offer.shown` for that reply (kernel principal, the row's own hsid, the slip's anchor = the last assistant
 * item before the row) and the block names the same mod and kind; the text then becomes contracts
 * `offerBlockOf(text).body`. No kernel row, or a block that does not match it, and the text shows as-is: model text
 * alone never hides anything.
 */
export function stripOfferBlocks<T extends ReplyItem>(items: readonly T[], rows: readonly OfferRow[]): T[] {
  const strip = new Map<string, { mod: string; kind: string }>();
  for (const r of rows) {
    if (r.kind !== 'offer.shown') continue;
    const h = obj(r.payload)?.hsid;
    if (typeof h !== 'string' || (r.session !== undefined && r.session !== h)) continue;
    const s = shownOf(r, h);
    if (!s) continue;
    let anchor: T | null = null;
    for (const it of items) {
      if (it.seq >= r.seq) break;
      if (it.role === 'assistant') anchor = it;
    }
    if (anchor && !strip.has(anchor.key)) strip.set(anchor.key, { mod: s.mod, kind: s.kind });
  }
  if (!strip.size) return items as T[];
  return items.map((it) => {
    const want = strip.get(it.key);
    if (!want) return it;
    const b = offerBlockOf(it.text);
    if (!b || b.offer.mod !== want.mod || b.offer.kind !== want.kind) return it;
    return { ...it, text: b.body.trimEnd() };
  });
}
