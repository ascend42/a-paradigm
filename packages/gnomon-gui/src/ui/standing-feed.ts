/**
 * @symbol #gui
 *
 * #gui standing-grant feed, the DOM side (TD-2026-10-20-086 F6; decisions in core/standing.ts). Kept apart from
 * app.ts so the page's chrome can be restyled without touching it: app.ts mounts it once and forwards live rows
 * and status reads. Shows an info toast for each `grant.standing.used` row (#gui-toast, board gnomon-notices: the
 * page's one toast region, no bottom-right toasts of its own; a window joining the unlock is a warn), a list of
 * today's uses with Revoke, and the offer as a persistent toast with one key, "Make it standing": it files
 * log.append request.grant.standing and then focuses the grant card in the stack, the way Restart now focuses the
 * upgrade card. The toast never decides the card (founder decision with Aegis): the person accepts it there, with
 * one password. Its close key reads "Not today". Every request is sent only on a trusted user event (G-GUI-04).
 * Styled by classes in styles.css only (#gui-settings: the CSP's style-src 'self' refuses a style attribute, so the
 * inline styles this module once set never applied).
 */
import { dayKey, feedItemOf, grantRequest, revokeRequest, shouldOffer, STANDING_ROW_KINDS, standingStatusOf, type FeedItem } from '../core/standing.js';
import type { ToastKind } from '../core/toasts.js';
import type { ToastHandle, ToastOptions } from './toasts.js';

const OFFER_DAY_KEY = 'gnomon.standing.offeredDay';
const MAX_ITEMS = 50;
const OFFER_TEXT = 'Let Gnomon handle today\'s approvals? One password now: mode switches, "always" rules, voice and same-build restarts then notify you instead of asking, until the screen locks';
const OFFER_TITLE = 'One password now; mode switches, "always" rules, voice and same-build restarts then just notify you until the screen locks';

interface Caller {
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
}

export interface StandingFeedDeps {
  client: () => Caller | null;
  status: () => unknown;
  refresh: () => Promise<void>;
  /** the kinds of the cards pending now (the page's store) */
  pendingKinds: () => Iterable<string>;
  /** the focused session's repo key (the grant's repo), or null */
  focusRepo: () => string | null;
  notice: (msg: string | null, kind?: ToastKind) => void;
  /** scroll to a card and focus its key (app.ts focusCard; never decides) */
  focusCard: (cardId: string) => void;
  /** the page's toast region (ui/toasts.ts) */
  toast: (text: string, opts?: ToastOptions) => ToastHandle;
  /** Aegis L1: the kernel principal of the connected home (core/standing.ts kernelPrincipalOf), or null */
  kernelPrincipal: () => string | null;
}

export interface StandingFeed {
  row(r: { seq?: unknown; kind?: unknown; payload?: unknown; principal?: unknown }): void;
  repaint(): void;
}

export function mountStandingFeed(doc: Document, d: StandingFeedDeps): StandingFeed {
  const root = doc.createElement('aside');
  root.id = 'standing-feed';
  root.className = 'standing-feed kernel-owned';
  root.setAttribute('aria-label', "Today's grant");
  const panel = doc.createElement('details');
  panel.className = 'standing-list';
  panel.hidden = true;
  const summary = doc.createElement('summary');
  const list = doc.createElement('ul');
  list.className = 'standing-items';
  const revoke = doc.createElement('button');
  revoke.type = 'button';
  revoke.className = 'key quiet standing-revoke';
  revoke.textContent = 'Revoke';
  panel.append(summary, list, revoke);
  root.append(panel);
  doc.body.appendChild(root);

  const items: FeedItem[] = [];
  let busy = false;
  const storage = (): Storage | null => {
    try {
      return doc.defaultView?.localStorage ?? null;
    } catch {
      return null;
    }
  };

  let offer: ToastHandle | null = null;

  function repaint(): void {
    const v = standingStatusOf(d.status());
    const live = v.active[0] ?? null;
    panel.hidden = !live && items.length === 0;
    summary.textContent = live ? `Today's grant · ${live.uses} use${live.uses === 1 ? '' : 's'} · until ${new Date(live.expiresAt).toLocaleTimeString()} or the screen locks` : "Today's grant · off";
    revoke.hidden = !live;
    revoke.dataset.grantId = live?.grantId ?? '';
    list.replaceChildren(
      ...items
        .slice(-MAX_ITEMS)
        .reverse()
        .map((i) => {
          const li = doc.createElement('li');
          li.textContent = i.text;
          return li;
        }),
    );
    const today = dayKey(new Date());
    const wanted = !busy && shouldOffer(d.pendingKinds(), v, storage()?.getItem(OFFER_DAY_KEY) ?? null, today);
    if (!wanted && offer?.present) offer.dismiss();
    if (wanted && !offer?.present) offer = d.toast(OFFER_TEXT, { kind: 'info', persistent: true, key: { label: 'Make it standing', title: OFFER_TITLE, onPress: makeStanding }, closeLabel: 'Not today', onClose: notToday });
  }

  /** closing the offer is "not today": it is not offered again until tomorrow */
  function notToday(): void {
    storage()?.setItem(OFFER_DAY_KEY, dayKey(new Date()));
  }

  function makeStanding(e: MouseEvent): void {
    if (!e.isTrusted || busy) return;
    const c = d.client();
    if (!c) return d.notice('not connected: no grant was made', 'fail');
    storage()?.setItem(OFFER_DAY_KEY, dayKey(new Date()));
    busy = true;
    offer?.dismiss();
    void (async () => {
      try {
        const r = await c.call<Record<string, unknown>>('log.append', grantRequest(d.focusRepo()));
        // the toast files the request; the grant card in the stack decides it (one password there), never the toast
        if (r.pending === true && typeof r.cardId === 'string') d.focusCard(r.cardId);
      } catch {
        d.notice("today's grant was not requested; each decision still asks", 'fail');
      } finally {
        busy = false;
        await d.refresh();
      }
    })();
  }

  revoke.addEventListener('click', (e) => {
    const id = revoke.dataset.grantId;
    if (!e.isTrusted || !id) return;
    const c = d.client();
    if (!c) return;
    void c
      .call('log.append', revokeRequest(id))
      .catch(() => d.notice('the grant was not revoked', 'fail'))
      .finally(() => void d.refresh());
  });

  return {
    row(r) {
      const i = feedItemOf(r, d.kernelPrincipal());
      if (!i) return;
      items.push(i);
      if (items.length > MAX_ITEMS) items.shift();
      // a use is a confirmation (info); another window joining the unlock is a warn; both leave by themselves
      if (i.toast) d.toast(i.text, { kind: i.kind === 'joined' ? 'warn' : 'info' });
      if (typeof r.kind === 'string' && STANDING_ROW_KINDS.has(r.kind)) void d.refresh();
      repaint();
    },
    repaint,
  };
}
