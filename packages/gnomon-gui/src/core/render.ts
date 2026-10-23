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
 * block, flags as visible warn chips beside the decision keys, and the
 * `contentHash` summary line — rendered by the GUI core, never by a mod.
 */
import { BIDI_GLYPHS, canonicalJson, checkCap, hex, PRINCIPAL_ID_PATTERN, sanitizeDisplayText, sha256, type Cap } from '@a-company/gnomon-contracts';
import { BLOCK_SAFE_COMMANDS } from './commands.js';

/** Legend for the `bidi` card flag chip: the glyphs the contracts sanitizer shows in place of bidi controls. */
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
  /** SVG elements (S5 caps); only `svgEl` calls it, with the SVG namespace and an allowlisted tag. */
  createElementNS?(ns: string, tag: string): MiniEl;
}
export interface MiniEl {
  appendChild(child: unknown): unknown;
  setAttribute(name: string, value: string): void;
  className: string;
}

// h2/h3 are for the GUI's own sheet titles and section heads (trusted strings). If markdown ever gains headings,
// render them as a styled p or strong, never h2/h3: model text must not enter the page outline (Aegis).
const ALLOWED_TAGS = new Set(['form', 'input', 'label', 'fieldset', 'legend', 'div', 'span', 'p', 'pre', 'ul', 'ol', 'li', 'em', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'button', 'progress', 'header', 'section', 'strong', 'code', 'kbd', 'small', 'details', 'summary', 'h2', 'h3']);
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

/** S5: the closed Text tones (each maps to a .tone-* class); anything else is dropped. Generic, no mod-name case. */
// Aegis S5 L2: no `violet` here: violet is the KNOT cap's (renderCap .knot), never a generic text tone
// `head` (a section head in the label style) and `chip` (a symbol chip, design-system chip ink) are the mod kit's
// two layout tones; styles.css has always styled them, so dropping them rendered heads as body text (founder 2026-10-23)
export const TONES: ReadonlySet<string> = new Set(['cap', 'quiet', 'paused', 'warn', 'deny', 'head', 'chip', 'hue-0', 'hue-1', 'hue-2', 'hue-3', 'hue-4', 'hue-5']);

/** A hollow mark (a local backend, a project with no session): its swatch is the outlined □, else the filled ■. */
const HOLLOW_MARK = /^[○◌◯□▢◇]$/u;
/** In a fitted view, a Text with no whitespace longer than this is a token (an id): one line, ellipsis, full text in title. */
export const FIT_TOKEN_MIN = 12;
/** In a fitted view, prose longer than this carries its full text in title (a row clamps it to two lines). */
export const FIT_TITLE_MIN = 40;
/** A table cell or head shows at most this many characters (ellipsis; full text in title). */
export const FIT_CELL_MAX = 24;
/**
 * The width buckets (in ch of the fitted view's 11.5 type) a table is sorted into by its natural width. styles.css has
 * one container query per bucket: a container narrower than the table's bucket lays each row out as key-value pairs.
 */
export const FIT_TABLE_BUCKETS: readonly number[] = Object.freeze([20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96]);
const NIL_CELL = /^[-–—·]?$/u;
const NUM_CELL = /^[-+−~≈<>]?[$€£]?\d[\d.,]*\s?[%kKMGTB]?$/u;
const cps = (s: string): number => [...s].length;

/** The shape of a fitted table: which columns are numbers, which cells are empty, and its width bucket. */
export interface TableFit {
  numeric: boolean[];
  bucket: number;
  /** natural width in ch (headers at label size count 10.5/11.5 of their length) */
  need: number;
}

/** PURE: how a Table fits a narrow column (core of the fitted renderer; test/mod-fit.test.ts). */
export function tableFit(columns: readonly string[], rows: readonly (readonly string[])[]): TableFit {
  const n = Math.max(columns.length, ...rows.map((r) => r.length), 0);
  const numeric: boolean[] = [];
  let need = 0;
  for (let c = 0; c < n; c++) {
    const cells = rows.map((r) => (r[c] ?? '').trim());
    const filled = cells.filter((x) => !NIL_CELL.test(x));
    // a column of only empty cells ('-') aligns as numbers: an empty count is the common case (a fresh session)
    numeric.push(filled.every((x) => NUM_CELL.test(x)));
    const w = Math.max(Math.ceil(cps(columns[c] ?? '') * (10.5 / 11.5)), ...cells.map(cps), 1);
    need += Math.min(w, FIT_CELL_MAX);
  }
  // 8px between columns is about 1.2ch at 11.5; one ch of slack so a table that just fits is never clipped
  need = Math.ceil(need + Math.max(0, n - 1) * 1.2 + 1);
  const bucket = FIT_TABLE_BUCKETS.find((b) => b >= need) ?? FIT_TABLE_BUCKETS[FIT_TABLE_BUCKETS.length - 1]!;
  return { numeric, bucket, need };
}

export type FitTextKind = 'token' | 'word' | 'prose' | 'chip';
/** PURE: how a fitted Text lays out: an id-like token (no whitespace, > FIT_TOKEN_MIN), a short word, prose, or a chip. */
export function fitTextKind(t: string, tone: string | null): FitTextKind {
  if (tone === 'chip') return 'chip';
  if (/\s/u.test(t.trim())) return 'prose';
  return cps(t) > FIT_TOKEN_MIN ? 'token' : 'word';
}
/** The fit kind of a block node (null: not a plain Text, e.g. a Box, a cap or a hue swatch). */
function fitKindOf(node: unknown): FitTextKind | null {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
  const n = node as Record<string, unknown>;
  const d = (n.data && typeof n.data === 'object' ? n.data : n) as Record<string, unknown>;
  if (blockName(n) !== 'Text' || d.cap !== undefined) return null;
  const tone = typeof d.tone === 'string' && TONES.has(d.tone) ? d.tone : null;
  if (tone?.startsWith('hue-')) return null;
  return fitTextKind(str(d.text), tone);
}

/** Whether a cell reads as empty ('-', '—', '·' or nothing): quiet in a table, left out of the key-value layout. */
export const isNilCell = (s: string): boolean => NIL_CELL.test(s.trim());

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'path']);
const SVG_ATTRS = new Set(['viewBox', 'd', 'aria-hidden', 'focusable']);
/** The three hats (the comp, workshop-placement.html), in a 22x28 box. The ONLY path data the GUI ever draws. */
export const CAP_PATHS: Readonly<Record<Cap['shape'], string>> = Object.freeze({
  tall: 'M11 1 L19 26 H3 Z',
  wide: 'M11 6 L21 26 H1 Z',
  floppy: 'M11 2 C15 8 21 10 20 26 H2 C3 14 9 12 11 2 Z',
});

/** An SVG element: allowlisted tag and attributes; values are GUI constants (never mod data). */
function svgEl(doc: MiniDoc, tag: string, attrs: Record<string, string>, ...children: MiniEl[]): MiniEl | null {
  if (!SVG_TAGS.has(tag) || !doc.createElementNS) return null;
  const el = doc.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (!SVG_ATTRS.has(k)) throw new Error(`render: svg attribute ${k} is not allowed`);
    el.setAttribute(k, v);
  }
  for (const c of children) el.appendChild(c);
  return el;
}

/**
 * S5: a Text node carrying a valid cap draws a hat. Every visual comes from the five checked fields through
 * GUI-owned constants and classes: shape -> CAP_PATHS, hue -> .hN, filled -> .outlined, state -> .needs/.working/
 * .idle/.knot (.bob only while working; violet only for knot). The node's text is the accessible name; the
 * label shows above a needs/knot cap. Reduced motion hides the bob and prints the word `working` (CSS).
 */
