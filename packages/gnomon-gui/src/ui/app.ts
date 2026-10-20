/**
 * @symbol #gui
 *
 * #gui page wiring (spec §11.1–§11.5). Browser-only glue over the pure core:
 * launch (boot.js read-and-clear → pin decision → hello → WebCrypto serverSig
 * → auth), Reconnect, the log.read backlog + follow subscription, the
 * virtualized transcript, the sessions sidebar with new-session, the decision
 * stack (approve on a user gesture only, `G-GUI-04`; refusals shown
 * verbatim), the composer (session.open / session.send), the run-mode
 * control (header menu, ⇧Tab, palette; core/modes.ts), the voice pill and
 * attach controls (core/voice.ts, V2d), the voice app's lifecycle, dev banner,
 * enrolment dialog and notices (core/voice-client.ts, V2e), the palette,
 * themes + auto + reduced motion, the Shuttle view and /diag. Every string
 * reaches the DOM through core/render.ts as a text node.
 */
import { isCardDecidable, sanitizeDisplayText } from '@a-company/gnomon-contracts';
import { followLog, GnomonClient, gnomonPost, RpcError, webSocketTransport, type Session, type ShownRefusal } from '../core/client.js';
import { clearRestarting, markRestarting, noteResume, peekResumeKey, restarting, RESTART_GUIDANCE, RESTART_KEY_REFUSED, resumeRepinText, takeRestart, upgradeBannerOf, waitForOrigin } from '../core/restart.js';
import { applyPreset, BLOCK_SAFE_COMMANDS, filterCommands, paletteEntries, resolveMotion, resolveTheme, togglePane, type Command, type Layout, type ThemeChoice } from '../core/commands.js';
import { applyCwdHint, clearCwdHint, cwdHintOf, decidePin, type CwdHint, type CwdHintTarget, hostSurface, parseLaunchFragment, PIN_KEY } from '../core/launch.js';
import { approveParamsOf, askDetailOf, askNote, prefixOptionsOf, cardFlags, h, renderCard, type AskPick, type MiniDoc } from '../core/render.js';
import { base64UrlToBytes, keyIdOfSpki, verifiedDecisions } from '../core/server-sig.js';
import { Follow, isAtBottom } from '../core/follow.js';
import { chatItems, GuiStore, isLiveState, rowOf, UNSCOPED, type ChatItem, type Row } from '../core/store.js';
import { HeightIndex, visibleRange, WidthCache } from '../core/virtual.js';
import { menuEntries, modeLabel, modeRequest, nextRunMode, planChange, RUN_MODES, sessionModeOf, type RunMode } from '../core/modes.js';
import { clientMenuEntries, clientOf, clientPillOf, clientRequest, consentText, devBannerOf, enrolLine, enrolAllowed, ENROL_POLL_MS, enrolRequest, enrolSent, enrolStart, forgetRequest, isEnrolCard, needsStart, normalizeVoiceName, noticeOf, reduceEnrolStatus, toastFresh, TOAST_MS } from '../core/voice-client.js';
import { DELAY_CHOICES, DELAY_KEY, DICTATION_POLL_MS, delayLabel, dictationNote, dictationStatusOf, hasDraft, initialDictation, liveLine, parseDelay, reduceDictation, ringFraction, ringRemaining, sendRequest, serializeDelay, type DictationEvent } from '../core/dictation.js';
import { canAttach, isVoiceWidenCard, pillOf, planVoice, sessionName, voiceMenuEntries, voiceRefusalNote, voiceRequest, voiceStatusOf, VOICE_STATES, VOICE_TITLE, type VoiceState } from '../core/voice.js';

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
  const label = it.role === 'user' && it.voice === 'voice-edited' ? `🎙✎ ${it.speaker ?? 'you'}` : it.speaker !== undefined && it.role === 'user' ? `🎙 ${it.speaker}` : ROLE_LABEL[it.role];
  const at = it.at ? it.at.slice(11, 16) : '';
  if (it.role === 'voice-partial') return h(doc, 'div', { class: 'trow role-voice-partial' }, h(doc, 'span', { class: 'voice-tag' }, `🎙 ${it.speaker ?? 'voice'}`), ' ', it.text) as unknown as HTMLElement;
  const body = label
    ? [h(doc, 'div', { class: 'who' }, label, h(doc, 'span', { class: 't' }, at)), h(doc, 'div', { class: 'body' }, it.text)]
    : it.role === 'raw'
      ? [h(doc, 'span', { class: 't' }, at), it.text]
      : [it.text];
  return h(doc, 'div', { class: `trow role-${it.role}${it.speaker !== undefined ? ' voice' : ''}` }, ...body) as unknown as HTMLElement;
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
/** The page's own scroll writes, so the scroll handler can tell them from the user's (they must not change stickiness). */
let selfTop = -1;
let lastTop = 0;
function setScroll(vp: HTMLElement, top: number): void {
  vp.scrollTop = top;
  selfTop = vp.scrollTop;
}

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
    if (follow.shouldStick) setScroll(vp, vp.scrollHeight);
    else if (items.length) {
      const want = heights.offsetOf(Math.min(anchor, items.length - 1)) + anchorDelta;
      if (Math.abs(vp.scrollTop - want) >= 1) setScroll(vp, want);
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
      const vv = voiceStatusOf(status);
      const mic = vv.state !== 'off' && vv.hsid === s.hsid ? (vv.state === 'ambient' ? ' · 🎙 ambient' : ' · 🎙 push-to-talk') : '';
      list.appendChild(h(doc, 'button', { class: `session-row state-${s.state}${isLiveState(s.state) ? ' live' : ' gone'}${focused === s.hsid ? ' active' : ''}`, type: 'button', 'data-hsid': s.hsid, title: s.hsid }, h(doc, 'span', { class: 'glyph' }, glyph), `${s.hsid.slice(-10)} · ${s.state}${s.pending ? ` · ${s.pending} need you` : ''}${mic}`) as unknown as Node);
      // V2d: the focused live session gets [Voice ▾] (PTT | Ambient); only a human connection is offered it
      if (focused === s.hsid && isLiveState(s.state) && canAttach(status)) list.appendChild(voiceRowEl(s.hsid, vv));
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
        prefixOptions: c.kind === 'permission' ? prefixOptionsOf(c.card) : null,
      },
      c.card.block,
    ) as unknown as HTMLElement;
    const r = refusals.get(c.cardId);
    if (r) el.appendChild(h(doc, 'p', { class: 'refusal' }, refusalText(r)) as unknown as Node);
    if (arrived.has(`card-in:${c.cardId}`)) {
      el.classList.add('arriving');
      // TD-2026-10-19-063: a claim-mismatch card arrives with Deny focused (a keypress never lands on allow)
      queueMicrotask(() => (el.querySelector('[data-default]') as HTMLElement | null)?.focus());
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
  paintUpdateBanner();
}

