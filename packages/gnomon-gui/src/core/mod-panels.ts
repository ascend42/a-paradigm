/**
 * @symbol #gui
 *
 * #gui mod panels (K0, #ledger-mod's host slice). PURE: which installed mod
 * views the GUI shows and where, the fenced rendering of one mod view, and the
 * re-render scheduler. The browser glue is ui/mod-panels-mount.ts.
 *
 *   - The views come from the kernel's `status.mods.views` (#mod-host status:
 *     the declared views of running mods) — never from a mod.
 *   - Slot → region: composer.footer → the desk footer (under the composer),
 *     sidebar → the bottom of the left pane, panel → the right pane. Every
 *     other slot (status.mod, tool.view:*, card.detail:*) has no region here,
 *     and a kernel-owned region (cards, decision keys, the voice pill, the
 *     mode control) is NEVER a mod slot.
 *   - A view renders through `mod.view` (the relay stamps relayedFor) and the
 *     kit renderer (core/render.ts, text nodes only) inside a fence labelled
 *     `mod:<name>`, with a `dev` chip for a dev-linked (tier local) mod. The
 *     input is display context only: {focus:{hsid}} of the focused session
 *     (K3); the HOST joins that hsid to the live session repo server-side,
 *     the GUI never names a repo or a path. A focus change re-renders.
 *   - Aegis M2: the right-pane (panel) region carries a `mods` heading rule
 *     outside the decision stack's scroll area, and a block holding any
 *     kit.Button is refused there (shown as a refusal in its fence).
 *   - S5.2: the Workshop's sidebar-slot view (`workshop` / `workshop.strip`) mounts in its own `workshop`
 *     region, which the GUI Layout places (footer by default, a 76 px column left or right, or hidden). The
 *     manifest slot is unchanged. Placement is presentation only: the fence and its label stay. With no
 *     running Workshop the region shows one quiet line (not installed, or paused and why).
 *   - Mod fences render Box titles (`blk-title`), so a mod's zones keep their headings; card bodies do not.
 *   - Fitted (founder 2026-10-23, "these mods have terrible display"): every fence but the Workshop's renders with
 *     `fit` (core/render.ts, styles.css .mod-fit) so any mod reads right in a 200-460px column: control and label
 *     type, ids truncated on one line (full text in title), row prose clamped to two lines, a project hue drawn as
 *     the ■ swatch, and a Table fitted to its column (label-style heads, numbers right-aligned and tabular, a
 *     key-value layout per row when the column is narrower than the table). Generic: no mod-name case.
 *   - Re-render only on a live store row whose kind is a #mod-host FEED kind,
 *     debounced 250 ms, one render in flight (a row during a render queues
 *     exactly one more), never on a timer.
 */
import { isModId } from '@a-company/gnomon-contracts';
import { modLabel, publisherDisplayOf, type PublisherDisplay } from './mod-label.js';
import { h, renderBlock, type MiniEl, type RenderCtx } from './render.js';

/** The #mod-host feed kinds (packages/gnomon/src/kernel/modhost/feed.ts FEED_KINDS; test/mod-panels.test.ts holds them equal). */
export const MOD_FEED_KINDS: readonly string[] = Object.freeze([
  'session.open',
  'session.exited',
  'turn.partial',
  'turn.result',
  'approval.request',
  'approval.decide',
  'approval.expire',
  'warpline.knot',
  'mod.paused',
  'mod.health',
  'turn.usage',
  'session.compacted',
  'budget.usage',
  'budget.ladder',
  'budget.pause',
  'budget.resume',
  'budget.breaker.open',
  'budget.breaker.close',
  'permit.deny',
]);

export type ModRegion = 'desk-footer' | 'left-bottom' | 'right' | 'workshop';
/** S5.2: the one view the Layout places (the first-party Workshop strip). */
export const WORKSHOP_VIEW = Object.freeze({ name: 'gnomon.workshop', viewId: 'workshop.strip', slot: 'sidebar' });
/** The only mod slots the GUI renders, and where. */
export const SLOT_REGIONS: Readonly<Record<string, ModRegion>> = Object.freeze({ 'composer.footer': 'desk-footer', sidebar: 'left-bottom', panel: 'right' });
export const MOD_PANEL_DEBOUNCE_MS = 250;
export const MAX_MOD_PANELS = 16;

