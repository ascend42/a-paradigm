/**
 * @symbol #gui
 *
 * #gui mod panels, browser glue (K0). Isolated from app.ts on purpose: app.ts
 * calls `mountModPanels` once per attach (with the fresh status) and feeds it
 * live rows through the returned `row` hook; everything else is here or in the
 * pure core/mod-panels.ts. The regions are created next to the panes they
 * belong to (no index.html change): under the composer (desk footer), at the
 * bottom of the sessions pane (left), at the bottom of the decisions pane
 * (right, below the kernel-owned stack, never inside it).
 */
import type { GnomonClient } from '../core/client.js';
import { RpcError } from '../core/client.js';
import { ModPanelScheduler, modPanelsOf, modViewParams, panelsIn, renderModFence, type ModPanelView, type ModRegion } from '../core/mod-panels.js';
import type { MiniDoc } from '../core/render.js';

const REGION_HOST: Record<ModRegion, { id: string; parent: string; after?: string }> = {
  'desk-footer': { id: 'mod-slot-composer-footer', parent: 'pane-transcript', after: 'composer' },
  'left-bottom': { id: 'mod-slot-sidebar', parent: 'pane-sessions' },
  right: { id: 'mod-slot-panel', parent: 'pane-stack' },
};

function regionEl(region: ModRegion): HTMLElement | null {
  const r = REGION_HOST[region];
  const have = document.getElementById(r.id);
  if (have) return have;
  const parent = document.getElementById(r.parent);
  if (!parent) return null;
  const el = document.createElement('div');
  el.id = r.id;
  el.className = `mod-slot mod-slot-${region}`;
  const after = r.after ? document.getElementById(r.after) : null;
  if (after && after.parentNode === parent) parent.insertBefore(el, after.nextSibling);
  else parent.appendChild(el);
  return el;
}

const clear = (el: HTMLElement): void => {
  while (el.firstChild) el.removeChild(el.firstChild);
};

let current: { scheduler: ModPanelScheduler; dispose(): void } | null = null;

/** Mount (or re-mount) the mod panels for this connection. Returns the live-row hook. */
export function mountModPanels(o: { client: GnomonClient; status: unknown; focused: () => string | null }): (row: { kind?: unknown } | null) => void {
  current?.dispose();
  const doc = document as unknown as MiniDoc;
  const views: ModPanelView[] = modPanelsOf(o.status);
  let live = true;
  const render = async (): Promise<void> => {
    const results = await Promise.all(
      views.map(async (v) => {
        try {
          return { v, r: (await o.client.call<{ block?: unknown; dev?: unknown }>('mod.view', modViewParams(v, o.focused()))) ?? null, why: null };
        } catch (err) {
          return { v, r: null, why: err instanceof RpcError ? `${err.refusal.code}${err.refusal.reason ? ` ${err.refusal.reason}` : ''}` : 'failed' };
        }
      }),
    );
    if (!live) return;
    for (const region of Object.keys(REGION_HOST) as ModRegion[]) {
      const mine = panelsIn(views, region);
      const el = mine.length ? regionEl(region) : document.getElementById(REGION_HOST[region].id);
      if (!el) continue;
      clear(el);
      el.hidden = mine.length === 0;
      for (const { v, r, why } of results) if (v.region === region) el.appendChild(renderModFence({ doc }, v, r, why) as unknown as Node);
    }
  };
  const scheduler = new ModPanelScheduler(render, { setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: (t) => window.clearTimeout(t as number) });
  current = {
    scheduler,
    dispose: () => {
      live = false;
    },
  };
  if (views.length) scheduler.now();
  else for (const region of Object.keys(REGION_HOST) as ModRegion[]) {
    const el = document.getElementById(REGION_HOST[region].id);
    if (el) {
      clear(el);
      el.hidden = true;
    }
  }
  return (row) => {
    if (live && views.length) scheduler.row(row?.kind);
  };
}