/* ── self-update (TD-2026-10-19-063, core/restart.ts) ───────────── */
function paintUpdateBanner(): void {
  const b = upgradeBannerOf([...store.cards.values()].map((c) => ({ cardId: c.cardId, kind: c.kind, card: c.card as Record<string, unknown> })));
  let el = document.getElementById('update-banner');
  if (!b) {
    if (el) el.hidden = true;
    return;
  }
  if (!el) {
    el = h(doc, 'div', { id: 'update-banner', class: 'update-banner', role: 'status' }) as unknown as HTMLElement;
    document.body.prepend(el);
  }
  clear(el);
  el.appendChild(h(doc, 'span', null, `${b.text} · `) as unknown as Node);
  const btn = h(doc, 'button', { type: 'button' }, 'Restart now') as unknown as HTMLButtonElement;
  // focuses the card only: the restart is the card's accept, with Touch ID
  btn.addEventListener('click', () => focusCard(b.cardId));
  el.appendChild(btn);
  el.hidden = false;
}

/** The socket closed after this page accepted the upgrade: wait for the successor, then load its bundle. */
async function awaitRestart(): Promise<void> {
  put($('conn'), 'restarting…');
  notice('Gnomon is restarting with the new version…');
  if (!(await waitForOrigin((u) => fetch(u, { cache: 'no-store' }), location.origin))) {
    clearRestarting(sessionStorage);
    return showReconnect(RESTART_GUIDANCE);
  }
  // Aegis H (defence in depth): before the token goes anywhere, the kernel at this address must sign a fresh nonce
  // with the key the old kernel delivered; otherwise the marker (and its token) is dropped
  const key = peekResumeKey(sessionStorage);
  if (key) {
    const endpointPath = `ws://${location.host}/rpc`;
    let ok = false;
    try {
      ok = await new GnomonClient(await webSocketTransport(endpointPath)).probeKey({ surface: SURFACE, endpointPath, verifyKey: key, subtle: globalThis.crypto?.subtle });
    } catch {
      ok = false;
    }
    if (!ok) {
      clearRestarting(sessionStorage);
      return showReconnect(RESTART_KEY_REFUSED);
    }
  }
  location.reload();
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

async function decide(cardId: string, decision: string, cardEl?: HTMLElement | null, keyEl?: HTMLElement | null): Promise<void> {
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
  const c0 = store.cards.get(cardId);
  const upgrade = decision === 'accept' && !!c0 && upgradeBannerOf([{ cardId, kind: c0.kind, card: c0.card as Record<string, unknown> }]) !== null;
  if (upgrade) markRestarting(sessionStorage, cardId);
  try {
    await client.call('approve', approveParamsOf(cardId, decision, note, keyEl ? { ...(keyEl.dataset.scope !== undefined ? { scope: keyEl.dataset.scope } : {}), ...(keyEl.dataset.prefix !== undefined ? { prefix: keyEl.dataset.prefix } : {}) } : null));
    refusals.delete(cardId);
  } catch (err) {
    // a refused accept restarts nothing; a delivery-unknown one may: keep the marker then (the close decides)
    if (upgrade && !(err instanceof RpcError && err.refusal.code === 'DELIVERY_UNKNOWN')) clearRestarting(sessionStorage);
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
    if (w.has('modes') || w.has('voice')) void refreshStatus();
    if (w.has('voice-activity')) kickMeter();
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

async function attach(auth: { launchToken: string } | { reconnect: true } | { resumeToken: string }, fragmentKey: string | null, hint: CwdHint | null = null): Promise<void> {
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
    put($('repin-text'), 'resumeToken' in auth ? resumeRepinText(from, to) : `kernel key re-pinned from ${from} to ${to} (the new key came with a launch from \`gnomon\` or \`gnomon up\`)`);
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
    if (method === 'gui.resume') return void noteResume(sessionStorage, params);
    if (method !== 'event') return;
    const p = (params ?? {}) as { row?: unknown; end?: { since?: number } };
    if (p.row) {
      store.apply([p.row]);
      const r = rowOf(p.row);
      if (r) dictationRow(r); // dictation: only LIVE rows feed the composer (the backlog page never does)
    } else if (p.end) void followLog(c, store).catch(() => undefined);
  });
  c.onClose(() => {
    client = null;
    session = null;
    if (restarting(sessionStorage)) return void awaitRestart();
    showReconnect('the connection ended; the GUI session ended with it (D54)');
  });
  try {
    status = await c.call<Record<string, unknown>>('status');
  } catch {
    status = null;
  }
  voicePresenceDone = false; // ambient's Touch ID is once per GUI login (V2d)
  paintMode();
  paintVoice();
  try {
    await subscribe(c);
  } catch (err) {
    notice(err instanceof RpcError ? refusalText(err.refusal) : 'log.read failed', true);
  }
  dispatchDictation({ type: 'start', sinceSeq: store.head, now: Date.now() }); // everything read so far is backlog
  syncDictationContext();
}

function showReconnect(why: string): void {
  put($('conn'), 'not connected');
  put($('reconnect-why'), why);
  $('reconnect').hidden = false;
}

/* ── composer / new session ─────────────────────────────────────── */
async function send(textValue: string): Promise<void> {
  if (!textValue.trim()) return;
  // dictation: a draft with dictated turns for the focused session goes through the dictation send (one part per turn)
  if (dictationOn() && dict.focusedHere && dict.parts.length && hasDraft(dict)) return dispatchDictation({ type: 'sendNow', now: Date.now() });
  if (hasDraft(dict)) dispatchDictation({ type: 'sent', now: Date.now() }); // a typed message clears hold
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
    // TD-2026-10-19-063: a changed claude binary — the kernel pre-staged a re-pin card; [Re-pin] focuses it
    const d = err instanceof RpcError ? ((err.refusal.data ?? {}) as Record<string, unknown>) : {};
    if (d.session === 'claude_binary_changed') {
      const btn = h(doc, 'button', { class: 'key', type: 'button' }, 'Re-pin') as unknown as HTMLButtonElement;
      btn.addEventListener('click', (e) => {
        if (e.isTrusted) focusCard(typeof d.cardId === 'string' ? d.cardId : null);
      });
      $('notice').appendChild(btn);
    }
  }
}

/** Scroll to a card and focus its default key (Deny on a claim-mismatch card), else its first key. Never decides. */
function focusCard(cardId: string | null): void {
  const pile = $('stack');
  const el = (cardId ? pile.querySelector(`[data-card-id="${CSS.escape(cardId)}"].card`) : null) ?? pile.querySelector('.card.kind-gate-class');
  if (!el) return notice('the re-pin card has not arrived yet; it shows in the inbox when it does', true);
  el.scrollIntoView({ block: 'nearest' });
  ((el.querySelector('[data-default]') ?? el.querySelector('[data-decision]') ?? el) as HTMLElement).focus();
}

