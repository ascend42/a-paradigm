/**
 * @symbol #gui-ask-card
 *
 * The question card (design-system question-card; founder 2026-10-24: "regarding options that gnomon presents to the
 * user, even multi selections, it would be nice to click them"). PURE: a session's AskUserQuestion, answered by
 * clicking, on the ask-user card in the pinned zone (the chat column) and in the stack.
 *
 * On the wire (probe p-ask-2.1.309, claude 2.1.309, `--permission-prompt-tool stdio`): claude sends
 * `control_request{request:{subtype:'can_use_tool', tool_name:'AskUserQuestion', input:{questions:[{question, header,
 * options:[{label, description, preview?}], multiSelect}]}, tool_use_id, requires_user_interaction:true}}`; the host
 * answers `control_response{response:{subtype:'success', request_id, response:{behavior:'allow', updatedInput:{...input,
 * answers:{<question>: <answer>}}}}}`, a multi-select answer being the labels comma-separated. The kernel holds the
 * questions and builds that line (#supervisor); this module only composes the human's note (askNote, render.ts).
 *
 * Trust (Aegis C1, unchanged): the picker is built ONLY from the card's contentHash-verified structured detail
 * (askDetailOf), every string goes through THE display sanitizer as a text node (a preview is plain text in a <pre>,
 * never markup), and the answer is checked by the kernel against the questions it holds. Every pick, toggle and the
 * Submit key need a trusted gesture (ui/app.ts checks isTrusted); approve is human-only at the kernel. Voice adds no
 * path here: a voice answer stays the voice decision rules' (the allowlist's reversible `answer`).
 *
 * State: the page keeps one AskPicks per card (ui/app.ts askPicks) so a stack repaint, or the same card pinned and in
 * the pile, shows the same picks; it is dropped when the card leaves.
 */
import { h, type AskCardDetail, type AskCardQuestion, type AskPick, type MiniDoc, type MiniEl } from './render.js';

export type AskPicks = Map<number, AskPick>;

/** The keys that pick an option by position: 1..9 and a..i (the same option). */
const NUM_KEYS = '123456789';
const LETTER_KEYS = 'abcdefghi';

/** A fresh picks map: every question unanswered. */
export function emptyPicks(ask: AskCardDetail): AskPicks {
  return new Map(ask.questions.map((q) => [q.n, { chosen: [], free: '', other: false }]));
}

const pickOf = (picks: AskPicks, q: AskCardQuestion): AskPick => {
  let p = picks.get(q.n);
  if (!p) {
    p = { chosen: [], free: '', other: false };
    picks.set(q.n, p);
  }
  return p;
};

/**
 * Press option `opt` of question q: one pick ⇒ it is THE answer (Other and its text cleared); many ⇒ it toggles. An
 * index outside the question's options changes nothing (returns false).
 */
export function askPress(picks: AskPicks, q: AskCardQuestion, opt: number): boolean {
  if (!Number.isInteger(opt) || opt < 0 || opt >= q.options.length) return false;
  const p = pickOf(picks, q);
  if (q.multiSelect) p.chosen = p.chosen.includes(opt) ? p.chosen.filter((x) => x !== opt) : [...p.chosen, opt].sort((a, b) => a - b);
  else {
    p.chosen = [opt];
    p.other = false;
    p.free = '';
  }
  return true;
}

/** Press Other: one pick ⇒ the pick moves to Other (the typed text is the answer); many ⇒ Other toggles. */
export function askPressOther(picks: AskPicks, q: AskCardQuestion): void {
  const p = pickOf(picks, q);
  if (q.multiSelect) p.other = !p.other;
  else {
    p.chosen = [];
    p.other = true;
  }
}

/** Typing in a question's text field: the text is kept; typing makes Other the pick (one pick: the option is cleared). */
export function askType(picks: AskPicks, q: AskCardQuestion, text: string): void {
  const p = pickOf(picks, q);
  p.free = text;
  if (text.trim() !== '') {
    p.other = true;
    if (!q.multiSelect) p.chosen = [];
  }
}

/** The option a key press names in a question (1..9 / a..i ⇒ its index), `other` for the key after the last option, else null. */
export function askOptForKey(key: string, q: AskCardQuestion): number | 'other' | null {
  if (key.length !== 1) return null;
  const k = key.toLowerCase();
  const i = NUM_KEYS.includes(k) ? NUM_KEYS.indexOf(k) : LETTER_KEYS.includes(k) ? LETTER_KEYS.indexOf(k) : -1;
  if (i < 0) return null;
  if (i < q.options.length) return i;
  return i === q.options.length ? 'other' : null;
}

