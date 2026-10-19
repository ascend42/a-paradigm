/**
 * @symbol #gui
 *
 * #gui page wiring (spec §11.1–§11.5). Browser-only glue over the pure core:
 * launch (boot.js read-and-clear → pin decision → hello → WebCrypto serverSig
 * → auth), Reconnect, the log.read backlog + follow subscription, the
 * virtualized transcript, the sessions sidebar with new-session, the decision
 * stack (approve on a user gesture only, `G-GUI-04`; refusals shown
 * verbatim), the composer (session.open / session.send), the palette,
 * themes + auto + reduced motion, the Shuttle view and /diag. Every string
 * reaches the DOM through core/render.ts as a text node.
 */
import { isCardDecidable, sanitizeDisplayText } from '@a-company/gnomon-contracts';
import { followLog, GnomonClient, gnomonPost, RpcError, webSocketTransport, type Session, type ShownRefusal } from '../core/client.js';
import { applyPreset, BLOCK_SAFE_COMMANDS, filterCommands, paletteEntries, resolveMotion, resolveTheme, togglePane, type Command, type Layout, type ThemeChoice } from '../core/commands.js';
import { applyCwdHint, clearCwdHint, cwdHintOf, decidePin, type CwdHint, type CwdHintTarget, hostSurface, parseLaunchFragment, PIN_KEY } from '../core/launch.js';
import { askDetailOf, askNote, cardFlags, h, renderCard, type AskPick, type MiniDoc } from '../core/render.js';
import { base64UrlToBytes, keyIdOfSpki, verifiedDecisions } from '../core/server-sig.js';
import { Follow, isAtBottom } from '../core/follow.js';
import { chatItems, GuiStore, isLiveState, UNSCOPED, type ChatItem, type Row } from '../core/store.js';
import { HeightIndex, visibleRange, WidthCache } from '../core/virtual.js';

const doc = document as unknown as MiniDoc;
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const clear = (el: HTMLElement): void => {
  while (el.firstChild) el.removeChild(el.firstChild);
};
const put = (el: HTMLElement, s: string): void => {
  el.textContent = sanitizeDisplayText(s).text;
};

/** The new-session form elements a #bare-entry hint touches (values and text only). */
const hintTarget = (): CwdHintTarget => ({ input: $<HTMLInputElement>('ns-cwd'), note: $('ns-hint'), dialog: $('new-session-dialog') });

const store = new GuiStore();
let client: GnomonClient | null = null;
let session: Session | null = null;
let verifyKey: string | null = null;
let status: Record<string, unknown> | null = null;
let focused: string | null = null; // hsid
let stackScoped = false;
let theme: ThemeChoice = 'auto';
let motion: 'reduce' | 'system' = 'system';
let layout: Layout = applyPreset('desk');
const local: Row[] = []; // this page's own composer lines (memory only)
const refusals = new Map<string, ShownRefusal>();
/** Verified decision keys per (cardId, contentHash) under the current verifyKey (C4, I4). */
const verified = new Map<string, string[]>();
const verifiedKey = (cardId: string, contentHash: string): string => `${cardId}\n${contentHash}`;
const shortKeyId = (spki: string): string => {
  try {
    const id = keyIdOfSpki(base64UrlToBytes(spki));
    return `${id.slice(0, 16)}…${id.slice(-6)}`;
  } catch {
    return '(unreadable key)';
  }
};

function notice(msg: string | null, fail = false): void {
  const n = $('notice');
  n.hidden = !msg;
  n.className = fail ? 'notice fail' : 'notice';
  if (msg) put(n, msg);
}

function refusalText(r: ShownRefusal): string {
  return `${r.code}${r.reason ? ` ${r.reason}` : ''}  ${r.message}${r.next.length ? `\n  next: ${r.next.join(' · ')}` : ''}`;
}

