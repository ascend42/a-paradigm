/**
 * Scoped edit `always` on the card (TD-2026-10-23-939 follow-up, Aegis 2026-10-23): an Edit/Write card whose kernel
 * detail offers editScopes renders "Always ▾", folding "this exact edit", "edits to this file" and "edits in this repo"
 * (noted "same as auto-edits for this repo"; each key named "Always: …"), only from the contentHash-verified edit-scope node; the clicked
 * key sends {kind:'file'} / {kind:'repo-edits'}.
 */
import { describe, expect, it } from 'vitest';
import { approveParamsOf, cardContentHash, EDIT_SCOPE_KEYS, editScopesOf, renderCard, type MiniDoc, type MiniEl } from '../src/core/render.js';

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

describe('scoped edit always keys', () => {
  const detail = { tool: 'Write', toolUseId: 't', requestId: 'r', inputHash: 'sha256:' + 'c'.repeat(64), repo: '/r', editScopes: ['file', 'repo-edits'], editPath: '/r/a.ts' };
  const base = { kind: 'permission', requestedBy: 'p:x/s-1', hsid: 'hsid:v1:01JABCDEFGHJKMNPQRSTVWXYZ0' };
  const block = { schemaVersion: 'display-block:v1', type: 'Box', children: [{ type: 'Text', text: 'path: /r/a.ts' }, { type: 'edit-scope', detail }] };
  const card = { ...base, block, contentHash: cardContentHash(base, detail) };
  it('reads only a verified node; renders the three keys in plain words; each sends its scope', () => {
    expect(editScopesOf(card)).toEqual(['file', 'repo-edits']);
    expect(editScopesOf({ ...card, contentHash: 'sha256:' + '0'.repeat(64) })).toBeNull();
    expect(editScopesOf({ ...card, block: { ...block, children: [{ type: 'edit-scope', detail: { ...detail, editScopes: ['everything'] } }] } })).toBeNull();
    expect(editScopesOf({ ...card, block: { ...block, children: [] } })).toBeNull();
    const v = { cardId: 'card:01J', kind: 'permission', requestedBy: base.requestedBy, hsid: null, repo: null, state: 'pending', contentHash: card.contentHash, flags: [], decisions: ['allow', 'deny', 'always'], decidable: true, editScopes: editScopesOf(card) };
    const el = renderCard({ doc: fdoc }, v, block) as unknown as FEl;
    const keys = el.all().filter((e) => e.attrs.get('data-decision') === 'always');
    expect(keys.map((e) => e.attrs.get('aria-label'))).toEqual(['Always: this exact edit', 'Always: edits to this file', 'Always: edits in this repo']);
    expect(keys.map((e) => e.text)).toEqual(['this exact edit', 'edits to this file', 'edits in this repo']);
    expect(keys[2]!.attrs.get('title')).toBe(EDIT_SCOPE_KEYS['repo-edits'].title);
    expect(EDIT_SCOPE_KEYS['repo-edits'].title).toContain('same as auto-edits for this repo');
    // Mika 2026-10-23: the row is Allow · Deny · Always ▾; the choices sit folded under it, each with its note visible
    // (never only in title=), and the fold key decides nothing
    const row = el.all().find((e) => e.className === 'card-keys')!;
    expect(row.all().filter((e) => e.tag === 'button').map((e) => e.text)).toEqual(['allow', 'deny', 'Always ▾']);
    const list = el.all().find((e) => e.className.startsWith('always-choices'))!;
    expect(list.className).toBe('always-choices');
    expect(list.attrs.get('role')).toBe('group');
    expect(list.all().filter((e) => e.className === 'always-note').map((e) => e.text)).toEqual(['only this same change', 'any change to this file', 'same as auto-edits for this repo']);
    expect(row.all().some((e) => e.attrs.has('data-always-fold') && e.attrs.has('data-decision'))).toBe(false);
    const open = renderCard({ doc: fdoc }, { ...v, alwaysOpen: true }, block) as unknown as FEl;
    expect(open.all().find((e) => e.className.startsWith('always-choices'))!.className).toBe('always-choices open');
    expect(open.all().find((e) => e.attrs.has('data-always-fold'))!.attrs.get('aria-expanded')).toBe('true');
    expect(keys.map((e) => approveParamsOf('card:01J', 'always', null, { scope: e.attrs.get('data-scope')! }).scope)).toEqual([{ kind: 'exact' }, { kind: 'file' }, { kind: 'repo-edits' }]);
    expect(approveParamsOf('card:01J', 'allow', null, { scope: 'repo-edits' })).toEqual({ cardId: 'card:01J', decision: 'allow' });
  });
});

import { ASK_WITH_EDIT_RULE_HELP, EDIT_RULE_REVOKE_LABEL, EDIT_RULE_REVOKE_NOTE, EDITS_BY_RULE_NARROW, menuEntries, modeChip, modeLabel, MODE_HELP, sessionModeOf } from '../src/core/modes.js';
describe('the mode chip while an "edits in this repo" rule stands', () => {
  const st = (o: Record<string, unknown>) => ({ runModes: { sessions: [{ hsid: 'h1', repo: 'r', chosen: 'ask', source: 'repo', repoMode: 'ask', ceiling: 'auto-edits', effective: 'ask', level: null, ...o }] } });
  it('reads "ask · edits by rule" on the chip (the whole phrase in its title) in ask only, and carries the rule id to revoke', () => {
    const v = sessionModeOf(st({ editsByRule: 'card:01J' }), 'h1')!;
    expect(v.editsByRule).toBe('card:01J');
    expect(modeChip(v)).toBe('ask · edits by rule ▾');
    expect(modeLabel(v)).toBe('mode: ask · edits allowed by rule ▾');
    // Mika 2026-10-23: ask's menu line stops claiming every write asks; the revoke entry names what it removes and its cost
    expect(menuEntries(v).find((e) => e.mode === 'ask')!.note).toBe(ASK_WITH_EDIT_RULE_HELP);
    expect(menuEntries(sessionModeOf(st({}), 'h1')!).find((e) => e.mode === 'ask')!.note).toBe(MODE_HELP.ask);
    expect(EDIT_RULE_REVOKE_LABEL).toBe('stop edits by rule');
    expect(EDIT_RULE_REVOKE_NOTE).toContain('no Touch ID');
    expect(EDITS_BY_RULE_NARROW).toBe(' ✓');
    expect(modeChip(sessionModeOf(st({}), 'h1'))).toBe('ask ▾');
    expect(modeChip(sessionModeOf(st({ editsByRule: 'card:01J', chosen: 'manual', effective: 'manual' }), 'h1'))).toBe('manual ▾');
  });
});
