/**
 * @symbol #approval-broker
 *
 * #approval-broker card construction (spec §3.4 `card:v1`, §4.5 sanitizer
 * flags, §3.1 kernel key "Signs: card.actions[] and the presence-prompt
 * record"). Everything a human sees is composed HERE from the broker's own
 * record — never from a requester's rendering:
 *
 *   - every line passes the ONE published sanitizer, @a-company/gnomon-contracts
 *     `sanitizeDisplayText` (§4.5 normative, conformance/display.v1.json):
 *     terminal escapes removed, bidi controls shown as `⟨RLO⟩`-style glyphs,
 *     hidden characters and controls stripped, flags `hidden-chars` / `bidi`.
 *     The earlier `\u{…}` escape DEVIATION (reviewer 3) is retired
 *     (M1.12 slice 2): a kernel card and a conformant client draw the same
 *     text, so two UIs cannot disagree on a card;
 *   - `contentHash` = sha256(canonical {kind, requestedBy, hsid, detail,
 *     flags}) — the decision signature covers what was shown;
 *   - `actions[]` = one entry per valid decision, each signed by the kernel
 *     key over (cardId, decision, contentHash) in domain
 *     `gnomon:card-action:v1`;
 *   - the presence prompt is composed from the card record (kind, requester,
 *     a contentHash summary line, connId, open GUI sessions {n}) and signed
 *     by the kernel key in domain `gnomon:presence-prompt:v1`; the helper
 *     renders it in M1.3 (natively, or in a helper window on Windows, chosen
 *     by the M1.0 probe — passed in, never branched on here).
 */
import { canonicalJson, hex, sanitizeDisplayText, sha256, type CardFlag, type CardV1 } from '@a-company/gnomon-contracts';
import type { KeyRing, Signer } from '../log/signer.js';
import { validDecisions } from './classes.js';

const MAX_LINE = 512;

export function sha256Hex(s: string): string {
  return `sha256:${hex(sha256(s))}`;
}

/** Sanitize one display line (§4.5) with the published contracts sanitizer, then cap its length by code points (never splitting a pair). */
export function sanitizeLine(text: string): { text: string; flags: CardFlag[] } {
  const s = sanitizeDisplayText(String(text));
  const cps = Array.from(s.text);
  const out = cps.length > MAX_LINE ? `${cps.slice(0, MAX_LINE - 1).join('')}…` : s.text;
  return { text: out, flags: s.flags };
}

/** A display-block:v1 Box of Text lines, plus the sanitizer's flags. */
export function blockOf(lines: readonly string[]): { block: Record<string, unknown>; flags: CardFlag[] } {
  const flags = new Set<CardFlag>();
  const children = lines.map((l) => {
    const s = sanitizeLine(l);
    for (const f of s.flags) flags.add(f);
    return { type: 'Text', text: s.text };
  });
  return { block: { schemaVersion: 'display-block:v1', type: 'Box', children }, flags: [...flags] };
}

/** contentHash over what the card shows and asserts (§3.4: inside contentHash). */
export function contentHashOf(c: { kind: string; requestedBy: string; hsid?: string; detail: unknown; flags: readonly string[] }): string {
  return sha256Hex(canonicalJson({ kind: c.kind, requestedBy: c.requestedBy, hsid: c.hsid ?? null, detail: c.detail, flags: [...c.flags].sort() }));
}

export interface SignedAction {
  decision: string;
  keyId: string;
  sig: string;
}

/** The message a kernel-signed action covers. */
export function actionMessage(cardId: string, decision: string, contentHash: string): string {
  return [cardId, decision, contentHash].join('\n');
}

export function signActions(kernel: Signer, cardId: string, kind: string, contentHash: string): SignedAction[] {
  return validDecisions(kind).map((decision) => ({
    decision,
    keyId: kernel.keyId,
    sig: Buffer.from(kernel.sign('cardAction', actionMessage(cardId, decision, contentHash))).toString('base64'),
  }));
}

/** Verify a card's kernel-signed actions (clients pin the kernel key; tests). */
export function verifyActions(ring: KeyRing, card: Pick<CardV1, 'cardId' | 'contentHash' | 'actions'>): boolean {
  if (!Array.isArray(card.actions)) return false;
  return card.actions.every((a) => {
    const x = a as Partial<SignedAction>;
    if (typeof x.decision !== 'string' || typeof x.keyId !== 'string' || typeof x.sig !== 'string') return false;
    return ring.verify(x.keyId, 'cardAction', actionMessage(card.cardId, x.decision, card.contentHash), Buffer.from(x.sig, 'base64')) === 'ok';
  });
}

/* ── the presence prompt (§3.4, S25-M1) ───────────────────────────────────── */

export interface PresencePromptRecord {
  schemaVersion: 'gnomon-presence-prompt:v1';
  cardId: string;
  kind: string;
  decision: string;
  requestedBy: string;
  /** first 12 hex of the contentHash, with the card's first line */
  summary: string;
  contentHash: string;
  connId: string;
  guiSessions: { n: number };
  /** why this decision takes presence (`fresh presence: always is a standing rule`, …) */
  reason: string;
}

export interface SignedPresencePrompt {
  record: PresencePromptRecord;
  /** The text the helper shows, composed only from `record`. */
  text: string;
  keyId: string;
  sig: string;
}

export function promptText(r: PresencePromptRecord): string {
  const open = r.guiSessions.n === 1 ? '1 GUI session open' : `${r.guiSessions.n} GUI sessions open`;
  return `Gnomon: ${r.decision} on ${r.kind} card from ${r.requestedBy} — ${r.summary} — on ${r.connId} (${open}). ${r.reason}`;
}

export function composePresencePrompt(
  kernel: Signer,
  card: Pick<CardV1, 'cardId' | 'kind' | 'requestedBy' | 'contentHash' | 'block'>,
  f: { decision: string; connId: string; guiSessions: number; reason: string },
): SignedPresencePrompt {
  const first = (card.block as { children?: Array<{ text?: unknown }> }).children?.[0]?.text;
  const record: PresencePromptRecord = {
    schemaVersion: 'gnomon-presence-prompt:v1',
    cardId: card.cardId,
    kind: String(card.kind),
    decision: f.decision,
    requestedBy: card.requestedBy,
    summary: `${card.contentHash.slice(7, 19)}${typeof first === 'string' ? ` ${Array.from(first).slice(0, 120).join('')}` : ''}`,
    contentHash: card.contentHash,
    connId: f.connId,
    guiSessions: { n: f.guiSessions },
    reason: f.reason,
  };
  const msg = canonicalJson(record);
  return { record, text: promptText(record), keyId: kernel.keyId, sig: Buffer.from(kernel.sign('presencePrompt', msg)).toString('base64') };
}

/** Verify a signed prompt: the signature covers the record, and the text is exactly the record's composition. */
export function verifyPresencePrompt(ring: KeyRing, p: SignedPresencePrompt): boolean {
  if (p.text !== promptText(p.record)) return false;
  return ring.verify(p.keyId, 'presencePrompt', canonicalJson(p.record), Buffer.from(p.sig, 'base64')) === 'ok';
}
