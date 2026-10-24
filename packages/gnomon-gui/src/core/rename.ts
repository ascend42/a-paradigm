/**
 * @symbol #gui-session-rename
 *
 * #gui-session-rename (8.0:session-rename): the human renames a session inline, from the chat header (double-click
 * the title or press ✎) or the session list (double-click a row, or F2 on it), or with the palette's "Rename
 * session". PURE: the plan and the input binding; ui/app.ts mounts them.
 *
 *   - The input shows the name the human gave (empty when none) with the DERIVED title as its placeholder.
 *     Enter saves, Esc cancels, blur saves. A save settles once (the Enter that removes the input does not save
 *     again on its blur).
 *   - planRename previews the kernel's normalisation with the ONE contracts normalizeSessionName (the §4.5
 *     sanitizer): unchanged ⇒ nothing is sent; '' ⇒ the reset to the derived title; a refused name ⇒ a notice and
 *     nothing sent. The kernel normalises again and is the only truth: the GUI shows a name only once its
 *     session.renamed row arrives (store.ts folds it).
 *   - The request: log.append{kind:'request.session.rename', payload:{hsid, name}} on a trusted gesture, human
 *     connections only. A name is display text, never a capability: nothing routes by it.
 */
import { normalizeSessionName, SESSION_NAME_MAX, type SessionNameRefusal } from '@a-company/gnomon-contracts';

export const RENAME_REQUEST = 'request.session.rename' as const;

export function renameRequest(hsid: string, name: string): { kind: typeof RENAME_REQUEST; payload: { hsid: string; name: string } } {
  return { kind: RENAME_REQUEST, payload: { hsid, name } };
}

export type RenamePlan = { kind: 'none' } | { kind: 'send'; name: string } | { kind: 'refuse'; why: SessionNameRefusal; note: string };

/** What a typed name comes to, given the name on record (null = none). */
export function planRename(current: string | null | undefined, typed: string): RenamePlan {
  const n = normalizeSessionName(typed);
  if (!n.ok) return { kind: 'refuse', why: n.why, note: renameRefusalNote(n.why) };
  if (n.name === (current ?? '')) return { kind: 'none' };
  return { kind: 'send', name: n.name };
}

export function renameRefusalNote(why: SessionNameRefusal): string {
  switch (why) {
    case 'too-long':
      return `the name was not changed: at most ${SESSION_NAME_MAX} characters`;
    case 'control-character':
      return 'the name was not changed: it has a control character';
    case 'format-character':
      return 'the name was not changed: it has an invisible formatting character';
    default:
      return 'the name was not changed';
  }
}

/** The bits of an <input> the binding uses (a real HTMLInputElement in the page, a fake in the tests). */
export interface RenameInput {
  value: string;
  addEventListener(type: string, fn: (e: Event) => void): void;
  removeEventListener(type: string, fn: (e: Event) => void): void;
}

export interface RenameBinding {
  /** true once Enter, Esc or blur settled the edit */
  readonly settled: boolean;
  /** settle as a cancel without saving (the page focused another session, a repaint replaced the input) */
  cancel(): void;
}

/**
 * Bind Enter (save), Esc (cancel) and blur (save) on the rename input. Exactly one of onSave / onCancel runs, once.
 * Enter and Esc are consumed (no composer, palette or stop-speaking shortcut sees them); IME composition keys pass.
 */
export function bindInlineRename(input: RenameInput, on: { onSave: (value: string) => void; onCancel: () => void }): RenameBinding {
  let settled = false;
  const settle = (save: boolean): void => {
    if (settled) return;
    settled = true;
    input.removeEventListener('keydown', onKey);
    input.removeEventListener('blur', onBlur);
    if (save) on.onSave(input.value);
    else on.onCancel();
  };
  const onKey = (e: Event): void => {
    const k = e as Event & { key?: string; isComposing?: boolean };
    if (k.isComposing) return;
    if (k.key === 'Enter' || k.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      settle(k.key === 'Enter');
    }
  };
  const onBlur = (): void => settle(true);
  input.addEventListener('keydown', onKey);
  input.addEventListener('blur', onBlur);
  return {
    get settled() {
      return settled;
    },
    cancel: () => settle(false),
  };
}
