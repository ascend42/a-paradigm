/**
 * @symbol #gui-dim-clipboard
 *
 * The copy register of a board (boards S1.3, draft point 4 "copy and cut"; condition C8; Aegis A6). A paste never
 * reaches the engine and is never parsed: pasted text becomes one text node. Copying marks therefore goes through
 * this in-memory register: `copy` remembers the selected nodes and answers the plain text to put on the system
 * clipboard; a later paste whose text EQUALS that text adds clones. PURE: no DOM, no clipboard access, no timer;
 * the caller wires the events and calls `clear()` on window blur and at unmount.
 *
 * A6 rules, all held here:
 *  - an empty register text never matches (so a mark with no words is copied under a fixed stand-in line). Texts
 *    are compared with line ends normalised to LF, because a Windows clipboard hands back CRLF. A paste of the
 *    stand-in line when the register does not hold it (it was cleared on blur, or another copy replaced it) is
 *    answered `nothing-held`, so the leaf adds nothing and says so instead of pasting the line as words;
 *  - at most DIM_CLIPBOARD_LIMITS.clones clones;
 *  - `from`, `to` and `parent` are renamed to the clone when their target is in the copied set, and dropped otherwise;
 *  - every clone has a new id, and nothing but shape, words and colour is carried: the closed key list
 *    `DIM_CLIPBOARD_KEYS`. No author, no `refs`, no `rel`, no carried-through field. The paster is the author,
 *    because the clones are ordinary `add` ops that go through the validator and the mod like any edit.
 *
 * The equality can be forced by anything that can read or write the clipboard. It yields only clones of this
 * page's own earlier copy, validated and authored by whoever pastes.
 */
import { DIM_CORE_KINDS, DIM_NODE_KEYS, dimZCompare, dimZPlace } from '@a-company/gnomon-contracts';
import type { DimCoreKind, DimNode, DimOp, DimState } from '@a-company/gnomon-contracts';

export const DIM_CLIPBOARD_LIMITS = Object.freeze({ clones: 64, offset: 16 });
const LINK_KEYS: readonly string[] = ['from', 'to', 'parent'];
const DROPPED: readonly string[] = ['id', 'z', 'refs', 'rel', ...LINK_KEYS];
/** What a clone carries besides its new id, its new order key and its renamed links. */
export const DIM_CLIPBOARD_KEYS: readonly string[] = Object.freeze([...new Set(Object.values(DIM_NODE_KEYS).flat())].filter((k) => !DROPPED.includes(k)));

const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
const isCore = (k: unknown): k is DimCoreKind => typeof k === 'string' && (DIM_CORE_KINDS as readonly string[]).includes(k);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

interface Kept {
  id: string;
  z: unknown;
  fields: Record<string, unknown>;
  links: Record<string, string>;
}

export interface DimCopyResult {
  /** the plain text for the system clipboard ('' when nothing was copied) */
  text: string;
  copied: number;
  /** distinct ids asked for (a frame's children included) that were not copied: unknown, over the limit, or of a kind this build cannot write */
  skipped: number;
  /** the node ids the register took, in copied order: a cut deletes exactly these */
  ids: string[];
}

/**
 * What a paste is. `clones`: the text is the register's; add these ops. `text`: not the register's; the caller
 * pastes it as one text node. `nothing-held`: the text is the stand-in line of a copy this register no longer
 * holds; the caller adds nothing and says so.
 */
export type DimPasteResult = { kind: 'clones'; ops: DimOp[] } | { kind: 'text' } | { kind: 'nothing-held' };

/** The line a copy of marks with no words puts on the clipboard. */
export const dimStandInLine = (count: number): string => (count === 1 ? '(1 board mark)' : `(${count} board marks)`);
/** Every stand-in line a copy can produce (1 to the clone limit). */
const STAND_INS: ReadonlySet<string> = new Set(Array.from({ length: DIM_CLIPBOARD_LIMITS.clones }, (_, i) => dimStandInLine(i + 1)));
/** CRLF and lone CR to LF: the form texts are compared in. */
const lf = (text: string): string => text.replace(/\r\n?/g, '\n');