/* ── theme / motion ─────────────────────────────────────────────── */
const darkQ = matchMedia('(prefers-color-scheme: dark)');
const motionQ = matchMedia('(prefers-reduced-motion: reduce)');
function applyLook(): void {
  document.documentElement.dataset.theme = resolveTheme(theme, darkQ.matches);
  document.documentElement.dataset.motion = resolveMotion(motion, motionQ.matches);
}
darkQ.addEventListener('change', applyLook);
motionQ.addEventListener('change', applyLook);

function applyLayout(): void {
  const d = document.querySelector('.desk')!;
  d.classList.toggle('no-sessions', !layout.visible.sessions);
  d.classList.toggle('no-stack', !layout.visible.stack);
  d.classList.toggle('stack-wide', layout.stackWide);
  $('pane-shuttle').hidden = !layout.visible.shuttle;
}

/* ── transcript (virtualized chat) ───────────────────────────────── */
const widths = new WidthCache(22);
let heights = new HeightIndex(22);
let width = 0;
let items: ChatItem[] = [];
let hiddenRows = 0;
let rawMode = false; // "show raw events": every row as its one-line summary
const follow = new Follow(); // stickiness: core/follow.ts (unit-tested)
const mounted = new Map<number, HTMLElement>();
let memo: { key: string; out: { items: ChatItem[]; hidden: number } } | null = null;

const transcriptId = (): string => `${focused ?? 'feed'}${rawMode ? '\u0000raw' : ''}`;

function currentItems(): { items: ChatItem[]; hidden: number } {
  const base = focused ? store.transcript(focused) : store.kernelFeed;
  const mine = local.filter((r) => (r.session ?? null) === focused);
  const key = `${transcriptId()}\u0000${base.length}\u0000${mine.length}\u0000${store.logId ?? ''}`;
  if (memo?.key === key) return memo.out;
  const rows = mine.length ? [...base, ...mine].sort((a, b) => a.seq - b.seq) : base;
  // the kernel feed has no conversation: it stays the raw row list
  const out = chatItems(rows, { raw: rawMode || !focused });
  memo = { key, out };
  return out;
}

function unmountAll(): void {
  for (const el of mounted.values()) el.remove();
  mounted.clear();
}

/** A new transcript (focus, raw toggle): rebuild from scratch, stuck to the bottom. */
function resetTranscript(): void {
  unmountAll();
  memo = null;
  items = [];
  follow.jump();
  heights = widths.restore(transcriptId(), width, 0);
  put($('transcript-title'), focused ? focused.slice(-10) : 'kernel feed');
  $('transcript-title').title = focused ?? '';
  $('raw-toggle').hidden = !focused;
  put($('raw-toggle'), rawMode ? 'chat view' : 'show raw events');
  paintTranscript();
}

const ROLE_LABEL: Partial<Record<ChatItem['role'], string>> = { user: 'you', assistant: 'claude' };
function itemEl(it: ChatItem): HTMLElement {
  const label = ROLE_LABEL[it.role];
  const at = it.at ? it.at.slice(11, 16) : '';
  const body = label
    ? [h(doc, 'div', { class: 'who' }, label, h(doc, 'span', { class: 't' }, at)), h(doc, 'div', { class: 'body' }, it.text)]
    : it.role === 'raw'
      ? [h(doc, 'span', { class: 't' }, at), it.text]
      : [it.text];
  return h(doc, 'div', { class: `trow role-${it.role}` }, ...body) as unknown as HTMLElement;
}

const sameKeys = (a: readonly ChatItem[], b: readonly ChatItem[]): boolean => {
  if (b.length < a.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i]!.key !== b[i]!.key) return false;
  return true;
};

/**
 * Paint the visible items. Stuck ⇒ end at the bottom; scrolled up ⇒ the item at the top of the view stays exactly
 * where it is while heights are measured and items arrive (no jump, no reset to the top). `remeasure` (a width
 * change) rebuilds the height index from the per-width cache and keeps the same reading position.
 */
