/**
 * @symbol #gui-turn-steps
 *
 * The running turn's steps (founder 2026-10-23: "just right there where that 'working label' area is just a little
 * bit of labeling on what is being called etc and maybe even clicking on it to expand out to see what is being done").
 * PURE: a fold over the turn's turn.event lines (claude-code stream-json, full views only) into steps, each with a
 * label, a start, an end and an outcome:
 *
 *   thinking / writing   a content_block_start (thinking | text) to its content_block_stop (or the message_stop)
 *   <Tool> · <target>    a tool_use block (content_block_start, or the assistant line without partials) to its
 *                        tool_result (outcome ok | error); the target is toolSummary's short field (a path, a command)
 *   <Event> hook[ · m]   hook_started to hook_response (--include-hook-events, claude 2.1.309: hook_id, hook_name
 *                        'Stop' | 'PreToolUse:Bash' | 'SessionStart:startup', hook_event; the response adds output,
 *                        stdout, stderr, exit_code, outcome success | error | cancelled; no command, no duration).
 *                        Outcome: exit 2 or stdout JSON {decision:'block'} ⇒ blocked (its reason's first line);
 *                        cancelled ⇒ timed out (what a hook timeout writes); any other error ⇒ failed (exit N).
 *                        Claude's synthetic 'Stop hook feedback' user line names a blocking hook's command:
 *                        `[<command>]: <reason>` ⇒ the step's name (the command's script basename).
 *   <status>             a system status line (compacting) until the status clears
 *
 * The working key (the chip) names the current step: the running hooks first, else the latest open step, else
 * `finishing` once the reply ended (main-chain end_turn) and the turn has not, else nothing (`working…`).
 * The turn's summary line (hook-result) lists each notable hook group (blocked, failed, timed out, or 2 s or more) and
 * the failed tool calls; a turn with nothing notable has none. Hook and tool OUTPUT never reaches a label or the
 * summary: only a blocking hook's first reason line does (what Claude itself feeds back to the model). Every text goes
 * through the renderer's sanitizer; the step detail is rowDetail (the raw fold), with the same redaction.
 */
import { durationText, toolSummary, type Row } from './store.js';

export type StepKind = 'thinking' | 'writing' | 'tool' | 'hook' | 'status';
export type StepOutcome = 'ok' | 'error' | 'blocked' | 'timed out' | 'cancelled' | 'failed';

/** Aegis M2: the kernel's facts about a hook line (turn.event.hook, read from the FULL line before it was stored). */
export interface KernelHookFacts {
  id: string | null;
  event: string | null;
  name: string | null;
  exit: number | null;
  outcome: string | null;
  blocked: boolean;
}

/** The kernel's hook facts on a row, or null when they are absent or malformed. */
export function hookFactsOf(v: unknown): KernelHookFacts | null {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  if (!o) return null;
  const str = (x: unknown, n: number): string | null => (typeof x === 'string' && x.length > 0 && x.length <= n ? x : null);
  return { id: str(o.id, 128), event: str(o.event, 64), name: str(o.name, 128), exit: typeof o.exit === 'number' && Number.isSafeInteger(o.exit) ? o.exit : null, outcome: str(o.outcome, 32), blocked: o.blocked === true };
}

export interface TurnStep {
  /** stable within the turn: `tool:<id>`, `hook:<id>`, `blk:<seq>`, `st:<seq>` */
  key: string;
  kind: StepKind;
  label: string;
  since: string;
  until?: string;
  outcome?: StepOutcome;
  /** blocked: the reason's first line; failed: `exit N` */
  note?: string;
  /** hooks: the event, the matcher, and the command's short name when Claude's feedback line named it */
  hook?: { event: string; matcher: string | null; name?: string };
  /** the rows the step came from (its detail fold shows them) */
  seqs: number[];
  /** the page attaches the detail (rowDetail of seqs) for an unfolded step */
  detail?: string;
}

/** The chip's words and where its clock starts. */
export interface StepNow {
  label: string;
  since: string;
  /** what the status says to assistive tech after its subject ("waiting on a Stop hook": "Claude is waiting on …") */
  aria: string;
  /**
   * Mika (flicker): what the chip names until this hook has run HOOK_DWELL_MS. A hook that ends sooner (most
   * PreToolUse / PostToolUse hooks run in tens of ms) never takes the chip; the step list still records it.
   */
  under?: { label: string; since: string; aria: string };
}

