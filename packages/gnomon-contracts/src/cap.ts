/**
 * @symbol #gnomon-contracts
 *
 * The Workshop cap (critique 2026-10-20 §2 S5.3): a CLOSED, minimal shape a mod may put on a kit `Text` node
 * (`{type:'Text', text, cap}`) so a client draws a hat instead of glyph text. The kernel's mod-block gate
 * (packages/gnomon/src/kernel/modhost/block.ts) refuses a block whose cap fails this check, and the GUI checks it
 * again before drawing (a client never trusts a relay). A client draws the hat from THESE FIELDS ONLY: a mod
 * never supplies SVG, a path, a colour or an attribute.
 *
 *   shape   'tall' | 'wide' | 'floppy'               the hat (the work type, picked by the mod)
 *   hue     integer 0..PROJECT_HUES-1               the project pigment (identity only, never state)
 *   filled  boolean                                  true = Claude, false = local (outlined)
 *   state   'needs' | 'working' | 'idle' | 'knot'   bobbing only while 'working'; violet only for 'knot'
 *   label   string, 1..CAP_LABEL_MAX code points     the question (needs) or the work word; one line, and
 *                                                    sanitised as display text at both ends
 *
 * The node's `text` stays the accessible (and reduced-motion) form. Every key is required; any other key is a
 * refusal. NOT an input to clientApiId, kitId or modAbiId (kitId hashes the block-name list only; the cap is a
 * refinement of kit:v1 `Text`, checked at both ends). Pure, no node:*.
 */
import { PROJECT_HUES } from './hue.js';

export const CAP_SHAPES = Object.freeze(['tall', 'wide', 'floppy'] as const);
export type CapShape = (typeof CAP_SHAPES)[number];
export const CAP_STATES = Object.freeze(['needs', 'working', 'idle', 'knot'] as const);
export type CapState = (typeof CAP_STATES)[number];
export const CAP_KEYS = Object.freeze(['shape', 'hue', 'filled', 'state', 'label'] as const);
export const CAP_LABEL_MAX = 40;

export interface Cap {
  shape: CapShape;
  hue: number;
  filled: boolean;
  state: CapState;
  label: string;
}

/** Check a mod-supplied cap. On success the result is a fresh object holding exactly the five keys. */
export function checkCap(v: unknown): { ok: true; cap: Cap } | { ok: false; why: string } {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, why: 'cap must be an object' };
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) return { ok: false, why: 'cap must be a plain object' };
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!(CAP_KEYS as readonly string[]).includes(k)) return { ok: false, why: `cap.${k} is not a cap field` };
  for (const k of CAP_KEYS) if (!Object.prototype.hasOwnProperty.call(o, k)) return { ok: false, why: `cap.${k} is required` };
  if (typeof o.shape !== 'string' || !(CAP_SHAPES as readonly string[]).includes(o.shape)) return { ok: false, why: `cap.shape must be one of ${CAP_SHAPES.join(' ')}` };
  if (typeof o.hue !== 'number' || !Number.isInteger(o.hue) || o.hue < 0 || o.hue >= PROJECT_HUES) return { ok: false, why: `cap.hue must be an integer 0..${PROJECT_HUES - 1}` };
  if (typeof o.filled !== 'boolean') return { ok: false, why: 'cap.filled must be a boolean' };
  if (typeof o.state !== 'string' || !(CAP_STATES as readonly string[]).includes(o.state)) return { ok: false, why: `cap.state must be one of ${CAP_STATES.join(' ')}` };
  if (typeof o.label !== 'string') return { ok: false, why: 'cap.label must be a string' };
  const n = [...o.label].length;
  if (n < 1 || n > CAP_LABEL_MAX) return { ok: false, why: `cap.label must be 1..${CAP_LABEL_MAX} characters` };
  if (/[\r\n\u2028\u2029]/.test(o.label)) return { ok: false, why: 'cap.label must be one line' };
  return { ok: true, cap: { shape: o.shape as CapShape, hue: o.hue, filled: o.filled, state: o.state as CapState, label: o.label } };
}