function paintTranscript(remeasure = false): void {
  const vp = $('viewport');
  const anchor = items.length ? heights.indexAt(vp.scrollTop) : 0;
  const anchorDelta = items.length ? vp.scrollTop - heights.offsetOf(anchor) : 0;
  const { items: next, hidden } = currentItems();
  let appended = 0;
  if (remeasure || !sameKeys(items, next)) {
    unmountAll();
    heights = widths.restore(transcriptId(), width, next.length);
  } else {
    appended = next.length - items.length;
    if (appended > 0) heights.push(appended);
  }
  items = next;
  hiddenRows = hidden;
  follow.onAppend(appended);
  for (let pass = 0; pass < 4; pass++) {
    $('spacer').style.height = `${heights.total()}px`;
    if (follow.shouldStick) vp.scrollTop = vp.scrollHeight;
    else if (items.length) {
      const want = heights.offsetOf(Math.min(anchor, items.length - 1)) + anchorDelta;
      if (Math.abs(vp.scrollTop - want) >= 1) vp.scrollTop = want;
    }
    const { start, end } = visibleRange(heights, vp.scrollTop, vp.clientHeight || 600);
    for (const [i, el] of mounted)
      if (i < start || i >= end) {
        el.remove();
        mounted.delete(i);
      }
    let changed = false;
    for (let i = start; i < end; i++) {
      let el = mounted.get(i);
      if (!el) {
        el = itemEl(items[i]!);
        el.style.top = `${heights.offsetOf(i)}px`;
        vp.appendChild(el);
        mounted.set(i, el);
      }
      const hgt = el.offsetHeight || heights.estimate;
      if (hgt !== heights.height(i)) {
        heights.set(i, hgt);
        changed = true;
      }
    }
    for (const [i, el] of mounted) el.style.top = `${heights.offsetOf(i)}px`;
    if (!changed) break;
  }
  put($('transcript-count'), focused && !rawMode ? `${items.length} items${hiddenRows ? ` · ${hiddenRows} raw hidden` : ''}` : `${items.length} rows`);
  const jump = $('jump-latest');
  jump.hidden = !follow.showJump;
  put(jump, follow.unseen ? `↓ latest · ${follow.unseen} new` : '↓ latest');
}

/* ── narrow widths: the side panes are drawers behind the header toggles (styles.css @media) ── */
function toggleDrawer(which: 'sessions' | 'stack'): void {
  const d = document.querySelector('.desk')!;
  const open = !d.classList.contains(`open-${which}`);
  d.classList.remove('open-sessions', 'open-stack');
  if (open) d.classList.add(`open-${which}`);
  $('scrim').hidden = !open;
  $('toggle-sessions').setAttribute('aria-expanded', String(open && which === 'sessions'));
  $('toggle-stack').setAttribute('aria-expanded', String(open && which === 'stack'));
}
function closeDrawers(): void {
  document.querySelector('.desk')?.classList.remove('open-sessions', 'open-stack');
  $('scrim').hidden = true;
  $('toggle-sessions').setAttribute('aria-expanded', 'false');
  $('toggle-stack').setAttribute('aria-expanded', 'false');
}

