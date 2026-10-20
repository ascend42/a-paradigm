/**
 * @symbol #gui-table-talk
 *
 * Clickable reply options (founder ask 2026-10-20: "select one of the options right there in the chat"). PURE.
 *
 * Table talk (docs/guides/table-talk.md) ends a reply with ONE question, often answered by lettered options:
 *
 *   A  Yes, keep going and finish the thought.
 *   B  No, that was someone else talking.
 *
 * replyChoices finds such a run at the END of a reply; ui/app.ts renders it as choice chips under the latest reply of
 * the focused session. A pick is an ORDINARY human message sent through the composer (the kernel sees typed text):
 *
 * - the chips are built from MODEL text, so they never look like a kernel decision key: no `key` class, no
 *   data-decision, a dashed ink style of their own (Aegis);
 * - a pick needs a trusted gesture (isTrusted); nothing on hover, focus or voice;
 * - the sent words are exactly the shown option text (sanitised by the contracts sanitizer), never hidden content;
 * - at most CHOICE_MAX options, each label at most CHOICE_LABEL_MAX characters (else: no chips, plain text);
 * - a draft in the composer is never overwritten: the pick is inserted after it and nothing is sent.
 *
 * Voice: saying the letter is out of scope here (a voice pick would need the kernel's readback/echo path, like a
 * card's voice decision); this module never listens to voice rows.
 */
import { displayText, h, type MiniDoc, type MiniEl } from './render.js';

export const CHOICE_MAX = 6;
export const CHOICE_LABEL_MAX = 120;

export interface Choice {
  /** `A`..`F` or `1`..`6`, as the agent wrote it */
  key: string;
  /** the sanitised option text: what the chip shows and what a pick sends */
  label: string;
}

export interface ReplyChoices {
  /** the reply without the option lines (rendered as before) */
  body: string;
  choices: Choice[];
}

// `A  text`, `A) text`, `A. text`, `A: text`, optionally bold (`**A.** text`, `**A** text`)
const OPTION_LINE = /^[ \t]*(\*\*)?([A-F]|[1-6])(?:[).:](?:\*\*)?[ \t]+|(?:\*\*)?[ \t]+)(\S.*)$/;
const LETTERS = 'ABCDEF';
const DIGITS = '123456';

/** Markdown emphasis and code ticks out, whitespace collapsed, then THE one display sanitizer. */
function cleanLabel(s: string): string {
  const t = s
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(\S[^*_]*?)\1/g, '$2')
    .replace(/(^|[^A-Za-z0-9])[*_](\S[^*_]*?)[*_](?![A-Za-z0-9])/g, '$1$2')
    .replace(/\s+/g, ' ')
    .trim();
  return displayText(t).trim();
}

/**
 * The option run at the end of a reply, or null. The run is 2..CHOICE_MAX consecutive lines keyed A, B, C… or 1, 2,
 * 3… in order (one scheme, starting at A or 1), followed only by blank lines. A list in the middle of a reply, more
 * than six options, mixed or skipped keys, a label over CHOICE_LABEL_MAX, a single line, or no question mark in the
 * text above the run or in the reply's said-aloud line (`said`; "1 file changed / 2 tests added" is not a question) ⇒ null.
 */
export function replyChoices(text: string, said: string | null = null): ReplyChoices | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let end = lines.length;
  while (end > 0 && !lines[end - 1]!.trim()) end--;
  let start = end;
  while (start > 0 && OPTION_LINE.test(lines[start - 1]!)) start--;
  const run = lines.slice(start, end);
  if (run.length < 2 || run.length > CHOICE_MAX) return null;
  const before = lines.slice(0, start).join('\n');
  // table talk ends with ONE question: no question in the reply (or its said-aloud line) ⇒ a plain list, not options
  if (!before.includes('?') && !(said ?? '').includes('?')) return null;
  const scheme = /[A-F]/.test(OPTION_LINE.exec(run[0]!)![2]!) ? LETTERS : DIGITS;
  const choices: Choice[] = [];
  for (let i = 0; i < run.length; i++) {
    const m = OPTION_LINE.exec(run[i]!)!;
    const key = m[2]!;
    if (key !== scheme[i]) return null;
    const label = cleanLabel(m[3]!);
    if (!label || label.length > CHOICE_LABEL_MAX) return null;
    choices.push({ key, label });
  }
  return { body: before.trimEnd(), choices };
}