function focus(hsid: string | null): void {
  if (width) widths.save(transcriptId(), width, heights);
  focused = hsid;
  closeDrawers();
  closeModeMenu();
  closeVoiceMenu();
  voiceRowOpen = false;
  paintMode();
  paintVoice();
  resetTranscript();
  paintSessions();
  void paintStack();
  syncDictationContext();
}

/* ── voice dictation (TD-2026-10-20-262; core/dictation.ts) ────────── */
let dict = initialDictation(parseDelay(localStorage.getItem(DELAY_KEY)));
let dictTimer: ReturnType<typeof setInterval> | null = null;
let dictTicks = 0;
let dictLive = '';

/** Only a first-party human connection dictates (a voice connection never gets these controls). */
function dictationOn(): boolean {
  return !!client && canAttach(status);
}

function dispatchDictation(e: DictationEvent): void {
  const prev = dict;
  dict = reduceDictation(dict, e);
  const ta = $<HTMLTextAreaElement>('composer-text');
  // the composer shows the draft while its session is focused (a typed edit is already in it)
  if (dict.focusedHere && dict.text !== prev.text && ta.value !== dict.text && e.type !== 'userEdit') ta.value = dict.text;
  if (e.type === 'context' && !prev.focusedHere && dict.focusedHere && dict.parts.length && !ta.value) ta.value = dict.text; // back on the draft's session
  if (prev.focusedHere && !dict.focusedHere && prev.parts.length && ta.value === prev.text) ta.value = ''; // the draft waits off-screen
  if (dict.sending && !prev.sending) void sendDictation();
  syncDictationTimer();
  paintDictation();
}

/** A live row: a dictated turn for the composer, or the draft session's streaming (resets the ring). */
function dictationRow(r: Row): void {
  if (!dictationOn()) return;
  const now = Date.now();
  if (r.kind === 'voice.turn.user') {
    const p = r.payload && typeof r.payload === 'object' ? (r.payload as Record<string, unknown>) : null;
    dispatchDictation({ type: 'turnRow', seq: r.seq, hsid: r.session ?? (typeof p?.hsid === 'string' ? p.hsid : null), payload: r.payload, now });
  }
  if (dict.hsid && r.session === dict.hsid) dispatchDictation({ type: 'busy', busy: store.sessions.get(dict.hsid)?.state === 'streaming', now });
}

/** status.voice: the attached session, the voice app's activity and the ⌃⌥H count; the GUI's focused session. */
function syncDictationContext(): void {
  const now = Date.now();
  const on = dictationOn();
  dispatchDictation({ type: 'context', attached: on ? voiceStatusOf(status).hsid : null, focused, now });
  if (!on) return;
  const d = dictationStatusOf(status);
  if (d.activity !== dict.activity) dispatchDictation({ type: 'activity', activity: d.activity, now });
  if (d.holdToggles !== null && (d.holdToggles !== dict.holdToggles || d.epoch !== dict.holdEpoch)) dispatchDictation({ type: 'holdToggle', count: d.holdToggles, epoch: d.epoch, now });
}

function setDictationDelay(d: number | null): void {
  localStorage.setItem(DELAY_KEY, serializeDelay(d));
  dispatchDictation({ type: 'setDelay', delayMs: d, now: Date.now() });
  if (!$('voice-menu').hidden) paintVoiceMenu();
  notice(d === null ? 'dictation: auto-send off (Send or Enter sends)' : `dictation: auto-send after ${delayLabel(d)} of silence`);
}

/** While a draft exists: tick the ring (100 ms) and re-read status about every 300 ms (the ENROL_POLL_MS precedent). */
function syncDictationTimer(): void {
  const want = dict.parts.length > 0 && dictationOn();
  if (want && !dictTimer)
    dictTimer = setInterval(() => {
      dispatchDictation({ type: 'tick', now: Date.now() });
      if (++dictTicks % Math.max(1, Math.round(DICTATION_POLL_MS / 100)) === 0) void refreshStatus();
    }, 100);
  else if (!want && dictTimer) {
    clearInterval(dictTimer);
    dictTimer = null;
  }
}

/** The send the draft asked for: one part per dictated turn (unedited) or the edit as one part, source voice. */
async function sendDictation(): Promise<void> {
  const req = sendRequest(dict);
  if (!client || !req) return dispatchDictation({ type: 'sendFailed', now: Date.now() });
  // an edited draft's words are the human's: this page echoes them (🎙✎); unedited turns become the 🎙 bubbles
  // an edited draft is the human's own text (one part; the kernel attributes nothing, Aegis L1): echoed as typed
  if (dict.edited) local.push({ seq: store.head + 0.5, kind: 'composer', connId: 'local', session: req.hsid, payload: dict.text, at: new Date().toISOString() });
  schedule(new Set([`transcript:${req.hsid}`]));
  try {
    await client.call('session.send', req);
    dispatchDictation({ type: 'sent', now: Date.now() });
    // Aegis M3: the composer shows exactly the reducer's text: the in-flight edit (held) or the turns heard in flight
    const ta = $<HTMLTextAreaElement>('composer-text');
    if (dict.focusedHere) ta.value = dict.text;
  } catch (err) {
    if (err instanceof RpcError) local.push({ seq: store.head + 0.6, kind: 'send.refused', connId: 'local', session: req.hsid, payload: refusalText(err.refusal) });
    else notice('the dictated draft was not sent; it stays in the composer', true);
    dispatchDictation({ type: 'sendFailed', now: Date.now() });
    const ta = $<HTMLTextAreaElement>('composer-text');
    if (dict.focusedHere && !ta.value) ta.value = dict.text; // the draft stays in the composer
    schedule(new Set([`transcript:${req.hsid}`]));
  }
}