/* ── sessions sidebar ───────────────────────────────────────────── */
function hueOf(repo: string): number {
  let x = 0;
  for (const c of repo) x = (x * 31 + c.charCodeAt(0)) >>> 0;
  return x % 6;
}
function paintSessions(): void {
  const list = $('session-list');
  clear(list);
  const q = ($('session-search') as HTMLInputElement).value.trim().toLowerCase();
  const feed = h(doc, 'button', { class: `session-row${focused === null ? ' active' : ''}`, type: 'button', 'data-hsid': '' }, 'kernel feed') as unknown as HTMLElement;
  list.appendChild(feed);
  for (const g of store.groups()) {
    const ss = g.sessions.filter((s) => !q || s.hsid.toLowerCase().includes(q) || g.repo.toLowerCase().includes(q));
    if (!ss.length) continue;
    const sw = h(doc, 'span', { class: `swatch h${hueOf(g.repo)}` });
    list.appendChild(h(doc, 'div', { class: 'group-head' }, sw, g.repo === UNSCOPED ? 'unscoped' : g.repo) as unknown as Node);
    for (const s of ss) {
      const glyph = s.backend === 'local' ? '○' : '●';
      list.appendChild(h(doc, 'button', { class: `session-row state-${s.state}${isLiveState(s.state) ? ' live' : ' gone'}${focused === s.hsid ? ' active' : ''}`, type: 'button', 'data-hsid': s.hsid, title: s.hsid }, h(doc, 'span', { class: 'glyph' }, glyph), `${s.hsid.slice(-10)} · ${s.state}${s.pending ? ` · ${s.pending} need you` : ''}`) as unknown as Node);
    }
  }
}

/* ── decision stack ─────────────────────────────────────────────── */
async function paintStack(arrived: Set<string> = new Set()): Promise<void> {
  const focusRepo = focused ? (store.sessions.get(focused)?.repo ?? null) : null;
  const cards = stackScoped && focused ? store.stack(focusRepo) : store.stack();
  put($('stack-scope'), stackScoped && focused ? 'this project' : 'all projects');
  put($('inbox'), `${store.cards.size} pending`);
  for (const c of cards) {
    const k = verifiedKey(c.cardId, String(c.card.contentHash ?? ''));
    if (!verified.has(k) && verifyKey && session) {
      verified.set(k, []);
      verified.set(k, await verifiedDecisions(crypto.subtle, verifyKey, session.hello.serverKeyId, { cardId: c.cardId, contentHash: String(c.card.contentHash ?? ''), actions: Array.isArray(c.card.actions) ? c.card.actions : [] }));
    }
  }
  const mk = (c: (typeof cards)[number]): HTMLElement => {
    const el = renderCard(
      { doc },
      {
        cardId: c.cardId,
        kind: c.kind,
        requestedBy: String(c.card.requestedBy ?? '?'),
        hsid: c.hsid,
        repo: c.repo,
        state: String(c.card.state ?? '?'),
        contentHash: String(c.card.contentHash ?? ''),
        flags: cardFlags(c.card, c.flags),
        decisions: verified.get(verifiedKey(c.cardId, String(c.card.contentHash ?? ''))) ?? [],
        decidable: isCardDecidable(c.card as never),
        ask: c.kind === 'ask-user' ? askDetailOf(c.card) : null,
      },
      c.card.block,
    ) as unknown as HTMLElement;
    const r = refusals.get(c.cardId);
    if (r) el.appendChild(h(doc, 'p', { class: 'refusal' }, refusalText(r)) as unknown as Node);
    if (arrived.has(`card-in:${c.cardId}`)) {
      el.classList.add('arriving');
      el.addEventListener('animationend', () => el.classList.remove('arriving'), { once: true });
    }
    return el;
  };
  const pile = $('stack');
  clear(pile);
  for (const c of cards) pile.appendChild(mk(c));
  const pinned = $('pinned');
  clear(pinned);
  if (focused) for (const c of store.stack(focusRepo)) if (c.hsid === focused) pinned.appendChild(mk(c));
}

/** ask-user: the picker's choices in the card element ⇒ the approve note (null = a question is unanswered). */
function askNoteFrom(cardEl: HTMLElement, cardId: string): string | null {
  const c = store.cards.get(cardId);
  if (!c) return null;
  const ask = askDetailOf(c.card);
  if (!ask) return null;
  const qs = ask.questions;
  const picks = new Map<number, AskPick>();
  for (const q of qs) picks.set(q.n, { chosen: [], free: '' });
  for (const el of Array.from(cardEl.querySelectorAll<HTMLInputElement>('input[data-ask-q]'))) {
    const p = picks.get(Number(el.dataset.askQ));
    if (!p) continue;
    if (el.dataset.askFree) p.free = el.value;
    else if (el.checked) p.chosen.push(Number(el.dataset.askOpt));
  }
  return askNote(qs, picks);
}

