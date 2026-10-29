/**
 * #gui-rules-view (8.0:rules-view; Mika C1–C3): the pure core. Staging, the save bar's cost, the one request, the
 * refusal that keeps every change staged, the waiting card, the unsaved-close prompt, grouping, the filter and the
 * planned sizes (0, 1, 5, 50, 200), the kernel-clock presets and the expiry toast.
 */
import { describe, expect, it } from 'vitest';
import {
  afterSave,
  applyRequest,
  beforeClose,
  waitingText,
  discard,
  emptyRulesUi,
  expiryToastOf,
  FILTER_AT,
  FOLD_AT,
  presetLabel,
  reconcile,
  refusedResult,
  DESTRUCTIVE_LIMIT,
  rulesBlock,
  RULES_EMPTY,
  rulesStatusOf,
  SAVE_LABEL,
  saveCost,
  sinceText,
  stageOff,
  stageOn,
  stageRemove,
  toggleFold,
  toggleOffMenu,
  unstage,
  type RulesStatus,
} from '../src/core/rules.js';
import { rulesBlockEl } from '../src/ui/rules-block.js';

const NOW = '2026-10-23T14:07:00';
const at = (s: string) => new Date(s).toISOString();
const id = (n: number) => `card:01J${String(n).padStart(23, '0')}`;
const REPO_A = `sha256:${'a'.repeat(64)}`;
const REPO_B = `sha256:${'b'.repeat(64)}`;

function status(n: number, o: { offAt?: number[] } = {}): Record<string, unknown> {
  return {
    rules: {
      built: true,
      now: at(NOW),
      presets: { hour: at('2026-10-23T15:07:00'), tomorrow: at('2026-10-24T06:00:00'), manual: 'manual' },
      rules: Array.from({ length: n }, (_, i) => ({
        ruleId: id(i + 1),
        match: 'exact',
        tool: 'Bash',
        repoKey: i % 2 ? REPO_B : REPO_A,
        repoName: i % 2 ? 'billing' : 'a-paradigm',
        words: `this exact command: npm run task-${i + 1}`,
        learnedAt: at(`2026-10-${String(10 + (i % 14)).padStart(2, '0')}T12:${String(i % 60).padStart(2, '0')}:00`),
        state: o.offAt?.includes(i + 1) ? 'off' : 'on',
        ...(o.offAt?.includes(i + 1) ? { until: null } : {}),
      })),
    },
  };
}
const rs = (n: number, o?: { offAt?: number[] }): RulesStatus => rulesStatusOf(status(n, o));

