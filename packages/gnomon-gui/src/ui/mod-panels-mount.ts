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
import { markTruncated, TRUNCATABLE_SELECTOR, PANEL_HEADING, ModPanelScheduler, modPanelsOf, modViewParams, panelsIn, renderModFence, workshopAbsence, workshopInstallKey, WORKSHOP_NOT_INSTALLED, type ModPanelView, type ModRegion } from '../core/mod-panels.js';
import { installRequest, workshopSource } from '../core/mods.js';
import { requestMod } from './mods-panel.js';
import type { MiniDoc } from '../core/render.js';

const REGION_HOST: Record<ModRegion, { id: string; parent: string; after?: string }> = {
  'desk-footer': { id: 'mod-slot-composer-footer', parent: 'pane-transcript', after: 'composer' },
  'left-bottom': { id: 'mod-slot-sidebar', parent: 'pane-sessions' },
  right: { id: 'mod-slot-panel', parent: 'pane-stack' },
  // S5: the Workshop region lives in #workshop-host, which app.ts places (footer, left or right column) per Layout
  workshop: { id: 'mod-slot-workshop', parent: 'workshop-host' },
};

/** What the Workshop's Install key needs from the page (app.ts passes it to mountModPanels). */
export interface WorkshopInstallDeps {
  /** the Mods panel (#gui-mods-panel) */
  openMods: () => void;
  /** after a request: refresh status so the stack and the panel show the card */
  refreshStatus: () => Promise<void>;
}

/** S5.1: the Workshop region with no running Workshop: one quiet line, in --sec. */
function paintWorkshopAbsence(line: string | null, client: GnomonClient, status: unknown, deps: WorkshopInstallDeps | undefined): void {
  if (line === null) return;
  const el = regionEl('workshop');
  if (!el) return;
  clear(el);
  el.hidden = false;
  if (line === WORKSHOP_NOT_INSTALLED) {
    // fidelity 2: the UI-first key (core/mod-panels.ts workshopInstallKey): every press ends in words, never nothing
    const k = workshopInstallKey(workshopSource(status));
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'key quiet workshop-install';
    b.textContent = k.label;
    b.title = k.title;
    const said = document.createElement('small');
    said.className = 'meta workshop-install-result';
    said.setAttribute('role', 'status');
    said.hidden = true;
    b.addEventListener('click', (e) => {
      if (!e.isTrusted || b.getAttribute('aria-busy') === 'true') return; // G-GUI-04
      if (k.action === 'open-mods') {
        if (deps) return deps.openMods();
        said.hidden = false;
        said.textContent = 'this kernel lists no shipped Workshop: open Mods (⌘K → Mods) to add one from a folder';
        return;
      }
      void installWorkshop(b, said, client, workshopSource(status)!, deps);
    });
    el.append(b, said);
    return;
  }
  const p = document.createElement('small');
  p.className = 'meta workshop-absent';
  p.textContent = line;
  el.appendChild(p);
}

/** The Install Workshop press: one request.mod.install; the key is busy until it answers, then the result in words. */
export async function installWorkshop(b: HTMLButtonElement, said: HTMLElement, client: GnomonClient, path: string, deps: WorkshopInstallDeps | undefined): Promise<void> {
  b.setAttribute('aria-busy', 'true');
  b.disabled = true;
  b.textContent = 'Installing…';
  const r = await requestMod(client, installRequest(path));
  b.removeAttribute('aria-busy');
  b.disabled = false;
  b.textContent = 'Install Workshop';
  said.hidden = false;
  said.className = `meta workshop-install-result${r.fail ? ' fail' : ''}`;
  said.setAttribute('role', r.fail ? 'alert' : 'status');
  said.textContent = r.text;
  await deps?.refreshStatus().catch(() => undefined);
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

let current: { scheduler: ModPanelScheduler; views: number; key: string; opts: MountOptions; row(row: { kind?: unknown } | null): void; dispose(): void } | null = null;

type MountOptions = { client: GnomonClient; status: unknown; focused: () => string | null; workshop?: WorkshopInstallDeps };

/** What a mount depends on in status: the views, the Workshop line and its install source (a change ⇒ a re-mount). */
function mountKey(status: unknown): string {
  const views = modPanelsOf(status);
  return JSON.stringify([views.map((v) => [v.name, v.viewId, v.region, v.dev]), workshopAbsence(status, views), workshopSource(status)]);
}

/**
 * #gui-mods-panel: a fresh status (app.ts refreshStatus) re-mounts the panels when what they show changed, so an
 * install, pause or uninstall decided in the stack shows (or hides) its views and the Workshop key without a reload.
 */
export function modPanelsStatus(status: unknown): void {
  if (current && mountKey(status) !== current.key) mountModPanels({ ...current.opts, status });
}

/** K3: the focused session changed (app.ts focus()) ⇒ the mod panels re-render now with the new {focus:{hsid}}. */
export function modPanelsFocus(hsid: string | null): void {
  if (current && current.views > 0) current.scheduler.focus(hsid);
}

/** Mount (or re-mount) the mod panels for this connection. Returns the live-row hook. */
export function mountModPanels(o: MountOptions): (row: { kind?: unknown } | null) => void {
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
      if (mine.length) {
        markIn(el);
        resize?.observe(el);
      }
    }
    paintWorkshopAbsence(absent, o.client, o.status, o.workshop);
  };
  // Mika 2026-10-23: one tab stop per item the CSS cut; a column resize (the container queries relayout) or the
  // fonts loading can cut or uncut one, so the marks are redone then too
  const markIn = (root: Element): void => void markTruncated(root.querySelectorAll<HTMLElement>(TRUNCATABLE_SELECTOR));
  const resize = typeof ResizeObserver === 'function' ? new ResizeObserver((entries) => (live ? entries.forEach((e) => markIn(e.target)) : undefined)) : null;
  void document.fonts?.ready.then(() => {
    if (!live) return;
    for (const r of Object.values(REGION_HOST)) {
      const el = document.getElementById(r.id);
      if (el) markIn(el);
    }
  });
  const scheduler = new ModPanelScheduler(render, { setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: (t) => window.clearTimeout(t as number) });
  let lifecycleTimer: number | null = null;
  current = {
    scheduler,
    views: views.length,
    key: mountKey(o.status),
    opts: o,
    row: (row) => {
      if (!live) return;
      if (views.length) scheduler.row(row?.kind);
      // a mod's lifecycle row (installed, paused, uninstalled…): re-read status once, debounced; it re-mounts on a change
      if (typeof row?.kind === 'string' && MOD_LIFECYCLE_KINDS.has(row.kind) && o.workshop) {
        if (lifecycleTimer !== null) window.clearTimeout(lifecycleTimer);
        lifecycleTimer = window.setTimeout(() => {
          lifecycleTimer = null;
          void o.workshop!.refreshStatus().catch(() => undefined);
        }, 250);
      }
    },
    dispose: () => {
      live = false;
      resize?.disconnect();
      if (lifecycleTimer !== null) window.clearTimeout(lifecycleTimer);
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
    paintWorkshopAbsence(absent, o.client, o.status, o.workshop);
  }
  // stable across re-mounts (modPanelsStatus): the page keeps this one hook
  return (row) => current?.row(row);
}

/** Kernel rows that change which mods run (mod-host and manifest-loader kinds). */
export const MOD_LIFECYCLE_KINDS: ReadonlySet<string> = new Set(['manifest.installed', 'manifest.load', 'manifest.staged', 'manifest.uninstall', 'mod.installed', 'mod.linked', 'mod.paused', 'mod.unlinked', 'mod.rollback', 'mod.health']);