/** S0b: a mod id <publisher>.<name> (contracts isModId). */
const MOD_NAME = { test: (s: string): boolean => isModId(s) };
const VIEW_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/;

export interface ModPanelView {
  name: string;
  viewId: string;
  slot: string;
  region: ModRegion;
  dev: boolean;
  /** Aegis S0b L1: status.mods.publishers[name] (null when absent or malformed) */
  publisherDisplay?: PublisherDisplay | null;
}

/** The mod views to show, from status.mods.views (malformed entries and slots with no region are dropped; bounded). */
export function modPanelsOf(status: unknown): ModPanelView[] {
  const mods = status && typeof status === 'object' ? (status as { mods?: unknown }).mods : null;
  const views = mods && typeof mods === 'object' ? (mods as { views?: unknown }).views : null;
  if (!Array.isArray(views)) return [];
  const out: ModPanelView[] = [];
  for (const v of views) {
    if (!v || typeof v !== 'object') continue;
    const { name, viewId, slot, dev } = v as Record<string, unknown>;
    if (typeof name !== 'string' || !MOD_NAME.test(name) || typeof viewId !== 'string' || !VIEW_ID.test(viewId) || typeof slot !== 'string') continue;
    const isWorkshop = name === WORKSHOP_VIEW.name && viewId === WORKSHOP_VIEW.viewId && slot === WORKSHOP_VIEW.slot;
    const region = isWorkshop ? 'workshop' : Object.hasOwn(SLOT_REGIONS, slot) ? SLOT_REGIONS[slot]! : null;
    if (!region) continue;
    out.push({ name, viewId, slot, region, dev: dev === true, publisherDisplay: publisherDisplayOf(status, name) });
    if (out.length >= MAX_MOD_PANELS) break;
  }
  return out;
}

/** S5.1: the quiet line the Workshop region shows when the Workshop view is not running, else null. */
export function workshopAbsence(status: unknown, views: readonly ModPanelView[]): string | null {
  if (views.some((v) => v.region === 'workshop')) return null;
  const mods = status && typeof status === 'object' ? (status as { mods?: unknown }).mods : null;
  const paused = mods && typeof mods === 'object' ? (mods as { paused?: unknown }).paused : null;
  const p = Array.isArray(paused) ? paused.find((x) => x && typeof x === 'object' && (x as { name?: unknown }).name === WORKSHOP_VIEW.name) : null;
  if (p) {
    const why = (p as { why?: unknown }).why;
    return `workshop paused${typeof why === 'string' && /^[a-z][a-z0-9-]{0,31}$/.test(why) ? ` (${why})` : ''} · gnomon mod start gnomon.workshop`;
  }
  return WORKSHOP_NOT_INSTALLED;
}

/** S5.1: the line when no Workshop is installed (the footer shows it as the Install Workshop key's tooltip). */
export const WORKSHOP_NOT_INSTALLED = 'workshop not installed · gnomon mod install packages/gnomon-mods/workshop';

/**
 * fidelity 2 (UI-first): the footer's "Install Workshop" key. It sends request.mod.install{source:'folder', path} for
 * the Workshop entry of status.mods.available (#mods-admin: the first-party mods shipped beside the kernel); the
 * kernel stages it exactly as `gnomon mod install` does and raises the normal install card in the stack.
 *
 * Founder dogfood 2026-10-21 ("Install Workshop does nothing"): the key USED to be a constant shown `disabled`, with
 * the terminal command only in its title=, because the kernel served no install request. A disabled key takes no
 * click and its tooltip rarely shows, so a press looked dead. Now: a known source ⇒ the key is enabled and its press
 * always ends in words (the card is raised, or the refusal); no source ⇒ the key still takes the press and opens
 * the Mods panel, which says why (no catalog, an older kernel) and offers Add from folder. Never a silent key.
 */
