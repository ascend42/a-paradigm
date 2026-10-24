/**
 * #gui-ask-card: the question card (design-system question-card). A session's AskUserQuestion on its ask-user card,
 * built from the contentHash-verified detail only: rendering (header, options with descriptions, many-pick toggles,
 * Other, previews, Submit), the picks reducer, the keyboard map, the note the kernel receives, and the app.ts wiring
 * (trusted gestures only, no voice path), checked by source.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ASK_COPY, askAnswered, askComplete, askMove, askOptForKey, askPress, askPressOther, askPreviewOf, askType, emptyPicks, renderAskPicker } from '../src/core/ask-card.js';
import { askDetailOf, askNote, cardContentHash, renderCard, type MiniDoc, type MiniEl } from '../src/core/render.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = readFileSync(path.join(ROOT, 'src', 'ui', 'app.ts'), 'utf8');
const CSS = readFileSync(path.join(ROOT, 'static', 'styles.css'), 'utf8');

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

/** The kernel's detail for the claude 2.1.309 probe request (permission.ts composePermission). */
const detail = {
  tool: 'AskUserQuestion', toolUseId: 'toolu_01', requestId: 'r-1', inputHash: 'sha256:' + 'c'.repeat(64), repo: '/r', maxAnswerChars: 1000,
  questions: [
    { question: 'Which date library?', header: 'Lib', multiSelect: false, options: [{ label: 'moment', description: 'Long-established, mutable.', preview: "import moment from 'moment';\nmoment().format();" }, { label: 'dayjs', description: 'Small, immutable.', preview: "import dayjs from 'dayjs';" }] },
    { question: 'Which features?', header: 'Features', multiSelect: true, options: [{ label: 'logging', description: 'Structured logs.' }, { label: 'metrics', description: null }, { label: 'tracing', description: 'Traces.' }] },
  ],
};
const base = { kind: 'ask-user', requestedBy: 'p:x/s-1', hsid: 'hsid:v1:01JABCDEFGHJKMNPQRSTVWXYZ0' };
const block = { schemaVersion: 'display-block:v1', type: 'Box', children: [{ type: 'Text', text: 'The session asks you 2 questions' }, { type: 'ask-user', detail }] };
const card = { ...base, block, contentHash: cardContentHash(base, detail) };
const ask = askDetailOf(card)!;
const [lib, feat] = ask.questions as [typeof ask.questions[0], typeof ask.questions[0]];

describe('#gui-ask-card detail (Aegis C1: only the verified node)', () => {
  it('reads descriptions and previews by option, null where none was given', () => {
    expect(lib).toEqual({ n: 1, question: 'Which date library?', header: 'Lib', multiSelect: false, options: ['moment', 'dayjs'], about: ['Long-established, mutable.', 'Small, immutable.'], previews: ["import moment from 'moment';\nmoment().format();", "import dayjs from 'dayjs';"] });
    expect(feat.about).toEqual(['Structured logs.', null, 'Traces.']);
    expect(feat.previews).toEqual([null, null, null]);
    // a non-text preview or description in the node ⇒ no picker (never a guess)
    for (const bad of [{ label: 'x', preview: 7 }, { label: 'x', description: 3 }]) {
      const d = structuredClone(detail) as unknown as { questions: Array<{ options: unknown[] }> };
      d.questions[0]!.options = [bad];
      const b = { ...block, children: [{ type: 'ask-user', detail: d }] };
      expect(askDetailOf({ ...base, block: b, contentHash: cardContentHash(base, d) })).toBeNull();
    }
  });
});

