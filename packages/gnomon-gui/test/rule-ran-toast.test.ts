/**
 * C6'b2-2 (Mika, toast variant rule-ran; #gui-toast, #gui-slash-runs): an Always rule passed an MCP call with no card.
 * The pure parts (core/toasts.ts: the row, the words, the kind, the author, the Revoke request and its refusals), the
 * one-toast update (ui/toasts.ts handle.update), the destructive card's Always fold and Allow words (core/render.ts),
 * the taint row in the transcript (core/store.ts chatItems), and the wiring in app.ts (checked by source).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cardContentHash, isBrokeredCard, renderCard, toolScopesOf, type MiniDoc, type MiniEl } from '../src/core/render.js';
import { TAINT_LINE, taintsSession } from '../src/core/slash-runs.js';
import { chatItems, type Row } from '../src/core/store.js';
import { RULE_RAN_TOAST, ruleRanByMerge, ruleRanOf, ruleRanText, ruleRevokeFailWords, ruleRevokeRequest, TOAST_MAX } from '../src/core/toasts.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
const TOASTS_UI = readFileSync(path.join(ROOT, 'src', 'ui', 'toasts.ts'), 'utf8');
const H = 'hsid:v1:01HZZZZZZZZZZZZZZZZZZZZZZZ';
const KERNEL = 'p:0123abcd/kernel';

describe("C6'b2-2: the ran-by-rule toast (core/toasts.ts)", () => {
  it('ruleRanOf reads only approval.auto{modeRef rule:…} for an mcp: tool', () => {
    expect(ruleRanOf({ kind: 'approval.auto', payload: { hsid: H, tool: 'mcp:fs/write', inputHash: 'sha256:x', modeRef: 'rule:card:01J' } })).toEqual({ ruleId: 'card:01J', hsid: H, server: 'fs', tool: 'write', by: 'model' });
    expect(ruleRanOf({ kind: 'approval.auto', payload: { hsid: H, tool: 'Edit', path: 'a.ts', modeRef: 'mode:auto-edits' } })).toBeNull();
    expect(ruleRanOf({ kind: 'approval.auto', payload: { hsid: H, tool: 'kernel:gnomon_note', modeRef: 'rule:card:1' } })).toBeNull();
    expect(ruleRanOf({ kind: 'approval.auto.miss', payload: { hsid: H, tool: 'mcp:fs/write', modeRef: 'rule:card:1' } })).toBeNull();
    expect(ruleRanOf({ kind: 'approval.auto', payload: { hsid: H, tool: 'mcp:f‮s/write', modeRef: 'rule:card:1' } })!.server).not.toContain('‮');
  });

  it("C6'a2-4: WHO it ran for is the row's author: human is a / run, no author the model, anything else never human", () => {
    const row = (p: Record<string, unknown>) => ruleRanOf({ kind: 'approval.auto', payload: { hsid: H, tool: 'mcp:fs/write', inputHash: 'sha256:x', modeRef: 'rule:card:01J', callId: 'call:01HZZZZZZZZZZZZZZZZZZZZZZZ', ...p } })!;
    expect(row({ author: 'human' }).by).toBe('human');
    expect(row({}).by).toBe('model');
    expect(row({ author: 'Human' }).by).toBe('model');
    expect(row({ author: 'model' }).by).toBe('model');
  });

  it('the words: repeated passes in ONE toast; by you from / | by the model | by you and the model', () => {
    const t = { tool: 'write', server: 'fs' };
    expect(ruleRanText(t, 1, 'human')).toBe('ran by rule · write on fs · by you from /');
    expect(ruleRanText(t, 1, 'model')).toBe('ran by rule · write on fs · by the model');
    expect(ruleRanText(t, 4, 'both')).toBe('ran 4 times by rule · write on fs · by you and the model');
    expect(ruleRanByMerge('model', 'model')).toBe('model');
    expect(ruleRanByMerge('human', 'human')).toBe('human');
    expect(ruleRanByMerge('model', 'human')).toBe('both');
    expect(ruleRanByMerge('both', 'model')).toBe('both');
    expect(RULE_RAN_TOAST.keyName(t)).toBe('Revoke the rule for write on fs'); // Mika #6: the Revoke name never changes
  });

  it('a destructive rule (or one not placed) is warn; a mutate rule is info', () => {
    expect(RULE_RAN_TOAST.kind('destructive')).toBe('warn');
    expect(RULE_RAN_TOAST.kind(null)).toBe('warn');
    expect(RULE_RAN_TOAST.kind('mutate')).toBe('info');
  });

  it('Revoke removes the rule (no presence) and says so; refusals in words', () => {
    expect(ruleRevokeRequest('card:01J')).toEqual({ kind: 'request.rules.apply', payload: { changes: [{ ruleId: 'card:01J', op: 'remove' }] } });
    expect(RULE_RAN_TOAST.removed).toBe('rule removed; its next call takes a card');
    expect(ruleRevokeFailWords('not-found', false)).toBe('Not removed: the rule is already gone · next: look in Settings › Rules');
    expect(ruleRevokeFailWords(null, true)).toMatch(/^Not known whether the rule was removed/);
  });

  it('app.ts: one toast per rule, updated in place (never a flood past TOAST_MAX); Revoke once per trusted press', () => {
    expect(TOAST_MAX).toBe(3);
    expect(APP).toContain('ruleRanRow(r); // C6\'b2-2');
    expect(APP).toContain('const ruleToasts = new Map<string, { n: number; by: RuleRanBy; handle: ToastHandle }>()');
    // C6'a2-4: a deduped toast folds each pass's author in, so one that saw both says "by you and the model"
    expect(APP).toContain('had.by = ruleRanByMerge(had.by, t.by);');
    expect(APP).toContain('had.handle.update(ruleRanText(t, had.n, had.by))');
    expect(APP).toContain('toasts().show(ruleRanText(t, 1, entry.by), {');
    expect(APP).toContain('ariaLabel: RULE_RAN_TOAST.keyName(t),');
    expect(TOASTS_UI).toContain("if (o.key.ariaLabel) keyEl.setAttribute('aria-label', o.key.ariaLabel);");
    expect(APP).toContain('if (had?.handle.present) {');
    expect(APP).toContain("variant: 'rule-ran'");
    expect(APP).toContain("if (!e.isTrusted || !k || k.getAttribute('aria-disabled') === 'true') return;");
    expect(APP).toContain("entry.handle.update(RULE_RAN_TOAST.removed, { dropKey: true })");
    expect(APP).toContain("toolsSessionOf(t.hsid)?.access !== 'owner'");
    expect(TOASTS_UI).toContain('update(text: string, o?: { dropKey?: boolean }): void;');
  });
});

/* ── the destructive card: Allow · Touch ID and the one Always key with the kernel's line ─────────────────────────── */

