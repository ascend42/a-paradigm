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
 * themes + auto + reduced motion (the header Day / Night / Auto switch and the
 * Settings sheet, #gui-settings: ui/settings-sheet.ts over core/settings.ts),
 * the Shuttle view and /diag. Every string
 * reaches the DOM through core/render.ts as a text node.
 */
import { isCardDecidable, sanitizeDisplayText, VOICE_LIABILITY_ACK_HASH, VOICE_PRESET_IDS } from '@a-company/gnomon-contracts';
import { initialTeach, reduceTeach, TAKES_NEEDED, teachCommit, teachLine, TEACH_SUGGESTIONS, type TeachEvent, type TeachState } from '../core/send-word-teach.js';
import { ACK_TEXT, acked, attachSend, captureOf, CAPTURE_KEY, clampedFrom, CLAMP_CHIP, parseCapturePref, choosePreset, parsePreset, policyOf, PRESET_KEY, PRESET_LABELS, PRESET_NOTES, recordAck, sendWordOf } from '../core/voice-presets.js';
import { followLog, GnomonClient, GUI_CLIENT, gnomonPost, RpcError, webSocketTransport, type Session, type ShownRefusal } from '../core/client.js';
import { clearRestarting, markRestarting, noteResume, peekResumeKey, restarting, RESTART_GUIDANCE, RESTART_KEY_REFUSED, resumeRepinText, takeRestart, upgradeBannerOf, waitForOrigin } from '../core/restart.js';
import { applyPreset, BLOCK_SAFE_COMMANDS, filterCommands, paletteEntries, parseLayout, placeWorkshop, PRESETS, resolveMotion, resolveTheme, serializeLayout, togglePane, WORKSHOP_PLACES, type Command, type Layout, type ThemeChoice, type WorkshopPlace } from '../core/commands.js';
import { parseStaleMsg, STALE_CHANNEL, staleView, watchStale, type StaleState } from '../core/stale.js';
import { applyCwdHint, clearCwdHint, cwdHintOf, decidePin, type CwdHint, type CwdHintTarget, hostSurface, parseLaunchFragment, PIN_KEY } from '../core/launch.js';
import { rootRowsOf, approveParamsOf, askDetailOf, askNote, localNsOf, permissionTitleOf, prefixOptionsOf, cardFlags, cardVoiceOf, h, mdBlocks, mdInline, renderCard, stampWord, type AskPick, type MiniDoc, type MiniEl } from '../core/render.js';
import { base64UrlToBytes, keyIdOfSpki, verifiedDecisions } from '../core/server-sig.js';
import { Follow, isAtBottom } from '../core/follow.js';
import { choiceForKey, liveChoiceKey, pickChoice, renderChoices, replyChoices } from '../core/choices.js';
import { armStanding, decideRequest, OFFER_ARM_TTL_MS, openStep, slipViews, type OfferArm, type SlipView } from '../core/offers.js';
import { publisherDisplayOf } from '../core/mod-label.js';
import { renderOfferSlip, wireOfferSlips } from './offer-slip.js';
import { bindInlineRename, planRename, renameRequest, type RenameBinding } from '../core/rename.js';
import { chatItems, derivedTitle, durationText, foldActivity, groupHue, GuiStore, isLiveState, replyParts, rowOf, sessionFullTitle, sessionNote, sessionTitle, splitActivePast, UNSCOPED, type ChatItem, type FoldedItem, type Row } from '../core/store.js';
import { HeightIndex, visibleRange, WidthCache } from '../core/virtual.js';
import { changedBefore, hasLive, LiveTicker, liveText } from '../core/live-turn.js';
import { mountStandingFeed } from './standing-feed.js';
import { mountSettings } from './settings-sheet.js';
import { MOTION_KEY, parseMotion, parseTheme, settingsModel, THEME_KEY, themeSwitchEntries, unlockSeenOf } from '../core/settings.js';
import { kernelPrincipalOf, revokeRequest } from '../core/standing.js';
import { defaultScope, menuEntries, modeChip, modeLabel, modeRequest, nextRunMode, planFor, RUN_MODES, scopeEntries, sessionModeOf, type ModeScope, type RunMode } from '../core/modes.js';
import { captureDismiss, captureDisplayOf, capturePollMs, captureStatusOf, captureStep, freshCapture, type CaptureTrack, type GhostText } from '../core/capture.js';
import { CLIENT_POLL_MS, clientMenuEntries, clientOf, clientPillOf, clientPollWanted, clientRequest, consentText, stopSpeakingRequest, devBannerOf, enrolLine, enrolAllowed, ENROL_POLL_MS, enrolRequest, enrolSent, enrolStart, forgetRequest, isEnrolCard, needsStart, normalizeVoiceName, noticeOf, reduceEnrolStatus, toastFresh, TOAST_MS } from '../core/voice-client.js';
import { DELAY_CHOICES, DELAY_KEY, DICTATION_POLL_MS, delayLabel, dictationNote, dictationStatusOf, draftControls, hasDraft, initialDictation, liveLine, parseDelay, pieceFraction, reduceDictation, ringFraction, ringRemaining, sendClaim, sendRequest, serializeDelay, type DictationEvent } from '../core/dictation.js';
import { modPanelsFocus, modPanelsStatus, mountModPanels } from './mod-panels-mount.js';
import { mountMods } from './mods-panel.js';
import { mountModelPicker, type ModelPicker } from './model-picker.js';
import { sessionModelOf, sessionModelText } from '../core/model-picker.js';
import { canAttach, cardNoticeStep, escStopsSpeaking, isVoiceWidenCard, SPEAK_POLL_MS, SPEAK_WATCH_MS, speakPollWanted, stopSpeakingShown, pillOf, planVoice, sessionName, voiceMenuEntries, voiceRefusalNote, voiceRequest, voiceStatusOf, VOICE_STATES, VOICE_TITLE, type VoiceState } from '../core/voice.js';

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
let modPanelRow: (row: { kind?: unknown } | null) => void = () => undefined; // K0 mod panels hook
let stackScoped = false;
let theme: ThemeChoice = 'auto';
let motion: 'reduce' | 'system' = 'system';
const LAYOUT_KEY = 'gnomon.gui.layout';
let layout: Layout = parseLayout(localStorage.getItem(LAYOUT_KEY) ?? '') ?? applyPreset('desk'); // S5.2: persisted per browser
const local: Row[] = []; // this page's own composer lines (memory only)
let localRev = 0; // review M1: bumped when a local row is stamped or marked unsent in place (the memo key reads it)
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

/** The pending card a "decide the pending card in the stack" notice names (core/voice.ts cardNoticeStep, T-2026-10-20-002). */
let noticeCard: { cardId: string; seen: boolean } | null = null;
/** #gui-model-picker (ui/model-picker.ts), mounted below; null until then */
let modelPicker: ModelPicker | null = null;
function notice(msg: string | null, fail = false): void {
  noticeCard = null; // any new notice (or a clear) replaces the card's
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
  // #gui-settings: the header switch shows the choice (auto names what it resolves to now)
  const sw = document.getElementById('theme-switch');
  if (sw)
    for (const e of themeSwitchEntries(theme, darkQ.matches)) {
      const b = sw.querySelector(`[data-run="${e.run}"]`) as HTMLElement | null;
      if (!b) continue;
      b.setAttribute('aria-checked', String(e.current));
      b.classList.toggle('current', e.current);
      b.title = e.title;
    }
}
/** #gui-settings: a presentation preference kept per browser (a private window may refuse storage: it still applies). */
function keep(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* not kept; applied for this page */
  }
}
function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
darkQ.addEventListener('change', () => (applyLook(), settings.repaint()));
motionQ.addEventListener('change', () => (applyLook(), settings.repaint()));

function applyLayout(): void {
  const d = document.querySelector('.desk')!;
  d.classList.toggle('no-sessions', !layout.visible.sessions);
  d.classList.toggle('no-stack', !layout.visible.stack);
  d.classList.toggle('stack-wide', layout.stackWide);
  // S5.2: the Workshop host sits in the footer (default) or in the 76 px column on either edge; under 900 px
  // (the drawer layout) it is always the footer. The voice indicator and the other kernel-owned regions are not here.
  const place: WorkshopPlace = narrowQ.matches ? 'footer' : layout.workshop;
  const show = layout.visible.workshop;
  const host = $('workshop-host');
  const col = $('workshop-col');
  const foot = $('pane-workshop');
  if (place === 'footer') {
    if (host.parentElement !== foot) foot.insertBefore(host, foot.firstChild);
  } else if (host.parentElement !== col) col.appendChild(host);
  col.hidden = !show || place === 'footer';
  d.classList.toggle('ws-left', show && place === 'left');
  d.classList.toggle('ws-right', show && place === 'right');
  foot.classList.toggle('slim', place !== 'footer');
  foot.hidden = !show;
  try {
    localStorage.setItem(LAYOUT_KEY, serializeLayout(layout));
  } catch {
    /* a private window may refuse storage: the layout still applies */
  }
}
const narrowQ = matchMedia('(max-width: 900px)');
narrowQ.addEventListener('change', () => applyLayout());

/* ── transcript (virtualized chat) ───────────────────────────────── */
const widths = new WidthCache(22);
let heights = new HeightIndex(22);
let width = 0;
let items: ChatItem[] = [];
let hiddenRows = 0;
let rawMode = false; // "show raw events": every row as its one-line summary
let feedView = false; // S2.3: the kernel feed is a palette view (view.kernel-feed), never the default centre
const expandedActs = new Set<string>(); // S2.5: activity lines the human expanded (keys are stable per transcript)
const PAST_KEY = 'gnomon.gui.pastOpen';
let pastOpen = localStorage.getItem(PAST_KEY) === '1'; // S2.2: Past is collapsed by default; the toggle persists per browser
const follow = new Follow(); // stickiness: core/follow.ts (unit-tested)
const mounted = new Map<number, HTMLElement>();
let memo: { key: string; out: { items: ChatItem[]; hidden: number } } | null = null;

const transcriptId = (): string => `${focused ?? (feedView ? 'feed' : 'empty')}${rawMode ? '\u0000raw' : ''}`;

function currentItems(): { items: ChatItem[]; hidden: number } {
  // S2.3: nothing focused and the kernel feed view not open ⇒ the quiet empty centre, no rows
  if (!focused && !feedView) return { items: [], hidden: 0 };
  const base = focused ? store.transcript(focused) : store.kernelFeed;
  const mine = local.filter((r) => (r.session ?? null) === focused);
  // T-2026-10-21-007: a running turn shows its working row only while the session is live (a kernel restart ends it)
  const live = !!focused && isLiveState(store.sessions.get(focused)?.state ?? 'seen');
  const key = `${transcriptId()}\u0000${base.length}\u0000${mine.length}.${localRev}\u0000${store.logId ?? ''}\u0000${[...expandedActs].join(',')}\u0000${live}`;
  if (memo?.key === key) return memo.out;
  const rows = mine.length ? [...base, ...mine].sort((a, b) => a.seq - b.seq) : base;
  // the kernel feed has no conversation: it stays the raw row list
  const raw = rawMode || !focused;
  const base2 = chatItems(rows, { raw, live });
  // S2.5: tool and auto rows fold into one activity line (raw mode and the kernel feed never fold)
  const out = raw ? base2 : { items: foldActivity(base2.items, expandedActs), hidden: base2.hidden };
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
  paintChatHead();
  $('raw-toggle').hidden = !focused;
  $('more-btn').hidden = !focused && !feedView;
  closeMoreMenu();
  put($('raw-toggle'), rawMode ? 'chat' : 'raw');
  $('raw-toggle').title = rawMode ? 'Back to the chat view' : 'Show raw events (every row as its one-line summary)';
  paintTranscript();
}

/** S2.4: the chat header (session name in the title font; ■ project · backend · started HH:MM · elapsed) and the
 * quiet empty centre when nothing is focused and the kernel feed view is not open. */
