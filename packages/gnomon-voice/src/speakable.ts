/**
 * @symbol #gnomon-voice
 *
 * What voice says out loud (spec §14 "speak only speakable content"; V2c). From the attached session's turn rows:
 *   - an assistant text reply → its speakable summary: the GNOME LINE if the reply has one (a line starting
 *     `gnome:`; the short spoken line a session may lead with), else the FIRST PARAGRAPH, with code fences,
 *     inline code, markdown links/emphasis and diff/tool text stripped. Never a diff, never tool output.
 *   - file-editing tool calls (Edit / Write / MultiEdit / NotebookEdit / apply_patch) → counted, said once at the
 *     end of the turn as "edited N files".
 *   - an ask-user question (AskUserQuestion) → ALWAYS read, every question.
 * Assumption (unverified against a live kernel): the voice projection delivers `turn.event` rows with the
 * stream-json `line` (Claude Code's `assistant` / `result` messages). A row whose line is hashed (big or a
 * control_request) has nothing speakable and is skipped.
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
