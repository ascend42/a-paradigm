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
 *     the contextIn tokens from the mod's manifest offer, never from the model), the second trusted gesture sends
 *     `log.append{kind:'request.offer.decide', payload:{offerId, decision:'open'}}`.
 *   - "not now" sends `{decision:'not-now'}`; folding `offer.decided{not-now}` quiets that mod's later slips for the
 *     rest of the conversation (L4); `stop-here` quiets every later slip. Folding any offer.decided closes the slip.
 *   - Voice (L1): dismiss only. A heard "not now" may dismiss the live slip; a heard "open" only shows a hint.
 */

/* TODO(S0 integration): switch these to the @a-company/gnomon-contracts imports (OFFER_DECISIONS, OfferDecision,
 * the offer.shown / offer.decided / offer.kept payloads and request.offer.decide) once the S0 contracts slice lands
 * on feat/gnomon. They mirror packages/gnomon-contracts/src/event.ts KIND_PAYLOADS exactly. */
export const OFFER_DECISIONS = ['open', 'not-now', 'stop-here'] as const;
export type OfferDecision = (typeof OFFER_DECISIONS)[number];
/** TODO(S0 integration): contracts `offer.shown` payload. */
export interface OfferShown {
  offerId: string;
  hsid: string;
  mod: string;
  kind: string;
  phase: string;
  title: string;
  question: string;
  replyTurnId: string;
}
/** TODO(S0 integration): contracts `offer.decided` payload. */
export interface OfferDecided {
  offerId: string;
  hsid: string;
  decision: OfferDecision;
}
/** TODO(S0 integration): contracts `offer.kept` payload. */
export interface OfferKept {
  offerId: string;
  hsid: string;
  mod: string;
  tool: string;
}
/** TODO(S0 integration): contracts `request.offer.decide` payload. */
export interface OfferDecideRequest {
  kind: 'request.offer.decide';
  payload: { offerId: string; decision: OfferDecision };
}
/** The offer row kinds a store folds (TODO(S0 integration): the contracts registry has them). */
export const OFFER_ROW_KINDS: ReadonlySet<string> = new Set(['offer.shown', 'offer.decided', 'offer.kept']);

// TODO(S0 integration): contracts OFFER_ID_PATTERN / OFFER_MOD_PATTERN / OFFER_TOKEN_PATTERN / OFFER_QUESTION_MAX
const OFFER_ID = /^offer:[0-9A-HJKMNP-TV-Z]{26}$/;
const MOD = /^[a-z][a-z0-9-]{0,63}$/;
const TOKEN = /^[a-z][a-z0-9-]{0,63}$/;
const TURN_ID = /^turn:(hsid:[a-z0-9]+:[0-9A-Za-z]+)\/([1-9][0-9]*)$/;
export const OFFER_QUESTION_MAX = 240;
// eslint-disable-next-line no-control-regex
const UNSAFE_TEXT = /[\u0000-\u001F\u007F-\u009F\p{Zl}\p{Zp}\p{Cf}]/u;
const KERNEL = /^p:[0-9a-z]{8}\/kernel$/;
const VOICE = /^p:[0-9a-z]{8}\/voice$/;

/** A single-line model text the slip may show: 1..max code points, no control/format/separator, no edge space. */
export function isOfferText(v: unknown, max: number): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > max * 2) return false;
  if (UNSAFE_TEXT.test(v) || v.trim() !== v) return false;
  return Array.from(v).length <= max;
}

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
  /** shown after a not-now for this mod (or a stop-here): never drawn (L4) */
  quiet: boolean;
  /** a heard "open" after it: show the hint (L1) */
  openHint: boolean;
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
  if (typeof offerId !== 'string' || !OFFER_ID.test(offerId)) return null;
  if (typeof mod !== 'string' || !MOD.test(mod) || typeof kind !== 'string' || !TOKEN.test(kind) || typeof phase !== 'string' || !TOKEN.test(phase)) return null;
  if (!isOfferText(title, 60) || !isOfferText(question, OFFER_QUESTION_MAX)) return null;
  const t = typeof replyTurnId === 'string' ? TURN_ID.exec(replyTurnId) : null;
  if (!t || t[1] !== hsid) return null;
  return { offerId, hsid, mod, kind, phase, title, question, replyTurnId: replyTurnId as string };
}

