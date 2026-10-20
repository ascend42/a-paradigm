/**
 * @symbol #gui
 *
 * #gui DOM-text rendering (spec §4.5, §11.1; `G-GUI-07`, `G-GUI-11`). The
 * ONLY way kernel, card, block or model text reaches the page: every string
 * is sanitized by THE one sanitizer, `@a-company/gnomon-contracts`
 * `sanitizeDisplayText` (display.ts, conformance/display.v1.json — the GUI
 * defines none of its own, Aegis C1) and appended as a TEXT NODE. This module never
 * assigns `innerHTML` / `outerHTML`, never calls `insertAdjacentHTML` or
 * `document.write`, never sets an `on*` attribute or an `href`/`src` from data
 * (test/no-markup.test.ts scans the whole src tree for those sinks).
 *
 * Blocks (`display-block:v1`, the closed kit): Box Text List Table Markdown
 * Diff Progress Button Image Canvas. A block carries no actions; `kit.Button`
 * names only a command id (dispatched to the palette, never to a verb).
 * Markdown renders as preformatted text in slice 1 (raw HTML disabled by
 * construction); the streaming Markdown renderer is slice 2. `kit.Image`
 * shows its `alt` until the /blob fetch lands (slice 2); `kit.Canvas` is
 * host-owned (Doodle, §12.7). An unknown block renders opaquely as
 * `[block <name>]` with its strings as text — never dropped.
 *
 * Kernel cards (`inbox.card` regions): kind, requester, session, the body
 * block, flags as visible badges beside the decision keys, and the
 * `contentHash` summary line — rendered by the GUI core, never by a mod.
 */
import { BIDI_GLYPHS, canonicalJson, hex, sanitizeDisplayText, sha256 } from '@a-company/gnomon-contracts';
import { BLOCK_SAFE_COMMANDS } from './commands.js';

/** Legend for the `bidi` card badge: the glyphs the contracts sanitizer shows in place of bidi controls. */
export const BIDI_LEGEND = Object.values(BIDI_GLYPHS).join(' ');

/** The display text of any value: strings through the contracts sanitizer; others stringified first. */
export function displayText(v: unknown): string {
  return sanitizeDisplayText(typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v)).text;
}

/** Union of the sanitizer flags over every string (keys included) of a JSON-like value (a card body, a block tree). */
export function flagsOf(value: unknown, acc: Set<string> = new Set(), depth = 0): Set<string> {
  if (depth > 64) return acc;
  if (typeof value === 'string') for (const f of sanitizeDisplayText(value).flags) acc.add(f);
  else if (Array.isArray(value)) for (const v of value) flagsOf(v, acc, depth + 1);
  else if (value && typeof value === 'object')
    for (const [k, v] of Object.entries(value)) {
      flagsOf(k, acc, depth + 1);
      flagsOf(v, acc, depth + 1);
    }
  return acc;
}

/** The DOM surface this module uses (a real Document in the page; a fake in node tests). */
export interface MiniDoc {
  createElement(tag: string): MiniEl;
  createTextNode(text: string): unknown;
}
export interface MiniEl {
  appendChild(child: unknown): unknown;
  setAttribute(name: string, value: string): void;
  className: string;
}

const ALLOWED_TAGS = new Set(['input', 'label', 'fieldset', 'legend', 'div', 'span', 'p', 'pre', 'ul', 'ol', 'li', 'em', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'button', 'progress', 'header', 'section', 'strong', 'code', 'kbd', 'small']);
const SAFE_ATTR = /^(class|role|title|aria-[a-z-]+|data-[a-z-]+|value|max|tabindex|type|name|placeholder|maxlength)$/;

/** Element with sanitized text children. Attributes are allowlisted and never URL/handler-bearing. */
export function h(doc: MiniDoc, tag: string, attrs: Record<string, string> | null, ...children: Array<MiniEl | string | null | undefined | false>): MiniEl {
  if (!ALLOWED_TAGS.has(tag)) throw new Error(`render: tag ${tag} is not allowed`);
  const el = doc.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') el.className = v;
      else if (SAFE_ATTR.test(k)) el.setAttribute(k, displayText(v));
      else throw new Error(`render: attribute ${k} is not allowed`);
    }
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' ? doc.createTextNode(displayText(c)) : c);
  }
  return el;
}