/** A running hook names itself in the chip once it has run this long (live-turn.ts workNow applies it). */
export const HOOK_DWELL_MS = 1000;

const MAX_STEPS = 200;
const LABEL_MAX = 72;
const NOTE_MAX = 120;
const NOTABLE_MS = 2000;

const objOf = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();
const cap = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const firstLine = (s: string): string => cap(oneLine(s.split('\n').find((l) => l.trim()) ?? ''), NOTE_MAX);
const EVENT = /^[A-Za-z]{1,40}$/;

/** `PreToolUse:Bash` ⇒ {event PreToolUse, matcher Bash}; `Stop` ⇒ {event Stop}; a bad name falls back to hook_event. */
export function hookParts(name: unknown, event: unknown): { event: string; matcher: string | null } {
  const n = typeof name === 'string' ? name : '';
  const i = n.indexOf(':');
  const ev = typeof event === 'string' && EVENT.test(event) ? event : EVENT.test(i > 0 ? n.slice(0, i) : n) ? (i > 0 ? n.slice(0, i) : n) : 'hook';
  const m = i > 0 ? cap(oneLine(n.slice(i + 1)), 40) : '';
  return { event: ev, matcher: m || null };
}

/** `Stop hook`, `PreToolUse hook · Bash`. */
export function hookLabel(h: { event: string; matcher: string | null }): string {
  return `${h.event} hook${h.matcher ? ` · ${h.matcher}` : ''}`;
}