async function decide(cardId: string, decision: string, cardEl?: HTMLElement | null): Promise<void> {
  if (!client) return;
  let note: string | null = null;
  if (decision === 'answer') {
    note = cardEl ? askNoteFrom(cardEl, cardId) : null;
    if (note === null) {
      refusals.set(cardId, { code: 'BAD_REQUEST', reason: 'bad-params', message: 'answer every question: pick an option or type an answer', next: [], data: null });
      void paintStack();
      return;
    }
  }
  try {
    await client.call('approve', { cardId, decision, ...(note !== null ? { note } : {}) });
    refusals.delete(cardId);
  } catch (err) {
    // approve needs the approvals key + presence (#identity M1.3): the refusal is shown as the kernel gave it
    if (err instanceof RpcError) refusals.set(cardId, err.refusal);
  }
  void paintStack();
}

/* ── Shuttle view ───────────────────────────────────────────────── */
function paintShuttle(): void {
  const s = $('pane-shuttle');
  clear(s);
  const by = store.pendingByKind();
  const live = store.liveCount();
  const kv = (k: string, v: string) => h(doc, 'span', null, `${k} `, h(doc, 'span', { class: 'v' }, v));
  s.appendChild(kv('sessions', `${live} live · ${store.sessions.size} seen`) as unknown as Node);
  s.appendChild(kv('inbox', Object.keys(by).length ? Object.entries(by).map(([k, n]) => `${k} ×${n}`).join(' · ') : 'clear') as unknown as Node);
  s.appendChild(kv('log', `head ${store.head} · ${store.rowsSeen} rows`) as unknown as Node);
  if (session) s.appendChild(kv('api', `${session.hello.clientApi}${session.clientApiDrift ? ' · clientApiId drift' : ''}`) as unknown as Node);
}

let paintQueued = false;
let pending = new Set<string>();
function schedule(what: Set<string>): void {
  for (const w of what) pending.add(w);
  if (paintQueued) return;
  paintQueued = true;
  requestAnimationFrame(() => {
    paintQueued = false;
    const w = pending;
    pending = new Set();
    if ([...w].some((x) => x === 'feed' || x.startsWith('transcript:'))) paintTranscript();
    if (w.has('sessions') || w.has('cards')) paintSessions();
    if (w.has('cards')) void paintStack(w);
    paintShuttle();
  });
}
store.onChange(schedule);

/* ── connection ─────────────────────────────────────────────────── */
/** Backlog + follow with the {logId, seq} cursor; a cursor-epoch refusal clears the store and re-reads (core/client.ts). */
function subscribe(c: GnomonClient): Promise<void> {
  return followLog(c, store);
}

/** Read once at load: the wrapper's frozen marker, else the browser (T-2026-10-18-018 N1). */
const SURFACE = hostSurface();

