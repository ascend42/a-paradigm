/**
 * @symbol #gui-offer-slip
 *
 * The margin slip's DOM (TD-2026-10-20-812 O1; core/offers.ts is the model). Mounted by ui/app.ts under the reply
 * that offered. It is model-adjacent, so it NEVER looks like a kernel decision key: a dashed edge, a soft shadow, no
 * `.key` class and no `data-decision`. The tab (glyph + `offer · mod:<name>`, L2: no per-mod hue) and the takes line
 * are GUI-drawn; ONLY the question is model text, and it is a text node (render.ts h(), never innerHTML).
 * Actions: Open (two-step, A5) and "not now"; the page accepts trusted events only (wireOfferSlips).
 */
import { h, type MiniDoc, type MiniEl } from '../core/render.js';
import { takesLine, traceText, type SlipView } from '../core/offers.js';
import { firstPartyName, modLabel } from '../core/mod-label.js';

/** First-party glyphs (ink only, never a hue), keyed by the name of a gnomon.* mod id; any other mod gets the generic ◇. */
const GLYPHS: Readonly<Record<string, string>> = Object.freeze({ constellation: '⁂', neurons: '◎', docs: '▤', atelier: '✎', paradigm: '≡', 'paradigm-context': '≡' });
export const glyphOf = (mod: string): string => {
  const n = firstPartyName(mod);
  return n !== null && Object.hasOwn(GLYPHS, n) ? GLYPHS[n]! : '◇';
};

export interface SlipState {
  armed: boolean;
  /** a spoken "open" was heard (L1) */
  voiceHint: boolean;
  /** ambient speech said "not now" (M2): it never acts, the slip asks for a click */
  ambientHint: boolean;
  /** first paint of this slip (slide-in) */
  arrive: boolean;
}

export function renderOfferSlip(doc: MiniDoc, v: SlipView, st: SlipState): MiniEl {
  const s = v.slip;
  const tab = (label: string): MiniEl => h(doc, 'div', { class: 'slip-tab' }, h(doc, 'span', { class: 'slip-g', 'aria-hidden': 'true' }, glyphOf(s.mod)), ' ', label);
  if (s.decided !== null) return h(doc, 'div', { class: 'slip gone', 'data-offer': s.offerId }, tab(traceText(s)));
  const on = v.live;
  const attrs: Record<string, string> = { class: `slip${on ? ' live' : ' inert'}${st.armed && on ? ' armed' : ''}${st.arrive ? ' arrive' : ''}`, role: 'group', 'aria-label': `offer from mod:${s.mod}`, 'data-offer': s.offerId };
  const btn = (cls: string, act: string, ...kids: Array<MiniEl | string>): MiniEl => {
    const a: Record<string, string> = { class: cls, type: 'button', 'data-offer-act': act, 'data-offer-id': s.offerId };
    if (!on) Object.assign(a, { 'aria-disabled': 'true', tabindex: '-1' });
    const el = h(doc, 'button', a, ...kids);
    if (!on) el.setAttribute('disabled', '');
    return el;
  };
  return h(
    doc,
    'div',
    attrs,
    tab(`offer · mod:${modLabel(s.mod)}`),
    h(doc, 'div', { class: 'slip-q' }, s.question),
    st.armed && on ? h(doc, 'div', { class: 'slip-ctx' }, takesLine(s.contextIn)) : null,
    on && st.voiceHint ? h(doc, 'div', { class: 'slip-hint' }, 'click or ↵ to open') : null,
    on && st.ambientHint ? h(doc, 'div', { class: 'slip-hint' }, 'click not now to dismiss') : null,
    h(
      doc,
      'div',
      { class: 'slip-acts' },
      btn('slip-open', 'open', h(doc, 'kbd', null, '↵'), st.armed && on ? 'Open now' : 'Open'),
      btn('slip-notnow', 'not-now', 'not now'),
      on ? h(doc, 'small', { class: 'slip-meta' }, 'or say “not now”') : null,
    ),
  );
}

/** Delegated slip events on the transcript: trusted clicks, and ↵ on a slip button. */
export function wireOfferSlips(root: HTMLElement, on: (act: 'open' | 'not-now', offerId: string, e: Event) => void): void {
  const fire = (e: Event): void => {
    if (!e.isTrusted) return;
    // Aegis M1: a held key's repeats and a double-click's second click are not second gestures
    if ((e as KeyboardEvent).repeat === true || (e.type === 'click' && (e as MouseEvent).detail > 1)) return;
    const b = (e.target as HTMLElement | null)?.closest('.slip.live [data-offer-act]') as HTMLElement | null;
    if (!b || b.hasAttribute('disabled')) return;
    e.preventDefault();
    e.stopPropagation();
    on(b.dataset.offerAct === 'open' ? 'open' : 'not-now', b.dataset.offerId ?? '', e);
  };
  root.addEventListener('click', fire, true);
  root.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') fire(e);
  }, true);
}