/** The ring, [Hold]/[Resume], [Send], the aria-live countdown and the pill's "draft waiting" note. */
function paintDictation(): void {
  const on = dictationOn() && dict.parts.length > 0;
  const bar = $('dictation');
  bar.hidden = !on || !dict.focusedHere;
  const now = Date.now();
  const frac = ringFraction(dict, now);
  const rem = ringRemaining(dict, now);
  $('dictation-ring').hidden = frac === null;
  if (frac !== null) $('dictation-arc').setAttribute('stroke-dashoffset', String(Math.round(frac * 1000) / 10));
  put($('dictation-secs'), rem === null ? '' : `${Math.ceil(rem / 1000)} s`);
  const line = on ? liveLine(dict, now) : '';
  if (line !== dictLive) put($('dictation-live'), (dictLive = line)); // a changed line only: the live region speaks once a second at most
  const hold = $('dictation-hold');
  put(hold, dict.hold ? 'Resume' : 'Hold');
  hold.setAttribute('aria-pressed', String(dict.hold));
  bar.classList.toggle('held', dict.hold);
  ($('dictation-send') as HTMLButtonElement).disabled = dict.sending;
  const note = on ? dictationNote(dict) : null;
  const vn = $('voice-note');
  const wasWaiting = vn.classList.contains('dictation-waiting');
  vn.classList.toggle('dictation-waiting', note === 'draft waiting');
  if (note === 'draft waiting' && dict.hsid) {
    vn.hidden = false;
    put(vn, `draft waiting · ${sessionName(dict.hsid)}`);
  } else if (wasWaiting) {
    vn.hidden = !store.voiceNote || voiceStatusOf(status).state !== 'off';
    put(vn, store.voiceNote ?? '');
  }
}

/* ── run mode (§11.4 control, §11.5 ⇧Tab; P8-D86/D87) ─────────────── */
/** The control's state is the kernel's status.runModes only (never a guess): re-read on a mode row (store 'modes'). */
async function refreshStatus(): Promise<void> {
  if (!client) return;
  try {
    status = await client.call<Record<string, unknown>>('status');
  } catch {
    /* keep the last status; the control shows what it last knew */
  }
  paintMode();
  paintVoice();
  paintSessions();
  syncDictationContext();
  foldVoiceReports();
}

let lastNoticeAt: string | null | undefined;
/** V2e (A3/A5): the voice app's relayed enrolment progress and notice live in status.voice; fold them in. */
function foldVoiceReports(): void {
  const n = noticeOf(status);
  if (n && n.at !== lastNoticeAt) {
    lastNoticeAt = n.at;
    store.voiceToast = n;
    showToast();
  }
  if (store.enrol) {
    const next = reduceEnrolStatus(store.enrol, status);
    if (next !== store.enrol) {
      store.enrol = next;
      paintEnrol();
    }
  }
}

let enrolPoll: ReturnType<typeof setInterval> | null = null;
/** A light status poll only while the enrol dialog waits on the Touch ID card or the voice app. */
function syncEnrolPoll(): void {
  const s = store.enrol;
  const want = !!s && !$('enrol-dialog').hidden && (s.step === 'confirm' || s.step === 'waiting' || s.step === 'phrase');
  if (want && !enrolPoll) enrolPoll = setInterval(() => void refreshStatus(), ENROL_POLL_MS);
  else if (!want && enrolPoll) {
    clearInterval(enrolPoll);
    enrolPoll = null;
  }
}

const currentMode = () => sessionModeOf(status, focused);

function paintMode(): void {
  const v = currentMode();
  const btn = $('mode-btn');
  btn.hidden = !focused || !v; // the kernel feed and an exited session have no mode to set
  put(btn, modeLabel(v));
  btn.className = `key quiet mode-btn kernel-owned${v ? ` mode-${v.effective}` : ''}`;
  put($('composer-mode'), focused ? `to ${focused.slice(-10)}${v ? ` · mode ${v.effective} · ⇧Tab cycles` : ''}` : 'no session focused');
  if (!$('mode-menu').hidden) paintModeMenu();
}

function paintModeMenu(): void {
  const menu = $('mode-menu');
  clear(menu);
  const v = currentMode();
  if (!v) return closeModeMenu();
  for (const e of menuEntries(v)) {
    const b = h(doc, 'button', { class: `mode-item${e.current ? ' current' : ''}`, type: 'button', role: 'menuitem', 'data-mode': e.mode, 'aria-disabled': String(e.disabled) }, h(doc, 'span', { class: 'mode-name' }, e.mode), h(doc, 'span', { class: 'mode-note' }, e.note)) as unknown as HTMLButtonElement;
    b.disabled = e.disabled;
    menu.appendChild(b);
  }
  if (v.repo) menu.appendChild(h(doc, 'button', { class: 'mode-item scope', type: 'button', role: 'menuitem', 'data-mode-scope': 'repo' }, `set for this repo instead (now ${v.source === 'session' ? 'this session has its own mode' : `the session follows the repo`})…`) as unknown as Node);
}

function openModeMenu(): void {
  if (!currentMode()) return;
  $('mode-menu').hidden = false;
  $('mode-btn').setAttribute('aria-expanded', 'true');
  paintModeMenu();
}
function closeModeMenu(): void {
  $('mode-menu').hidden = true;
  $('mode-btn').setAttribute('aria-expanded', 'false');
}

let modeBusy = false;
/**
 * One gesture changes the mode (G-GUI-04: only on a trusted user event). A tightening applies on the kernel's
 * answer; a loosening comes back as a pending strictness card that this same gesture decides `allow` — the kernel
 * then asks for Touch ID (fresh presence; a cached unlock never carries it). A refusal is shown as given.
 */
async function setMode(to: RunMode, scope: 'session' | 'repo', trusted: boolean): Promise<void> {
  if (!trusted) return;
  closeModeMenu();
  if (!client) return notice('not connected: the run mode was not changed', true);
  const v = currentMode();
  if (!v) return notice('no live session focused: the run mode was not changed', true);
  const plan = planChange(v, to);
  if (plan.kind === 'blocked') return notice(`${to} is not allowed here: ${plan.reason}`, true);
  if (scope === 'session' && plan.kind === 'same') return;
  const req = modeRequest(v, to, scope);
  if (!req) return notice('this session has no repo to set a mode for', true);
  if (modeBusy) return;
  modeBusy = true;
  try {
    const r = await client.call<Record<string, unknown>>('log.append', req);
    if (r.pending === true && typeof r.cardId === 'string') {
      notice(`run mode ${String(r.from)} → ${to}: confirm with Touch ID`);
      try {
        await client.call('approve', { cardId: r.cardId, decision: 'allow' });
        notice(null);
      } catch (err) {
        notice(err instanceof RpcError ? `the run mode stays ${String(r.from)}: ${refusalText(err.refusal)}` : `the run mode stays ${String(r.from)}`, true);
      }
    } else notice(null);
  } catch (err) {
    notice(err instanceof RpcError ? refusalText(err.refusal) : 'the run mode was not changed', true);
  } finally {
    modeBusy = false;
    await refreshStatus();
  }
}

/** ⇧Tab: the next mode in the cycle, skipping one the ceiling does not allow. */
function cycleMode(trusted: boolean): void {
  const v = currentMode();
  if (!v) return notice(focused ? 'this session reports no run mode (it ended, or the kernel is older)' : 'no session focused: ⇧Tab cycles the focused session\'s run mode', true);
  let to = nextRunMode(v.chosen);
  if (planChange(v, to).kind === 'blocked') to = nextRunMode(to);
  void setMode(to, 'session', trusted);
}