function paintChatHead(): void {
  const s = focused ? store.sessions.get(focused) : undefined;
  const title = s ? sessionTitle(s) : focused ? focused.slice(-10) : feedView ? 'kernel feed' : 'No session open';
  put($('transcript-title'), title);
  // #gui-session-rename: the full title (the truncation stays) and the hsid in the tooltip; ✎ renames
  $('transcript-title').title = s ? `${sessionFullTitle(s)}\n${s.hsid}${s.name ? '' : '\n(double-click to rename)'}` : (focused ?? '');
  if (renaming?.where !== 'head') $('rename-btn').hidden = !s;
  const meta = $('chead-meta');
  clear(meta);
  if (s) {
    const g = store.groups().find((x) => x.sessions.some((y) => y.hsid === s.hsid));
    const hue = groupHue(s.repo ?? UNSCOPED, g?.sessions ?? [s]);
    const started = s.openedAt ? s.openedAt.slice(11, 16) : '';
    const mins = s.openedAt ? Math.max(0, Math.round((Date.now() - Date.parse(s.openedAt)) / 60_000)) : null;
    meta.appendChild(h(doc, 'span', { class: `pink h${hue}` }, '■ ', s.repo && s.repo !== UNSCOPED ? s.repo : 'unscoped') as unknown as Node);
    meta.appendChild(document.createTextNode(` · ${s.backend ?? 'claude'}`));
    modelPicker?.headChip(meta, s.hsid); // #gui-model-picker: the kernel's model for this session, ▾ to switch
    // TD-2026-10-21-514: while a voice-origin turn is open, the header says edits ask first (the kernel clamps it)
    if (clampedFrom(store.transcript(s.hsid), s.hsid)) meta.appendChild(h(doc, 'span', { class: 'clamp-chip', role: 'status' }, CLAMP_CHIP) as unknown as Node);
    meta.appendChild(document.createTextNode(`${started ? ` · started ${started}` : ''}${mins !== null && Number.isFinite(mins) ? ` · ${mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`}` : ''}`));
  }
  const t = s ? sessionTitle(s) : '';
  $<HTMLTextAreaElement>('composer-text').placeholder = s ? `Reply to ${t}${t.endsWith('…') ? '' : '…'}` : 'Open a session to write to it';
  const empty = $('empty');
  empty.hidden = !!focused || feedView;
  if (!empty.hidden) put($('empty-meta'), `${store.liveCount()} live · ${store.cards.size} need you`);
}

const ROLE_LABEL: Partial<Record<ChatItem['role'], string>> = { user: 'you', assistant: 'claude' };
/** table talk: an assistant body whose lines start with a bold label (the agent's own A/B/C, 1/2/3 or names) shows those lines as chips. */
function replyBody(it: ChatItem): MiniEl {
  // S2.5: agent text renders a SAFE markdown subset (DOM nodes only, never markup); the user's words stay verbatim
  if (it.role !== 'assistant') return h(doc, 'div', { class: 'body' }, it.text);
  // #gui-table-talk: trailing lettered options render as choice chips (core/choices.ts), live on the latest reply only
  const ch = replyChoices(it.text, it.said ?? null);
  const text = ch ? ch.body : it.text;
  const parts = replyParts(text);
  const chips = ch ? renderChoices(doc, it.key, ch.choices, { live: it.key === liveChoice, picked: pickedChoices.get(it.key) ?? null, armed: armedChoice?.item === it.key ? armedChoice.key : null }) : null;
  if (!parts.some((x) => 'label' in x)) return h(doc, 'div', { class: 'body md' }, ...mdBlocks(doc, text), chips);
  return h(doc, 'div', { class: 'body md' }, ...parts.map((x) => ('label' in x ? h(doc, 'div', { class: 'chip' }, h(doc, 'strong', { class: 'chip-label' }, x.label), ' ', ...mdInline(doc, x.text)) : h(doc, 'div', { class: 'plain' }, ...mdBlocks(doc, x.text)))), chips);
}
/** #gui-table-talk choices: the live reply's item key, and each reply's picked option (this page only). */
let liveChoice: string | null = null;
const pickedChoices = new Map<string, string>();
/** Aegis M1: the chip waiting for its confirming second activation; L2: the pick riding the composer submit */
let armedChoice: { item: string; key: string } | null = null;
let pendingPick: { item: string; key: string } | null = null;
/** Repaint one transcript item (its chips changed state). */
function remountItem(key: string | null): void {
  if (key === null) return;
  for (const [i, el] of mounted)
    if (items[i]?.key === key) {
      el.remove();
      mounted.delete(i);
    }
}
/** A chip pick: through the composer (send when empty, insert after a draft), only on a trusted gesture. */
function onChoice(e: Event, b: HTMLElement): void {
  const itemKey = b.dataset.choiceItem ?? '';
  const pick = b.dataset.choice ?? '';
  if (b.hasAttribute('disabled')) return;
  // Aegis L3: liveness from the current store, never a cached paint
  const cur = currentItems().items;
  const it = cur.find((x) => x.key === itemKey);
  if (!it) return;
  const ta = $<HTMLTextAreaElement>('composer-text');
  const armed = armedChoice?.item === itemKey && armedChoice.key === pick;
  const out = pickChoice(e, { itemKey, liveKey: focused && !rawMode ? liveChoiceKey(cur) : null, replyText: it.text, said: it.said ?? null, choiceKey: pick }, {
    get value() {
      return ta.value;
    },
    set value(v: string) {
      ta.value = v;
    },
    dictationDraft: dictationOn() && dict.focusedHere && hasDraft(dict),
    // THE send path: the composer form's submit, exactly as typing and pressing send
    submit: () => {
      pendingPick = { item: itemKey, key: pick };
      $<HTMLFormElement>('composer').requestSubmit();
    },
    focus: () => ta.focus(),
  }, armed);
  if (out === 'refused') return;
  const was = armedChoice?.item ?? null;
  armedChoice = out === 'confirm' ? { item: itemKey, key: pick } : null;
  if (out === 'inserted') {
    if (dictationOn() && dict.focusedHere) dispatchDictation({ type: 'userEdit', text: ta.value, now: Date.now() });
    notice('the option is in the composer after your draft; nothing was sent');
  }
  remountItem(was);
  remountItem(itemKey);
  paintTranscript();
  if (out === 'confirm') ($('viewport').querySelector(`.choices.live [data-choice-item="${CSS.escape(itemKey)}"][data-choice="${CSS.escape(pick)}"]`) as HTMLElement | null)?.focus();
}
function itemEl(it: FoldedItem): HTMLElement {
  if (it.role === 'activity') {
    const open = expandedActs.has(it.key);
    // T-2026-10-21-007: the running turn's activity line counts live (the ticker rewrites only its .live-clock span)
    const clock = it.live ? h(doc, 'span', { class: 'live-clock' }, liveText(it, Date.now())) : null;
    return h(doc, 'div', { class: `trow role-activity${open ? ' open' : ''}${it.live ? ' live' : ''}`, role: 'button', tabindex: '0', 'aria-expanded': String(open), 'data-act': it.key, title: open ? 'Hide the steps' : 'Show the steps' }, `${open ? '▾' : '▸'} ${it.text}`, clock) as unknown as HTMLElement;
  }
  if (it.role === 'working') {
    // a11y: one status ("Claude is working"); the ticking clock is not announced every second (aria-live off)
    return h(doc, 'div', { class: 'trow role-working', role: 'status', 'aria-label': 'Claude is working' }, h(doc, 'span', { class: 'spin', 'aria-hidden': 'true' }), h(doc, 'span', { class: 'live-clock', 'aria-live': 'off' }, liveText(it, Date.now()))) as unknown as HTMLElement;
  }
  const label = it.role === 'user' && it.voice === 'voice-edited' ? `🎙✎ ${it.speaker ?? 'you'}` : it.speaker !== undefined && it.role === 'user' ? `🎙 ${it.speaker}` : ROLE_LABEL[it.role];
  const at = it.at ? it.at.slice(11, 16) : '';
  // TD-2026-10-21-514: "spoken · sent by you / on release / by send word / as a piece" (+ "edits ask first")
  const sentBy = it.sentLabel ? h(doc, 'span', { class: `sent-by${it.asksFirst ? ' asks-first' : ''}` }, `${it.sentLabel}${it.asksFirst ? ' · edits ask first' : ''}`) : null;
  const body = label
    ? [h(doc, 'div', { class: 'who' }, label, sentBy, h(doc, 'span', { class: 't' }, at), it.took !== undefined ? h(doc, 'span', { class: 'took' }, `took ${durationText(it.took)}`) : null), ...(it.said !== undefined ? [h(doc, 'div', { class: 'said' }, h(doc, 'span', { class: 'said-tag' }, it.saidBy === 'kernel' ? '🔊 said aloud' : '🗣 spoken part'), ' ', it.said)] : []), replyBody(it)]
    : it.role === 'raw'
      ? [h(doc, 'span', { class: 't' }, at), it.text]
      : [it.text];
  const slips = slipsAt.get(it.key) ?? [];
  return h(doc, 'div', { class: `trow role-${it.role}${it.speaker !== undefined ? ' voice' : ''}` }, ...body, ...slips.map((v) => slipEl(v))) as unknown as HTMLElement;
}

/* ── #gui-offer-slip (TD-2026-10-20-812 O1): the margin slips under the reply that offered (core/offers.ts) ── */
/** the slips by the reply item they mount under; the live slip; the slip armed by a first trusted press (A5) */
let slipsAt = new Map<string, SlipView[]>();
const slipSig = new Map<string, string>();
let liveOffer: string | null = null;
let armedOffer: OfferArm | null = null;
let armTimer: ReturnType<typeof setTimeout> | null = null;
declare const __GNOMON_PREVIEW__: boolean;
/** L1: a heard "open" shows a hint; a heard "not now" dismisses once (this page's request) */
const voiceDismissed = new Set<string>();
/** rows up to here were backlog: their slips paint without the slide-in */
let offerLiveSince = Number.POSITIVE_INFINITY;
/** DEV ONLY (#gui-preview offer-armed): devArmOfferOnce() asked for the live slip painted armed; the served main.ts never does */
let devArmOffer = false;
function slipEl(v: SlipView): MiniEl {
  return renderOfferSlip(doc, v, { armed: armStanding(armedOffer, v.slip.offerId, Date.now()), voiceHint: v.slip.openHint, ambientHint: v.slip.ambientHint, arrive: v.live && v.slip.seq > offerLiveSince, publisher: publisherDisplayOf(status, v.slip.mod) });
}
/** Recompute the slips from the store (never from reply text) and remount the replies whose slips changed. */
function syncSlips(cur: readonly ChatItem[]): void {
  const views = focused && !rawMode ? slipViews(store.offers(focused), cur) : [];
  const next = new Map<string, SlipView[]>();
  for (const v of views) next.set(v.itemKey, [...(next.get(v.itemKey) ?? []), v]);
  const live = views.find((v) => v.live)?.slip.offerId ?? null;
  if (live !== liveOffer || (armedOffer && !armStanding(armedOffer, armedOffer.offerId, Date.now()))) armedOffer = null; // newer reply, human message, decision or TTL
  liveOffer = live;
  if (__GNOMON_PREVIEW__ && devArmOffer && live) {
    armedOffer = { offerId: live, at: Date.now() - OFFER_ARM_TTL_MS / 2 };
    devArmOffer = false;
  }
  slipsAt = next;
  const keys = new Set([...next.keys(), ...slipSig.keys()]);
  for (const k of keys) {
    const sig = (next.get(k) ?? []).map((v) => `${v.slip.offerId}:${v.slip.decided}:${v.slip.retired}:${v.live}:${armedOffer?.offerId === v.slip.offerId}:${v.slip.openHint}:${v.slip.ambientHint}`).join('|');
    if ((slipSig.get(k) ?? '') !== sig) remountItem(k);
    if (sig) slipSig.set(k, sig);
    else slipSig.delete(k);
  }
}
/** Open / not now on the live slip: trusted only (wireOfferSlips), liveness from the current store. */
function onOfferAct(act: 'open' | 'not-now', offerId: string, e: Event): void {
  syncSlips(currentItems().items);
  if (act === 'not-now') {
    if (!e.isTrusted || offerId !== liveOffer) return;
    return void sendOfferDecision(offerId, 'not-now');
  }
  const now = Date.now();
  const step = openStep({ isTrusted: e.isTrusted, repeat: (e as KeyboardEvent).repeat, detail: e.type === 'click' ? (e as MouseEvent).detail : undefined }, offerId, liveOffer, armedOffer, now);
  if (step === 'refused' || step === 'wait') return;
  if (step === 'armed') {
    armedOffer = { offerId, at: now };
    if (armTimer) clearTimeout(armTimer);
    armTimer = setTimeout(() => paintTranscript(), OFFER_ARM_TTL_MS + 50); // Aegis M1/L2: the arm lapses visibly
    paintTranscript();
    ($('viewport').querySelector(`.slip.live[data-offer="${CSS.escape(offerId)}"] .slip-open`) as HTMLElement | null)?.focus();
    return;
  }
  armedOffer = null;
  void sendOfferDecision(offerId, 'open');
}
async function sendOfferDecision(offerId: string, decision: 'open' | 'not-now'): Promise<void> {
  if (!client) return notice('not connected: nothing was sent', true);
  try {
    await client.call('log.append', decideRequest(offerId, decision));
  } catch (err) {
    notice(err instanceof RpcError ? refusalText(err.refusal) : 'the offer decision was not sent', true);
  }
  paintTranscript();
}
/** L1 voice / Aegis M2: a LIVE push-to-talk "not now" (the fold checks ptt, forwardable, not intercepted, and that
 * the slip was live when the row arrived) dismisses once per offer; never a row from the backlog. */
function offerVoiceRow(r: Row): void {
  if (r.kind !== 'voice.turn.user' || !(r.seq > offerLiveSince)) return;
  const hsid = r.session ?? null;
  if (!hsid) return;
  const s = store.offers(hsid).slips.find((x) => x.voiceDismiss === r.seq && x.decided === null && !x.retired);
  if (s && !voiceDismissed.has(s.offerId)) {
    voiceDismissed.add(s.offerId);
    void sendOfferDecision(s.offerId, 'not-now');
  }
}

/** How many leading items keep their key (T-2026-10-21-007: a result or working row placed above a waiting message changes only the tail). */
const commonPrefix = (a: readonly ChatItem[], b: readonly ChatItem[]): number => {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i]!.key === b[i]!.key) i++;
  return i;
};

/** T-2026-10-21-007: one interval while the focused transcript has a running turn; each tick rewrites the mounted clocks only. */
const liveTicker = new LiveTicker(() => {
  const now = Date.now();
  for (const [i, el] of mounted) {
    const it = items[i];
    if (!it?.live) continue;
    const c = el.querySelector('.live-clock') as HTMLElement | null;
    if (c) put(c, liveText(it, now));
  }
});

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
  const lcp = remeasure ? 0 : commonPrefix(items, next);
  if (remeasure || (lcp === 0 && items.length > 0)) {
    unmountAll();
    heights = widths.restore(transcriptId(), width, next.length);
  } else {
    // review H1: a kept item that changed in place (the activity line frozen when the reply lands, a 🔊 marker
    // folding its later sentences) is repainted in BOTH branches, so nothing before the changed tail stays stale
    const stale = new Set(changedBefore(items, next, lcp));
    for (const [i, el] of mounted)
      if (i >= lcp || stale.has(i)) {
        el.remove();
        mounted.delete(i);
      }
    // re-review L-4: a stale kept item is remounted with new content: its old measured height no longer holds
    for (const i of stale) if (i < lcp) heights.invalidate(i);
    if (lcp < items.length) {
      // the tail changed (a turn's result anchored under its turn, the working row moving down): keep the prefix
      // mounted and measured, rebuild only from the first changed item
      heights.truncate(lcp);
      heights.push(next.length - lcp);
      appended = Math.max(0, next.length - items.length);
    } else {
      appended = next.length - items.length;
      if (appended > 0) heights.push(appended);
    }
  }
  items = next;
  hiddenRows = hidden;
  const live = focused && !rawMode ? liveChoiceKey(items) : null;
  if (live !== liveChoice) {
    remountItem(liveChoice);
    liveChoice = live;
    remountItem(live);
  }
  syncSlips(items);
  liveTicker.sync(hasLive(items));
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
  put($('transcript-count'), !focused && !feedView ? '' : focused && !rawMode ? `${items.length} items${hiddenRows ? ` · ${hiddenRows} raw hidden` : ''}` : `${items.length} rows`);
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
/** S2.2 / fidelity 2: the rail as the comp: ACTIVE n, then ONE line per session (12px swatch in the project hue · name
 * (sessionTitle) · right-aligned state note), grouped by project order but with no heading rows; then ▸ PAST n
 * (collapsed by default). Voice attaches from the header pill's menu (never a rail row). The kernel feed is a palette view. */
function sessionRowEl(s: ReturnType<GuiStore['groups']>[number]['sessions'][number], hue: number): HTMLElement {
  const was = lastState.get(s.hsid);
  lastState.set(s.hsid, s.state);
  if (s.state === 'failed' && was !== undefined && was !== 'failed') drooped.add(s.hsid);
  const knot = [...store.cards.values()].some((c) => c.hsid === s.hsid && /knot/.test(c.kind));
  const note = sessionNote({ ...s, knot });
  const vv = voiceStatusOf(status);
  const mic = vv.state !== 'off' && vv.hsid === s.hsid ? (vv.state === 'ambient' ? '🎙 ' : '🎙 ptt ') : '';
  return h(
    doc,
    'button',
    { class: `session-row sess state-${s.state}${isLiveState(s.state) ? ' live' : ' gone'}${focused === s.hsid ? ' active' : ''}${drooped.has(s.hsid) ? ' fx' : ''}`, type: 'button', 'data-hsid': s.hsid, title: `${s.hsid}${s.backend ? ` · ${s.backend}` : ''}` },
    h(doc, 'span', { class: `swatch h${hue}` }),
    h(doc, 'span', { class: 'sname' }, sessionTitle(s)),
    h(doc, 'span', { class: `snote tone-${note.tone}` }, `${mic}${note.text}`),
  ) as unknown as HTMLElement;
}
function paintSessions(): void {
  // #gui-session-rename: a list rename holds the rail still (a repaint would drop the input); it repaints on settle
  if (renaming?.where === 'list') return void (sessionsDirty = true);
  const list = $('session-list');
  clear(list);
  const q = ($('session-search') as HTMLInputElement).value.trim().toLowerCase();
  const groups = store.groups().map((g) => ({ ...g, hue: groupHue(g.repo, g.sessions), sessions: g.sessions.filter((s) => !q || s.hsid.toLowerCase().includes(q) || g.repo.toLowerCase().includes(q) || sessionTitle(s).toLowerCase().includes(q)) }));
  const active = groups.map((g) => ({ ...g, sessions: splitActivePast(g.sessions).active })).filter((g) => g.sessions.length);
  const past = groups.flatMap((g) => splitActivePast(g.sessions).past.map((s) => ({ s, hue: g.hue }))).sort((a, b) => b.s.lastSeq - a.s.lastSeq);
  const nActive = active.reduce((n, g) => n + g.sessions.length, 0);
  list.appendChild(h(doc, 'div', { class: 'sec-head' }, h(doc, 'span', null, 'Active'), h(doc, 'span', null, String(nActive))) as unknown as Node);
  for (const g of active) for (const s of g.sessions) list.appendChild(sessionRowEl(s, g.hue));
  list.appendChild(h(doc, 'button', { class: 'sec-head sec-toggle', type: 'button', 'data-past-toggle': '1', 'aria-expanded': String(pastOpen) }, h(doc, 'span', null, `${pastOpen ? '▾' : '▸'} Past`), h(doc, 'span', null, String(past.length))) as unknown as Node);
  if (pastOpen) for (const { s, hue } of past) list.appendChild(sessionRowEl(s, hue));
}

/* ── #gui-session-rename: inline rename (header, session list, palette) ── */
let renaming: { hsid: string; where: 'head' | 'list'; binding: RenameBinding } | null = null;
let sessionsDirty = false;
/** Open the inline name input for a session (a trusted gesture only). Enter / blur save, Esc cancels (core/rename.ts). */
function startRename(hsid: string | null, where: 'head' | 'list', trusted: boolean): void {
  const s = hsid ? store.sessions.get(hsid) : undefined;
  if (!trusted || !s || renaming) return;
  let input: HTMLInputElement;
  if (where === 'head') {
    input = $<HTMLInputElement>('rename-input');
    $('transcript-title').hidden = true;
    $('rename-btn').hidden = true;
    input.hidden = false;
  } else {
    const row = $('session-list').querySelector(`[data-hsid="${CSS.escape(s.hsid)}"]`);
    if (!row) return;
    input = h(doc, 'input', { class: 'field rename-input', type: 'text', 'aria-label': `Rename session ${sessionTitle(s)}`, maxlength: '160', spellcheck: 'false', autocomplete: 'off' }) as unknown as HTMLInputElement;
    const swatch = row.querySelector('.swatch')?.cloneNode(true) ?? null;
    row.replaceWith(h(doc, 'div', { class: `${row.className} renaming`, 'data-renaming': s.hsid }, swatch as never, input as never) as unknown as Node);
  }
  input.value = s.name ?? '';
  input.placeholder = derivedTitle(s);
  const current = s.name ?? null;
  const done = (): void => {
    renaming = null;
    if (where === 'head') {
      input.hidden = true;
      $('transcript-title').hidden = false;
    }
    const dirty = sessionsDirty || where === 'list'; // the list input row is replaced by a fresh paint
    sessionsDirty = false;
    if (dirty) paintSessions();
    paintChatHead();
  };
  const binding = bindInlineRename(input, {
    onSave: (v) => {
      done();
      void saveRename(s.hsid, current, v);
    },
    onCancel: done,
  });
  renaming = { hsid: s.hsid, where, binding };
  input.focus();
  input.select();
}
/** Send the rename (the kernel normalises again; the name shows once its session.renamed row arrives). */
async function saveRename(hsid: string, current: string | null, typed: string): Promise<void> {
  const plan = planRename(current, typed);
  if (plan.kind === 'none') return;
  if (plan.kind === 'refuse') return notice(plan.note, true);
  if (!client) return notice('not connected: the name was not changed', true);
  try {
    await client.call('log.append', renameRequest(hsid, plan.name));
    notice(null);
  } catch (err) {
    notice(err instanceof RpcError ? refusalText(err.refusal) : 'the name was not changed', true);
  }
}

/* ── decision stack ─────────────────────────────────────────────── */
const PILE_MAX = 6;
const RELAYOUT_GUARD_MS = 300;
let stackLaidOutAt = -Infinity;
let pileOpen = false;
/** S3: a card's project line: its repo basename in the ONE project hue (the rail's group hue for that repo). */
function projectOfCard(c: { repo: string | null; hsid: string | null }): { name: string; hue: number } | null {
  const repo = c.repo ?? (c.hsid ? (store.sessions.get(c.hsid)?.repo ?? null) : null);
  if (!repo) return null;
  const g = store.groups().find((x) => x.repo === repo);
  return { name: repo.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || repo, hue: groupHue(repo, g?.sessions ?? []) };
}
/**
 * S4 motion: a card the human approved (the kernel accepted it; never on a refusal) stamps the decision it took (stampWord), then flies off
 * 550 ms later and is removed on its flyout's animationend. While it leaves it is kept out of fresh paints (no
 * duplicate) and re-inserted at its place. Reduced motion (in-app or the OS): removed at once, nothing waits on an
 * animation that never runs. A 1.5 s fallback removes it even if animationend never fires (a hidden tab).
 */
const departing = new Map<string, Array<{ el: HTMLElement; parent: HTMLElement; index: number }>>();
function motionReduced(): boolean {
  return document.documentElement.dataset.motion === 'reduced' || motionQ.matches;
}
function settleDeparture(cardId: string): void {
  const d = departing.get(cardId);
  if (!d) return;
  departing.delete(cardId);
  for (const x of d) x.el.remove();
  void paintStack();
}
function flyOff(cardId: string, decision: string): void {
  const els = [...document.querySelectorAll<HTMLElement>(`.card[data-card-id="${CSS.escape(cardId)}"]`)];
  if (!els.length || motionReduced()) return;
  departing.set(cardId, els.map((el) => ({ el, parent: el.parentElement as HTMLElement, index: Array.prototype.indexOf.call(el.parentElement?.children ?? [], el) })));
  for (const el of els) {
    // Aegis S4 low (2): a leaving card takes no keyboard: drop focus out of it and make it inert
    if (el.contains(document.activeElement)) (document.activeElement as HTMLElement | null)?.blur();
    el.inert = true;
    el.classList.add('leaving');
    const st = el.querySelector('.stamp');
    if (st) {
      st.textContent = stampWord(decision); // Aegis S4 low (1): the decision the kernel accepted
      st.classList.add('on');
    }
  }
  setTimeout(() => {
    for (const el of els) {
      el.classList.add('out');
      el.addEventListener('animationend', (e) => {
        if ((e as AnimationEvent).animationName === 'flyout') settleDeparture(cardId);
      });
    }
  }, 550);
  setTimeout(() => settleDeparture(cardId), 1500);
}
/** S4 droop: a session that flips to failed in this page's view droops once (never a shake). */
const lastState = new Map<string, string>();
const drooped = new Set<string>();

async function paintStack(arrived: Set<string> = new Set()): Promise<void> {
  const focusRepo = focused ? (store.sessions.get(focused)?.repo ?? null) : null;
  const cards = (stackScoped && focused ? store.stack(focusRepo) : store.stack()).filter((c) => !departing.has(c.cardId));
  // fidelity 2: the comp's head ("Stack" · "4 · hover to fan"); the scope is a small filter key (named when it filters)
  const scoped = stackScoped && !!focused;
  put($('stack-scope'), scoped ? 'this project ▾' : '▾');
  $('stack-scope').title = scoped ? 'Showing this session\'s project only (click: all projects)' : 'Showing all projects (click: only this session\'s project)';
  $('stack-scope').setAttribute('aria-pressed', String(scoped));
  put($('inbox'), `${store.cards.size}`);
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
        project: projectOfCard(c),
        raisedAt: c.raisedAt ?? null,
        now: Date.now(),
        voice: cardVoiceOf(c.card),
        composedTitle: permissionTitleOf(c.card, c.tool, c.toolInput),
        localNs: localNsOf(session?.principal),
        // Aegis C1e: what a root-class decision signs, verified against contentHash (null ⇒ no root key)
        rootRows: rootRowsOf(c.card),
        // Q2: status.helper.batch 'unavailable (helper <1.8.0)' ⇒ a one-line notice on root cards
        batchUnavailable: typeof (status?.helper as { batch?: unknown } | undefined)?.batch === 'string' && String((status!.helper as { batch: string }).batch).startsWith('unavailable'),
      },
      c.card.block,
    ) as unknown as HTMLElement;
    const r = refusals.get(c.cardId);
    if (r) el.appendChild(h(doc, 'p', { class: 'refusal' }, refusalText(r)) as unknown as Node);
    if (arrived.has(`card-in:${c.cardId}`)) {
      el.classList.add('arriving');
      // TD-2026-10-19-063: a claim-mismatch card arrives with Deny focused (a keypress never lands on allow)
      queueMicrotask(() => (el.querySelector('[data-default]') as HTMLElement | null)?.focus());
      // S4 droop: a failed-session card droops once as it lands (it keeps the chained animation; nothing restarts)
      if (el.classList.contains('failed')) el.classList.add('fx');
      else el.addEventListener('animationend', () => el.classList.remove('arriving'), { once: true });
    }
    return el;
  };
  const pile = $('stack');
  clear(pile);
  stackLaidOutAt = performance.now();
  // S3: a paper pile; more than PILE_MAX cards ⇒ the first PILE_MAX piled plus "+n more" (it opens the fanned pile)
  const shown = pileOpen ? cards : cards.slice(0, PILE_MAX);
  for (const c of shown) pile.appendChild(mk(c));
  pile.classList.toggle('open', pileOpen);
  // Aegis C1e: a root decision whose logged rowsDigest is not the digest of the rows its card showed: flagged red
  for (const m of store.rootMismatches) pile.appendChild(h(doc, 'p', { class: 'refusal root-digest-mismatch', role: 'alert' }, `The ${m.decision} of ${m.cardId} was logged with rows the card did not show (rowsDigest ${m.logged ?? 'missing'} ≠ shown ${m.shown}). Check gnomon verify.`) as unknown as Node);
  if (cards.length > PILE_MAX && !pileOpen) pile.appendChild(h(doc, 'button', { class: 'key quiet pile-more', type: 'button', 'data-pile-more': '1' }, `+${cards.length - PILE_MAX} more`) as unknown as Node);
  put($('stack-hint'), cards.length > 1 ? ' · hover to fan' : '');
  const pinned = $('pinned');
  clear(pinned);
  const mine = focused ? store.stack(focusRepo).filter((c) => c.hsid === focused) : [];
  // S2.6: the pinned cards carry their label (only when there are any)
  if (mine.length) pinned.appendChild(h(doc, 'span', { class: 'lbl' }, 'Pending in this session') as unknown as Node);
  // S4: a pinned card settles at one of four preset tilts (classes, never inline style), picked by its cardId
  for (const c of mine) {
    const el = mk(c);
    let x = 0;
    for (const ch of c.cardId) x = (x + ch.charCodeAt(0)) % 997; // a tilt pick, not a hue: hues come from projectHue
    el.classList.add(['r-a', 'r-b', 'r-c', 'r-d'][x % 4]!);
    pinned.appendChild(el);
  }
  // S4: cards still flying off go back where they were (the fresh paint never shows them twice)
  for (const d of departing.values())
    for (const x of d)
      if (!x.el.isConnected && (x.parent === pile || x.parent === pinned)) x.parent.insertBefore(x.el, x.parent.children[x.index] ?? null);
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
    // Aegis L4: h() never takes an `id` (ids would let display data clobber getElementById lookups); set it here
    el = h(doc, 'div', { class: 'update-banner', role: 'status' }) as unknown as HTMLElement;
    el.id = 'update-banner';
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
  $('conn').title = 'kernel connection: restarting';
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
  // Aegis S2/S3 M2: a key that moved under the pointer (the stack was just re-laid out) never takes the click
  if (performance.now() - stackLaidOutAt < RELAYOUT_GUARD_MS) return;
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
    flyOff(cardId, decision); // S4: only after the kernel accepted the decision (a refusal throws before this)
  } catch (err) {
    // a refused accept restarts nothing; a delivery-unknown one may: keep the marker then (the close decides)
    if (upgrade && !(err instanceof RpcError && err.refusal.code === 'DELIVERY_UNKNOWN')) clearRestarting(sessionStorage);
    // approve needs the approvals key + presence (#identity M1.3): the refusal is shown as the kernel gave it
    if (err instanceof RpcError) refusals.set(cardId, err.refusal);
  }
  void paintStack();
}

/* ── S5.4 the status line: the old shuttle readout, one --sec line at the footer's right end (opens the kernel feed) ── */
function paintShuttle(): void {
  const s = $('status-line');
  clear(s);
  const by = store.pendingByKind();
  const live = store.liveCount();
  // fidelity 2: one quiet line (the detail is in its title=); a clientApiId drift still shows in the line itself
  const waiting = Object.values(by).reduce((n, x) => n + x, 0);
  const parts = [`${live} live`, waiting ? `${waiting} waiting` : 'inbox clear', `log ${store.head}`];
  if (session) parts.push(`${session.hello.clientApi}${session.clientApiDrift ? ' · clientApiId drift' : ''}`);
  s.appendChild(h(doc, 'span', null, parts.join(' · ')) as unknown as Node);
  s.title = `sessions ${live} live · ${store.sessions.size} seen\ninbox ${Object.keys(by).length ? Object.entries(by).map(([k, n]) => `${k} ×${n}`).join(' · ') : 'clear'}\nlog head ${store.head} · ${store.rowsSeen} rows${session ? `\napi ${session.hello.clientApi}` : ''}\n(click: the kernel feed)`;
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
    if (w.has('sessions') || w.has('cards')) {
      paintSessions();
      paintChatHead(); // S2: the session's name (its first message) and the empty centre's counts follow the log
    }
    if (w.has('cards')) void paintStack(w);
    // T-2026-10-20-002: the card the notice names was decided (or swept): the stale notice goes with it
    if (noticeCard) {
      const step = cardNoticeStep(noticeCard, store.cards);
      if (step.clear) notice(null);
      else noticeCard = step.next;
    }
    if (w.has('modes') || w.has('voice')) void refreshStatus();
    if (w.has('voice-activity')) watchSpeech();
    paintShuttle();
  });
}
store.onChange(schedule);
// TD-2026-10-20-086 F6: the standing-grant feed (toasts, today's list + Revoke, the once-a-day offer); its own module
const standingFeed = mountStandingFeed(document, {
  client: () => client,
  status: () => status,
  refresh: () => refreshStatus(),
  pendingKinds: () => [...store.cards.values()].map((c) => String(c.kind)),
  focusRepo: () => (focused ? (store.sessions.get(focused)?.repo ?? null) : null),
  notice,
  kernelPrincipal: () => kernelPrincipalOf(session?.principal),
});
store.onChange(() => standingFeed.repaint());
// #gui-model-picker: the New-session model select, the header chip + switch, the Settings slot; its own module
modelPicker = mountModelPicker(document, { client: () => client, rows: (hsid) => store.transcript(hsid), live: (hsid) => isLiveState(store.sessions.get(hsid)?.state ?? 'seen'), focused: () => focused, notice });
store.onChange(() => modelPicker?.repaint());
// #gui-settings: the sheet (⚙, ⌘, and the palette's "Settings…"); every control is an existing command or Revoke
const settings = mountSettings(document, {
  model: () =>
    settingsModel({
      theme,
      motion,
      prefersDark: darkQ.matches,
      prefersReduced: motionQ.matches,
      layout,
      status,
      mode: currentMode(),
      dictationDelayMs: dict.delayMs,
      sessionModel: sessionModelText(focused ? sessionModelOf(store.transcript(focused)) : null),
      connection: session && client ? { principal: session.principal, connId: session.connId, surface: SURFACE, clientApiDrift: session.clientApiDrift } : null,
      gui: GUI_CLIENT,
      unlock: unlockSeenOf(store.kernelFeed, session?.connId ?? null, kernelPrincipalOf(session?.principal)),
    }),
  run: (id) => run(id, true), // the sheet acts on trusted presses only (settings-sheet.ts)
  revoke: (grantId) => void revokeGrant(grantId),
});
store.onChange((w) => {
  if (w.has('feed') || w.has('modes') || w.has('voice')) settings.repaint();
});
// #gui-mods-panel: the Mods sheet (header Mods key, ⌘K "Mods…", the Workshop footer's key); requests only, never a decision
const modsPanel = mountMods(document, { client: () => client, status: () => status, cards: () => store.cards.values(), refreshStatus: () => refreshStatus(), focusCard: (cardId) => focusCard(cardId) });
store.onChange(() => modsPanel.repaint());
/** Settings → Revoke: the standing feed's own request (request.grant.standing.revoke, a tighten, no presence). */
async function revokeGrant(grantId: string): Promise<void> {
  if (!client) return notice('not connected: the grant was not revoked', true);
  try {
    await client.call('log.append', revokeRequest(grantId));
    notice(null);
  } catch (err) {
    notice(err instanceof RpcError ? refusalText(err.refusal) : 'the grant was not revoked', true);
  } finally {
    await refreshStatus();
  }
}

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
    return showReconnect(staleView('down').text); // #gui-relaunch: never a terminal as the only way back
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
  staleStop = true;
  staleChannel()?.postMessage({ t: 'attached' }); // #gui-relaunch: a stale same-origin tab may step aside (no secrets)
  $('risk').hidden = SURFACE === 'wrapper'; // the extension-risk badge is the browser's: the wrapper has no extensions (S25-L1)
  // fidelity 2: the readout is a small quiet chip (connected / not connected / restarting…); who and which connection
  // are in its title= and in Settings → About (Kernel connection)
  put($('conn'), 'connected');
  $('conn').title = `kernel connection: ${out.session.principal} · ${out.session.connId.slice(-8)} (Settings → About)`;
  c.onNotification((method, params) => {
    if (method === 'gui.resume') return void noteResume(sessionStorage, params);
    if (method !== 'event') return;
    const p = (params ?? {}) as { row?: unknown; end?: { since?: number } };
    if (p.row) {
      store.apply([p.row]);
      const r = rowOf(p.row);
      if (r) {
        dictationRow(r); // dictation: only LIVE rows feed the composer (the backlog page never does)
        offerVoiceRow(r); // #gui-offer-slip L1: only a LIVE heard "not now" dismisses (never a backlog replay)
        standingFeed.row(r); // F6: a live grant.standing.used row is a toast + a feed line
      }
      modPanelRow(r); // K0 mod panels: a live #mod-host feed-kind row re-renders them (debounced)
    } else if (p.end) void followLog(c, store).catch(() => undefined);
  });
  c.onClose(() => {
    client = null;
    session = null;
    stopStatusPolls();
    paintCapture(voiceStatusOf(status), false);
    if (restarting(sessionStorage)) return void awaitRestart();
    showReconnect('the connection ended; the GUI session ended with it (D54)');
    void goStale();
  });
  try {
    status = await c.call<Record<string, unknown>>('status');
    statusAt = Date.now();
  } catch {
    status = null;
  }
  modPanelRow = mountModPanels({ client: c, status, focused: () => focused, workshop: { openMods: () => modsPanel.open(), refreshStatus: () => refreshStatus() } }); // K0 mod panels (ui/mod-panels-mount.ts)
  voicePresenceDone = false; // ambient's Touch ID is once per GUI login (V2d)
  paintMode();
  paintVoice();
  try {
    await subscribe(c);
  } catch (err) {
    notice(err instanceof RpcError ? refusalText(err.refusal) : 'log.read failed', true);
  }
  dispatchDictation({ type: 'start', sinceSeq: store.head, now: Date.now() }); // everything read so far is backlog
  offerLiveSince = store.head; // #gui-offer-slip: a slip shown after this slides in
  syncDictationContext();
}

/* ── #gui-relaunch (T-2026-10-20-001, core/stale.ts): a stale tab after a stop-then-start ── */
let staleStop = false;
const reconnectBtn = (): HTMLElement => document.getElementById('reconnect-btn')!;
let staleCh: BroadcastChannel | null | undefined;
function staleChannel(): BroadcastChannel | null {
  if (staleCh === undefined) {
    staleCh = typeof BroadcastChannel === 'function' ? new BroadcastChannel(STALE_CHANNEL) : null;
    staleCh?.addEventListener('message', (e) => {
      const m = parseStaleMsg(e.data);
      if (m?.t === 'who' && client) staleCh?.postMessage({ t: 'attached' });
      else if (m?.t === 'attached' && !client && !staleStop) paintStale('reopened');
    });
  }
  return staleCh;
}
function paintStale(st: StaleState): void {
  const v = staleView(st);
  if (st === 'reopened') staleStop = true;
  showReconnect(v.text);
  let close = document.getElementById('reconnect-close');
  if (!close) {
    close = h(doc, 'button', { class: 'key', type: 'button' }, 'Close this tab') as unknown as HTMLElement;
    close.id = 'reconnect-close'; // Aegis L4: not through h()
    // a user click only; window.close() is allowed for a tab with one history entry, else the text says to continue there
    close.addEventListener('click', (e) => void (e.isTrusted && window.close()));
    reconnectBtn().after(close);
  }
  close.hidden = v.action !== 'close';
  reconnectBtn().hidden = v.action === 'close';
}
async function goStale(): Promise<void> {
  staleStop = false;
  staleChannel()?.postMessage({ t: 'who' });
  await watchStale({ fetchFn: (u) => fetch(u, { cache: 'no-store' }), origin: location.origin, onState: (st) => paintStale(st), stopped: () => staleStop || !!client });
}

function showReconnect(why: string): void {
  put($('conn'), 'not connected');
  $('conn').title = 'kernel connection: not connected';
  put($('reconnect-why'), why);
  $('reconnect').hidden = false;
}

/* ── composer / new session ─────────────────────────────────────── */
/** true once the kernel took the message; `accepted` runs as the message goes out (never on an early return). */
async function send(textValue: string, accepted?: () => void): Promise<boolean> {
  if (!textValue.trim()) return false;
  // dictation: a draft with dictated turns for the focused session goes through the dictation send (one part per turn)
  if (dictationOn() && dict.focusedHere && dict.parts.length && hasDraft(dict)) {
    dispatchDictation({ type: 'sendNow', now: Date.now() });
    return false;
  }
  if (hasDraft(dict)) dispatchDictation({ type: 'sent', now: Date.now() }); // a typed message clears hold
  // never swallow a message silently: say why nothing was sent (dogfood: Enter on the kernel feed "did nothing")
  if (!client) {
    notice('not connected: nothing was sent', true);
    return false;
  }
  if (!focused) {
    notice('no session focused: pick a session on the left or open a new one; nothing was sent', true);
    return false;
  }
  accepted?.();
  const hsid = focused;
  const echo: Row = { seq: store.head + 0.5, kind: 'composer', connId: 'local', session: hsid, payload: textValue, at: new Date().toISOString() };
  local.push(echo);
  schedule(new Set([`transcript:${hsid}`]));
  try {
    stampEcho(echo, await client.call<{ turn?: unknown }>('session.send', { hsid, content: [{ text: textValue }] }));
    return true;
  } catch (err) {
    unsentEcho(echo, err);
    return false;
  }
}

/** review M1: the composer echo pairs with ITS turn.sent: stamp it with the turn id session.send returned. */
function stampEcho(echo: Row, r: { turn?: unknown } | null | undefined): void {
  if (typeof r?.turn !== 'string') return;
  echo.turn = r.turn;
  localRev++;
  schedule(new Set([`transcript:${echo.session}`]));
}
/** review M1: a refused or network-failed send is no turn: the echo stops waiting, the reason shows under it. */
function unsentEcho(echo: Row | null, err: unknown, hsid: string | undefined = echo?.session): void {
  if (echo) echo.unsent = true;
  localRev++;
  const why = err instanceof RpcError ? refusalText(err.refusal) : 'may not have been sent: the connection to the kernel failed';
  if (echo || err instanceof RpcError) local.push({ seq: store.head + 0.6, kind: 'send.refused', connId: 'local', session: hsid, payload: why });
  schedule(new Set([`transcript:${hsid}`]));
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
  modPanelsFocus(hsid); // K3: the mod panels re-render for the new focus (the host joins it to the repo); first, so a later paint error never skips it
  if (hsid) feedView = false;
  closeDrawers();
  closeModeMenu();
  closeVoiceMenu();
  paintMode();
  paintVoice();
  resetTranscript();
  paintSessions();
  void paintStack();
  syncDictationContext();
}

/* ── voice dictation (TD-2026-10-20-262; core/dictation.ts) ────────── */
let dict = initialDictation(parseDelay(localStorage.getItem(DELAY_KEY)));
/** TD-2026-10-21-514: the voice preset (per machine) and a pending double-rAF visibility stamp */
let voicePreset = parsePreset(localStorage.getItem(PRESET_KEY));
let capturePref = parseCapturePref(localStorage.getItem(CAPTURE_KEY));
/** TD-2026-10-21-514: the capture kind the voice app is (re)started with, from the preset and the listening choice */
const currentCapture = (): 'ptt' | 'open' | 'toggle' => captureOf(voicePreset, capturePref);
/** a running voice app is restarted with the new capture kind (the kernel restarts it only when the kind changed) */
async function applyCapture(): Promise<void> {
  if (!client || !canAttach(status) || needsStart(clientOf(status))) return;
  await client.call('log.append', clientRequest('start', currentCapture())).catch((err: unknown) => notice(err instanceof RpcError ? refusalText(err.refusal) : 'the voice app was not restarted with the new listening mode', true));
}
/** the last ⌃⌥Return count seen (a baseline first: presses before this page never send) */
let sendNowsSeen: { n: number; epoch: string | null } | null = null;

/** TD-2026-10-21-514: the mic on/off from the GUI (palette, in-app `): the voice app toggles on a changed count. */
async function micToggle(trusted: boolean): Promise<void> {
  if (!trusted || !client || !canAttach(status)) return;
  try {
    await client.call('log.append', { kind: 'request.voice.client', payload: { op: 'mic-toggle' } });
  } catch (err) {
    notice(err instanceof RpcError ? refusalText(err.refusal) : 'the mic was not toggled', true);
  }
}

/** The Mic key switch: ⌃` (default, global) or a bare ` everywhere (opt-in, with its warning). */
async function setMicKey(bare: boolean, trusted: boolean): Promise<void> {
  if (!trusted || !client || !canAttach(status)) return;
  try {
    await client.call('log.append', { kind: 'request.voice.client', payload: { op: 'mic-key', bare } });
    notice(bare ? 'Mic key: ` everywhere. While Gnomon voice runs, ` will not type in any app.' : 'Mic key: ⌃` (and ` inside Gnomon)');
    await refreshStatus();
  } catch (err) {
    notice(err instanceof RpcError ? refusalText(err.refusal) : 'the mic key was not changed', true);
  }
}
const micKeyBareOf = (st: unknown): boolean => (st as { voice?: { micKeyBare?: unknown } } | null)?.voice?.micKeyBare === true;
/** a bare ` in-app: only while this window is focused and focus is not in an editable field */
function editableFocus(): boolean {
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
}
let paintStamp = false;
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
  stampPainted();
}

/**
 * TD-2026-10-21-514: the send word may only send a draft that has been VISIBLE ≥ 1 s. Stamped after paint (a double
 * requestAnimationFrame: the frame after the one that painted it), only while the page is visible.
 */
function stampPainted(): void {
  if (paintStamp || dict.policy !== 'word' || dict.visibleSince !== null || !hasDraft(dict) || !dict.focusedHere || document.visibilityState !== 'visible') return;
  paintStamp = true;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      paintStamp = false;
      if (document.visibilityState === 'visible') dispatchDictation({ type: 'painted', now: Date.now() });
    }),
  );
}

