/**
 * 8.0:loops (docs/specs/gnomon-loops.md §3.1, §3.3; build step 2): the GUI renders the two loop card kinds with the
 * generic card renderer. loop-trust is root class (ROOT_CLASS_BY_KIND mirrors the kernel's classes.ts): no Approve
 * unless the kernel's verified root-rows node is on the card. loop-choice shows its continue / stop keys and stamps
 * them by name. The loops view itself is build step 13.
 */
import { describe, expect, it } from 'vitest';
import { cardContentHash, renderCard, ROOT_CLASS_BY_KIND, rootRowsOf, stampWord, type MiniDoc, type MiniEl } from '../src/core/render.js';

class FText {
  constructor(readonly data: string) {}
}
class FEl implements MiniEl {
  className = '';
  readonly attrs = new Map<string, string>();
  readonly children: Array<FEl | FText> = [];
  constructor(readonly tag: string) {}
  appendChild(c: unknown): unknown {
    this.children.push(c as FEl | FText);
    return c;
  }
  setAttribute(n: string, v: string): void {
    this.attrs.set(n, v);
  }
  get text(): string {
    return this.children.map((c) => (c instanceof FText ? c.data : c.text)).join('');
  }
  all(): FEl[] {
    return [this, ...this.children.flatMap((c) => (c instanceof FEl ? c.all() : []))];
  }
}
const fdoc: MiniDoc = { createElement: (t) => new FEl(t), createTextNode: (s) => new FText(s) };

const C = 'card:01HZZZZZZZZZZZZZZZZZZZZZZZ';
const KERNEL = 'p:abcdefgh/kernel';
const keysOf = (el: FEl) => el.all().filter((e) => e.attrs.has('data-decision')).map((e) => e.attrs.get('data-decision'));

function card(kind: string, detail: Record<string, unknown>, rootNode: boolean) {
  const base = { cardId: C, kind, requestedBy: KERNEL, flags: [] as string[] };
  const contentHash = cardContentHash(base, detail);
  const children: unknown[] = [{ type: 'Text', text: `Trust loop flow-health` }, ...(rootNode ? [{ type: 'root-rows', rootDecisions: ['allow'], detail }] : [])];
  return { ...base, state: 'pending', contentHash, block: { schemaVersion: 'display-block:v1', type: 'Box', children } } as Record<string, unknown>;
}
const view = (c: Record<string, unknown>, decisions: string[]) => ({ cardId: C, kind: String(c.kind), requestedBy: KERNEL, hsid: null, repo: null, state: 'pending', contentHash: String(c.contentHash), flags: [], decisions, decidable: true, rootRows: rootRowsOf(c) });

describe('8.0:loops cards in the GUI', () => {
  it('loop-trust is root class in the GUI mirror, as in the kernel (allow)', () => {
    expect(ROOT_CLASS_BY_KIND['loop-trust']).toEqual(['allow']);
    expect(ROOT_CLASS_BY_KIND['loop-choice']).toBeUndefined();
  });

  it('a loop-trust card with the kernel\'s verified root-rows node renders and keeps Approve', () => {
    const c = card('loop-trust', { loopId: 'flow-health', rootRows: [], rootDecisions: ['allow'] }, true);
    const el = renderCard({ doc: fdoc }, view(c, ['allow', 'deny']), c.block) as FEl;
    expect(el.className).toContain('kind-loop-trust');
    expect(el.text).toContain('its decision row only');
    expect(keysOf(el)).toEqual(['allow', 'deny']);
  });

  it('a loop-trust card with no root-rows node fails closed: no Approve, deny stays', () => {
    const c = card('loop-trust', { loopId: 'flow-health' }, false);
    const el = renderCard({ doc: fdoc }, view(c, ['allow', 'deny']), c.block) as FEl;
    expect(rootRowsOf(c)).toBeNull();
    expect(keysOf(el)).toEqual(['deny']);
    expect(el.text).toContain('there is no Approve here');
  });

  it('a loop-choice card renders with its continue / stop keys (titled by its kind until the kernel composes it)', () => {
    const c = card('loop-choice', { loopId: 'green-typecheck', runId: 'run-1', nodeId: 'ask' }, false);
    const el = renderCard({ doc: fdoc }, view(c, ['continue', 'stop']), c.block) as FEl;
    expect(el.className).toContain('kind-loop-choice');
    expect(keysOf(el)).toEqual(['continue', 'stop']);
    expect(el.text).toContain('loop-choice');
  });

  it('the stamp names the loop-choice decision the kernel accepted', () => {
    expect(stampWord('continue')).toBe('CONTINUED');
    expect(stampWord('stop')).toBe('STOPPED');
  });
});