/** The message a pick sends (or inserts): `A — Yes, keep going and finish the thought.` */
export function choiceMessage(c: Choice): string {
  return `${c.key} — ${c.label}`;
}

/**
 * Which reply's chips are live: the LAST assistant item of the focused transcript, and only while the human has not
 * written after it. Every other reply's chips render inert.
 */
export function liveChoiceKey(items: ReadonlyArray<{ key: string; role: string; text: string; said?: string }>): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i]!;
    if (it.role === 'user') return null;
    if (it.role === 'assistant') return replyChoices(it.text, it.said ?? null) ? it.key : null;
  }
  return null;
}

/** The composer as a pick sees it: its text, and its submit (THE send path: the composer form's submit). */
export interface ChoiceComposer {
  value: string;
  /** the dictation draft counts as a draft even when the textarea is empty */
  dictationDraft: boolean;
  submit(): void;
  focus(): void;
}

export type PickOutcome = 'sent' | 'inserted' | 'refused';

/**
 * A pick. Refused unless the gesture is trusted, the reply is the live one and the choice is one of its own (the sent
 * text is rebuilt from the reply's parsed choices, never from the element). No draft ⇒ the option text goes into the
 * composer and the composer submits (an ordinary human message). A draft ⇒ the option is appended after it on its own
 * line and nothing is sent.
 */
export function pickChoice(
  e: { isTrusted: boolean },
  at: { itemKey: string; liveKey: string | null; replyText: string; said?: string | null; choiceKey: string },
  composer: ChoiceComposer,
): PickOutcome {
  if (!e.isTrusted || at.liveKey === null || at.itemKey !== at.liveKey) return 'refused';
  const c = replyChoices(at.replyText, at.said ?? null)?.choices.find((x) => x.key === at.choiceKey);
  if (!c) return 'refused';
  const msg = choiceMessage(c);
  if (composer.value.trim() || composer.dictationDraft) {
    composer.value = `${composer.value.replace(/\s+$/, '')}${composer.value.trim() ? '\n' : ''}${msg}`;
    composer.focus();
    return 'inserted';
  }
  composer.value = msg;
  composer.submit();
  return 'sent';
}

/** The choice a key press names in a live group (`a`/`A`, `1`), or null. Only when the composer is empty. */
export function choiceForKey(key: string, choices: readonly Choice[], composerEmpty: boolean): Choice | null {
  if (!composerEmpty || key.length !== 1) return null;
  const k = key.toUpperCase();
  return choices.find((c) => c.key === k) ?? null;
}

/**
 * The chips. Live: focusable buttons with data-choice / data-choice-item (never data-decision, never the `key` class).
 * Inert (an older reply) or picked: disabled; the picked one is marked. The text is the sanitised label, as sent.
 */
export function renderChoices(doc: MiniDoc, itemKey: string, choices: readonly Choice[], state: { live: boolean; picked: string | null }): MiniEl {
  const on = state.live && state.picked === null;
  return h(
    doc,
    'div',
    { class: `choices${on ? ' live' : ' inert'}`, role: 'group', 'aria-label': on ? 'Reply with one of these options' : 'Options (no longer live)' },
    h(doc, 'small', { class: 'choices-hint' }, on ? 'reply with' : state.picked !== null ? 'you replied' : 'options'),
    ...choices.map((c) => {
      const picked = state.picked === c.key;
      const attrs: Record<string, string> = { class: `choice${picked ? ' picked' : ''}`, type: 'button', 'data-choice': c.key, 'data-choice-item': itemKey, 'aria-label': `Reply ${choiceMessage(c)}`, title: on ? `Send “${choiceMessage(c)}” as your reply` : '' };
      if (!on) attrs['aria-disabled'] = 'true';
      if (!on) attrs.tabindex = '-1';
      if (picked) attrs['aria-pressed'] = 'true';
      const el = h(doc, 'button', attrs, h(doc, 'kbd', { class: 'choice-k' }, c.key), ' ', h(doc, 'span', { class: 'choice-t' }, c.label));
      if (!on) el.setAttribute('disabled', '');
      return el;
    }),
  );
}