/** What a heard utterance means to a live slip (L1): `dismiss` ("not now", "no thanks", "dismiss"), `open-hint`
 * ("open", "open it", "yes open"), else null. Voice never opens. */
export function voiceOfferIntent(text: string): 'dismiss' | 'open-hint' | null {
  const t = text.toLowerCase().replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (/^(?:not now|no thanks|no thank you|dismiss|dismiss it|not right now)$/.test(t)) return 'dismiss';
  if (/^(?:open|open it|open that|yes open|yes open it|go ahead and open it)$/.test(t)) return 'open-hint';
  return null;
}

/** Fold a conversation's rows (seq order) into its slips. */
export function foldOffers(rows: readonly OfferRow[], hsid: string): OfferBook {
  const book: OfferBook = { slips: [], muted: new Set(), stopped: false };
  const byId = new Map<string, Slip>();
  for (const r of rows) {
    if (r.kind === 'offer.shown') {
      const s = shownOf(r, hsid);
      if (!s || byId.has(s.offerId)) continue;
      const slip: Slip = { ...s, seq: r.seq, decided: null, kept: false, quiet: book.stopped || book.muted.has(s.mod), openHint: false, voiceDismiss: null };
      byId.set(s.offerId, slip);
      book.slips.push(slip);
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
      if (slip.decided === 'not-now') book.muted.add(slip.mod);
      if (slip.decided === 'stop-here') book.stopped = true;
    } else if (r.kind === 'voice.turn.user') {
      const p = obj(r.payload);
      if (!p || p.partial === true || typeof p.text !== 'string' || typeof r.principal !== 'string' || !VOICE.test(r.principal)) continue;
      const open = [...book.slips].reverse().find((s) => s.decided === null && !s.quiet);
      if (!open) continue;
      const intent = voiceOfferIntent(p.text);
      if (intent === 'dismiss' && open.voiceDismiss === null) open.voiceDismiss = r.seq;
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
  if (last && last.slip.decided === null) {
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

/** The "takes:" line: the manifest offer's contextIn tokens (never model text); undeclared ⇒ said so. */
export function takesLine(contextIn: readonly string[] | null): string {
  const toks = (contextIn ?? []).filter((t) => TOKEN.test(t)).map((t) => t.replace(/-/g, ' '));
  return `takes: ${toks.length ? toks.join(' · ') : 'nothing declared by the mod'} · ↵ to open`;
}

/**
 * The manifest offers the kernel reports (`status.mods.offers: [{mod, kind, contextIn[]}]`), keyed `mod/kind`.
 * TODO(S0/#mod-host integration): the kernel's status field name is assumed here; align it when the host reports it.
 */
export function offerSpecsOf(status: unknown): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const mods = obj(obj(status)?.mods);
  const list = mods?.offers;
  if (!Array.isArray(list)) return out;
  for (const o of list.slice(0, 256)) {
    const x = obj(o);
    if (!x || typeof x.mod !== 'string' || !MOD.test(x.mod) || typeof x.kind !== 'string' || !TOKEN.test(x.kind) || !Array.isArray(x.contextIn)) continue;
    out.set(`${x.mod}/${x.kind}`, x.contextIn.filter((t): t is string => typeof t === 'string' && TOKEN.test(t)).slice(0, 8));
  }
  return out;
}

export type OpenStep = 'refused' | 'armed' | 'send';

/** A press of Open (click or ↵ on the slip). Untrusted, or not the live slip ⇒ refused; first ⇒ armed; armed ⇒ send. */
export function openStep(e: { isTrusted: boolean }, offerId: string, liveOfferId: string | null, armed: string | null): OpenStep {
  if (!e.isTrusted || liveOfferId === null || offerId !== liveOfferId) return 'refused';
  return armed === offerId ? 'send' : 'armed';
}

/** The one request a slip decision sends. */
export function decideRequest(offerId: string, decision: OfferDecision): OfferDecideRequest {
  return { kind: 'request.offer.decide', payload: { offerId, decision } };
}

/** A closed slip's trace text (the comp's `.slip.gone`). */
export function traceText(s: Pick<Slip, 'decided' | 'mod' | 'kept'>): string {
  if (s.decided === 'open') return `${s.kept ? 'kept in' : 'opened'} mod:${s.mod}`;
  if (s.decided === 'stop-here') return `offers off in this thread · mod:${s.mod}`;
  if (s.decided === 'not-now') return `not now · mod:${s.mod}`;
  return `offer · mod:${s.mod}`;
}