describe('#gui-rules-view: staging and the save bar', () => {
  it('a tighten-only batch says "Save · no Touch ID"; any turn-on says it asks once', () => {
    const r = rs(3, { offAt: [3] });
    let ui = stageOff(emptyRulesUi(), id(1), 'hour', r);
    ui = stageRemove(ui, id(2));
    expect(saveCost(ui)).toBe('none');
    expect(rulesBlock(r, ui).saveBar).toEqual({ count: '2 changes', save: SAVE_LABEL.none, cost: 'none', busy: false });
    ui = stageOn(ui, id(3));
    expect(rulesBlock(r, ui).saveBar?.save).toBe('Save · asks Touch ID or your Mac password once');
    expect(SAVE_LABEL.none).toBe('Save · no Touch ID');
  });

  it('ONE request carries every change; an off keeps the kernel-clock time its label named', () => {
    const r = rs(3, { offAt: [3] });
    const ui = stageOn(stageRemove(stageOff(stageOff(emptyRulesUi(), id(1), 'hour', r), id(2), 'manual', r), id(2)), id(3));
    expect(applyRequest(ui)).toEqual({ kind: 'request.rules.apply', payload: { changes: [{ ruleId: id(1), op: 'off', until: at('2026-10-23T15:07:00') }, { ruleId: id(2), op: 'remove' }, { ruleId: id(3), op: 'on' }] } });
    expect(applyRequest(emptyRulesUi())).toBeNull();
  });

  it('staged rows say it in words (never ◆); a removed row stays, struck, with keep; undo and keep unstage', () => {
    const r = rs(2);
    let ui = stageRemove(stageOff(emptyRulesUi(), id(1), 'tomorrow', r), id(2));
    const rows = rulesBlock(r, ui).groups.flatMap((g) => g.rows);
    const one = rows.find((x) => x.ruleId === id(1))!;
    const two = rows.find((x) => x.ruleId === id(2))!;
    expect(one.staged).toBe('→ off until tomorrow');
    expect(one.keys).toEqual([{ act: 'undo', label: 'undo' }]);
    expect(two).toMatchObject({ removed: true, keys: [{ act: 'keep', label: 'keep' }] });
    expect(JSON.stringify(rows)).not.toContain('◆');
    ui = unstage(ui, id(2));
    expect(ui.staged.has(id(2))).toBe(false);
  });

  it('Turn off ▾ opens inline with three presets named by the kernel clock', () => {
    const r = rs(1);
    const ui = toggleOffMenu(emptyRulesUi(), id(1));
    const row = rulesBlock(r, ui).groups[0]!.rows[0]!;
    expect(row.keys[0]).toMatchObject({ act: 'off-menu', label: 'Turn off ▴', expanded: true });
    expect(row.presets.map((p) => p.label)).toEqual(['for 1 hour · until 15:07', 'until tomorrow · 06:00', 'until I turn it back on']);
    expect(presetLabel('hour', r)).toBe('for 1 hour · until 15:07');
  });

  it('a refusal leaves every change staged and says it in plain words with next:', () => {
    const r = rs(2);
    const ui = stageRemove(stageOff(emptyRulesUi(), id(1), 'hour', r), id(2));
    const res = refusedResult({ code: 'NOT_FOUND', reason: 'not-found', message: '#approval-broker: no standing always rule card:x', next: [], data: { hint: 'the list has changed: look again, then save' } });
    const after = { ...ui, saving: false, result: res };
    expect(after.staged.size).toBe(2);
    expect(res).toEqual({ kind: 'refused', text: 'A rule changed while you were editing; nothing was saved.', next: 'the list has changed: look again, then save' });
    // principle 5: no rule or card id, no symbol, no wire code in the line
    expect(refusedResult({ code: 'BAD_REQUEST', reason: null, message: '#approval-broker: card:01J…', next: [], data: {} }).text).toBe('Gnomon refused the change; nothing was saved.');
  });

  it('a card the same press could not decide: card waiting, what was saved, the waiting row has no second Turn on; then the card resolves', () => {
    const r = rs(2, { offAt: [2] });
    const ui = stageOn(stageOff(emptyRulesUi(), id(1), 'manual', r), id(2));
    const w = afterSave(ui, { cardId: id(900), decided: false });
    expect(w.result).toEqual({ kind: 'waiting', text: waitingText(1, 1) });
    expect(waitingText(1, 1)).toBe('1 change saved; 1 rule comes back on when you allow its card.');
    const row = rulesBlock(r, w).groups.flatMap((g) => g.rows).find((x) => x.ruleId === id(2))!;
    expect(row).toMatchObject({ staged: '→ on again when you allow its card', keys: [] });
    expect(w.staged.size).toBe(0);
    expect(w.waiting).toEqual({ cardId: id(900), ruleIds: [id(2)] });
    expect(reconcile(w, r, () => true)).toBe(w); // still pending: nothing changes
    const on = rulesStatusOf({ rules: { ...(status(2).rules as object) } });
    expect(reconcile(w, on, () => false).result?.kind).toBe('saved');
    expect(reconcile(w, r, () => false).result?.kind).toBe('refused');
    expect(afterSave(ui, { cardId: null, decided: null }).result).toEqual({ kind: 'saved', text: '2 changes.' });
  });

  it('closing with unsaved changes asks inline: "3 changes not saved · Save · Discard"', () => {
    const r = rs(3);
    const ui = stageRemove(stageRemove(stageRemove(emptyRulesUi(), id(1)), id(2)), id(3));
    const c = beforeClose(ui);
    expect(c.close).toBe(false);
    expect(rulesBlock(r, c.ui).closePrompt).toBe('3 changes not saved');
    expect(rulesBlock(r, c.ui).closeSave).toBe(SAVE_LABEL.none); // the prompt's Save names the same cost as the bar's
    expect(beforeClose(discard(c.ui)).close).toBe(true);
    expect(beforeClose(emptyRulesUi()).close).toBe(true);
  });
});