/** Arrow keys inside a question: the next stop among its options and Other (`count` = options + 1), wrapping; else null. */
export function askMove(key: string, at: number, count: number): number | null {
  if (count <= 0) return null;
  if (key === 'ArrowDown' || key === 'ArrowRight') return (at + 1 + count) % count;
  if (key === 'ArrowUp' || key === 'ArrowLeft') return (at - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/** Whether question q has an answer under these picks (what askNote would send for it). */
export function askAnswered(q: AskCardQuestion, picks: ReadonlyMap<number, AskPick>): boolean {
  const p = picks.get(q.n);
  if (!p) return false;
  if (p.free.trim() !== '' && (p.other !== false || !q.multiSelect)) return true;
  return p.chosen.some((i) => i >= 0 && i < q.options.length);
}

/** Every question answered: the Submit key is live. */
export function askComplete(ask: AskCardDetail, picks: ReadonlyMap<number, AskPick>): boolean {
  return ask.questions.length > 0 && ask.questions.every((q) => askAnswered(q, picks));
}

/** The preview a question shows: the focused option's, else the (first) picked one's; null ⇒ none to show. */
export function askPreviewOf(q: AskCardQuestion, picks: ReadonlyMap<number, AskPick>, focused: number | null): string | null {
  if (!q.previews.some((x) => x !== null)) return null;
  const at = focused !== null && focused >= 0 && focused < q.options.length ? focused : (picks.get(q.n)?.chosen[0] ?? null);
  return at === null ? null : (q.previews[at] ?? null);
}

export const ASK_COPY = Object.freeze({
  other: 'Other…',
  freeOne: 'or type your own answer',
  freeNone: 'type your answer',
  previewHint: 'move to an option to see its preview',
  noPreview: 'no preview for this option',
  submitOne: 'Submit',
  submitMany: 'Submit answers',
  incomplete: 'answer every question: pick an option or type an answer',
});

/** The Submit key's word for this card. */
export const askSubmitLabel = (ask: AskCardDetail): string => (ask.questions.length > 1 ? ASK_COPY.submitMany : ASK_COPY.submitOne);

/**
 * The picker: per question a group (radiogroup for one pick, group for many), the header chip and question, the
 * options as buttons (number key, label, description), Other, the text field, and a preview box when the question has
 * previews. Option buttons carry data-ask-card / data-ask-q / data-ask-opt (Other: data-ask-other) and never
 * data-decision: the card's one decision key is its Submit (renderCard).
 */
export function renderAskPicker(doc: MiniDoc, cardId: string, ask: AskCardDetail, picks: ReadonlyMap<number, AskPick>, focus: { q: number; opt: number } | null = null): MiniEl {
  return h(
    doc,
    'div',
    { class: 'ask-picker kernel-owned', 'data-ask-card': cardId },
    ...ask.questions.map((q) => {
      const p = picks.get(q.n) ?? { chosen: [], free: '', other: false };
      const role = q.multiSelect ? 'checkbox' : 'radio';
      const label = q.header ? `${q.header}: ${q.question}` : q.question;
      const hasPreview = q.previews.some((x) => x !== null);
      const shown = hasPreview ? askPreviewOf(q, picks, focus && focus.q === q.n ? focus.opt : null) : null;
      const opt = (j: number): MiniEl => {
        const on = p.chosen.includes(j);
        return h(
          doc,
          'button',
          { class: `ask-opt${on ? ' picked' : ''}`, type: 'button', role, 'aria-checked': String(on), 'data-ask-card': cardId, 'data-ask-q': String(q.n), 'data-ask-opt': String(j), ...(q.about[j] ? { title: q.about[j]! } : {}) },
          h(doc, 'kbd', { class: 'ask-k' }, j < NUM_KEYS.length ? NUM_KEYS[j]! : '·'),
          ' ',
          h(doc, 'span', { class: 'ask-l' }, q.options[j]!),
          q.about[j] ? ' ' : null,
          q.about[j] ? h(doc, 'small', { class: 'ask-d' }, q.about[j]!) : null,
        );
      };
      const n = q.options.length;
      const other = h(
        doc,
        'button',
        { class: `ask-opt ask-other${p.other ? ' picked' : ''}`, type: 'button', role, 'aria-checked': String(!!p.other), 'data-ask-card': cardId, 'data-ask-q': String(q.n), 'data-ask-other': '1' },
        h(doc, 'kbd', { class: 'ask-k' }, n < NUM_KEYS.length ? NUM_KEYS[n]! : '·'),
        ' ',
        h(doc, 'span', { class: 'ask-l' }, ASK_COPY.other),
      );
      const free = h(doc, 'input', {
        type: 'text',
        class: 'field ask-free',
        maxlength: String(ask.maxAnswerChars),
        'aria-label': `your own answer to question ${q.n}: ${q.question}`,
        placeholder: n ? ASK_COPY.freeOne : ASK_COPY.freeNone,
        value: p.free,
        'data-ask-card': cardId,
        'data-ask-q': String(q.n),
        'data-ask-free': '1',
      });
      return h(
        doc,
        'div',
        { class: `ask-q${q.multiSelect ? ' many' : ''}${hasPreview ? ' has-preview' : ''}`, role: q.multiSelect ? 'group' : 'radiogroup', 'aria-label': label, 'data-ask-q': String(q.n) },
        h(doc, 'p', { class: 'ask-head' }, q.header ? h(doc, 'span', { class: 'chip ask-h' }, q.header) : null, q.header ? ' ' : null, h(doc, 'span', { class: 'ask-text' }, q.question), q.multiSelect ? h(doc, 'small', { class: 'meta ask-many' }, ' · pick any') : null),
        h(doc, 'div', { class: 'ask-opts' }, ...q.options.map((_, j) => opt(j)), other, free),
        hasPreview ? h(doc, 'pre', { class: 'ask-preview', 'data-ask-preview': String(q.n), 'aria-live': 'polite', 'aria-label': `preview for question ${q.n}` }, shown ?? ASK_COPY.previewHint) : null,
      );
    }),
  );
}