describe('#gui-ask-card rendering', () => {
  const picks = emptyPicks(ask);
  const el = renderAskPicker(fdoc, 'card:01J', ask, picks) as FEl;
  const opts = el.all().filter((e) => e.attrs.has('data-ask-opt'));
  it('a group per question: radiogroup for one pick, group for many, named by header and question', () => {
    const groups = el.all().filter((e) => e.className.startsWith('ask-q'));
    expect(groups.map((g) => [g.attrs.get('role'), g.attrs.get('aria-label')])).toEqual([['radiogroup', 'Lib: Which date library?'], ['group', 'Features: Which features?']]);
    expect(el.all().filter((e) => e.className === 'chip ask-h').map((e) => e.text)).toEqual(['Lib', 'Features']);
    expect(groups[1]!.text).toContain('pick any');
  });
  it('options are buttons (number key, label, description), radios for one pick and checkboxes for many; never a decision key', () => {
    expect(opts.map((b) => [b.tag, b.attrs.get('role'), b.attrs.get('aria-checked'), b.text])).toEqual([
      ['button', 'radio', 'false', '1 moment Long-established, mutable.'],
      ['button', 'radio', 'false', '2 dayjs Small, immutable.'],
      ['button', 'checkbox', 'false', '1 logging Structured logs.'],
      ['button', 'checkbox', 'false', '2 metrics'],
      ['button', 'checkbox', 'false', '3 tracing Traces.'],
    ]);
    for (const e of el.all()) expect(e.attrs.has('data-decision')).toBe(false);
    expect(el.className).toContain('kernel-owned');
  });
  it('Other is the last stop of each question (the next number), with a text field bounded by the kernel', () => {
    const other = el.all().filter((e) => e.attrs.has('data-ask-other'));
    expect(other.map((o) => o.text)).toEqual([`3 ${ASK_COPY.other}`, `4 ${ASK_COPY.other}`]);
    const free = el.all().filter((e) => e.attrs.get('data-ask-free'));
    expect(free.map((f) => f.attrs.get('maxlength'))).toEqual(['1000', '1000']);
  });
  it('a preview box only where the question has previews; plain text in a <pre>, the focused option first, then the picked one', () => {
    const pres = el.all().filter((e) => e.tag === 'pre');
    expect(pres).toHaveLength(1);
    expect(pres[0]!.attrs.get('data-ask-preview')).toBe('1');
    expect(pres[0]!.text).toBe(ASK_COPY.previewHint);
    const p = emptyPicks(ask);
    askPress(p, lib, 1);
    expect((renderAskPicker(fdoc, 'c', ask, p) as FEl).all().find((e) => e.tag === 'pre')!.text).toBe("import dayjs from 'dayjs';");
    const focused = (renderAskPicker(fdoc, 'c', ask, p, { q: 1, opt: 0 }) as FEl).all().find((e) => e.tag === 'pre')!;
    expect(focused.text).toBe("import moment from 'moment';\nmoment().format();");
    expect(focused.children.every((c) => c instanceof FText)).toBe(true); // never markup
    expect(askPreviewOf(feat, p, 0)).toBeNull();
    expect(CSS).toMatch(/\.ask-preview \{[^}]*white-space: pre-wrap;/);
  });
  it('the card: Submit is the one decision key, aria-disabled until every question is answered', () => {
    const v = { cardId: 'card:01J', kind: 'ask-user', requestedBy: base.requestedBy, hsid: null, repo: null, state: 'pending', contentHash: card.contentHash, flags: [], decisions: ['answer'], decidable: true, ask };
    const keyOf = (x: FEl) => x.all().find((e) => e.attrs.get('data-decision') === 'answer')!;
    const empty = keyOf(renderCard({ doc: fdoc }, v, block) as FEl);
    expect(empty.text).toBe(ASK_COPY.submitMany);
    expect(empty.attrs.get('aria-disabled')).toBe('true');
    const p = emptyPicks(ask);
    askPress(p, lib, 0);
    askPress(p, feat, 2);
    const done = keyOf(renderCard({ doc: fdoc }, { ...v, askPicks: p }, block) as FEl);
    expect(done.attrs.has('aria-disabled')).toBe(false);
    // the picks render as checked
    const shown = (renderCard({ doc: fdoc }, { ...v, askPicks: p }, block) as FEl).all().filter((e) => e.attrs.get('aria-checked') === 'true').map((e) => e.text);
    expect(shown).toEqual(['1 moment Long-established, mutable.', '3 tracing Traces.']);
    // one question: "Submit"
    const one = askDetailOf({ ...base, block: { ...block, children: [{ type: 'ask-user', detail: { ...detail, questions: [detail.questions[0]] } }] }, contentHash: cardContentHash(base, { ...detail, questions: [detail.questions[0]] }) })!;
    expect(keyOf(renderCard({ doc: fdoc }, { ...v, ask: one }, block) as FEl).text).toBe(ASK_COPY.submitOne);
  });
});