/** A hook command's short name: the basename of its script (`node "/x/ui-gate.mjs" stop` ⇒ ui-gate.mjs), else its first word. */
export function hookCommandName(cmd: string): string {
  const toks = cmd.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  const bare = toks.map((t) => t.replace(/^["']|["']$/g, ''));
  const script = bare.find((t) => /\.[A-Za-z0-9]{1,5}$/.test(t) && !t.startsWith('-')) ?? bare.find((t) => t.includes('/')) ?? bare[0] ?? '';
  return cap(script.split(/[\\/]/).pop() ?? script, 40);
}

/**
 * The outcome of a hook_response (claude 2.1.309 shapes), with its note. `facts` (the kernel's, Aegis M2) decide the
 * outcome when present; the line only lends the note. A field the kernel kept as `{bytes, sha256}` (Aegis L2: over
 * 4 KB) has no text: the step says what happened without a reason. `cancelled` reads `timed out` here (what a hook
 * timeout writes); the tracker turns it into `cancelled` when the turn was interrupted.
 */
export function hookOutcome(m: Record<string, unknown>, facts: KernelHookFacts | null = null): { outcome: StepOutcome; note?: string } {
  const code = facts ? facts.exit : typeof m.exit_code === 'number' ? m.exit_code : null;
  const stdout = typeof m.stdout === 'string' ? m.stdout.trim() : '';
  const stderr = typeof m.stderr === 'string' ? m.stderr : '';
  const jsonReason = (): { block: boolean; note?: string } => {
    if (!stdout.startsWith('{') || stdout.length > 65_536) return { block: false };
    try {
      const j = objOf(JSON.parse(stdout));
      return j?.decision === 'block' ? { block: true, ...(typeof j.reason === 'string' && firstLine(j.reason) ? { note: firstLine(j.reason) } : {}) } : { block: false };
    } catch {
      return { block: false };
    }
  };
  if (facts) {
    if (facts.blocked) {
      const note = code === 2 ? firstLine(stderr) : jsonReason().note;
      return { outcome: 'blocked', ...(note ? { note } : {}) };
    }
  } else {
    if (code === 2) return { outcome: 'blocked', note: firstLine(stderr) || undefined };
    if (code === 0 || code === null) {
      const j = jsonReason();
      if (j.block) return { outcome: 'blocked', ...(j.note ? { note: j.note } : {}) };
    }
  }
  const outcome = facts ? facts.outcome : m.outcome;
  if (outcome === 'cancelled') return { outcome: 'timed out' };
  if (facts) return outcome === 'error' || (code !== null && code !== 0) ? { outcome: 'failed', ...(code !== null ? { note: `exit ${code}` } : {}) } : { outcome: 'ok' };
  if (m.outcome === 'error' || (code !== null && code !== 0)) return { outcome: 'failed', ...(code !== null ? { note: `exit ${code}` } : {}) };
  return { outcome: 'ok' };
}

/** "0.4s", "30.1s" under 90 s, then durationText ("2m 5s"). */
export function secsText(ms: number): string {
  const s = Math.max(0, ms) / 1000;
  return s < 90 ? `${s.toFixed(1)}s` : durationText(Math.round(s));
}

const msBetween = (a: string, b: string | undefined): number => {
  const x = Date.parse(a);
  const y = b ? Date.parse(b) : NaN;
  return Number.isFinite(x) && Number.isFinite(y) ? Math.max(0, y - x) : 0;
};

/** One step's line in the list: `Read · src/x.ts · 0.1s · ok`, `Stop hook · 30.1s · timed out` (the live step: no time). */
export function stepText(s: TurnStep): string {
  const p = stepParts(s);
  return `${p.label}${p.tail}`;
}

/** An outcome in words: `blocked: <reason>`, `failed (exit 1)`, `timed out`, `ok`, `error`. */
const outcomeText = (s: Pick<TurnStep, 'outcome' | 'note'>): string =>
  s.outcome === 'blocked' ? `blocked${s.note ? `: ${s.note}` : ''}` : s.outcome === 'failed' && s.note ? `failed (${s.note})` : (s.outcome ?? '');

/**
 * Mika: a step's line in two parts, so a long label (a path, a command) gives way to an ellipsis and its time and
 * outcome always show: label `Read · src/x.ts`, tail ` · 0.1s · ok`. A live step's tail is empty (the page adds its clock).
 */
export function stepParts(s: TurnStep): { label: string; tail: string } {
  const label = `${s.label}${s.hook?.name ? ` · ${s.hook.name}` : ''}`;
  if (s.until === undefined) return { label, tail: '' };
  const out = outcomeText(s);
  return { label, tail: ` · ${secsText(msBetween(s.since, s.until))}${out ? ` · ${out}` : ''}` };
}

/**
 * The fold over one turn's lines. `reset` at the turn's start; `push` every full turn.event line (with its row's
 * seq and at); `now()` is the chip; `summary()` the turn's quiet line at its result.
 */
export class StepTracker {
  steps: TurnStep[] = [];
  /** when the main chain's reply ended (end_turn), until a new message starts */
  replyEndedAt: string | null = null;
  #byKey = new Map<string, TurnStep>();
  /** content block index ⇒ open thinking / writing step of the current main-chain message */
  #blocks = new Map<number, TurnStep>();

  reset(): void {
    this.steps = [];
    this.replyEndedAt = null;
    this.#byKey.clear();
    this.#blocks.clear();
  }

  #open(s: TurnStep): TurnStep {
    if (this.steps.length >= MAX_STEPS) {
      const drop = this.steps.findIndex((x) => x.until !== undefined);
      if (drop < 0) return s;
      this.#byKey.delete(this.steps[drop]!.key);
      this.steps.splice(drop, 1);
    }
    this.steps.push(s);
    this.#byKey.set(s.key, s);
    return s;
  }

  #closeBlocks(at: string): void {
    for (const s of this.#blocks.values()) if (s.until === undefined) s.until = at;
    this.#blocks.clear();
  }

  /**
   * One turn.event row: its line (null when the kernel stored it by hash) and the kernel's hook facts (`p.hook`) with
   * the row's type. A hashed hook line still opens or ends its step from the facts alone.
   */
  push(seq: number, at: string | undefined, line: string | null, hookFacts?: unknown, type?: string): void {
    if (!at) return;
    const facts = hookFactsOf(hookFacts);
    let m: Record<string, unknown> | null = null;
    if (line !== null) {
      try {
        m = objOf(JSON.parse(line));
      } catch {
        m = null;
      }
    }
    if (!m && facts && (type === 'system.hook_started' || type === 'system.hook_response')) m = { type: 'system', subtype: type.slice(7) };
    if (!m) return;
    if (facts && m.type === 'system') {
      // the kernel's facts name the hook (the line may be hashed or rewritten)
      if (facts.id !== null) m.hook_id = facts.id;
      if (facts.name !== null) m.hook_name = facts.name;
      if (facts.event !== null) m.hook_event = facts.event;
    }
    // a sub-agent's own stream is inside its Task step (the main chain's tool_use) — not steps of this turn
    if (m.parent_tool_use_id !== undefined && m.parent_tool_use_id !== null) return;
    const t = m.type;
    if (t === 'stream_event') {
      const ev = objOf(m.event);
      const et = ev?.type;
      if (et === 'message_start') {
        this.replyEndedAt = null;
        this.#closeBlocks(at);
      } else if (et === 'content_block_start') {
        const cb = objOf(ev!.content_block);
        const idx = typeof ev!.index === 'number' ? ev!.index : -1;
        if (cb?.type === 'thinking' || cb?.type === 'redacted_thinking') this.#blocks.set(idx, this.#open({ key: `blk:${seq}`, kind: 'thinking', label: 'thinking', since: at, seqs: [seq] }));
        else if (cb?.type === 'text') this.#blocks.set(idx, this.#open({ key: `blk:${seq}`, kind: 'writing', label: 'writing', since: at, seqs: [seq] }));
        else if (cb?.type === 'tool_use' && typeof cb.id === 'string' && !this.#byKey.has(`tool:${cb.id}`)) {
          const name = typeof cb.name === 'string' && cb.name ? cb.name : 'tool';
          this.#open({ key: `tool:${cb.id}`, kind: 'tool', label: cap(`calling ${name}`, LABEL_MAX), since: at, seqs: [seq] });
        }
      } else if (et === 'content_block_stop') {
        const idx = typeof ev!.index === 'number' ? ev!.index : -1;
        const s = this.#blocks.get(idx);
        if (s) {
          if (s.until === undefined) s.until = at;
          this.#blocks.delete(idx);
        }
      } else if (et === 'message_delta') {
        if (objOf(ev!.delta)?.stop_reason === 'end_turn') this.replyEndedAt = at;
      } else if (et === 'message_stop') this.#closeBlocks(at);
      return;
    }
    if (t === 'assistant') {
      const msg = objOf(m.message);
      const content = Array.isArray(msg?.content) ? (msg!.content as unknown[]) : [];
      for (const c of content) {
        const x = objOf(c);
        if (x?.type !== 'tool_use' || typeof x.id !== 'string') continue;
        const name = typeof x.name === 'string' && x.name ? x.name : 'tool';
        const label = cap(oneLine(toolSummary(name, x.input)), LABEL_MAX);
        const s = this.#byKey.get(`tool:${x.id}`);
        if (s) {
          s.label = label;
          if (!s.seqs.includes(seq)) s.seqs.push(seq);
        } else this.#open({ key: `tool:${x.id}`, kind: 'tool', label, since: at, seqs: [seq] });
      }
      if (msg?.stop_reason === 'end_turn') this.replyEndedAt = at;
      return;
    }
    if (t === 'user') {
      const msg = objOf(m.message);
      const c = msg?.content;
      const parts = Array.isArray(c) ? c.map(objOf) : [];
      for (const x of parts) {
        if (x?.type !== 'tool_result' || typeof x.tool_use_id !== 'string') continue;
        const s = this.#byKey.get(`tool:${x.tool_use_id}`);
        if (!s || s.until !== undefined) continue;
        s.until = at;
        s.outcome = x.is_error === true ? 'error' : 'ok';
        s.seqs.push(seq);
      }
      const text = typeof c === 'string' ? c : parts.map((x) => (x?.type === 'text' && typeof x.text === 'string' ? x.text : '')).join('\n');
      if (m.isSynthetic === true) this.#feedback(text, seq);
      // Mika: an interrupt (Claude writes "[Request interrupted by user]" right after it cancels the running hooks)
      // makes a just-cancelled hook "cancelled", never "timed out"
      else if (/^\[Request interrupted by user/.test(text.trim())) this.#interrupted(at);
      return;
    }
    if (t === 'system') {
      const sub = m.subtype;
      if (sub === 'hook_started' && typeof m.hook_id === 'string') {
        if (this.#byKey.has(`hook:${m.hook_id}`)) return;
        const h = hookParts(m.hook_name, m.hook_event);
        this.#open({ key: `hook:${m.hook_id}`, kind: 'hook', label: hookLabel(h), since: at, hook: h, seqs: [seq] });
      } else if (sub === 'hook_response' && typeof m.hook_id === 'string') {
        const h = hookParts(m.hook_name, m.hook_event);
        const s = this.#byKey.get(`hook:${m.hook_id}`) ?? this.#open({ key: `hook:${m.hook_id}`, kind: 'hook', label: hookLabel(h), since: at, hook: h, seqs: [] });
        if (s.until !== undefined) return;
        const o = hookOutcome(m, facts);
        s.until = at;
        s.outcome = o.outcome;
        if (o.note) s.note = o.note;
        s.seqs.push(seq);
      } else if (sub === 'status') {
        for (const s of this.steps) if (s.kind === 'status' && s.until === undefined) s.until = at;
        const st = typeof m.status === 'string' ? oneLine(m.status) : '';
        if (st && /^[A-Za-z][A-Za-z _-]{0,39}$/.test(st)) this.#open({ key: `st:${seq}`, kind: 'status', label: st, since: at, seqs: [seq] });
      } else if (sub === 'compact_boundary') {
        for (const s of this.steps) if (s.kind === 'status' && s.until === undefined) s.until = at;
      }
    }
  }

  /**
   * Claude's synthetic `Stop hook feedback:\n[<command>]: <reason>` line names the blocking hook(s) it reports. Aegis L1:
   * a name goes to the blocked step whose own reason (first line, from its hook_response) is the same text, never by
   * position; a step with no reason of its own (its output was over the kernel's cap) or no match stays unnamed.
   */
  #feedback(text: string, seq: number): void {
    const m = /^([\w:]+) hook feedback:/.exec(text);
    if (!m) return;
    const event = m[1]!.split(':')[0];
    const blocked = this.steps.filter((s) => s.kind === 'hook' && s.outcome === 'blocked' && s.hook?.event === event && !s.hook.name);
    const named = [...text.matchAll(/^\[([^\]\n]{1,512})\]: ?(.*)$/gm)];
    for (const n of named) {
      const reason = firstLine(n[2] ?? '');
      if (!reason) continue;
      const s = blocked.find((x) => !x.hook!.name && x.note === reason);
      if (!s) continue;
      s.hook!.name = hookCommandName(n[1]!);
      s.seqs.push(seq);
    }
    if (!named.length && blocked.length === 1) blocked[0]!.seqs.push(seq);
  }

  /** The turn was interrupted at `at`: the hooks Claude cancelled for it (ended within 2 s before) read `cancelled`. */
  #interrupted(at: string): void {
    const t = Date.parse(at);
    for (const s of this.steps) if (s.kind === 'hook' && s.outcome === 'timed out' && s.until !== undefined && t - Date.parse(s.until) <= 2000) s.outcome = 'cancelled';
  }

  /** The chip: running hooks first, else the latest open step, else finishing, else null (the page says working…). */
  now(): StepNow | null {
    const hooks = this.steps.filter((s) => s.kind === 'hook' && s.until === undefined);
    // Mika (flicker): until the hooks have run HOOK_DWELL_MS the chip keeps naming what it named before them
    const under = (): Pick<StepNow, 'under'> => {
      const u = this.#restNow();
      return { under: u ?? { label: 'working…', since: hooks.map((s) => s.since).sort()[0]!, aria: 'working' } };
    };
    if (hooks.length === 1) return { label: hooks[0]!.label, since: hooks[0]!.since, aria: `waiting on a ${hooks[0]!.label}`, ...under() };
    if (hooks.length > 1) {
      const evs = new Set(hooks.map((s) => s.hook?.event ?? 'hook'));
      const ev = evs.size === 1 ? `${[...evs][0]} hooks` : 'hooks';
      const since = hooks.map((s) => s.since).sort()[0]!;
      return { label: `${ev} · ${hooks.length} running`, since, aria: `waiting on ${hooks.length} ${ev}`, ...under() };
    }
    return this.#restNow();
  }

  /** The chip without the running hooks: the latest open step, else finishing, else null. */
  #restNow(): StepNow | null {
    for (let i = this.steps.length - 1; i >= 0; i--) {
      const s = this.steps[i]!;
      if (s.until === undefined && s.kind !== 'hook') return { label: s.label, since: s.since, aria: s.kind === 'tool' ? `running ${s.label}` : s.label };
    }
    if (this.replyEndedAt !== null) return { label: 'finishing', since: this.replyEndedAt, aria: 'finishing the turn' };
    return null;
  }

  /**
   * The turn's quiet summary (hook-result), or null when nothing is notable. Hook groups: consecutive hooks of one
   * event that started before the group's last one ended. A group is notable when a hook did not end ok, or it took
   * 2 s or more. warn: a hook blocked, failed or timed out.
   */
  summary(): { text: string; warn: boolean } | null {
    const parts: string[] = [];
    let warn = false;
    const hooks = this.steps.filter((s) => s.kind === 'hook' && s.until !== undefined).sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
    const groups: TurnStep[][] = [];
    for (const s of hooks) {
      const g = groups[groups.length - 1];
      const end = g ? g.map((x) => x.until!).sort().at(-1)! : '';
      if (g && g[0]!.hook?.event === s.hook?.event && s.since <= end) g.push(s);
      else groups.push([s]);
    }
    for (const g of groups) {
      const since = g.map((x) => x.since).sort()[0]!;
      const until = g.map((x) => x.until!).sort().at(-1)!;
      const ms = msBetween(since, until);
      // the block first (it is why the turn went on), then failures, then timeouts
      const rank = { blocked: 0, failed: 1, 'timed out': 2, cancelled: 3, error: 4, ok: 5 } as const;
      const bad = g.filter((x) => x.outcome !== 'ok').sort((a, b) => rank[a.outcome ?? 'ok'] - rank[b.outcome ?? 'ok']);
      if (!bad.length && ms < NOTABLE_MS) continue;
      if (bad.some((x) => x.outcome !== 'cancelled')) warn = true; // an interrupt the human made is not trouble
      const first = g[0]!;
      // Mika: a count says what it counts ("3 Stop hooks", never a bare "· 3 ·" field)
      const head = g.length === 1 ? `${first.label}${first.hook?.name ? ` · ${first.hook.name}` : ''}` : `${g.length} ${first.hook?.event ?? 'hook'} hooks`;
      const outs = bad.length
        ? bad.map((x) => {
            const who = g.length > 1 && x.hook?.name ? `${x.hook.name} ` : '';
            return `${who}${outcomeText(x)}`;
          })
        : ['ok'];
      // Mika: the outcomes are a list (", "), never more " · " fields: "3 Stop hooks · 2.0s · blocked: …, failed (exit 1), timed out"
      parts.push(`${[head, secsText(ms)].join(' · ')} · ${outs.join(', ')}`);
    }
    const failed = this.steps.filter((s) => s.kind === 'tool' && s.outcome === 'error').length;
    if (failed) parts.push(`${failed} tool call${failed === 1 ? '' : 's'} failed`);
    return parts.length ? { text: parts.join('; '), warn } : null;
  }
}

