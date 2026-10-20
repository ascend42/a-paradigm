/**
 * @symbol #gnomon-voice
 *
 * What voice says out loud (spec §14 "speak only speakable content"; V2e).
 *
 * V2e: the KERNEL projects the speakable content and writes it as a row the voice reader can see:
 *   `voice.turn.agent{source:'kernel-speakable', turnSeq, items:[{kind:'reply'|'ask'|'edits', text}]}`.
 * The client speaks exactly those items (kernelSpeakable) and never reads `turn.event` (the voice projection
 * cannot see it). The client's OWN voice.turn.agent rows (playback windows {turnId, t0, t1, textPlanned,
 * textSpoken}, no `source`) are never spoken.
 *
 * SpeakableProjector below is the REFERENCE projection (what the kernel's speakable rows are expected to
 * contain: the gnome line or the first prose paragraph, "edited N files" at turn end, every ask-user question).
 * The client no longer runs it; the tests' fake kernel does.
 */

export type SpeakItem = { kind: 'reply'; text: string } | { kind: 'question'; text: string } | { kind: 'edits'; files: number; text: string };

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch', 'str_replace_based_edit_tool']);
const ASK_TOOLS = new Set(['AskUserQuestion', 'ask_user', 'AskUser']);
const MAX_SPOKEN_CHARS = 600;

function stripMarkdown(s: string): string {
  return s
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_)(\S[^*_]*?)\1/g, '$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeDiffOrOutput(line: string): boolean {
  return /^(diff --git|@@ |\+\+\+ |--- |index [0-9a-f]{6,})/.test(line) || /^\s*[+-]\S/.test(line) || /^\s*\$ /.test(line);
}

/** The speakable summary of one reply's text: the gnome line, else the first prose paragraph. '' when none. */
export function speakableSummary(text: string): string {
  const gnome = /^\s*gnome:\s*(.+)$/im.exec(text);
  if (gnome) return clip(stripMarkdown(gnome[1]!));
  // drop fenced blocks entirely (code, diffs, tool output)
  const noFences = text.replace(/```[\s\S]*?(```|$)/g, '\n\n').replace(/~~~[\s\S]*?(~~~|$)/g, '\n\n');
  for (const para of noFences.split(/\n\s*\n/)) {
    const lines = para.split('\n').filter((l) => l.trim() && !looksLikeDiffOrOutput(l) && !/^\s*[|>]/.test(l));
    const prose = stripMarkdown(lines.join(' '));
    if (prose && /[A-Za-z]/.test(prose)) return clip(prose);
  }
  return '';
}

function clip(s: string): string {
  if (s.length <= MAX_SPOKEN_CHARS) return s;
  const cut = s.slice(0, MAX_SPOKEN_CHARS);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '));
  return end > 80 ? cut.slice(0, end + 1) : `${cut.trimEnd()}…`;
}