export function renderCap(doc: MiniDoc, textValue: string, cap: Cap): MiniEl {
  const cls = ['cap', `h${cap.hue}`, `cap-${cap.shape}`, `st-${cap.state}`];
  if (!cap.filled) cls.push('outlined');
  if (cap.state === 'knot') cls.push('knot');
  if (cap.state === 'working') cls.push('bob');
  const path = svgEl(doc, 'path', { d: CAP_PATHS[cap.shape] });
  const svg = path ? svgEl(doc, 'svg', { viewBox: '0 0 22 28', 'aria-hidden': 'true', focusable: 'false' }, path) : null;
  const asks = cap.state === 'needs' || cap.state === 'knot';
  return h(
    doc,
    'span',
    { class: cls.join(' '), role: 'img', 'aria-label': textValue || cap.label, title: cap.label, 'data-cap-state': cap.state },
    asks ? h(doc, 'span', { class: 'q', 'aria-hidden': 'true' }, cap.label) : null,
    svg ?? h(doc, 'span', { class: 'cap-glyph', 'aria-hidden': 'true' }, cap.label),
    h(doc, 'span', { class: 'sh', 'aria-hidden': 'true' }),
    cap.state === 'working' ? h(doc, 'span', { class: 'cap-word', 'aria-hidden': 'true' }, 'working') : null,
  );
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
  /** S5: a mod fence shows each Box title as a heading (card bodies never set this). */
  boxTitles?: boolean;
  /**
   * A mod view in a side column (every fence but the Workshop's): ids truncate on one line with their full text in
   * title, row prose clamps to two lines, and a table fits its column (numbers right-aligned, a key-value layout
   * below its width bucket). Styled by .mod-fit in styles.css; card bodies never set it.
   */
  fit?: boolean;
  /** internal (fit): this prose follows an id in a row Box, so it starts its own line */
  breakLine?: boolean;
}