async function attach(auth: { launchToken: string } | { reconnect: true }, fragmentKey: string | null, hint: CwdHint | null = null): Promise<void> {
  const pin = decidePin(fragmentKey, localStorage.getItem(PIN_KEY));
  if (!pin.ok) return showReconnect(pin.message);
  const endpointPath = `ws://${location.host}/rpc`;
  let t;
  try {
    t = await webSocketTransport(endpointPath);
  } catch {
    return showReconnect('the endpoint is not reachable: run `gnomon` (or `gnomon up`) in a terminal');
  }
  const c = new GnomonClient(t);
  const out = await c.connect({ surface: SURFACE, endpointPath, verifyKey: pin.verifyWith, auth, subtle: globalThis.crypto?.subtle });
  if (!out.ok) {
    c.close();
    if (out.stage === 'server-sig') {
      // a forged or foreign serverSig: render nothing but the error and send nothing more (§4.9, G-GUI-12 page side)
      document.querySelector('.desk')?.remove();
      notice(out.message, true);
      return;
    }
    return showReconnect(out.refusal ? refusalText(out.refusal) : out.message);
  }
  const previousPin = localStorage.getItem(PIN_KEY);
  if (pin.store) localStorage.setItem(PIN_KEY, pin.store);
  client = c;
  session = out.session;
  if (verifyKey !== pin.verifyWith) verified.clear(); // I4: decisions verified under another key are not reused
  verifyKey = pin.verifyWith;
  // #bare-entry (Aegis M1): the folder hint is shown ONLY after this launch token verified (hello + serverSig ok);
  // a failed attach drops it (no prefill, no note) and Reconnect never carries one (attach's default is null)
  if (hint) applyCwdHint(hintTarget(), hint);
  if (pin.notice && previousPin) {
    // C2: a re-pin is sticky, kernel-owned, names both keyIds, and is recorded in gui.log
    const from = shortKeyId(previousPin);
    const to = shortKeyId(pin.verifyWith);
    put($('repin-text'), `kernel key re-pinned from ${from} to ${to} (the new key came with a launch from \`gnomon\` or \`gnomon up\`)`);
    $('repin').hidden = false;
    void gnomonPost(fetch, '/diag', out.session.guiToken, `kernel key re-pinned from ${from} to ${to}`).catch(() => undefined);
  }
  c.onProtocolError((r) => {
    notice(`kernel could not read a frame from this page: ${refusalText(r)}`, true);
    void gnomonPost(fetch, '/diag', out.session.guiToken, `protocol error ${r.code} ${r.reason ?? ''} ${r.message}`).catch(() => undefined);
  });
  $('reconnect').hidden = true;
  $('risk').hidden = SURFACE === 'wrapper'; // the extension-risk badge is the browser's: the wrapper has no extensions (S25-L1)
  put($('conn'), `${out.session.principal} · ${out.session.connId.slice(-8)}`);
  c.onNotification((method, params) => {
    if (method !== 'event') return;
    const p = (params ?? {}) as { row?: unknown; end?: { since?: number } };
    if (p.row) store.apply([p.row]);
    else if (p.end) void followLog(c, store).catch(() => undefined);
  });
  c.onClose(() => {
    client = null;
    session = null;
    showReconnect('the connection ended; the GUI session ended with it (D54)');
  });
  try {
    status = await c.call<Record<string, unknown>>('status');
  } catch {
    status = null;
  }
  try {
    await subscribe(c);
  } catch (err) {
    notice(err instanceof RpcError ? refusalText(err.refusal) : 'log.read failed', true);
  }
}

function showReconnect(why: string): void {
  put($('conn'), 'not connected');
  put($('reconnect-why'), why);
  $('reconnect').hidden = false;
}

/* ── composer / new session ─────────────────────────────────────── */
async function send(textValue: string): Promise<void> {
  if (!textValue.trim()) return;
  // never swallow a message silently: say why nothing was sent (dogfood: Enter on the kernel feed "did nothing")
  if (!client) return notice('not connected: nothing was sent', true);
  if (!focused) return notice('no session focused: pick a session on the left or open a new one; nothing was sent', true);
  local.push({ seq: store.head + 0.5, kind: 'composer', connId: 'local', session: focused, payload: textValue, at: new Date().toISOString() });
  schedule(new Set([`transcript:${focused}`]));
  try {
    await client.call('session.send', { hsid: focused, content: [{ text: textValue }] });
  } catch (err) {
    if (err instanceof RpcError) local.push({ seq: store.head + 0.6, kind: 'send.refused', connId: 'local', session: focused, payload: refusalText(err.refusal) });
    schedule(new Set([`transcript:${focused}`]));
  }
}