/** Split text into sentences for per-sentence TTS streaming. */
export function sentences(text: string): string[] {
  const out = text.match(/[^.!?…]+(?:[.!?…]+["')\]]*|$)/g) ?? [];
  return out.map((s) => s.trim()).filter(Boolean);
}

export function editsLine(n: number): string {
  return n === 1 ? 'Edited 1 file.' : `Edited ${n} files.`;
}

interface Block {
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

/**
 * Tracks one session's stream and yields what to say. Feed it each row's payload; `turn.result` (or a stream
 * `result` line) closes the turn and flushes the edit count.
 */
export class SpeakableProjector {
  #editedFiles = new Set<string>();
  #editsNoPath = 0;

  /** Items to speak for one kernel row (in order). */
  push(kind: string, payload: Record<string, unknown>): SpeakItem[] {
    if (kind === 'turn.result') return this.#endTurn();
    if (kind !== 'turn.event' || typeof payload.line !== 'string') return [];
    let msg: { type?: string; message?: { content?: unknown } };
    try {
      msg = JSON.parse(payload.line) as typeof msg;
    } catch {
      return [];
    }
    if (msg.type === 'result') return this.#endTurn();
    if (msg.type !== 'assistant' || !Array.isArray(msg.message?.content)) return [];
    const out: SpeakItem[] = [];
    const texts: string[] = [];
    for (const b of msg.message.content as Block[]) {
      if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text);
      else if (b.type === 'tool_use' && b.name && EDIT_TOOLS.has(b.name)) {
        const p = b.input?.file_path ?? b.input?.path ?? b.input?.notebook_path;
        if (typeof p === 'string') this.#editedFiles.add(p);
        else this.#editsNoPath++;
      } else if (b.type === 'tool_use' && b.name && ASK_TOOLS.has(b.name)) {
        for (const q of askQuestions(b.input)) out.push({ kind: 'question', text: q });
      }
    }
    const summary = speakableSummary(texts.join('\n\n'));
    if (summary) out.unshift({ kind: 'reply', text: summary });
    return out;
  }

  #endTurn(): SpeakItem[] {
    const n = this.#editedFiles.size + this.#editsNoPath;
    this.#editedFiles.clear();
    this.#editsNoPath = 0;
    return n > 0 ? [{ kind: 'edits', files: n, text: editsLine(n) }] : [];
  }
}

/** Every question of an ask-user tool call, with its options read as "a, b, or c". */
export function askQuestions(input: Record<string, unknown> | undefined): string[] {
  if (!input) return [];
  const qs = Array.isArray(input.questions) ? (input.questions as Array<Record<string, unknown>>) : [input];
  const out: string[] = [];
  for (const q of qs) {
    const text = typeof q.question === 'string' ? q.question : typeof q.prompt === 'string' ? q.prompt : '';
    if (!text) continue;
    const opts = Array.isArray(q.options) ? q.options.map((o) => (typeof o === 'string' ? o : typeof (o as { label?: unknown })?.label === 'string' ? (o as { label: string }).label : '')).filter(Boolean) : [];
    const said = stripMarkdown(text);
    out.push(opts.length ? `${said} Options: ${opts.length === 1 ? opts[0] : `${opts.slice(0, -1).join(", ")}, or ${opts.at(-1)}`}.` : said);
  }
  return out;
}

/** One item of a kernel-speakable row. */
export interface KernelSpeakItem {
  kind: 'reply' | 'ask' | 'edits';
  text: string;
  /**
   * TABLE TALK S4 (TD-2026-10-20-294): 'system' for words the KERNEL wrote (an ask-waiting line, "Edited N files":
   * item from:'kernel'), said in the system voice after an earcon; 'model' for everything the model wrote. A reply
   * (from:'block' | 'heuristic' | absent) is ALWAYS 'model', whatever its text says.
   */
  voice: 'model' | 'system';
}
export const KERNEL_SPEAKABLE = 'kernel-speakable' as const;
const ITEM_KINDS = new Set(['reply', 'ask', 'edits']);

/**
 * The items to speak for one kernel row: only `voice.turn.agent` rows whose `source` is 'kernel-speakable'.
 * Everything else (turn.event, the client's own playback rows, malformed items) says nothing. Text is
 * markdown-stripped and clipped defensively; an item with no letters or digits is dropped.
 */
export function kernelSpeakable(kind: string, payload: Record<string, unknown>, principal: string | undefined, ns: string): KernelSpeakItem[] {
  if (kind !== 'voice.turn.agent' || payload.source !== KERNEL_SPEAKABLE || !Array.isArray(payload.items)) return [];
  // Aegis L1: only the kernel's own row (principal p:<ns>/kernel of THIS namespace) is spoken
  if (principal !== `p:${ns}/kernel`) return [];
  const out: KernelSpeakItem[] = [];
  for (const it of payload.items as Array<Record<string, unknown>>) {
    if (!it || typeof it !== 'object' || typeof it.kind !== 'string' || !ITEM_KINDS.has(it.kind) || typeof it.text !== 'string') continue;
    const text = clip(stripMarkdown(it.text));
    const system = it.from === 'kernel' && it.kind !== 'reply';
    if (text && /[A-Za-z0-9]/.test(text)) out.push({ kind: it.kind as KernelSpeakItem['kind'], text, voice: system ? 'system' : 'model' });
  }
  return out;
}
