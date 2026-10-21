/** #gui-session-rename (8.0:session-rename): the inline-edit core and the store fold of session.renamed. */
import { describe, expect, it } from 'vitest';
import { bindInlineRename, planRename, renameRequest } from '../src/core/rename.js';
import { derivedTitle, GuiStore, sessionFullTitle, sessionTitle, TITLE_MAX } from '../src/core/store.js';

const HSID = 'hsid:v1:01J00000000000000000000000';

class FakeInput extends EventTarget {
  value = '';
}
const key = (k: string): Event => Object.assign(new Event('keydown', { cancelable: true }), { key: k });

describe('bindInlineRename: Enter saves, Esc cancels, blur saves, once', () => {
  const rig = () => {
    const input = new FakeInput();
    const saved: string[] = [];
    let cancelled = 0;
    const b = bindInlineRename(input, { onSave: (v) => saved.push(v), onCancel: () => cancelled++ });
    return { input, saved, cancelled: () => cancelled, b };
  };
  it('Enter saves the value, and the blur the removal causes does not save again', () => {
    const t = rig();
    t.input.value = 'New name';
    const e = key('Enter');
    t.input.dispatchEvent(e);
    t.input.dispatchEvent(new Event('blur'));
    expect(t.saved).toEqual(['New name']);
    expect(e.defaultPrevented).toBe(true);
    expect(t.b.settled).toBe(true);
  });
  it('Esc cancels (no save, even on the blur after)', () => {
    const t = rig();
    t.input.value = 'typed';
    t.input.dispatchEvent(key('Escape'));
    t.input.dispatchEvent(new Event('blur'));
    expect(t.saved).toEqual([]);
    expect(t.cancelled()).toBe(1);
  });
  it('blur saves; other keys and IME composition do nothing', () => {
    const t = rig();
    t.input.dispatchEvent(key('a'));
    t.input.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Enter', isComposing: true }));
    expect(t.b.settled).toBe(false);
    t.input.value = 'by blur';
    t.input.dispatchEvent(new Event('blur'));
    expect(t.saved).toEqual(['by blur']);
  });
});

describe('planRename: the contracts normalisation, previewed', () => {
  it('unchanged sends nothing; a new name sends its normalised form; empty resets', () => {
    expect(planRename('Fix it', '  Fix   it ')).toEqual({ kind: 'none' });
    expect(planRename(null, '')).toEqual({ kind: 'none' });
    expect(planRename(null, '  New  one ')).toEqual({ kind: 'send', name: 'New one' });
    expect(planRename('Old', '   ')).toEqual({ kind: 'send', name: '' });
    expect(planRename(null, 'x'.repeat(81))).toMatchObject({ kind: 'refuse', why: 'too-long' });
    expect(planRename(null, 'a\u0007')).toMatchObject({ kind: 'refuse', why: 'control-character' });
    expect(renameRequest(HSID, 'n')).toEqual({ kind: 'request.session.rename', payload: { hsid: HSID, name: 'n' } });
  });
});

describe('the store folds session.renamed into the listing', () => {
  const row = (seq: number, kind: string, payload: Record<string, unknown>) => ({ seq, view: 'full', event: { kind, session: HSID, payload } });
  it('the name replaces the derived title (cut, full in the tooltip); "" resets; a malformed row is ignored', () => {
    const st = new GuiStore();
    st.apply([row(1, 'session.open', { hsid: HSID, cwd: '/r/proj' }), row(2, 'turn.sent', { hsid: HSID })]);
    const s = () => st.sessions.get(HSID)!;
    const derived = sessionTitle(s());
    st.apply([row(3, 'session.renamed', { hsid: HSID, name: 'A much longer name than the title shows here' })]);
    expect(s().name).toBe('A much longer name than the title shows here');
    expect([...sessionTitle(s())].length).toBe(TITLE_MAX);
    expect(sessionTitle(s()).endsWith('…')).toBe(true);
    expect(sessionFullTitle(s())).toBe('A much longer name than the title shows here');
    expect(derivedTitle(s())).not.toContain('much longer');
    st.apply([row(4, 'session.renamed', { hsid: HSID, name: ' bad' })]);
    expect(s().name).toBe('A much longer name than the title shows here');
    st.apply([row(5, 'session.renamed', { hsid: HSID, name: '' })]);
    expect(s().name).toBeNull();
    expect(sessionTitle(s())).toBe(derived);
  });
});
