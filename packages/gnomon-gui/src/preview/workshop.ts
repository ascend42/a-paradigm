/**
 * @symbol #gui-preview
 *
 * DEV ONLY (#gui-preview): the Workshop strip in the preview. The GUI has no
 * mod-view slot yet (the #mod-host relays arrive with M1.11), so the preview
 * runs the REAL first-party mod's pure model
 * (packages/gnomon-mods/workshop/model.mjs) over the fixture rows projected
 * the way #mod-host's feed projects them (modhost/feed.ts: session.open
 * {hsid, backend, project = sha256(cwd)[0] % 8}, turn.partial, approval.request
 * {cardId, kind, hsid}, …), and draws its display-block:v1 output with the
 * GUI's own kit renderer (core/render.ts renderBlock) under each Box title,
 * at the foot of the sessions pane (the manifest's `sidebar`/`append` slot).
 */
import { sha256, utf8, type LogRow } from '@a-company/gnomon-contracts';
import { h, renderBlock, type MiniDoc, type MiniEl } from '../core/render.js';
// @ts-ignore -- the mod is plain ESM with no types (its packageHash is pinned: no .d.ts may be added beside it)
import * as model from '../../../gnomon-mods/workshop/model.mjs';

interface WorkshopModel {
  emptyState(): unknown;
  apply(state: unknown, event: unknown): unknown;
  render(state: unknown, prefs: { motion?: string; theme?: string }): Record<string, unknown>;
}
const workshop = model as unknown as WorkshopModel;

const FEED_HUES = 8;

/** One kernel row as the #mod-host feed projects it to a mod (only the fields the caps derive from), or null. */
export function feedEventOf(r: LogRow): { kind: string; payload: Record<string, unknown> } | null {
  if (r.view !== 'full') return null;
  const e = r.event;
  const p = (e.payload && typeof e.payload === 'object' ? e.payload : {}) as Record<string, unknown>;
  const hsid = typeof p.hsid === 'string' ? p.hsid : typeof e.session === 'string' ? e.session : undefined;
  const card = (p.card && typeof p.card === 'object' ? p.card : {}) as Record<string, unknown>;
  switch (e.kind) {
    case 'session.open':
      return { kind: e.kind, payload: { hsid, backend: p.backend === 'local' ? 'local' : 'claude', project: typeof p.cwd === 'string' ? sha256(utf8(p.cwd))[0]! % FEED_HUES : 0 } };
    case 'session.exited':
    case 'turn.partial':
    case 'turn.result':
    case 'warpline.knot':
      return { kind: e.kind, payload: { hsid } };
    case 'approval.request':
      return { kind: e.kind, payload: { cardId: card.cardId, kind: card.kind, hsid: typeof card.hsid === 'string' ? card.hsid : hsid } };
    case 'approval.decide':
    case 'approval.expire':
      return { kind: e.kind, payload: { cardId: p.cardId } };
    default:
      return null;
  }
}

/** The Workshop's display block for these rows. */
export function workshopBlock(rows: readonly LogRow[], prefs: { motion: 'full' | 'reduced'; theme: 'day' | 'night' }): Record<string, unknown> {
  const state = workshop.emptyState();
  for (const r of rows) {
    const ev = feedEventOf(r);
    if (ev) workshop.apply(state, ev);
  }
  return workshop.render(state, prefs);
}

/** Draw the block: a title per zone, each cap line through the kit renderer with its hue as a swatch (hues are fills only). */
export function drawWorkshop(doc: MiniDoc, block: Record<string, unknown>): MiniEl {
  const zones = Array.isArray(block.children) ? (block.children as Array<Record<string, unknown>>) : [];
  return h(
    doc,
    'section',
    { class: 'pane-workshop', 'aria-label': 'Workshop (mod)' },
    h(doc, 'div', { class: 'group-head' }, String(block.title ?? 'Workshop'), ' · mod'),
    ...zones.map((z) =>
      h(
        doc,
        'div',
        { class: 'workshop-zone' },
        h(doc, 'div', { class: 'meta' }, String(z.title ?? '')),
        ...(Array.isArray(z.children) ? (z.children as Array<Record<string, unknown>>) : []).map((cap) => {
          const tone = String(cap.tone ?? '');
          const hue = /^hue-(\d)$/.exec(tone);
          return h(doc, 'div', { class: `workshop-cap tone-${tone.replace(/[^a-z0-9-]/g, '')}` }, hue ? h(doc, 'span', { class: `swatch h${Number(hue[1]) % 6}` }) : null, renderBlock({ doc }, cap));
        }),
      ),
    ),
  );
}
