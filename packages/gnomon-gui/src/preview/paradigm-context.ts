/**
 * @symbol #gui-preview
 * @symbol #paradigm-context-mod
 *
 * DEV ONLY (#gui-preview): the Paradigm Context sheet in the preview, through
 * the GUI's REAL mod-panel path (status.mods.views → mod.view → the fenced kit
 * render in the left pane's `sidebar` region). The fake kernel stands in for
 * #mod-host: it composes the input the way host.ts composeRelayedInput does
 * (the client's {focus:{hsid}} is joined to a fixture slice by hsid; any
 * other client key is ignored) and runs the REAL first-party mod's pure model
 * (packages/gnomon-mods/paradigm-context/model.mjs) over it.
 */
// @ts-ignore -- the mod is plain ESM with no types (its packageHash is pinned: no .d.ts may be added beside it)
import * as model from '../../../gnomon-mods/paradigm-context/model.mjs';

export const PARADIGM_CONTEXT_MOD = 'paradigm-context';
export const PARADIGM_CONTEXT_VIEW = 'paradigm-context.sheet';

const render = (model as unknown as { renderSheet(input: unknown, prefs?: unknown): Record<string, unknown> }).renderSheet;

/** The status.mods.views entry the kernel lists for the running mod. */
export const PARADIGM_CONTEXT_STATUS = Object.freeze({ views: [{ name: PARADIGM_CONTEXT_MOD, viewId: PARADIGM_CONTEXT_VIEW, slot: 'sidebar', placement: 'append', dev: false }] });

/** A mod.view answer as the host gives it: the host-composed input (focus → slice by hsid) through the real model. */
export function paradigmContextView(slices: Readonly<Record<string, unknown>>, params: Record<string, unknown>): { label: string; dev: boolean; block: Record<string, unknown> } {
  const input = params.input && typeof params.input === 'object' ? (params.input as Record<string, unknown>) : {};
  const focus = input.focus && typeof input.focus === 'object' ? (input.focus as Record<string, unknown>).hsid : undefined;
  const hsid = typeof focus === 'string' && Object.hasOwn(slices, focus) ? focus : null;
  const composed = hsid ? { hsid, paradigm: slices[hsid] } : { paradigm: { v: 'paradigm-slice:v1', state: 'unfocused' } };
  return { label: `mod:${PARADIGM_CONTEXT_MOD}`, dev: false, block: render(composed, {}) };
}