/** TD-2026-10-21-514: the preset's send policy and the kernel-held send word reach the reducer. */
function syncVoicePolicy(): void {
  const policy = policyOf(voicePreset);
  const word = sendWordOf(status);
  if (policy !== dict.policy || JSON.stringify(word) !== JSON.stringify(dict.sendWord)) dispatchDictation({ type: 'setPolicy', policy, sendWord: word, now: Date.now() });
}

/** Choose a preset (pill menu, palette): Send word and Pieces ask for the one-time liability acknowledgement first. */
async function chooseVoicePreset(p: typeof voicePreset, trusted: boolean): Promise<void> {
  if (!trusted) return;
  const me = myPrincipal();
  const step = choosePreset(p, { acked: acked(localStorage, me), sendWord: sendWordOf(status) });
  if (step === 'needs-ack') return openAck(p);
  if (step === 'needs-word') return openTeach(p);
  applyVoicePreset(p);
}

function myPrincipal(): string | null {
  const p = (status as { principal?: unknown } | null)?.principal;
  return typeof p === 'string' ? p : null;
}

function applyVoicePreset(p: typeof voicePreset): void {
  voicePreset = p;
  localStorage.setItem(PRESET_KEY, p);
  syncVoicePolicy();
  void applyCapture();
  notice(`voice: ${PRESET_LABELS[p]} · ${PRESET_NOTES[p]}${attachSend(p) ? ' (re-attach voice to apply its send ceiling)' : ''}`);
  if (!$('voice-menu').hidden) paintVoiceMenu();
}