class FEl {
  tagName: string;
  className = '';
  attrs = new Map<string, string>();
  kids: Array<FEl | FText> = [];
  constructor(t: string) {
    this.tagName = t.toUpperCase();
  }
  setAttribute(k: string, v: string): void {
    if (k === 'class') this.className = v;
    this.attrs.set(k, v);
  }
  appendChild(c: FEl | FText): void {
    this.kids.push(c);
  }
  append(...c: Array<FEl | FText>): void {
    this.kids.push(...c);
  }
  get text(): string {
    return this.kids.map((k) => k.text).join('');
  }
  all(): FEl[] {
    return this.kids.flatMap((k) => (k instanceof FEl ? [k, ...k.all()] : []));
  }
}
class FText {
  constructor(readonly text: string) {}
}
const fdoc = { createElement: (t: string) => new FEl(t), createTextNode: (s: string) => new FText(s) } as unknown as MiniDoc;

describe("C6'b2-2: the destructive brokered card", () => {
  const LINE = 'Always: any call of rm on server fs in this repo, any arguments, by you from / AND by the model without asking. It can delete or overwrite. Paused if the tool or server changes.';
  const detail = { tool: 'mcp:fs/rm', toolUseId: 't', requestId: 'r', inputHash: 'sha256:' + 'c'.repeat(64), repo: '/r', brokered: { server: 'fs', tool: 'rm', class: 'destructive', trust: 'trusted', bindHash: 'sha256:' + 'b'.repeat(64) }, toolScopes: ['tool'] };
  const base = { kind: 'permission', requestedBy: 'p:x/s-1', hsid: null, flags: ['irreversible'] };
  const block = { schemaVersion: 'display-block:v1', type: 'Box', children: [{ type: 'Text', text: 'The session asks to run mcp:fs/rm' }, { type: 'Text', text: 'class: destructive · by you from /' }, { type: 'Text', text: LINE }, { type: 'tool-scope', detail }] };
  const card = { ...base, block, contentHash: cardContentHash(base, detail) };
  const draw = (o: Record<string, unknown> = {}) => renderCard({ doc: fdoc }, { cardId: 'card:01J', kind: 'permission', requestedBy: 'p:x/s-1', hsid: null, repo: null, state: 'pending', contentHash: card.contentHash, flags: ['irreversible'], decisions: ['allow', 'deny', 'always'], decidable: true, rootRows: undefined, brokered: isBrokeredCard(block, 'mcp:fs/rm'), toolScope: toolScopesOf(card), alwaysOpen: true, ...o } as never, block) as unknown as FEl;

  it('toolScopesOf names it destructive with the kernel’s line, verbatim', () => {
    expect(toolScopesOf(card)).toEqual({ tool: 'rm', server: 'fs', destructive: true, alwaysLine: LINE });
  });

  it('the chip "can’t be undone" on its own line, then allow · Touch ID · deny · Always ▾; the fold holds ONE key with the kernel’s line as its note', () => {
    const el = draw();
    const keys = el.all().filter((e) => e.attrs.has('data-decision') || e.attrs.has('data-always-fold'));
    expect(keys.map((e) => e.text)).toEqual(['allow · Touch ID', 'deny', 'Always ▴', 'this tool, any arguments · Touch ID']); // Mika #5
    expect(keys[0]!.attrs.get('data-decision')).toBe('allow');
    // Mika #1, #2: the flag in words, never the code, on its own line above the key row
    const chip = el.all().find((e) => e.className.includes('flag-irreversible'))!;
    expect(chip.text).toBe('can’t be undone');
    const flags = el.all().find((e) => e.className === 'card-flags')!;
    expect(flags.all()).toContain(chip);
    const row = el.all().find((e) => e.className === 'card-keys')!;
    expect(row.all().some((e) => e.className.includes('flag'))).toBe(false);
    expect(el.all().indexOf(flags)).toBeLessThan(el.all().indexOf(row));
    const always = el.all().filter((e) => e.attrs.get('data-decision') === 'always');
    expect(always).toHaveLength(1);
    expect(always[0]!.attrs.get('data-scope')).toBe('tool');
    expect(always[0]!.attrs.get('aria-label')).toBe('Always: rm on fs · Touch ID');
    const note = el.all().find((e) => e.className === 'always-note')!;
    expect(note.text).toBe(LINE);
    expect(el.text.split(LINE).length).toBe(2); // once: the note, not again in the body
  });

  it('no Always when the kernel does not offer it', () => {
    const el = draw({ decisions: ['allow', 'deny'] });
    expect(el.all().some((e) => e.attrs.has('data-always-fold'))).toBe(false);
    expect(el.all().find((e) => e.attrs.get('data-decision') === 'allow')!.text).toBe('allow · Touch ID');
  });
});