/** Render one display-block node (any depth ≤ 32). */
export function renderBlock(ctx: RenderCtx, node: unknown): MiniEl {
  const { doc } = ctx;
  const depth = ctx.depth ?? 0;
  if (!node || typeof node !== 'object' || Array.isArray(node)) return h(doc, 'span', { class: 'blk blk-text' }, str(node));
  const n = node as Record<string, unknown>;
  const data = (n.data && typeof n.data === 'object' ? n.data : n) as Record<string, unknown>;
  const kids = Array.isArray(n.children) ? n.children : [];
  const name = blockName(n);
  const child = (c: unknown, breakLine = false): MiniEl => (depth >= 32 ? h(doc, 'span', { class: 'blk' }, '…') : renderBlock({ ...ctx, depth: depth + 1, breakLine }, c));
  switch (name) {
    case 'Box': {
      // fitted row: prose after an id starts its own line (the id keeps line 1 and truncates; the prose reads under it)
      let afterToken = false;
      const breaks = kids.map((c) => {
        const k = ctx.fit && data.direction === 'row' ? fitKindOf(c) : null;
        const b = afterToken && k === 'prose';
        if (k === 'token') afterToken = true;
        return b;
      });
      return h(doc, 'div', { class: `blk blk-box${data.direction === 'row' ? ' blk-row' : ''}` }, ctx.boxTitles && typeof data.title === 'string' && data.title ? h(doc, 'div', { class: 'blk-title' }, data.title) : null, ...kids.map((c, i) => child(c, breaks[i])));
    }
    case 'Text': {
      // S5: a cap is drawn only when every field checks (contracts checkCap); otherwise the text form shows
      if (data.cap !== undefined) {
        const c = checkCap(data.cap);
        if (c.ok) return renderCap(doc, str(data.text), c.cap);
      }
      // a tone is one of the closed TONES mapped to a class (styles.css .tone-*), never a style or a colour value
      const tone = typeof data.tone === 'string' && TONES.has(data.tone) ? data.tone : null;
      const t = str(data.text);
      // a project hue is the project's swatch, the chat header's ■ in the hue's ink pair (hue-is-identity); the
      // mod's glyph only says filled or hollow. Decorative: the name beside it carries the meaning
      if (tone?.startsWith('hue-')) return h(doc, 'span', { class: `blk blk-swatch pink h${tone.slice(4)}`, 'aria-hidden': 'true' }, HOLLOW_MARK.test(t.trim()) ? '□' : '■');
      const cls = `blk blk-text${tone ? ` tone-${tone}` : ''}`;
      if (!ctx.fit) return h(doc, 'p', { class: cls }, t);
      // fitted: an id never breaks mid-token (one line, ellipsis, the full id in title); a short word never wraps;
      // long prose keeps its full text in title (a row clamps it to two lines)
      const kind = fitTextKind(t, tone);
      const fitCls = kind === 'token' ? ' blk-tok' : kind === 'word' ? ' blk-word' : kind === 'prose' ? ` blk-prose${ctx.breakLine ? ' blk-break' : ''}` : '';
      return h(doc, 'p', { class: `${cls}${fitCls}`, ...(kind === 'token' || cps(t) > FIT_TITLE_MIN ? { title: t } : {}) }, t);
    }
    case 'List': {
      const items = Array.isArray(data.items) ? data.items : kids;
      return h(doc, 'ul', { class: 'blk blk-list' }, ...items.map((it) => h(doc, 'li', null, typeof it === 'object' && it !== null ? child(it) : str(it))));
    }
    case 'Table': {
      const cols = (Array.isArray(data.columns) ? data.columns : []).map(str);
      const rows = (Array.isArray(data.rows) ? data.rows : []).map((r) => (Array.isArray(r) ? r : [r]).map(str));
      if (!ctx.fit) {
        return h(
          doc,
          'table',
          { class: 'blk blk-table' },
          h(doc, 'thead', null, h(doc, 'tr', null, ...cols.map((c) => h(doc, 'th', null, c)))),
          h(doc, 'tbody', null, ...rows.map((r) => h(doc, 'tr', null, ...r.map((c) => h(doc, 'td', null, c))))),
        );
      }
      // fitted: explicit roles keep the table's semantics when the key-value layout changes its display
      const fit = tableFit(cols, rows);
      const cell = (s: string): MiniEl => h(doc, 'span', { class: 'blk-cell', ...(cps(s) > FIT_CELL_MAX ? { title: s } : {}) }, s);
      return h(
        doc,
        'table',
        { class: `blk blk-table tw-${fit.bucket}`, role: 'table', 'data-need': String(fit.need) },
        h(doc, 'thead', { role: 'rowgroup' }, h(doc, 'tr', { role: 'row' }, ...cols.map((c, i) => h(doc, 'th', { role: 'columnheader', ...(fit.numeric[i] ? { class: 'num' } : {}) }, cell(c))))),
        h(
          doc,
          'tbody',
          { role: 'rowgroup' },
          ...rows.map((r) =>
            h(doc, 'tr', { role: 'row' }, ...r.map((c, i) => h(doc, 'td', { role: 'cell', class: [fit.numeric[i] ? 'num' : '', isNilCell(c) ? 'blk-nil' : ''].filter(Boolean).join(' '), 'data-col': cols[i] ?? '' }, cell(c)))),
          ),
        ),
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
    case 'root-rows':
      // Aegis C1e: the kernel's structured root rows: renderCard's "This decision signs" section renders them (rootRowsOf)
      return h(doc, 'span', { class: 'blk blk-root-rows' });
    case 'edit-scope':
      // the kernel's structured edit-scope choices (TD-2026-10-23-939 follow-up): the card's always keys render them (editScopesOf)
      return h(doc, 'span', { class: 'blk blk-edit-scope' });
    case 'git-verb':
      // #git-verbs (T-2026-10-23-002): the kernel's structured verb detail; the card's k-line and always key render it (gitVerbOf)
      return h(doc, 'span', { class: 'blk blk-git-verb' });
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
      return h(doc, 'div', { class: 'blk blk-opaque' }, `[block ${name || '?'}] `, ...kids.map((c) => child(c)), typeof data.text === 'string' ? data.text : null);
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
  /** Edit/Write permission: the scoped always choices from the contentHash-verified detail (editScopesOf); null ⇒ exact only */
  editScopes?: ('file' | 'repo-edits')[] | null;
  /** #git-verbs: a kernel git verb card's facts from the contentHash-verified git-verb node (gitVerbOf); null ⇒ none */
  gitVerb?: GitVerbView | null;
  /** Mika 2026-10-23: the scoped always choices are unfolded under the keys (the page keeps it per card and zone across repaints) */
  alwaysOpen?: boolean;
  /** S3: the card's project (repo basename) and its ONE project hue (groupHue / projectHue); null ⇒ no project line */
  project?: { name: string; hue: number } | null;
  /** S3: the approval.request row's at and the page's now (ms) for "raised HH:MM · waiting Nm" */
  raisedAt?: string | null;
  now?: number;
  /** S3: the kernel's voice handle of the card (card.voice: eligible none | reversible | gate, and its label) */
  voice?: { eligible: string; label: string } | null;
  /** S4: a held voice decision the kernel reports (seconds left, the undo phrase): the amber countdown, kernel-owned */
  held?: { seconds: number; undo: string } | null;
  /** fidelity 2: a permission card's one-line title the GUI composed from the kernel's STRUCTURED fields (permissionTitleOf) */
  composedTitle?: ComposedTitle | null;
  /**
   * Aegis C1e (TD-2026-10-20-514): what a root-class decision of this card signs (rootRowsOf), verified against
   * contentHash. null on a root-class card ⇒ its root decisions show NO key (missing node, bad hash, a row it cannot render)
   */
  rootRows?: RootRowsView | null;
  /** Q2: the helper cannot sign a decision and its rows in one touch (status.helper.batch unavailable, helper < 1.8.0) */
  batchUnavailable?: boolean;
  /** Aegis L2: the local trust set's namespace (localNsOf the connection's principal); null/absent => no shortening */
  localNs?: string | null;
  /** #gui-loops: a loop-* card whose loop the kernel attributes to an agent key (authoredBy basis 'agent-key-claim'): the head says "claimed by <agent>" */
  loopClaimedBy?: string | null;
}

/** A permission card's composed title: the verb, the whole arg (lines kept), and whether the arg hit TITLE_ARG_MAX. */
export interface ComposedTitle {
  verb: string;
  arg: string;
  truncated?: boolean;
}

/**
 * fidelity 2: the short requester mark a card shows. Aegis L2: only a principal of the LOCAL trust set shortens: a
 * `p:<ns>/<name>` whose `<ns>` is the connected home's namespace (`localNs`, from the handshake's own principal, the
 * one trust set, where the name is unique) shows its name (`claude` for `p:7k2m9q4x/claude`). Any other namespace, a
 * foreign principal (`…@rootKeyId8`), anything odd, or no known local namespace shows WHOLE. The full principal stays
 * in the card head's title= and in its details.
 */
export function shortRequester(requestedBy: string, localNs: string | null | undefined): string {
  const m = PRINCIPAL_ID_PATTERN.exec(requestedBy);
  return m && typeof localNs === 'string' && m[1] === localNs ? m[2]! : requestedBy;
}

/** Aegis L2: the local trust set's namespace from the connection's own principal (`p:<ns>/<name>`), else null. */
export function localNsOf(principal: string | null | undefined): string | null {
  const m = typeof principal === 'string' ? PRINCIPAL_ID_PATTERN.exec(principal) : null;
  return m ? m[1]! : null;
}

/** inputHash exactly as the kernel's supervisor computes it (permission.ts inputHash): sha256 over canonical JSON. */
export function toolInputHash(input: unknown): string | null {
  try {
    return `sha256:${hex(sha256(canonicalJson(input)))}`;
  } catch {
    return null;
  }
}

/** The path field a path tool names (permission.ts PATH_TOOLS). */
const PATH_FIELDS: Readonly<Record<string, string>> = Object.freeze({ Edit: 'file_path', MultiEdit: 'file_path', Write: 'file_path', NotebookEdit: 'notebook_path', Read: 'file_path' });
/**
 * Aegis H1 (fidelity 2 pass 2): the composed arg is never cut to a one-liner. It WRAPS on the card face, keeps every
 * line, and is capped only for huge commands; a capped arg says so and the card then shows the kernel's body VISIBLY.
 */
export const TITLE_ARG_MAX = 4000;
/** Every line break a command can carry (the sanitizer already maps U+2028/2029 to \n): each is its own visible line. */
const ARG_LINE_BREAK = /\r\n|[\n\r\v\f\u0085\u2028\u2029]/;
/** The shell's command separators and substitutions, marked visibly inside a line (quotes are not parsed: over-marking is safe). */
const ARG_SEP = /(&&|\|\||;|\||&|`|\$\()/;

/** The composed arg's lines, as the card shows them: split at every line break, never joined with a space. */
export function argLines(arg: string): string[] {
  return arg.split(ARG_LINE_BREAK);
}

/**
 * fidelity 2: a permission card's composed title, e.g. `Allow Bash` + `pnpm test --filter billing`, composed ONLY from
 * the kernel's structured fields: the approval.request row's `tool` and `tool_input` (broker.ts logs both), and only
 * when the card's kernel-composed line 1 names that same tool (`The session asks to run <tool>`, permission.ts). When
 * the card carries the kernel's contentHash-verified structured detail (the bash-prefix node), its tool and inputHash
 * must match the row's too. Never display text, never requester prose; null => the kernel's line 1 stays the title.
 */
export function permissionTitleOf(card: Record<string, unknown>, tool: unknown, toolInput: unknown): ComposedTitle | null {
  if (card.kind !== 'permission' || typeof tool !== 'string' || !/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/.test(tool)) return null;
  if (splitCardBlock(card.block, 'permission', false).title !== `The session asks to run ${tool}`) return null;
  const inp = toolInput && typeof toolInput === 'object' && !Array.isArray(toolInput) ? (toolInput as Record<string, unknown>) : null;
  const block = card.block;
  const kids = block && typeof block === 'object' && Array.isArray((block as { children?: unknown }).children) ? (block as { children: unknown[] }).children : [];
  const nodes = kids.filter((k) => k && typeof k === 'object' && (k as { type?: unknown }).type === 'bash-prefix');
  if (nodes.length) {
    const detail = (nodes[0] as { detail?: unknown }).detail as Record<string, unknown> | undefined;
    if (nodes.length !== 1 || !detail || typeof detail !== 'object' || typeof card.contentHash !== 'string' || cardContentHash(card, detail) !== card.contentHash) return null;
    if (detail.tool !== tool || !inp || detail.inputHash !== toolInputHash(inp)) return null;
  }
  const raw = !inp ? null : tool === 'Bash' ? inp.command : Object.hasOwn(PATH_FIELDS, tool) ? inp[PATH_FIELDS[tool]!] : null;
  // Aegis H1: no whitespace collapse (`git status\nrm -rf ~` is two commands and reads as two lines)
  let arg = typeof raw === 'string' ? raw.replace(/^\s+|\s+$/g, '') : '';
  const cps = Array.from(arg);
  const truncated = cps.length > TITLE_ARG_MAX;
  if (truncated) arg = `${cps.slice(0, TITLE_ARG_MAX - 1).join('')}…`;
  return { verb: `Allow ${tool}`, arg, truncated };
}

/** S3: the card's voice tag from the kernel's handle, in words: `voice · reversible · card 3`, `voice · gate` + the handle word, or `hand only`. */
export function voiceTagOf(v: CardView['voice']): { text: string; handle: string | null } | null {
  if (!v) return null;
  if (v.eligible === 'reversible') return { text: `voice · reversible${v.label ? ` · ${v.label}` : ''}`, handle: null };
  if (v.eligible === 'gate') return { text: 'voice · gate', handle: v.label || null };
  return { text: 'hand only', handle: null };
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
export const KERNEL_TITLED_KINDS: ReadonlySet<string> = new Set(['permission', 'ask-user', 'plan', 'gate-class', 'strictness', 'daemon-stop', 'api-token', 'fallback', 'install', 'grant', 'loop-trust', 'loop-choice']);

/**
 * Aegis S4 low (1): the stamp names the decision the kernel accepted (never always APPROVED). A closed map over the
 * contracts' CARD_DECISIONS; anything else (a future decision) reads DECIDED, never mod- or card-supplied text.
 */
const STAMP_WORDS: Readonly<Record<string, string>> = Object.freeze({
  allow: 'APPROVED', always: 'APPROVED', accept: 'APPROVED', 'approve-plan': 'APPROVED', install: 'INSTALLED',
  deny: 'DENIED', reject: 'REJECTED', withdraw: 'WITHDRAWN', answer: 'ANSWERED', resume: 'RESUMED', resolve: 'RESOLVED',
  'fallback-cloud': 'SENT TO CLOUD', 'use-api-token': 'APPROVED', extend: 'EXTENDED', restart: 'RESTARTED',
  // 8.0:loops: the loop-choice card's decisions
  continue: 'CONTINUED', stop: 'STOPPED',
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
export type ApproveScopeParam = { kind: 'exact' } | { kind: 'prefix'; prefix: string[] } | { kind: 'file' } | { kind: 'repo-edits' };

/**
 * TD-2026-10-20-294: the `approve` params a decision key sends. An `always` key carries its scope in
 * `data-scope` / `data-prefix` (renderCard); any other decision, or a malformed key, sends no scope (the kernel
 * then learns the exact rule, never a wider one).
 */
export function approveParamsOf(cardId: string, decision: string, note: string | null, key: { scope?: string; prefix?: string } | null): { cardId: string; decision: string; note?: string; scope?: ApproveScopeParam } {
  const out: { cardId: string; decision: string; note?: string; scope?: ApproveScopeParam } = { cardId, decision, ...(note !== null ? { note } : {}) };
  if (decision !== 'always' || !key) return out;
  if (key.scope === 'exact') return { ...out, scope: { kind: 'exact' } };
  if (key.scope === 'file' || key.scope === 'repo-edits') return { ...out, scope: { kind: key.scope } };
  if (key.scope !== 'prefix') return out;
  try {
    const p = JSON.parse(key.prefix ?? '') as unknown;
    if (Array.isArray(p) && p.length > 0 && p.every((w) => typeof w === 'string')) return { ...out, scope: { kind: 'prefix', prefix: [...(p as string[])] } };
  } catch {
    /* a malformed key sends no scope */
  }
  return out;
}

/**
 * TD-2026-10-23-939 follow-up (Aegis 2026-10-23): the scoped `always` choices of an edit card ("this file", "edits in
 * this repo") come ONLY from the block's `{type:'edit-scope', detail}` node whose detail hashes to the card's
 * contentHash (the kernel offers them only when its auto-edits pass would allow the edit); display only, the broker
 * re-checks the scope against the card.
 */
export function editScopesOf(card: Record<string, unknown>): ('file' | 'repo-edits')[] | null {
  if (card.kind !== 'permission') return null;
  const block = card.block;
  const kids = block && typeof block === 'object' && Array.isArray((block as { children?: unknown }).children) ? (block as { children: unknown[] }).children : [];
  const nodes = kids.filter((k) => k && typeof k === 'object' && (k as { type?: unknown }).type === 'edit-scope');
  if (nodes.length !== 1) return null;
  const detail = (nodes[0] as { detail?: unknown }).detail;
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null;
  if (typeof card.contentHash !== 'string' || cardContentHash(card, detail) !== card.contentHash) return null;
  const d = detail as { tool?: unknown; editScopes?: unknown; editPath?: unknown };
  if (!['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(String(d.tool)) || typeof d.editPath !== 'string' || !Array.isArray(d.editScopes)) return null;
  const out = d.editScopes.filter((x): x is 'file' | 'repo-edits' => x === 'file' || x === 'repo-edits');
  return out.length === d.editScopes.length && out.length > 0 ? [...new Set(out)] : null;
}

/**
 * The plain words of a scoped edit always choice (Mika 2026-10-23): `label` is the accessible name (it contains the
 * visible `short`), `note` is shown beside the key (never only on hover), `title` is the long form.
 */
export const EDIT_SCOPE_KEYS: Readonly<Record<'file' | 'repo-edits', { label: string; short: string; note: string; title: string }>> = Object.freeze({
  file: { label: 'Always: edits to this file', short: 'edits to this file', note: 'any change to this file', title: 'always allow edits to this file, any content, in this repo (not in manual run mode)' },
  'repo-edits': { label: 'Always: edits in this repo', short: 'edits in this repo', note: 'same as auto-edits for this repo', title: 'same as auto-edits for this repo: every edit inside the repo, except protected paths (not in manual run mode)' },
});

/** #git-verbs (T-2026-10-23-002): what a kernel git verb card shows beside its title, from the kernel's own detail. */
export interface GitVerbView {
  verb: 'git.init' | 'git.push' | 'repo.create' | 'git.worktree.add' | 'git.worktree.remove';
  host: string | null;
  /** host/owner/repo */
  slug: string | null;
  branch: string | null;
  visibility: 'private' | 'public' | null;
  force: boolean;
}

/**
 * #git-verbs: a kernel git verb card's facts come ONLY from the block's `{type:'git-verb', detail}` node whose detail
 * hashes to the card's contentHash (display only; the kernel holds the remote it pushes to and re-reads it).
 */
export function gitVerbOf(card: Record<string, unknown>): GitVerbView | null {
  if (card.kind !== 'permission') return null;
  const block = card.block;
  const kids = block && typeof block === 'object' && Array.isArray((block as { children?: unknown }).children) ? (block as { children: unknown[] }).children : [];
  const nodes = kids.filter((k) => k && typeof k === 'object' && (k as { type?: unknown }).type === 'git-verb');
  if (nodes.length !== 1) return null;
  const detail = (nodes[0] as { detail?: unknown }).detail;
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null;
  if (typeof card.contentHash !== 'string' || cardContentHash(card, detail) !== card.contentHash) return null;
  const d = detail as Record<string, unknown>;
  const verbs = ['git.init', 'git.push', 'repo.create', 'git.worktree.add', 'git.worktree.remove'] as const;
  if (!verbs.includes(d.verb as never)) return null;
  const s = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 300 ? v : null);
  return { verb: d.verb as GitVerbView['verb'], host: s(d.host), slug: s(d.slug) ?? (s(d.host) && s(d.owner) && s(d.repo) ? `${String(d.host)}/${String(d.owner)}/${String(d.repo)}` : null), branch: s(d.branch), visibility: d.visibility === 'private' || d.visibility === 'public' ? d.visibility : null, force: d.force === true };
}

/** #git-verbs: the k-line under a push or create card's title: host · owner/repo · visibility · branch (plain words). */
export function gitVerbLine(g: GitVerbView): string | null {
  if (g.verb !== 'git.push' && g.verb !== 'repo.create') return null;
  if (!g.host || !g.slug) return null;
  const rest = g.slug.startsWith(`${g.host}/`) ? g.slug.slice(g.host.length + 1) : g.slug;
  return [g.host, rest, ...(g.visibility ? [g.visibility] : []), ...(g.branch ? [`branch ${g.branch}`] : []), ...(g.force ? ['force push'] : [])].join(' · ');
}

/** #git-verbs: the push card's one Always choice, in plain words (Mika: shown beside the key, never only on hover). */
export const ALWAYS_REMOTE_NOTE = 'this remote from this repo, any branch, never a force push';

/** The exact and prefix always choices' notes (Mika 2026-10-23), shown beside each key. */
export const ALWAYS_EXACT_NOTE: Readonly<Record<'edit' | 'command', string>> = Object.freeze({ edit: 'only this same change', command: 'only this same command text' });
export const ALWAYS_PREFIX_NOTE = 'any single command starting with these words';
export const ALWAYS_PREFIX_TITLE = 'always allow a single command starting with these words, in this repo (no ; | && $() redirections or env assignments)';

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

/** Aegis C1e: decisions that are ROOT class by kind (the kernel's classes.ts); a voice.enrol card names its own in the node. */
export const ROOT_CLASS_BY_KIND: Readonly<Record<string, readonly string[]>> = Object.freeze({
  install: ['install'], 'api-token': ['use-api-token'], grant: ['allow'], 'peer-pair': ['accept'],
  // 8.0:loops: trusting a loop is root class (gnomon-loops.md §3.1)
  'loop-trust': ['allow'],
});

export interface RootRowsView {
  /** the decisions that sign these rows (the kernel's node) */
  rootDecisions: string[];
  /** detail.rootRows as shown, verbatim (rowsDigest is computed over these) */
  rows: Record<string, unknown>[];
  /** one rendered line per row, in full */
  lines: string[];
  /** sha256(canonicalJson(rows)): what the logged v2 decision row's rowsDigest must equal */
  rowsDigest: string;
  /** a local.config card: one item per signed field, with the loop-diff marks on a change (lines is their text) */
  items?: RootRowItem[];
  /** the hashed detail's action (grant cards: 'local.config', 'mod.uninstall', …), for the card's family head */
  action?: string;
  /** the hashed detail, verified against contentHash */
  detail?: Record<string, unknown>;
}

const short = (v: unknown, n = 19): string => (typeof v === 'string' ? (v.length > n ? `${v.slice(0, n)}…` : v) : '?');
const list = (v: unknown): string | null => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]).join(', ') : null);

export const LOCAL_ROOT_SCHEMA = 'gnomon-root-local:v1';
export const LOCAL_COMPAT_LABEL: Readonly<Record<string, string>> = Object.freeze({ ollama: 'Ollama', 'lm-studio': 'LM Studio', 'llama.cpp': 'llama.cpp', vllm: 'vLLM', 'mlx-lm': 'MLX' });
// Aegis L4: the SAME table as the kernel's localRowRefusal (decision-batch.ts) and the helper's (Protocol.swift).
// ASCII classes only ([0-9], never \d): Arabic-Indic or fullwidth digits, LOCALHOST and [::ffff:127.0.0.1] are refused.
const LOOPBACK_BASE = /^https?:\/\/(?:127\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|localhost|\[::1\])(?::([0-9]{1,5}))?(?:\/[A-Za-z0-9._~%/-]*)?$/;
const ENDPOINT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SAFE_ENTRY = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const HEX64 = /^[0-9a-f]{64}$/;
/**
 * A string the ONE contracts sanitizer would change or flag (control, bidi, hidden characters): the helper's dialog
 * cannot show it (decision-batch.ts UNSHOWABLE), so the row is refused, never shown altered.
 */
const unshowable = (s: string): boolean => {
  const r = sanitizeDisplayText(s);
  return r.text !== s || r.flags.length > 0;
};
/** Aegis M1: the runner dir and node path are shown in full, so each is capped (decision-batch.ts LOCAL_PATH_MAX). */
export const LOCAL_PATH_MAX = 256;
export const LOCAL_ROW_MAX_ENDPOINTS = 4;
/** The helper's one-line dialog (decision-batch.ts DECISION_BOUNDS.maxLineChars): a longer line is refused, never compacted. */
export const HELPER_LINE_MAX = 1200;
const LOCAL_ROW_FIELDS = ['schemaVersion', 'version', 'local', 'cardId', 'runnerSource', 'createdAt'];
const LOCAL_COMPATS = ['llama.cpp', 'ollama', 'lm-studio', 'vllm', 'mlx-lm'];

/** The presence line of a root configuration card (Mika's card copy; presence is Touch ID or the Mac password). */
export const LOCAL_PRESENCE_LINE = 'Allow takes the root key and your presence (Touch ID or your Mac password) · never standing, never by voice';

/** The kernel's Text lines of a card block, in order (each Text child may hold several lines). */
export function kernelTextLines(block: unknown): string[] {
  const kids = block && typeof block === 'object' && Array.isArray((block as { children?: unknown }).children) ? (block as { children: unknown[] }).children : [];
  const out: string[] = [];
  for (const k of kids) if (k && typeof k === 'object' && (k as { type?: unknown }).type === 'Text' && typeof (k as { text?: unknown }).text === 'string') out.push(...((k as { text: string }).text.split('\n')));
  return out;
}

/** One line of "This decision signs"; `mark` is the loop-diff mark of a change (presentation only: every field shows). */
export interface RootRowItem {
  text: string;
  mark?: 'add' | 'del';
}

/** The applied local config as status.local shows it (what a change card is compared with, for the diff marks only). */
export interface LocalCurrent {
  version: number | null;
  endpoints: ReadonlyArray<{ id: string; base: string; model: string; compat: string; loops: boolean }>;
  runner: { dir: string; entry: string; node: string; nodeSha256: string; treeSha256: string } | null;
  /** the gnomon-local version of the bundled runner dir (status.local.defaultRunner), for the runner line */
  bundled?: { dir: string; version: string | null } | null;
}

type LocalRow = { version: number; runnerSource: 'bundled' | 'override'; cardId: string; endpoints: Array<{ id: string; base: string; model: string; compat: string; loops: boolean }>; runner: { node: string; nodeSha256: string; dir: string; treeSha256: string; entry: string } };

const strIn = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const absPath = (v: unknown): v is string => strIn(v, LOCAL_PATH_MAX) && v.startsWith('/') && !v.includes('\0') && !unshowable(v);

/**
 * TD-2026-10-22-769 (Mika F3, Aegis L4): a gnomon-root-local:v1 row, checked by the kernel's and the helper's own
 * table, or null (then the card shows no Allow, Aegis C1e). Any field outside the closed sets, a non-loopback base,
 * a port outside 1..65535, a compat outside the local transports, a model or path holding a control or bidi
 * character, a path over 256 characters, more than 4 endpoints, or a row whose helper line would not fit (never
 * compacted) is refused.
 */
export function localRowOf(r: Record<string, unknown>): LocalRow | null {
  const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const only = (o: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(o).every((k) => keys.includes(k));
  if (!only(r, LOCAL_ROW_FIELDS) || r.schemaVersion !== LOCAL_ROOT_SCHEMA || typeof r.version !== 'number' || !Number.isSafeInteger(r.version) || r.version < 0) return null;
  if (r.runnerSource !== 'bundled' && r.runnerSource !== 'override') return null;
  if (typeof r.cardId !== 'string' || !obj(r.local)) return null;
  const l = r.local;
  if (!only(l, ['endpoints', 'runner']) || !Array.isArray(l.endpoints) || l.endpoints.length < 1 || l.endpoints.length > LOCAL_ROW_MAX_ENDPOINTS || !obj(l.runner)) return null;
  const endpoints: LocalRow['endpoints'] = [];
  for (const e of l.endpoints as unknown[]) {
    if (!obj(e) || !only(e, ['id', 'base', 'model', 'compat', 'loops'])) return null;
    if (!strIn(e.id, 64) || !ENDPOINT_ID.test(e.id) || !strIn(e.model, 128) || unshowable(e.model) || !strIn(e.compat, 32) || !LOCAL_COMPATS.includes(e.compat)) return null;
    const m = strIn(e.base, 256) ? LOOPBACK_BASE.exec(e.base) : null;
    if (!m || (m[1] !== undefined && (Number(m[1]) < 1 || Number(m[1]) > 65535))) return null;
    if (e.loops !== undefined && typeof e.loops !== 'boolean') return null;
    endpoints.push({ id: e.id, base: e.base as string, model: e.model, compat: e.compat, loops: e.loops === true });
  }
  const ru = l.runner;
  if (!only(ru, ['node', 'nodeSha256', 'dir', 'treeSha256', 'entry'])) return null;
  if (!absPath(ru.node) || !absPath(ru.dir) || typeof ru.nodeSha256 !== 'string' || !HEX64.test(ru.nodeSha256) || typeof ru.treeSha256 !== 'string' || !HEX64.test(ru.treeSha256) || !strIn(ru.entry, 128) || !SAFE_ENTRY.test(ru.entry) || ru.entry.split('/').includes('..')) return null;
  const row: LocalRow = { version: r.version, runnerSource: r.runnerSource, cardId: r.cardId, endpoints, runner: { node: ru.node, nodeSha256: ru.nodeSha256, dir: ru.dir, treeSha256: ru.treeSha256, entry: ru.entry } };
  return helperLineLength(row) <= HELPER_LINE_MAX ? row : null;
}

/**
 * The length of the helper's dialog line for a local.config decision (decision-batch.ts decisionLine + localRowShown):
 * the head, the one row in full, then four 12-character digests. Aegis L4: never compacted, so a row that would not
 * fit is refused here as the helper refuses it.
 */
export function helperLineLength(r: LocalRow): number {
  const head = `Gnomon Helper: ONE presence signs allow on local.config ${r.cardId} ${'s'.repeat(19)}`;
  const eps = r.endpoints.map((e) => `endpoint ${e.id} ${e.base} model ${e.model} (${e.compat})${e.loops ? ' loops: yes' : ' loops: no'}`);
  const which = r.runnerSource === 'override' ? 'OVERRIDE runner' : 'bundled runner';
  const shown = `local model config v${r.version}: ${eps.join(', ')}; ${which} ${r.runner.dir}/${r.runner.entry} tree ${'t'.repeat(12)} node ${r.runner.node} ${'n'.repeat(12)}`;
  return `${head}; ${shown}; digests ${Array.from({ length: 4 }, () => 'd'.repeat(12)).join(' ')}`.length;
}

const LOCAL_PRESENCE_WORDS = { loops: 'loops may use it', sessions: 'sessions only' };
const serverPhrase = (compat: string): string => {
  const name = LOCAL_COMPAT_LABEL[compat] ?? compat;
  return `${/^[AEIOU]/i.test(name) || /^(LM|MLX)/.test(name) ? 'an' : 'a'} ${name} server`;
};
const mid = (h: string): string => `${h.slice(0, 8)}…${h.slice(-4)}`;

/**
 * "This decision signs" for a local.config card (Mika's card copy): one line per signed field (the config version,
 * each endpoint with its server and address, its model and whether loops may use it, the runner pin and its folder).
 * On a change (the card names a previous version and status.local holds the applied config) the lines carry the
 * loop-diff marks: a changed field shows its old line struck (del) and its new line (add); the rest say "unchanged".
 * null on anything the table refuses.
 */
export function localRootItems(r: Record<string, unknown>, previous: number | null, current?: LocalCurrent | null): RootRowItem[] | null {
  const row = localRowOf(r);
  if (!row) return null;
  const items: RootRowItem[] = [{ text: previous === null ? `local model config v${row.version} · new` : `local model config v${previous} → v${row.version}` }];
  const cur = previous !== null && current ? current : null;
  const epLine = (e: { id: string; base: string; compat: string }): string => `endpoint ${e.id} · ${serverPhrase(e.compat)} at ${e.base}`;
  const loopsWords = (b: boolean): string => (b ? LOCAL_PRESENCE_WORDS.loops : LOCAL_PRESENCE_WORDS.sessions);
  for (const e of row.endpoints) {
    const was = cur?.endpoints.find((x) => x.id === e.id);
    if (!cur || !was) {
      const add = cur ? ({ mark: 'add' } as const) : {};
      items.push({ text: epLine(e), ...add }, { text: `model ${e.model} · ${loopsWords(e.loops)}`, ...add });
      continue;
    }
    if (was.base === e.base && was.compat === e.compat) items.push({ text: `${epLine(e)} · unchanged` });
    else items.push({ text: epLine(was), mark: 'del' }, { text: epLine(e), mark: 'add' });
    if (was.model === e.model) items.push({ text: `model ${e.model} · unchanged` });
    else items.push({ text: `model ${was.model}`, mark: 'del' }, { text: `model ${e.model}`, mark: 'add' });
    if (was.loops === e.loops) items.push({ text: `${loopsWords(e.loops)} · unchanged` });
    else items.push({ text: loopsWords(was.loops), mark: 'del' }, { text: loopsWords(e.loops), mark: 'add' });
  }
  for (const was of cur?.endpoints ?? []) if (!row.endpoints.some((e) => e.id === was.id)) items.push({ text: `${epLine(was)} · model ${was.model}`, mark: 'del' });
  const ru = row.runner;
  const version = current?.bundled && current.bundled.dir === ru.dir && current.bundled.version ? ` gnomon-local ${current.bundled.version}` : '';
  const pin = `runner${version} · ${row.runnerSource === 'override' ? 'OVERRIDE: a folder you named' : 'bundled'} · tree ${mid(ru.treeSha256)} · sha ${ru.nodeSha256.slice(0, 8)}…`;
  const folder = `runner folder ${ru.dir}/${ru.entry} · node ${ru.node}`;
  const same = cur?.runner && cur.runner.dir === ru.dir && cur.runner.entry === ru.entry && cur.runner.node === ru.node && cur.runner.nodeSha256 === ru.nodeSha256 && cur.runner.treeSha256 === ru.treeSha256;
  if (!cur || !cur.runner) items.push({ text: pin, ...(cur ? { mark: 'add' as const } : {}) }, { text: folder, ...(cur ? { mark: 'add' as const } : {}) });
  else if (same) items.push({ text: `${pin} · unchanged` }, { text: folder });
  else items.push({ text: `runner folder ${cur.runner.dir}/${cur.runner.entry} · tree ${mid(cur.runner.treeSha256)}`, mark: 'del' }, { text: pin, mark: 'add' }, { text: folder, mark: 'add' });
  return items;
}

/** The single-line form (the generic rootRowLine contract): every field, joined. */
export function localRootRowLine(r: Record<string, unknown>): string | null {
  const items = localRootItems(r, null);
  return items ? items.map((i) => i.text).join('; ') : null;
}

/** One root row as the card shows it, IN FULL; null = a kind this GUI cannot render (then no root key is shown). */
export function rootRowLine(r: Record<string, unknown>): string | null {
  const s = (k: string): string | null => (typeof r[k] === 'string' ? (r[k] as string) : null);
  if (r.schemaVersion === LOCAL_ROOT_SCHEMA) return localRootRowLine(r);
  if (r.schemaVersion === 'voiceEnrolRow:v1') return r.op === 'enrol' && s('speakerId') ? `enrol the voice speaker ${s('speakerId')} · consent ${short(r.consentHash)}` : null;
  switch (r.kind) {
    case 'grant.trust':
      return s('tier') ? `trust tier ${s('tier')} for manifest ${short(r.manifestHash)}` : null;
    case 'grant.capability': {
      const caps = list(r.capabilities);
      if (caps === null) return null;
      const read = r.read === undefined ? '' : list(r.read);
      return read === null ? null : `capabilities: ${caps || '(none)'}${read ? ` · reads: ${read}` : ''}`;
    }
    case 'grant.egress': {
      const hosts = list(r.hosts);
      return hosts === null ? null : `egress hosts: ${hosts}`;
    }
    case 'grant.publisher':
      return s('publisher') && s('host') && s('namespace') ? `publisher ${s('publisher')} → ${s('host')}/${s('namespace')}` : null;
    case 'grant.install':
      return s('name') && s('source') ? `install ${s('name')} from ${s('source')} · packageHash ${short(r.packageHash)}` : null;
    // 8.0:loops (trust.ts #raise): the one loop.trusted row a loop-trust card's allow signs
    case 'loop.trusted':
      return s('loopId') && (r.scope === 'repo' || r.scope === 'personal') && s('contentHash') ? `trust loop ${r.scope}/${s('loopId')} · contentHash ${short(r.contentHash, 23)}${s('closureDigest') ? ` · closure ${short(r.closureDigest, 15)}` : ''}` : null;
    case 'grant.uninstall':
      return s('name') ? `uninstall ${s('name')} · packageHash ${short(r.packageHash)}` : null;
    default:
      return null;
  }
}

/** sha256:<hex> of canonicalJson(rows), exactly as the kernel's decision-batch.ts rowsDigestOf. */
export function rowsDigestOf(rows: readonly unknown[]): string {
  return `sha256:${hex(sha256(canonicalJson(rows)))}`;
}

/** The root-rows nodes of a card block (any count: one is required, more is a refusal). */
function rootNodesOf(block: unknown): Array<{ rootDecisions?: unknown; detail?: unknown }> {
  const kids = block && typeof block === 'object' && Array.isArray((block as { children?: unknown }).children) ? (block as { children: unknown[] }).children : [];
  return kids.filter((k) => k && typeof k === 'object' && (k as { type?: unknown }).type === 'root-rows') as Array<{ rootDecisions?: unknown; detail?: unknown }>;
}

/** Does the block carry ANY root-rows node (valid or not)? Then the card is root-capable: fail closed without rootRowsOf. */
export function hasRootNode(block: unknown): boolean {
  return rootNodesOf(block).length > 0;
}

/** The decisions that are never root class: the only keys a root-capable card shows when its rows cannot be verified. */
export const NON_ROOT_DECISIONS: readonly string[] = Object.freeze(['deny', 'reject', 'withdraw']);

/**
 * Aegis C1e + M1: the card's ONE {type:'root-rows', rootDecisions, detail} node; its detail verified against
 * contentHash; its root decisions read from the HASHED detail.rootDecisions (the node's copy must equal it) and
 * required to cover what the kind table makes root (a standing grant's allow excepted; a voice.enrol strictness card's
 * allow added); every row renderable. null = anything else.
 */
export function rootRowsOf(card: Record<string, unknown>, ctx: { local?: LocalCurrent | null } = {}): RootRowsView | null {
  const nodes = rootNodesOf(card.block);
  if (nodes.length !== 1) return null;
  const { detail, rootDecisions: nodeDecs } = nodes[0]!;
  if (!detail || typeof detail !== 'object' || Array.isArray(detail) || typeof card.contentHash !== 'string' || cardContentHash(card, detail) !== card.contentHash) return null;
  const d = detail as Record<string, unknown>;
  const rows = d.rootRows;
  const decs = d.rootDecisions;
  if (!Array.isArray(rows) || !rows.every((r) => r && typeof r === 'object' && !Array.isArray(r))) return null;
  if (!Array.isArray(decs) || !decs.every((x) => typeof x === 'string')) return null;
  if (nodeDecs !== undefined && canonicalJson(nodeDecs) !== canonicalJson(decs)) return null;
  const kind = String(card.kind);
  const must = [...(kind === 'grant' && d.op === 'standing' ? [] : (ROOT_CLASS_BY_KIND[kind] ?? [])), ...(kind === 'strictness' && d.op === 'voice.enrol' ? ['allow'] : [])];
  if (must.some((m) => !(decs as string[]).includes(m))) return null;
  const lines: string[] = [];
  let items: RootRowItem[] | undefined;
  const rowList = rows as Record<string, unknown>[];
  // TD-2026-10-22-769: a local.config grant signs exactly ONE gnomon-root-local:v1 row, bound to this card
  const local = d.action === 'local.config' || rowList.some((r) => r.schemaVersion === LOCAL_ROOT_SCHEMA);
  if (local) {
    if (kind !== 'grant' || d.action !== 'local.config' || rowList.length !== 1 || rowList[0]!.cardId !== card.cardId) return null;
    const previous = d.previous === null || d.previous === undefined ? null : Number.isSafeInteger(d.previous) ? (d.previous as number) : NaN;
    if (Number.isNaN(previous)) return null;
    items = localRootItems(rowList[0]!, previous, ctx.local) ?? undefined;
    if (!items) return null;
    lines.push(...items.map((i) => i.text));
  } else
    for (const r of rowList) {
      const l = rootRowLine(r);
      if (l === null) return null;
      lines.push(l);
    }
  return { rootDecisions: decs as string[], rows: rowList, lines, rowsDigest: rowsDigestOf(rows), ...(items ? { items } : {}), ...(typeof d.action === 'string' ? { action: d.action } : {}), detail: d };
}

/** The decision keys a card may show: with no verified rows, only the never-root decisions (Aegis C1e, M1). */
export function rootSafeDecisions(_kind: string, decisions: readonly string[], rr: RootRowsView | null): string[] {
  return rr ? [...decisions] : decisions.filter((d) => NON_ROOT_DECISIONS.includes(d));
}

/** Aegis C1e: after a root decision, the logged v2 decision row's rowsDigest against the rows the card showed. */
export function rowsDigestCheck(shown: RootRowsView, decision: string, logged: unknown): 'ok' | 'mismatch' | 'not-root' {
  if (!shown.rootDecisions.includes(decision)) return 'not-root';
  return logged === shown.rowsDigest ? 'ok' : 'mismatch';
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

/**
 * Aegis H1: the composed arg on the card face. Each line of the command is its own line (`.card-arg-line`), a line
 * break is a visible ⏎ mark (never a space), and the shell's separators (; && || | & ` $( ) are marked (`.card-sep`)
 * so a chained tail never reads as part of the first command. The CSS wraps it (pre-wrap, overflow-wrap: anywhere).
 */
function argEl(doc: MiniDoc, arg: string): MiniEl {
  const lines = argLines(arg);
  const kids: Array<MiniEl | string> = [];
  lines.forEach((line, i) => {
    // split() with the capturing ARG_SEP alternates text and separator: odd indices are the separators
    const parts = line.split(ARG_SEP).map((x, j) => (j % 2 ? h(doc, 'span', { class: 'card-sep', title: 'command separator' }, x) : x)).filter((x) => x !== '');
    kids.push(h(doc, 'span', { class: 'card-arg-line' }, ...parts, i < lines.length - 1 ? h(doc, 'span', { class: 'card-nl', title: 'a line break: what follows is another command' }, ' ⏎') : null));
    if (i < lines.length - 1) kids.push('\n');
  });
  return h(doc, 'code', { class: 'card-arg', 'data-lines': String(lines.length) }, ...kids);
}

/**
 * The kernel-owned card region. Decision keys only for verified actions on a decidable card.
 *
 * fidelity 2 (the comp's compact card): `■ project · kind · by <name>` + the bordered voice chip, ONE title line,
 * `raised HH:MM · waiting Nm`, the keys, then the contentHash as a quiet single line, and a `details` disclosure
 * holding the rest. What stays VISIBLE on every card (Aegis): the requester (the short mark; the full principal in the
 * head's title= and in details), the contentHash line, the keys and flags, a held countdown, the ask picker, and a
 * claim-mismatch card's whole body (its red warning is never collapsed). What the disclosure holds: the full requester
 * and session, the kernel-composed body lines, and a requester's own words (labelled as theirs).
 */
export function renderCard(ctx: RenderCtx, v: CardView, block: unknown): MiniEl {
  const { doc } = ctx;
  // Aegis M1: root-capable = verified rows, ANY root-rows node (even a bad one), or a kind the table makes root
  const rootGated = v.rootRows !== undefined && (v.rootRows !== null || hasRootNode(block) || (ROOT_CLASS_BY_KIND[v.kind] ?? []).some((d) => v.decisions.includes(d)));
  const keys = v.decidable && v.decisions.length ? (rootGated ? rootSafeDecisions(v.kind, v.decisions, v.rootRows ?? null) : v.decisions) : [];
  const ask = v.kind === 'ask-user' && keys.includes('answer') ? (v.ask ?? null) : null;
  // TD-2026-10-19-063: a claim-mismatch card (e.g. a claude re-pin NOT signed by the expected publisher) focuses Deny
  const loud = v.flags.includes('claim-mismatch');
  // S1 ink keys: the first non-deny decision is the filled primary key (.key.pri); never on a claim-mismatch card,
  // where Deny stays the default focus and nothing is filled
  const pri = loud ? null : (keys.find((d) => d !== 'deny') ?? null);
  const scoped: 'command' | 'edit' | 'remote' | null = v.prefixOptions?.length ? 'command' : v.editScopes?.length ? 'edit' : v.gitVerb?.verb === 'git.push' && v.gitVerb.slug ? 'remote' : null;
  const { title, body } = splitCardBlock(block, v.kind, loud);
  const quoted = !loud && !KERNEL_TITLED_KINDS.has(v.kind);
  // design-system card.family ⊙ gnomon (C3): a root configuration card about Gnomon itself (local.config)
  const gnomonFam = v.rootRows?.action === 'local.config';
  const tag0 = voiceTagOf(v.voice ?? null);
  const tag = gnomonFam ? { text: `${tag0?.text ?? 'hand only'} · root key`, handle: tag0?.handle ?? null } : tag0;
  // the kernel's second line ("asked from Settings · 23:20 · applies at once, no restart") shows under the title
  const kLine = gnomonFam ? (kernelTextLines(block).find((l) => /^asked from (Settings|the terminal) · /.test(l)) ?? null) : v.gitVerb ? gitVerbLine(v.gitVerb) : null;
  const raised = v.held ? `Allowing in ${Math.max(0, Math.ceil(v.held.seconds))} · say “${v.held.undo}”` : raisedLine(v.raisedAt, v.now ?? Date.now());
  const failed = v.kind === 'incident' || v.flags.includes('failed');
  const who = `requested by ${v.requestedBy}${v.hsid ? ` · ${v.hsid}` : ''}${v.repo ? ` · ${v.repo}` : ''}`;
  const ct = loud ? null : (v.composedTitle ?? null);
  const titleText = ct ? `${ct.verb}${ct.arg ? ` ${ct.arg}` : ''}` : title;
  const capped = !!ct?.truncated;
  const bodyShown = loud || capped;
  // a kind whose lines the kernel does not compose: its words are labelled as the requester's (never the kernel's)
  const bodyEl = h(doc, 'div', { class: `card-body kernel-owned${quoted ? ' quoted' : ''}` }, quoted ? h(doc, 'span', { class: 'meta card-quote-label' }, `the requester's words (${v.requestedBy}):`) : null, renderBlock(ctx, body));
  return h(
    doc,
    'section',
    { class: `card kind-${v.kind.replace(/[^a-z0-9-]/g, '')}${v.project ? ` pe-h${Math.max(0, Math.min(5, Math.trunc(v.project.hue)))}` : ''}${loud ? ' claim-mismatch' : ''}${failed ? ' failed' : ''}${v.held ? ' held' : ''}`, role: 'group', 'data-card-id': v.cardId, 'aria-label': `${v.kind} card` },
    h(
      doc,
      'header',
      { class: 'card-head k', title: who },
      // #gui-loops (design-system card.family): a loop card names its family by glyph and word, never by hue
      v.kind.startsWith('loop-') ? h(doc, 'span', { class: 'fam' }, '↻ loop') : gnomonFam ? h(doc, 'span', { class: 'fam' }, '⊙ gnomon') : null,
      v.kind.startsWith('loop-') || gnomonFam ? ' · ' : null,
      v.project ? h(doc, 'span', { class: `card-project pink h${v.project.hue}` }, `■ ${v.project.name}`) : null,
      v.project ? ' · ' : null,
      h(doc, 'span', { class: 'card-kind' }, v.kind),
      // Aegis M1: who asked is VISIBLE text, never only a tooltip (the short mark; the full principal in title= and details)
      ' · ',
      h(doc, 'span', { class: 'card-requester' }, v.kind.startsWith('loop-') && v.loopClaimedBy ? `claimed by ${v.loopClaimedBy}` : `by ${shortRequester(v.requestedBy, v.localNs)}`),
      tag ? ' ' : null,
      tag ? h(doc, 'span', { class: 'chip card-voice kernel-owned' }, tag.text, tag.handle ? ' ' : null, tag.handle ? h(doc, 'span', { class: 'handle' }, tag.handle) : null) : null,
    ),
    h(doc, 'p', { class: `card-title${ct ? ' composed' : ''}`, title: titleText }, ...(ct ? [ct.verb, ct.arg ? ' ' : null, ct.arg ? argEl(doc, ct.arg) : null] : [title])),
    kLine ? h(doc, 'span', { class: 'k-line kernel-owned' }, kLine) : null,
    capped ? h(doc, 'small', { class: 'meta card-arg-capped' }, `the command is longer than ${TITLE_ARG_MAX} characters: the kernel's card below`) : null,
    // TD-2026-10-19-063: a claim-mismatch card's body (its red first line) is never collapsed; Aegis H1: nor a card
    // whose composed arg was capped (the kernel's body is then the whole command, visibly)
    bodyShown ? bodyEl : null,
    raised ? h(doc, 'small', { class: `meta card-raised${v.held ? ' held-note kernel-owned' : ''}` }, raised) : null,
    ask ? askPicker(ctx, v.cardId, ask) : null,
    v.rootRows
      ? h(doc, 'div', { class: 'card-root-rows kernel-owned' }, h(doc, 'p', { class: 'meta root-rows-title' }, 'This decision signs'), h(doc, 'ul', null, ...(v.rootRows.items ? v.rootRows.items.map((i) => h(doc, 'li', i.mark ? { class: i.mark } : null, i.mark ? h(doc, 'span', { class: 'sr-only' }, i.mark === 'add' ? 'new: ' : 'was: ') : null, i.text)) : v.rootRows.lines.length ? v.rootRows.lines.map((l) => h(doc, 'li', null, l)) : [h(doc, 'li', null, 'its decision row only (no other row)')])))
      : rootGated
        ? h(doc, 'p', { class: 'refusal root-rows-missing' }, 'This card does not show what its approval signs: there is no Approve here. Raise it again from the kernel.')
        : null,
    v.batchUnavailable && rootGated ? h(doc, 'small', { class: 'meta helper-batch-note' }, 'The helper is older than 1.8.0: this approval asks Touch ID once per signed row.') : null,
    h(
      doc,
      'div',
      { class: 'card-keys' },
      ...v.flags.map((f) => h(doc, 'span', { class: `chip warn flag flag-${f.replace(/[^a-z0-9-]/g, '')}`, title: f === 'bidi' ? `card flag: bidi: shown as ${BIDI_LEGEND}` : `card flag: ${f}` }, f)),
      ...keys.map((d) =>
        // Mika 2026-10-23: scoped always choices fold under ONE "Always ▾" key (the row stays Allow · Deny · Always ▾ at every
        // width); the key itself decides nothing, each choice below is the decision key
        d === 'always' && scoped
          ? h(doc, 'button', { class: `key key-always-fold${d === pri ? ' pri' : ''}`, type: 'button', 'data-always-fold': v.cardId, 'aria-expanded': String(!!v.alwaysOpen) }, `Always ${v.alwaysOpen ? '▴' : '▾'}`)
          : h(doc, 'button', { class: d === pri ? 'key pri' : 'key', type: 'button', 'data-decision': d, 'data-card-id': v.cardId, ...(loud && d === 'deny' ? { 'data-default': 'true' } : {}) }, d),
      ),
      keys.length ? null : h(doc, 'small', { class: 'meta' }, v.decidable ? 'no verified decision keys' : `not decidable here (state ${v.state})`),
    ),
    scoped && keys.includes('always') ? alwaysChoices(doc, v, scoped) : null,
    gnomonFam && keys.length ? h(doc, 'div', { class: 'lt-presence' }, LOCAL_PRESENCE_LINE) : null,
    // the contentHash line stays on every card: quiet, one line, the full hash in title=
    h(doc, 'small', { class: 'meta content-hash', title: `contentHash ${v.contentHash}` }, `contentHash ${v.contentHash.slice(0, 23)}…`),
    h(doc, 'details', { class: 'card-details' }, h(doc, 'summary', { class: 'meta' }, 'details'), h(doc, 'p', { class: 'meta card-who' }, who), bodyShown ? null : bodyEl),
    h(doc, 'div', { class: 'bar', 'aria-hidden': 'true' }, h(doc, 'span', { class: 'bar-i' })),
    h(doc, 'span', { class: 'stamp', 'aria-hidden': 'true' }, ''),
  );
}

/**
 * Mika 2026-10-23: the scoped always choices of a card, unfolded under its keys by "Always ▾": one row per choice, the
 * decision key (data-decision="always" + its scope, exactly as before) and its note in plain words beside it. The
 * accessible name of each key starts "Always:" and contains its visible words (WCAG 2.5.3).
 */
function alwaysChoices(doc: MiniDoc, v: CardView, scoped: 'command' | 'edit' | 'remote'): MiniEl {
  const row = (attrs: Record<string, string>, label: string, shown: string, note: string): MiniEl =>
    h(doc, 'div', { class: 'always-row' }, h(doc, 'button', { class: `key key-always${attrs['data-scope'] === 'prefix' ? ' key-prefix' : attrs['data-scope'] === 'exact' ? '' : ' key-scope'}`, type: 'button', 'data-decision': 'always', 'data-card-id': v.cardId, 'aria-label': label, ...attrs }, shown), h(doc, 'span', { class: 'always-note' }, note));
  if (scoped === 'remote') {
    // #git-verbs: one choice, the exact remote the kernel resolved (its rule is keyed to that URL and host)
    const shown = `push to ${v.gitVerb?.slug ?? 'this remote'}`;
    return h(doc, 'div', { class: `always-choices${v.alwaysOpen ? ' open' : ''}`, role: 'group', 'aria-label': 'Always allow, no card next time', 'data-always-for': v.cardId }, h(doc, 'span', { class: 'always-h' }, 'always allow, no card next time:'), row({ 'data-scope': 'exact' }, `Always: ${shown}`, shown, ALWAYS_REMOTE_NOTE));
  }
  const exact = scoped === 'command' ? 'this exact command' : 'this exact edit';
  return h(
    doc,
    'div',
    { class: `always-choices${v.alwaysOpen ? ' open' : ''}`, role: 'group', 'aria-label': 'Always allow, no card next time', 'data-always-for': v.cardId },
    h(doc, 'span', { class: 'always-h' }, 'always allow, no card next time:'),
    row({ 'data-scope': 'exact' }, `Always: ${exact}`, exact, ALWAYS_EXACT_NOTE[scoped]),
    ...(scoped === 'command'
      ? (v.prefixOptions ?? []).map((p) => row({ 'data-scope': 'prefix', 'data-prefix': JSON.stringify(p), title: ALWAYS_PREFIX_TITLE }, `Always: ${shownPrefixWords(p)} …`, `${shownPrefixWords(p)} …`, ALWAYS_PREFIX_NOTE))
      : (v.editScopes ?? []).map((k) => row({ 'data-scope': k, title: EDIT_SCOPE_KEYS[k].title }, EDIT_SCOPE_KEYS[k].label, EDIT_SCOPE_KEYS[k].short, EDIT_SCOPE_KEYS[k].note))),
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