describe('#gui-rules-view: the list at 0, 1, 5, 50 and 200 rules', () => {
  it('0: the empty state words', () => {
    expect(rulesBlock(rs(0), emptyRulesUi())).toMatchObject({ empty: RULES_EMPTY, groups: [], saveBar: null, summary: '' }); // said once, not '0 rules' too
    expect(RULES_EMPTY).toBe('No Always rules yet. When you choose Always on a card, the rule shows here.');
  });
  it('1 and 5: grouped by repo with counts, newest first, no filter', () => {
    expect(rulesBlock(rs(1), emptyRulesUi()).groups).toHaveLength(1);
    const b = rulesBlock(rs(5, { offAt: [2] }), emptyRulesUi());
    expect(b.filter.shown).toBe(false);
    expect(b.groups.map((g) => [g.label, g.count, g.off])).toEqual([
      ['a-paradigm', 3, 0],
      ['billing', 2, 1],
    ]);
    const rows = b.groups[0]!.rows.map((r) => r.ruleId);
    expect(rows).toEqual([id(5), id(3), id(1)]);
    expect(b.summary).toBe('5 rules · 1 off · 2 repos');
  });
  it(`50 and 200: the filter shows above ${FILTER_AT}; it narrows by words or repo, never hides a staged row`, () => {
    expect(rulesBlock(rs(12), emptyRulesUi()).filter.shown).toBe(false);
    for (const n of [50, 200]) {
      const r = rs(n);
      const all = rulesBlock(r, emptyRulesUi());
      expect(all.filter.shown).toBe(true);
      // folded at FOLD_AT and up: every group shows its heading and count, no rows
      expect(all.groups.every((g) => g.folded && g.foldable && g.rows.length === 0)).toBe(true);
      expect(all.groups.reduce((k, g) => k + g.count, 0)).toBe(n);
      const ui = { ...stageRemove(emptyRulesUi(), id(2)), filter: 'task-17' };
      const f = rulesBlock(r, ui);
      expect(f.groups.flatMap((g) => g.rows.map((x) => x.ruleId)).sort()).toEqual([...r.rules.filter((x) => x.words.includes('task-17')).map((x) => x.ruleId), id(2)].sort());
      expect(rulesBlock(r, { ...emptyRulesUi(), filter: 'zzz' }).noMatch).toBe('No rule matches “zzz”.');
    }
  });
  it(`folded at ${FOLD_AT} rules (founder: "folded works"): groups start folded with their count; the heading unfolds; the filter unfolds what it matches; staged rows never hide`, () => {
    // under the threshold nothing folds
    const few = rulesBlock(rs(FOLD_AT - 1), emptyRulesUi());
    expect(few.groups.every((g) => !g.folded && !g.foldable)).toBe(true);
    const r = rs(FOLD_AT);
    const v = rulesBlock(r, emptyRulesUi());
    expect(v.groups.length).toBeGreaterThan(1);
    expect(v.groups.map((g) => [g.folded, g.rows.length])).toEqual(v.groups.map(() => [true, 0]));
    expect(v.summary).toContain(`${FOLD_AT} rules`);
    // the heading unfolds its group, and folds it again
    const g0 = v.groups[0]!;
    const open = toggleFold(emptyRulesUi(), g0.repoKey, false);
    const v2 = rulesBlock(r, open);
    expect(v2.groups[0]).toMatchObject({ folded: false, foldable: true });
    expect(v2.groups[0]!.rows.length).toBe(g0.count);
    expect(v2.groups[1]!.folded).toBe(true);
    expect(rulesBlock(r, toggleFold(open, g0.repoKey, true)).groups[0]!.folded).toBe(true);
    // the filter unfolds the matching groups (and only lists what matches)
    const f = rulesBlock(r, { ...emptyRulesUi(), filter: 'task-17' });
    expect(f.groups.length).toBeGreaterThan(0);
    expect(f.groups.every((g) => !g.folded && !g.foldable && g.rows.every((x) => x.what.includes('task-17')))).toBe(true);
    // a group holding a staged change stays unfolded; the others stay folded
    const st = rulesBlock(r, stageRemove(emptyRulesUi(), id(2)));
    const withStaged = st.groups.find((g) => g.rows.some((x) => x.ruleId === id(2)))!;
    expect(withStaged).toMatchObject({ folded: false, foldable: false });
    expect(st.groups.filter((g) => g !== withStaged).every((g) => g.folded)).toBe(true);
  });
  it('the fold key in the DOM: a button inside the heading with aria-expanded, the count visible, no list when folded', () => {
    const els: Array<{ tag: string; className: string; attrs: Map<string, string>; kids: unknown[] }> = [];
    const doc = { createElement: (tag: string) => { const e = { tag, className: '', attrs: new Map<string, string>(), kids: [] as unknown[], appendChild(c: unknown) { this.kids.push(c); return c; }, setAttribute(n: string, val: string) { this.attrs.set(n, val); } }; els.push(e); return e; }, createTextNode: (t: string) => t };
    rulesBlockEl(doc as never, rulesBlock(rs(FOLD_AT), emptyRulesUi()));
    const keys = els.filter((e) => e.className === 'rules-fold');
    expect(keys.length).toBeGreaterThan(1);
    expect(keys.every((k) => k.attrs.get('aria-expanded') === 'false' && k.attrs.get('data-rule-act') === 'fold')).toBe(true);
    expect(els.filter((e) => e.className === 'rules-list')).toHaveLength(0);
    expect(els.filter((e) => e.className === 'rules-count').length).toBe(keys.length);
  });
  it('since: today 12:53 · yesterday · Oct 19 (against the kernel now)', () => {
    expect(sinceText(at('2026-10-23T12:53:00'), at(NOW))).toBe('today 12:53');
    expect(sinceText(at('2026-10-22T09:00:00'), at(NOW))).toBe('yesterday');
    expect(sinceText(at('2026-10-19T09:00:00'), at(NOW))).toBe('Oct 19');
  });
  it('the expiry toast: "rule back on: <rule>" from a kernel enabled{cause:expired} row only', () => {
    const r = rs(1);
    expect(expiryToastOf({ kind: 'approval.rule.enabled', payload: { ruleId: id(1), cause: 'expired' } }, r)).toBe('rule back on: this exact command: npm run task-1');
    expect(expiryToastOf({ kind: 'approval.rule.enabled', payload: { ruleId: id(1), cause: 'human' } }, r)).toBeNull();
  });
  it('status.rules is read fail-safe', () => {
    expect(rulesStatusOf({}).built).toBe(false);
    expect(rulesStatusOf({ rules: { built: true, rules: [{ ruleId: 1 }] } }).rules).toEqual([]);
  });
});