/* ── taint: one transcript row ─────────────────────────────────────────────────────────────────────────────────── */

describe("C6'b2-2: taint in the transcript", () => {
  const at = '2026-10-28T12:00:00.000Z';
  it('one system row, where the session first took in a sent result or skill text; kernel rows only', () => {
    const rows: Row[] = [
      { seq: 1, kind: 'skill.run', session: H, principal: KERNEL, payload: { hsid: H, name: 'x', decision: 'refused' }, at },
      { seq: 2, kind: 'tool.result.sent', session: H, principal: 'p:0123abcd/somebody', payload: { hsid: H }, at },
      { seq: 3, kind: 'tool.result.sent', session: H, principal: KERNEL, payload: { hsid: H, policy: 'once' }, at },
      { seq: 4, kind: 'skill.run', session: H, principal: KERNEL, payload: { hsid: H, name: 'x', decision: 'ran' }, at },
      { seq: 5, kind: 'tool.result.sent', session: H, principal: KERNEL, payload: { hsid: H, policy: 'send' }, at },
    ];
    const its = chatItems(rows).items.filter((i) => i.text === TAINT_LINE);
    expect(its).toHaveLength(1);
    expect(its[0]).toMatchObject({ role: 'system', seq: 3 });
    expect(taintsSession(rows[3]!)).toBe(true);
    expect(taintsSession(rows[0]!)).toBe(false);
    expect(TAINT_LINE).toBe('Always rules for tools that can’t be undone are paused for the model in this session: it has read tool results or skill text. Your / runs are not affected.');
  });
});
