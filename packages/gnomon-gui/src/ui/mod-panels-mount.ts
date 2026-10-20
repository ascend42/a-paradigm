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
import { PANEL_HEADING, ModPanelScheduler, modPanelsOf, modViewParams, panelsIn, renderModFence, workshopAbsence, WORKSHOP_INSTALL_KEY, WORKSHOP_NOT_INSTALLED, type ModPanelView, type ModRegion } from '../core/mod-panels.js';
import type { MiniDoc } from '../core/render.js';

const REGION_HOST: Record<ModRegion, { id: string; parent: string; after?: string }> = {
  'desk-footer': { id: 'mod-slot-composer-footer', parent: 'pane-transcript', after: 'composer' },
  'left-bottom': { id: 'mod-slot-sidebar', parent: 'pane-sessions' },
  right: { id: 'mod-slot-panel', parent: 'pane-stack' },
  // S5: the Workshop region lives in #workshop-host, which app.ts places (footer, left or right column) per Layout
  workshop: { id: 'mod-slot-workshop', parent: 'workshop-host' },
};

/** S5.1: the Workshop region with no running Workshop: one quiet line, in --sec. */
function paintWorkshopAbsence(line: string | null): void {
  if (line === null) return;
  const el = regionEl('workshop');
  if (!el) return;
  clear(el);
  el.hidden = false;
  if (line === WORKSHOP_NOT_INSTALLED) {
    // fidelity 2: UI-first key; disabled while install has no GUI request kind (WORKSHOP_INSTALL_KEY)
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'key quiet workshop-install';
    b.textContent = WORKSHOP_INSTALL_KEY.label;
    b.title = WORKSHOP_INSTALL_KEY.title;
    b.disabled = !WORKSHOP_INSTALL_KEY.enabled;
    el.appendChild(b);
    return;
  }
  const p = document.createElement('small');
  p.className = 'meta workshop-absent';
  p.textContent = line;
  el.appendChild(p);
}

function regionEl(region: ModRegion): HTMLElement | null {
  const r = REGION_HOST[region];
  const have = document.getElementById(r.id);
  if (have) return have;
  const parent = document.getElementById(r.parent);
  if (!parent) return null;
  const el = document.createElement('div');
  el.id = r.id;
  el.className = `mod-slot mod-slot-${region}`;
  if (region === 'right') el.setAttribute('aria-label', PANEL_HEADING);
  const after = r.after ? document.getElementById(r.after) : null;
  if (after && after.parentNode === parent) parent.insertBefore(el, after.nextSibling);
  else parent.appendChild(el);
  return el;
}

const clear = (el: HTMLElement): void => {
  while (el.firstChild) el.removeChild(el.firstChild);
};

let current: { scheduler: ModPanelScheduler; views: number; dispose(): void } | null = null;

/** K3: the focused session changed (app.ts focus()) ⇒ the mod panels re-render now with the new {focus:{hsid}}. */
export function modPanelsFocus(hsid: string | null): void {
  if (current && current.views > 0) current.scheduler.focus(hsid);
}

/** Mount (or re-mount) the mod panels for this connection. Returns the live-row hook. */
export function mountModPanels(o: { client: GnomonClient; status: unknown; focused: () => string | null }): (row: { kind?: unknown } | null) => void {
  current?.dispose();
  const doc = document as unknown as MiniDoc;
  const views: ModPanelView[] = modPanelsOf(o.status);
  const absent = workshopAbsence(o.status, views);
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
      // Aegis M2: the panel region is headed by a `mods` rule (the region sits after #stack, outside its scroll)
      if (region === 'right' && mine.length) {
        const head = document.createElement('div');
        head.className = 'mod-slot-head';
        head.textContent = PANEL_HEADING;
        el.appendChild(head);
      }
      for (const { v, r, why } of results) if (v.region === region) el.appendChild(renderModFence({ doc }, v, r, why) as unknown as Node);
    }
    paintWorkshopAbsence(absent);
  };
  const scheduler = new ModPanelScheduler(render, { setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: (t) => window.clearTimeout(t as number) });
  current = {
    scheduler,
    views: views.length,
    dispose: () => {
      live = false;
    },
  };
  scheduler.focus(o.focused()); // K3: the mount render uses the current focus
  if (views.length) scheduler.now();
  else {
    for (const region of Object.keys(REGION_HOST) as ModRegion[]) {
      const el = document.getElementById(REGION_HOST[region].id);
      if (el) {
        clear(el);
        el.hidden = true;
      }
    }
    paintWorkshopAbsence(absent);
  }
  return (row) => {
    if (live && views.length) scheduler.row(row?.kind);
  };
}