/* ── voice (V2d, TD-2026-10-19-298; core/voice.ts) ───────────────── */
let voicePresenceDone = false;
let voiceBusy = false;
let voiceRowOpen = false;

/** The pill is kernel-owned: its state is status.voice only (re-read on a voice.session.* row, store 'voice'). */
function paintVoice(): void {
  const v = voiceStatusOf(status);
  store.voiceIdleMs = v.ambientIdleMs;
  const p = pillOf(v);
  const btn = $('voice-pill');
  btn.className = p.className;
  btn.title = p.title;
  btn.dataset.state = p.state;
  put($('voice-label'), p.label);
  put($('voice-target'), p.target ? `· ${p.target}` : '');
  $('voice-meter').hidden = p.state !== 'ambient';
  // V2e: with nothing attached, the voice app's lifecycle owns the pill (setup phases, crash, the enrol nudge)
  const c = clientOf(status);
  const cp = clientPillOf(c, v.state !== 'off', canAttach(status));
  if (cp.label !== null) {
    btn.className = `voice-pill kernel-owned ${cp.className}`;
    btn.title = cp.title;
    btn.dataset.state = `client-${c.phase}`;
    put($('voice-label'), cp.label);
  }
  const bar = $('voice-progress');
  bar.hidden = cp.progress === null;
  if (cp.progress !== null) {
    bar.style.setProperty('--progress', String(cp.progress));
    bar.setAttribute('aria-valuenow', String(Math.round(cp.progress * 100)));
  }
  const act = $('voice-action');
  act.hidden = cp.action === null;
  act.dataset.action = cp.action ?? '';
  put(act, cp.actionLabel);
  const dev = devBannerOf(c);
  $('voice-dev').hidden = dev === null;
  put($('voice-dev'), dev ? `⚠ ${dev}` : '');
  if (!$('enrol-dialog').hidden) paintEnrol();
  if (v.level !== null) $('voice-meter').style.setProperty('--level', String(v.level));
  const note = store.voiceNote;
  $('voice-note').hidden = !note || v.state !== 'off';
  put($('voice-note'), note ?? '');
  if (!$('voice-menu').hidden) paintVoiceMenu();
  paintDictation();
}

/** A voice.turn.* row arrived: the meter kicks once (CSS; reduced motion keeps it still). */
function kickMeter(): void {
  const m = $('voice-meter');
  m.classList.remove('kick');
  void m.offsetWidth; // restart the animation
  m.classList.add('kick');
}

/** The session a choice applies to: Off and a mode switch go to the attached session; nothing attached ⇒ the focused one. */
function voiceTargetFor(to: VoiceState): string | null {
  const v = voiceStatusOf(status);
  if (to === 'off') return v.hsid;
  return v.state !== 'off' && v.hsid ? v.hsid : focused;
}

function paintVoiceMenu(): void {
  const menu = $('voice-menu');
  clear(menu);
  const v = voiceStatusOf(status);
  for (const e of voiceMenuEntries(v, focused, canAttach(status), voicePresenceDone)) {
    const b = h(doc, 'button', { class: `mode-item voice-item${e.current ? ' current' : ''}${e.state ? ` voice-${e.state}` : ' scope'}`, type: 'button', role: 'menuitem', 'data-voice': e.id, 'aria-disabled': String(e.disabled) }, h(doc, 'span', { class: 'mode-name' }, e.label), h(doc, 'span', { class: 'mode-note' }, e.note)) as unknown as HTMLButtonElement;
    b.disabled = e.disabled;
    menu.appendChild(b);
  }
  // V2e: Start / Stop voice and "Teach Gnomon your voice" (human connections only: clientMenuEntries is [] otherwise)
  for (const e of clientMenuEntries(clientOf(status), canAttach(status)))
    menu.appendChild(h(doc, 'button', { class: 'mode-item voice-item scope', type: 'button', role: 'menuitem', 'data-voice-client': e.id }, h(doc, 'span', { class: 'mode-name' }, e.label), h(doc, 'span', { class: 'mode-note' }, e.note)) as unknown as Node);
  if (canAttach(status)) {
    // dictation: the auto-send delay after silence (per machine)
    const picks = h(doc, 'span', { class: 'mode-item scope dictation-delays', role: 'group', 'aria-label': 'auto-send after silence' }, h(doc, 'span', { class: 'mode-name' }, 'Auto-send after')) as unknown as HTMLElement;
    for (const d of DELAY_CHOICES)
      picks.appendChild(h(doc, 'button', { class: `key quiet${d === dict.delayMs ? ' current' : ''}`, type: 'button', role: 'menuitemradio', 'aria-checked': String(d === dict.delayMs), 'data-dictation-delay': serializeDelay(d) }, delayLabel(d)) as unknown as Node);
    menu.appendChild(picks);
  }
  menu.appendChild(h(doc, 'span', { class: 'mode-note voice-keys' }, `hotkeys (voice app): hold ${v.hotkey} to talk · ⌃⌥H holds the dictation`) as unknown as Node);
}
function openVoiceMenu(): void {
  $('voice-menu').hidden = false;
  $('voice-pill').setAttribute('aria-expanded', 'true');
  paintVoiceMenu();
}
function closeVoiceMenu(): void {
  $('voice-menu').hidden = true;
  $('voice-pill').setAttribute('aria-expanded', 'false');
}

/** The focused session row's [Voice ▾] and, open, its two choices. */
function voiceRowEl(hsid: string, v: ReturnType<typeof voiceStatusOf>): HTMLElement {
  const here: VoiceState = v.state !== 'off' && v.hsid === hsid ? v.state : 'off';
  const kids: Node[] = [h(doc, 'button', { class: `key quiet voice-row-btn voice-${here}`, type: 'button', 'data-voice-row': hsid, 'aria-expanded': String(voiceRowOpen), title: 'Attach voice to this session' }, here === 'off' ? 'Voice ▾' : `Voice: ${VOICE_TITLE[here]} ▾`) as unknown as Node];
  if (voiceRowOpen)
    for (const s of ['ptt', 'ambient'] as const) {
      const pl = planVoice(v, s, hsid, voicePresenceDone);
      const b = h(doc, 'button', { class: `key quiet voice-choice voice-${s}${pl.kind === 'same' ? ' current' : ''}`, type: 'button', 'data-voice-set': s, 'data-voice-hsid': hsid, title: pl.kind === 'presence' ? 'needs Touch ID' : pl.kind === 'blocked' ? pl.reason : VOICE_TITLE[s] }, `${VOICE_TITLE[s]}${pl.kind === 'presence' ? ' · Touch ID' : ''}`) as unknown as HTMLButtonElement;
      b.disabled = pl.kind === 'blocked';
      kids.push(b as unknown as Node);
    }
  const row = h(doc, 'div', { class: 'voice-attach' }) as unknown as HTMLElement;
  for (const k of kids) row.appendChild(k);
  return row;
}

