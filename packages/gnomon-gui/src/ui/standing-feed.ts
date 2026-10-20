/**
 * @symbol #gui
 *
 * #gui standing-grant feed, the DOM side (TD-2026-10-20-086 F6; decisions in core/standing.ts). Kept apart from
 * app.ts so the page's chrome can be restyled without touching it: app.ts mounts it once and forwards live rows
 * and status reads. Shows a toast for each `grant.standing.used` row, a list of today's uses with Revoke, and the
 * one-gesture offer "Let Gnomon handle these today" (log.append request.grant.standing, then approve its grant card
 * `allow` in the same gesture: one presence). Every request is sent only on a trusted user event (G-GUI-04).
 */
import { dayKey, feedItemOf, grantRequest, revokeRequest, shouldOffer, STANDING_ROW_KINDS, standingStatusOf, type FeedItem } from '../core/standing.js';

const OFFER_DAY_KEY = 'gnomon.standing.offeredDay';
const TOAST_MS = 6_000;
const MAX_ITEMS = 50;

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
  notice: (msg: string | null, fail?: boolean) => void;
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
  root.setAttribute('style', 'position:fixed;right:12px;bottom:12px;max-width:340px;z-index:50;display:flex;flex-direction:column;gap:6px;font-size:12px');
  const toasts = doc.createElement('div');
  toasts.setAttribute('role', 'status');
  const offer = doc.createElement('button');
  offer.type = 'button';
  offer.className = 'key standing-offer';
  offer.textContent = 'Let Gnomon handle these today';
  offer.title = 'One password now; mode switches, "always" rules, voice and same-build restarts then just notify you here until the screen locks';
  offer.hidden = true;
  const panel = doc.createElement('details');
  panel.className = 'standing-list';
  panel.hidden = true;
  const summary = doc.createElement('summary');
  const list = doc.createElement('ul');
  list.setAttribute('style', 'margin:4px 0;padding-left:16px;max-height:200px;overflow:auto');
  const revoke = doc.createElement('button');
  revoke.type = 'button';
  revoke.className = 'key quiet standing-revoke';
  revoke.textContent = 'Revoke';
  panel.append(summary, list, revoke);
  root.append(toasts, offer, panel);
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

  function toast(text: string): void {
    const t = doc.createElement('div');
    t.className = 'standing-toast';
    t.setAttribute('style', 'padding:6px 8px;border-radius:4px;background:var(--paper,#fff);border:1px solid var(--rule,#ccc)');
    t.textContent = text;
    toasts.appendChild(t);
    setTimeout(() => t.remove(), TOAST_MS);
  }

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
    offer.hidden = !shouldOffer(d.pendingKinds(), v, storage()?.getItem(OFFER_DAY_KEY) ?? null, today);
  }

  offer.addEventListener('click', (e) => {
    if (!e.isTrusted || busy) return;
    const c = d.client();
    if (!c) return d.notice('not connected: no grant was made', true);
    storage()?.setItem(OFFER_DAY_KEY, dayKey(new Date()));
    busy = true;
    offer.hidden = true;
    void (async () => {
      try {
        const r = await c.call<Record<string, unknown>>('log.append', grantRequest(d.focusRepo()));
        if (r.pending === true && typeof r.cardId === 'string') {
          d.notice("Today's grant: confirm with your password once");
          await c.call('approve', { cardId: r.cardId, decision: 'allow' });
          d.notice(null);
        }
      } catch {
        d.notice("today's grant was not made; each decision still asks", true);
      } finally {
        busy = false;
        await d.refresh();
      }
    })();
  });

  revoke.addEventListener('click', (e) => {
    const id = revoke.dataset.grantId;
    if (!e.isTrusted || !id) return;
    const c = d.client();
    if (!c) return;
    void c
      .call('log.append', revokeRequest(id))
      .catch(() => d.notice('the grant was not revoked', true))
      .finally(() => void d.refresh());
  });

  return {
    row(r) {
      const i = feedItemOf(r);
      if (!i) return;
      items.push(i);
      if (items.length > MAX_ITEMS) items.shift();
      if (i.toast) toast(i.text);
      if (typeof r.kind === 'string' && STANDING_ROW_KINDS.has(r.kind)) void d.refresh();
      repaint();
    },
    repaint,
  };
}