describe("#gui-rules-view: C6'b2-2 destructive tool rules (K3 class)", () => {
  const tr = (n: number, cls: string | undefined, repo = REPO_A) => ({ ruleId: id(n), match: 'tool', tool: 'mcp:fs/rm', repoKey: repo, repoName: repo === REPO_A ? 'a-paradigm' : 'billing', words: `rm on fs, any arguments ${n}`, learnedAt: at('2026-10-23T12:00:00'), state: 'on', ...(cls ? { class: cls } : {}) });
  const st = (rules: unknown[]) => rulesStatusOf({ rules: { built: true, now: at(NOW), presets: {}, rules } });

  it('a destructive rule carries the chip "can’t be undone"; mutate and unknown carry none', () => {
    const v = rulesBlock(st([tr(1, 'destructive'), tr(2, 'mutate'), tr(3, 'weird')]), emptyRulesUi());
    const rows = v.groups[0]!.rows;
    expect(rows.find((r) => r.ruleId === id(1))!.chip).toBe('can’t be undone');
    expect(rows.find((r) => r.ruleId === id(2))!.chip).toBeNull();
    expect(rows.find((r) => r.ruleId === id(3))!.chip).toBeNull();
  });

  it('the group states the limit once, only when it holds a destructive rule', () => {
    const v = rulesBlock(st([tr(1, 'destructive'), tr(2, 'destructive'), tr(3, 'mutate', REPO_B)]), emptyRulesUi());
    expect(DESTRUCTIVE_LIMIT).toBe('rules that can’t be undone run for you and the model · at most 3 a minute per session, 30 a day per rule'); // Mika #3
    expect(v.groups.find((g) => g.repoKey === REPO_A)!.limit).toBe(DESTRUCTIVE_LIMIT);
    expect(v.groups.find((g) => g.repoKey === REPO_B)!.limit).toBeNull();
    const els: Array<{ className: string; kids: unknown[] }> = [];
    const doc = { createElement: (tag: string) => { const e = { tag, className: '', attrs: new Map<string, string>(), kids: [] as unknown[], appendChild(c: unknown) { this.kids.push(c); return c; }, setAttribute(n: string, val: string) { if (n === 'class') this.className = val; this.attrs.set(n, val); } }; els.push(e); return e; }, createTextNode: (t: string) => t };
    rulesBlockEl(doc as never, v);
    expect(els.filter((e) => e.className === 'meta rules-limit')).toHaveLength(1);
    expect(els.filter((e) => e.className === 'chip rule-chip')).toHaveLength(2);
  });
});