/** Text node of a sanitized string. */
export function text(doc: MiniDoc, s: unknown): unknown {
  return doc.createTextNode(displayText(s));
}

const TONE = /^[a-z][a-z0-9-]{0,31}$/;
const KIT = ['Box', 'Text', 'List', 'Table', 'Markdown', 'Diff', 'Progress', 'Button', 'Image', 'Canvas'] as const;

/** The block name of a node: `block` or `type`, with or without the `kit.` prefix (the broker writes `{type:'Box'}`). */
export function blockName(node: Record<string, unknown>): string {
  const raw = typeof node.block === 'string' ? node.block : typeof node.type === 'string' ? node.type : '';
  return raw.startsWith('kit.') ? raw.slice(4) : raw;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export interface RenderCtx {
  doc: MiniDoc;
  /** kit.Button → palette command id (never a verb). */
  onCommand?: (commandId: string) => void;
  depth?: number;
}

/** Render one display-block node (any depth ≤ 32). */
export function renderBlock(ctx: RenderCtx, node: unknown): MiniEl {
  const { doc } = ctx;
  const depth = ctx.depth ?? 0;
  if (!node || typeof node !== 'object' || Array.isArray(node)) return h(doc, 'span', { class: 'blk blk-text' }, str(node));
  const n = node as Record<string, unknown>;
  const data = (n.data && typeof n.data === 'object' ? n.data : n) as Record<string, unknown>;
  const kids = Array.isArray(n.children) ? n.children : [];
  const child = (c: unknown): MiniEl => (depth >= 32 ? h(doc, 'span', { class: 'blk' }, '…') : renderBlock({ ...ctx, depth: depth + 1 }, c));
  const name = blockName(n);
  switch (name) {
    case 'Box':
      return h(doc, 'div', { class: `blk blk-box${data.direction === 'row' ? ' blk-row' : ''}` }, ...kids.map(child));
    case 'Text':
      // a tone is a closed-shape token mapped to a class (styles.css .tone-*), never a style or a colour value
      return h(doc, 'p', { class: `blk blk-text${typeof data.tone === 'string' && TONE.test(data.tone) ? ` tone-${data.tone}` : ''}` }, str(data.text));
    case 'List': {
      const items = Array.isArray(data.items) ? data.items : kids;
      return h(doc, 'ul', { class: 'blk blk-list' }, ...items.map((it) => h(doc, 'li', null, typeof it === 'object' && it !== null ? child(it) : str(it))));
    }
    case 'Table': {
      const cols = Array.isArray(data.columns) ? data.columns : [];
      const rows = Array.isArray(data.rows) ? data.rows : [];
      return h(
        doc,
        'table',
        { class: 'blk blk-table' },
        h(doc, 'thead', null, h(doc, 'tr', null, ...cols.map((c) => h(doc, 'th', null, str(c))))),
        h(doc, 'tbody', null, ...rows.map((r) => h(doc, 'tr', null, ...(Array.isArray(r) ? r : [r]).map((c) => h(doc, 'td', null, str(c)))))),
      );
    }
    case 'Markdown':
      return h(doc, 'pre', { class: 'blk blk-md' }, str(data.text ?? data.markdown));
    case 'Diff':
      return h(doc, 'pre', { class: 'blk blk-diff' }, str(data.text ?? data.diff ?? data.hunks));
    case 'Progress': {
      const value = Number(data.value);
      const max = Number(data.max ?? 1);
      return h(doc, 'div', { class: 'blk blk-progress' }, h(doc, 'progress', { value: String(Number.isFinite(value) ? value : 0), max: String(Number.isFinite(max) && max > 0 ? max : 1) }), str(data.label));
    }
    case 'Button': {
      // C6: a block button is styled apart from kernel decision keys (no `key` class) and is live only for a safe command
      const cmd = str(data.command);
      if (!BLOCK_SAFE_COMMANDS.has(cmd)) return h(doc, 'span', { class: 'blk blk-button-inert', title: 'this command is not available to a block' }, `[${str(data.label ?? cmd)}]`);
      return h(doc, 'button', { class: 'blk blk-button', type: 'button', 'data-command': cmd }, str(data.label ?? cmd));
    }
    case 'Image':
      return h(doc, 'div', { class: 'blk blk-image', role: 'img', 'aria-label': str(data.alt) }, `[image] ${str(data.alt)}`);
    case 'bash-prefix':
      // the kernel's structured prefix choices: the card's always keys render them (prefixOptionsOf)
      return h(doc, 'span', { class: 'blk blk-bash-prefix' });
    case 'ask-user':
      // the kernel's structured questions: the card's picker renders them (askDetailOf), the text lines above show them
      return h(doc, 'span', { class: 'blk blk-ask-user' });
    case 'Canvas':
      return h(doc, 'div', { class: 'blk blk-canvas' }, `[canvas ${str(data.ds)}] rendered by the host surface`);
    default:
      // unknown (or a kernel card block nested as a child): opaque label + its strings as text, never dropped
      return h(doc, 'div', { class: 'blk blk-opaque' }, `[block ${name || '?'}] `, ...kids.map(child), typeof data.text === 'string' ? data.text : null);
  }
}

export const KIT_BLOCKS: readonly string[] = KIT;

export interface CardView {
  cardId: string;
  kind: string;
  requestedBy: string;
  hsid: string | null;
  repo: string | null;
  state: string;
  contentHash: string;
  flags: string[];
  /** decisions whose kernel signature verified; [] ⇒ no decision keys */
  decisions: string[];
  decidable: boolean;
  /** ask-user: the questions from the card's contentHash-verified structured detail (askDetailOf); null ⇒ no picker */
  ask?: AskCardDetail | null;
  /** Bash permission: the prefix-scoped always choices from the contentHash-verified detail (prefixOptionsOf); null ⇒ exact only */
  prefixOptions?: string[][] | null;
  /** S3: the card's project (repo basename) and its ONE project hue (groupHue / projectHue); null ⇒ no project line */
  project?: { name: string; hue: number } | null;
  /** S3: the approval.request row's at and the page's now (ms) for "raised HH:MM · waiting Nm" */
  raisedAt?: string | null;
  now?: number;
  /** S3: the kernel's voice handle of the card (card.voice: eligible none | reversible | gate, and its label) */
  voice?: { eligible: string; label: string } | null;
  /** S4: a held voice decision the kernel reports (seconds left, the undo phrase): the amber countdown, kernel-owned */
  held?: { seconds: number; undo: string } | null;
}

/** S3: the card's voice tag from the kernel's handle: `🎙 reversible · card 3`, `🎙 gate` + the handle word, or `hand-only`. */
export function voiceTagOf(v: CardView['voice']): { text: string; handle: string | null } | null {
  if (!v) return null;
  if (v.eligible === 'reversible') return { text: `🎙 reversible${v.label ? ` · ${v.label}` : ''}`, handle: null };
  if (v.eligible === 'gate') return { text: '🎙 gate', handle: v.label || null };
  return { text: 'hand-only', handle: null };
}

/** S3: the card's voice handle from the kernel card (card.voice), or null. */
export function cardVoiceOf(card: Record<string, unknown>): CardView['voice'] {
  const v = card.voice && typeof card.voice === 'object' && !Array.isArray(card.voice) ? (card.voice as Record<string, unknown>) : null;
  if (!v || typeof v.eligible !== 'string') return null;
  return { eligible: v.eligible, label: typeof v.label === 'string' ? v.label : '' };
}

/** S3: "raised 14:06 · waiting 3m" (minutes; under a minute reads "just now"). */
export function raisedLine(raisedAt: string | null | undefined, now: number): string | null {
  if (!raisedAt) return null;
  const t = Date.parse(raisedAt);
  if (!Number.isFinite(t)) return null;
  const m = Math.max(0, Math.floor((now - t) / 60_000));
  const waiting = m < 1 ? 'just now' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
  return `raised ${raisedAt.slice(11, 16)} · waiting ${waiting}`;
}

/**
 * Aegis S2/S3 M1: the card kinds whose FIRST line the kernel itself composes (a fixed template the kernel fills),
 * checked at every broker.raise call site that builds `lines` (packages/gnomon/src/kernel):
 *   permission, ask-user, plan    supervisor/permission.ts (the run-tool / question / plan templates) via supervisor.ts b.raise
 *   gate-class                    supervisor/repo-hooks.ts repoHookCard (supervisor.ts), runner/repin-card.ts, broker/theft-card.ts
 *   strictness                    broker/run-mode.ts (loosen), lifecycle/daemon.ts (voice widen), voice/voice-requests.ts (enrol)
 *   daemon-stop                   broker/daemon-stop.ts (stop + upgrade)
 *   api-token                     broker/api-token.ts
 *   fallback                      supervisor/local-session.ts
 *   install                       manifest/install.ts (kernel-composed lines first; the staged CLAIMS come after)
 *   grant                         modhost/control.ts (uninstall)
 * Only these get line 1 promoted to the title; any other kind (a mod's, a future one) keeps its block whole, is titled
 * by its kind, and its first line reads as the requester's quoted text.
 */
/**
 * Aegis S4 low (3), checked: `ask-user`'s line 1 is the fixed `The session asks you a question` / `… N questions`
 * template (supervisor/permission.ts composePermission); the requester's question text starts at line 3 (askLines),
 * so it stays kernel-titled.
 */
export const KERNEL_TITLED_KINDS: ReadonlySet<string> = new Set(['permission', 'ask-user', 'plan', 'gate-class', 'strictness', 'daemon-stop', 'api-token', 'fallback', 'install', 'grant']);

/**
 * Aegis S4 low (1): the stamp names the decision the kernel accepted (never always APPROVED). A closed map over the
 * contracts' CARD_DECISIONS; anything else (a future decision) reads DECIDED, never mod- or card-supplied text.
 */
const STAMP_WORDS: Readonly<Record<string, string>> = Object.freeze({
  allow: 'APPROVED', always: 'APPROVED', accept: 'APPROVED', 'approve-plan': 'APPROVED', install: 'INSTALLED',
  deny: 'DENIED', reject: 'REJECTED', withdraw: 'WITHDRAWN', answer: 'ANSWERED', resume: 'RESUMED', resolve: 'RESOLVED',
  'fallback-cloud': 'SENT TO CLOUD', 'use-api-token': 'APPROVED', extend: 'EXTENDED', restart: 'RESTARTED',
});
export function stampWord(decision: string): string {
  return Object.prototype.hasOwnProperty.call(STAMP_WORDS, decision) ? STAMP_WORDS[decision]! : 'DECIDED';
}

/**
 * S3: the card title is the block's first Text line (a Box whose first child is a Text), and the body is the block
 * without it. A claim-mismatch card keeps its block whole (its red first line stays the body's first line) and is
 * titled by its kind; so is every kind outside KERNEL_TITLED_KINDS (Aegis M1).
 */
export function splitCardBlock(block: unknown, kind: string, keepWhole: boolean): { title: string; body: unknown } {
  if (!KERNEL_TITLED_KINDS.has(kind)) keepWhole = true;
  const b = block && typeof block === 'object' && !Array.isArray(block) ? (block as Record<string, unknown>) : null;
  const kids = b && Array.isArray(b.children) ? (b.children as unknown[]) : null;
  const first = kids?.[0] && typeof kids[0] === 'object' ? (kids[0] as Record<string, unknown>) : null;
  const isText = !!first && (first.type === 'Text' || first.block === 'kit.Text' || first.block === 'Text');
  const text = isText ? (typeof first!.text === 'string' ? first!.text : first!.data && typeof (first!.data as Record<string, unknown>).text === 'string' ? String((first!.data as Record<string, unknown>).text) : '') : '';
  if (keepWhole || !text.trim() || !kids) return { title: kind, body: block };
  return { title: text.split('\n')[0]!, body: { ...b, children: kids.slice(1) } };
}

/**
 * TD-2026-10-20-294: the prefix-scoped `always` choices of a Bash permission card come ONLY from the block's
 * `{type:'bash-prefix', detail}` node whose detail hashes to the card's contentHash (the kernel derived them with
 * its simple-command rule); display only — the broker re-checks any prefix against the shown command.
 */
export type ApproveScopeParam = { kind: 'exact' } | { kind: 'prefix'; prefix: string[] };

/**
 * TD-2026-10-20-294: the `approve` params a decision key sends. An `always` key carries its scope in
 * `data-scope` / `data-prefix` (renderCard); any other decision, or a malformed key, sends no scope (the kernel
 * then learns the exact rule, never a wider one).
 */
export function approveParamsOf(cardId: string, decision: string, note: string | null, key: { scope?: string; prefix?: string } | null): { cardId: string; decision: string; note?: string; scope?: ApproveScopeParam } {
  const out: { cardId: string; decision: string; note?: string; scope?: ApproveScopeParam } = { cardId, decision, ...(note !== null ? { note } : {}) };
  if (decision !== 'always' || !key) return out;
  if (key.scope === 'exact') return { ...out, scope: { kind: 'exact' } };
  if (key.scope !== 'prefix') return out;
  try {
    const p = JSON.parse(key.prefix ?? '') as unknown;
    if (Array.isArray(p) && p.length > 0 && p.every((w) => typeof w === 'string')) return { ...out, scope: { kind: 'prefix', prefix: [...(p as string[])] } };
  } catch {
    /* a malformed key sends no scope */
  }
  return out;
}

export function prefixOptionsOf(card: Record<string, unknown>): string[][] | null {
  if (card.kind !== 'permission') return null;
  const block = card.block;
  const kids = block && typeof block === 'object' && Array.isArray((block as { children?: unknown }).children) ? (block as { children: unknown[] }).children : [];
  const nodes = kids.filter((k) => k && typeof k === 'object' && (k as { type?: unknown }).type === 'bash-prefix');
  if (nodes.length !== 1) return null;
  const detail = (nodes[0] as { detail?: unknown }).detail;
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null;
  if (typeof card.contentHash !== 'string' || cardContentHash(card, detail) !== card.contentHash) return null;
  const d = detail as { tool?: unknown; prefixOptions?: unknown };
  if (d.tool !== 'Bash' || !Array.isArray(d.prefixOptions) || d.prefixOptions.length === 0 || d.prefixOptions.length > 2) return null;
  const out: string[][] = [];
  for (const o of d.prefixOptions) {
    if (!Array.isArray(o) || o.length < 1 || o.length > 3 || !o.every((w) => typeof w === 'string' && w.length > 0 && w.length <= 128)) return null;
    out.push([...(o as string[])]);
  }
  return out;
}

/** Flags the GUI shows for a card: the kernel's `flags[]` plus any the sanitizer finds in the body (union, never fewer). */
export function cardFlags(card: Record<string, unknown>, kernelFlags: readonly string[]): string[] {
  const s = new Set<string>(kernelFlags);
  for (const f of flagsOf(card.block)) s.add(f);
  return [...s].sort();
}

/** One question of an ask-user card, from the kernel's STRUCTURED detail (display only: the kernel validates the answer). */
export interface AskCardQuestion {
  n: number;
  /** the RAW question text (the answer key the kernel matches exactly; shown only through the sanitizer) */
  question: string;
  header: string | null;
  multiSelect: boolean;
  options: string[];
}

export interface AskCardDetail {
  questions: AskCardQuestion[];
  maxAnswerChars: number;
}

/** contentHash exactly as the kernel's broker computes it (card.ts contentHashOf): sha256 over canonical {kind, requestedBy, hsid, detail, flags}. */
export function cardContentHash(card: { kind?: unknown; requestedBy?: unknown; hsid?: unknown; flags?: unknown }, detail: unknown): string {
  const flags = Array.isArray(card.flags) ? [...(card.flags as string[])].sort() : [];
  return `sha256:${hex(sha256(canonicalJson({ kind: card.kind, requestedBy: card.requestedBy, hsid: card.hsid ?? null, detail, flags })))}`;
}

/**
 * Aegis C1: the ask-user picker's questions come ONLY from the card block's
 * `{type:'ask-user', detail}` node whose detail hashes (with the card's kind,
 * requester, session and flags) to the card's contentHash — the hash the
 * kernel-signed actions bind. Display text is never parsed. A missing,
 * malformed or non-matching detail ⇒ null (no picker).
 */
export function askDetailOf(card: Record<string, unknown>): AskCardDetail | null {
  const block = card.block;
  const kids = block && typeof block === 'object' && Array.isArray((block as { children?: unknown }).children) ? (block as { children: unknown[] }).children : [];
  const nodes = kids.filter((k) => k && typeof k === 'object' && (k as { type?: unknown }).type === 'ask-user');
  if (nodes.length !== 1) return null;
  const detail = (nodes[0] as { detail?: unknown }).detail;
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null;
  if (typeof card.contentHash !== 'string' || cardContentHash(card, detail) !== card.contentHash) return null;
  const d = detail as { questions?: unknown; maxAnswerChars?: unknown };
  if (!Array.isArray(d.questions) || d.questions.length === 0 || typeof d.maxAnswerChars !== 'number' || !(d.maxAnswerChars > 0)) return null;
  const questions: AskCardQuestion[] = [];
  for (const [i, raw] of d.questions.entries()) {
    const q = raw as { question?: unknown; header?: unknown; multiSelect?: unknown; options?: unknown } | null;
    if (!q || typeof q.question !== 'string' || !Array.isArray(q.options) || typeof q.multiSelect !== 'boolean' || (q.header !== null && typeof q.header !== 'string')) return null;
    const options: string[] = [];
    for (const o of q.options) {
      if (!o || typeof (o as { label?: unknown }).label !== 'string') return null;
      options.push((o as { label: string }).label);
    }
    questions.push({ n: i + 1, question: q.question, header: (q.header as string | null) ?? null, multiSelect: q.multiSelect, options });
  }
  return { questions, maxAnswerChars: d.maxAnswerChars };
}

/** A picker's choices per question: the chosen option indexes and the free text (free text wins when non-empty). */
export interface AskPick {
  chosen: number[];
  free: string;
}

/**
 * The approve note for an ask-user card: the plain answer text for one
 * question, JSON `{answers:{question: answer}}` for several; null when a
 * question is left unanswered (no key is sent then). The answers object has
 * a null prototype, so a question named `__proto__` is an ordinary key.
 */
export function askNote(qs: readonly AskCardQuestion[], picks: ReadonlyMap<number, AskPick>): string | null {
  const answers = Object.create(null) as Record<string, string>;
  for (const q of qs) {
    const p = picks.get(q.n);
    const free = p?.free.trim() ?? '';
    const labels = (p?.chosen ?? []).map((i) => q.options[i]).filter((x): x is string => typeof x === 'string');
    const a = free !== '' ? free : labels.join(', ');
    if (a === '') return null;
    answers[q.question] = a;
  }
  if (!qs.length) return null;
  return qs.length === 1 ? answers[qs[0]!.question]! : JSON.stringify({ answers });
}

function askPicker(ctx: RenderCtx, cardId: string, ask: AskCardDetail): MiniEl {
  const { doc } = ctx;
  return h(
    doc,
    'div',
    { class: 'ask-picker', 'data-ask-card': cardId },
    ...ask.questions.map((q) =>
      h(
        doc,
        'fieldset',
        { class: 'ask-q', 'data-ask-q': String(q.n) },
        h(doc, 'legend', null, q.header ? `${q.header}: ${q.question}` : q.question),
        ...q.options.map((o, j) =>
          h(doc, 'label', { class: 'ask-opt' }, h(doc, 'input', { type: q.multiSelect ? 'checkbox' : 'radio', name: `ask-${cardId}-${q.n}`, value: String(j), 'data-ask-q': String(q.n), 'data-ask-opt': String(j) }), ` ${o}`),
        ),
        h(doc, 'input', {
          type: 'text',
          class: 'ask-free',
          maxlength: String(ask.maxAnswerChars),
          'aria-label': `your own answer to question ${q.n}: ${q.question}`,
          placeholder: q.options.length ? 'or type your own answer' : 'type your answer',
          'data-ask-q': String(q.n),
          'data-ask-free': '1',
        }),
      ),
    ),
  );
}

/**
 * Aegis M1 (TD-2026-10-20-294): prefix words shown one by one, each quoted, with every character outside printable
 * ASCII (and the quote and backslash themselves) escaped as \uXXXX, so ['git log', 'x'] reads 'git log' 'x', never
 * like ['git', 'log', 'x'], and a homoglyph argv0 (Cyrillic i in git) is visibly not git. Mirrors the kernel's
 * presence prompt (#prefix-policy shownPrefixWords).
 */
export function shownPrefixWords(prefix: readonly string[]): string {
  const esc = (ch: string): string => {
    const c = ch.codePointAt(0)!;
    if (c >= 0x20 && c <= 0x7e && ch !== "'" && ch !== '\\') return ch;
    return c <= 0xffff ? `\\u${c.toString(16).padStart(4, '0')}` : `\\u{${c.toString(16)}}`;
  };
  return prefix.map((w) => `'${Array.from(w).map(esc).join('')}'`).join(' ');
}

/** The kernel-owned card region. Decision keys only for verified actions on a decidable card. */
export function renderCard(ctx: RenderCtx, v: CardView, block: unknown): MiniEl {
  const { doc } = ctx;
  const keys = v.decidable && v.decisions.length ? v.decisions : [];
  const ask = v.kind === 'ask-user' && keys.includes('answer') ? (v.ask ?? null) : null;
  // TD-2026-10-19-063: a claim-mismatch card (e.g. a claude re-pin NOT signed by the expected publisher) focuses Deny
  const loud = v.flags.includes('claim-mismatch');
  // S1 ink keys: the first non-deny decision is the filled primary key (.key.pri); never on a claim-mismatch card,
  // where Deny stays the default focus and nothing is filled
  const pri = loud ? null : (keys.find((d) => d !== 'deny') ?? null);
  // S3 anatomy: ■ project · kind · voice tag (requestedBy and the session in title=), the title, the body, raised · waiting
  const { title, body } = splitCardBlock(block, v.kind, loud);
  const quoted = !loud && !KERNEL_TITLED_KINDS.has(v.kind);
  const tag = voiceTagOf(v.voice ?? null);
  const raised = v.held ? `Allowing in ${Math.max(0, Math.ceil(v.held.seconds))} · say “${v.held.undo}”` : raisedLine(v.raisedAt, v.now ?? Date.now());
  const failed = v.kind === 'incident' || v.flags.includes('failed');
  return h(
    doc,
    'section',
    { class: `card kind-${v.kind.replace(/[^a-z0-9-]/g, '')}${loud ? ' claim-mismatch' : ''}${failed ? ' failed' : ''}${v.held ? ' held' : ''}`, role: 'group', 'data-card-id': v.cardId, 'aria-label': `${v.kind} card` },
    h(
      doc,
      'header',
      { class: 'card-head k', title: `requested by ${v.requestedBy}${v.hsid ? ` · ${v.hsid}` : ''}${v.repo ? ` · ${v.repo}` : ''}` },
      v.project ? h(doc, 'span', { class: `card-project pink h${v.project.hue}` }, `■ ${v.project.name}`) : null,
      v.project ? ' · ' : null,
      h(doc, 'strong', { class: 'card-kind' }, v.kind),
      // Aegis M1: who asked is VISIBLE text, never only a tooltip
      ' · ',
      h(doc, 'span', { class: 'card-requester' }, `by ${v.requestedBy}`),
      tag ? ' · ' : null,
      tag ? h(doc, 'span', { class: 'card-voice kernel-owned' }, tag.text, tag.handle ? ' ' : null, tag.handle ? h(doc, 'span', { class: 'handle' }, tag.handle) : null) : null,
    ),
    h(doc, 'p', { class: 'card-title' }, title),
    h(doc, 'div', { class: `card-body kernel-owned${quoted ? ' quoted' : ''}` }, renderBlock(ctx, body)),
    raised ? h(doc, 'small', { class: `meta card-raised${v.held ? ' held-note kernel-owned' : ''}` }, raised) : null,
    ask ? askPicker(ctx, v.cardId, ask) : null,
    h(
      doc,
      'div',
      { class: 'card-keys' },
      ...v.flags.map((f) => h(doc, 'span', { class: `badge flag flag-${f.replace(/[^a-z0-9-]/g, '')}`, title: f === 'bidi' ? `card flag: bidi — shown as ${BIDI_LEGEND}` : `card flag: ${f}` }, f)),
      ...keys.flatMap((d) =>
        d === 'always' && v.prefixOptions?.length
          ? [
              h(doc, 'button', { class: `key key-always${d === pri ? ' pri' : ''}`, type: 'button', 'data-decision': d, 'data-scope': 'exact', 'data-card-id': v.cardId }, 'Always: this exact command'),
              ...v.prefixOptions.map((p) => h(doc, 'button', { class: 'key key-always key-prefix', type: 'button', 'data-decision': d, 'data-scope': 'prefix', 'data-prefix': JSON.stringify(p), 'data-card-id': v.cardId, title: `always allow a single command starting with these words, in this repo (no ; | && $() redirections or env assignments)` }, `Always: ${shownPrefixWords(p)} …`)),
            ]
          : [h(doc, 'button', { class: d === pri ? 'key pri' : 'key', type: 'button', 'data-decision': d, 'data-card-id': v.cardId, ...(loud && d === 'deny' ? { 'data-default': 'true' } : {}) }, d)],
      ),
      keys.length ? null : h(doc, 'small', { class: 'meta' }, v.decidable ? 'no verified decision keys' : `not decidable here (state ${v.state})`),
    ),
    h(doc, 'div', { class: 'bar', 'aria-hidden': 'true' }, h(doc, 'span', { class: 'bar-i' })),
    h(doc, 'span', { class: 'stamp', 'aria-hidden': 'true' }, ''),
    h(doc, 'small', { class: 'meta content-hash' }, `contentHash ${v.contentHash.slice(0, 23)}…`),
  );
}

/* ── S2.5: a SAFE markdown subset for agent text (DOM building only; no HTML passthrough, no links, no images) ── */

// `code`, **bold** / __bold__, *italic* / _italic_ (an underscore inside a word, as in snake_case, is not emphasis)
const MD_INLINE = /(`[^`\n]+`)|(\*\*(?=\S)[^*\n]*?\S\*\*|(?<![A-Za-z0-9])__(?=\S)[^_\n]*?\S__(?![A-Za-z0-9]))|(\*(?=[^\s*])[^*\n]*?[^\s*]\*|\*[^\s*]\*|(?<![A-Za-z0-9_])_(?=[^\s_])[^_\n]*?[^\s_]_(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])_[^\s_]_(?![A-Za-z0-9_]))/;

/** Inline markdown as DOM nodes; everything that is not one of the three spans stays text (sanitized by h). */
export function mdInline(doc: MiniDoc, src: string): Array<MiniEl | string> {
  const out: Array<MiniEl | string> = [];
  let rest = src;
  for (let guard = 0; rest && guard < 10_000; guard++) {
    const m = MD_INLINE.exec(rest);
    if (!m) break;
    if (m.index) out.push(rest.slice(0, m.index));
    const tok = m[0];
    if (m[1]) out.push(h(doc, 'code', { class: 'md-code' }, tok.slice(1, -1)));
    else if (m[2]) out.push(h(doc, 'strong', null, ...mdInline(doc, tok.slice(2, -2))));
    else out.push(h(doc, 'em', null, ...mdInline(doc, tok.slice(1, -1))));
    rest = rest.slice(m.index + tok.length);
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Block markdown: ``` fences (pre > code, the fence's info word dropped), `-`/`*`/`+` and `1.` lists, and paragraphs
 * (a blank line separates them; single newlines stay as line breaks via pre-wrap). An unclosed fence runs to the end.
 */
export function mdBlocks(doc: MiniDoc, src: string): MiniEl[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: MiniEl[] = [];
  let para: string[] = [];
  const flushPara = (): void => {
    if (para.length) out.push(h(doc, 'p', { class: 'md-p' }, ...mdInline(doc, para.join('\n'))));
    para = [];
  };
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      flushPara();
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i]!)) code.push(lines[i++]!);
      i++; // the closing fence (or past the end)
      out.push(h(doc, 'pre', { class: 'md-pre' }, h(doc, 'code', null, code.join('\n'))));
      continue;
    }
    const ul = /^\s*[-*+]\s+(.*)$/;
    const ol = /^\s*\d{1,9}[.)]\s+(.*)$/;
    const kind = ul.test(line) ? ul : ol.test(line) ? ol : null;
    if (kind) {
      flushPara();
      const lis: MiniEl[] = [];
      while (i < lines.length && kind.test(lines[i]!)) lis.push(h(doc, 'li', null, ...mdInline(doc, kind.exec(lines[i++]!)![1]!)));
      out.push(h(doc, kind === ul ? 'ul' : 'ol', { class: 'md-list' }, ...lis));
      continue;
    }
    if (!line.trim()) flushPara();
    else para.push(line);
    i++;
  }
  flushPara();
  return out;
}
