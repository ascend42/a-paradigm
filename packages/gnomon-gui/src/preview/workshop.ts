/**
 * @symbol #gui-preview
 *
 * DEV ONLY (#gui-preview): the Workshop strip in the preview. The GUI has no
 * mod-view slot yet (the #mod-host relays arrive with M1.11), so the preview
 * runs the REAL first-party mod's pure model
 * (packages/gnomon-mods/workshop/model.mjs) over the fixture rows projected
 * the way #mod-host's feed projects them (modhost/feed.ts: session.open
 * {hsid, backend, project = projectHue(cwd), the ONE hue function, 0..5}, turn.partial, approval.request
 * {cardId, kind, hsid}, …), and draws its display-block:v1 output with the
 * GUI's own kit renderer through the fake kernel's `mod.view` (S5: the real
 * app mounts it in the Workshop region the Layout places; no preview-only drawing).
 */
import { projectHue, type LogRow } from '@a-company/gnomon-contracts';
// @ts-ignore -- the mod is plain ESM with no types (its packageHash is pinned: no .d.ts may be added beside it)
import * as model from '../../../gnomon-mods/workshop/model.mjs';

interface WorkshopModel {
  emptyState(): unknown;
  apply(state: unknown, event: unknown): unknown;
  render(state: unknown, prefs: { motion?: string; theme?: string }): Record<string, unknown>;
}
const workshop = model as unknown as WorkshopModel;


/** One kernel row as the #mod-host feed projects it to a mod (only the fields the caps derive from), or null. */
export function feedEventOf(r: LogRow): { kind: string; payload: Record<string, unknown> } | null {
  if (r.view !== 'full') return null;
  const e = r.event;
  const p = (e.payload && typeof e.payload === 'object' ? e.payload : {}) as Record<string, unknown>;
  const hsid = typeof p.hsid === 'string' ? p.hsid : typeof e.session === 'string' ? e.session : undefined;
  const card = (p.card && typeof p.card === 'object' ? p.card : {}) as Record<string, unknown>;
  switch (e.kind) {
    case 'session.open':
      return { kind: e.kind, payload: { hsid, backend: p.backend === 'local' ? 'local' : 'claude', project: typeof p.cwd === 'string' ? projectHue(p.cwd) : 0 } };
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
