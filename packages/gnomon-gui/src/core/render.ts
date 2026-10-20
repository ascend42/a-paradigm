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

const ALLOWED_TAGS = new Set(['input', 'label', 'fieldset', 'legend', 'div', 'span', 'p', 'pre', 'ul', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'button', 'progress', 'header', 'section', 'strong', 'code', 'kbd', 'small']);
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
      return h(doc, 'div', { class: 'blk blk-box' }, ...kids.map(child));
    case 'Text':
      return h(doc, 'p', { class: 'blk blk-text' }, str(data.text));
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

/** The kernel-owned card region. Decision keys only for verified actions on a decidable card. */
export function renderCard(ctx: RenderCtx, v: CardView, block: unknown): MiniEl {
  const { doc } = ctx;
  const keys = v.decidable && v.decisions.length ? v.decisions : [];
  const ask = v.kind === 'ask-user' && keys.includes('answer') ? (v.ask ?? null) : null;
  // TD-2026-10-19-063: a claim-mismatch card (e.g. a claude re-pin NOT signed by the expected publisher) focuses Deny
  const loud = v.flags.includes('claim-mismatch');
  return h(
    doc,
    'section',
    { class: `card kind-${v.kind.replace(/[^a-z0-9-]/g, '')}${loud ? ' claim-mismatch' : ''}`, role: 'group', 'data-card-id': v.cardId, 'aria-label': `${v.kind} card` },
    h(doc, 'header', { class: 'card-head' }, h(doc, 'strong', { class: 'card-kind' }, v.kind), h(doc, 'small', { class: 'meta' }, ` ${v.requestedBy}${v.hsid ? ` · ${v.hsid}` : ''}${v.repo ? ` · ${v.repo}` : ''}`)),
    h(doc, 'div', { class: 'card-body kernel-owned' }, renderBlock(ctx, block)),
    ask ? askPicker(ctx, v.cardId, ask) : null,
    h(
      doc,
      'div',
      { class: 'card-keys' },
      ...v.flags.map((f) => h(doc, 'span', { class: `badge flag flag-${f.replace(/[^a-z0-9-]/g, '')}`, title: f === 'bidi' ? `card flag: bidi — shown as ${BIDI_LEGEND}` : `card flag: ${f}` }, f)),
      ...keys.flatMap((d) =>
        d === 'always' && v.prefixOptions?.length
          ? [
              h(doc, 'button', { class: 'key key-always', type: 'button', 'data-decision': d, 'data-scope': 'exact', 'data-card-id': v.cardId }, 'Always: this exact command'),
              ...v.prefixOptions.map((p) => h(doc, 'button', { class: 'key key-always key-prefix', type: 'button', 'data-decision': d, 'data-scope': 'prefix', 'data-prefix': JSON.stringify(p), 'data-card-id': v.cardId, title: `always allow a single command starting with these words, in this repo (no ; | && $() redirections or env assignments)` }, `Always: ${p.join(' ')} …`)),
            ]
          : [h(doc, 'button', { class: 'key', type: 'button', 'data-decision': d, 'data-card-id': v.cardId, ...(loud && d === 'deny' ? { 'data-default': 'true' } : {}) }, d)],
      ),
      keys.length ? null : h(doc, 'small', { class: 'meta' }, v.decidable ? 'no verified decision keys' : `not decidable here (state ${v.state})`),
    ),
    h(doc, 'small', { class: 'meta content-hash' }, `contentHash ${v.contentHash.slice(0, 23)}…`),
  );
}
