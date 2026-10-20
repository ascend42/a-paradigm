/**
 * @symbol #gui
 *
 * #gui standing-grant feed (TD-2026-10-20-086 F6; spec §3.4 "Standing grant", §11.5). PURE.
 *
 *   - The feed's state comes ONLY from the kernel: `status.standing` (the live grants) and the kernel-signed rows
 *     `grant.standing` (minted), `grant.standing.used` (each use: the notify row, shown as a toast and in the list)
 *     and `grant.standing.revoked`. Never from a mod or the page's own guess.
 *   - `shouldOffer` decides when to show "Let Gnomon handle these today": a pending card a grant could cover, no
 *     live grant, and not offered yet today (the day key is the page's localStorage, a presentation preference).
 *   - The requests are `log.append{kind:'request.grant.standing', payload:{tuples, repos}}` (the kernel raises one
 *     `grant` card the same gesture approves; one presence) and `{kind:'request.grant.standing.revoke',
 *     payload:{grantId}}` (a tighten, no presence).
 */
import { STANDING_TUPLES, type StandingTuple } from '@a-company/gnomon-contracts';

export { STANDING_TUPLES, type StandingTuple };

export const STANDING_TUPLE_TEXT: Readonly<Record<StandingTuple, string>> = Object.freeze({
  'mode.loosen:auto-edits': 'switched a folder to auto-edits',
  'permission:always': 'made an "always" rule',
  'voice.widen': 'widened voice to ambient listening',
  'voice-arm:allow': 'armed voice approvals',
  'daemon-stop:restart': 'restarted Gnomon (same build)',
  'reconsider:extend': 'extended a capped review',
});

/** Card kinds a standing grant can cover (the kernel decides exactly; this only chooses when to offer). */
export const OFFER_KINDS: ReadonlySet<string> = new Set(['strictness', 'permission', 'voice-arm', 'daemon-stop', 'reconsider']);

export interface StandingGrantView {
  grantId: string;
  tuples: string[];
  repos: string[];
  expiresAt: string;
  uses: number;
}

export interface StandingView {
  built: boolean;
  active: StandingGrantView[];
  pendingCardId: string | null;
}

/** status.standing, fail-safe: anything unreadable reads as "no grant" (never as a live one). */
export function standingStatusOf(status: unknown): StandingView {
  const none: StandingView = { built: false, active: [], pendingCardId: null };
  if (!status || typeof status !== 'object') return none;
  const s = (status as { standing?: unknown }).standing;
  if (!s || typeof s !== 'object') return none;
  const o = s as Record<string, unknown>;
  const active = Array.isArray(o.active)
    ? o.active.flatMap((g): StandingGrantView[] => {
        if (!g || typeof g !== 'object') return [];
        const x = g as Record<string, unknown>;
        if (typeof x.grantId !== 'string' || typeof x.expiresAt !== 'string') return [];
        return [{ grantId: x.grantId, tuples: Array.isArray(x.tuples) ? x.tuples.filter((t): t is string => typeof t === 'string') : [], repos: Array.isArray(x.repos) ? x.repos.filter((t): t is string => typeof t === 'string') : [], expiresAt: x.expiresAt, uses: typeof x.uses === 'number' ? x.uses : 0 }];
      })
    : [];
  return { built: o.built === true, active, pendingCardId: typeof o.pendingCardId === 'string' ? o.pendingCardId : null };
}

export interface FeedItem {
  seq: number;
  kind: 'minted' | 'used' | 'revoked';
  grantId: string;
  text: string;
  /** a use is a toast too */
  toast: boolean;
}

const short = (s: string): string => (s.length > 16 ? `…${s.slice(-8)}` : s);

/** A feed line for a standing row, or null. */
export function feedItemOf(row: { seq?: unknown; kind?: unknown; payload?: unknown }): FeedItem | null {
  if (typeof row.seq !== 'number' || typeof row.kind !== 'string' || !row.payload || typeof row.payload !== 'object') return null;
  const p = row.payload as Record<string, unknown>;
  if (typeof p.grantId !== 'string') return null;
  if (row.kind === 'grant.standing.used') {
    const what = (STANDING_TUPLE_TEXT as Record<string, string>)[String(p.tuple)] ?? `decided ${String(p.decision ?? '?')}`;
    return { seq: row.seq, kind: 'used', grantId: p.grantId, text: `Gnomon ${what}${typeof p.repo === 'string' ? ` in ${short(p.repo)}` : ''}${typeof p.hsid === 'string' ? ` (session ${short(p.hsid)})` : ''} · no password: today's grant`, toast: true };
  }
  if (row.kind === 'grant.standing') return { seq: row.seq, kind: 'minted', grantId: p.grantId, text: `Today's grant is on (${Array.isArray(p.tuples) ? p.tuples.length : 0} kinds) until the screen locks`, toast: false };
  if (row.kind === 'grant.standing.revoked') return { seq: row.seq, kind: 'revoked', grantId: p.grantId, text: `Today's grant ended (${String(p.reason ?? 'revoked')})`, toast: false };
  return null;
}

/** Rows whose arrival changes status.standing (the page re-reads status on them). */
export const STANDING_ROW_KINDS: ReadonlySet<string> = new Set(['grant.standing', 'grant.standing.used', 'grant.standing.revoked']);

/** The local calendar day of `now` (the "today" of the offer). */
export function dayKey(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Offer "Let Gnomon handle these today" at the first presence-needing card of the day with no live grant. */
export function shouldOffer(pendingKinds: Iterable<string>, view: StandingView, offeredDay: string | null, today: string): boolean {
  if (!view.built || view.active.length > 0 || view.pendingCardId || offeredDay === today) return false;
  for (const k of pendingKinds) if (OFFER_KINDS.has(k)) return true;
  return false;
}

export function grantRequest(repo: string | null): { kind: 'request.grant.standing'; payload: { tuples: StandingTuple[]; repos: string[] } } {
  return { kind: 'request.grant.standing', payload: { tuples: [...STANDING_TUPLES], repos: repo ? [repo] : [] } };
}

export function revokeRequest(grantId: string): { kind: 'request.grant.standing.revoke'; payload: { grantId: string } } {
  return { kind: 'request.grant.standing.revoke', payload: { grantId } };
}