export function workshopInstallKey(path: string | null): { label: string; action: 'install' | 'open-mods'; title: string } {
  return path
    ? { label: 'Install Workshop', action: 'install', title: 'Install the first-party Workshop: the kernel raises its install card in the stack, and you allow it there with Touch ID' }
    : { label: 'Install Workshop', action: 'open-mods', title: 'This kernel lists no shipped Workshop: open Mods to see why and to add a mod from a folder' };
}

/** The views of one region, in status order. */
export function panelsIn(views: readonly ModPanelView[], region: ModRegion): ModPanelView[] {
  return views.filter((v) => v.region === region);
}

/** The fence label: always `mod:<name>` (the kernel's label is checked against it, never trusted over it). */
export function fenceLabel(name: string): string {
  return `mod:${modLabel(name)}`;
}

/** Whether a live row should re-render the panels. */
export function isFeedRow(kind: unknown): boolean {
  return typeof kind === 'string' && MOD_FEED_KINDS.includes(kind);
}

/** The `mod.view` params for a panel: the focused session as {focus:{hsid}} (K3: the host joins it; never a repo or path). */
export function modViewParams(v: ModPanelView, focused: string | null): { name: string; viewId: string; input: { focus?: { hsid: string } } } {
  return { name: v.name, viewId: v.viewId, input: focused ? { focus: { hsid: focused } } : {} };
}

/** What the fitted view truncates: ids, table cells, and row prose clamped to two lines (styles.css .mod-fit). */
export const TRUNCATABLE_SELECTOR = '.mod-fit .blk-tok, .mod-fit .blk-cell, .mod-fit .blk-row > .blk-prose';

/** The DOM surface markTruncated reads (a real element in the page; a fake in node tests). */
export interface TruncEl {
  scrollWidth: number;
  clientWidth: number;
  scrollHeight: number;
  clientHeight: number;
  textContent: string | null;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
}

/**
 * Mika 2026-10-23: a truncated id, cell or clamped title is reachable without a mouse. Exactly the items the CSS
 * actually cut get ONE tab stop each (tabindex 0, in DOM order) and their full text in title (the accessible
 * description); styles.css shows the whole text on :focus-visible. An item that fits again loses its stop.
 * Returns how many items are truncated now. Re-run after a render, a column resize or the fonts loading.
 */
export function markTruncated(els: Iterable<TruncEl>): number {
  let n = 0;
  for (const el of els) {
    const cut = el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1;
    if (cut) {
      n++;
      el.setAttribute('tabindex', '0');
      el.setAttribute('data-trunc', '');
      if (!el.getAttribute('title')) el.setAttribute('title', el.textContent ?? '');
    } else if (el.getAttribute('data-trunc') !== null) {
      el.removeAttribute('tabindex');
      el.removeAttribute('data-trunc');
    }
  }
  return n;
}

/** Whether a block tree holds a kit.Button anywhere (bounded depth). */
export function holdsButton(node: unknown, depth = 0): boolean {
  if (depth > 64 || !node || typeof node !== 'object') return false;
  if (Array.isArray(node)) return node.some((n) => holdsButton(n, depth + 1));
  const n = node as Record<string, unknown>;
  const t = typeof n.type === 'string' ? n.type : typeof n.block === 'string' ? n.block : '';
  if (t === 'Button' || t === 'kit.Button') return true;
  return holdsButton(n.children, depth + 1) || holdsButton(n.items, depth + 1) || holdsButton(n.data, depth + 1);
}

/** Aegis M2: the panel slot sits beside the kernel's decision keys, so a mod block there may carry no button at all. */
export const PANEL_BUTTON_REFUSAL = 'a kit.Button is not allowed in the panel slot or the Workshop (they sit beside the decision keys)';

/** The heading the right-pane mod region always shows, outside the stack's scroll area (Aegis M2). */
export const PANEL_HEADING = 'mods';

