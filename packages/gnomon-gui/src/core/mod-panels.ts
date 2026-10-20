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
 *     `mod:<name>`, with a `dev` badge for a dev-linked (tier local) mod. The
 *     input is display context only: {focus:{hsid}} of the focused session
 *     (K3); the HOST joins that hsid to the live session repo server-side,
 *     the GUI never names a repo or a path. A focus change re-renders.
 *   - Aegis M2: the right-pane (panel) region carries a `mods` heading rule
 *     outside the decision stack's scroll area, and a block holding any
 *     kit.Button is refused there (shown as a refusal in its fence).
 *   - Re-render only on a live store row whose kind is a #mod-host FEED kind,
 *     debounced 250 ms, one render in flight (a row during a render queues
 *     exactly one more), never on a timer.
 */
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

export type ModRegion = 'desk-footer' | 'left-bottom' | 'right';
/** The only mod slots the GUI renders, and where. */
export const SLOT_REGIONS: Readonly<Record<string, ModRegion>> = Object.freeze({ 'composer.footer': 'desk-footer', sidebar: 'left-bottom', panel: 'right' });
export const MOD_PANEL_DEBOUNCE_MS = 250;
export const MAX_MOD_PANELS = 16;

const MOD_NAME = /^[a-z][a-z0-9-]{0,63}$/;
const VIEW_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/;

export interface ModPanelView {
  name: string;
  viewId: string;
  slot: string;
  region: ModRegion;
  dev: boolean;
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
    const region = Object.hasOwn(SLOT_REGIONS, slot) ? SLOT_REGIONS[slot]! : null;
    if (!region) continue;
    out.push({ name, viewId, slot, region, dev: dev === true });
    if (out.length >= MAX_MOD_PANELS) break;
  }
  return out;
}

/** The views of one region, in status order. */
export function panelsIn(views: readonly ModPanelView[], region: ModRegion): ModPanelView[] {
  return views.filter((v) => v.region === region);
}

/** The fence label: always `mod:<name>` (the kernel's label is checked against it, never trusted over it). */
export function fenceLabel(name: string): string {
  return `mod:${name}`;
}

/** Whether a live row should re-render the panels. */
export function isFeedRow(kind: unknown): boolean {
  return typeof kind === 'string' && MOD_FEED_KINDS.includes(kind);
}

/** The `mod.view` params for a panel: the focused session as {focus:{hsid}} (K3: the host joins it; never a repo or path). */
export function modViewParams(v: ModPanelView, focused: string | null): { name: string; viewId: string; input: { focus?: { hsid: string } } } {
  return { name: v.name, viewId: v.viewId, input: focused ? { focus: { hsid: focused } } : {} };
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
export const PANEL_BUTTON_REFUSAL = 'a kit.Button is not allowed in the panel slot (it sits beside the decision keys)';

/** The heading the right-pane mod region always shows, outside the stack's scroll area (Aegis M2). */
export const PANEL_HEADING = 'mods';

/** One fenced mod view: the label and dev badge are the GUI's; the body is the kit renderer over the mod's block. */
export function renderModFence(ctx: RenderCtx, v: ModPanelView, result: { block?: unknown; dev?: unknown } | null, refusal: string | null = null): MiniEl {
  const { doc } = ctx;
  const dev = v.dev || result?.dev === true;
  if (refusal === null && v.region === 'right' && holdsButton(result?.block)) refusal = PANEL_BUTTON_REFUSAL;
  return h(
    doc,
    'section',
    { class: `mod-fence mod-region-${v.region}`, role: 'group', 'aria-label': `${fenceLabel(v.name)} ${v.viewId}`, 'data-mod': v.name, 'data-view': v.viewId },
    h(doc, 'header', { class: 'mod-fence-head' }, h(doc, 'small', { class: 'mod-label' }, fenceLabel(v.name)), dev ? h(doc, 'span', { class: 'badge mod-dev', title: 'dev-linked mod (tier local)' }, 'dev') : null),
    h(doc, 'div', { class: 'mod-fence-body' }, refusal !== null ? h(doc, 'small', { class: 'meta' }, `${v.viewId} unavailable: ${refusal}`) : renderBlock(ctx, result?.block ?? null)),
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
    void this.#run();
  }

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
      if (this.#again) {
        this.#again = false;
        this.#arm();
      }
    }
  }
}
