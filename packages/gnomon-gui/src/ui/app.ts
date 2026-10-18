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
import { isCardDecidable } from '@a-company/gnomon-contracts';
import { GnomonClient, gnomonPost, RpcError, webSocketTransport, type Session, type ShownRefusal } from '../core/client.js';
import { applyPreset, filterCommands, paletteEntries, resolveMotion, resolveTheme, togglePane, type Command, type Layout, type ThemeChoice } from '../core/commands.js';
import { decidePin, parseLaunchFragment, PIN_KEY } from '../core/launch.js';
import { cardFlags, h, renderCard, type MiniDoc } from '../core/render.js';
import { clean } from '../core/sanitize.js';
import { verifiedDecisions } from '../core/server-sig.js';
import { GuiStore, rowSummary, UNSCOPED, type Row } from '../core/store.js';
import { HeightIndex, visibleRange, WidthCache } from '../core/virtual.js';

const doc = document as unknown as MiniDoc;
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const clear = (el: HTMLElement): void => {
  while (el.firstChild) el.removeChild(el.firstChild);
};
const put = (el: HTMLElement, s: string): void => {
  el.textContent = clean(s);
};

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
const verified = new Map<string, string[]>();

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

/* ── transcript (virtualized) ───────────────────────────────────── */
const widths = new WidthCache(22);
let heights = new HeightIndex(22);
let width = 0;
let rows: readonly Row[] = [];
const mounted = new Map<number, HTMLElement>();

function currentRows(): readonly Row[] {
  const base = focused ? store.transcript(focused) : store.kernelFeed;
  const mine = local.filter((r) => (r.session ?? null) === focused);
  return mine.length ? [...base, ...mine].sort((a, b) => a.seq - b.seq) : base;
}

function resetTranscript(): void {
  for (const el of mounted.values()) el.remove();
  mounted.clear();
  rows = currentRows();
  heights = widths.restore(width, rows.length);
  put($('transcript-title'), focused ?? 'kernel feed');
  paintTranscript(true);
}