/** The fold key of a step under the working key `itemKey`. */
export const stepFoldKey = (itemKey: string, stepKey: string): string => `step:${itemKey}:${stepKey}`;
/** The fold key of the working key's step list. */
export const stepsFoldKey = (itemKey: string): string => `steps:${itemKey}`;

/**
 * The page's pass (PURE): the working item learns whether its list is unfolded, and an unfolded step gets its detail
 * (each source row's rowDetail, joined; a row the view withheld adds nothing). Returns new objects, never mutates.
 */
export function withStepFolds<T extends { key: string; role: string; steps?: TurnStep[]; open?: boolean }>(items: readonly T[], rows: readonly Row[], expanded: ReadonlySet<string>, detailOf: (r: Row) => string | null): T[] {
  return items.map((it) => {
    if (it.role !== 'working' || !it.steps) return it;
    const open = expanded.has(stepsFoldKey(it.key));
    if (!open) return { ...it, open: false };
    const bySeq = new Map<number, Row>();
    const want = new Set(it.steps.filter((s) => expanded.has(stepFoldKey(it.key, s.key))).flatMap((s) => s.seqs));
    for (const r of rows) if (want.has(r.seq)) bySeq.set(r.seq, r);
    const steps = it.steps.map((s) => {
      if (!expanded.has(stepFoldKey(it.key, s.key))) return s;
      const d = s.seqs.map((q) => bySeq.get(q)).filter((r): r is Row => !!r).map(detailOf).filter((x): x is string => x !== null);
      return { ...s, detail: d.length ? d.join('\n\n') : '(the view withheld these lines)' };
    });
    return { ...it, open: true, steps };
  });
}