/* ── the liability acknowledgement (TD-2026-10-21-514: Send word and Pieces are liability modes) ── */
let ackFor: typeof voicePreset | null = null;
function openAck(p: typeof voicePreset): void {
  closeVoiceMenu();
  ackFor = p;
  put($('ack-mode'), `${PRESET_LABELS[p]}: ${PRESET_NOTES[p]}`);
  put($('ack-text'), ACK_TEXT);
  const box = $<HTMLInputElement>('ack-agree');
  box.checked = false;
  ($('ack-go') as HTMLButtonElement).disabled = true;
  $('ack-dialog').hidden = false;
  box.focus();
}
function closeAck(): void {
  $('ack-dialog').hidden = true;
  ackFor = null;
}
function submitAck(trusted: boolean): void {
  const p = ackFor;
  const me = myPrincipal();
  if (!trusted || !p || !me || !$<HTMLInputElement>('ack-agree').checked) return;
  recordAck(localStorage, me);
  closeAck();
  void chooseVoicePreset(p, true);
}

/* ── "Teach Gnomon your send word" (guided: pick, validate, lead-in, 3 takes, test, done) ── */
let teach: TeachState | null = null;
let teachFor: typeof voicePreset | null = null;
function teachOpen(): boolean {
  return teach !== null && !$('sendword-dialog').hidden;
}
function openTeach(p: typeof voicePreset | null): void {
  closeVoiceMenu();
  teach = initialTeach();
  teachFor = p;
  const sug = $('sendword-suggestions');
  clear(sug);
  for (const w of TEACH_SUGGESTIONS) sug.appendChild(h(doc, 'button', { class: 'key quiet', type: 'button', 'data-sendword': w }, w) as unknown as Node);
  $<HTMLInputElement>('sendword-custom').value = '';
  $('sendword-dialog').hidden = false;
  paintTeach();
  $('sendword-custom').focus();
}
async function closeTeach(): Promise<void> {
  $('sendword-dialog').hidden = true;
  const was = teach;
  teach = null;
  teachFor = null;
  // a trial word never outlives the dialog
  if (client && was && was.step !== 'pick' && was.step !== 'done') await client.call('log.append', { kind: 'request.voice.sendword', payload: { op: 'clear' } }).catch(() => undefined);
}
function paintTeach(): void {
  const s = teach;
  if (!s) return;
  const attached = voiceStatusOf(status).hsid !== null;
  put($('sendword-line'), !attached && s.step !== 'pick' && s.step !== 'confirm-common' && s.step !== 'done' ? 'Attach voice to a session first (the takes are heard through it).' : teachLine(s));
  $('sendword-pick').hidden = s.step !== 'pick';
  put($('sendword-heard'), s.heard === null ? '' : `I heard: “${s.heard}”`);
  put($('sendword-hint'), s.hint ?? (s.step === 'takes' || s.step === 'test' ? `${s.takes.length} of ${TAKES_NEEDED} takes${s.variants.length ? ` · also heard as ${s.variants.map((v) => `“${v}”`).join(', ')}` : ''}` : ''));
  const go = $<HTMLButtonElement>('sendword-go');
  go.hidden = !(s.step === 'pick' || s.step === 'confirm-common' || s.step === 'done');
  put(go, s.step === 'done' ? 'Save' : s.step === 'confirm-common' ? 'Use it' : 'Continue');
  $('sendword-no').hidden = s.step !== 'confirm-common';
}
async function teachStep(e: TeachEvent): Promise<void> {
  if (!teach) return;
  const prev = teach;
  teach = reduceTeach(teach, e);
  // entering the lead-in (or each heard take): the kernel holds the word as a trial so the short takes are attributed
  if (client && teach.step !== 'pick' && teach.step !== 'confirm-common' && teach.step !== 'done' && (prev.step !== teach.step || e.type === 'heard'))
    await client.call('log.append', { kind: 'request.voice.sendword', payload: { op: 'start', word: teach.word, trial: true } }).catch((err: unknown) => {
      if (teach) teach = { ...(teach as TeachState), hint: err instanceof RpcError ? refusalText(err.refusal) : 'the voice app could not be told the word' };
    });
  paintTeach();
}
async function submitTeach(trusted: boolean): Promise<void> {
  if (!trusted || !teach || !client) return;
  if (teach.step === 'pick') return teachStep({ type: 'pick', text: $<HTMLInputElement>('sendword-custom').value });
  if (teach.step === 'confirm-common') return teachStep({ type: 'confirmCommon', yes: true });
  const commit = teachCommit(teach);
  if (!commit) return;
  try {
    await client.call('log.append', { kind: 'request.voice.sendword', payload: commit });
    await refreshStatus();
    const p = teachFor;
    $('sendword-dialog').hidden = true;
    teach = null;
    teachFor = null;
    if (p) void chooseVoicePreset(p, true);
    else notice('send word saved');
  } catch (err) {
    if (teach) teach = { ...(teach as TeachState), hint: err instanceof RpcError ? refusalText(err.refusal) : 'the send word was not saved' };
    paintTeach();
  }
}
/** While the dialog listens, a voice turn is a take (never a draft): its text, or null when it was withheld. */
function teachHeard(p: Record<string, unknown> | null): void {
  const text = p && p.forwardable === true && typeof p.text === 'string' && p.text.trim() ? p.text : null;
  void teachStep({ type: 'heard', text });
}