describe('#gui-ask-card picks and the note the kernel checks', () => {
  it('one pick: a press is THE answer; Other moves the pick to the typed text; typing clears the option', () => {
    const p = emptyPicks(ask);
    askPress(p, lib, 0);
    askPress(p, lib, 1);
    expect(p.get(1)).toMatchObject({ chosen: [1], other: false });
    askPressOther(p, lib);
    expect(p.get(1)).toMatchObject({ chosen: [], other: true });
    expect(askAnswered(lib, p)).toBe(false); // Other with no text is no answer
    askPress(p, lib, 0);
    askType(p, lib, 'luxon');
    expect(p.get(1)).toMatchObject({ chosen: [], other: true, free: 'luxon' });
    expect(askPress(p, lib, 9)).toBe(false); // outside the options: nothing
  });
  it('single, multi and Other notes: plain text for one question, JSON {answers} for several, multi comma-separated', () => {
    const p = emptyPicks(ask);
    expect(askNote(ask.questions, p)).toBeNull();
    askPress(p, lib, 1);
    askPress(p, feat, 2);
    askPress(p, feat, 0);
    expect(askComplete(ask, p)).toBe(true);
    expect(JSON.parse(askNote(ask.questions, p)!)).toEqual({ answers: { 'Which date library?': 'dayjs', 'Which features?': 'logging, tracing' } });
    askPress(p, feat, 0); // toggles off
    askType(p, feat, 'profiling');
    expect(JSON.parse(askNote(ask.questions, p)!)).toEqual({ answers: { 'Which date library?': 'dayjs', 'Which features?': 'tracing, profiling' } });
    askPressOther(p, feat); // Other off: its text no longer counts
    expect(JSON.parse(askNote(ask.questions, p)!).answers['Which features?']).toBe('tracing');
    askType(p, lib, 'luxon');
    expect(JSON.parse(askNote(ask.questions, p)!).answers['Which date library?']).toBe('luxon');
    // one question: the plain text
    expect(askNote([lib], p)).toBe('luxon');
  });
});

describe('#gui-ask-card keyboard', () => {
  it('numbers 1..9 and letters a..i name an option of the question; the next one is Other; anything else nothing', () => {
    expect(askOptForKey('1', lib)).toBe(0);
    expect(askOptForKey('b', lib)).toBe(1);
    expect(askOptForKey('B', lib)).toBe(1);
    expect(askOptForKey('3', lib)).toBe('other');
    expect(askOptForKey('4', lib)).toBeNull();
    expect(askOptForKey('c', feat)).toBe(2);
    expect(askOptForKey('d', feat)).toBe('other');
    for (const k of ['Enter', ' ', '0', 'z', 'Tab']) expect(askOptForKey(k, feat)).toBeNull();
  });
  it('arrows move among the stops (wrapping), Home and End jump; other keys are not moves', () => {
    expect(askMove('ArrowDown', 0, 3)).toBe(1);
    expect(askMove('ArrowRight', 2, 3)).toBe(0);
    expect(askMove('ArrowUp', 0, 3)).toBe(2);
    expect(askMove('ArrowLeft', 1, 3)).toBe(0);
    expect(askMove('Home', 2, 3)).toBe(0);
    expect(askMove('End', 0, 3)).toBe(2);
    expect(askMove('a', 0, 3)).toBeNull();
  });
  it('app.ts: presses and keys are trusted only, the note comes from the page picks, no voice path, typing never rebuilt', () => {
    const press = APP.slice(APP.indexOf('function onAskPress'), APP.indexOf('function onAskPress') + 400);
    expect(press).toContain('if (!e.isTrusted) return;');
    const input = APP.slice(APP.indexOf('function onAskInput'), APP.indexOf('function onAskInput') + 300);
    expect(input).toContain('!e.isTrusted');
    expect(APP).toContain("closest('.ask-picker [data-ask-opt], .ask-picker [data-ask-other]')");
    expect(APP).toMatch(/function askNoteFrom[\s\S]{0,200}askNote\(x\.ask\.questions, x\.picks\)/);
    expect(APP).not.toMatch(/voice[^\n]*onAskPress|onAskPress[^\n]*voice/i);
    // a key never acts inside the Other text field (only option buttons), except Enter, which submits through decide
    const key = APP.slice(APP.indexOf('function onAskKey'), APP.indexOf('function onAskFocus'));
    expect(key).toContain("'.ask-picker [data-ask-opt], .ask-picker [data-ask-other]'");
    expect(key).toMatch(/e\.key === 'Enter'[^\n]*e\.isTrusted/);
    expect(key).toContain("decide(f.dataset.askCard ?? '', 'answer'");
  });
});
