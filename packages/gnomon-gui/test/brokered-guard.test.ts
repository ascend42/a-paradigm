/**
 * 8.0:local-lane C5'a3 interim guard: a brokered MCP card (its tool named `mcp:<server>/<tool>`, or its block carrying
 * the kernel's `{type:'tool-scope'}` node) offers `always` only with the tool scope, which a plain key never sends (the
 * broker refuses it). renderCard draws no plain `always` key on it; C5'b adds the scoped key. Other cards keep theirs.
 */
import { describe, expect, it } from 'vitest';
import { approveParamsOf, cardContentHash, isBrokeredCard, LOCAL_PRESENCE_LINE, renderCard, toolScopesOf, type MiniDoc, type MiniEl } from '../src/core/render.js';

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

describe("C5'b scoped Always on a brokered card (K1 node verified against the contentHash)", () => {
  const base = { kind: 'permission', requestedBy: 'p:x/s-1', hsid: null, flags: [] as string[] };
  const lines = [...text, { type: 'Text', text: 'Always: any call of mcp:srv/write in this repo, any arguments · paused if the tool or its server changes' }, { type: 'Text', text: 'server: untrusted · its labels are not believed' }];
  const blockOf = (d: unknown) => ({ schemaVersion: 'display-block:v1', type: 'Box', children: [...lines, { type: 'tool-scope', detail: d }] as unknown[] });
  const cardOf = (d: unknown, hashed: unknown = d) => ({ ...base, block: blockOf(d), contentHash: cardContentHash(base, hashed) });
  const draw = (card: Record<string, unknown>, o: Record<string, unknown> = {}) => renderCard({ doc: fdoc }, view({ contentHash: card.contentHash, brokered: isBrokeredCard(card.block, 'mcp:srv/write'), toolScope: toolScopesOf(card), ...o }) as never, card.block) as unknown as FEl;

  it('toolScopesOf: only the one verified node with toolScopes [tool] and a named server and tool', () => {
    expect(toolScopesOf(cardOf(detail))).toEqual({ tool: 'write', server: 'srv' });
    // forged: the node's detail differs from what the contentHash covers
    expect(toolScopesOf(cardOf({ ...detail, brokered: { ...detail.brokered, server: 'other' } }, detail))).toBeNull();
    expect(toolScopesOf({ ...cardOf(detail), contentHash: 'sha256:' + '0'.repeat(64) })).toBeNull();
    expect(toolScopesOf(cardOf({ ...detail, toolScopes: ['tool', 'any'] }))).toBeNull();
    expect(toolScopesOf(cardOf({ ...detail, toolScopes: undefined }))).toBeNull();
    const two = cardOf(detail);
    expect(toolScopesOf({ ...two, block: { ...two.block, children: [...two.block.children, { type: 'tool-scope', detail }] } })).toBeNull();
    // names are display text
    expect(toolScopesOf(cardOf({ ...detail, brokered: { ...detail.brokered, server: 's‮rv' } }))!.server).toBe('s⟨RLO⟩rv');
  });

  it('a verified node: Always ▾ folds ONE scoped key (data-scope tool), its words beside it; never a plain always key', () => {
    const el = draw(cardOf(detail), { alwaysOpen: true });
    expect(decisionKeys(el)).toEqual(['allow', 'deny', 'always']);
    expect(el.all().filter((e) => e.attrs.has('data-always-fold'))).toHaveLength(1);
    const always = el.all().filter((e) => e.attrs.get('data-decision') === 'always');
    expect(always).toHaveLength(1);
    expect(always[0]!.attrs.get('data-scope')).toBe('tool');
    expect(always[0]!.text).toBe('this tool, any arguments');
    expect(always[0]!.attrs.get('aria-label')).toBe('Always: write on srv, any arguments, in this repo');
    expect(el.text).toContain('every call of write on srv in this repo · paused if the tool or server changes');
    expect(el.text).toContain('server: untrusted');
  });

  it('a forged or mismatched node offers no Always, and the kernel’s "Always: any call of" line is dropped too', () => {
    const forged = { ...cardOf(detail), contentHash: 'sha256:' + '0'.repeat(64) };
    const el = draw(forged);
    expect(decisionKeys(el)).toEqual(['allow', 'deny']);
    expect(el.all().some((e) => e.attrs.has('data-always-fold'))).toBe(false);
    expect(el.text).not.toContain('Always: any call of');
    expect(el.text).toContain('server: untrusted');
    // a toolScope handed for a card that is not brokered is ignored (no fold from a stray field)
    const el2 = renderCard({ doc: fdoc }, view({ toolScope: { tool: 'x', server: 'y' } }) as never, plain) as unknown as FEl;
    expect(el2.all().some((e) => e.attrs.get('data-scope') === 'tool')).toBe(false);
  });

  it('approveParamsOf sends {kind:"tool"} for the scoped key; another decision sends no scope', () => {
    expect(approveParamsOf('card:1', 'always', null, { scope: 'tool' })).toEqual({ cardId: 'card:1', decision: 'always', scope: { kind: 'tool' } });
    expect(approveParamsOf('card:1', 'allow', null, { scope: 'tool' })).toEqual({ cardId: 'card:1', decision: 'allow' });
  });
});

describe("C5'b the trust grant card", () => {
  it('the ⊙ gnomon family, hand only · root key, the kernel lines on the face, the hash line in details and title=', () => {
    const block = { type: 'Box', children: ["Trust neurons's tool labels for local sessions", 'asked from Settings · 14:01 · applies to new sessions', "Trust neurons's tool labels? Gnomon will believe what neurons says about its tools. These run with no card: search.", 'launch sha256:aaa · tools sha256:bbb', 'Allow takes the root key and your presence (Touch ID or your Mac password) · never standing, never by voice; deny changes nothing'].map((t) => ({ type: 'Text', text: t })) };
    const el = renderCard({ doc: fdoc }, { cardId: 'card:T', kind: 'grant', requestedBy: 'p:abcdefgh/matt', hsid: null, repo: null, state: 'pending', contentHash: 'sha256:' + 'a'.repeat(64), flags: [], decisions: ['allow', 'deny'], decidable: true, rootRows: { lines: [], action: 'mcp.trust', rootDecisions: ['allow'], rows: [], rowsDigest: 'x', detail: {} } } as never, block) as unknown as FEl;
    const details = el.all().find((e) => e.tag === 'details')!;
    const face = el.children.filter((k) => k !== details).map((k) => (k instanceof FEl ? k.text : k.data)).join('\n');
    expect(face).toContain('⊙ gnomon');
    expect(face).toContain('hand only · root key');
    expect(face).toContain('These run with no card: search.');
    expect(face).toContain(LOCAL_PRESENCE_LINE);
    expect(face).not.toContain('launch sha256:aaa');
    expect(details.text).toContain('launch sha256:aaa · tools sha256:bbb');
    expect(el.all().find((e) => e.className.startsWith('k-line'))!.attrs.get('title')).toBe('launch sha256:aaa · tools sha256:bbb');
    expect(el.all().find((e) => e.className.startsWith('card-title'))!.text).toBe("Trust neurons's tool labels for local sessions");
  });
});