/**
 * One gesture sets voice (G-GUI-04: trusted events only). Off and a narrowing apply on the kernel's answer; the
 * first widening to ambient in this GUI login comes back as a pending presence card this same gesture approves
 * `allow` (the kernel asks for Touch ID), as a run-mode loosening does. A refusal is shown as given.
 */
async function setVoice(to: VoiceState, hsid: string | null, trusted: boolean): Promise<void> {
  if (!trusted) return;
  closeVoiceMenu();
  voiceRowOpen = false;
  if (!client) return notice('not connected: voice was not changed', true);
  if (!canAttach(status)) return notice('only a human connection attaches voice', true);
  const v = voiceStatusOf(status);
  const plan = planVoice(v, to, hsid, voicePresenceDone);
  if (plan.kind === 'blocked') return notice(`${VOICE_TITLE[to]} is not allowed: ${plan.reason}`, true);
  if (plan.kind === 'same') return;
  const req = voiceRequest(v, to, hsid);
  if (!req) return;
  if (voiceBusy) return;
  voiceBusy = true;
  try {
    // V2e seamless: attaching (or choosing Ambient) while the voice app is not running starts it in the same gesture
    if (to !== 'off' && needsStart(clientOf(status))) {
      await client.call('log.append', clientRequest('start'));
      notice('Starting voice…');
    }
    const r = await client.call<Record<string, unknown>>('log.append', req);
    if (r.pending === true && typeof r.cardId === 'string') {
      // Aegis L (V2d): approve in this gesture ONLY the voice-widen presence card for this session; else the stack decides
      if (!isVoiceWidenCard(store.cards.get(r.cardId), hsid)) {
        focusCard(r.cardId);
        notice(`Ambient for ${sessionName(hsid ?? '')}: decide the pending card in the stack`);
        return;
      }
      notice(`Ambient for ${sessionName(hsid ?? '')}: confirm with Touch ID`);
      try {
        await client.call('approve', { cardId: r.cardId, decision: 'allow' });
        voicePresenceDone = true;
        notice(null);
      } catch (err) {
        // the widen card (strictness, detail.op voice.widen) stays in the stack: focus it so the human can decide it there
        focusCard(r.cardId);
        notice(err instanceof RpcError ? `voice stays ${VOICE_TITLE[v.state].toLowerCase()}: ${voiceRefusalNote(err.refusal.reason, err.refusal.data) ?? refusalText(err.refusal)}` : `voice stays ${VOICE_TITLE[v.state].toLowerCase()}`, true);
      }
    } else {
      if (to === 'ambient') voicePresenceDone = true; // the kernel already held this login's presence
      notice(null);
    }
  } catch (err) {
    notice(err instanceof RpcError ? (voiceRefusalNote(err.refusal.reason, err.refusal.data) ?? refusalText(err.refusal)) : 'voice was not changed', true);
  } finally {
    voiceBusy = false;
    await refreshStatus();
  }
}

/* ── voice app lifecycle, enrolment, notices (V2e; core/voice-client.ts) ─ */
/** Start / Stop the voice app: one log.append request.voice.client{op} on a trusted gesture (human connections only). */
async function voiceClientOp(op: 'start' | 'stop', trusted: boolean): Promise<void> {
  if (!trusted) return;
  closeVoiceMenu();
  if (!client) return notice('not connected: the voice app was not changed', true);
  if (!canAttach(status)) return notice('only a human connection starts or stops the voice app', true);
  try {
    await client.call('log.append', clientRequest(op));
    notice(null);
  } catch (err) {
    notice(err instanceof RpcError ? refusalText(err.refusal) : `the voice app was not ${op === 'start' ? 'started' : 'stopped'}`, true);
  } finally {
    await refreshStatus();
  }
}

function openEnrol(trusted: boolean): void {
  if (!trusted) return;
  closeVoiceMenu();
  if (!canAttach(status)) return notice('only a human connection teaches Gnomon a voice', true);
  if (!store.enrol || store.enrol.step === 'done' || store.enrol.step === 'failed') store.enrol = enrolStart();
  $('enrol-dialog').hidden = false;
  paintEnrol();
  if (store.enrol.step === 'form') $('enrol-name').focus();
}

function paintEnrol(): void {
  syncEnrolPoll();
  const s = store.enrol;
  if (!s || $('enrol-dialog').hidden) return;
  const raw = $<HTMLInputElement>('enrol-name').value;
  const name = normalizeVoiceName(raw);
  put($('enrol-line'), enrolLine(s));
  const formStep = s.step === 'form' || s.step === 'failed';
  $('enrol-form-step').hidden = !formStep;
  put($('enrol-name-norm'), raw && name !== raw ? `saved as “${name}”` : '');
  put($('enrol-consent'), consentText(name || 'your name'));
  const phraseStep = s.step === 'waiting' || s.step === 'phrase';
  $('enrol-phrase-step').hidden = !phraseStep;
  if (phraseStep) {
    put($('enrol-progress'), s.step === 'waiting' ? 'The voice app is getting ready to listen…' : `Phrase ${s.index + 1} of ${s.phrases.length} · ${s.recorded} recorded`);
    put($('enrol-phrase'), s.step === 'phrase' ? `“${s.phrases[s.index] ?? ''}”` : '');
    $('enrol-rec').className = `enrol-rec${s.recording ? ' recording' : ''}`;
    put($('enrol-rec-label'), s.recording ? 'recording' : s.step === 'waiting' ? 'waiting' : 'get ready');
  }
  const go = $<HTMLButtonElement>('enrol-go');
  go.hidden = !(formStep || s.step === 'confirm');
  put(go, s.step === 'confirm' ? 'Confirm with Touch ID' : s.step === 'failed' ? 'Try again' : 'Continue');
  put($('enrol-cancel'), s.step === 'done' ? 'done' : s.step === 'confirm' ? 'cancel' : 'close');
  const list = $('enrol-list');
  clear(list);
  const enrolled = clientOf(status).enrolled;
  if (enrolled === null) list.appendChild(h(doc, 'p', { class: 'meta' }, 'this kernel does not list enrolled voices') as unknown as Node);
  else if (!enrolled.length) list.appendChild(h(doc, 'p', { class: 'meta' }, 'none yet: Gnomon forwards no speech until a voice is enrolled') as unknown as Node);
  else
    for (const n of enrolled)
      list.appendChild(h(doc, 'div', { class: 'enrol-voice' }, h(doc, 'span', null, n), h(doc, 'button', { class: 'key quiet', type: 'button', 'data-forget': n, 'data-armed': forgetArmed === n ? 'true' : 'false' }, forgetArmed === n ? `Forget ${n}? confirm` : 'Forget')) as unknown as Node);
}

