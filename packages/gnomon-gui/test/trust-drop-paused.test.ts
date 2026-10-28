/**
 * C5'b (8.0:local-lane, Mika): the drop toast (tool.trust{op:'dropped'}, warn, 10 s, Trust again…) and the Rules view's
 * paused rules (status.rules[].paused, K2): words by weight, never a hue, the keys unchanged, and the counts.
 */
import { describe, expect, it } from 'vitest';
import { TOAST_WARN_MS, toastTtl, trustDropToastOf, TRUST_DROP_TOAST } from '../src/core/toasts.js';
import { emptyRulesUi, pausedText, rulesBlock, rulesStatusOf, stateText } from '../src/core/rules.js';
import { ruleRowEl } from '../src/ui/rules-block.js';
import type { MiniDoc } from '../src/core/render.js';

const status = { mcp: { servers: [{ id: 'user::neurons', name: 'neurons' }], repos: [{ servers: [{ id: 'project:/r:tool', name: 'to‮ol' }] }] } };
const drop = (o: Record<string, unknown>) => ({ kind: 'tool.trust', payload: { id: 'user::neurons', label: 'neurons', op: 'dropped', binding: 'x', ...o } });

describe("C5'b drop toast", () => {
  it('fires on a drop because its tool list or its command changed, in the founder words, warn for 10 s', () => {
    expect(trustDropToastOf(drop({ why: 'tools-changed' }), status)).toEqual({ id: 'user::neurons', text: 'neurons changed (its tool list changed): Gnomon stopped trusting its tool labels. Its tools ask again; its Always rules are paused.' });
    expect(trustDropToastOf(drop({ why: 'launch-changed' }), status)!.text).toBe('neurons changed (its command changed): Gnomon stopped trusting its tool labels. Its tools ask again; its Always rules are paused.');
    expect(TRUST_DROP_TOAST).toEqual({ kind: 'warn', key: 'Trust again…' });
    expect(toastTtl(TRUST_DROP_TOAST.kind, false)).toBe(TOAST_WARN_MS);
  });

  it('disabled, cleared, set and other rows raise no toast', () => {
    expect(trustDropToastOf(drop({ why: 'disabled' }), status)).toBeNull();
    expect(trustDropToastOf(drop({ op: 'cleared', why: 'human' }), status)).toBeNull();
    expect(trustDropToastOf(drop({ op: 'set', why: 'human' }), status)).toBeNull();
    expect(trustDropToastOf({ kind: 'approval.rule.enabled', payload: { why: 'tools-changed', op: 'dropped', id: 'x' } }, status)).toBeNull();
  });

  it('the name is display text (a repo server, a bidi control shown as a mark); unknown id falls back to the label', () => {
    expect(trustDropToastOf(drop({ id: 'project:/r:tool', why: 'tools-changed' }), status)!.text).toMatch(/^to⟨RLO⟩ol changed/);
    expect(trustDropToastOf(drop({ id: 'user::gone', label: 'gone', why: 'tools-changed' }), status)!.text).toMatch(/^gone changed/);
  });

  it('the page wires it next to the rules expiry toast, kind warn with the key Trust again… opening the server row', async () => {
    const { readFileSync } = await import('node:fs');
    const app = readFileSync(new URL('../src/ui/app.ts', import.meta.url), 'utf8');
    expect(app).toContain('trustDropRow(r); //');
    expect(app).toMatch(/kind: TRUST_DROP_TOAST\.kind/);
    expect(app).toMatch(/settings\.open\(MCP_SECTION\)/);
  });
});

describe("C5'b paused rules (K2)", () => {
  const rule = (o: Record<string, unknown>) => ({ ruleId: `r-${String(o.ruleId ?? Math.random())}`, match: 'tool', tool: 'mcp:neurons/write', repoKey: 'k', repoName: 'app', words: 'any call of write on the neurons MCP server (any arguments)', learnedAt: '2026-10-28T10:00:00Z', hsid: null, state: 'on', ...o });
  const rs = (rules: unknown[]) => rulesStatusOf({ rules: { built: true, now: '2026-10-28T14:00:00Z', presets: {}, rules } });

  it('says why in words, the server as display text; an off rule stays off; unknown paused is ignored', () => {
    const s = rs([rule({ ruleId: 'a', paused: 'untrusted' }), rule({ ruleId: 'b', paused: 'changed' }), rule({ ruleId: 'c', paused: 'server-off', tool: 'mcp:ne‮urons/write' }), rule({ ruleId: 'd', state: 'off', paused: 'untrusted' }), rule({ ruleId: 'e', paused: 'bogus' })]);
    const [a, b, c, d, e] = s.rules;
    expect(stateText(a!, s.now)).toBe('paused: neurons isn’t trusted now');
    expect(stateText(b!, s.now)).toBe('paused: the tool changed');
    expect(stateText(c!, s.now)).toBe('paused: ne⟨RLO⟩urons is off');
    expect(stateText(d!, s.now)).toBe('off');
    expect(pausedText(e!)).toBeNull();
    expect(stateText(e!, s.now)).toBe('on');
  });

  it('counts: "3 rules · 1 off · 1 paused"; the row is .is-paused and keeps its keys; the kernel words show', () => {
    const s = rs([rule({ ruleId: 'a', paused: 'untrusted' }), rule({ ruleId: 'b', state: 'off' }), rule({ ruleId: 'c' })]);
    const v = rulesBlock(s, emptyRulesUi());
    expect(v.summary).toBe('3 rules · 1 off · 1 paused');
    expect(v.groups[0]!.paused).toBe(1);
    const row = v.groups[0]!.rows.find((r) => r.ruleId === 'a')!;
    expect(row).toMatchObject({ paused: true, state: 'paused: neurons isn’t trusted now', what: 'any call of write on the neurons MCP server (any arguments)' });
    expect(row.keys.map((k) => k.act)).toEqual(['off-menu', 'remove']);
    type El = { className: string; attrs: Map<string, string>; kids: unknown[]; appendChild(c: unknown): unknown; setAttribute(n: string, v: string): void };
    const doc = { createElement: () => ({ className: '', attrs: new Map(), kids: [], appendChild(c: unknown) { (this as El).kids.push(c); return c; }, setAttribute(n: string, v: string) { (this as El).attrs.set(n, v); } }), createTextNode: (t: string) => t } as unknown as MiniDoc;
    const li = ruleRowEl(doc, row) as unknown as El;
    expect(li.className).toContain('is-paused');
    expect(li.className).not.toContain('is-off');
  });
});
