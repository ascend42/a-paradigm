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
 *
 * Multi-select (#gui-ask-card, founder 2026-10-24: "even multi selections, it would be nice to click them"; design-system
 * model-text-control choice-multi): when the line just above a recognised run, or the reply's said line, asks for
 * several (MULTI_CUE: "pick any", "all that apply", "one or more", …), the chips toggle and one Send key sends the
 * toggled options as ONE human message (multiMessage: one `K — label` line each, in list order). The cue only changes
 * how a run replyChoices ALREADY recognised behaves; it never makes a list into options. The same trust rules hold: a
 * trusted gesture for every toggle and the send, the sent text rebuilt from the parsed choices, a draft never
 * overwritten, and a confirm-flagged label arms the Send key.
 */
import { sanitizeDisplayText } from '@a-company/gnomon-contracts';
import { displayText, h, type MiniDoc, type MiniEl } from './render.js';

export const CHOICE_MAX = 6;
export const CHOICE_LABEL_MAX = 120;
/** Aegis M1: a label longer than this, or with a backtick or shell-like text, needs a confirming second activation. */
export const CHOICE_CONFIRM_LEN = 60;
const SHELL_LIKE = /[|;&$<>]|&&|\b(?:rm|sudo|curl|wget|bash|sh|zsh|chmod|chown|eval|exec|npm|npx|git|ssh|scp)\b/;
/** Aegis L4: more than two combining marks on one base character (zalgo) ⇒ no chips. */
const MARK_PILE = /\p{M}{3,}/u;

export interface Choice {
  /** `A`..`F` or `1`..`6`, as the agent wrote it */
  key: string;
  /** the sanitised option text: what the chip shows and what a pick sends */
  label: string;
  /** Aegis M1: a pick needs a confirming second click / Enter (long, a backtick, or shell-like text) */
  confirm: boolean;
}

export interface ReplyChoices {
  /** the reply without the option lines (rendered as before) */
  body: string;
  choices: Choice[];
  /** the question asks for several (MULTI_CUE on the line above the run, or the said line): toggles + Send */
  multi: boolean;
}

/**
 * A question that asks for several options. Checked only on the last non-blank line above a recognised run and on the
 * said line: "Pick any of these:", "Which apply? Select all that apply.", "Choose one or more:", "(multi-select)".
 */
export const MULTI_CUE = /\b(?:(?:pick|choose|select|tick|check)\s+(?:any|all|several|multiple|as many)\b|all\s+that\s+apply\b|any\s+(?:of\s+(?:these|them|the\s+following)|combination)\b|one\s+or\s+more\b|multi-?select\b|as\s+many\s+as\s+you\s+(?:like|want)\b)/i;

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
  const above = lines.slice(0, start).reverse().find((l) => l.trim() !== '') ?? '';
  // table talk ends with ONE question: no question in the reply (or its said-aloud line) ⇒ a plain list, not options
  if (!before.includes('?') && !(said ?? '').includes('?')) return null;
  const scheme = /[A-F]/.test(OPTION_LINE.exec(run[0]!)![2]!) ? LETTERS : DIGITS;
  const choices: Choice[] = [];
  for (let i = 0; i < run.length; i++) {
    const m = OPTION_LINE.exec(run[i]!)!;
    const key = m[2]!;
    if (key !== scheme[i]) return null;
    const raw = m[3]!;
    // Aegis M2: anything the display sanitizer flags (bidi, controls, invisibles, …) ⇒ plain text only, no chips
    if (sanitizeDisplayText(raw).flags.length) return null;
    if (MARK_PILE.test(raw)) return null;
    const label = cleanLabel(raw);
    if (!label || label.length > CHOICE_LABEL_MAX) return null;
    choices.push({ key, label, confirm: label.length > CHOICE_CONFIRM_LEN || raw.includes('`') || SHELL_LIKE.test(raw) });
  }
  return { body: before.trimEnd(), choices, multi: MULTI_CUE.test(above) || MULTI_CUE.test(said ?? '') };
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