/** True when a node's box (or its point, for a mark with no size) lies inside a live frame's box. */
function landsIn(node: Record<string, unknown>, frame: Record<string, unknown> | undefined): boolean {
  if (!frame || own(frame, 'kind') !== 'frame') return false;
  const n = (o: Record<string, unknown>, k: string): number => (typeof own(o, k) === 'number' ? (own(o, k) as number) : 0);
  const [x, y, w, h] = [n(node, 'x'), n(node, 'y'), n(node, 'w'), n(node, 'h')];
  return x >= n(frame, 'x') && y >= n(frame, 'y') && x + w <= n(frame, 'x') + n(frame, 'w') && y + h <= n(frame, 'y') + n(frame, 'h');
}

export class DimClipboard {
  #text = '';
  #kept: Kept[] = [];
  #pastes = 0;
  /** the dimension the copy was made in: a `parent` outside the copied set is kept only on a paste into the same one */
  #dim: string | null = null;

  /**
   * Remember the selected nodes of `state` (in paint order, the first DIM_CLIPBOARD_LIMITS.clones of them) and
   * answer the text to put on the system clipboard: their words, one per line, or a fixed line when they have none.
   * Copying nothing clears the register.
   */
  copy(state: DimState, nodeIds: readonly string[]): DimCopyResult {
    this.clear();
    const asked = new Set(nodeIds);
    // a frame travels with its children: a copied or cut frame never comes back empty
    const frames = new Set([...asked].filter((id) => own(state.nodes.get(id)?.node ?? {}, 'kind') === 'frame'));
    if (frames.size > 0) for (const [id, n] of state.nodes) if (frames.has(own(n.node, 'parent') as string)) asked.add(id);
    const wanted = [...asked].filter((id) => state.nodes.has(id));
    const core = wanted.filter((id) => isCore(own(state.nodes.get(id)!.node, 'kind'))).sort((a, b) => dimZCompare({ z: own(state.nodes.get(a)!.node, 'z'), id: a }, { z: own(state.nodes.get(b)!.node, 'z'), id: b }));
    const taken = core.slice(0, DIM_CLIPBOARD_LIMITS.clones);
    if (taken.length === 0) return { text: '', copied: 0, skipped: asked.size, ids: [] };
    this.#dim = state.dim;
    const words: string[] = [];
    for (const id of taken) {
      const node = state.nodes.get(id)!.node;
      const keys = DIM_NODE_KEYS[node.kind as DimCoreKind];
      const fields: Record<string, unknown> = {};
      for (const k of DIM_CLIPBOARD_KEYS) if (keys.includes(k) && own(node, k) !== undefined) fields[k] = clone(own(node, k));
      const links: Record<string, string> = {};
      for (const k of LINK_KEYS) if (keys.includes(k) && typeof own(node, k) === 'string') links[k] = own(node, k) as string;
      this.#kept.push({ id, z: own(node, 'z'), fields, links });
      for (const k of ['text', 'label', 'title']) if (typeof fields[k] === 'string' && (fields[k] as string).length > 0) words.push(fields[k] as string);
    }
    this.#text = words.length > 0 ? lf(words.join('\n')) : dimStandInLine(taken.length);
    return { text: this.#text, copied: taken.length, skipped: asked.size - taken.length, ids: taken };
  }

  /** True when a pasted text is the register's. An empty register, or an empty text, never matches. */
  matches(text: unknown): boolean {
    return typeof text === 'string' && text.length > 0 && this.#text.length > 0 && this.#kept.length > 0 && lf(text) === this.#text;
  }

  /**
   * The `add` ops of a paste whose text matched; `text` when it did not (the caller then pastes the text as one
   * text node); `nothing-held` when it is a stand-in line this register does not hold. Clones sit DIM_CLIPBOARD_LIMITS.offset further down and right for each paste, on top of everything
   * in `current`, in their copied order; frames come first and arrows last so each op may cite an earlier one.
   * Nothing is validated here: the caller sends the ops through the live controller.
   */
  paste(text: unknown, current: DimState, mint: () => string): DimPasteResult {
    if (!this.matches(text)) return typeof text === 'string' && STAND_INS.has(lf(text).trim()) ? { kind: 'nothing-held' } : { kind: 'text' };
    this.#pastes += 1;
    const shift = DIM_CLIPBOARD_LIMITS.offset * this.#pastes;
    const ids = new Map(this.#kept.map((k) => [k.id, mint()]));
    let top: unknown = null;
    for (const [id, n] of current.nodes) if (top === null || dimZCompare({ z: top, id: '' }, { z: own(n.node, 'z'), id }) < 0) top = own(n.node, 'z');
    const ops: Array<{ tier: number; op: DimOp }> = [];
    for (const k of this.#kept) {
      const z = dimZPlace(top, null);
      top = z;
      const node: Record<string, unknown> = { ...clone(k.fields), id: ids.get(k.id), z };
      if (typeof node.x === 'number') node.x += shift;
      if (typeof node.y === 'number') node.y += shift;
      for (const [key, target] of Object.entries(k.links)) {
        const to = ids.get(target);
        if (to !== undefined && target !== k.id) node[key] = to;
        // a frame that was NOT copied but still stands in this same dimension keeps the clone that lands inside
        // it (`parent` only: `from` and `to` to a mark outside the copied set are always dropped)
        else if (key === 'parent' && to === undefined && this.#dim !== null && current.dim === this.#dim && landsIn(node, current.nodes.get(target)?.node)) node[key] = target;
      }
      ops.push({ tier: node.kind === 'frame' ? 0 : node.kind === 'arrow' ? 2 : 1, op: { type: 'add', node: node as unknown as DimNode } });
    }
    return { kind: 'clones', ops: ops.sort((a, b) => a.tier - b.tier).map((o) => o.op) };
  }

  /** True when something is held. */
  holds(): boolean {
    return this.#kept.length > 0;
  }

  /** Forget the register (window blur, unmount, a copy of nothing). */
  clear(): void {
    this.#text = '';
    this.#kept = [];
    this.#pastes = 0;
    this.#dim = null;
  }
}

/** A pasted text with a line over `over` characters is wrapped to a column `w` board units wide, centred on the paste point. */
export const DIM_PASTE_WRAP = Object.freeze({ over: 48, w: 360 });
/**
 * The one `add` op of a pasted text that is not the register's: a text node holding the words exactly as they were
 * pasted (line ends as LF; never parsed), with its top-left at `at` (the leaf gives the view centre) and on top of
 * everything in `current`. Nothing is validated here: the op goes through the live controller like any edit, so
 * the paster is its author.
 */
export function dimPasteTextOp(text: string, current: DimState, at: { x: number; y: number }, mint: () => string): DimOp {
  let top: unknown = null;
  for (const [id, n] of current.nodes) if (top === null || dimZCompare({ z: top, id: '' }, { z: own(n.node, 'z'), id }) < 0) top = own(n.node, 'z');
  const words = lf(text);
  // a long line is wrapped to a column instead of running off the board (pasted JSON is one line of thousands of characters)
  const long = words.split('\n').some((line) => line.length > DIM_PASTE_WRAP.over);
  return { type: 'add', node: { id: mint(), kind: 'text', x: Math.round(at.x - (long ? DIM_PASTE_WRAP.w / 2 : 0)), y: Math.round(at.y), z: dimZPlace(top, null), text: words, ...(long ? { w: DIM_PASTE_WRAP.w } : {}) } as unknown as DimNode };
}