async function openSession(cwd: string, model: string): Promise<void> {
  if (!client) return;
  try {
    const r = await client.call<{ hsid: string }>('session.open', { cwd, model, attended: true });
    focus(r.hsid);
  } catch (err) {
    notice(err instanceof RpcError ? refusalText(err.refusal) : 'session.open failed', true);
  }
}

function focus(hsid: string | null): void {
  if (width) widths.save(transcriptId(), width, heights);
  focused = hsid;
  closeDrawers();
  put($('composer-mode'), hsid ? `to ${hsid.slice(-10)}` : 'no session focused');
  resetTranscript();
  paintSessions();
  void paintStack();
}

/* ── palette ────────────────────────────────────────────────────── */
let palSel = 0;
let palItems: Command[] = [];
function openPalette(): void {
  $('palette').hidden = false;
  const i = $<HTMLInputElement>('palette-input');
  i.value = '';
  paintPalette();
  i.focus();
}
function paintPalette(): void {
  palItems = filterCommands(paletteEntries(status as never), $<HTMLInputElement>('palette-input').value);
  palSel = Math.min(palSel, Math.max(0, palItems.length - 1));
  const l = $('palette-list');
  clear(l);
  palItems.forEach((c, i) => l.appendChild(h(doc, 'div', { class: `pal-row${i === palSel ? ' sel' : ''}${c.verb && !c.available ? ' unavailable' : ''}`, role: 'option', 'data-id': c.id }, h(doc, 'span', null, `${c.id}  ${c.title}`), h(doc, 'small', { class: 'meta' }, c.keys ?? c.why ?? '')) as unknown as Node));
}
function run(id: string): void {
  $('palette').hidden = true;
  if (id.startsWith('theme.')) theme = id.slice(6) as ThemeChoice;
  else if (id === 'motion.reduce') motion = 'reduce';
  else if (id === 'motion.system') motion = 'system';
  else if (id.startsWith('layout.')) layout = applyPreset(id.slice(7));
  else if (id === 'pane.sessions.toggle') layout = togglePane(layout, 'sessions');
  else if (id === 'pane.stack.toggle') layout = togglePane(layout, 'stack');
  else if (id === 'pane.shuttle.toggle') layout = togglePane(layout, 'shuttle');
  else if (id === 'stack.scope.toggle') {
    stackScoped = !stackScoped;
    void paintStack();
  } else if (id === 'session.new') {
    clearCwdHint(hintTarget()); // Aegis L2: a hint belongs to the launch that verified it, not to a later "+ new"
    $('new-session-dialog').hidden = false;
  }
  else if (id === 'composer.focus') $('composer-text').focus();
  else if (id === 'gui.reconnect') void attach({ reconnect: true }, null);
  else if (id === 'diag.send' && session) void gnomonPost(fetch, '/diag', session.guiToken, `diag from palette at ${new Date().toISOString()}`);
  else if (id === 'verb.status' && client) void client.call('status').then((s) => (status = s as Record<string, unknown>));
  applyLook();
  applyLayout();
}

