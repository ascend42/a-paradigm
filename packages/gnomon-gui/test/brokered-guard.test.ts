/**
 * 8.0:local-lane C5'a3 interim guard: a brokered MCP card (its tool named `mcp:<server>/<tool>`, or its block carrying
 * the kernel's `{type:'tool-scope'}` node) offers `always` only with the tool scope, which a plain key never sends (the
 * broker refuses it). renderCard draws no plain `always` key on it; C5'b adds the scoped key. Other cards keep theirs.
 */
import { describe, expect, it } from 'vitest';
import { isBrokeredCard, renderCard, type MiniDoc, type MiniEl } from '../src/core/render.js';

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

const detail = { tool: 'mcp:srv/write', toolUseId: 't', requestId: 'r', inputHash: 'sha256:' + 'c'.repeat(64), repo: '/r', brokered: { server: 'srv', tool: 'write', class: 'mutate', trust: 'trusted', bindHash: 'sha256:' + 'b'.repeat(64) }, toolScopes: ['tool'] };
const text = [{ type: 'Text', text: 'The session asks to run mcp:srv/write' }, { type: 'Text', text: 'class: mutate · a brokered call from this local session to srv' }];
const withNode = { schemaVersion: 'display-block:v1', type: 'Box', children: [...text, { type: 'tool-scope', detail }] };
const plain = { schemaVersion: 'display-block:v1', type: 'Box', children: text };
const view = (o: Record<string, unknown> = {}) => ({ cardId: 'card:01J', kind: 'permission', requestedBy: 'p:x/s-1', hsid: null, repo: null, state: 'pending', contentHash: 'sha256:' + 'a'.repeat(64), flags: [], decisions: ['allow', 'deny', 'always'], decidable: true, ...o });
const decisionKeys = (el: FEl): string[] => el.all().filter((e) => e.attrs.has('data-decision')).map((e) => e.attrs.get('data-decision')!);

describe("C5'a3 interim guard: no plain always key on a brokered card", () => {
  it('isBrokeredCard: an mcp: tool, or a tool-scope node; nothing else', () => {
    expect(isBrokeredCard(plain, 'mcp:srv/write')).toBe(true);
    expect(isBrokeredCard(withNode)).toBe(true);
    expect(isBrokeredCard(withNode, 'Edit')).toBe(true);
    expect(isBrokeredCard(plain, 'Bash')).toBe(false);
    expect(isBrokeredCard(plain)).toBe(false);
    expect(isBrokeredCard(null, undefined)).toBe(false);
  });

  it('a card whose block carries the tool-scope node: allow and deny only, and the node renders as an empty span', () => {
    const el = renderCard({ doc: fdoc }, view(), withNode) as unknown as FEl;
    expect(decisionKeys(el)).toEqual(['allow', 'deny']);
    expect(el.all().some((e) => e.attrs.has('data-always-fold'))).toBe(false);
    expect(el.all().some((e) => e.className === 'blk blk-tool-scope')).toBe(true);
    expect(el.all().some((e) => e.className === 'blk blk-opaque')).toBe(false);
  });

  it('a card the page marks brokered (an mcp: tool, no node): no plain always key', () => {
    const el = renderCard({ doc: fdoc }, view({ brokered: isBrokeredCard(plain, 'mcp:srv/write') }), plain) as unknown as FEl;
    expect(decisionKeys(el)).toEqual(['allow', 'deny']);
  });

  it('a non-brokered card keeps its plain always key', () => {
    const el = renderCard({ doc: fdoc }, view({ brokered: isBrokeredCard(plain, 'Bash') }), plain) as unknown as FEl;
    expect(decisionKeys(el)).toEqual(['allow', 'deny', 'always']);
  });
});