/** The dialog's one button: send the request (form), or finish with Touch ID (confirm). Trusted gestures only. */
async function submitEnrol(trusted: boolean): Promise<void> {
  const s = store.enrol;
  if (!trusted || !s) return;
  if (!client) return notice('not connected: no voice was enrolled', true);
  if (!canAttach(status)) return notice('only a human connection teaches Gnomon a voice', true);
  if (s.step === 'form' || s.step === 'failed') {
    const v = enrolRequest($<HTMLInputElement>('enrol-name').value, $<HTMLInputElement>('enrol-agree').checked);
    if (!v.ok) return void put($('enrol-line'), v.reason);
    try {
      // the voice app records the phrases (it watches for this enrolment); start it first if it is not running
      if (needsStart(clientOf(status))) await client.call('log.append', clientRequest('start'));
      const r = await client.call<Record<string, unknown>>('log.append', v.req);
      store.enrol = enrolSent(s, (v.req.payload as { name: string }).name, typeof r.cardId === 'string' ? r.cardId : null);
    } catch (err) {
      store.enrol = { ...s, step: 'failed', error: err instanceof RpcError ? refusalText(err.refusal) : 'the request was not sent' };
    }
    return paintEnrol();
  }
  if (s.step !== 'confirm') return;
  const cardId = s.cardId ?? [...store.cards.values()].find((c) => isEnrolCard(c, s.name))?.cardId ?? null;
  if (!cardId) return void put($('enrol-line'), 'the Touch ID card has not arrived yet; it shows in the decisions pile when it does');
  put($('enrol-line'), 'Confirm with Touch ID…');
  try {
    await client.call('approve', { cardId, decision: 'allow' });
    // allowed: the kernel asks the voice app to record (status.voice.enrolment 'requested'); progress folds in
    store.enrol = enrolAllowed({ ...s, cardId }, Date.now());
  } catch (err) {
    focusCard(cardId);
    return void put($('enrol-line'), err instanceof RpcError ? `not enrolled yet: ${refusalText(err.refusal)}` : 'not enrolled yet');
  }
  paintEnrol();
  await refreshStatus();
}

/** Close the dialog; an enrolment whose card is still pending is cancelled by denying it (no Touch ID to say no). */
async function closeEnrol(trusted: boolean): Promise<void> {
  if (!trusted) return;
  const s = store.enrol;
  $('enrol-dialog').hidden = true;
  forgetArmed = null;
  store.enrol = null;
  syncEnrolPoll();
  if (client && s?.cardId && s.step === 'confirm') await client.call('approve', { cardId: s.cardId, decision: 'deny' }).catch(() => undefined);
}

let forgetArmed: string | null = null;
/** [Forget] asks once more in place, then sends request.voice.forget{name} (A2: no card; a forget narrows). */
async function forgetVoice(name: string, trusted: boolean): Promise<void> {
  if (!trusted || !client || !canAttach(status)) return;
  if (forgetArmed !== name) {
    forgetArmed = name;
    return paintEnrol();
  }
  forgetArmed = null;
  try {
    await client.call('log.append', forgetRequest(name));
  } catch (err) {
    notice(err instanceof RpcError ? refusalText(err.refusal) : `${name} was not forgotten`, true);
  }
  await refreshStatus();
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
/** A voice-app notice ("open Gnomon to turn on ambient") as a quiet toast; never a decision, never a backlog replay. */
function showToast(): void {
  const t = store.voiceToast;
  store.voiceToast = null;
  if (!t || !toastFresh(t.at, Date.now())) return;
  const el = $('voice-toast');
  put(el, t.text);
  el.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), TOAST_MS);
}