/** A live row: a dictated turn for the composer, or the draft session's streaming (resets the ring). */
function dictationRow(r: Row): void {
  if (!dictationOn()) return;
  const now = Date.now();
  if (r.kind === 'voice.turn.user') {
    const p = r.payload && typeof r.payload === 'object' ? (r.payload as Record<string, unknown>) : null;
    // the send-word dialog is listening: this turn is a take, never a draft
    if (teachOpen() && r.seq > dict.lastSeq) {
      dict = { ...dict, lastSeq: r.seq };
      return teachHeard(p);
    }
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
  syncVoicePolicy();
  const d = dictationStatusOf(status);
  if (d.activity !== dict.activity) dispatchDictation({ type: 'activity', activity: d.activity, now });
  if (d.holdToggles !== null && (d.holdToggles !== dict.holdToggles || d.epoch !== dict.holdEpoch)) dispatchDictation({ type: 'holdToggle', count: d.holdToggles, epoch: d.epoch, now });
  // TD-2026-10-21-514: ⌃⌥Return in the voice app sends the draft through the one send path (a hand origin)
  if (d.sendNows !== null) {
    const fresh = sendNowsSeen !== null && sendNowsSeen.epoch === d.epoch && d.sendNows > sendNowsSeen.n;
    sendNowsSeen = { n: d.sendNows, epoch: d.epoch };
    // Aegis M-5: a voice-origin (clamped) send of an unedited draft; an edited one is held for Enter
    if (fresh && hasDraft(dict) && dict.focusedHere) dispatchDictation({ type: 'sendNowKey', now });
  }
}

function setDictationDelay(d: number | null): void {
  localStorage.setItem(DELAY_KEY, serializeDelay(d));
  dispatchDictation({ type: 'setDelay', delayMs: d, now: Date.now() });
  if (!$('voice-menu').hidden) paintVoiceMenu();
  // TD-2026-10-20-125: the delay applies to push-to-talk only; ambient speech always waits for Enter / Send
  notice(d === null ? 'dictation: auto-send off (Send or Enter sends)' : `dictation: push-to-talk auto-sends after ${delayLabel(d)} of silence; ambient speech waits for Enter`);
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
  const echo: Row | null = dict.edited ? { seq: store.head + 0.5, kind: 'composer', connId: 'local', session: req.hsid, payload: dict.text, at: new Date().toISOString() } : null;
  if (echo) local.push(echo);
  schedule(new Set([`transcript:${req.hsid}`]));
  try {
    // TD-2026-10-21-514 ($send-by-word): the claim first; the kernel consumes the word and stamps this send voice-origin
    const claim = sendClaim(dict);
    if (claim) await client.call('log.append', { kind: 'request.voice.send.claim', payload: claim });
    const r = await client.call<{ turn?: unknown }>('session.send', req);
    if (echo) stampEcho(echo, r);
    dispatchDictation({ type: 'sent', now: Date.now() });
    // Aegis M3: the composer shows exactly the reducer's text: the in-flight edit (held) or the turns heard in flight
    const ta = $<HTMLTextAreaElement>('composer-text');
    if (dict.focusedHere) ta.value = dict.text;
  } catch (err) {
    unsentEcho(echo, err, req.hsid);
    if (!(err instanceof RpcError)) notice('the dictated draft was not sent; it stays in the composer', true);
    dispatchDictation({ type: 'sendFailed', now: Date.now() });
    const ta = $<HTMLTextAreaElement>('composer-text');
    if (dict.focusedHere && !ta.value) ta.value = dict.text; // the draft stays in the composer
    schedule(new Set([`transcript:${req.hsid}`]));
  }
}

/** The ring, [Hold]/[Resume] (per draft state), the aria-live countdown and the pill's "draft waiting" note. */
function paintDictation(): void {
  const on = dictationOn() && dict.parts.length > 0;
  const bar = $('dictation');
  bar.hidden = !on || !dict.focusedHere;
  const now = Date.now();
  // $send-by-pieces: the piece ring drains toward the gap that sends the piece
  const frac = draftControls(dict).pieceRing ? pieceFraction(dict, now) : ringFraction(dict, now);
  const rem = ringRemaining(dict, now);
  const controls = draftControls(dict);
  $('dictation-ring').hidden = frac === null || !(controls.ring || controls.pieceRing);
  if (frac !== null) $('dictation-arc').setAttribute('stroke-dashoffset', String(Math.round(frac * 1000) / 10));
  put($('dictation-secs'), rem === null ? '' : `${Math.ceil(rem / 1000)} s`);
  const line = on ? liveLine(dict, now) : '';
  if (line !== dictLive) put($('dictation-live'), (dictLive = line)); // a changed line only: the live region speaks once a second at most
  // one send control (the composer's send); [Hold] / [Resume] only beside a push-to-talk countdown (DRAFT_CONTROLS)
  const hold = $('dictation-hold');
  hold.hidden = controls.hold === null;
  put(hold, controls.hold === 'resume' ? 'Resume' : 'Hold');
  hold.setAttribute('aria-pressed', String(controls.hold === 'resume'));
  bar.classList.toggle('held', controls.hold === 'resume');
  ($('composer-send') as HTMLButtonElement).disabled = dict.sending;
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
  // Aegis L2 (862ef85a): with no connection a status read cannot happen, so every status poll stops here too
  if (!client) return stopStatusPolls();
  try {
    status = await client.call<Record<string, unknown>>('status');
    statusAt = Date.now(); // Aegis L2: the capture overlay ages from here (a failed read keeps the old status)
  } catch {
    /* keep the last status; the control shows what it last knew */
  }
  paintMode();
  paintVoice();
  paintSessions();
  paintTeach();
  standingFeed.repaint(); // F6: today's grant (status.standing)
  settings.repaint(); // #gui-settings: the sheet re-reads the same status
  modsPanel.repaint(); // #gui-mods-panel: installed / available / pending
  modPanelsStatus(status); // a mod installed, paused or removed: its views (and the Workshop key) follow
  syncDictationContext();
  foldVoiceReports();
  syncSpeakPoll();
  syncClientPoll();
}

/* ── Stop speaking (T-2026-10-19-026; core/voice.ts) ───────────────── */
let speakPoll: ReturnType<typeof setInterval> | null = null;
let speakWatchUntil: number | null = null;
/** A voice row arrived: re-read status for a short window so a reply that starts speaking shows its ⏹. */
function watchSpeech(): void {
  speakWatchUntil = Date.now() + SPEAK_WATCH_MS;
  syncSpeakPoll();
}
/** One status read in flight at a time: a slow read is never stacked by the poll (Aegis L3). */
let speakReading = false;
async function pollStatusOnce(): Promise<void> {
  if (speakReading) return;
  speakReading = true;
  try {
    await refreshStatus();
  } finally {
    speakReading = false;
  }
}
/** The 300 ms status re-read runs only while the voice app is speaking (or within the watch window). */
function syncSpeakPoll(): void {
  const want = !!client && speakPollWanted(status, speakWatchUntil, Date.now());
  if (want && !speakPoll) speakPoll = setInterval(() => void pollStatusOnce(), SPEAK_POLL_MS);
  else if (!want && speakPoll) {
    clearInterval(speakPoll);
    speakPoll = null;
  }
}
let clientPoll: ReturnType<typeof setInterval> | null = null;
let clientPollMs: number | null = null;
/**
 * T-2026-10-20-002: the kernel logs no row when the voice app's phase or connection changes, so while voice is
 * attached (or the app is setting up, starting or in a backoff restart) status is re-read every CLIENT_POLL_MS
 * (one read in flight, pollStatusOnce) and the pill never goes stale on a crash loop.
 * T-2026-10-20-005 V3 (#gui-voice-capture): attached with the voice app connected, the same poll runs at the capture
 * cadence instead (capturePollMs: ~1 s at rest, ~175 ms while hearing or transcribing); it is re-armed when that changes.
 */
function syncClientPoll(): void {
  const want = !!client && clientPollWanted(clientOf(status), voiceStatusOf(status).state !== 'off', canAttach(status));
  const v = voiceStatusOf(status);
  const ms = want ? (capturePollMs({ attached: v.state !== 'off', clientConnected: v.clientConnected, attachable: canAttach(status), connected: !!client }, captureStatusOf(status)) ?? CLIENT_POLL_MS) : null;
  if (clientPoll && ms !== clientPollMs) {
    clearInterval(clientPoll);
    clientPoll = null;
  }
  if (ms !== null && !clientPoll) {
    clientPollMs = ms;
    clientPoll = setInterval(() => void pollStatusOnce(), ms);
  }
}

/** Disconnect (Aegis L2, 862ef85a): every status poll and the capture flash timer stop; the capture overlay clears. */
function stopStatusPolls(): void {
  if (speakPoll) clearInterval(speakPoll);
  speakPoll = null;
  speakWatchUntil = null;
  if (clientPoll) clearInterval(clientPoll);
  clientPoll = null;
  clientPollMs = null;
  if (enrolPoll) clearInterval(enrolPoll);
  enrolPoll = null;
  if (captureFlash) clearTimeout(captureFlash);
  captureFlash = null;
  captureTrack = null;
  statusAt = null;
}
/** ⏹ / Esc: one log.append request.voice.client{op:'stop-speaking'} on a trusted gesture. */
async function stopSpeaking(trusted: boolean): Promise<void> {
  if (!trusted || !client || !stopSpeakingShown(status)) return;
  $('voice-stop').hidden = true; // the press is seen at once; the next status re-read is the truth
  try {
    await client.call('log.append', stopSpeakingRequest());
  } catch (err) {
    notice(err instanceof RpcError ? refusalText(err.refusal) : 'the voice app was not stopped', true);
  } finally {
    await refreshStatus();
  }
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
  put(btn, modeChip(v));
  btn.title = `Run mode: ${modeLabel(v).replace(/ ▾$/, '')} (kernel-owned; ⇧Tab in the composer cycles it)`;
  btn.className = `key quiet mode-btn kernel-owned${v ? ` mode-${v.effective}` : ''}`;
  const to = focused ? `to ${focused.slice(-10)}${v ? ` · mode ${v.effective} · ⇧Tab cycles` : ''}` : 'no session focused';
  put($('composer-mode'), to);
  // fidelity 2: the comp's composer is the input alone; who it goes to and the mode live in its tooltip
  $('composer-text').title = `${to}. Enter sends, Shift+Enter is a newline, Shift+Tab cycles the run mode.`;
  if (!$('mode-menu').hidden) paintModeMenu();
}

function paintModeMenu(): void {
  const menu = $('mode-menu');
  clear(menu);
  const v = currentMode();
  if (!v) return closeModeMenu();
  const sc = scopeEntries(v); // F2: the choices apply to this folder by default; the other scope is the secondary entry
  menu.appendChild(h(doc, 'div', { class: 'mode-note mode-scope-head' }, sc.heading) as unknown as Node);
  for (const e of menuEntries(v)) {
    const b = h(doc, 'button', { class: `mode-item${e.current ? ' current' : ''}`, type: 'button', role: 'menuitem', 'data-mode': e.mode, 'aria-disabled': String(e.disabled) }, h(doc, 'span', { class: 'mode-name' }, e.mode), h(doc, 'span', { class: 'mode-note' }, e.note)) as unknown as HTMLButtonElement;
    b.disabled = e.disabled;
    menu.appendChild(b);
  }
  if (sc.other) menu.appendChild(h(doc, 'button', { class: 'mode-item scope', type: 'button', role: 'menuitem', 'data-mode-scope': sc.other.scope }, sc.other.label) as unknown as Node);
}

function openMoreMenu(): void {
  $('more-menu').hidden = false;
  $('more-btn').setAttribute('aria-expanded', 'true');
}
function closeMoreMenu(): void {
  $('more-menu').hidden = true;
  $('more-btn').setAttribute('aria-expanded', 'false');
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
async function setMode(to: RunMode, scope: ModeScope, trusted: boolean): Promise<void> {
  if (!trusted) return;
  closeModeMenu();
  if (!client) return notice('not connected: the run mode was not changed', true);
  const v = currentMode();
  if (!v) return notice('no live session focused: the run mode was not changed', true);
  const plan = planFor(v, to, scope);
  if (plan.kind === 'blocked') return notice(`${to} is not allowed here: ${plan.reason}`, true);
  if (plan.kind === 'same') return;
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
  const scope = defaultScope(v); // F2: ⇧Tab moves this folder's mode unless the session has its own
  let to = nextRunMode(v.chosen);
  if (planFor(v, to, scope).kind === 'blocked') to = nextRunMode(to);
  void setMode(to, scope, trusted);
}

/* ── voice (V2d, TD-2026-10-19-298; core/voice.ts) ───────────────── */
let voicePresenceDone = false;
let voiceBusy = false;

/**
 * The pill is kernel-owned: its state is status.voice only, re-read on a voice.session.* / voice-app row (store
 * 'voice') and, since the kernel logs no row for a voice-app phase or connection change, by syncClientPoll while
 * attached (T-2026-10-20-002).
 */
function paintVoice(): void {
  const v = voiceStatusOf(status);
  store.voiceIdleMs = v.ambientIdleMs;
  // V2e: with nothing attached, the voice app's lifecycle owns the pill (setup phases, crash, the enrol nudge);
  // attached, the live state stands and the app's real condition is appended (Aegis M V2d: never under-report)
  const c = clientOf(status);
  const cp = clientPillOf(c, v.state !== 'off', canAttach(status));
  const p = pillOf(v, cp.tail);
  const btn = $('voice-pill');
  btn.className = cp.tail !== null ? [...new Set(`${p.className} ${cp.className}`.split(' '))].join(' ') : p.className;
  btn.title = cp.tail !== null ? `${p.title} ${cp.title}` : p.title;
  btn.dataset.state = p.state;
  put($('voice-label'), p.label);
  put($('voice-target'), p.target ? `· ${p.target}` : '');
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
  $('voice-stop').hidden = !stopSpeakingShown(status);
  const act = $('voice-action');
  act.hidden = cp.action === null;
  act.dataset.action = cp.action ?? '';
  put(act, cp.actionLabel);
  const dev = devBannerOf(c);
  $('voice-dev').hidden = dev === null;
  put($('voice-dev'), dev ? `⚠ ${dev}` : '');
  if (!$('enrol-dialog').hidden) paintEnrol();
  paintCapture(v, cp.label === null);
  const note = store.voiceNote;
  $('voice-note').hidden = !note || v.state !== 'off';
  put($('voice-note'), note ?? '');
  if (!$('voice-menu').hidden) paintVoiceMenu();
  paintDictation();
}

/* ── live capture (T-2026-10-20-005 A1; core/capture.ts, #gui-voice-capture) ── */
let captureTrack: CaptureTrack | null = null;
/** when the page last RECEIVED a status (null: never on this connection) */
let statusAt: number | null = null;
let captureFlash: ReturnType<typeof setTimeout> | null = null;
let captionState: string | null = null;
/**
 * The capture overlay on the attached pill: only while voice is attached and the voice app is connected (`live`).
 * The meter is drawn from the REAL level while hearing and is still otherwise (no decorative motion); the composer
 * ghost line is its own element, never the textarea (B1: the live words, committed solid and the tail dim, or "…");
 * the polite caption changes on a state change only.
 */
function paintCapture(v: ReturnType<typeof voiceStatusOf>, pillOwned: boolean): void {
  const live = pillOwned && !!client && v.state !== 'off' && v.clientConnected === true;
  captureTrack = live ? captureStep(captureTrack, freshCapture(captureStatusOf(status), statusAt, Date.now()), Date.now()) : null;
  const d = captureDisplayOf(captureTrack, Date.now(), live);
  const btn = $('voice-pill');
  for (const c of [...btn.classList]) if (c.startsWith('capture-')) btn.classList.remove(c);
  if (live) btn.classList.add(d.className);
  if (live && d.label !== null) put($('voice-label'), `${d.label}${clientPillOf(clientOf(status), true, canAttach(status)).tail ?? ''}`);
  const meter = $('voice-meter');
  meter.hidden = !live;
  meter.style.setProperty('--level', String(d.meter));
  const ghost = $('composer-ghost');
  ghost.hidden = !d.ghost;
  paintGhost(ghost, d.ghost ? d.ghostText : null);
  if (d.caption !== captionState) {
    captionState = d.caption;
    put($('voice-caption'), d.caption);
  }
  if (captureFlash) clearTimeout(captureFlash);
  captureFlash = d.flashLeftMs !== null ? setTimeout(() => ((captureFlash = null), paintVoice()), d.flashLeftMs + 20) : null;
}

let ghostShown: string | null = null;
/**
 * B1 live words in #composer-ghost (never the textarea: a send can never carry non-final words). Text nodes only
 * (put → sanitizeDisplayText), repainted only when the words change; cleared to "…" when there are none.
 */
function paintGhost(el: HTMLElement, t: GhostText | null): void {
  const key = t ? `${t.committed}\u0000${t.tail}` : '';
  if (key === ghostShown) return;
  ghostShown = key;
  clear(el);
  if (!t) {
    put(el, '…');
    return;
  }
  const committed = document.createElement('span');
  committed.className = 'ghost-committed';
  put(committed, t.committed);
  const tail = document.createElement('span');
  tail.className = 'ghost-tail';
  put(tail, t.tail);
  el.append(committed, document.createTextNode(t.committed && t.tail ? ' ' : ''), tail);
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
    const picks = h(doc, 'span', { class: 'mode-item scope dictation-delays', role: 'group', 'aria-label': 'push-to-talk auto-send after silence (ambient speech waits for Enter)' }, h(doc, 'span', { class: 'mode-name' }, 'Push-to-talk auto-send after')) as unknown as HTMLElement;
    for (const d of DELAY_CHOICES)
      picks.appendChild(h(doc, 'button', { class: `key quiet${d === dict.delayMs ? ' current' : ''}`, type: 'button', role: 'menuitemradio', 'aria-checked': String(d === dict.delayMs), 'data-dictation-delay': serializeDelay(d) }, delayLabel(d)) as unknown as Node);
    menu.appendChild(picks);
  }
  if (canAttach(status)) {
    // TD-2026-10-21-514: the presets, a segmented control (Send word and Pieces ask for the acknowledgement once)
    const seg = h(doc, 'span', { class: 'mode-item scope voice-presets', role: 'group', 'aria-label': 'voice preset' }, h(doc, 'span', { class: 'mode-name' }, 'Send')) as unknown as HTMLElement;
    for (const p of VOICE_PRESET_IDS)
      seg.appendChild(h(doc, 'button', { class: `key quiet${p === voicePreset ? ' current' : ''}`, type: 'button', role: 'menuitemradio', 'aria-checked': String(p === voicePreset), 'data-voice-preset': p, title: PRESET_NOTES[p] }, PRESET_LABELS[p]) as unknown as Node);
    menu.appendChild(seg);
    // TD-2026-10-21-514: how the ambient presets listen — always on, or the mic key toggles listening (toggle capture)
    if (voicePreset !== 'talk')
      menu.appendChild(h(doc, 'button', { class: 'mode-item voice-item scope', type: 'button', role: 'menuitemcheckbox', 'aria-checked': String(capturePref === 'toggle'), 'data-capture': capturePref === 'toggle' ? 'open' : 'toggle' }, h(doc, 'span', { class: 'mode-name' }, `Listening: ${capturePref === 'toggle' ? 'the mic key turns it on and off' : 'always on while attached'}`), h(doc, 'span', { class: 'mode-note' }, capturePref === 'toggle' ? 'switch to always on' : 'let the mic key toggle listening (starts off)')) as unknown as Node);
    // the Mic key switch (TD-2026-10-21-514): ⌃` by default; a bare ` everywhere only by opt-in, with the warning
    const bare = micKeyBareOf(status);
    menu.appendChild(h(doc, 'button', { class: 'mode-item voice-item scope', type: 'button', role: 'menuitemcheckbox', 'aria-checked': String(bare), 'data-mic-key': bare ? 'ctrl' : 'bare' }, h(doc, 'span', { class: 'mode-name' }, `Mic key: ${bare ? '` everywhere' : '⌃` (` inside Gnomon)'}`), h(doc, 'span', { class: 'mode-note' }, bare ? 'switch back to ⌃`' : 'use a bare ` everywhere: while Gnomon voice runs, ` will not type in any app')) as unknown as Node);
    const sw = sendWordOf(status);
    menu.appendChild(h(doc, 'button', { class: 'mode-item voice-item scope', type: 'button', role: 'menuitem', 'data-voice-sendword': '1' }, h(doc, 'span', { class: 'mode-name' }, sw ? 'Change your send word' : 'Teach Gnomon your send word'), h(doc, 'span', { class: 'mode-note' }, sw ? `now “${sw.text}”` : 'a guided step: say it a few times')) as unknown as Node);
  }
  menu.appendChild(h(doc, 'span', { class: 'mode-note voice-keys' }, `hotkeys (voice app): hold ${v.hotkey} to talk · ⌃\` mic on/off · ⌃⌥H holds the dictation · ⌃⌥Return sends`) as unknown as Node);
}
function openVoiceMenu(): void {
  // voice drops fix: opening the menu is the human's dismiss of a sticky drop on the pill (core/capture.ts)
  captureTrack = captureDismiss(captureTrack, Date.now());
  $('voice-menu').hidden = false;
  $('voice-pill').setAttribute('aria-expanded', 'true');
  paintVoiceMenu();
  paintVoice();
}
function closeVoiceMenu(): void {
  $('voice-menu').hidden = true;
  $('voice-pill').setAttribute('aria-expanded', 'false');
}

/**
 * One gesture sets voice (G-GUI-04: trusted events only). Off and a narrowing apply on the kernel's answer; the
 * first widening to ambient in this GUI login comes back as a pending presence card this same gesture approves
 * `allow` (the kernel asks for Touch ID), as a run-mode loosening does. A refusal is shown as given.
 */
async function setVoice(to: VoiceState, hsid: string | null, trusted: boolean): Promise<void> {
  if (!trusted) return;
  closeVoiceMenu();
  if (!client) return notice('not connected: voice was not changed', true);
  if (!canAttach(status)) return notice('only a human connection attaches voice', true);
  const v = voiceStatusOf(status);
  const plan = planVoice(v, to, hsid, voicePresenceDone);
  if (plan.kind === 'blocked') return notice(`${VOICE_TITLE[to]} is not allowed: ${plan.reason}`, true);
  if (plan.kind === 'same') return;
  const req0 = voiceRequest(v, to, hsid);
  // TD-2026-10-21-514: an ambient attach asks for the preset's send ceiling (word | pieces; pieces takes a presence card)
  const ceil = attachSend(voicePreset);
  // Aegis M-4: the liability acknowledgement (recorded by the dialog) rides the attach; the kernel writes it into the start row
  const ackOk = acked(localStorage, myPrincipal());
  const req = req0 && req0.kind === 'voice.session.start' && req0.payload.mode === 'conversation' && ceil && ackOk ? { ...req0, payload: { ...req0.payload, send: ceil, liabilityAck: VOICE_LIABILITY_ACK_HASH } } : req0;
  if (!req) return;
  if (voiceBusy) return;
  voiceBusy = true;
  try {
    // V2e seamless: attaching (or choosing Ambient) while the voice app is not running starts it in the same gesture
    if (to !== 'off' && needsStart(clientOf(status))) {
      await client.call('log.append', clientRequest('start', currentCapture()));
      notice('Starting voice…');
    }
    const r = await client.call<Record<string, unknown>>('log.append', req);
    if (r.pending === true && typeof r.cardId === 'string') {
      // Aegis L (V2d): approve in this gesture ONLY the voice-widen presence card for this session; else the stack decides
      if (!isVoiceWidenCard(store.cards.get(r.cardId), hsid)) {
        focusCard(r.cardId);
        notice(`Ambient for ${sessionName(hsid ?? '')}: decide the pending card in the stack`);
        noticeCard = { cardId: r.cardId, seen: store.cards.has(r.cardId) };
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
    await client.call('log.append', op === 'start' ? clientRequest('start', currentCapture()) : clientRequest(op));
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
      if (needsStart(clientOf(status))) await client.call('log.append', clientRequest('start', currentCapture()));
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
/* ── S2.8 ⊞ Layout: the presets and the pane toggles (kernel-owned chrome is never a toggle) ── */
function openLayoutMenu(): void {
  const m = $('layout-menu');
  clear(m);
  const item = (cmd: string, name: string, note: string, on = false) => h(doc, 'button', { class: `mode-item${on ? ' current' : ''}`, type: 'button', role: 'menuitem', 'data-run': cmd }, h(doc, 'span', { class: 'mode-name' }, name), h(doc, 'span', { class: 'mode-note' }, note));
  for (const name of Object.keys(PRESETS)) m.appendChild(item(`layout.${name}`, `Layout: ${name}`, name === 'desk' ? 'sessions · chat · stack' : name === 'focus' ? 'the chat only' : 'the stack wide', layout.name === name) as unknown as Node);
  m.appendChild(item('pane.sessions.toggle', `${layout.visible.sessions ? 'Hide' : 'Show'} sessions`, 'pane') as unknown as Node);
  m.appendChild(item('pane.stack.toggle', `${layout.visible.stack ? 'Hide' : 'Show'} the stack`, 'pane') as unknown as Node);
  m.appendChild(item('pane.workshop.toggle', `${layout.visible.workshop ? 'Hide' : 'Show'} the Workshop`, 'pane') as unknown as Node);
  for (const p of WORKSHOP_PLACES) m.appendChild(item(`workshop.${p}`, `Workshop: ${p}`, p === 'footer' ? 'a strip under the desk' : `a column on the ${p}`, layout.visible.workshop && layout.workshop === p) as unknown as Node);
  m.hidden = false;
  $('layout-btn').setAttribute('aria-expanded', 'true');
}
function closeLayoutMenu(): void {
  $('layout-menu').hidden = true;
  $('layout-btn').setAttribute('aria-expanded', 'false');
}

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
  palItems.forEach((c, i) => l.appendChild(h(doc, 'div', { class: `pal-row${i === palSel ? ' sel' : ''}${c.verb && !c.available ? ' unavailable' : ''}`, role: 'option', 'data-id': c.id }, h(doc, 'span', { class: 'pal-title' }, c.title), h(doc, 'kbd', { class: 'pal-kbd' }, c.keys ?? c.why ?? c.id)) as unknown as Node));
}
/** Run a command; `trusted` is the gesture's browser trust flag (Event.isTrusted; Aegis L2/L3): a request-making command needs it. */
function run(id: string, trusted: boolean): void {
  $('palette').hidden = true;
  if (id.startsWith('theme.')) keep(THEME_KEY, (theme = parseTheme(id.slice(6))));
  else if (id === 'motion.reduce' || id === 'motion.system') keep(MOTION_KEY, (motion = parseMotion(id.slice(7))));
  else if (id.startsWith('voice.preset.')) void chooseVoicePreset(parsePreset(id.slice('voice.preset.'.length)), trusted);
  else if (id === 'voice.sendword.teach') openTeach(null);
  else if (id === 'voice.mic.toggle') void micToggle(trusted);
  else if (id === 'settings.open') settings.open();
  else if (id === 'mods.open') modsPanel.open();
  else if (id.startsWith('layout.')) layout = applyPreset(id.slice(7), layout.workshop);
  else if (id === 'pane.sessions.toggle') layout = togglePane(layout, 'sessions');
  else if (id === 'pane.stack.toggle') layout = togglePane(layout, 'stack');
  else if (id === 'pane.workshop.toggle') layout = togglePane(layout, 'workshop');
  else if (id === 'workshop.footer' || id === 'workshop.right' || id === 'workshop.left') layout = placeWorkshop(layout, id.slice(9) as WorkshopPlace);
  else if (id === 'stack.scope.toggle') {
    stackScoped = !stackScoped;
    void paintStack();
  } else if (id === 'session.new') {
    clearCwdHint(hintTarget()); // Aegis L2: a hint belongs to the launch that verified it, not to a later "+ new"
    $('new-session-dialog').hidden = false;
    modelPicker?.onDialogOpen();
  }
  else if (id === 'session.rename') startRename(focused, 'head', trusted);
  else if (id === 'composer.focus') $('composer-text').focus();
  else if (id === 'view.kernel-feed') {
    // S2.3: the raw kernel feed, on demand only (it is never the default centre)
    if (width) widths.save(transcriptId(), width, heights);
    focused = null;
    feedView = true;
    resetTranscript();
    paintSessions();
    void paintStack();
  }
  else if (id.startsWith('mode.repo.') && (RUN_MODES as readonly string[]).includes(id.slice(10))) void setMode(id.slice(10) as RunMode, 'repo', trusted);
  else if (id.startsWith('mode.') && (RUN_MODES as readonly string[]).includes(id.slice(5))) void setMode(id.slice(5) as RunMode, 'session', trusted);
  else if (id === 'voice.client.start') void voiceClientOp('start', trusted);
  else if (id === 'voice.client.stop') void voiceClientOp('stop', trusted);
  else if (id === 'voice.enrol') {
    settings.close(); // the enrol dialog takes the screen (Esc then closes it, not a sheet under it)
    openEnrol(trusted);
  }
  else if (id.startsWith('voice.delay.')) setDictationDelay(parseDelay(id.slice(12)));
  else if (id === 'voice.dictation.hold') {
    // Hold belongs beside a countdown only: an ambient draft (or auto-send off) has nothing to hold
    if (hasDraft(dict) && draftControls(dict).hold === null) notice('nothing to hold: this draft never sends itself (Enter sends it)');
    else dispatchDictation({ type: 'hold', hold: !dict.hold, now: Date.now() });
  }
  else if (id.startsWith('voice.') && (VOICE_STATES as readonly string[]).includes(id.slice(6))) void setVoice(id.slice(6) as VoiceState, voiceTargetFor(id.slice(6) as VoiceState), trusted);
  else if (id === 'gui.reconnect' && trusted) void attach({ reconnect: true }, null);
  else if (id === 'diag.send' && trusted && session) void gnomonPost(fetch, '/diag', session.guiToken, `diag from palette at ${new Date().toISOString()}`);
  else if (id === 'verb.status' && client) void client.call('status').then((s) => (status = s as Record<string, unknown>));
  applyLook();
  applyLayout();
  settings.repaint();
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
  $('status-line').addEventListener('click', (e) => run('view.kernel-feed', e.isTrusted)); // S5.4: the readout links to the kernel feed
  $('jump-latest').addEventListener('click', () => {
    follow.jump();
    paintTranscript();
    $('composer-text').focus();
  });
  // S2.5: an activity line expands / collapses its steps (click or Enter / Space)
  const toggleAct = (t: EventTarget | null): void => {
    const a = (t as HTMLElement | null)?.closest('[data-act]') as HTMLElement | null;
    if (!a) return;
    const k = a.dataset.act!;
    if (expandedActs.has(k)) expandedActs.delete(k);
    else expandedActs.add(k);
    paintTranscript();
  };
  wireOfferSlips($('viewport'), onOfferAct); // #gui-offer-slip: trusted Open (two-step) / not now
  $('viewport').addEventListener('click', (e) => {
    const c = (e.target as HTMLElement).closest('.choices.live [data-choice]') as HTMLElement | null;
    if (c) return onChoice(e, c);
    toggleAct(e.target);
  });
  // #gui-table-talk: inside the live choices a letter / number picks (only with an empty composer); arrows move
  $('viewport').addEventListener('keydown', (e) => {
    const g = (e.target as HTMLElement).closest('.choices.live') as HTMLElement | null;
    if (!g || e.metaKey || e.ctrlKey || e.altKey) return;
    const bs = [...g.querySelectorAll<HTMLElement>('[data-choice]')];
    const at = bs.indexOf(e.target as HTMLElement);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      return bs[(at + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : bs.length - 1)) % bs.length]?.focus();
    }
    const ta = $<HTMLTextAreaElement>('composer-text');
    const c = choiceForKey(e.key, bs.map((b) => ({ key: b.dataset.choice ?? '', label: '' })), !ta.value.trim() && !(dictationOn() && dict.focusedHere && hasDraft(dict)));
    const b = c ? bs.find((x) => x.dataset.choice === c.key) : undefined;
    if (b) {
      e.preventDefault();
      b.focus(); // Aegis M1: a key only moves focus; Enter or Space confirms
    }
  });
  $('viewport').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      if (!(e.target as HTMLElement).closest('[data-act]')) return;
      e.preventDefault();
      toggleAct(e.target);
    }
  });
  $('empty-new').addEventListener('click', (e) => run('session.new', e.isTrusted));
  $('layout-btn').addEventListener('click', () => ($('layout-menu').hidden ? openLayoutMenu() : closeLayoutMenu()));
  $('layout-menu').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-run]') as HTMLElement | null;
    if (!b) return;
    closeLayoutMenu();
    run(b.dataset.run!, e.isTrusted);
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
    if ((e.target as HTMLElement).closest('[data-past-toggle]')) {
      pastOpen = !pastOpen;
      localStorage.setItem(PAST_KEY, pastOpen ? '1' : '0');
      return paintSessions();
    }
    const b = (e.target as HTMLElement).closest('[data-hsid]') as HTMLElement | null;
    if (b) focus(b.dataset.hsid || null);
  });
  $('session-search').addEventListener('input', paintSessions);
  // #gui-session-rename: double-click a row (or F2 on it) renames it in place; double-click or ✎ in the header
  $('session-list').addEventListener('dblclick', (e) => {
    const b = (e.target as HTMLElement).closest('button[data-hsid]') as HTMLElement | null;
    if (b) startRename(b.dataset.hsid || null, 'list', e.isTrusted);
  });
  $('session-list').addEventListener('keydown', (e) => {
    const b = (e.target as HTMLElement).closest('button[data-hsid]') as HTMLElement | null;
    if (b && (e as KeyboardEvent).key === 'F2') {
      e.preventDefault();
      startRename(b.dataset.hsid || null, 'list', e.isTrusted);
    }
  });
  $('transcript-title').addEventListener('dblclick', (e) => startRename(focused, 'head', e.isTrusted));
  $('rename-btn').addEventListener('click', (e) => startRename(focused, 'head', e.isTrusted));
  const onCard = (e: Event): void => {
    const b = (e.target as HTMLElement).closest('[data-decision]') as HTMLElement | null;
    if (b && e.isTrusted) void decide(b.dataset.cardId!, b.dataset.decision!, b.closest('[data-card-id].card') as HTMLElement | null, b);
    const k = (e.target as HTMLElement).closest('[data-command]') as HTMLElement | null;
    if (k && e.isTrusted && BLOCK_SAFE_COMMANDS.has(k.dataset.command!)) run(k.dataset.command!, e.isTrusted);
  };
  $('stack').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-pile-more]')) {
      pileOpen = true;
      return void paintStack();
    }
    onCard(e);
  });
  $('pinned').addEventListener('click', onCard);
  $('stack-scope').addEventListener('click', (e) => run('stack.scope.toggle', e.isTrusted));
  $('composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = $<HTMLTextAreaElement>('composer-text');
    // Aegis M3: a dictated draft stays shown until the kernel took it (the reducer then sets what remains)
    const viaDictation = dictationOn() && dict.focusedHere && dict.parts.length > 0 && hasDraft(dict);
    // L2: a chip pick is marked picked only once the kernel took it; the composer clears only when the message went out
    const pp = pendingPick;
    pendingPick = null;
    void send(t.value, () => {
      if (!viaDictation) t.value = '';
    }).then((ok) => {
      if (!pp || !ok) return;
      pickedChoices.set(pp.item, pp.key);
      remountItem(pp.item);
      paintTranscript();
    });
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
  $('new-session').addEventListener('click', (e) => run('session.new', e.isTrusted));
  $('mode-btn').addEventListener('click', () => ($('mode-menu').hidden ? openModeMenu() : closeModeMenu()));
  $('mode-menu').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-mode], [data-mode-scope]') as HTMLButtonElement | null;
    if (!b || b.disabled) return;
    if (b.dataset.modeScope) {
      // the secondary scope (F2): the same three choices in the palette — mode.* for this session only, mode.repo.* for the folder
      closeModeMenu();
      return openPalette(b.dataset.modeScope === 'repo' ? 'mode.repo.' : 'mode.');
    }
    void setMode(b.dataset.mode as RunMode, defaultScope(currentMode()), e.isTrusted);
  });
  $('voice-pill').addEventListener('click', () => ($('voice-menu').hidden ? openVoiceMenu() : closeVoiceMenu()));
  // TD-2026-10-21-514: the guided send-word dialog and the liability acknowledgement (in-app dialogs, never prompt/confirm)
  $('sendword-form').addEventListener('submit', (e) => {
    e.preventDefault();
    void submitTeach(e.isTrusted);
  });
  $('sendword-cancel').addEventListener('click', () => void closeTeach());
  $('sendword-no').addEventListener('click', () => void teachStep({ type: 'confirmCommon', yes: false }));
  $('sendword-suggestions').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-sendword]') as HTMLElement | null;
    if (b && e.isTrusted) void teachStep({ type: 'pick', text: b.dataset.sendword! });
  });
  $('ack-agree').addEventListener('change', () => (($('ack-go') as HTMLButtonElement).disabled = !$<HTMLInputElement>('ack-agree').checked));
  $('ack-form').addEventListener('submit', (e) => {
    e.preventDefault();
    submitAck(e.isTrusted);
  });
  $('ack-cancel').addEventListener('click', () => closeAck());
  $('voice-stop').addEventListener('click', (e) => void stopSpeaking(e.isTrusted));
  $('voice-menu').addEventListener('click', (e) => {
    const dd = (e.target as HTMLElement).closest('[data-dictation-delay]') as HTMLElement | null;
    if (dd) return setDictationDelay(parseDelay(dd.dataset.dictationDelay!));
    const vp = (e.target as HTMLElement).closest('[data-voice-preset]') as HTMLElement | null;
    if (vp) return void chooseVoicePreset(parsePreset(vp.dataset.voicePreset!), e.isTrusted);
    if ((e.target as HTMLElement).closest('[data-voice-sendword]') && e.isTrusted) return openTeach(null);
    const cp = (e.target as HTMLElement).closest('[data-capture]') as HTMLElement | null;
    if (cp && e.isTrusted) {
      capturePref = parseCapturePref(cp.dataset.capture ?? null);
      localStorage.setItem(CAPTURE_KEY, capturePref);
      void applyCapture();
      return paintVoiceMenu();
    }
    const mk = (e.target as HTMLElement).closest('[data-mic-key]') as HTMLElement | null;
    if (mk) return void setMicKey(mk.dataset.micKey === 'bare', e.isTrusted);
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
  document.addEventListener('click', (e) => {
    if (!$('voice-menu').hidden && !(e.target as HTMLElement).closest('.voice-wrap')) closeVoiceMenu();
  });
  // fidelity 2: the ⋯ menu holds the item counts and the raw toggle (the comp's header has neither)
  $('more-btn').addEventListener('click', () => ($('more-menu').hidden ? openMoreMenu() : closeMoreMenu()));
  document.addEventListener('click', (e) => {
    if (!$('more-menu').hidden && !(e.target as HTMLElement).closest('.more-wrap')) closeMoreMenu();
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
    const cwd = $<HTMLInputElement>('ns-cwd').value;
    const model = modelPicker ? modelPicker.openModel($<HTMLSelectElement>('ns-model').value) : $<HTMLSelectElement>('ns-model').value;
    if (model === null) return; // #gui-model-picker: an invalid custom id stays in the sheet with its reason
    modelPicker?.remember(cwd, model);
    $('new-session-dialog').hidden = true;
    clearCwdHint(hintTarget());
    void openSession(cwd, model);
  });
  $('reconnect-btn').addEventListener('click', () => void attach({ reconnect: true }, null));
  $('palette-btn').addEventListener('click', () => openPalette());
  // #gui-settings: the header switch and the ⚙ key (presentation only: no request leaves the page)
  $('theme-switch').addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('[data-run]') as HTMLElement | null;
    if (b && e.isTrusted && b.dataset.run!.startsWith('theme.')) run(b.dataset.run!, true); // Aegis L2: the human's own press
  });
  $('settings-btn').addEventListener('click', () => (settings.isOpen() ? settings.close() : settings.open()));
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
    else if (e.key === 'Enter' && palItems[palSel]) return run(palItems[palSel]!.id, e.isTrusted);
    else if (e.key === 'Escape') return void ($('palette').hidden = true);
    else return;
    e.preventDefault();
    paintPalette();
  });
  $('palette-list').addEventListener('click', (e) => {
    const r = (e.target as HTMLElement).closest('[data-id]') as HTMLElement | null;
    if (r) run(r.dataset.id!, e.isTrusted);
  });
  // TD-2026-10-21-514: a hidden page never counts toward the send word's visibility
  document.addEventListener('visibilitychange', () => dispatchDictation({ type: 'pageVisible', visible: document.visibilityState === 'visible', now: Date.now() }));
  document.addEventListener('keydown', (e) => {
    // TD-2026-10-21-514: a bare ` toggles the mic inside Gnomon (window focused, not typing in a field)
    if (e.key === '`' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat && document.hasFocus() && !editableFocus() && canAttach(status)) {
      e.preventDefault();
      return void micToggle(e.isTrusted);
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openPalette();
    } else if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key === ',') {
      e.preventDefault(); // #gui-settings: ⌘, as in every Mac app
      $('palette').hidden = true;
      settings.open();
    } else if (e.key === 'Escape' && !$('ack-dialog').hidden) {
      closeAck();
    } else if (e.key === 'Escape' && !$('sendword-dialog').hidden) {
      void closeTeach();
    } else if (e.key === 'Escape' && dict.grace) {
      e.preventDefault(); // TD-2026-10-21-514: "Sending… Esc keeps it"
      dispatchDictation({ type: 'graceCancel', now: Date.now() });
    } else if (e.key === 'Escape' && settings.isOpen()) {
      settings.close();
    } else if (e.key === 'Escape' && modsPanel.isOpen()) {
      modsPanel.close();
    } else if (e.key === 'Escape' && !$('mode-menu').hidden) {
      closeModeMenu();
    } else if (e.key === 'Escape' && !$('voice-menu').hidden) {
      closeVoiceMenu();
    } else if (e.key === 'Escape' && !$('enrol-dialog').hidden) {
      void closeEnrol(e.isTrusted);
    } else if (e.key === 'Escape' && escStopsSpeaking({ shown: stopSpeakingShown(status), menuOpen: !$('mode-menu').hidden || !$('voice-menu').hidden, dialogOpen: !$('palette').hidden || !!document.querySelector('.overlay:not([hidden])') || !!(document.activeElement as HTMLElement | null)?.closest?.('[role="dialog"]'), inComposer: !!(document.activeElement as HTMLElement | null)?.closest?.('#composer') || document.activeElement === $('composer-text') })) {
      e.preventDefault();
      void stopSpeaking(e.isTrusted);
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      run('session.new', e.isTrusted);
    }
  });
  window.addEventListener('error', (e) => {
    if (session) void gnomonPost(fetch, '/diag', session.guiToken, `error ${String(e.message).slice(0, 2000)}`).catch(() => undefined);
  });
}

