/**
 * @symbol #gnomon-voice
 *
 * The kernel's SPEAKABLE REPLY ROW (voice slice V2e item 3, T-2026-10-19-026; spec §14 "speak only speakable
 * content"). The kernel watches its own log commits for the ATTACHED session's `turn.event`, `turn.ask-user` and
 * `turn.result` rows, projects what may be said out loud, and appends
 *   voice.turn.agent{source:'kernel-speakable', turnSeq, items:[{kind:'reply'|'ask'|'edits', text}]}
 * as the kernel principal (userland kind, kernel-attested like modns rows) into that session. The voice reader
 * projection shows that row in full and no turn.* row at all (redaction.ts case 'voice'), so the voice client
 * never sees a diff, tool input or tool output: only this summary.
 *   - an assistant text reply → the GNOME LINE if the reply has one (a line starting `gnome:`), else the FIRST
 *     PARAGRAPH, with code fences, inline code, markdown links/emphasis and diff/tool text stripped;
 *   - file-editing tool calls (Edit / Write / MultiEdit / NotebookEdit / apply_patch) → counted, said once at the
 *     end of the turn as "Edited N files.";
 *   - an ask-user question (AskUserQuestion) → ALWAYS said, every question (a turn.ask-user row whose question was
 *     not seen in the stream still says that a question is waiting);
 *   - a row whose stream line is hashed (big, or a control_request) has nothing speakable and is skipped.
 * The projector logic is the client's former packages/gnomon-voice/src/speakable.ts, moved here (the client now
 * consumes the row).
 */

export type SpeakItem = { kind: 'reply' | 'ask' | 'edits'; text: string };

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'apply_patch', 'str_replace_based_edit_tool']);
const ASK_TOOLS = new Set(['AskUserQuestion', 'ask_user', 'AskUser']);
const MAX_SPOKEN_CHARS = 600;
/** said for a turn.ask-user row whose question text the stream did not carry */
export const ASK_WAITING = 'The session is asking you a question. It is on your screen.';

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
  id?: string;
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
  /** tool_use ids of ask-user calls already said from the stream (bounded) */
  readonly #asked = new Set<string>();

  /** Items to speak for one kernel row (in order). */
  push(kind: string, payload: Record<string, unknown>): SpeakItem[] {
    if (kind === 'turn.result') return this.#endTurn();
    if (kind === 'turn.ask-user') {
      const id = typeof payload.toolUseId === 'string' ? payload.toolUseId : null;
      if (id !== null && this.#asked.has(id)) return [];
      return [{ kind: 'ask', text: ASK_WAITING }];
    }
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
        if (typeof b.id === 'string') this.#asked.add(b.id);
        for (const q of askQuestions(b.input)) out.push({ kind: 'ask', text: q });
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
    if (this.#asked.size > 256) this.#asked.clear();
    return n > 0 ? [{ kind: 'edits', text: editsLine(n) }] : [];
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

/** The kind and the source of the kernel's speakable row (spec §14, V2e). */
export const SPEAKABLE_KIND = 'voice.turn.agent' as const;
export const SPEAKABLE_SOURCE = 'kernel-speakable' as const;
/** The rows the kernel projects from (the attached session's only). */
export const SPEAKABLE_FROM: readonly string[] = Object.freeze(['turn.event', 'turn.ask-user', 'turn.result']);

export interface SpeakableRow {
  kind: typeof SPEAKABLE_KIND;
  session: string;
  payload: { source: typeof SPEAKABLE_SOURCE; turnSeq: number; items: SpeakItem[] };
}

/**
 * Watches committed rows; for the attached session it yields the speakable row to append (or null). A change of
 * attachment drops the old session's projector state. Pure: the daemon appends the row (as the kernel principal).
 */
export class KernelSpeakable {
  readonly #attached: () => string | null;
  #hsid: string | null = null;
  #proj = new SpeakableProjector();

  constructor(attachedHsid: () => string | null) {
    this.#attached = attachedHsid;
  }

  /** One committed row → the speakable row for it, or null. `turnSeq` is the chain seq of the source row. */
  observe(e: { seq: number; kind: string; session?: string | null; payload?: unknown }): SpeakableRow | null {
    if (!SPEAKABLE_FROM.includes(e.kind)) return null;
    const hsid = this.#attached();
    if (hsid === null || e.session !== hsid) return null;
    if (hsid !== this.#hsid) {
      this.#hsid = hsid;
      this.#proj = new SpeakableProjector();
    }
    const payload = e.payload !== null && typeof e.payload === 'object' ? (e.payload as Record<string, unknown>) : {};
    const items = this.#proj.push(e.kind, payload);
    return items.length ? { kind: SPEAKABLE_KIND, session: hsid, payload: { source: SPEAKABLE_SOURCE, turnSeq: e.seq, items } } : null;
  }
}

/** True for the kernel's own speakable row (principal p:<ns>/kernel, source kernel-speakable). */
export function isKernelSpeakable(e: { kind: string; principal?: string; payload?: unknown }): boolean {
  return e.kind === SPEAKABLE_KIND && typeof e.principal === 'string' && /^p:[0-9a-z]{8}\/kernel$/.test(e.principal) && (e.payload as { source?: unknown } | null)?.source === SPEAKABLE_SOURCE;
}