/* ── events (every write verb hangs off a user gesture, G-GUI-04) ── */
function wire(): void {
  $('viewport').addEventListener(
    'scroll',
    () => {
      const vp = $('viewport');
      follow.onScroll(isAtBottom(vp.scrollTop, vp.clientHeight, vp.scrollHeight));
      paintTranscript();
    },
    { passive: true },
  );
  new ResizeObserver(() => {
    const w = $('viewport').clientWidth;
    if (w !== width) {
      if (width) widths.save(transcriptId(), width, heights);
      width = w;
      paintTranscript(true);
    } else paintTranscript();
  }).observe($('viewport'));
  $('jump-latest').addEventListener('click', () => {
    follow.jump();
    paintTranscript();
    $('composer-text').focus();
  });
  $('raw-toggle').addEventListener('click', () => {
    if (width) widths.save(transcriptId(), width, heights);
    rawMode = !rawMode;
    resetTranscript();
  });
  $('toggle-sessions').addEventListener('click', () => toggleDrawer('sessions'));
  $('toggle-stack').addEventListener('click', () => toggleDrawer('stack'));
  $('scrim').addEventListener('click', closeDrawers);
  $('session-list').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-hsid]') as HTMLElement | null;
    if (b) focus(b.dataset.hsid || null);
  });
  $('session-search').addEventListener('input', paintSessions);
  const onCard = (e: Event): void => {
    const b = (e.target as HTMLElement).closest('[data-decision]') as HTMLElement | null;
    if (b && e.isTrusted) void decide(b.dataset.cardId!, b.dataset.decision!, b.closest('[data-card-id].card') as HTMLElement | null);
    const k = (e.target as HTMLElement).closest('[data-command]') as HTMLElement | null;
    if (k && e.isTrusted && BLOCK_SAFE_COMMANDS.has(k.dataset.command!)) run(k.dataset.command!);
  };
  $('stack').addEventListener('click', onCard);
  $('pinned').addEventListener('click', onCard);
  $('stack-scope').addEventListener('click', () => run('stack.scope.toggle'));
  $('composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = $<HTMLTextAreaElement>('composer-text');
    void send(t.value);
    t.value = '';
  });
  $('composer-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $<HTMLFormElement>('composer').requestSubmit();
    }
  });
  $('new-session').addEventListener('click', () => run('session.new'));
  $('ns-cancel').addEventListener('click', () => {
    $('new-session-dialog').hidden = true;
    clearCwdHint(hintTarget());
  });
  $('new-session-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!e.isTrusted) return; // Aegis L2: a session opens on the human's own submit only, like the card handlers
    $('new-session-dialog').hidden = true;
    clearCwdHint(hintTarget());
    void openSession($<HTMLInputElement>('ns-cwd').value, $<HTMLSelectElement>('ns-model').value);
  });
  $('reconnect-btn').addEventListener('click', () => void attach({ reconnect: true }, null));
  $('palette-btn').addEventListener('click', openPalette);
  $('repin-ack').addEventListener('click', (e) => {
    if (e.isTrusted) $('repin').hidden = true; // only a user click clears the re-pin notice
  });
  $('palette-input').addEventListener('input', () => {
    palSel = 0;
    paintPalette();
  });
  $('palette-input').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') palSel = Math.min(palSel + 1, palItems.length - 1);
    else if (e.key === 'ArrowUp') palSel = Math.max(palSel - 1, 0);
    else if (e.key === 'Enter' && palItems[palSel]) return run(palItems[palSel]!.id);
    else if (e.key === 'Escape') return void ($('palette').hidden = true);
    else return;
    e.preventDefault();
    paintPalette();
  });
  $('palette-list').addEventListener('click', (e) => {
    const r = (e.target as HTMLElement).closest('[data-id]') as HTMLElement | null;
    if (r) run(r.dataset.id!);
  });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPalette();
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      run('session.new');
    }
  });
  window.addEventListener('error', (e) => {
    if (session) void gnomonPost(fetch, '/diag', session.guiToken, `error ${String(e.message).slice(0, 2000)}`).catch(() => undefined);
  });
}

/* ── boot ───────────────────────────────────────────────────────── */
export function main(raw?: string): void {
  const take = (globalThis as { gnomonTakeLaunch?: () => string }).gnomonTakeLaunch;
  const frag = parseLaunchFragment(raw ?? (take ? take() : ''));
  applyLook();
  applyLayout();
  wire();
  // #bare-entry: the folder hint is decoded here but applied by attach only after the token verified (Aegis M1)
  if (frag) void attach({ launchToken: frag.launchToken }, frag.kernelPublicKey, frag.cwd !== undefined ? cwdHintOf(frag.cwd) : null);
  else showReconnect('This page has no GUI session (a reload, a restart or a token-less launch). Reconnect asks for your presence.');
}
