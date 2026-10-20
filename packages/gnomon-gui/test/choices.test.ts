/**
 * #gui-table-talk clickable reply options (core/choices.ts; ui/app.ts wiring checked by source). Detection, the one
 * live reply, a trusted pick through the composer path, a draft never overwritten, and chips that can never pass for a
 * kernel decision key (Aegis).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHOICE_LABEL_MAX, choiceForKey, choiceMessage, liveChoiceKey, pickChoice, renderChoices, replyChoices, type ChoiceComposer } from '../src/core/choices.js';
import type { MiniDoc, MiniEl } from '../src/core/render.js';
import { chatItems, type Row } from '../src/core/store.js';

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

const REPLY = 'Was that meant for me?\n\nA  Yes, keep going and finish the thought.\nB  No, that was someone else talking.\n';

describe('#gui-table-talk replyChoices: detection', () => {
  it('finds a lettered run at the end of a reply, in every separator form, and strips it from the body', () => {
    const r = replyChoices(REPLY)!;
    expect(r.body).toBe('Was that meant for me?');
    expect(r.choices).toEqual([
      { key: 'A', label: 'Yes, keep going and finish the thought.' },
      { key: 'B', label: 'No, that was someone else talking.' },
    ]);
    for (const sep of [') ', '. ', ': ', ' ']) expect(replyChoices(`Which?\nA${sep}one\nB${sep}two\nC${sep}three`)?.choices.map((c) => c.key)).toEqual(['A', 'B', 'C']);
    expect(replyChoices('Which?\n1. one\n2. two')?.choices).toEqual([{ key: '1', label: 'one' }, { key: '2', label: 'two' }]);
    expect(replyChoices('Which?\n**A.** Patch the `check`\n**B** Rewrite *the* parser')?.choices.map((c) => c.label)).toEqual(['Patch the check', 'Rewrite the parser']);
  });
  it('the question may sit in the said-aloud line (the body is then only the options)', () => {
    expect(replyChoices('A  Yes\nB  No')).toBeNull();
    expect(replyChoices('A  Yes\nB  No', 'Was that meant for me?')?.choices).toHaveLength(2);
  });
  it('negative: a list in the middle, more than six, mixed or skipped numbering, one line, no question, an overlong label', () => {
    expect(replyChoices('Which?\nA  one\nB  two\n\nI will start with A unless you say otherwise.')).toBeNull();
    expect(replyChoices(`Which?\n${['1', '2', '3', '4', '5', '6', '7'].map((n) => `${n}. x`).join('\n')}`)).toBeNull();
    expect(replyChoices(`Which?\n${'ABCDEF'.split('').map((n) => `${n}. x`).join('\n')}`)?.choices).toHaveLength(6);
    expect(replyChoices('Which?\nA  one\n2  two')).toBeNull();
    expect(replyChoices('Which?\n1. one\nB. two')).toBeNull();
    expect(replyChoices('Which?\nA  one\nC  three')).toBeNull();
    expect(replyChoices('Which?\nB  one\nC  two')).toBeNull();
    expect(replyChoices('Which?\nA great plan is ready.')).toBeNull();
    expect(replyChoices('Done.\n1 file changed\n2 tests added')).toBeNull();
    expect(replyChoices(`Which?\nA  ${'x'.repeat(CHOICE_LABEL_MAX + 1)}\nB  no`)).toBeNull();
    expect(replyChoices(`Which?\nA  ${'x'.repeat(CHOICE_LABEL_MAX)}\nB  no`)).not.toBeNull();
    expect(replyChoices('Which?\na  lower\nb  case')).toBeNull();
  });
  it('labels go through the contracts sanitizer (a bidi override is shown, never hidden)', () => {
    const r = replyChoices('Which?\nA  yes‮gnp.exe\nB  no')!;
    expect(r.choices[0]!.label).not.toContain('‮');
    expect(choiceMessage(r.choices[1]!)).toBe('B — no');
  });
});

describe('#gui-table-talk only the latest reply is live', () => {
  const H = 'hs:01JAAAAAAAAAAAAAAAAAAAAAAA';
  const reply = (seq: number, text: string): Row => ({ seq, kind: 'turn.event', view: 'full', session: H, payload: { hsid: H, type: 'assistant', line: JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }) } }) as Row;
  const mine = (seq: number, text: string): Row => ({ seq, kind: 'composer', connId: 'local', session: H, payload: text }) as Row;
  it('the last assistant item with options; an older reply, or one the human already answered, is not', () => {
    const two = chatItems([reply(1, REPLY), reply(2, 'Which file?\n1. a.ts\n2. b.ts')]).items;
    expect(liveChoiceKey(two)).toBe(two[1]!.key);
    expect(liveChoiceKey(chatItems([reply(1, REPLY), mine(2, 'A — Yes, keep going and finish the thought.')]).items)).toBeNull();
    expect(liveChoiceKey(chatItems([reply(1, REPLY), reply(2, 'OK, finishing.')]).items)).toBeNull();
    const speak = chatItems([reply(1, '```speak\nWas that meant for me?\n```\n\nA  Yes\nB  No')]).items;
    expect(liveChoiceKey(speak)).toBe(speak[0]!.key);
  });
  it('inert chips are disabled, out of the tab order, and say so; live ones are focusable buttons', () => {
    const ch = replyChoices(REPLY)!.choices;
    const live = renderChoices(fdoc, '7', ch, { live: true, picked: null }) as FEl;
    const old = renderChoices(fdoc, '3', ch, { live: false, picked: null }) as FEl;
    const btn = (g: FEl) => g.all().filter((e) => e.tag === 'button');
    expect(live.className).toBe('choices live');
    expect(btn(live).every((b) => !b.attrs.has('disabled') && !b.attrs.has('tabindex'))).toBe(true);
    expect(old.className).toBe('choices inert');
    expect(btn(old).every((b) => b.attrs.has('disabled') && b.attrs.get('tabindex') === '-1')).toBe(true);
    const picked = renderChoices(fdoc, '7', ch, { live: true, picked: 'B' }) as FEl;
    expect(btn(picked).map((b) => [b.className, b.attrs.has('disabled')])).toEqual([['choice', true], ['choice picked', true]]);
  });
});

describe('#gui-table-talk a pick (Aegis)', () => {
  const composer = (value = '', dictationDraft = false): ChoiceComposer & { submits: number; focused: number } => {
    const c = { value, dictationDraft, submits: 0, focused: 0, submit: () => void c.submits++, focus: () => void c.focused++ };
    return c;
  };
  const at = { itemKey: '7', liveKey: '7', replyText: REPLY, choiceKey: 'A' };
  it('a trusted click sends the shown option text through the composer submit (an ordinary human message)', () => {
    const c = composer();
    expect(pickChoice({ isTrusted: true }, at, c)).toBe('sent');
    expect(c.value).toBe('A — Yes, keep going and finish the thought.');
    expect(c.submits).toBe(1);
  });
  it('an untrusted event, an older reply or a forged key sends nothing', () => {
    for (const [e, a] of [
      [{ isTrusted: false }, at],
      [{ isTrusted: true }, { ...at, itemKey: '3' }],
      [{ isTrusted: true }, { ...at, liveKey: null }],
      [{ isTrusted: true }, { ...at, choiceKey: 'Z' }],
    ] as const) {
      const c = composer();
      expect(pickChoice(e, a, c)).toBe('refused');
      expect([c.value, c.submits]).toEqual(['', 0]);
    }
  });
  it('a draft is never overwritten: the option goes after it and nothing is sent (a dictation draft too)', () => {
    const c = composer('let me think  ');
    expect(pickChoice({ isTrusted: true }, { ...at, choiceKey: 'B' }, c)).toBe('inserted');
    expect(c.value).toBe('let me think\nB — No, that was someone else talking.');
    expect([c.submits, c.focused]).toEqual([0, 1]);
    const d = composer('', true);
    expect(pickChoice({ isTrusted: true }, at, d)).toBe('inserted');
    expect(d.submits).toBe(0);
  });
  it('letter and number keys pick only with an empty composer', () => {
    const ch = replyChoices(REPLY)!.choices;
    expect(choiceForKey('b', ch, true)?.key).toBe('B');
    expect(choiceForKey('B', ch, false)).toBeNull();
    expect(choiceForKey('C', ch, true)).toBeNull();
    expect(choiceForKey('Enter', ch, true)).toBeNull();
  });
  it('chips never look like a kernel decision key: no key class, no data-decision, a style of their own', () => {
    const g = renderChoices(fdoc, '7', replyChoices(REPLY)!.choices, { live: true, picked: null }) as FEl;
    for (const e of g.all()) {
      expect(e.className.split(/\s+/)).not.toContain('key');
      expect([...e.attrs.keys()].some((k) => k === 'data-decision' || k === 'data-card-id' || k === 'data-command')).toBe(false);
    }
    expect(g.all().filter((e) => e.tag === 'button').map((b) => b.text)).toEqual(['A Yes, keep going and finish the thought.', 'B No, that was someone else talking.']);
    expect(CSS).toMatch(/\.choice \{[^}]*border: 1px dashed/);
    expect(CSS).not.toMatch(/\.choice[^{]*\{[^}]*--key-shadow/);
  });
  it('app.ts: picks run only from the live group, through the composer form submit; no hover, focus or voice trigger', () => {
    expect(APP).toContain("closest('.choices.live [data-choice]')");
    expect(APP).toContain("$<HTMLFormElement>('composer').requestSubmit()");
    const wiring = APP.slice(APP.indexOf('function onChoice'), APP.indexOf('function onChoice') + 2000);
    expect(wiring).toContain('pickChoice(e,');
    expect(APP).not.toMatch(/(mouseover|mouseenter|pointerenter|focusin)[^\n]*choice/i);
    expect(APP).not.toMatch(/voice[^\n]*pickChoice|pickChoice[^\n]*voice/i);
  });
});
