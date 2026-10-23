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
  CARD_WAITING,
  discard,
  emptyRulesUi,
  expiryToastOf,
  FILTER_AT,
  presetLabel,
  reconcile,
  refusedResult,
  rulesBlock,
  RULES_EMPTY,
  rulesStatusOf,
  SAVE_LABEL,
  saveCost,
  sinceText,
  stageOff,
  stageOn,
  stageRemove,
  toggleOffMenu,
  unstage,
  type RulesStatus,
} from '../src/core/rules.js';

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
    expect(res).toEqual({ kind: 'refused', text: 'A rule changed while you were editing; nothing was saved. no standing always rule card:x', next: 'the list has changed: look again, then save' });
  });

  it('a card the same press could not decide: "card waiting · Decide in the stack"; then the card resolves', () => {
    const r = rs(2, { offAt: [2] });
    const ui = stageOn(stageOff(emptyRulesUi(), id(1), 'manual', r), id(2));
    const w = afterSave(ui, { cardId: id(900), decided: false });
    expect(w.result).toEqual({ kind: 'waiting', text: CARD_WAITING });
    expect(w.staged.size).toBe(0);
    expect(w.waiting).toEqual({ cardId: id(900), ruleIds: [id(2)] });
    expect(reconcile(w, r, () => true)).toBe(w); // still pending: nothing changes
    const on = rulesStatusOf({ rules: { ...(status(2).rules as object) } });
    expect(reconcile(w, on, () => false).result?.kind).toBe('saved');
    expect(reconcile(w, r, () => false).result?.kind).toBe('refused');
    expect(afterSave(ui, { cardId: null, decided: null }).result).toEqual({ kind: 'saved', text: 'Saved: 2 changes' });
  });

  it('closing with unsaved changes asks inline: "3 changes not saved · Save · Discard"', () => {
    const r = rs(3);
    const ui = stageRemove(stageRemove(stageRemove(emptyRulesUi(), id(1)), id(2)), id(3));
    const c = beforeClose(ui);
    expect(c.close).toBe(false);
    expect(rulesBlock(r, c.ui).closePrompt).toBe('3 changes not saved');
    expect(beforeClose(discard(c.ui)).close).toBe(true);
    expect(beforeClose(emptyRulesUi()).close).toBe(true);
  });
});

describe('#gui-rules-view: the list at 0, 1, 5, 50 and 200 rules', () => {
  it('0: the empty state words', () => {
    expect(rulesBlock(rs(0), emptyRulesUi())).toMatchObject({ empty: RULES_EMPTY, groups: [], saveBar: null });
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
      expect(all.groups.reduce((k, g) => k + g.rows.length, 0)).toBe(n);
      const ui = { ...stageRemove(emptyRulesUi(), id(2)), filter: 'task-17' };
      const f = rulesBlock(r, ui);
      expect(f.groups.flatMap((g) => g.rows.map((x) => x.ruleId)).sort()).toEqual([...r.rules.filter((x) => x.words.includes('task-17')).map((x) => x.ruleId), id(2)].sort());
      expect(rulesBlock(r, { ...emptyRulesUi(), filter: 'zzz' }).noMatch).toBe('No rule matches “zzz”.');
    }
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