export type PickOutcome = 'sent' | 'inserted' | 'refused' | 'confirm';

/**
 * A pick. Refused unless the gesture is trusted, the reply is the live one and the choice is one of its own (the sent
 * text is rebuilt from the reply's parsed choices, never from the element). No draft ⇒ the option text goes into the
 * composer and the composer submits (an ordinary human message). A draft ⇒ the option is appended after it on its own
 * line and nothing is sent. A `confirm` choice (Aegis M1) answers 'confirm' until the same chip is activated again
 * (`armed` true): the caller marks it armed and asks for a second click / Enter.
 */
export function pickChoice(
  e: { isTrusted: boolean },
  at: { itemKey: string; liveKey: string | null; replyText: string; said?: string | null; choiceKey: string },
  composer: ChoiceComposer,
  armed = false,
): PickOutcome {
  if (!e.isTrusted || at.liveKey === null || at.itemKey !== at.liveKey) return 'refused';
  const c = replyChoices(at.replyText, at.said ?? null)?.choices.find((x) => x.key === at.choiceKey);
  if (!c) return 'refused';
  if (c.confirm && !armed) return 'confirm';
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

/** The message a multi-select send composes: the toggled options in list order, one `K — label` line each. */
export function multiMessage(choices: readonly Choice[], toggled: ReadonlySet<string>): string {
  return choices.filter((c) => toggled.has(c.key)).map(choiceMessage).join('\n');
}

/**
 * A toggle in a multi-select group: refused unless trusted, live, multi and one of the reply's own choices; returns
 * the new toggled set (a copy), or null when refused.
 */
export function toggleChoice(
  e: { isTrusted: boolean },
  at: { itemKey: string; liveKey: string | null; replyText: string; said?: string | null; choiceKey: string },
  toggled: ReadonlySet<string>,
): Set<string> | null {
  if (!e.isTrusted || at.liveKey === null || at.itemKey !== at.liveKey) return null;
  const r = replyChoices(at.replyText, at.said ?? null);
  if (!r?.multi || !r.choices.some((c) => c.key === at.choiceKey)) return null;
  const next = new Set([...toggled].filter((k) => r.choices.some((c) => c.key === k)));
  if (next.has(at.choiceKey)) next.delete(at.choiceKey);
  else next.add(at.choiceKey);
  return next;
}

/**
 * The Send key of a multi-select group. Refused unless trusted, live, multi and at least one toggled option of the
 * reply's own (the text is rebuilt from the parsed choices, never from the elements). A toggled confirm-flagged option
 * answers 'confirm' until the Send key is activated again (`armed`). No draft ⇒ the composed lines go into the
 * composer and it submits; a draft ⇒ they go after it and nothing is sent.
 */
export function pickChoices(
  e: { isTrusted: boolean },
  at: { itemKey: string; liveKey: string | null; replyText: string; said?: string | null },
  toggled: ReadonlySet<string>,
  composer: ChoiceComposer,
  armed = false,
): PickOutcome {
  if (!e.isTrusted || at.liveKey === null || at.itemKey !== at.liveKey) return 'refused';
  const r = replyChoices(at.replyText, at.said ?? null);
  if (!r?.multi) return 'refused';
  const picked = r.choices.filter((c) => toggled.has(c.key));
  if (!picked.length) return 'refused';
  if (picked.some((c) => c.confirm) && !armed) return 'confirm';
  const msg = multiMessage(r.choices, toggled);
  if (composer.value.trim() || composer.dictationDraft) {
    composer.value = `${composer.value.replace(/\s+$/, '')}${composer.value.trim() ? '\n' : ''}${msg}`;
    composer.focus();
    return 'inserted';
  }
  composer.value = msg;
  composer.submit();
  return 'sent';
}

/** The chip a key press names in a live group (`a`/`A`, `1`), or null; Aegis M1: it only MOVES focus there (Enter or
 * Space confirms). Only when the composer is empty. */
export function choiceForKey<T extends { key: string }>(key: string, choices: readonly T[], composerEmpty: boolean): T | null {
  if (!composerEmpty || key.length !== 1) return null;
  const k = key.toUpperCase();
  return choices.find((c) => c.key === k) ?? null;
}

/**
 * The chips. Live: focusable buttons with data-choice / data-choice-item (never data-decision, never the `key` class).
 * Inert (an older reply) or picked: disabled; the picked one is marked. The text is the sanitised label, as sent.
 * Multi (`state.multi`): each live chip is a toggle (aria-pressed, `toggled`), followed by ONE Send key
 * (data-choice-send) naming the count; once sent, every sent option is marked picked (`state.pickedSet`).
 */
export function renderChoices(
  doc: MiniDoc,
  itemKey: string,
  choices: readonly Choice[],
  state: { live: boolean; picked: string | null; armed?: string | null; multi?: boolean; toggled?: ReadonlySet<string> | null; pickedSet?: ReadonlySet<string> | null; sendArmed?: boolean },
): MiniEl {
  const multi = !!state.multi;
  const sent = multi ? (state.pickedSet ?? null) : null;
  const on = state.live && state.picked === null && sent === null;
  const toggled = on && multi ? (state.toggled ?? new Set<string>()) : new Set<string>();
  const hint = on ? (multi ? 'pick any, then send' : 'reply with') : state.picked !== null || sent !== null ? 'you replied' : 'options';
  return h(
    doc,
    'div',
    { class: `choices${multi ? ' multi' : ''}${on ? ' live' : ' inert'}`, role: 'group', 'aria-label': on ? (multi ? 'Reply with any of these options' : 'Reply with one of these options') : 'Options (no longer live)' },
    h(doc, 'small', { class: 'choices-hint' }, hint),
    ...choices.map((c) => {
      const picked = multi ? !!sent?.has(c.key) : state.picked === c.key;
      const armed = on && !multi && state.armed === c.key;
      const tog = toggled.has(c.key);
      const title = on ? (multi ? `${tog ? 'Take out' : 'Add'} “${choiceMessage(c)}”` : armed ? 'Click or press Enter again to send it' : `Send “${choiceMessage(c)}” as your reply`) : '';
      const attrs: Record<string, string> = { class: `choice${picked ? ' picked' : ''}${armed ? ' armed' : ''}${tog ? ' toggled' : ''}`, type: 'button', 'data-choice': c.key, 'data-choice-item': itemKey, 'aria-label': `${armed ? 'Press again to send: ' : multi ? '' : 'Reply '}${choiceMessage(c)}`, title };
      if (on && multi) attrs['aria-pressed'] = String(tog);
      if (!on) attrs['aria-disabled'] = 'true';
      if (!on) attrs.tabindex = '-1';
      if (picked) attrs['aria-pressed'] = 'true';
      const el = h(doc, 'button', attrs, h(doc, 'kbd', { class: 'choice-k' }, c.key), ' ', h(doc, 'span', { class: 'choice-t' }, c.label), armed ? h(doc, 'small', { class: 'choice-again' }, 'again to send') : null);
      if (!on) el.setAttribute('disabled', '');
      return el;
    }),
    on && multi
      ? h(
          doc,
          'button',
          {
            class: `choice-send${state.sendArmed ? ' armed' : ''}`,
            type: 'button',
            'data-choice-send': itemKey,
            ...(toggled.size ? {} : { 'aria-disabled': 'true' }),
            'aria-label': toggled.size ? `${state.sendArmed ? 'Press again to send ' : 'Send '}${toggled.size} option${toggled.size === 1 ? '' : 's'} as your reply` : 'Send: pick at least one option first',
            title: toggled.size ? (state.sendArmed ? 'Click or press Enter again to send them' : 'Send the options you picked as your reply') : 'Pick at least one option first',
          },
          toggled.size ? `Send ${toggled.size}` : 'Send',
          state.sendArmed ? h(doc, 'small', { class: 'choice-again' }, ' again to send') : null,
        )
      : null,
  );
}