function paintTranscript(stick = false): void {
  const vp = $('viewport');
  const next = currentRows();
  if (next.length > heights.length) heights.push(next.length - heights.length);
  rows = next;
  const atBottom = stick || vp.scrollTop + vp.clientHeight >= vp.scrollHeight - 4;
  $('spacer').style.height = `${heights.total()}px`;
  if (atBottom) vp.scrollTop = vp.scrollHeight;
  const { start, end } = visibleRange(heights, vp.scrollTop, vp.clientHeight || 600);
  for (const [i, el] of mounted) if (i < start || i >= end) {
    el.remove();
    mounted.delete(i);
  }
  for (let i = start; i < end; i++) {
    if (mounted.has(i)) continue;
    const r = rows[i]!;
    const at = r.at ? r.at.slice(11, 16) : '';
    const el = h(doc, 'div', { class: `trow kind-${r.kind.split('.')[0]!.replace(/[^a-z]/g, '')}${r.connId === 'local' ? ' local' : ''}${r.kind.endsWith('refused') ? ' refused' : ''}` }, h(doc, 'span', { class: 't' }, at), r.connId === 'local' ? `you · ${String(r.payload)}` : rowSummary(r)) as unknown as HTMLElement;
    el.style.top = `${heights.offsetOf(i)}px`;
    vp.appendChild(el);
    mounted.set(i, el);
    heights.set(i, el.offsetHeight || heights.estimate);
  }
  for (const [i, el] of mounted) el.style.top = `${heights.offsetOf(i)}px`;
  put($('transcript-count'), `${rows.length} rows`);
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
      list.appendChild(h(doc, 'button', { class: `session-row state-${s.state}${focused === s.hsid ? ' active' : ''}`, type: 'button', 'data-hsid': s.hsid, title: s.hsid }, h(doc, 'span', { class: 'glyph' }, glyph), `${s.hsid.slice(-10)} · ${s.state}${s.pending ? ` · ${s.pending} need you` : ''}`) as unknown as Node);
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
    if (!verified.has(c.cardId) && verifyKey) {
      verified.set(c.cardId, []);
      verified.set(c.cardId, await verifiedDecisions(crypto.subtle, verifyKey, { cardId: c.cardId, contentHash: String(c.card.contentHash ?? ''), actions: Array.isArray(c.card.actions) ? c.card.actions : [] }));
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
        decisions: verified.get(c.cardId) ?? [],
        decidable: isCardDecidable(c.card as never),
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

async function decide(cardId: string, decision: string): Promise<void> {
  if (!client) return;
  try {
    await client.call('approve', { cardId, decision });
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
  const live = [...store.sessions.values()].filter((x) => x.state === 'open' || x.state === 'streaming' || x.state === 'idle').length;
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
async function subscribe(c: GnomonClient): Promise<void> {
  let since = store.head;
  for (;;) {
    const page = await c.call<{ rows: Row[]; next: number; caughtUp: boolean }>('log.read', { since, limit: 1000 });
    store.apply(page.rows);
    since = Math.max(since, page.next);
    if (page.caughtUp) break;
  }
  await c.call('log.read', { since, follow: true });
}

async function attach(auth: { launchToken: string } | { reconnect: true }, fragmentKey: string | null): Promise<void> {
  const pin = decidePin(fragmentKey, localStorage.getItem(PIN_KEY));
  if (!pin.ok) return showReconnect(pin.message);
  const endpointPath = `ws://${location.host}/rpc`;
  let t;
  try {
    t = await webSocketTransport(endpointPath);
  } catch {
    return showReconnect('the endpoint is not reachable: run `gnomon open`');
  }
  const c = new GnomonClient(t);
  const out = await c.connect({ surface: 'browser', endpointPath, verifyKey: pin.verifyWith, auth, subtle: globalThis.crypto?.subtle });
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
  if (pin.store) localStorage.setItem(PIN_KEY, pin.store);
  notice(pin.notice);
  client = c;
  session = out.session;
  verifyKey = pin.verifyWith;
  $('reconnect').hidden = true;
  $('risk').hidden = false; // surface browser (wrapper detection lands with the wrapper)
  put($('conn'), `${out.session.principal} · ${out.session.connId.slice(-8)}`);
  c.onNotification((method, params) => {
    if (method !== 'event') return;
    const p = (params ?? {}) as { row?: Row; end?: { since?: number } };
    if (p.row) store.apply([p.row]);
    else if (p.end) void c.call('log.read', { since: store.head, follow: true }).catch(() => undefined);
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
  if (!client || !focused || !textValue.trim()) return;
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
  if (width) widths.save(width, heights);
  focused = hsid;
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
  } else if (id === 'session.new') $('new-session-dialog').hidden = false;
  else if (id === 'composer.focus') $('composer-text').focus();
  else if (id === 'gui.reconnect') void attach({ reconnect: true }, null);
  else if (id === 'diag.send' && session) void gnomonPost(fetch, '/diag', session.guiToken, `diag from palette at ${new Date().toISOString()}`);
  else if (id === 'verb.status' && client) void client.call('status').then((s) => (status = s as Record<string, unknown>));
  applyLook();
  applyLayout();
}

/* ── events (every write verb hangs off a user gesture, G-GUI-04) ── */
function wire(): void {
  $('viewport').addEventListener('scroll', () => paintTranscript(), { passive: true });
  new ResizeObserver(() => {
    const w = $('viewport').clientWidth;
    if (w !== width) {
      if (width) widths.save(width, heights);
      width = w;
      resetTranscript();
    } else paintTranscript();
  }).observe($('viewport'));
  $('session-list').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-hsid]') as HTMLElement | null;
    if (b) focus(b.dataset.hsid || null);
  });
  $('session-search').addEventListener('input', paintSessions);
  const onCard = (e: Event): void => {
    const b = (e.target as HTMLElement).closest('[data-decision]') as HTMLElement | null;
    if (b && e.isTrusted) void decide(b.dataset.cardId!, b.dataset.decision!);
    const k = (e.target as HTMLElement).closest('[data-command]') as HTMLElement | null;
    if (k && e.isTrusted) run(k.dataset.command!);
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
  $('ns-cancel').addEventListener('click', () => ($('new-session-dialog').hidden = true));
  $('new-session-form').addEventListener('submit', (e) => {
    e.preventDefault();
    $('new-session-dialog').hidden = true;
    void openSession($<HTMLInputElement>('ns-cwd').value, $<HTMLSelectElement>('ns-model').value);
  });
  $('reconnect-btn').addEventListener('click', () => void attach({ reconnect: true }, null));
  $('palette-btn').addEventListener('click', openPalette);
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
export function main(): void {
  const take = (globalThis as { gnomonTakeLaunch?: () => string }).gnomonTakeLaunch;
  const frag = parseLaunchFragment(take ? take() : '');
  applyLook();
  applyLayout();
  wire();
  if (frag) void attach({ launchToken: frag.launchToken }, frag.kernelPublicKey);
  else showReconnect('This page has no GUI session (a reload, a restart or a token-less launch). Reconnect asks for your presence.');
}