/* ── palette ────────────────────────────────────────────────────── */
let palSel = 0;
let palItems: Command[] = [];
function openPalette(prefix = ''): void {
  $('palette').hidden = false;
  const i = $<HTMLInputElement>('palette-input');
  i.value = prefix;
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
  else if (id.startsWith('mode.repo.') && (RUN_MODES as readonly string[]).includes(id.slice(10))) void setMode(id.slice(10) as RunMode, 'repo', true);
  else if (id.startsWith('mode.') && (RUN_MODES as readonly string[]).includes(id.slice(5))) void setMode(id.slice(5) as RunMode, 'session', true);
  else if (id === 'voice.client.start') void voiceClientOp('start', true);
  else if (id === 'voice.client.stop') void voiceClientOp('stop', true);
  else if (id === 'voice.enrol') openEnrol(true);
  else if (id.startsWith('voice.delay.')) setDictationDelay(parseDelay(id.slice(12)));
  else if (id === 'voice.dictation.hold') dispatchDictation({ type: 'hold', hold: !dict.hold, now: Date.now() });
  else if (id.startsWith('voice.') && (VOICE_STATES as readonly string[]).includes(id.slice(6))) void setVoice(id.slice(6) as VoiceState, voiceTargetFor(id.slice(6) as VoiceState), true);
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
      const top = vp.scrollTop;
      const own = Math.abs(top - selfTop) < 1; // the page's own write echoing back: stickiness unchanged
      if (!own) follow.onScroll(isAtBottom(top, vp.clientHeight, vp.scrollHeight), top < lastTop - 0.5);
      lastTop = top;
      paintTranscript();
    },
    { passive: true },
  );
  // intent to read back unsticks BEFORE the next streamed paint can snap the view down
  const releaseUp = (): void => {
    if (!follow.shouldStick) return;
    follow.release();
    paintTranscript();
  };
  $('viewport').addEventListener('wheel', (e) => {
    if ((e as WheelEvent).deltaY < 0) releaseUp();
  }, { passive: true });
  let touchY = 0;
  $('viewport').addEventListener('touchstart', (e) => {
    touchY = (e as TouchEvent).touches[0]?.clientY ?? 0;
  }, { passive: true });
  $('viewport').addEventListener('touchmove', (e) => {
    const y = (e as TouchEvent).touches[0]?.clientY ?? touchY;
    if (y > touchY + 2) releaseUp(); // finger moves down ⇒ content scrolls up
    touchY = y;
  }, { passive: true });
  $('viewport').addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (k === 'ArrowUp' || k === 'PageUp' || k === 'Home') releaseUp();
  });
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
    const vr = (e.target as HTMLElement).closest('[data-voice-row], [data-voice-set]') as HTMLElement | null;
    if (vr) {
      if (vr.dataset.voiceSet) return void setVoice(vr.dataset.voiceSet as VoiceState, vr.dataset.voiceHsid ?? null, e.isTrusted);
      voiceRowOpen = !voiceRowOpen;
      return paintSessions();
    }
    const b = (e.target as HTMLElement).closest('[data-hsid]') as HTMLElement | null;
    if (b) focus(b.dataset.hsid || null);
  });
  $('session-search').addEventListener('input', paintSessions);
  const onCard = (e: Event): void => {
    const b = (e.target as HTMLElement).closest('[data-decision]') as HTMLElement | null;
    if (b && e.isTrusted) void decide(b.dataset.cardId!, b.dataset.decision!, b.closest('[data-card-id].card') as HTMLElement | null, b);
    const k = (e.target as HTMLElement).closest('[data-command]') as HTMLElement | null;
    if (k && e.isTrusted && BLOCK_SAFE_COMMANDS.has(k.dataset.command!)) run(k.dataset.command!);
  };
  $('stack').addEventListener('click', onCard);
  $('pinned').addEventListener('click', onCard);
  $('stack-scope').addEventListener('click', () => run('stack.scope.toggle'));
  $('composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = $<HTMLTextAreaElement>('composer-text');
    // Aegis M3: a dictated draft stays shown until the kernel took it (the reducer then sets what remains)
    const viaDictation = dictationOn() && dict.focusedHere && dict.parts.length > 0 && hasDraft(dict);
    void send(t.value);
    if (!viaDictation) t.value = '';
  });
  // dictation: typing in the composer, or clicking into a draft, holds it (never auto-send mid-edit)
  $('composer-text').addEventListener('input', () => {
    if (dictationOn() && dict.focusedHere) dispatchDictation({ type: 'userEdit', text: $<HTMLTextAreaElement>('composer-text').value, now: Date.now() });
  });
  $('composer-text').addEventListener('pointerdown', () => {
    if (dictationOn() && dict.focusedHere) dispatchDictation({ type: 'focusComposer', now: Date.now() });
  });
  $('composer-text').addEventListener('blur', () => dispatchDictation({ type: 'blurComposer', now: Date.now() }));
  $('dictation-hold').addEventListener('click', () => dispatchDictation({ type: 'hold', hold: !dict.hold, now: Date.now() }));
  $('dictation-send').addEventListener('click', () => dispatchDictation({ type: 'sendNow', now: Date.now() }));
  $('composer-text').addEventListener('keydown', (e) => {
    if (e.key === 'Tab' && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault(); // ⇧Tab cycles the run mode, as in Claude Code (§11.5)
      cycleMode(e.isTrusted);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $<HTMLFormElement>('composer').requestSubmit();
    }
  });
  $('new-session').addEventListener('click', () => run('session.new'));
  $('mode-btn').addEventListener('click', () => ($('mode-menu').hidden ? openModeMenu() : closeModeMenu()));
  $('mode-menu').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-mode], [data-mode-scope]') as HTMLButtonElement | null;
    if (!b || b.disabled) return;
    if (b.dataset.modeScope === 'repo') {
      // the repo scope: the same three choices in the palette (mode.repo.*), for every session of the repo with no mode of its own
      closeModeMenu();
      return openPalette('mode.repo.');
    }
    void setMode(b.dataset.mode as RunMode, 'session', e.isTrusted);
  });
  $('voice-pill').addEventListener('click', () => ($('voice-menu').hidden ? openVoiceMenu() : closeVoiceMenu()));
  $('voice-menu').addEventListener('click', (e) => {
    const dd = (e.target as HTMLElement).closest('[data-dictation-delay]') as HTMLElement | null;
    if (dd) return setDictationDelay(parseDelay(dd.dataset.dictationDelay!));
    const vc = (e.target as HTMLElement).closest('[data-voice-client]') as HTMLElement | null;
    if (vc) {
      const id = vc.dataset.voiceClient!;
      if (id === 'voice.enrol') return openEnrol(e.isTrusted);
      return void voiceClientOp(id === 'voice.client.stop' ? 'stop' : 'start', e.isTrusted);
    }
    const b = (e.target as HTMLElement).closest('[data-voice]') as HTMLButtonElement | null;
    if (!b || b.disabled) return;
    const id = b.dataset.voice!;
    if (id === 'voice.attach') {
      const v = voiceStatusOf(status);
      return void setVoice(v.state === 'off' ? 'ptt' : v.state, focused, e.isTrusted);
    }
    const to = id.slice(6) as VoiceState;
    void setVoice(to, voiceTargetFor(to), e.isTrusted);
  });
  // V2e: the pill's own action ([Start voice] · [Restart] · [Teach]) and the enrolment dialog
  $('voice-action').addEventListener('click', (e) => {
    const a = $('voice-action').dataset.action;
    if (a === 'enrol') return openEnrol(e.isTrusted);
    if (a === 'start' || a === 'restart') void voiceClientOp('start', e.isTrusted);
  });
  $('enrol-form').addEventListener('submit', (e) => {
    e.preventDefault();
    void submitEnrol(e.isTrusted);
  });
  $('enrol-name').addEventListener('input', () => paintEnrol());
  $('enrol-cancel').addEventListener('click', (e) => void closeEnrol(e.isTrusted));
  $('enrol-list').addEventListener('click', (e) => {
    const f = (e.target as HTMLElement).closest('[data-forget]') as HTMLElement | null;
    if (f) void forgetVoice(f.dataset.forget!, e.isTrusted);
  });
  $('voice-meter').addEventListener('animationend', () => $('voice-meter').classList.remove('kick'));
  document.addEventListener('click', (e) => {
    if (!$('voice-menu').hidden && !(e.target as HTMLElement).closest('.voice-wrap')) closeVoiceMenu();
  });
  document.addEventListener('click', (e) => {
    if ($('mode-menu').hidden) return;
    if (!(e.target as HTMLElement).closest('.mode-wrap')) closeModeMenu();
  });
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
  $('palette-btn').addEventListener('click', () => openPalette());
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
    } else if (e.key === 'Escape' && !$('mode-menu').hidden) {
      closeModeMenu();
    } else if (e.key === 'Escape' && !$('voice-menu').hidden) {
      closeVoiceMenu();
    } else if (e.key === 'Escape' && !$('enrol-dialog').hidden) {
      void closeEnrol(e.isTrusted);
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
  // TD-2026-10-19-063: the page that accepted an upgrade reloads once and reattaches with the single-use resume form
  const resumed = frag ? (clearRestarting(sessionStorage), null) : takeRestart(sessionStorage);
  if (frag) void attach({ launchToken: frag.launchToken }, frag.kernelPublicKey, frag.cwd !== undefined ? cwdHintOf(frag.cwd) : null);
  else if (resumed) void attach({ resumeToken: resumed.resumeToken }, resumed.kernelPublicKey);
  else showReconnect('This page has no GUI session (a reload, a restart or a token-less launch). Reconnect asks for your presence.');
}