/* ── boot ───────────────────────────────────────────────────────── */
/** DEV ONLY (#gui-preview offer-armed): paint the next live slip armed. src/main.ts never calls it; in-page code could
 * already call the kernel client directly, so this widens nothing (the send still needs a trusted press). */
export function devArmOfferOnce(): void {
  if (__GNOMON_PREVIEW__) devArmOffer = true; // L1: false in scripts/build.mjs, so the served bundle drops it
}

export function main(raw?: string): void {
  const take = (globalThis as { gnomonTakeLaunch?: () => string }).gnomonTakeLaunch;
  const frag = parseLaunchFragment(raw ?? (take ? take() : ''));
  layout = parseLayout(localStorage.getItem(LAYOUT_KEY) ?? '') ?? layout; // S5.2: the saved Layout (read at start, not at import)
  theme = parseTheme(stored(THEME_KEY)); // #gui-settings: the theme and motion choices, per browser
  motion = parseMotion(stored(MOTION_KEY));
  applyLook();
  applyLayout();
  wire();
  paintChatHead(); // S2.3: the quiet empty centre until a session is focused
  paintSessions(); // the ACTIVE / PAST heads show before the first row arrives
  // #bare-entry: the folder hint is decoded here but applied by attach only after the token verified (Aegis M1)
  // TD-2026-10-19-063: the page that accepted an upgrade reloads once and reattaches with the single-use resume form
  const resumed = frag ? (clearRestarting(sessionStorage), null) : takeRestart(sessionStorage);
  if (frag) void attach({ launchToken: frag.launchToken }, frag.kernelPublicKey, frag.cwd !== undefined ? cwdHintOf(frag.cwd) : null);
  else if (resumed) void attach({ resumeToken: resumed.resumeToken }, resumed.kernelPublicKey);
  else showReconnect('This page has no GUI session (a reload, a restart or a token-less launch). Reconnect asks for your presence.');
}
