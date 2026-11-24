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
 *  - an empty register text never matches (so a mark with no words is copied under a fixed stand-in line);
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
  /** selected marks left out: over the limit, or of a kind this build cannot write */
  skipped: number;
}

export class DimClipboard {
  #text = '';
  #kept: Kept[] = [];
  #pastes = 0;

  /**
   * Remember the selected nodes of `state` (in paint order, the first DIM_CLIPBOARD_LIMITS.clones of them) and
   * answer the text to put on the system clipboard: their words, one per line, or a fixed line when they have none.
   * Copying nothing clears the register.
   */
  copy(state: DimState, nodeIds: readonly string[]): DimCopyResult {
    this.clear();
    const wanted = [...new Set(nodeIds)].filter((id) => state.nodes.has(id));
    const core = wanted.filter((id) => isCore(own(state.nodes.get(id)!.node, 'kind'))).sort((a, b) => dimZCompare({ z: own(state.nodes.get(a)!.node, 'z'), id: a }, { z: own(state.nodes.get(b)!.node, 'z'), id: b }));
    const taken = core.slice(0, DIM_CLIPBOARD_LIMITS.clones);
    if (taken.length === 0) return { text: '', copied: 0, skipped: nodeIds.length };
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
    this.#text = words.length > 0 ? words.join('\n') : taken.length === 1 ? '(1 board mark)' : `(${taken.length} board marks)`;
    return { text: this.#text, copied: taken.length, skipped: wanted.length - taken.length };
  }

  /** True when a pasted text is the register's. An empty register, or an empty text, never matches. */
  matches(text: unknown): boolean {
    return typeof text === 'string' && text.length > 0 && this.#text.length > 0 && this.#kept.length > 0 && text === this.#text;
  }

  /**
   * The `add` ops of a paste whose text matched, or null when it did not (the caller then pastes the text as one
   * text node). Clones sit DIM_CLIPBOARD_LIMITS.offset further down and right for each paste, on top of everything
   * in `current`, in their copied order; frames come first and arrows last so each op may cite an earlier one.
   * Nothing is validated here: the caller sends the ops through the live controller.
   */
  paste(text: unknown, current: DimState, mint: () => string): DimOp[] | null {
    if (!this.matches(text)) return null;
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
      }
      ops.push({ tier: node.kind === 'frame' ? 0 : node.kind === 'arrow' ? 2 : 1, op: { type: 'add', node: node as unknown as DimNode } });
    }
    return ops.sort((a, b) => a.tier - b.tier).map((o) => o.op);
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
  }
}