/** One fenced mod view: the label and dev chip are the GUI's; the body is the kit renderer over the mod's block. */
export function renderModFence(ctx: RenderCtx, v: ModPanelView, result: { block?: unknown; dev?: unknown } | null, refusal: string | null = null): MiniEl {
  const { doc } = ctx;
  const dev = v.dev || result?.dev === true;
  const fit = v.region !== 'workshop';
  // Aegis M2 + S5 M1: the panel slot sits beside the decision keys, and the Workshop region can be placed in a
  // column beside them too (right / left), so neither ever carries a kit.Button, whatever the placement
  if (refusal === null && (v.region === 'right' || v.region === 'workshop') && holdsButton(result?.block)) refusal = PANEL_BUTTON_REFUSAL;
  return h(
    doc,
    'section',
    { class: `mod-fence mod-region-${v.region}`, role: 'group', 'aria-label': `${fenceLabel(v.name)} ${v.viewId}`, 'data-mod': v.name, 'data-view': v.viewId },
    h(doc, 'header', { class: 'mod-fence-head' }, h(doc, 'small', { class: 'mod-label' }, `mod:${modLabel(v.name, v.publisherDisplay)}`), dev ? h(doc, 'span', { class: 'chip warn mod-dev', title: 'dev-linked mod (tier local)' }, 'dev') : null),
    // every fence but the Workshop's (its own placement rules) is fitted to its column: the same rules for every mod
    h(doc, 'div', { class: `mod-fence-body${fit ? ' mod-fit' : ''}` }, refusal !== null ? h(doc, 'small', { class: 'meta' }, `${v.viewId} unavailable: ${refusal}`) : renderBlock({ ...ctx, boxTitles: true, fit }, result?.block ?? null)),
  );
}

export interface SchedulerTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(t: unknown): void;
}

/**
 * Debounced, single-flight re-render. `row(kind)` ignores non-feed kinds; a feed row (re)starts the 250 ms
 * debounce; when it fires, one render runs; rows arriving during it queue exactly one follow-up render.
 */
export class ModPanelScheduler {
  readonly #render: () => Promise<void>;
  readonly #t: SchedulerTimers;
  readonly #ms: number;
  #timer: unknown = null;
  #inFlight = false;
  #again = false;
  renders = 0;

  constructor(render: () => Promise<void>, timers: SchedulerTimers, ms = MOD_PANEL_DEBOUNCE_MS) {
    this.#render = render;
    this.#t = timers;
    this.#ms = ms;
  }

  /** A live store row arrived. Returns true when it scheduled a render. */
  row(kind: unknown): boolean {
    if (!isFeedRow(kind)) return false;
    this.#arm();
    return true;
  }

  #focus: string | null | undefined = undefined;

  /** K3 (closes T-2026-10-20-008 (4)): the focused session changed ⇒ a render now. Returns true when it rendered. */
  focus(hsid: string | null): boolean {
    const first = this.#focus === undefined;
    const changed = this.#focus !== hsid;
    this.#focus = hsid;
    if (first || !changed) return false; // the mount render already used this focus
    this.now();
    return true;
  }

  /** A render now (mount / status change), still single-flight. */
  now(): void {
    if (this.#timer !== null) this.#t.clearTimeout(this.#timer);
    this.#timer = null;
    if (this.#inFlight) this.#againNow = true; // a focus change during a render: the follow-up runs at once, not debounced
    void this.#run();
  }

  #againNow = false;

  #arm(): void {
    if (this.#timer !== null) this.#t.clearTimeout(this.#timer);
    this.#timer = this.#t.setTimeout(() => {
      this.#timer = null;
      void this.#run();
    }, this.#ms);
  }

  async #run(): Promise<void> {
    if (this.#inFlight) {
      this.#again = true;
      return;
    }
    this.#inFlight = true;
    try {
      this.renders++;
      await this.#render();
    } catch {
      /* a failed render shows in its fence; the scheduler keeps going */
    } finally {
      this.#inFlight = false;
      if (this.#againNow) {
        this.#againNow = false;
        this.#again = false;
        void this.#run();
      } else if (this.#again) {
        this.#again = false;
        this.#arm();
      }
    }
  }
}
