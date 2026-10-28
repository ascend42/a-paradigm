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
import { isCardDecidable, sanitizeDisplayText, VOICE_LIABILITY_ACK_HASH } from '@a-company/gnomon-contracts';
import { initialTeach, reduceTeach, teachCommit, type TeachEvent, type TeachState } from '../core/send-word-teach.js';
import { replyModeOf, replyModeRequest, type ReplyMode } from '../core/voice-ladder.js';
import { chooseRung, clientFactOf, crashCauseOf, inputChoices, ladderAria, ladderEntries, ladderFoot, ladderTargetLine, presetOfRung, rungNameOf, rungOf, rungOfPresetCommand, sendOfRung, sheetRows, stateOfRung, voicePillOf, type Readiness, type Rung, type SheetSection } from '../core/voice-ladder.js';
import { ladderEls, mountVoiceSheet, trapNext, type FlowView, type SheetView } from './voice-settings.js';
import { COMPOSER_LINES, composerFit, fitTallRoom, lineCountLabel, lineCountShown, parseTall, serializeTall, TALL_FEED_MIN_PX, TALL_KEY } from '../core/composer.js';
import { acked, ackedAt, attachSend, captureOf, CAPTURE_KEY, parseCapturePref, parsePreset, policyOf, PRESET_KEY, recordAck, saidTag, sendWordOf, voiceWho } from '../core/voice-presets.js';
import { followLog, GnomonClient, GUI_CLIENT, gnomonPost, RpcError, webSocketTransport, type Session, type ShownRefusal } from '../core/client.js';
import { clearRestarting, markRestarting, noteResume, peekResumeKey, restarting, RESTART_GUIDANCE, RESTART_KEY_REFUSED, resumeRepinText, takeRestart, upgradeBannerOf, waitForOrigin } from '../core/restart.js';
import { applyPreset, BLOCK_SAFE_COMMANDS, filterCommands, paletteEntries, parseLayout, placeWorkshop, resolveMotion, resolveTheme, serializeLayout, togglePane, type Command, type Layout, type ThemeChoice, type WorkshopPlace } from '../core/commands.js';
import { parseStaleMsg, STALE_CHANNEL, staleView, watchStale, type StaleState } from '../core/stale.js';
import { applyCwdHint, clearCwdHint, cwdHintOf, decidePin, type CwdHint, type CwdHintTarget, hostSurface, parseLaunchFragment, PIN_KEY } from '../core/launch.js';
import { rootRowsOf, approveParamsOf, editScopesOf, isBrokeredCard, askDetailOf, askNote, displayText, localNsOf, markCardBody, permissionTitleOf, prefixOptionsOf, cardFlags, cardVoiceOf, h, mdBlocks, mdInline, renderCard, stampWord, type MiniDoc, type MiniEl, type ScrollBodyEl, gitVerbOf, toolScopesOf } from '../core/render.js';
import { base64UrlToBytes, keyIdOfSpki, verifiedDecisions } from '../core/server-sig.js';
import { Follow, INTENT_MS, ScrollIntent, scrollEvent } from '../core/follow.js';
import { choiceForKey, liveChoiceKey, pickChoice, pickChoices, renderChoices, replyChoices, replyHash, toggleChoice } from '../core/choices.js';
import { ASK_COPY, askComplete, askMissingText, askMove, askOptForKey, askPress, askPressOther, askPreviewOf, askSummary, askTabStop, askType, emptyPicks, type AskPicks } from '../core/ask-card.js';
import { armStanding, decideRequest, OFFER_ARM_TTL_MS, openStep, slipViews, type OfferArm, type SlipView } from '../core/offers.js';
import { publisherDisplayOf } from '../core/mod-label.js';
import { renderOfferSlip, wireOfferSlips } from './offer-slip.js';
import { renderHostSlips, wireHostSlips } from './host-slip.js';
import { copyTextOf, hostHintsOf, type HostHint } from '../core/host-hints.js';
import { bindInlineRename, planRename, renameRequest, type RenameBinding } from '../core/rename.js';
import { chatItems, derivedTitle, rowDetail, durationText, foldActivity, foldRaw, groupHue, rawFoldKey, GuiStore, isLiveState, replyParts, rowOf, sessionFullTitle, sessionNote, sessionTitle, splitActivePast, UNSCOPED, type ChatItem, type FoldedItem, type Row } from '../core/store.js';
import { HeightIndex, visibleRange, WidthCache } from '../core/virtual.js';
import { changedBefore, hasLive, LiveTicker, liveText, stepClockText, workParts } from '../core/live-turn.js';
import { stepFoldKey, stepParts, stepsFoldKey, stepText, withStepFolds } from '../core/turn-steps.js';
import { mountStandingFeed } from './standing-feed.js';
import { cardIn, notArrivedText, uncoverStack, type CardLabel, type CoveringSheet } from './card-focus.js';
import { mountToasts, noticeChannel, type Notice, type NoticeOptions, type ToastHandle, type Toasts } from './toasts.js';
import { trustDropToastOf, TRUST_DROP_TOAST, type ToastKind } from '../core/toasts.js';
import { mountSettings } from './settings-sheet.js';
import { afterSave, applyRequest, beforeClose as rulesBeforeClose, discard as rulesDiscard, emptyRulesUi, expiryToastOf, reconcile as rulesReconcile, refusedResult, RULE_ROW_KINDS, rulesBlock, rulesStatusOf, stageOff, stageOn, stageRemove, toggleFold, toggleOffMenu, unstage, type RulePreset } from '../core/rules.js';
import { LocalModelController } from './local-model.js';
import { McpServersController } from './mcp-servers.js';
import { MCP_SECTION } from '../core/mcp-servers.js';
import { changeForm, localCurrentOf, localStatusOf, requestLine, setupForm, LOCAL_SECTION } from '../core/local-model.js';
import { MOTION_KEY, parseMotion, parseTheme, settingsModel, THEME_KEY, themeSwitchEntries, unlockSeenOf } from '../core/settings.js';
import { isKernelPrincipal, kernelPrincipalOf, revokeRequest } from '../core/standing.js';
import { defaultScope, EDIT_RULE_REVOKE_LABEL, EDIT_RULE_REVOKE_NOTE, EDITS_BY_RULE_CHIP, EDITS_BY_RULE_NARROW, EDITS_BY_RULE_NARROW_NAME, menuEntries, modeChip, modeLabel, modeRequest, nextRunMode, planFor, RUN_MODES, scopeEntries, sessionModeOf, type ModeScope, type RunMode } from '../core/modes.js';
import { captureDismiss, captureDisplayOf, capturePollMs, captureStatusOf, captureStep, freshCapture, meterShownOf, type CaptureTrack, type GhostText, voiceRefusalText } from '../core/capture.js';
import { appMenuModel, APP_MENU_RUNS, linkView, menuKey, PANES_RUN, triggerKey, whoLine, type AppMenuRow, type LinkState } from '../core/header.js';
import { CLIENT_POLL_MS, clientOf, clientPillOf, micTitleLine, clientPollWanted, pillActionOf, clientRequest, stopSpeakingRequest, devBannerOf, enrolAllowed, enrolNudgeOf, ENROL_POLL_MS, enrolRequest, enrolSent, enrolStart, ERROR_TITLE_MAX, forgetRequest, isEnrolCard, needsStart, noticeOf, oneLine, reduceEnrolStatus, toastFresh } from '../core/voice-client.js';
import { DELAY_KEY, DICTATION_POLL_MS, delayLabel, placeWords, plainAppend, type TextRange, dictationNote, dictationStatusOf, draftControls, hasDraft, inheritedQuote, initialDictation, liveLine, parseDelay, pieceFraction, reduceDictation, releaseTurnRows, ringFraction, ringRemaining, sendClaim, sendRequest, serializeDelay, uncheckedWords, unverifiedQuote, unverifiedTextsOf, type DictationEvent, type QueuedTurnRow } from '../core/dictation.js';
import { modPanelsFocus, modPanelsStatus, mountModPanels } from './mod-panels-mount.js';
import { mountMods } from './mods-panel.js';
import { mountModelPicker, type ModelPicker } from './model-picker.js';
import { mountTierPicker, type TierPicker } from './tier-picker.js';
import { KeptFlow, mountToolsDrawer, type ToolsDrawer } from './tools-drawer.js';
import { drawerAccess, mcpFailToastOf, MCP_FAIL_TOAST, serversOffOf, serversOffText } from '../core/tools-drawer.js';
import { mountSlashMenu, renderRunRow, type SlashMenu } from './slash-menu.js';
import { SLASH_COMMANDS } from '../core/slash-menu.js';
import { runWords } from '../core/slash-runs.js';
import { binaryChangedLine, cardOutcomeOf, FolderField, FF_COPY, REPIN_COPY, RepinReturn, type KeptChoice } from '../core/folder-field.js';
import { mountFolderField, type MountedFolderField } from './folder-field.js';
import { sessionModelOf, sessionModelText } from '../core/model-picker.js';
import { alertEl, mountLoopsView, slipEl as loopSlipEl } from './loops-view.js';
import { loopsOff, cardLoopOf, choicePath, loopCardTitle, leafMeta, loopAlerts, loopRowToast, loopsOf, loopsWord, pauseAllText, PAUSE_ALL_REQUEST, trustSlip } from '../core/loops.js';
import { canAttach, cardNoticeStep, escStopsSpeaking, isVoiceWidenCard, SPEAK_POLL_MS, SPEAK_WATCH_MS, speakPollWanted, stopSpeakingShown, planVoice, sessionName, voiceRefusalNote, voiceRequest, voiceStatusOf, type VoiceState } from '../core/voice.js';

const doc = document as unknown as MiniDoc;
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const clear = (el: HTMLElement): void => {
  while (el.firstChild) el.removeChild(el.firstChild);
};
const put = (el: HTMLElement, s: string): void => {
  el.textContent = sanitizeDisplayText(s).text;
};

/**
 * The #bare-entry hint box: applyCwdHint writes the note and the prefill here (values and text only); the New session
 * sheet's folder field shows them (the prefill is CHECKED by the kernel and chosen "from terminal"; never submitted).
 */
const hintBox: CwdHintTarget = { input: { value: '' }, note: { textContent: '', hidden: true }, dialog: { hidden: true } };
const hintTarget = (): CwdHintTarget => hintBox;

const store = new GuiStore();
let client: GnomonClient | null = null;
let session: Session | null = null;
let verifyKey: string | null = null;
let status: Record<string, unknown> | null = null;
store.loopCardsHidden = () => loopsOff(loopsOf(status)); // TD-2026-10-24-447: stale 8.0.0 loop cards are neither shown nor counted
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
let tierPicker: TierPicker | null = null;
/** #gui-capability-browser (C6'b1): the Tools and memory drawer of a local session (ui/tools-drawer.ts), mounted below */
let toolsDrawer: ToolsDrawer | null = null;
let slashMenu: SlashMenu | null = null;
/** #gui-toast: the one toast region (ui/toasts.ts), mounted on first use (the chat column's right edge). */
let toastRegion: Toasts | null = null;
const toasts = (): Toasts =>
  (toastRegion ??= mountToasts(document, $('toasts'), { say: document.getElementById('toast-say'), alert: document.getElementById('toast-alert'), returnFocus: () => $('voice-pill') }));
let noticeOut: Notice | null = null;
/** The toast the last notice() showed (cardWait keeps it to clear it when its card arrives). */
let noticeShown: ToastHandle | null = null;
/**
 * A GUI outcome as a toast (board gnomon-notices: the band keeps kernel alerts only). kind by meaning: info for an
 * outcome, warn for "not yet" and an asks-first step (held: it stays until cleared or replaced), fail for a refusal.
 * A source names the action: its fail clears when the same source succeeds (ui/toasts.ts noticeChannel).
 * notice(null) clears the last one: its cause was resolved.
 */
function notice(msg: string | null, kind: ToastKind = 'info', opts: NoticeOptions = {}): void {
  noticeCard = null; // any new notice (or a clear) replaces the card's
  noticeShown = (noticeOut ??= noticeChannel(toasts()))(msg, kind, opts);
}
/** A "card has not arrived yet" warn, cleared when that card shows in the stack (checked on every stack paint). */
let cardWait: { cardId: string; toast: ToastHandle } | null = null;
function checkCardWait(): void {
  if (!cardWait) return;
  if (!cardWait.toast.present) cardWait = null;
  else if (cardInPile(cardWait.cardId)) {
    cardWait.toast.dismiss();
    cardWait = null;
  }
}

// Mika Delta 11: a page-local line (the question card's early Submit) has no kernel code: just its words
function refusalText(r: ShownRefusal): string {
  return `${r.code ? `${r.code}${r.reason ? ` ${r.reason}` : ''}  ` : ''}${r.message}${r.next.length ? `\n  next: ${r.next.join(' · ')}` : ''}`;
}

/* ── theme / motion ─────────────────────────────────────────────── */
const darkQ = matchMedia('(prefers-color-scheme: dark)');
const motionQ = matchMedia('(prefers-reduced-motion: reduce)');
function applyLook(): void {
  document.documentElement.dataset.theme = resolveTheme(theme, darkQ.matches);
  document.documentElement.dataset.motion = resolveMotion(motion, motionQ.matches);
  // #gui-wordmark-menu: the theme row in the open Gnomon menu shows the choice (auto names what it resolves to now)
  if (document.getElementById('wordmark-menu')?.hidden === false) paintAppMenu();
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
/** founder report 2026-10-23: only the user's own scroll changes stickiness (core/follow.ts scrollEvent) */
const intent = new ScrollIntent();
const mounted = new Map<number, HTMLElement>();
/**
 * Founder report 2026-10-23: a mounted row that changes height by itself (a web font arriving, a slip settling, a
 * fold) repaints the feed, so a stuck feed stays at the bottom and a reading position stays where it is. Rows are
 * observed from the next frame (watchRow), so a paint this callback runs never queues a same-frame notification.
 */
const rowSizes = new ResizeObserver(() => {
  for (const [i, el] of mounted)
    if (el.isConnected && el.offsetHeight && el.offsetHeight !== heights.height(i)) {
      paintTranscript();
      return;
    }
});
const rowsToWatch = new Set<HTMLElement>();
let watchQueued = false;
function watchRow(el: HTMLElement): void {
  rowsToWatch.add(el);
  if (watchQueued) return;
  watchQueued = true;
  requestAnimationFrame(() => {
    watchQueued = false;
    for (const r of rowsToWatch) if (r.isConnected) rowSizes.observe(r);
    rowsToWatch.clear();
  });
}
/** Take a row out of the feed (and out of the size watch). */
function dropRow(el: HTMLElement): void {
  el.remove();
  rowSizes.unobserve(el);
  rowsToWatch.delete(el);
}
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
  // raw rows fold the same way: an expanded one shows its whole line under it
  // #gui-turn-steps: the working key's list unfolds (and a step to its rows, rowDetail: the raw fold's redaction)
  const out = raw ? { items: foldRaw(base2.items, expandedActs), hidden: base2.hidden } : { items: foldActivity(withStepFolds(base2.items, rows, expandedActs, rowDetail), expandedActs), hidden: base2.hidden };
  memo = { key, out };
  return out;
}

function unmountAll(): void {
  for (const el of mounted.values()) dropRow(el);
  mounted.clear();
}

/** A new transcript (focus, raw toggle): rebuild from scratch, stuck to the bottom. */
function resetTranscript(): void {
  if (slashMenu?.flow.state()?.hsid !== focused) slashMenu?.close(); // #gui-slash-menu: the menu is the focused session's
  if (focused) void slashMenu?.flow.ensureSkills(focused); // the host slips of its replies read its loaded skills
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
  // #gui-model-picker: a streaming session repaints this header on every row; the model key stays put (its open
  // menu, its focus) and the parts around it are rebuilt before and after it
  // #gui-tool-tier: the tier key (a local session's) stays put the same way
  for (const n of Array.from(meta.childNodes)) if (!(n instanceof HTMLElement && (n.hasAttribute('data-model-chip') || n.hasAttribute('data-tier-chip')))) meta.removeChild(n);
  if (!s) {
    modelPicker?.headChip(meta, null);
    tierPicker?.headChip(meta, null);
  }
  if (s) {
    const g = store.groups().find((x) => x.sessions.some((y) => y.hsid === s.hsid));
    const hue = groupHue(s.repo ?? UNSCOPED, g?.sessions ?? [s]);
    const started = s.openedAt ? s.openedAt.slice(11, 16) : '';
    const mins = s.openedAt ? Math.max(0, Math.round((Date.now() - Date.parse(s.openedAt)) / 60_000)) : null;
    const proj = s.repo && s.repo !== UNSCOPED ? s.repo : 'unscoped';
    // Mika (2026-10-23 delta): the project name ellipsizes last and keeps its whole name in the title
    meta.prepend(h(doc, 'span', { class: `pink h${hue}`, title: proj }, '■ ', h(doc, 'span', { class: 'chead-proj' }, proj)) as unknown as Node, h(doc, 'span', { class: 'chead-backend' }, ` · ${backendWord(s.backend)}`) as unknown as Node);
    modelPicker?.headChip(meta, s.hsid); // #gui-model-picker: the kernel's model for this session, ▾ to switch
    tierPicker?.headChip(meta, s.hsid); // #gui-tool-tier: a local session's tool tier, ▾ to change it (its owner)
    // #gui-capability-browser (C6'b1): a server of this session that stopped is plain meta text, never a chip
    const off = s.backend === 'local' ? serversOffText(serversOffOf(store.transcript(s.hsid), s.hsid)) : '';
    if (off) meta.appendChild(h(doc, 'span', { class: 'chead-off' }, off) as unknown as Node);
    // Mika (2026-10-23): "started · 9m" is the one part that ellipsizes, so the model key is never the one clipped
    meta.appendChild(h(doc, 'span', { class: 'chead-when' }, `${started ? ` · started ${started}` : ''}${mins !== null && Number.isFinite(mins) ? ` · ${mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`}` : ''}`) as unknown as Node);
  }
  const t = s ? sessionTitle(s) : '';
  $<HTMLTextAreaElement>('composer-text').placeholder = s ? `Reply to ${t}${t.endsWith('…') ? '' : '…'}` : 'Open a session to write to it';
  const empty = $('empty');
  empty.hidden = !!focused || feedView;
  if (!empty.hidden) put($('empty-meta'), `${store.liveCount()} live · ${store.visibleCardCount()} need you`);
}

const ROLE_LABEL: Partial<Record<ChatItem['role'], string>> = { user: 'you', assistant: 'claude' };
/** A backend id as the vocabulary words it (design-system: "one Claude (or local model) conversation"). */
function backendWord(b: string | null | undefined): string {
  return b === 'local' ? 'local model' : (b ?? 'claude');
}
/** Who answers in the focused session: a local-model session's replies are the local model's, never "claude". */
function agentLabel(): string {
  return backendWord(focused ? store.sessions.get(focused)?.backend : undefined) === 'local model' ? 'local model' : 'claude';
}
/** The speaker label the mounted transcript rows were drawn with (Mika #4: remount when it changes). */
let mountedAgent: string | null = null;
/** table talk: an assistant body whose lines start with a bold label (the agent's own A/B/C, 1/2/3 or names) shows those lines as chips. */
function replyBody(it: ChatItem): MiniEl {
  // S2.5: agent text renders a SAFE markdown subset (DOM nodes only, never markup); the user's words stay verbatim
  if (it.role !== 'assistant') return h(doc, 'div', { class: 'body' }, it.text);
  // #gui-table-talk: trailing lettered options render as choice chips (core/choices.ts), live on the latest reply only
  const ch = replyChoices(it.text, it.said ?? null);
  const text = ch ? ch.body : it.text;
  const parts = replyParts(text);
  const chips = ch
    ? renderChoices(doc, it.key, ch.choices, { live: it.key === liveChoice, picked: pickedChoices.get(it.key) ?? null, armed: armedChoice?.item === it.key ? armedChoice.key : null, multi: ch.multi, toggled: toggledChoices.get(it.key) ?? null, pickedSet: pickedMulti.get(it.key) ?? null, sendArmed: armedSend === it.key, painted: replyHash(it.text, it.said ?? null) })
    : null;
  if (!parts.some((x) => 'label' in x)) return h(doc, 'div', { class: 'body md' }, ...mdBlocks(doc, text), chips);
  return h(doc, 'div', { class: 'body md' }, ...parts.map((x) => ('label' in x ? h(doc, 'div', { class: 'reply-part' }, h(doc, 'strong', { class: 'reply-part-label' }, x.label), ' ', ...mdInline(doc, x.text)) : h(doc, 'div', { class: 'plain' }, ...mdBlocks(doc, x.text)))), chips);
}
/** #gui-table-talk choices: the live reply's item key, and each reply's picked option (this page only). */
let liveChoice: string | null = null;
const pickedChoices = new Map<string, string>();
/** Aegis M1: the chip waiting for its confirming second activation; L2: the pick riding the composer submit */
let armedChoice: { item: string; key: string } | null = null;
let pendingPick: { item: string; key: string } | null = null;
/** #gui-ask-card multi-select: each live reply's toggled options, the reply whose Send key is armed, the sent sets */
const toggledChoices = new Map<string, Set<string>>();
let armedSend: string | null = null;
const pickedMulti = new Map<string, Set<string>>();
let pendingMulti: { item: string; keys: Set<string> } | null = null;
/** Repaint one transcript item (its chips changed state). */
function remountItem(key: string | null): void {
  if (key === null) return;
  for (const [i, el] of mounted)
    if (items[i]?.key === key) {
      dropRow(el);
      mounted.delete(i);
    }
}
/** Mika Delta 11: repaint the transcript rows about one card (its decided line learnt what was answered). */
function remountCardRows(cardId: string): void {
  for (const it of items) if (it.cardId === cardId) remountItem(it.key);
  paintTranscript();
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
  const liveKey = focused && !rawMode ? liveChoiceKey(cur) : null;
  if (replyChoices(it.text, it.said ?? null)?.multi) {
    // multi-select: a chip toggles (trusted, live, one of the reply's own); nothing is sent until Send
    const next = toggleChoice(e, { itemKey, liveKey, replyText: it.text, said: it.said ?? null, choiceKey: pick, painted: b.dataset.replyHash ?? '' }, toggledChoices.get(itemKey) ?? new Set());
    if (!next) return;
    toggledChoices.set(itemKey, next);
    if (armedSend === itemKey) armedSend = null;
    remountItem(itemKey);
    paintTranscript();
    ($('viewport').querySelector(`.choices.live [data-choice-item="${CSS.escape(itemKey)}"][data-choice="${CSS.escape(pick)}"]`) as HTMLElement | null)?.focus();
    return;
  }
  const armed = armedChoice?.item === itemKey && armedChoice.key === pick;
  const out = pickChoice(e, { itemKey, liveKey: focused && !rawMode ? liveChoiceKey(cur) : null, replyText: it.text, said: it.said ?? null, choiceKey: pick, painted: b.dataset.replyHash ?? '' }, {
    get value() {
      return ta.value;
    },
    set value(v: string) {
      ta.value = v;
      fitComposer();
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
/** A multi-select group's Send key: the toggled options as ONE human message, through the composer (trusted only). */
function onChoiceSend(e: Event, b: HTMLElement): void {
  const itemKey = b.dataset.choiceSend ?? '';
  const cur = currentItems().items;
  const it = cur.find((x) => x.key === itemKey);
  if (!it) return;
  const ta = $<HTMLTextAreaElement>('composer-text');
  const toggled = toggledChoices.get(itemKey) ?? new Set<string>();
  const out = pickChoices(e, { itemKey, liveKey: focused && !rawMode ? liveChoiceKey(cur) : null, replyText: it.text, said: it.said ?? null, painted: b.dataset.replyHash ?? '' }, toggled, {
    get value() {
      return ta.value;
    },
    set value(v: string) {
      ta.value = v;
      fitComposer();
    },
    dictationDraft: dictationOn() && dict.focusedHere && hasDraft(dict),
    submit: () => {
      pendingMulti = { item: itemKey, keys: new Set(toggled) };
      $<HTMLFormElement>('composer').requestSubmit();
    },
    focus: () => ta.focus(),
  }, armedSend === itemKey);
  if (out === 'refused') return;
  armedSend = out === 'confirm' ? itemKey : null;
  if (out === 'inserted') {
    if (dictationOn() && dict.focusedHere) dispatchDictation({ type: 'userEdit', text: ta.value, now: Date.now() });
    notice('the options are in the composer after your draft; nothing was sent');
  }
  remountItem(itemKey);
  paintTranscript();
  if (out === 'confirm') ($('viewport').querySelector(`.choices.live [data-choice-send="${CSS.escape(itemKey)}"]`) as HTMLElement | null)?.focus();
}
/** #gui-turn-steps: the unfolded list's scroll per working key; a remount (a new step) keeps it, and follows the end while it was there. */
const stepsScroll = new Map<string, { top: number; atEnd: boolean }>();
function restoreSteps(el: HTMLElement): void {
  const ol = el.querySelector('ol.steps') as HTMLElement | null;
  if (!ol) return;
  const k = ol.dataset.item ?? '';
  const was = stepsScroll.get(k);
  ol.scrollTop = !was || was.atEnd ? ol.scrollHeight : was.top;
  ol.addEventListener('scroll', () => {
    stepsScroll.set(k, { top: ol.scrollTop, atEnd: ol.scrollTop + ol.clientHeight >= ol.scrollHeight - 4 });
    if (stepsScroll.size > 8) stepsScroll.delete(stepsScroll.keys().next().value!);
  });
}
/**
 * #gui-turn-steps: the working key names what the turn does now with its clock; its words ellipsize and the clock
 * never does (Mika: at 1024 a long Bash command cut the clock off). The full words are its title. The ticker
 * rewrites the words and the clock (a hook takes the key only after HOOK_DWELL_MS, so the words can change on a
 * tick). Enter, Space or a click unfolds this turn's steps under it. Mika (a11y): this row is no live region — it
 * remounts on every step, and a remounted live region announces unreliably, all of it or nothing — the page's one
 * persistent #turn-say says what the turn does once it has held 2 s (sayWork).
 */
function workingEl(it: FoldedItem): HTMLElement {
  const open = it.open === true;
  const k = stepsFoldKey(it.key);
  const w = it.live ? workParts(it.live, Date.now()) : { label: 'working…', clock: '', aria: 'working' };
  const key = h(doc, 'div', { class: 'work-key', role: 'button', tabindex: '0', 'aria-expanded': String(open), 'data-act': k, 'data-item': it.key, title: w.label }, h(doc, 'span', { class: 'spin', 'aria-hidden': 'true' }), h(doc, 'span', { class: 'caret', 'aria-hidden': 'true' }, open ? '▾ ' : '▸ '), h(doc, 'span', { class: 'work-label' }, w.label), h(doc, 'span', { class: 'live-clock' }, w.clock));
  const list = open
    ? h(doc, 'ol', { class: 'steps', 'data-item': it.key, 'aria-label': "This turn's steps" }, ...(it.steps ?? []).length ? (it.steps ?? []).flatMap((st) => {
        const sk = stepFoldKey(it.key, st.key);
        const p = stepParts(st);
        const full = stepText(st);
        const tone = st.outcome === 'blocked' || st.outcome === 'failed' || st.outcome === 'timed out' ? ' warn' : '';
        if (st.until === undefined) return [h(doc, 'li', { class: 'step live', title: full }, h(doc, 'span', { class: 'caret blank', 'aria-hidden': 'true' }, '▸ '), h(doc, 'span', { class: 'step-label' }, p.label), h(doc, 'span', { class: 'step-tail' }, ' · ', h(doc, 'span', { class: 'step-clock', 'data-since': st.since, 'aria-hidden': 'true' }, stepClockText(st.since, Date.now()))))];
        const sOpen = st.detail !== undefined;
        const row = h(doc, 'li', { class: `step fold${tone}${sOpen ? ' open' : ''}`, role: 'button', tabindex: '0', 'aria-expanded': String(sOpen), 'data-act': sk, 'data-item': it.key, title: full }, h(doc, 'span', { class: 'caret', 'aria-hidden': 'true' }, sOpen ? '▾ ' : '▸ '), h(doc, 'span', { class: 'step-label' }, p.label), h(doc, 'span', { class: 'step-tail' }, p.tail));
        return sOpen ? [row, h(doc, 'li', { class: 'step-detail' }, h(doc, 'pre', { class: 'raw-line', tabindex: '0', 'aria-label': 'its lines' }, st.detail!))] : [row];
      }) : [h(doc, 'li', { class: 'step' }, 'nothing yet')])
    : null;
  return h(doc, 'div', { class: `trow role-working${open ? ' open' : ''}` }, key, list) as unknown as HTMLElement;
}
/**
 * #gui-turn-steps (Mika, a11y): the focused transcript's running turn, said once in #turn-say ("Claude is waiting on
 * a Stop hook") when what it does has held SAY_HOLD_MS — the long steps a person waits on, never each 50 ms Read.
 */
const SAY_HOLD_MS = 2000;
let sayCand: { text: string; at: number } | null = null;
let saidWork: string | null = null;
function sayWork(now: number): void {
  const w = items.find((x) => x.role === 'working' && x.live);
  if (!w?.live) {
    sayCand = null;
    saidWork = null;
    return;
  }
  const who = agentLabel() === 'local model' ? 'The local model is' : 'Claude is';
  const text = `${who} ${workParts(w.live, now).aria}`;
  if (sayCand?.text !== text) sayCand = { text, at: now };
  if (text !== saidWork && now - sayCand.at >= SAY_HOLD_MS) {
    saidWork = text;
    const say = document.getElementById('turn-say');
    if (say) say.textContent = text;
  }
}
function itemEl(it: FoldedItem): HTMLElement {
  if (it.role === 'activity') {
    const open = expandedActs.has(it.key);
    // T-2026-10-21-007: the running turn's activity line counts live (the ticker rewrites only its .live-clock span)
    const clock = it.live ? h(doc, 'span', { class: 'live-clock' }, liveText(it, Date.now())) : null;
    return h(doc, 'div', { class: `trow role-activity${open ? ' open' : ''}${it.live ? ' live' : ''}`, role: 'button', tabindex: '0', 'aria-expanded': String(open), 'data-act': it.key, title: open ? 'Hide the steps' : 'Show the steps' }, `${open ? '▾' : '▸'} ${it.text}`, clock) as unknown as HTMLElement;
  }
  if (it.role === 'working') return workingEl(it);
  // #gui-slash-runs: a "/" run row, from this page's run (its result held in memory only) or the kernel's row (history)
  if (it.role === 'run') {
    const v = it.runKey ? slashMenu?.flow.run(it.runKey) : null;
    if (v) return renderRunRow(doc, runWords(v), { key: v.key, at: v.at, now: Date.now() }) as unknown as HTMLElement;
    if (it.runRow) return renderRunRow(doc, it.runRow, { key: null, at: it.at ?? '', now: Date.now() }) as unknown as HTMLElement;
  }
  // Luna #10: a voice-sent turn reads in words, "you · spoken · sent by <how>", never a glyph
  const spoken = it.role === 'user' && (it.voice === 'voice-edited' || it.speaker !== undefined) ? voiceWho({ speaker: it.speaker ?? 'you', edited: it.voice === 'voice-edited', sent: it.sentLabel ?? null }) : null;
  const label = spoken ? spoken.who : it.role === 'assistant' ? agentLabel() : ROLE_LABEL[it.role];
  const at = it.at ? it.at.slice(11, 16) : '';
  // TD-2026-10-21-514: "spoken · sent by you / on release / by send word / as a piece" (the plain origin; TD-2026-10-23-939)
  const sentBy = spoken || it.sentLabel ? h(doc, 'span', { class: 'sent-by' }, `${spoken ? spoken.sent : it.sentLabel}`) : null;
  const body = label
    ? [h(doc, 'div', { class: 'who' }, label, sentBy, h(doc, 'span', { class: 't' }, at), it.took !== undefined ? h(doc, 'span', { class: 'took' }, `took ${durationText(it.took)}`) : null), ...(it.said !== undefined ? [h(doc, 'div', { class: 'said' }, h(doc, 'span', { class: 'said-tag' }, saidTag(it.saidBy === 'kernel' ? 'kernel' : 'reply', replyModeOf(status))), ' ', it.said)] : []), replyBody(it)]
    : it.role === 'raw'
      ? [h(doc, 'span', { class: 't' }, at), it.text]
      : it.role === 'card' && it.cardId !== undefined && askAnswers.has(it.cardId)
        ? [`answered · ${askAnswers.get(it.cardId)!}`] // Mika Delta 11: what this page answered (text node, sanitized by h)
        : [it.text];
  if (it.role === 'raw' && it.detail !== undefined) {
    // the raw view: a row folds open to its whole line (the activity fold: ▸ / ▾, Enter or Space, the same expanded set)
    const k = rawFoldKey(it);
    const open = expandedActs.has(k);
    return h(doc, 'div', { class: `trow role-raw fold${open ? ' open' : ''}`, role: 'button', tabindex: '0', 'aria-expanded': String(open), 'data-act': k, title: open ? 'Hide the whole line' : 'Show the whole line' }, h(doc, 'span', { class: 'caret', 'aria-hidden': 'true' }, open ? '▾ ' : '▸ '), ...body) as unknown as HTMLElement;
  }
  if (it.role === 'raw-detail') {
    // text only, sanitized by h(); long lines scroll inside the fold, never the page
    return h(doc, 'div', { class: 'trow role-raw-detail' }, h(doc, 'pre', { class: 'raw-line', tabindex: '0', 'aria-label': 'the whole line' }, it.text)) as unknown as HTMLElement;
  }
  const slips = slipsAt.get(it.key) ?? [];
  // #gui-host-hints: the reply text above is shown verbatim; a host slip under it says the Gnomon way
  const host = it.role === 'assistant' && !rawMode ? hostHintsFor(it.key, it.text) : [];
  return h(doc, 'div', { class: `trow role-${it.role}${it.speaker !== undefined ? ' voice' : ''}${it.tone === 'warn' ? ' warn' : it.tone === 'fail' ? ' fail' : ''}` }, ...body, ...renderHostSlips(doc, it.key, host, hostCopied), ...slips.map((v) => slipEl(v))) as unknown as HTMLElement;
}

/**
 * #gui-slash-runs: a run row's keys. Decide in the stack focuses the card GROUP, never its Allow (a second Enter cannot
 * allow it); the data fold opens and folds in place, the focus staying on its key.
 */
function onRunKey(k: HTMLElement, e: Event): void {
  if (!e.isTrusted) return; // G-GUI-04
  const key = k.dataset.runKey ?? '';
  const v = slashMenu?.flow.run(key);
  if (!v) return;
  const act = k.dataset.runAct;
  if (act === 'decide' && v.cardId) return focusCardGroup(v.cardId, 'card');
  if (act === 'fold' || act === 'unfold') {
    slashMenu!.flow.fold(key, act === 'unfold');
    ($('viewport').querySelector(`[data-run="${CSS.escape(key)}"] .run-fold`) as HTMLElement | null)?.focus({ preventScroll: true });
  }
  if (k.getAttribute('aria-disabled') === 'true') return; // aria-busy: it sends nothing
  // C6'b2-2: Send this one; the row is remounted: focus goes back to the same key, else to the row's policy line
  if (act === 'send') void slashMenu!.flow.sendOne(key, true).then(() => focusRunKey(key, ['send']));
  // C6'b2-2: the first-use question; Keep to me hands focus to the Send this one key it brings
  if (act === 'always-send' || act === 'keep') void slashMenu!.flow.choosePolicy(key, act === 'always-send' ? 'send' : 'ask', true).then(() => focusRunKey(key, act === 'keep' ? ['keep', 'send'] : ['always-send']));
}
/** C6'b2-2: after a run row's key settles, focus the first of `acts` still there, else the row's policy line. */
function focusRunKey(key: string, acts: string[]): void {
  const row = $('viewport').querySelector(`[data-run="${CSS.escape(key)}"]`);
  const a = document.activeElement;
  if (a && a !== document.body && !row?.contains(a)) return; // the human moved on: focus stays where they put it
  const to = acts.map((x) => row?.querySelector(`[data-run-act="${CSS.escape(x)}"]`)).find(Boolean) ?? row?.querySelector('.run-policy');
  (to as HTMLElement | null | undefined)?.focus({ preventScroll: true });
}

/* ── #gui-host-hints (founder 2026-10-23): host slips under a reply that names what does not run in Gnomon ── */
/** the hints each mounted reply drew (the Copy key copies from here: the same string its <code> shows) */
const hostAt = new Map<string, { text: string; hints: HostHint[]; skills: string }>();
let hostCopied: string | null = null;
let hostCopiedTimer: ReturnType<typeof setTimeout> | null = null;
function hostHintsFor(key: string, text: string): HostHint[] {
  // #gui-slash-menu: a slash command naming one of this session's loaded skills runs from / (its slip says so)
  const skills = focused ? (slashMenu?.flow.loadedSkills(focused) ?? []) : [];
  const sig = skills.join(' ');
  const had = hostAt.get(key);
  if (had && had.text === text && had.skills === sig) return had.hints;
  const hints = hostHintsOf(text, skills);
  if (hints.length) hostAt.set(key, { text, hints, skills: sig });
  else hostAt.delete(key);
  if (hostAt.size > 400) hostAt.delete(hostAt.keys().next().value!);
  return hints;
}
/** Copy: a trusted press writes the slip's shown command to the clipboard; nothing runs. No clipboard: select it for ⌘C. */
function onHostCopy(ref: string, e: Event): void {
  if (!e.isTrusted) return;
  const cut = ref.lastIndexOf(':');
  const item = ref.slice(0, cut);
  const hint = hostAt.get(item)?.hints[Number(ref.slice(cut + 1))];
  const cmd = hint ? copyTextOf(hint) : null;
  if (cmd === null) return;
  // Aegis L2: copy only what the slip shows: the rendered command's text must equal cmd exactly, else nothing is copied
  const shown = $('viewport').querySelector(`[data-host-cmd="${CSS.escape(ref)}"]`)?.textContent ?? null;
  if (shown !== cmd) return void notice('The command on screen changed: nothing was copied', 'fail', { source: 'host-copy' });
  const selectIt = (): void => {
    const code = $('viewport').querySelector(`[data-host-cmd="${CSS.escape(ref)}"]`);
    const sel = window.getSelection();
    if (!code || !sel) return;
    const r = document.createRange();
    r.selectNodeContents(code);
    sel.removeAllRanges();
    sel.addRange(r);
    notice('Selected the command: press ⌘C to copy it', 'info', { source: 'host-copy' });
  };
  if (!navigator.clipboard?.writeText) return selectIt();
  // Mika Delta 10: the remount replaces the key, so a key that had focus gets it back (keyboard users stay put)
  const repaint = (): void => {
    const sel = `[data-host-copy="${CSS.escape(ref)}"]`;
    const had = document.activeElement === $('viewport').querySelector(sel);
    remountItem(item);
    paintTranscript();
    if (had) ($('viewport').querySelector(sel) as HTMLElement | null)?.focus({ preventScroll: true });
  };
  navigator.clipboard.writeText(cmd).then(
    () => {
      hostCopied = ref;
      repaint();
      put($('toast-say'), `Copied: ${cmd}`); // the polite live region: "Copied" is said, not only drawn
      if (hostCopiedTimer) clearTimeout(hostCopiedTimer);
      hostCopiedTimer = setTimeout(() => {
        hostCopied = null;
        repaint();
      }, 2000);
    },
    selectIt,
  );
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
  if (!client) return notice('not connected: nothing was sent', 'fail');
  try {
    await client.call('log.append', decideRequest(offerId, decision));
  } catch (err) {
    notice(err instanceof RpcError ? refusalText(err.refusal) : 'the offer decision was not sent', 'fail');
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
    if (it.role === 'working') {
      // #gui-turn-steps: the words can change on a tick too (a hook takes the key after HOOK_DWELL_MS)
      const w = workParts(it.live, now);
      const lb = el.querySelector('.work-label') as HTMLElement | null;
      if (lb) put(lb, w.label);
      const wk = el.querySelector('.work-key') as HTMLElement | null;
      if (wk && wk.title !== w.label) wk.title = w.label;
      if (c) put(c, w.clock);
    } else if (c) put(c, liveText(it, now));
    // #gui-turn-steps: the unfolded list's live step counts too
    for (const sc of el.querySelectorAll<HTMLElement>('.step-clock[data-since]')) put(sc, stepClockText(sc.dataset.since!, now));
  }
  sayWork(now);
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
        dropRow(el);
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
  sayWork(Date.now()); // #gui-turn-steps: a turn that ended clears what was said
  follow.onAppend(appended);
  for (let pass = 0; pass < 4; pass++) {
    $('spacer').style.height = `${heights.total()}px`;
    if (follow.shouldStick) setScroll(vp, vp.scrollHeight);
    else if (items.length) {
      const want = heights.offsetOf(Math.min(anchor, items.length - 1)) + anchorDelta;
      if (Math.abs(vp.scrollTop - want) >= 1) setScroll(vp, want);
    }
    const { start, end } = visibleRange(heights, vp.scrollTop, vp.clientHeight || 600);
    // Mika #4: a row mounted before the session's backend arrived carries the wrong speaker label: remount them all
    const agent = agentLabel();
    if (agent !== mountedAgent) {
      for (const el of mounted.values()) dropRow(el);
      mounted.clear();
      mountedAgent = agent;
    }
    for (const [i, el] of mounted)
      if (i < start || i >= end) {
        dropRow(el);
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
        restoreSteps(el);
        watchRow(el);
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
  const mic = vv.state !== 'off' && vv.hsid === s.hsid ? (vv.state === 'ambient' ? 'voice · ' : 'voice · talk · ') : '';
  return h(
    doc,
    'button',
    { class: `session-row sess state-${s.state}${isLiveState(s.state) ? ' live' : ' gone'}${focused === s.hsid ? ' active' : ''}${drooped.has(s.hsid) ? ' fx' : ''}`, type: 'button', 'data-hsid': s.hsid, title: `${s.hsid}${s.backend ? ` · ${backendWord(s.backend)}` : ''}`},
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
  if (plan.kind === 'refuse') return notice(plan.note, 'fail', { source: 'rename' });
  if (!client) return notice('not connected: the name was not changed', 'fail', { source: 'rename' });
  try {
    await client.call('log.append', renameRequest(hsid, plan.name));
    notice(null, 'info', { source: 'rename' });
  } catch (err) {
    notice(err instanceof RpcError ? refusalText(err.refusal) : 'the name was not changed', 'fail', { source: 'rename' });
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
 * S4 motion: a card the human approved (the kernel accepted it; never on a refusal) stamps the decision it took
 * (stampWord), then 550 ms later fades out (opacity only, --t-fade; founder 2026-10-23: "get rid of the whole card tilt
 * and spin aspect and can go with a simple and tasteful fade out"), and on that fade's animationend the pile closes up
 * over its height (--reflow) and it is removed. While it leaves it is kept out of fresh paints (no duplicate) and
 * re-inserted at its place. Reduced motion (in-app or the OS): removed at once, nothing waits on an animation that
 * never runs. A 1.5 s fallback removes it even if animationend or transitionend never fires (a hidden tab).
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
/** The fade is done: close the space the card held (its measured height to 0), then remove it. */
function closeUp(cardId: string, el: HTMLElement): void {
  if (el.classList.contains('closing')) return;
  el.style.height = `${el.offsetHeight}px`;
  void el.offsetHeight; // the measured height is the transition's start
  el.classList.add('closing');
  el.style.height = '0px';
  el.addEventListener('transitionend', (e) => {
    if ((e as TransitionEvent).propertyName === 'height') settleDeparture(cardId);
  });
}
function fadeOff(cardId: string, decision: string): void {
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
        if ((e as AnimationEvent).animationName === 'card-fade') closeUp(cardId, el);
      });
    }
  }, 550);
  setTimeout(() => settleDeparture(cardId), 1500);
}
/** S4 droop: a session that flips to failed in this page's view droops once (never a shake). */
const lastState = new Map<string, string>();
const drooped = new Set<string>();

/**
 * design-system card.body-scroll (Mika 2026-10-23): a card body is a tab stop, and shows its "more below" cue, only
 * while it overflows its cap: measured after mount and on every box change (a resize, a details opening) and scroll.
 * paintStack rebuilds every card, so it disconnects the observer before it clears the stack (no detached bodies kept).
 */
const markBodyOf = (b: HTMLElement): void => {
  const cue = b.nextElementSibling;
  markCardBody(b as unknown as ScrollBodyEl, cue && cue.classList.contains('card-more') ? (cue as HTMLElement) : null);
};
const bodyWatch = typeof ResizeObserver === 'function' ? new ResizeObserver((es) => es.forEach((e) => markBodyOf(e.target as HTMLElement))) : null;
function watchCardBody(card: HTMLElement): void {
  const b = card.querySelector<HTMLElement>('.card-body');
  if (!b) return;
  b.addEventListener('scroll', () => markBodyOf(b), { passive: true });
  bodyWatch?.observe(b);
}

async function paintStack(arrived: Set<string> = new Set()): Promise<void> {
  const focusRepo = focused ? (store.sessions.get(focused)?.repo ?? null) : null;
  // TD-2026-10-24-447: with loops off in this build a loop-trust / loop-choice card still held from an 8.0.0 install is not shown
  const cards = (stackScoped && focused ? store.stack(focusRepo) : store.stack()).filter((c) => !departing.has(c.cardId));
  // fidelity 2: the comp's head ("Stack" · "4 · hover to fan"); the scope is a small filter key (named when it filters)
  const scoped = stackScoped && !!focused;
  put($('stack-scope'), scoped ? 'this project ▾' : '▾');
  $('stack-scope').title = scoped ? 'Showing this session\'s project only (click: all projects)' : 'Showing all projects (click: only this session\'s project)';
  $('stack-scope').setAttribute('aria-pressed', String(scoped));
  put($('inbox'), `${store.visibleCardCount()}`);
  for (const c of cards) {
    const k = verifiedKey(c.cardId, String(c.card.contentHash ?? ''));
    if (!verified.has(k) && verifyKey && session) {
      verified.set(k, []);
      verified.set(k, await verifiedDecisions(crypto.subtle, verifyKey, session.hello.serverKeyId, { cardId: c.cardId, contentHash: String(c.card.contentHash ?? ''), actions: Array.isArray(c.card.actions) ? c.card.actions : [] }));
    }
  }
  const mk = (c: (typeof cards)[number], zone: 'pile' | 'pinned'): HTMLElement => {
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
        askPicks: c.kind === 'ask-user' ? (askPicks.get(c.cardId) ?? null) : null, // #gui-ask-card: the page's picks survive a repaint
        prefixOptions: c.kind === 'permission' ? prefixOptionsOf(c.card) : null,
        editScopes: c.kind === 'permission' ? editScopesOf(c.card) : null, // TD-2026-10-23-939 follow-up: scoped edit always
        gitVerb: c.kind === 'permission' ? gitVerbOf(c.card) : null, // #git-verbs: push/create facts + the remote's Always
        alwaysOpen: alwaysOpen.has(`${zone}|${c.cardId}`), // Mika 2026-10-23: the "Always ▾" fold survives a repaint
        project: projectOfCard(c),
        raisedAt: c.raisedAt ?? null,
        now: Date.now(),
        voice: cardVoiceOf(c.card),
        composedTitle: permissionTitleOf(c.card, c.tool, c.toolInput),
        brokered: isBrokeredCard(c.card.block, c.tool), // C5'a3: no plain always key on a brokered MCP card
        toolScope: c.kind === 'permission' ? toolScopesOf(c.card) : null, // C5'b: the scoped Always, only from a verified tool-scope node
        localNs: localNsOf(session?.principal),
        // #gui-loops: the kernel's authorship basis (status.loops authoredBy agent-key-claim), never guessed from a name
        loopClaimedBy: c.kind.startsWith('loop-') ? loopClaimOf(c.card) : null,
        // Aegis C1e: what a root-class decision signs, verified against contentHash (null ⇒ no root key)
        rootRows: rootRowsOf(c.card, { local: localCurrentOf(localStatusOf(status)) }),
        // Q2: status.helper.batch 'unavailable (helper <1.8.0)' ⇒ a one-line notice on root cards
        batchUnavailable: typeof (status?.helper as { batch?: unknown } | undefined)?.batch === 'string' && String((status!.helper as { batch: string }).batch).startsWith('unavailable'),
      },
      c.card.block,
    ) as unknown as HTMLElement;
    if (c.kind === 'loop-trust' || c.kind === 'loop-choice') decorateLoopCard(el, c.kind, c.card, c.cardId);
    watchCardBody(el);
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
  const refocus = alwaysFocusOf() ?? askFocusOf(); // a repaint keeps focus on an Always fold or choice (Mika 2026-10-23), or in a question card
  for (const id of [...askPicks.keys()]) if (!store.cards.has(id)) askPicks.delete(id); // #gui-ask-card: picks go with their card
  bodyWatch?.disconnect(); // every card is rebuilt below (card.body-scroll)
  clear(pile);
  stackLaidOutAt = performance.now();
  // S3: a paper pile; more than PILE_MAX cards ⇒ the first PILE_MAX piled plus "+n more" (it opens the fanned pile)
  const shown = pileOpen ? cards : cards.slice(0, PILE_MAX);
  for (const c of shown) pile.appendChild(mk(c, 'pile'));
  pile.classList.toggle('open', pileOpen);
  // Aegis C1e: a root decision whose logged rowsDigest is not the digest of the rows its card showed: flagged red
  for (const m of store.rootMismatches) pile.appendChild(h(doc, 'p', { class: 'refusal root-digest-mismatch', role: 'alert' }, `The ${m.decision} of ${m.cardId} was logged with rows the card did not show (rowsDigest ${m.logged ?? 'missing'} ≠ shown ${m.shown}). Check gnomon verify.`) as unknown as Node);
  if (cards.length > PILE_MAX && !pileOpen) pile.appendChild(h(doc, 'button', { class: 'key quiet pile-more', type: 'button', 'data-pile-more': '1' }, `+${cards.length - PILE_MAX} more`) as unknown as Node);
  // #gui-loops (the stack-of-alerts zone change): decision cards first, then loop alerts, then the trust slip at the foot
  const lm = loopsOf(status);
  for (const a of loopAlerts(lm, loopDismissed)) pile.appendChild(alertEl(document, a, a.repo ? hueOfRepo(a.repo) : 0));
  const slip = trustSlip(lm, new Set([...store.cards.values()].filter((c) => c.kind === 'loop-trust').map((c) => cardLoopOf(c.card, store.loopCards)?.loopId).filter((x): x is string => !!x)));
  if (slip) pile.appendChild(loopSlipEl(document, slip));
  stackLoopSig = loopStackSig();
  put($('stack-hint'), cards.length > 1 ? ' · hover to fan' : '');
  const pinned = $('pinned');
  clear(pinned);
  const mine = focused ? store.stack(focusRepo).filter((c) => c.hsid === focused) : [];
  // S2.6: the pinned cards carry their label (only when there are any)
  if (mine.length) pinned.appendChild(h(doc, 'span', { class: 'lbl' }, 'Pending in this session') as unknown as Node);
  // S4: a pinned card settles at one of four preset tilts (classes, never inline style), picked by its cardId
  for (const c of mine) {
    const el = mk(c, 'pinned');
    let x = 0;
    for (const ch of c.cardId) x = (x + ch.charCodeAt(0)) % 997; // a tilt pick, not a hue: hues come from projectHue
    el.classList.add(['r-a', 'r-b', 'r-c', 'r-d'][x % 4]!);
    pinned.appendChild(el);
  }
  // S4: cards still fading off go back where they were (the fresh paint never shows them twice)
  for (const d of departing.values())
    for (const x of d)
      if (!x.el.isConnected && (x.parent === pile || x.parent === pinned)) x.parent.insertBefore(x.el, x.parent.children[x.index] ?? null);
  if (refocus) refocus();
  paintUpdateBanner();
  checkCardWait();
}

/* ── #gui-loops (gnomon-loops.md §6; Atelier 2026-10-22-gnomon-loops-ui) ───────────── */
const loopDismissed = new Set<string>();
let stackLoopSig = '';
const hueOfRepo = (repo: string): number => groupHue(repo, store.groups().find((g) => g.repo === repo)?.sessions ?? []);
/** what the stack's loop pieces depend on (a status refresh repaints the stack only when this changes) */
function loopStackSig(): string {
  const lm = loopsOf(status);
  return JSON.stringify([loopAlerts(lm, loopDismissed).map((a) => a.id), trustSlip(lm, new Set())?.lines.map((l) => l.key) ?? []]);
}
/** The kernel's text lines of a card block (the loop-trust card's listing and diff). */
function blockLines(block: unknown): string[] {
  const out: string[] = [];
  const walk = (b: unknown): void => {
    if (!b || typeof b !== 'object') return;
    const o = b as { type?: unknown; text?: unknown; children?: unknown };
    if (o.type === 'Text' && typeof o.text === 'string') out.push(...o.text.split('\n'));
    if (Array.isArray(o.children)) o.children.forEach(walk);
  };
  walk(block);
  return out;
}
/**
 * A loop card in the stack (design-system card variants loop-trust, loop-choice): loop-trust is short in the pile,
 * with Read (it unfolds the same card over the centre, where Trust waits after the whole definition) and Don't trust;
 * loop-choice carries the kernel line naming the loop and its run path, then Continue and Stop.
 */
/** The agent a loop card's loop is claimed by (the kernel's agent-key-claim basis), or null. */
function loopClaimOf(card: Record<string, unknown>): string | null {
  const cl = cardLoopOf(card, store.loopCards);
  const x = cl ? loopsOf(status)?.loops.find((y) => y.loopId === cl.loopId && (!cl.repoKey || y.repoKey === cl.repoKey)) : undefined;
  return x?.claimed && x.shape ? x.shape.authoredBy : null;
}
function decorateLoopCard(el: HTMLElement, kind: string, card: Record<string, unknown>, cardId: string): void {
  const cl = cardLoopOf({ ...card, cardId }, store.loopCards);
  const m = loopsOf(status);
  const keys = el.querySelector('.card-keys');
  // the title is a sentence (never the kind word); the kernel's own first line stays, as the kernel line under it
  const title = el.querySelector<HTMLElement>('.card-title');
  const sentence = loopCardTitle(kind, cl, m);
  if (title && sentence && sentence !== cl?.kernelLine) {
    title.textContent = sentence;
    title.title = sentence;
    if (cl?.kernelLine) title.after(h(doc, 'span', { class: 'k-line kernel-owned' }, cl.kernelLine) as unknown as Node);
  }
  if (kind === 'loop-trust') {
    const allow = el.querySelector<HTMLElement>('[data-decision="allow"]');
    if (allow) allow.hidden = true;
    const deny = el.querySelector<HTMLElement>('[data-decision="deny"]');
    if (deny) deny.textContent = "Don't trust";
    keys?.insertBefore(h(doc, 'button', { class: 'key pri', type: 'button', 'data-loop-read': cardId, title: 'Read the whole definition; Trust is at its foot' }, 'Read') as unknown as Node, keys.firstChild);
    return;
  }
  for (const b of el.querySelectorAll<HTMLElement>('[data-decision]')) b.textContent = b.dataset.decision === 'continue' ? 'Continue' : b.dataset.decision === 'stop' ? 'Stop' : b.textContent;
  const path = choicePath(cl, m);
  if (path) (el.querySelector('.k-line') ?? title)?.after(h(doc, 'p', { class: 'path' }, path) as unknown as Node);
}
function paintLoopsWord(): void {
  const w = loopsWord(loopsOf(status));
  const b = $('loops-word');
  b.hidden = !w.shown || link.state !== 'connected';
  put($('loops-word-text'), w.text);
  put($('loops-word-narrow'), w.narrow);
  b.title = w.title;
  b.setAttribute('aria-label', w.text);
}
async function loopRequest(req: { kind: string; payload: Record<string, unknown> }, trusted: boolean, done: string, onRefused?: (r: ShownRefusal) => void): Promise<boolean> {
  if (!trusted) return false; // Aegis L2: a request needs the human's own press
  if (!client) {
    notice('not connected: nothing was sent', 'fail', { source: 'loops' });
    return false;
  }
  try {
    await client.call('log.append', req);
    notice(done, 'info', { source: 'loops' });
    return true;
  } catch (err) {
    notice(err instanceof RpcError ? refusalText(err.refusal) : 'the loop request was not sent', 'fail', { source: 'loops' });
    if (err instanceof RpcError) onRefused?.(err.refusal);
    return false;
  } finally {
    await refreshStatus();
  }
}
async function pauseAllLoops(trusted: boolean): Promise<void> {
  if (loopsOff(loopsOf(status))) return; // TD-2026-10-24-447: nothing to pause in this build
  const before = loopsOf(status)?.running ?? 0;
  const n = (loopsOf(status)?.loops ?? []).filter((x) => x.state !== 'waiting-trust' && x.state !== 'invalid').length;
  if (await loopRequest(PAUSE_ALL_REQUEST, trusted, '')) {
    notice(null, 'info', { source: 'loops' });
    toasts().show(pauseAllText(before ? n : 0).replace(/^paused \d+ loops?/, `paused ${n === 1 ? '1 loop' : `${n} loops`}`), { tag: '↻ loops' });
  }
}
let loopRefresh: ReturnType<typeof setTimeout> | null = null;
/** A live loop row: done toasts (goal, landed, a notify toast), and a status re-read for the view, the word and the stack. */
function loopRow(r: Row): void {
  if (!r.kind.startsWith('loop.')) return;
  const t = loopRowToast(r, loopsOf(status));
  if (t)
    toasts().show(t.text, {
      tag: t.tag,
      ...(t.key ? { key: { label: 'Open run', onPress: () => loopsView.open({ key: t.key!, ...(t.runId ? { runId: t.runId } : {}) }) } } : {}),
    });
  if (loopRefresh) return;
  loopRefresh = setTimeout(() => {
    loopRefresh = null;
    void refreshStatus();
  }, 250);
}

/* ── self-update (TD-2026-10-19-063, core/restart.ts) ───────────── */
/**
 * #gui-toast (board gnomon-notices): update available is a persistent toast with "Restart now", which focuses the
 * upgrade card (the restart is the card's accept, with Touch ID; a toast never decides). It stays until the card is
 * decided; closing it hides it for that card only.
 */
let updateToast: { cardId: string; text: string; handle: ToastHandle } | null = null;
let updateClosedFor: string | null = null;
function paintUpdateBanner(): void {
  const b = upgradeBannerOf([...store.cards.values()].map((c) => ({ cardId: c.cardId, kind: c.kind, card: c.card as Record<string, unknown> })));
  if (updateToast && (!b || b.cardId !== updateToast.cardId || b.text !== updateToast.text || !updateToast.handle.present)) {
    updateToast.handle.dismiss();
    updateToast = null;
  }
  if (!b || updateToast || updateClosedFor === b.cardId) return;
  const cardId = b.cardId;
  const handle = toasts().show(b.text, {
    kind: 'info',
    persistent: true,
    key: { label: 'Restart now', title: 'Focus the upgrade card (the restart is its accept, with Touch ID)', onPress: () => focusCard(cardId, 'upgrade card') },
    onClose: () => (updateClosedFor = cardId),
  });
  updateToast = { cardId, text: b.text, handle };
}

/** The socket closed after this page accepted the upgrade: wait for the successor, then load its bundle. */
async function awaitRestart(): Promise<void> {
  setLink('restarting');
  notice('Gnomon is restarting with the new version…', 'info', { held: true }); // held until the page reloads
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

/* ── #gui-ask-card: the question card (design-system question-card) ── */
/** The page's picks per ask-user card (both zones show the same picks; dropped when the card leaves). */
const askPicks = new Map<string, AskPicks>();
/** Mika Delta 11: cards whose shown refusal is the page's own early-Submit line (cleared once complete) */
const askRefused = new Set<string>();
/**
 * Mika Delta 11: what this page answered, by cardId, for the transcript's decided line ("answered · …"). Page-only and
 * never sent anywhere: the kernel logs a noteHash only (privateNote), so after a reload the line is "decided · answer".
 */
const askAnswers = new Map<string, string>();
function picksOf(cardId: string): { ask: NonNullable<ReturnType<typeof askDetailOf>>; picks: AskPicks } | null {
  const c = store.cards.get(cardId);
  const ask = c && c.kind === 'ask-user' ? askDetailOf(c.card) : null;
  if (!ask) return null;
  let picks = askPicks.get(cardId);
  if (!picks) {
    picks = emptyPicks(ask);
    askPicks.set(cardId, picks);
  }
  return { ask, picks };
}
/** ask-user: the page's picks ⇒ the approve note (null = a question is unanswered). */
function askNoteFrom(_cardEl: HTMLElement, cardId: string): string | null {
  const x = picksOf(cardId);
  return x ? askNote(x.ask.questions, x.picks) : null;
}
/** Every rendered picker of the card (pinned and pile) follows the picks in place: no rebuild, so typing keeps its caret. */
function syncAsk(cardId: string, focus: { q: number; opt: number } | null = null): void {
  const x = picksOf(cardId);
  if (!x) return;
  for (const pk of document.querySelectorAll<HTMLElement>(`.ask-picker[data-ask-card="${CSS.escape(cardId)}"]`)) {
    for (const q of x.ask.questions) {
      const p = x.picks.get(q.n);
      for (const b of pk.querySelectorAll<HTMLElement>(`[data-ask-q="${q.n}"][data-ask-opt]`)) {
        const on = !!p?.chosen.includes(Number(b.dataset.askOpt));
        b.classList.toggle('picked', on);
        b.setAttribute('aria-checked', String(on));
      }
      const o = pk.querySelector<HTMLElement>(`[data-ask-q="${q.n}"][data-ask-other]`);
      if (o) {
        o.classList.toggle('picked', !!p?.other);
        o.setAttribute('aria-checked', String(!!p?.other));
      }
      // Mika Delta 11: a one-pick question stays one tab stop, following the pick (or the focus, while moving)
      const stop = askTabStop(q, x.picks);
      if (stop !== null) {
        const stops = [...pk.querySelectorAll<HTMLElement>(`[data-ask-q="${q.n}"][data-ask-opt], [data-ask-q="${q.n}"][data-ask-other]`)];
        const at = focus && focus.q === q.n ? Math.min(focus.opt, stops.length - 1) : stop;
        stops.forEach((b, i) => (i === at ? b.removeAttribute('tabindex') : b.setAttribute('tabindex', '-1')));
      }
      const f = pk.querySelector<HTMLInputElement>(`[data-ask-q="${q.n}"][data-ask-free]`);
      if (f && f.value !== (p?.free ?? '')) f.value = p?.free ?? '';
      const pre = pk.querySelector<HTMLElement>(`[data-ask-preview="${q.n}"]`);
      // Aegis M2: through THE display sanitizer (bidi and invisible characters never reach the screen)
      if (pre) pre.textContent = displayText(askPreviewOf(q, x.picks, focus && focus.q === q.n ? focus.opt : null) ?? (focus && focus.q === q.n && focus.opt < q.options.length ? ASK_COPY.noPreview : ASK_COPY.previewHint));
    }
    const key = pk.closest('.card')?.querySelector<HTMLElement>('[data-decision="answer"]');
    if (key) {
      if (askComplete(x.ask, x.picks)) {
        key.removeAttribute('aria-disabled');
        key.removeAttribute('title');
        // Mika Delta 11: the early-Submit line goes once every question has an answer
        if (askRefused.has(cardId)) {
          refusals.delete(cardId);
          askRefused.delete(cardId);
          pk.closest('.card')?.querySelector('.refusal')?.remove();
        }
      } else {
        key.setAttribute('aria-disabled', 'true');
        key.title = 'answer every question first';
      }
    }
  }
}
/** A trusted press on an option or Other: one pick picks it, many toggle it; Other then focuses its text field. */
function onAskPress(e: Event, b: HTMLElement): void {
  if (!e.isTrusted) return; // design-system question-card: never on a synthetic event
  const cardId = b.dataset.askCard ?? '';
  const x = picksOf(cardId);
  const q = x?.ask.questions.find((y) => y.n === Number(b.dataset.askQ));
  if (!x || !q) return;
  if (b.dataset.askOther) {
    askPressOther(x.picks, q);
    syncAsk(cardId);
    if (x.picks.get(q.n)?.other) (b.closest('.ask-q')?.querySelector('[data-ask-free]') as HTMLElement | null)?.focus();
    return;
  }
  const opt = Number(b.dataset.askOpt);
  if (!askPress(x.picks, q, opt)) return;
  syncAsk(cardId, { q: q.n, opt });
}
/** Typing an Other answer (a trusted input event only). */
function onAskInput(e: Event): void {
  const f = e.target as HTMLInputElement;
  if (!e.isTrusted || !f.dataset?.askFree) return;
  const cardId = f.dataset.askCard ?? '';
  const x = picksOf(cardId);
  const q = x?.ask.questions.find((y) => y.n === Number(f.dataset.askQ));
  if (!x || !q) return;
  askType(x.picks, q, f.value);
  syncAsk(cardId);
  // the same card in the other zone shows the same text
  for (const g of document.querySelectorAll<HTMLInputElement>(`[data-ask-card="${CSS.escape(cardId)}"][data-ask-q="${q.n}"][data-ask-free]`)) if (g !== f) g.value = f.value;
}
/** Keyboard inside a question (never while typing in its text field): arrows move, a number or letter picks or toggles. */
function onAskKey(e: KeyboardEvent): void {
  const f = e.target as HTMLInputElement;
  if (e.key === 'Enter' && !e.isComposing && !e.shiftKey && f.dataset?.askFree && e.isTrusted) {
    // Enter in an Other field submits the card (the Submit key's own path; refused there while a question is open)
    e.preventDefault();
    const key = f.closest('.card')?.querySelector<HTMLElement>('[data-decision="answer"]') ?? null;
    return void decide(f.dataset.askCard ?? '', 'answer', f.closest('[data-card-id].card') as HTMLElement | null, key);
  }
  const b = (e.target as HTMLElement).closest?.('.ask-picker [data-ask-opt], .ask-picker [data-ask-other]') as HTMLElement | null;
  if (!b || e.metaKey || e.ctrlKey || e.altKey) return;
  const group = b.closest('.ask-q') as HTMLElement | null;
  const stops = group ? [...group.querySelectorAll<HTMLElement>('[data-ask-opt], [data-ask-other]')] : [];
  const to = askMove(e.key, stops.indexOf(b), stops.length);
  if (to !== null) {
    e.preventDefault();
    return stops[to]?.focus();
  }
  const x = picksOf(b.dataset.askCard ?? '');
  const q = x?.ask.questions.find((y) => y.n === Number(b.dataset.askQ));
  const at = q ? askOptForKey(e.key, q) : null;
  if (at === null || !q) return;
  e.preventDefault();
  const t = at === 'other' ? stops[stops.length - 1] : stops[at];
  t?.focus();
  if (t) onAskPress(e, t); // a key press is a trusted gesture: it picks (or toggles) like a click
}
/** A focused option shows its preview (display only). */
function onAskFocus(e: FocusEvent): void {
  const b = (e.target as HTMLElement).closest?.('.ask-picker [data-ask-opt], .ask-picker [data-ask-other]') as HTMLElement | null;
  if (!b) return;
  // Other is the stop after the options (Mika Delta 11: the one-pick tab stop follows it too)
  const opt = b.dataset.askOther ? (b.closest('.ask-q')?.querySelectorAll('[data-ask-opt]').length ?? 0) : Number(b.dataset.askOpt);
  syncAsk(b.dataset.askCard ?? '', { q: Number(b.dataset.askQ), opt });
}
/** Before a stack repaint: a function that puts focus (and the caret) back in the same question card, or null. */
function askFocusOf(): (() => void) | null {
  const a = document.activeElement as HTMLElement | null;
  if (!a || !a.closest?.('.ask-picker')) return null;
  const zone = a.closest('#pinned') ? 'pinned' : 'stack';
  const sel = `[data-ask-card="${CSS.escape(a.dataset.askCard ?? '')}"][data-ask-q="${CSS.escape(a.dataset.askQ ?? '')}"]${a.dataset.askOpt !== undefined ? `[data-ask-opt="${CSS.escape(a.dataset.askOpt)}"]` : a.dataset.askOther ? '[data-ask-other]' : '[data-ask-free]'}`;
  const caret = a instanceof HTMLInputElement ? [a.selectionStart, a.selectionEnd] : null;
  return () => {
    const el = document.querySelector<HTMLElement>(`#${zone} ${sel}`);
    el?.focus();
    if (caret && el instanceof HTMLInputElement && caret[0] !== null && caret[1] !== null) el.setSelectionRange(caret[0], caret[1]);
  };
}

async function decide(cardId: string, decision: string, cardEl?: HTMLElement | null, keyEl?: HTMLElement | null): Promise<void> {
  if (!client) return;
  // Aegis S2/S3 M2: a key that moved under the pointer (the stack was just re-laid out) never takes the click
  if (performance.now() - stackLaidOutAt < RELAYOUT_GUARD_MS) return;
  let note: string | null = null;
  if (decision === 'answer') {
    note = cardEl ? askNoteFrom(cardEl, cardId) : null;
    if (note === null) {
      // Mika Delta 11: the page's own line (no kernel code) naming what is still open, under the Submit key; the
      // Submit key in the same zone keeps the focus (it was rebuilt) and the line is scrolled into view with it
      const x = picksOf(cardId);
      refusals.set(cardId, { code: '', reason: '', message: x ? askMissingText(x.ask, x.picks) : ASK_COPY.incomplete, next: [], data: null });
      askRefused.add(cardId);
      const zone = cardEl?.closest('#pinned') ? 'pinned' : 'stack';
      await paintStack();
      const card = document.querySelector<HTMLElement>(`#${zone} .ask-picker[data-ask-card="${CSS.escape(cardId)}"]`)?.closest<HTMLElement>('.card');
      card?.querySelector<HTMLElement>('[data-decision="answer"]')?.focus();
      card?.querySelector<HTMLElement>('.refusal')?.scrollIntoView({ block: 'nearest' });
      return;
    }
  }
  // Mika Delta 11: what is being answered, read now (the card leaves the store as its decided row arrives)
  const asked = decision === 'answer' ? picksOf(cardId) : null;
  const answered = asked ? askSummary(asked.ask, asked.picks) : null;
  const c0 = store.cards.get(cardId);
  const upgrade = decision === 'accept' && !!c0 && upgradeBannerOf([{ cardId, kind: c0.kind, card: c0.card as Record<string, unknown> }]) !== null;
  if (upgrade) markRestarting(sessionStorage, cardId);
  try {
    await client.call('approve', approveParamsOf(cardId, decision, note, keyEl ? { ...(keyEl.dataset.scope !== undefined ? { scope: keyEl.dataset.scope } : {}), ...(keyEl.dataset.prefix !== undefined ? { prefix: keyEl.dataset.prefix } : {}) } : null));
    refusals.delete(cardId);
    fadeOff(cardId, decision); // S4: only after the kernel accepted the decision (a refusal throws before this)
    askRefused.delete(cardId);
    if (decision === 'answer') {
      // Mika Delta 11: the transcript's decided line says what was answered (this page only), and the focus goes on to
      // the composer: the card and its keys leave, and the session continues there
      if (answered !== null) askAnswers.set(cardId, answered);
      remountCardRows(cardId);
      $<HTMLTextAreaElement>('composer-text').focus();
    }
    // #gui-rules-view (Mika C1): an Always decision says where its rule lives
    if (decision === 'always') toasts().show('Always rule saved: no card next time', { kind: 'info', key: { label: 'see Rules', onPress: (e: MouseEvent) => e.isTrusted && settings.open('rules') } });
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
  const parts = [`${live} live`, waiting ? `${waiting} waiting` : 'stack clear', `log ${store.head}`];
  if (session) parts.push(`${session.hello.clientApi}${session.clientApiDrift ? ' · clientApiId drift' : ''}`);
  s.appendChild(h(doc, 'span', null, parts.join(' · ')) as unknown as Node);
  s.title = `sessions ${live} live · ${store.sessions.size} seen\nstack ${Object.keys(by).length ? Object.entries(by).map(([k, n]) => `${k} ×${n}`).join(' · ') : 'clear'}\nlog head ${store.head} · ${store.rowsSeen} rows${session ? `\napi ${session.hello.clientApi}` : ''}\n(click: the kernel feed)`;
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
    if (w.has('voice-toast')) showToast(); // board header-5b: the idle auto-off, a warn toast in the ladder's words
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
  toast: (text, o) => toasts().show(text, o),
  focusCard: (cardId) => focusCard(cardId, 'grant card'),
  kernelPrincipal: () => kernelPrincipalOf(session?.principal),
});
store.onChange(() => standingFeed.repaint());
// #gui-model-picker: the New-session model select, the header chip + switch, the Settings slot; its own module
modelPicker = mountModelPicker(document, { client: () => client, rows: (hsid) => store.transcript(hsid), live: (hsid) => isLiveState(store.sessions.get(hsid)?.state ?? 'seen'), focused: () => focused, notice, folder: () => nsField.value() });
store.onChange(() => modelPicker?.repaint());
// #gui-tool-tier (C4'b): a local session's tool tier in the header (the owner's key ▾, a plain chip otherwise)
tierPicker = mountTierPicker(document, { client: () => client, session: (hsid) => store.sessions.get(hsid), live: (hsid) => isLiveState(store.sessions.get(hsid)?.state ?? 'seen'), me: () => session?.principal ?? myPrincipal(), model: (hsid) => sessionModelOf(store.transcript(hsid))?.model ?? 'this model', notice, openTools: (hsid, trusted, opener) => void toolsDrawer?.open(hsid, 'tools', trusted, opener) });
store.onChange(() => tierPicker?.repaint());
// #gui-capability-browser (C6'b1): the Tools and memory drawer (⋯ more menu, the tier key's menu, the palette)
toolsDrawer = mountToolsDrawer(document, {
  client: () => client,
  session: (hsid) => toolsSessionOf(hsid),
  rows: (hsid) => store.transcript(hsid),
  now: () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  openTier: (hsid) => tierPicker?.openMenu(hsid) ?? false,
  openSettings: () => settings.open(MCP_SECTION),
});
/** Who may see what of a session in the Tools and memory drawer (null: not a local attended session). */
function toolsSessionOf(hsid: string): { access: NonNullable<ReturnType<typeof drawerAccess>>; title: string } | null {
  const s = store.sessions.get(hsid);
  const access = s ? drawerAccess({ backend: s.backend, loop: s.loop === true, live: isLiveState(s.state), owner: s.owner ?? null, me: session?.principal ?? myPrincipal() }) : null;
  return s && access ? { access, title: sessionTitle(s) } : null;
}
/** The palette's and the more menu's "Tools and memory…": the focused session's drawer, or why not. */
function openTools(trusted: boolean, opener: HTMLElement | null = null): void {
  if (!focused || !toolsSessionOf(focused)) return notice('Tools and memory is for a local model session: focus one first', 'info', { source: 'tools' });
  toolsDrawer?.open(focused, null, trusted, opener);
}
// #gui-slash-menu (C6'b2-1): the "/" menu above the composer; #gui-slash-runs: its run rows in the transcript
slashMenu = mountSlashMenu(document, {
  client: () => client,
  textarea: $<HTMLTextAreaElement>('composer-text'),
  host: $('composer'),
  now: () => Date.now(),
  access: (hsid) => slashAccessOf(hsid),
  commands: SLASH_COMMANDS,
  runAdded: (v) => {
    // the row is in the transcript at the press (memory only, like the composer echo)
    local.push({ seq: store.head + 0.5, kind: 'slash-run', connId: 'local', session: v.hsid, payload: { key: v.key, server: v.server, tool: v.tool }, at: v.at });
    paintTranscript();
  },
  runChanged: (v) => {
    for (const it of items) if (it.runKey === v.key) remountItem(it.key);
    paintTranscript();
  },
  command: (id, trusted) => run(id, trusted),
  openTools: (hsid, trusted) => void toolsDrawer?.open(hsid, 'tools', trusted, $('composer-text')),
  skillRan: (hsid, name, args, turn) => {
    // a skill run posts as the human's turn: "you ran skill /name args", stamped with its turn id (pairs with turn.sent)
    local.push({ seq: store.head + 0.5, kind: 'skill-ran', connId: 'local', session: hsid, payload: { name, args }, at: new Date().toISOString(), ...(turn ? { turn } : {}) });
    follow.jump();
    paintTranscript();
  },
  skillsChanged: (hsid) => {
    if (hsid !== focused) return;
    for (const it of items) if (it.role === 'assistant') remountItem(it.key);
    paintTranscript();
  },
});
/** The palette's and a host slip's "Open / menu": the focused session's menu, or why not. */
function openSlash(trusted: boolean): void {
  if (!focused || !slashAccessOf(focused)) return notice('The / menu is for a running session you opened: focus one first', 'info', { source: 'slash' });
  slashMenu?.openFor(focused, trusted);
}
/** What "/" offers in a session: its owner's skills while it runs; a local attended session's tools too (null: nothing). */
function slashAccessOf(hsid: string): { tools: boolean; skills: boolean } | null {
  const s = store.sessions.get(hsid);
  const me = session?.principal ?? myPrincipal();
  if (!s || s.loop === true || !isLiveState(s.state) || s.owner == null || me === null || s.owner !== me) return null;
  return { tools: drawerAccess({ backend: s.backend, loop: false, live: true, owner: s.owner, me }) === 'owner', skills: true };
}
// #gui-settings: the sheet (⚙, ⌘, and the palette's "Settings…"); every control is an existing command or Revoke
// #gui-local-model: the Local model section's press paths (ui/local-model.ts); the sheet hands it presses
const localModel = new LocalModelController({
  call: (req) => (client ? client.call('log.append', req) : Promise.reject(new Error('not connected'))),
  status: () => status,
  loopsUsing: () => loopsUsingLocal(),
  now: () => Date.now(),
  time: (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  refreshStatus: () => refreshStatus(),
  repaint: () => settings.repaint(),
  focus: (t) => settings.focusLocal(t),
  decide: (cardId) => {
    settings.close();
    focusCardGroup(cardId);
  },
  sheetOpen: () => settings.isOpen(),
  toast: (text, kind, open) => void toasts().show(text, { kind, tag: 'local model', ...(open ? { key: { label: 'Open settings', onPress: (e: MouseEvent) => e.isTrusted && settings.open(LOCAL_SECTION) } } : {}) }),
  card: (cardId) => localCardRequest(cardId),
});
let rulesUi = emptyRulesUi();
// #gui-mcp-servers (T-2026-10-23-003): the MCP servers section's press path (ui/mcp-servers.ts)
const mcpServers = new McpServersController({
  call: (req) => (client ? client.call('log.append', req) : Promise.reject(new Error('not connected'))),
  status: () => status,
  hsid: () => focused,
  now: () => Date.now(),
  time: (iso) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  refreshStatus: () => refreshStatus(),
  repaint: () => settings.repaint(),
  decide: (cardId) => {
    settings.close();
    focusCardGroup(cardId);
  },
  focus: (sel) => (document.querySelector(`#settings-body [data-section="${MCP_SECTION}"] ${sel}`) as HTMLElement | null)?.focus(),
  connId: () => session?.connId ?? null, // a card's skips are shown only to the connection that decided it
  // C5'b: the trust panel moves focus only when it is already in the panel (or on its Trust… key)
  focused: () => {
    const a = document.activeElement as HTMLElement | null;
    return a && a.closest(`#settings-body [data-section="${MCP_SECTION}"]`) ? (a.dataset.lmAct ?? null) : null;
  },
});
// #gui-capability-browser (C6'b1): Settings › Local model › Kept memory (the ended sessions' working memory)
const keptTitle = (hsid: string): string => {
  const s = store.sessions.get(hsid);
  return s ? sessionTitle(s) : `session …${hsid.slice(-8)}`;
};
const kept = new KeptFlow({
  call: (req) => (client ? client.call('log.append', req) : Promise.reject(new Error('not connected'))),
  repaint: () => settings.repaint(),
  title: keptTitle,
  // Open: the drawer over the sheet; Esc closes it and focus returns to this Open key
  open: (hsid) => void toolsDrawer?.openMemory(hsid, keptTitle(hsid), true, document.activeElement as HTMLElement | null),
  focus: (f) => {
    const sec = document.querySelector(`#settings-body [data-section="${LOCAL_SECTION}"]`);
    const el = 'heading' in f ? sec?.querySelector('h3') : sec?.querySelector(`[data-lm-act="${CSS.escape(f.act)}"]${f.value !== undefined ? `[data-lm-value="${CSS.escape(f.value)}"]` : ''}`);
    (el as HTMLElement | null | undefined)?.focus();
  },
});
const settings = mountSettings(document, {
  local: localModel,
  mcp: mcpServers,
  kept,
  onOpen: () => void kept.read(),
  model: () =>
    settingsModel({
      theme,
      motion,
      prefersDark: darkQ.matches,
      prefersReduced: motionQ.matches,
      layout,
      status,
      mode: currentMode(),
      voicePreset,
      sessionModel: sessionModelText(focused ? sessionModelOf(store.transcript(focused)) : null),
      connection: session && client ? { principal: session.principal, connId: session.connId, surface: SURFACE, clientApiDrift: session.clientApiDrift } : null,
      gui: GUI_CLIENT,
      unlock: unlockSeenOf(store.kernelFeed, session?.connId ?? null, kernelPrincipalOf(session?.principal)),
      local: { ui: localModel.ui(), loopsUsing: loopsUsingLocal() },
      rules: rulesBlock(rulesStatusOf(status), rulesUi, (hsid) => sessionName(hsid) || null),
      mcp: { ui: mcpServers.ui(), hsid: focused },
      kept: kept.ui(),
    }),
  run: (id) => run(id, true), // the sheet acts on trusted presses only (settings-sheet.ts)
  revoke: (grantId) => void revokeGrant(grantId),
  // #gui-rules-view (8.0:rules-view): staged in the page; ONE request.rules.apply on Save
  rules: {
    press: (act, ruleId, value) => {
      if (!ruleId) return;
      const rs = rulesStatusOf(status);
      // founder 2026-10-23 ("folded works"): a repo group's heading folds and unfolds it (ruleId is the repoKey here)
      if (act === 'fold') {
        const g = rulesBlock(rs, rulesUi).groups.find((x) => x.repoKey === ruleId);
        if (!g?.foldable) return;
        rulesUi = toggleFold(rulesUi, ruleId, !g.folded);
        return settings.repaint(); // focus stays on the same heading key (the sheet restores it by act and id)
      }
      if (act === 'off-menu') rulesUi = toggleOffMenu(rulesUi, ruleId);
      else if (act === 'off' && (value === 'hour' || value === 'tomorrow' || value === 'manual')) rulesUi = stageOff(rulesUi, ruleId, value as RulePreset, rs);
      else if (act === 'on') rulesUi = stageOn(rulesUi, ruleId);
      else if (act === 'remove') rulesUi = stageRemove(rulesUi, ruleId);
      else if (act === 'keep' || act === 'undo') rulesUi = unstage(rulesUi, ruleId);
      settings.repaint();
      // the presets open inline: focus the first; a staged row keeps focus on its undo/keep key
      if (act === 'off-menu') (document.querySelector(`#settings-body .rule-row[data-rule-id="${CSS.escape(ruleId)}"] [data-rule-value]`) as HTMLElement | null)?.focus();
      else if (act !== 'keep' && act !== 'undo') (document.querySelector(`#settings-body .rule-row[data-rule-id="${CSS.escape(ruleId)}"] [data-rule-act]`) as HTMLElement | null)?.focus();
    },
    save: () => void saveRules(),
    discard: () => {
      rulesUi = rulesDiscard(rulesUi);
      settings.repaint();
      (document.querySelector('#settings-h-rules') as HTMLElement | null)?.focus();
    },
    decide: () => {
      const id = rulesUi.waiting?.cardId;
      if (!id) return;
      settings.close();
      focusCard(id);
    },
    filter: (text) => {
      rulesUi = { ...rulesUi, filter: text.slice(0, 200) };
      settings.repaint();
    },
    beforeClose: () => {
      const c = rulesBeforeClose(rulesUi);
      rulesUi = c.ui;
      return c.close;
    },
    escape: () => {
      const id = rulesUi.offOpen;
      if (!id) return false;
      rulesUi = toggleOffMenu(rulesUi, id);
      settings.repaint();
      (document.querySelector(`#settings-body .rule-row[data-rule-id="${CSS.escape(id)}"] [data-rule-act="off-menu"]`) as HTMLElement | null)?.focus();
      return true;
    },
  },
});
/**
 * #gui-rules-view: the one save. Narrowing applies at once; a batch that turns any rule back on comes back as ONE
 * strictness card that this same press decides allow (Touch ID or the Mac password once, the setMode pattern). A
 * refusal keeps every change staged; a check refused or still waiting reads "card waiting · Decide in the stack".
 */
async function saveRules(): Promise<void> {
  const req = applyRequest(rulesUi);
  if (!req || rulesUi.saving) return;
  if (!client) {
    rulesUi = { ...rulesUi, result: { kind: 'refused', text: 'Nothing was saved: not connected.', next: 'Reconnect (⌘K), then save again' } };
    return settings.repaint();
  }
  rulesUi = { ...rulesUi, saving: true, result: null, closePrompt: false };
  settings.repaint();
  try {
    const r = await client.call<{ cardId?: string | null }>('log.append', req);
    let decided: boolean | null = null;
    if (typeof r.cardId === 'string') {
      try {
        await client.call('approve', { cardId: r.cardId, decision: 'allow' });
        decided = true;
      } catch {
        decided = false; // the card stays in the stack: decide it there
      }
    }
    rulesUi = afterSave(rulesUi, { cardId: typeof r.cardId === 'string' ? r.cardId : null, decided });
  } catch (err) {
    rulesUi = { ...rulesUi, saving: false, result: err instanceof RpcError ? refusedResult(err.refusal) : { kind: 'refused', text: 'Nothing was saved: Gnomon did not answer.', next: 'check the connection, then save again' } };
  }
  await refreshStatus();
}
store.onChange((w) => {
  if (w.has('feed') || w.has('modes') || w.has('voice')) settings.repaint();
});
// #gui-voice-settings: the Voice settings sheet (a right-side drawer: your voice, send word, keys, listen, timing, risk)
const voiceSheet = mountVoiceSheet(document, {
  view: () => sheetView(),
  act: (a, v, trusted) => sheetAct(a, v, trusted),
  input: (field, text) => {
    if (field !== 'enrol-name') return; // the custom send word is read on its own press
    enrolName = text;
    voiceSheet.repaint();
  },
  onClose: () => {
    pendingRung = null;
    setFlow(null);
  },
});
// #gui-mods-panel: the Mods sheet (header Mods key, ⌘K "Mods…", the Workshop footer's key); requests only, never a decision
const loopsView = mountLoopsView({
  doc: document,
  host: $('pane-transcript'),
  status: () => status,
  hue: (repo) => hueOfRepo(repo),
  request: (req, trusted, done, onRefused) => loopRequest(req, trusted, done, onRefused),
  openLocal: () => settings.open(LOCAL_SECTION),
  pauseAll: (trusted) => void pauseAllLoops(trusted),
  say: (text, kind = 'info') => notice(text, kind, { source: 'loops' }),
  trustCard: (cardId) => {
    const c = store.cards.get(cardId);
    const inPile = cardInPile(cardId) as HTMLElement | null;
    if (!c || !inPile) return null;
    const el = inPile.cloneNode(true) as HTMLElement;
    el.querySelector('[data-loop-read]')?.remove();
    const allow = el.querySelector<HTMLElement>('[data-decision="allow"]');
    if (allow) allow.hidden = false;
    for (const d of el.querySelectorAll('details.card-details')) d.remove();
    return { el, lines: blockLines(c.card.block), loopId: cardLoopOf(c.card, store.loopCards)?.loopId ?? null };
  },
  hasCard: (cardId) => store.cards.has(cardId),
  onCardClick: (e) => onCardPress(e),
});
const modsPanel = mountMods(document, { client: () => client, status: () => status, cards: () => store.cards.values(), refreshStatus: () => refreshStatus(), focusCard: (cardId) => focusCard(cardId) });
store.onChange(() => modsPanel.repaint());
/** Settings → Revoke: the standing feed's own request (request.grant.standing.revoke, a tighten, no presence). */
async function revokeGrant(grantId: string): Promise<void> {
  if (!client) return notice('not connected: the grant was not revoked', 'fail', { source: 'revoke' });
  try {
    await client.call('log.append', revokeRequest(grantId));
    notice(null, 'info', { source: 'revoke' });
  } catch (err) {
    notice(err instanceof RpcError ? refusalText(err.refusal) : 'the grant was not revoked', 'fail', { source: 'revoke' });
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
// the extension-risk chip is the browser's (S25-L1): shown from boot, before any attach (Aegis), hidden only in the
// wrapper, which has no extensions
$('risk').hidden = SURFACE === 'wrapper';

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
      // the toast region lives in the chat column: keep it (pinned to the window's top right) before the desk goes
      const anchor = document.querySelector('.toast-anchor');
      if (anchor) {
        anchor.classList.add('lifted'); // styles.css: pinned to the window's top right
        $('gnomon').appendChild(anchor);
      }
      document.querySelector('.desk')?.remove();
      notice(out.message, 'fail');
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
  if (hint) {
    applyCwdHint(hintTarget(), hint);
    openNewSessionSheet();
  }
  if (pin.notice && previousPin) {
    // C2: a re-pin is sticky, kernel-owned, names both keyIds, and is recorded in gui.log
    const from = shortKeyId(previousPin);
    const to = shortKeyId(pin.verifyWith);
    put($('repin-text'), 'resumeToken' in auth ? resumeRepinText(from, to) : `kernel key re-pinned from ${from} to ${to} (the new key came with a launch from \`gnomon\` or \`gnomon up\`)`);
    $('repin').hidden = false;
    void gnomonPost(fetch, '/diag', out.session.guiToken, `kernel key re-pinned from ${from} to ${to}`).catch(() => undefined);
  }
  c.onProtocolError((r) => {
    notice(`kernel could not read a frame from this page: ${refusalText(r)}`, 'fail');
    void gnomonPost(fetch, '/diag', out.session.guiToken, `protocol error ${r.code} ${r.reason ?? ''} ${r.message}`).catch(() => undefined);
  });
  $('reconnect').hidden = true;
  staleStop = true;
  staleChannel()?.postMessage({ t: 'attached' }); // #gui-relaunch: a stale same-origin tab may step aside (no secrets)
  // board header-5b: the link is quiet when well (a filled dot; its word only for screen readers); who and which
  // connection are in its title=, the Gnomon menu's who line and Settings → About (Kernel connection)
  setLink('connected', { principal: out.session.principal, connId: out.session.connId });
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
        loopRow(r); // #gui-loops: loop done toasts and a status re-read
        localModel.row(r); // #gui-local-model: our card's outcome, a restart, a removal elsewhere, a probe
        rulesRow(r); // #gui-rules-view: a rule row re-reads status.rules; a timed off that ended is a 6 s toast
        trustDropRow(r); // C5'b: a server whose trust the kernel dropped (it changed) is a warn toast
        mcpFailRow(r); // C6'b1: a server of my running local session stopped: a fail toast with "see Tools"
        toolsDrawer?.row(r); // C6'b1: the open drawer re-reads on its session's tool.selection and session.mcp rows
        slashMenu?.flow.row(r); // C6'b2-1: a carded "/" run settled (read its result once); the open menu re-reads
        if (r.kind === 'session.memory' && settings.isOpen() && (r.payload as { op?: unknown } | undefined)?.op === 'delete') void kept.read(); // C6'b1: Kept memory
        mcpServers.row(r); // #gui-mcp-servers: our enable card's outcome
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
    notice(err instanceof RpcError ? refusalText(err.refusal) : 'log.read failed', 'fail');
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
  setLink('none');
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
    notice('not connected: nothing was sent', 'fail');
    return false;
  }
  if (!focused) {
    notice('no session focused: pick a session on the left or open a new one; nothing was sent', 'fail');
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
  // founder report 2026-10-23: a refused voice SEND reads in plain words (core/capture.ts voiceRefusalText). Mika
  // 2026-10-23: only here, on the send path; in refusalText every voice-* refusal (an attach, an input change) read
  // "not sent by voice · … next: press Enter to send it"
  const why = err instanceof RpcError ? (voiceRefusalText(err.refusal) ?? refusalText(err.refusal)) : 'may not have been sent: the connection to the kernel failed';
  if (echo || err instanceof RpcError) local.push({ seq: store.head + 0.6, kind: 'send.refused', connId: 'local', session: hsid, payload: why });
  schedule(new Set([`transcript:${hsid}`]));
}

/** session.open; null when it opened, else the refusal (the New session sheet shows it in place). */
async function openSession(cwd: string, model: string): Promise<{ why: string; refusal: ShownRefusal | null } | null> {
  if (!client) return { why: 'not connected: nothing was sent', refusal: null };
  try {
    const r = await client.call<{ hsid: string }>('session.open', { cwd, model, attended: true });
    focus(r.hsid);
    return null;
  } catch (err) {
    // the sheet keeps the choice and shows the refusal in place (a changed claude binary: with its Review re-pin card key)
    return err instanceof RpcError ? { why: refusalText(err.refusal), refusal: err.refusal } : { why: 'session.open failed', refusal: null };
  }
}

/* ── New session sheet (#gui-folder-field, TD-2026-10-23-162) ─────────────────────────────────────────────────── */
let nsMounted: MountedFolderField | null = null;
let nsOpening = false;
/** The New session folder field: recents, the kernel's chooser, a typed path (core/folder-field.ts). */
const nsField: FolderField = new FolderField({
  purpose: 'session',
  call: (req) => (client ? client.call('log.append', req) : Promise.reject(new Error('not connected'))),
  changed: () => paintNewSession(),
  // founder: every folder choice restores the claude model remembered for that folder
  chose: (real) => modelPicker?.onFolder(real),
});

function paintNewSession(): void {
  if (!nsMounted) nsMounted = mountFolderField(document, $('ns-folder'), nsField, { id: 'ns-ff', variant: 'recents', legend: { text: FF_COPY.legend, cls: 'meta' }, onEnter: (trusted) => void submitNewSession(trusted) });
  if ($('new-session-dialog').hidden) return;
  nsMounted.paint();
  const why = nsOpening ? null : nsField.whyOff();
  const open = $<HTMLButtonElement>('ns-open');
  open.textContent = nsOpening ? FF_COPY.opening : FF_COPY.open;
  open.disabled = nsOpening || why !== null;
  if (nsOpening) open.setAttribute('aria-busy', 'true');
  else open.removeAttribute('aria-busy');
  put($('ns-why'), why ?? '');
}

/**
 * ⌘N, + New session, the palette, or a verified terminal hint: the sheet opens on the centre session's folder (C2).
 * `kept`: it reopens on the choice Review re-pin card held (the folder; its remembered model follows), Open focused.
 */
function openNewSessionSheet(kept: KeptChoice | null = null): void {
  nsField.reset();
  nsField.setStatus(status);
  nsOpening = false;
  $('new-session-dialog').hidden = false;
  if (!hintBox.note.hidden) nsField.setHint(hintBox.note.textContent ?? '', hintBox.input.value || null);
  if (kept) nsField.restore(kept);
  paintNewSession();
  if (kept) void nsField.settled().then(() => (paintNewSession(), $<HTMLButtonElement>('ns-open').focus()));
  modelPicker?.onDialogOpen();
  const centre = focused ? (store.sessions.get(focused)?.cwd ?? null) : null;
  void nsField.loadRecents(centre).then(() => paintNewSession());
  // the status may be older than the kernel's folder support (a fresh attach): read it once more
  if (!status) void refreshStatus().then(() => nsField.setStatus(status));
}

function closeNewSessionSheet(): void {
  $('new-session-dialog').hidden = true;
  nsField.closed();
  nsOpening = false;
  hintBox.input.value = '';
}

/** Open (a trusted press or Enter): the sheet stays open, busy "Opening…", until session.open answers. */
async function submitNewSession(trusted: boolean): Promise<void> {
  if (!trusted || nsOpening || $('new-session-dialog').hidden) return; // Aegis L2: the human's own submit only
  await nsField.settled();
  const cwd = nsField.value();
  if (cwd === null) return paintNewSession();
  const model = modelPicker ? modelPicker.openModel($<HTMLSelectElement>('ns-model').value) : $<HTMLSelectElement>('ns-model').value;
  if (model === null) return; // #gui-model-picker: an invalid custom id stays in the sheet with its reason
  modelPicker?.remember(cwd, model);
  nsOpening = true;
  nsField.setRefused(null);
  const refused = await openSession(cwd, model);
  nsOpening = false;
  if (refused === null) {
    closeNewSessionSheet();
    clearCwdHint(hintTarget());
    return;
  }
  // a refusal shows in place and keeps the choice (design-system folder-field never: a refusal that closes the sheet)
  // only a refusal of the FOLDER marks it ✕ and asks for another one (Open off, focus on the chosen row); any other
  // refusal (no kernel, a changed binary, a limit) keeps the folder as it was and Open enabled, focused for a retry
  const why = refused.why;
  // TD-2026-10-19-063: a changed claude binary is said in plain words; the kernel pre-staged a re-pin card, and the
  // line's one key closes this modal sheet and focuses exactly that card (never another; none when it names none)
  const repin = binaryChangedLine(refused.refusal?.data);
  if (repin) {
    const cardId = repin.cardId;
    nsField.setOpenFailed(repin.text, cardId ? { label: REPIN_COPY.key, title: REPIN_COPY.keyTitle, press: () => reviewRepinCard(cardId) } : undefined);
  } else if (/\bcwd\b/i.test(why)) nsField.setRefused(`${why.split(':')[0]}  ${nsField.state().chosen?.display || 'the folder'} is no longer there · next: choose the folder again`);
  else nsField.setOpenFailed(why);
  if (nsField.state().errorKey) ($('ns-folder').querySelector('[data-ff-act="error-key"]') as HTMLElement | null)?.focus();
  else if (nsField.state().refused) (($('ns-folder').querySelector('.ff-row[aria-checked="true"]') ?? $('ns-folder').querySelector('[data-ff-act="choose"]')) as HTMLElement | null)?.focus();
  else ($('ns-open') as HTMLButtonElement).focus();
}

/**
 * Review re-pin card: hold the sheet's choice against THAT card, close the sheet (it is modal: the stack is behind it)
 * and focus the card. Its allow reopens the sheet on the choice (repinReturn); deny or expiry does not.
 */
const repinReturn = new RepinReturn<KeptChoice>();
function reviewRepinCard(cardId: string): void {
  const k = nsField.keep();
  if (k) repinReturn.hold(cardId, k);
  closeNewSessionSheet();
  focusCard(cardId, 're-pin card');
}
store.onChange((what) => {
  if (repinReturn.cardId === null) return;
  for (const key of what) {
    const o = cardOutcomeOf(key);
    const kept = o ? repinReturn.outcome(o.cardId, o.decision) : null;
    // one Enter opens it: never opened for the human; a sheet they already reopened is left as it is
    if (kept && $('new-session-dialog').hidden) openNewSessionSheet(kept);
  }
});

/** Modal sheets that hide the stack: a card focus closes them first (ui/card-focus.ts uncoverStack). */
const stackCovers: CoveringSheet[] = [{ open: () => !$('new-session-dialog').hidden, close: () => closeNewSessionSheet() }];

/** The card with exactly this cardId in the stack, or null: never another card (ui/card-focus.ts). */
const cardInPile = (cardId: string): Element | null => cardIn($('stack'), cardId);

/**
 * Scroll to the card with exactly this cardId and focus its default key (Deny on a claim-mismatch card), else its
 * first key. Never decides, never focuses a different card: when it has not arrived yet, a warn names it (`what`) and
 * clears when it arrives (checkCardWait).
 */
function focusCard(cardId: string, what: CardLabel = 'card'): void {
  uncoverStack(stackCovers);
  const el = cardInPile(cardId);
  if (!el) {
    notice(notArrivedText(what), 'warn');
    if (noticeShown) cardWait = { cardId, toast: noticeShown };
    return;
  }
  el.scrollIntoView({ block: 'nearest' });
  ((el.querySelector('[data-default]') ?? el.querySelector('[data-decision]') ?? el) as HTMLElement).focus();
}

/**
 * #gui-local-model (rule form-says-where-the-card-is): Decide in the stack focuses the card GROUP, never its Allow,
 * so a second Enter cannot allow it.
 */
function focusCardGroup(cardId: string, what: CardLabel = 'grant card'): void {
  uncoverStack(stackCovers);
  const el = cardInPile(cardId) as HTMLElement | null;
  if (!el) {
    notice(notArrivedText(what), 'warn');
    if (noticeShown) cardWait = { cardId, toast: noticeShown };
    return;
  }
  el.setAttribute('tabindex', '-1');
  el.scrollIntoView({ block: 'nearest' });
  el.focus();
}
/** The loops a turned-off local model stops: trusted, runnable, with a model step, while an endpoint serves loops. */
function loopsUsingLocal(): string[] {
  if (!localStatusOf(status).endpoints.some((e) => e.loops)) return [];
  return (loopsOf(status)?.loops ?? []).filter((x) => x.trustedHash && x.state !== 'invalid' && x.state !== 'waiting-trust' && x.shape?.nodes.some((n) => n.type === 'model')).map((x) => x.loopId);
}
/** A local.config card waiting from an earlier load: its request line and the entries it asked for (verified rows). */
function localCardRequest(cardId: string): { at: number; line: string; entries: ReturnType<typeof setupForm> | null } | null {
  const c = store.cards.get(cardId);
  const rr = c ? rootRowsOf(c.card) : null;
  if (!c || !rr || rr.action !== 'local.config') return null;
  const want = rr.detail?.endpoint;
  const local = (rr.rows[0]?.local ?? {}) as { endpoints?: Array<{ id: string; base: string; model: string; compat: string; loops?: boolean }> };
  const e = (local.endpoints ?? []).find((x) => x.id === want);
  if (!e) return null;
  const at = c.raisedAt ? Date.parse(c.raisedAt) : Date.now();
  const ep = { id: e.id, base: e.base, model: e.model, compat: e.compat, loops: e.loops === true };
  const was = localStatusOf(status).endpoints.find((x) => x.id === e.id);
  const entries = was ? { ...changeForm(was), base: ep.base, model: ep.model, compat: ep.compat, loops: ep.loops } : { ...setupForm(), ...ep, baseTyped: true, idTyped: true };
  return { at, line: requestLine(new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), ep), entries };
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

/* ── the growing composer (#gui-composer; core/composer.ts) ─────────── */
/** the ⤢ tall view (24 lines), per viewer */
let composerTall = parseTall(localStorage.getItem(TALL_KEY));
/** Fit the textarea to its text: it grows to 12 lines (24 in the tall view), then scrolls; the line count follows. */
function fitComposer(): void {
  const ta = $<HTMLTextAreaElement>('composer-text');
  const cs = getComputedStyle(ta);
  const px = (v: string): number => parseFloat(v) || 0;
  const edge = px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth);
  ta.style.height = 'auto';
  // empty, it is one line whatever the placeholder: a long "Reply to <title>…" wrapped at 1024 and made the empty
  // composer two lines tall with a "2 lines" count (Mika 2026-10-23; the placeholder stays on one line in styles.css)
  const own = ta.value === '' ? px(cs.lineHeight) + edge : ta.scrollHeight + px(cs.borderTopWidth) + px(cs.borderBottomWidth);
  // B1 at the caret: while the ghost mirror shows, the composer is as tall as the text WITH the live words
  const ghost = $('composer-ghost');
  if (!ghost.hidden) {
    ghost.style.width = `${ta.clientWidth}px`;
    ghost.style.height = 'auto';
  }
  const content = ghost.hidden ? own : Math.max(own, ghost.scrollHeight + px(cs.borderTopWidth) + px(cs.borderBottomWidth));
  let f = composerFit(content, px(cs.lineHeight), edge, composerTall);
  ta.style.height = `${f.heightPx}px`;
  if (composerTall && Math.min(f.lines, f.cap) > COMPOSER_LINES) {
    // the tall view never pushes send off the pane nor squeezes the conversation below TALL_FEED_MIN_PX (fitTallRoom)
    const pane = $('pane-transcript');
    const feed = pane.querySelector('.feed') as HTMLElement | null;
    const form = $('composer');
    const over = Math.max(0, form.getBoundingClientRect().bottom + px(getComputedStyle(form).marginBottom) - pane.getBoundingClientRect().bottom);
    f = fitTallRoom(f, px(cs.lineHeight), edge, TALL_FEED_MIN_PX - (feed?.clientHeight ?? TALL_FEED_MIN_PX) + over);
    ta.style.height = `${f.heightPx}px`;
  }
  ta.style.overflowY = f.scrolls ? 'auto' : 'hidden';
  // one row at the bottom right: the count only from 2 lines up (design-system composer)
  const lines = $('composer-lines');
  lines.hidden = !lineCountShown(f.lines);
  put(lines, lines.hidden ? '' : lineCountLabel(f.lines));
  $('composer').classList.toggle('tall', composerTall);
  const k = $('composer-tall');
  k.setAttribute('aria-pressed', String(composerTall));
  k.title = composerTall ? 'Tall view: up to 24 lines (again: back to 12)' : 'Tall view: up to 24 lines';
  placeGhost();
}
function toggleComposerTall(): void {
  composerTall = !composerTall;
  localStorage.setItem(TALL_KEY, serializeTall(composerTall));
  fitComposer();
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
  await client.call('log.append', clientRequest('start', currentCapture())).catch((err: unknown) => notice(err instanceof RpcError ? refusalText(err.refusal) : 'the voice app was not restarted with the new listening mode', 'fail'));
}
/** the last ⌃⌥Return count seen (a baseline first: presses before this page never send) */
let sendNowsSeen: { n: number; epoch: string | null } | null = null;

/** TD-2026-10-21-514: the mic on/off from the GUI (palette, in-app `): the voice app toggles on a changed count. */
async function micToggle(trusted: boolean): Promise<void> {
  if (!trusted || !client || !canAttach(status)) return;
  try {
    await client.call('log.append', { kind: 'request.voice.client', payload: { op: 'mic-toggle' } });
    notice(null, 'info', { source: 'mic' }); // a stale "the mic was not toggled" goes once it works
  } catch (err) {
    notice(err instanceof RpcError ? refusalText(err.refusal) : 'the mic was not toggled', 'fail', { source: 'mic' });
  }
}

/** The Mic key switch: ⌃` (default, global) or a bare ` everywhere (opt-in, with its warning). */
async function setMicKey(bare: boolean, trusted: boolean): Promise<void> {
  if (!trusted || !client || !canAttach(status)) return;
  try {
    await client.call('log.append', { kind: 'request.voice.client', payload: { op: 'mic-key', bare } });
    // a bare ` is a warn (it types in no app while voice runs; the Voice settings keys row says so too)
    notice(bare ? 'Mic key: ` everywhere. While Gnomon voice runs, ` will not type in any app.' : 'Mic key: ⌃` (and ` inside Gnomon)', bare ? 'warn' : 'info', { source: 'mic-key' });
    await refreshStatus();
  } catch (err) {
    notice(err instanceof RpcError ? refusalText(err.refusal) : 'the mic key was not changed', 'fail', { source: 'mic-key' });
  }
}
/**
 * Founder request 2026-10-23: the human picks the voice input (null = follow the system default). The kernel keeps the
 * choice across restarts and the voice app moves the mic to it; the sheet's input row shows the result.
 */
/** #voice-reply-mode: Speak and show | Show only, the human's trusted press only; the kernel keeps it per kernel home (Aegis L3). */
async function setReplyMode(mode: ReplyMode, trusted: boolean): Promise<void> {
  if (!trusted) return;
  if (!client) return notice('not connected: the reply mode was not changed', 'fail');
  try {
    await client.call('log.append', replyModeRequest(mode));
    notice(mode === 'show' ? 'Replies: show only. Voice input stays on; replies are written, not spoken.' : 'Replies: spoken and shown.', 'info', { source: 'reply-mode' });
    await refreshStatus();
  } catch (err) {
    notice(err instanceof RpcError ? refusalText(err.refusal) : 'the reply mode was not changed', 'fail', { source: 'reply-mode' });
  }
  voiceSheet.repaint();
  paintVoice();
  paintVoiceMenu();
  // Mika Delta 10: the spoken part's tag says "not played" in Show only; mounted replies repaint with the new mode
  for (const it of items) if (it.said !== undefined) remountItem(it.key);
  paintTranscript();
}
async function selectInput(id: string | null, trusted: boolean): Promise<void> {
  if (!trusted || !client || !canAttach(status)) return;
  const name = id === null ? undefined : clientOf(status).mic.inputs.find((d) => d.id === id)?.name ?? clientOf(status).mic.chosenName ?? undefined;
  try {
    await client.call('log.append', { kind: 'request.voice.client', payload: { op: 'select-input', id, ...(name ? { name } : {}) } });
    await refreshStatus();
  } catch (err) {
    // Mika 2026-10-23: the kernel's plain words, no code (DESIGN.md principle 5, amended 2026-10-23)
    notice(err instanceof RpcError ? `the input was not changed: ${err.refusal.message}${err.refusal.next.length ? `\n  next: ${err.refusal.next.join(' · ')}` : ''}` : 'the input was not changed: the kernel did not answer', 'fail', { source: 'voice-input' });
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
  // founder report 2026-10-23: the caret goes just after the words that landed, so continued speech flows on (focus is
  // never taken: an unfocused composer keeps this as its last caret)
  if (e.type === 'turnRow' && dict.caret !== null && dict.text !== prev.text && ta.value === dict.text) ta.setSelectionRange(dict.caret, dict.caret);
  if (dict.sending && !prev.sending) void sendDictation();
  syncDictationTimer();
  paintDictation();
  fitComposer();
  paintGhost();
  stampPainted();
}

/**
 * Founder report 2026-10-23: where dictated words land. Only while the composer shows this draft: the selection when
 * the composer has the focus (the words replace it), else the last caret it had, collapsed (a selection is never
 * replaced unseen: the words go after it). A textarea keeps its selection when it loses the focus, and a value the
 * page sets puts it at the end, so "never placed" is the end. undefined: the end.
 */
function composerCaret(): TextRange | undefined {
  const ta = $<HTMLTextAreaElement>('composer-text');
  if (!dict.focusedHere || ta.value !== dict.text) return undefined;
  const { selectionStart: a, selectionEnd: b } = ta;
  if (document.activeElement === ta) return { start: a, end: b };
  const at = ta.selectionDirection === 'backward' ? a : b;
  return { start: at, end: at };
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

function myPrincipal(): string | null {
  const p = (status as { principal?: unknown } | null)?.principal;
  return typeof p === 'string' ? p : null;
}

/** The preset a rung sets (per machine); the pill and the ladder follow the kernel's state, not this. */
function applyVoicePreset(p: typeof voicePreset): void {
  const capture = currentCapture();
  voicePreset = p;
  localStorage.setItem(PRESET_KEY, p);
  syncVoicePolicy();
  if (currentCapture() !== capture) void applyCapture();
}

/* ── the voice ladder and the Voice settings sheet (#gui-voice-ladder, #gui-voice-settings; Atelier 2026-10-21) ── */
/** the sheet's one open inline flow */
let vsFlow: 'teach' | 'enrol' | 'risk' | 'keys' | 'input' | null = null;
/** the rung waiting on a setup step (it is applied once the step is done) */
let pendingRung: Rung | null = null;
let riskAck = false;
let teach: TeachState | null = null;
let enrolName = '';
let enrolAgreed = false;
/** when this page last saw a heard voice turn (the pill's "heard Ns ago") */
let lastHeardAt: number | null = null;

const readiness = (): Readiness => ({ acked: acked(localStorage, myPrincipal()), sendWord: sendWordOf(status) });
const RUNG_OF_PRESET: Readonly<Record<typeof voicePreset, Rung>> = Object.freeze({ talk: 'talk', dictate: 'dictate', 'send-word': 'word', pieces: 'pieces' });

/**
 * Choose a rung (the ladder, the palette): ready → the preset and the voice state in one gesture; not ready → the
 * sheet opens at the section that makes it ready (the rung waits there and is applied once that is done).
 */
async function chooseRungUi(r: Rung, trusted: boolean): Promise<void> {
  if (!trusted) return;
  const c = chooseRung(r, readiness());
  if (c.kind === 'setup') {
    closeVoiceMenu(false);
    return openVoiceSettings(c.section, r);
  }
  closeVoiceMenu(true);
  const p = presetOfRung(r);
  if (p) applyVoicePreset(p);
  const to = stateOfRung(r);
  await setVoice(to, voiceTargetFor(to), true, sendOfRung(r));
}

/** Open the Voice settings sheet, at a section; a not-ready rung opens that section's inline step. */
function openVoiceSettings(section?: SheetSection, rung: Rung | null = null): void {
  settings.close();
  pendingRung = rung;
  if (section === 'sendword' && rung) startTeachFlow();
  else if (section === 'risk') setFlow('risk');
  voiceSheet.open(section);
}

/** One inline flow at a time: leaving the send-word teaching clears its trial (it never outlives the row). */
function setFlow(f: typeof vsFlow): void {
  if (vsFlow === 'teach' && f !== 'teach') void endTeach();
  if (vsFlow === 'enrol' && f !== 'enrol') void closeEnrol(true);
  vsFlow = f;
  if (f === 'risk') riskAck = acked(localStorage, myPrincipal());
  syncEnrolPoll();
}

function sheetView(): SheetView {
  const v = voiceStatusOf(status);
  const c = clientOf(status);
  const r = readiness();
  const rows = sheetRows({ ...r, ackedAt: ackedAt(localStorage, myPrincipal()), enrolled: c.enrolled, reteach: enrolNudgeOf(c) === 'reteach', micKeyBare: micKeyBareOf(status), capture: capturePref, delayMs: dict.delayMs, hotkey: v.hotkey, attachable: canAttach(status), client: c, replyMode: replyModeOf(status) });
  let flow: FlowView | null = null;
  if (vsFlow === 'teach' && teach) flow = { kind: 'teach', s: teach, attached: v.hsid !== null };
  else if (vsFlow === 'enrol' && store.enrol) flow = { kind: 'enrol', s: store.enrol, name: enrolName, agreed: enrolAgreed, enrolled: c.enrolled, forgetArmed, level: null };
  else if (vsFlow === 'risk') flow = { kind: 'risk', rung: pendingRung === 'word' || pendingRung === 'pieces' ? pendingRung : null, ack: riskAck, word: r.sendWord?.text ?? null };
  else if (vsFlow === 'keys') flow = { kind: 'keys', bare: micKeyBareOf(status) };
  else if (vsFlow === 'input') flow = { kind: 'input', choices: inputChoices(c), on: c.mic.on };
  return { rows, flow, delayMs: dict.delayMs, attachable: canAttach(status) };
}

/** A press in the sheet (trusted gestures only, G-GUI-04). */
function sheetAct(action: string, value: string, trusted: boolean): void {
  if (!trusted) return;
  if (action === 'act') {
    if (value === 'enrol') openEnrolFlow();
    else if (value === 'sendword') {
      pendingRung = null;
      startTeachFlow();
    } else if (value === 'keys') setFlow('keys');
    else if (value === 'input') setFlow('input');
    else if (value === 'risk') {
      pendingRung = null;
      setFlow('risk');
    } else if (value === 'listen.open' || value === 'listen.toggle') {
      capturePref = value === 'listen.toggle' ? 'toggle' : 'open';
      localStorage.setItem(CAPTURE_KEY, capturePref);
      void applyCapture();
    } else if (value === 'reply.show' || value === 'reply.speak') void setReplyMode(value === 'reply.show' ? 'show' : 'speak', trusted);
  } else if (action === 'pick') void teachStep({ type: 'pick', text: value });
  else if (action === 'teach') {
    if (value === 'common-yes' || value === 'common-no') void teachStep({ type: 'confirmCommon', yes: value === 'common-yes' });
    else if (value === 'retry') void retryTeach();
    else if (value === 'other') void endTeach().then(() => ((teach = initialTeach(acked(localStorage, myPrincipal()), ackedAt(localStorage, myPrincipal()))), (vsFlow = 'teach'), voiceSheet.repaint()));
    else if (value === 'save') void submitTeach(true);
    else if (value === 'cancel') setFlow(null);
  } else if (action === 'variant') {
    if (teach) teach = reduceTeach(teach, { type: 'keepVariant', variant: value.slice(2), on: value.startsWith('1:') });
  } else if (action === 'ack') {
    const [which, on] = value.split(':');
    if (which === 'teach' && teach) teach = reduceTeach(teach, { type: 'ack', on: on === '1' });
    else if (which === 'risk') riskAck = on === '1';
  } else if (action === 'risk') {
    if (value === 'go') return submitRisk();
    setFlow(null);
  } else if (action === 'enrol') {
    if (value === 'go') void submitEnrol(true);
    else setFlow(null);
  } else if (action === 'agree') enrolAgreed = value === '1';
  else if (action === 'forget') void forgetVoice(value, true);
  else if (action === 'mickey') void setMicKey(value === 'bare', true);
  else if (action === 'delay') setDictationDelay(parseDelay(value));
  else if (action === 'keys') setFlow(null);
  else if (action === 'input') void selectInput(value || null, true);
  else if (action === 'input-done') setFlow(null);
  voiceSheet.repaint();
}

/** The risk check (Pieces, or a review): "I understand" records the acknowledgement; a waiting rung then turns on. */
function submitRisk(): void {
  const me = myPrincipal();
  if (!riskAck || !me) return;
  recordAck(localStorage, me);
  const r = pendingRung;
  pendingRung = null;
  setFlow(null);
  voiceSheet.repaint();
  if (r) {
    voiceSheet.close();
    void chooseRungUi(r, true);
  }
}

/* ── teaching the send word, inline (pick, the kernel's attended trial counts the takes, risk check, save) ── */
function teachOpen(): boolean {
  return teach !== null && vsFlow === 'teach' && voiceSheet.isOpen();
}
function startTeachFlow(): void {
  setFlow('teach');
  teach = initialTeach(acked(localStorage, myPrincipal()), ackedAt(localStorage, myPrincipal()));
}
/** Leave the teaching: a trial word never outlives the row (an unsaved 'done' included). */
async function endTeach(): Promise<void> {
  const was = teach;
  teach = null;
  if (vsFlow === 'teach') vsFlow = null;
  if (client && was && was.step !== 'pick' && was.step !== 'confirm-common') await client.call('log.append', { kind: 'request.voice.sendword', payload: { op: 'clear', trial: true } }).catch(() => undefined); // Aegis L-2: only the trial; the held word stays
}
async function teachStep(e: TeachEvent): Promise<void> {
  if (!teach) return;
  const prev = teach;
  teach = reduceTeach(teach, e);
  // entering the takes: the kernel starts the attended trial (it counts every take; status.voice.sendWordTrial)
  if (client && teach.step === 'takes' && prev.step !== 'takes' && e.type !== 'status') await startTrial(teach.word);
  voiceSheet.repaint();
}
async function startTrial(word: string): Promise<void> {
  if (!client) return;
  await client
    .call('log.append', { kind: 'request.voice.sendword', payload: { op: 'start', word, trial: true } })
    .then(() => refreshStatus())
    .catch((err: unknown) => {
      if (teach) teach = { ...(teach as TeachState), hint: err instanceof RpcError ? refusalText(err.refusal) : 'the voice app could not be told the word' };
    });
}
/** A fresh trial of the same word (the kernel keeps a live trial's count, so it is cleared first). */
async function retryTeach(): Promise<void> {
  if (!client || !teach || teach.step !== 'exhausted') return;
  const word = teach.word;
  await client.call('log.append', { kind: 'request.voice.sendword', payload: { op: 'clear', trial: true } }).catch(() => undefined);
  teach = { ...initialTeach(teach.prior, teach.ackedAt), ack: teach.ack, step: 'takes', word };
  voiceSheet.repaint();
  await startTrial(word);
  voiceSheet.repaint();
}
async function submitTeach(trusted: boolean): Promise<void> {
  if (!trusted || !teach || !client) return;
  const commit = teachCommit(teach); // a take heard as the word AND the risk box ticked
  if (!commit) return;
  const me = myPrincipal();
  try {
    await client.call('log.append', { kind: 'request.voice.sendword', payload: commit });
    if (me) recordAck(localStorage, me); // the risk check right before save is the acknowledgement
    teach = null;
    vsFlow = null;
    await refreshStatus();
    const r = pendingRung;
    pendingRung = null;
    if (r) {
      voiceSheet.close();
      void chooseRungUi(r, true);
    } else notice('send word saved');
  } catch (err) {
    if (teach) teach = reduceTeach(teach, { type: 'saveRefused', reason: err instanceof RpcError ? refusalText(err.refusal) : 'the send word was not saved', code: err instanceof RpcError ? err.refusal.reason : null });
  }
  voiceSheet.repaint();
}
/** While the trial listens, a voice turn is a take (never a draft): the kernel counted it; re-read its trial. */
function teachHeard(): void {
  void refreshStatus();
}

/** A live row: a dictated turn for the composer, or the draft session's streaming (resets the ring). */
function dictationRow(r: Row): void {
  // the send-word dialog is listening: this turn is a take (the kernel stamps trialTake), never a draft
  // the send-word row is open: nothing heard becomes a composer draft. Only while the kernel's trial listens is a turn a
  // take (it counts it; the heard text is read from status.voice.sendWordTrial.last, take rows are hash-only); once the
  // trial is ready or exhausted the kernel treats turns as ordinary, and the row still keeps them out of the draft
  if (r.kind === 'voice.turn.user' && teachOpen()) {
    if (r.seq > dict.lastSeq) dict = { ...dict, lastSeq: r.seq };
    if (teach?.step === 'takes') teachHeard();
    return;
  }
  const tp = r.payload && typeof r.payload === 'object' ? (r.payload as Record<string, unknown>) : null;
  if (r.kind === 'voice.turn.user' && tp?.trialTake !== true) lastHeardAt = Date.now(); // the pill's "heard Ns ago"
  if (!dictationOn()) return;
  const now = Date.now();
  if (r.kind === 'voice.turn.user') {
    const p = r.payload && typeof r.payload === 'object' ? (r.payload as Record<string, unknown>) : null;
    // Aegis 2026-10-21 privacy: a draftOnly row is hash-only; its words come from status.voice.unverified (releaseTurnRows)
    voiceRowQueue.push({ seq: r.seq, hsid: r.session ?? (typeof p?.hsid === 'string' ? p.hsid : null), payload: r.payload, at: now });
    flushVoiceRows();
  }
  if (dict.hsid && r.session === dict.hsid) dispatchDictation({ type: 'busy', busy: store.sessions.get(dict.hsid)?.state === 'streaming', now });
}

/** Live voice.turn.user rows waiting for an unverified voice's words (status.voice.unverified), released in order. */
let voiceRowQueue: QueuedTurnRow[] = [];
let voiceRowTimer: ReturnType<typeof setTimeout> | null = null;
function flushVoiceRows(): void {
  const now = Date.now();
  const { ready, rest } = releaseTurnRows(voiceRowQueue, unverifiedTextsOf(status), now);
  voiceRowQueue = rest;
  // founder report 2026-10-23: each turn lands at the composer's caret (read per turn: the last one moved it)
  for (const q of ready) {
    const at = composerCaret();
    dispatchDictation({ type: 'turnRow', seq: q.seq, hsid: q.hsid, payload: q.payload, now, ...(at ? { at } : {}) });
  }
  // a row still waits for its words: re-read status soon (the kernel holds them in memory, human class only)
  if (rest.length && !voiceRowTimer)
    voiceRowTimer = setTimeout(() => {
      voiceRowTimer = null;
      void refreshStatus().then(flushVoiceRows);
    }, 200);
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
    // Aegis M-5: a voice-origin send of an unedited draft; an edited one is held for Enter
    if (fresh && hasDraft(dict) && dict.focusedHere) dispatchDictation({ type: 'sendNowKey', now });
  }
}

function setDictationDelay(d: number | null): void {
  localStorage.setItem(DELAY_KEY, serializeDelay(d));
  dispatchDictation({ type: 'setDelay', delayMs: d, now: Date.now() });
  if (!$('voice-menu').hidden) paintVoiceMenu();
  voiceSheet.repaint();
  // TD-2026-10-20-125: the delay applies to Talk (push-to-talk) only; open-mic speech always waits for Enter / Send
  notice(d === null ? 'dictation: auto-send off (Send or Enter sends)' : `dictation: Talk auto-sends after ${delayLabel(d)} of silence; Dictate waits for Enter`);
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
    fitComposer();
  } catch (err) {
    unsentEcho(echo, err, req.hsid);
    if (!(err instanceof RpcError)) notice('the dictated draft was not sent; it stays in the composer', 'fail');
    dispatchDictation({ type: 'sendFailed', now: Date.now() });
    const ta = $<HTMLTextAreaElement>('composer-text');
    if (dict.focusedHere && !ta.value) ta.value = dict.text; // the draft stays in the composer
    fitComposer();
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
  // Mika: a mixed draft's note quotes the unverified words (truncated); the full words are the title
  const uq = on ? unverifiedQuote(dict) : null;
  const iq = on && !uq ? inheritedQuote(dict) : null; // Aegis H-1: the cut quote's full words, the same way
  const uw = on && dict.policy === 'word' && dict.sendWord ? uncheckedWords(dict) : null; // TD-2026-10-23-496: the note says 'some words'; these are they
  if (uw) $('dictation-live').title = `not checked as you: ${uw}`;
  else if (uq) $('dictation-live').title = `unverified voice: ${uq.full}`;
  else if (iq) $('dictation-live').title = `not checked as you: ${iq.full}`;
  else $('dictation-live').removeAttribute('title');
  // one send control (the composer's send); [Hold] / [Resume] only beside a push-to-talk countdown (DRAFT_CONTROLS)
  const hold = $('dictation-hold');
  hold.hidden = controls.hold === null;
  put(hold, controls.hold === 'resume' ? 'Resume' : 'Hold');
  hold.setAttribute('aria-pressed', String(controls.hold === 'resume'));
  bar.classList.toggle('held', controls.hold === 'resume');
  ($('composer-send') as HTMLButtonElement).disabled = dict.sending;
  // board header-5b: a draft waiting on another session is the pill's fact (never a loose header note)
  if (draftWaitingOf() !== draftWaitingShown) paintVoice();
}
let draftWaitingShown: string | null = null;
/** The session a dictated draft waits on (core/dictation.ts dictationNote 'draft waiting'), by its short name, or null. */
function draftWaitingOf(): string | null {
  const on = dictationOn() && dict.parts.length > 0;
  return on && dict.hsid && dictationNote(dict) === 'draft waiting' ? sessionName(dict.hsid) : null;
}

/** #gui-rules-view: rows that change status.rules re-read it; a kernel enabled{cause:'expired'} is a 6 s toast. */
function rulesRow(r: { kind: string; payload?: unknown; principal?: string }): void {
  if (!RULE_ROW_KINDS.has(r.kind)) return;
  if (isKernelPrincipal(r.principal, kernelPrincipalOf(session?.principal))) {
    const text = expiryToastOf(r, rulesStatusOf(status));
    if (text) toasts().show(text, { kind: 'info', key: { label: 'see Rules', onPress: (e: MouseEvent) => e.isTrusted && settings.open('rules') } });
  }
  void refreshStatus();
}

/**
 * C6'b1 (#gui-capability-browser): a kernel-signed session.mcp{state:'failed'} of a running local session this human
 * opened is a fail toast "<server> stopped: <short cause>" whose key "see Tools" opens the drawer at that server.
 */
function mcpFailRow(r: { kind: string; payload?: unknown; principal?: string }): void {
  if (r.kind !== 'session.mcp' || !isKernelPrincipal(r.principal, kernelPrincipalOf(session?.principal))) return;
  const t = mcpFailToastOf(r);
  if (!t || toolsSessionOf(t.hsid)?.access !== 'owner') return;
  toasts().show(t.text, { kind: MCP_FAIL_TOAST.kind, key: { label: MCP_FAIL_TOAST.key, onPress: (e: MouseEvent) => e.isTrusted && toolsDrawer?.openServer(t.hsid, t.server, true) } });
}

/** C5'b: a kernel-signed tool.trust{op:'dropped'} (launch or tools changed) is a warn toast; Trust again… opens its row. */
function trustDropRow(r: { kind: string; payload?: unknown; principal?: string }): void {
  if (r.kind !== 'tool.trust' || !isKernelPrincipal(r.principal, kernelPrincipalOf(session?.principal))) return;
  const t = trustDropToastOf(r, status);
  if (!t) return;
  toasts().show(t.text, {
    kind: TRUST_DROP_TOAST.kind,
    key: {
      label: TRUST_DROP_TOAST.key,
      onPress: (e: MouseEvent) => {
        if (!e.isTrusted) return;
        settings.open(MCP_SECTION);
        // the server's own row: its Trust… key (or its first key while trust waits on a new listing)
        const v = t.id.replace(/["\\]/g, '\\$&');
        const sec = document.querySelector(`#settings-body [data-section="${MCP_SECTION}"]`);
        const k = (sec?.querySelector(`[data-lm-act="mcp:trust"][data-lm-value="${v}"]`) ?? sec?.querySelector(`[data-lm-value="${v}"]`)) as HTMLElement | null;
        k?.scrollIntoView({ block: 'center' });
        k?.focus({ preventScroll: true });
      },
    },
  });
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
  if (teach) teach = reduceTeach(teach, { type: 'status', status }); // the kernel's one take counter
  voiceSheet.repaint();
  standingFeed.repaint(); // F6: today's grant (status.standing)
  localModel.statusChanged(); // #gui-local-model: a card waiting from an earlier load; the check after an Allow
  rulesUi = rulesReconcile(rulesUi, rulesStatusOf(status), (cardId) => store.cards.has(cardId)); // #gui-rules-view
  mcpServers.reconcile(); // #gui-mcp-servers: marks for servers gone, broken or already on drop
  settings.repaint(); // #gui-settings: the sheet re-reads the same status
  modsPanel.repaint(); // #gui-mods-panel: installed / available / pending
  modPanelsStatus(status); // a mod installed, paused or removed: its views (and the Workshop key) follow
  paintLoopsWord(); // #gui-loops: the header's loops word, the leaf, the edge tab and the stack's loop pieces
  loopsView.repaint();
  if (loopStackSig() !== stackLoopSig) void paintStack();
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
    notice(err instanceof RpcError ? refusalText(err.refusal) : 'the voice app was not stopped', 'fail');
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
let enrolPollMs: number | null = null;
/** the input picker's meter: the voice app relays the level at most 4 times a second */
const INPUT_METER_POLL_MS = 250;
/** A light status poll only while the enrol dialog waits on the Touch ID card or the voice app. */
function syncEnrolPoll(): void {
  const s = store.enrol;
  // founder request 2026-10-23: the input picker's live meter re-reads status.voice.mic.level while it is open
  const every = vsFlow === 'input' && voiceSheet.isOpen() ? INPUT_METER_POLL_MS : !!s && vsFlow === 'enrol' && voiceSheet.isOpen() && (s.step === 'confirm' || s.step === 'waiting' || s.step === 'phrase') ? ENROL_POLL_MS : null;
  if (enrolPoll && every !== enrolPollMs) {
    clearInterval(enrolPoll);
    enrolPoll = null;
  }
  if (every !== null && !enrolPoll) enrolPoll = setInterval(() => void refreshStatus(), every);
  enrolPollMs = every;
  syncMicMeter();
}

/**
 * Aegis L-2 (2026-10-23): the voice app relays the mic level only while this meter is open. The picker says so
 * (request.voice.client{op:'mic-meter', open:true}), renews it every MIC_METER_RENEW_MS (the kernel lets it lapse after
 * 15 s), and closes it when the picker or the sheet closes.
 */
let micMeterTimer: ReturnType<typeof setInterval> | null = null;
const MIC_METER_RENEW_MS = 10_000;
function micMeter(open: boolean): void {
  if (!client || !canAttach(status)) return;
  void client.call('log.append', { kind: 'request.voice.client', payload: { op: 'mic-meter', open } }).catch(() => undefined);
}
function syncMicMeter(): void {
  const want = vsFlow === 'input' && voiceSheet.isOpen();
  if (want && !micMeterTimer) {
    micMeter(true);
    micMeterTimer = setInterval(() => micMeter(true), MIC_METER_RENEW_MS);
  } else if (!want && micMeterTimer) {
    clearInterval(micMeterTimer);
    micMeterTimer = null;
    micMeter(false);
  }
}


const currentMode = () => sessionModeOf(status, focused);

function paintMode(): void {
  const v = currentMode();
  const btn = $('mode-btn');
  btn.hidden = !focused || !v; // the kernel feed and an exited session have no mode to set
  const chip = modeChip(v);
  const at = chip.indexOf(EDITS_BY_RULE_CHIP);
  if (at < 0) put(btn, chip);
  else {
    // the rule words in two forms; CSS shows one (≤1040px: the narrow one), so the name always matches what is seen
    clear(btn);
    btn.append(chip.slice(0, at), h(doc, 'span', { class: 'mb-full' }, EDITS_BY_RULE_CHIP) as unknown as Node, h(doc, 'span', { class: 'mb-narrow' }, h(doc, 'span', { 'aria-hidden': 'true' }, EDITS_BY_RULE_NARROW), h(doc, 'span', { class: 'sr-only' }, EDITS_BY_RULE_NARROW_NAME)) as unknown as Node, chip.slice(at + EDITS_BY_RULE_CHIP.length));
  }
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
  // TD-2026-10-23-939 follow-up: an "edits in this repo" always rule stands: revoke it here (narrows: no Touch ID)
  if (v.effective === 'ask' && v.editsByRule) menu.appendChild(h(doc, 'button', { class: 'mode-item scope', type: 'button', role: 'menuitem', 'data-revoke-rule': v.editsByRule }, h(doc, 'span', { class: 'mode-name' }, EDIT_RULE_REVOKE_LABEL), h(doc, 'span', { class: 'mode-note' }, EDIT_RULE_REVOKE_NOTE)) as unknown as Node);
  // #gui-rules-view (Mika C1): every Always rule, from the mode menu
  menu.appendChild(h(doc, 'button', { class: 'mode-item scope', type: 'button', role: 'menuitem', 'data-open-rules': '' }, 'Always rules…') as unknown as Node);
}

function openMoreMenu(): void {
  // #gui-capability-browser (C6'b1): "Tools and memory…" for a local attended session only
  $('tools-open').hidden = !focused || !toolsSessionOf(focused);
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
  if (!client) return notice('not connected: the run mode was not changed', 'fail', { source: 'run-mode' });
  const v = currentMode();
  if (!v) return notice('no live session focused: the run mode was not changed', 'fail', { source: 'run-mode' });
  const plan = planFor(v, to, scope);
  if (plan.kind === 'blocked') return notice(`${to} is not allowed here: ${plan.reason}`, 'fail', { source: 'run-mode' });
  if (plan.kind === 'same') return;
  const req = modeRequest(v, to, scope);
  if (!req) return notice('this session has no repo to set a mode for', 'fail', { source: 'run-mode' });
  if (modeBusy) return;
  modeBusy = true;
  try {
    const r = await client.call<Record<string, unknown>>('log.append', req);
    if (r.pending === true && typeof r.cardId === 'string') {
      notice(`run mode ${String(r.from)} → ${to}: confirm with Touch ID`, 'warn', { held: true, source: 'run-mode' });
      try {
        await client.call('approve', { cardId: r.cardId, decision: 'allow' });
        notice(null, 'info', { source: 'run-mode' });
      } catch (err) {
        notice(err instanceof RpcError ? `the run mode stays ${String(r.from)}: ${refusalText(err.refusal)}` : `the run mode stays ${String(r.from)}`, 'fail', { source: 'run-mode' });
      }
    } else notice(null, 'info', { source: 'run-mode' });
  } catch (err) {
    notice(err instanceof RpcError ? refusalText(err.refusal) : 'the run mode was not changed', 'fail', { source: 'run-mode' });
  } finally {
    modeBusy = false;
    await refreshStatus();
  }
}

/** ⇧Tab: the next mode in the cycle, skipping one the ceiling does not allow. */
function cycleMode(trusted: boolean): void {
  const v = currentMode();
  if (!v) return notice(focused ? 'this session reports no run mode (it ended, or the kernel is older)' : 'no session focused: ⇧Tab cycles the focused session\'s run mode', 'fail', { source: 'run-mode' });
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
  // V2e: with nothing attached, the voice app's lifecycle is the pill's fact (setup phases, crash, the enrol nudge);
  // attached, the live rung stands and the app's real condition is its fact (Aegis M V2d: never under-report)
  const c = clientOf(status);
  const attached = v.state !== 'off';
  const cp = clientPillOf(c, attached, canAttach(status));
  const cap = paintCapture(v, cp.label === null);
  const trouble = cp.label !== null || cp.tail !== null;
  const rung = rungOf(v, voicePreset);
  const bare = micKeyBareOf(status);
  const pv = voicePillOf({
    rung,
    hotkey: v.hotkey,
    sendWord: sendWordOf(status)?.text ?? null,
    attached,
    target: v.hsid ? sessionName(v.hsid) : '',
    clientConnected: v.clientConnected,
    clientFact: clientFactOf(cp.label, cp.tail),
    // Mika 2026-10-23: a mic fault's whole sentence goes in the accessible name (the pill shows a short cause)
    clientCause: c.micFault ? oneLine(c.micFault.text, ERROR_TITLE_MAX) : crashCauseOf(c, (e) => oneLine(e, ERROR_TITLE_MAX)),
    clientTitle: trouble && cp.title ? cp.title : null,
    capture: cap,
    // Mika 2026-10-23: a mic the voice app turned off is closed: a hollow dot and "mic closed", never "mic open"
    micClosed: attached && (v.micWanted === false || c.micFault !== null),
    micKeyBare: bare,
    heardAgoS: lastHeardAt === null ? null : (Date.now() - lastHeardAt) / 1000,
    draftWaiting: (draftWaitingShown = draftWaitingOf()),
    // Mika Delta 10: Show only is named on the pill while voice is on (the founder's "speak back or not" at a glance)
    replyMode: replyModeOf(status),
  });
  // board header-5b: when the voice app can't run (nothing attached), the pill IS the action ("Start voice · app not
  // running"); its accessible name says what a click does, and it opens no menu then
  const pa = pillActionOf(cp, attached, crashCauseOf(c, (e) => oneLine(e, ERROR_TITLE_MAX)));
  const btn = $('voice-pill');
  btn.className = `voice-pill kernel-owned rung-${rung}${pv.live ? ' live' : ''}${trouble ? ` voice-trouble ${cp.className}` : ''}${pa ? ' as-action' : ''}${cap ? ` ${cap.display.className}` : ''}`;
  btn.dataset.state = cp.label !== null ? `client-${c.phase}` : rung;
  if (pa) {
    btn.dataset.action = pa.action;
    btn.removeAttribute('aria-haspopup');
    btn.removeAttribute('aria-expanded');
    if (!$('voice-menu').hidden) closeVoiceMenu(false);
  } else {
    delete btn.dataset.action;
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', String(!$('voice-menu').hidden));
  }
  // founder request 2026-10-23: the mic in use is always named (or that the chosen one is missing)
  // (Mika 2026-10-23: not twice: a missing mic's tail title already names it and the fallback)
  btn.title = `${pa ? pa.title : pv.title}${trouble && c.mic.missing ? '' : micTitleLine(c)}`;
  btn.setAttribute('aria-label', pa ? pa.aria : pv.aria);
  put($('voice-label'), pa ? pa.name : pv.name);
  const fact = $('voice-fact');
  const factText = pa ? pa.fact : pv.fact;
  put(fact, factText ? `· ${factText}` : '');
  fact.className = `voice-fact${pa ? '' : pv.tone === 'fail' ? ' fail' : pv.tone === 'note' ? ' note' : ''}`;
  // "heard Ns ago" counts up once a second until it is gone (a timeout, never an interval; nothing idles)
  if (heardTimer) clearTimeout(heardTimer);
  heardTimer = pv.fact.startsWith('heard ') && pv.fact.endsWith('s ago') ? setTimeout(() => ((heardTimer = null), paintVoice()), 1000) : null;
  const bar = $('voice-progress');
  bar.hidden = cp.progress === null;
  if (cp.progress !== null) {
    bar.style.setProperty('--progress', String(cp.progress));
    bar.setAttribute('aria-valuenow', String(Math.round(cp.progress * 100)));
  }
  $('voice-stop').hidden = !stopSpeakingShown(status);
  const dev = devBannerOf(c);
  $('voice-dev').hidden = dev === null;
  put($('voice-dev'), dev ? `Warning: ${dev}` : '');
  if (!$('voice-menu').hidden) paintVoiceMenu();
  if (voiceSheet.isOpen()) {
    voiceSheet.repaint();
    voiceSheet.level(captureStatusOf(status)?.level ?? v.level ?? c.mic.level);
  }
  paintDictation();
}
let heardTimer: ReturnType<typeof setTimeout> | null = null;

/* ── live capture (T-2026-10-20-005 A1; core/capture.ts, #gui-voice-capture) ── */
let captureTrack: CaptureTrack | null = null;
/** when the page last RECEIVED a status (null: never on this connection) */
let statusAt: number | null = null;
let captureFlash: ReturnType<typeof setTimeout> | null = null;
let captionState: string | null = null;
/**
 * The capture overlay: only while voice is attached and the voice app is connected (`live`). The meter shows only
 * while hearing, drawn from the REAL level (meterShownOf; no decorative motion); the composer ghost line is its own
 * element, never the textarea (B1: the live words, committed solid and the tail dim, or "…"); the polite caption
 * changes on a state change only. Returns what the pill's fact reads (core/voice-ladder.ts voicePillOf), or null.
 */
function paintCapture(v: ReturnType<typeof voiceStatusOf>, pillOwned: boolean): { display: ReturnType<typeof captureDisplayOf>; cap: CaptureTrack['cap'] } | null {
  const live = pillOwned && !!client && v.state !== 'off' && v.clientConnected === true;
  captureTrack = live ? captureStep(captureTrack, freshCapture(captureStatusOf(status), statusAt, Date.now()), Date.now()) : null;
  const d = captureDisplayOf(captureTrack, Date.now(), live);
  const meter = $('voice-meter');
  meter.hidden = !meterShownOf(live, d);
  meter.style.setProperty('--level', String(d.meter));
  ghostOn = d.ghost;
  ghostWords = d.ghost ? d.ghostText : null;
  paintGhost();
  if (d.caption !== captionState) {
    captionState = d.caption;
    put($('voice-caption'), d.caption);
  }
  if (captureFlash) clearTimeout(captureFlash);
  captureFlash = d.flashLeftMs !== null ? setTimeout(() => ((captureFlash = null), paintVoice()), d.flashLeftMs + 20) : null;
  return live ? { display: d, cap: captureTrack?.cap ?? null } : null;
}

let ghostShown: string | null = null;
/** B1: the capture's live words (null: none yet, "…") and whether the ghost shows (hearing or transcribing) */
let ghostOn = false;
let ghostWords: GhostText | null = null;
/** Mika 2026-10-23: an IME composition in the composer shows the textarea itself (its own underline and text), not the mirror */
let composing = false;
/** Mika 2026-10-23: the mirror was rebuilt: bring the words into view once (a later scroll of the human's is theirs) */
let ghostReveal = false;
/**
 * B1 live words, AT THE CARET (founder report 2026-10-23): #composer-ghost is an aria-hidden mirror laid over the
 * textarea (placeGhost), never the textarea itself, so a send can never carry non-final words. While it shows, the
 * textarea's own text is transparent (its caret stays) and the mirror draws the composer text with the words where
 * the turn will land (placeWords, the reducer's own rule): committed solid, the unfixed tail dim, "…" before any
 * words. Text nodes only (put → sanitizeDisplayText); rebuilt only when the words, the text or the caret change.
 */
function paintGhost(): void {
  const el = $('composer-ghost');
  const ta = $<HTMLTextAreaElement>('composer-text');
  const was = !el.hidden;
  const on = ghostOn && !composing;
  el.hidden = !on;
  ta.classList.toggle('ghosting', on);
  if (!on) {
    ghostShown = null;
    if (was) fitComposer();
    return;
  }
  const t = ghostWords;
  const at = composerCaret();
  const key = `${t ? `${t.committed}\u0000${t.tail}` : ''}\u0001${at ? `${at.start}:${at.end}` : '-'}\u0001${dict.edited}\u0001${ta.value}`;
  if (key === ghostShown) return placeGhost();
  ghostShown = key;
  ghostReveal = true;
  clear(el);
  const words = t ? `${t.committed}${t.committed && t.tail ? ' ' : ''}${t.tail}` : '…';
  // the reducer's own rule, so the ghost sits exactly where the turn will land (the end when the composer is not this
  // draft's); the "…" before any words sits there too (Mika 2026-10-23: it went to the end whatever the caret)
  const p = placeWords(ta.value, at, words, !plainAppend({ text: ta.value, edited: dict.edited }, at));
  const core = p.insert.slice(p.lead, p.insert.length - p.trail);
  const before = document.createElement('span');
  put(before, `${p.before}${p.insert.slice(0, p.lead)}`);
  el.append(before);
  if (!t) {
    const wait = document.createElement('span');
    wait.className = 'ghost-wait';
    put(wait, '…');
    el.append(wait);
  } else {
    const committed = document.createElement('span');
    committed.className = 'ghost-committed';
    put(committed, core.slice(0, t.committed.length));
    const tail = document.createElement('span');
    tail.className = 'ghost-tail';
    put(tail, core.slice(t.committed.length));
    el.append(committed, tail);
  }
  const after = document.createElement('span');
  put(after, `${p.insert.slice(p.insert.length - p.trail)}${p.after}`);
  el.append(after);
  fitComposer();
}
/**
 * Lay the ghost mirror exactly over the textarea, scrolled with it. Mika 2026-10-23: the mirror is as wide as the
 * textarea's TEXT box (clientWidth: a shown scrollbar never makes the two wrap differently); after a rebuild the
 * words are brought into view once (the textarea scrolls with the mirror, so its caret stays on the words); when the
 * textarea cannot scroll that far (the words add lines past its end) its caret would float over other text, so it is
 * hidden until the two line up again.
 */
function placeGhost(): void {
  const el = $('composer-ghost');
  if (el.hidden) return;
  const ta = $<HTMLTextAreaElement>('composer-text');
  el.style.top = `${ta.offsetTop}px`;
  el.style.left = `${ta.offsetLeft}px`;
  el.style.width = `${ta.clientWidth}px`;
  el.style.height = `${ta.offsetHeight}px`;
  if (ghostReveal) {
    ghostReveal = false;
    const marks = el.querySelectorAll('.ghost-committed, .ghost-tail, .ghost-wait');
    const first = marks[0] as HTMLElement | undefined;
    const last = marks[marks.length - 1] as HTMLElement | undefined;
    if (first && last) {
      const top = first.offsetTop;
      const bottom = last.offsetTop + last.offsetHeight;
      const view = el.clientHeight;
      const line = parseFloat(getComputedStyle(el).lineHeight) || 0;
      // one line of the human's text above the words when there is room, for context
      let want = ta.scrollTop;
      if (bottom > want + view) want = Math.max(0, Math.min(top - line, bottom - view));
      else if (top < want) want = Math.max(0, top - line);
      ta.scrollTop = want;
      el.scrollTop = want;
    }
  } else el.scrollTop = ta.scrollTop;
  ta.classList.toggle('ghost-offset', Math.abs(el.scrollTop - ta.scrollTop) >= 1);
}

/** The session a rung applies to: Off goes to the attached session; a rung goes to the focused session (else the attached one). */
function voiceTargetFor(to: VoiceState): string | null {
  const v = voiceStatusOf(status);
  if (to === 'off') return v.hsid;
  return focused ?? v.hsid;
}

/** The ladder (the pill's popover): the rungs, the foot line and the settings link. Repainted only when it changes. */
let ladderShown = '';
function paintVoiceMenu(): void {
  const menu = $('voice-menu');
  const v = voiceStatusOf(status);
  const entries = ladderEntries({ ...readiness(), rung: rungOf(v, voicePreset), hotkey: v.hotkey, attachable: canAttach(status), target: voiceTargetFor('ptt'), ceiling: v.ceiling });
  const foot = ladderFoot({ micKeyBare: micKeyBareOf(status), capture: capturePref });
  const target = ladderTargetLine(focused, v.hsid, sessionName);
  menu.setAttribute('aria-label', ladderAria(target));
  // board header-5b: attached, the live rung stands on the pill; the voice app's action (Restart, Start voice, Teach)
  // is the ladder's first row instead of a separate header key
  const cp = clientPillOf(clientOf(status), v.state !== 'off', canAttach(status));
  // Mika 2026-10-23: a mic fault's row says the voice app's whole sentence (the pill has only the short cause)
  const mf = clientOf(status).micFault;
  const act = v.state !== 'off' && cp.action !== null ? { action: cp.action, label: cp.actionLabel, fact: mf && cp.className.includes('voice-micfault') ? oneLine(mf.text, ERROR_TITLE_MAX) : (clientFactOf(cp.label, cp.tail) ?? '') } : null;
  const replies = canAttach(status) ? replyModeOf(status) : null;
  const key = JSON.stringify([entries, foot, target, act, replies]);
  if (key === ladderShown && menu.firstChild) return;
  ladderShown = key;
  const had = (document.activeElement as HTMLElement | null)?.closest?.('#voice-menu [data-rung], #voice-menu [data-reply-mode], #voice-menu [data-vs-open]') as HTMLElement | null;
  const fk = had ? (had.dataset.rung ?? (had.dataset.replyMode ? `reply:${had.dataset.replyMode}` : 'settings')) : null;
  clear(menu);
  if (act) menu.appendChild(h(doc, 'div', { class: 'ladder-start' }, h(doc, 'span', { class: 'meta' }, act.fact), h(doc, 'button', { class: 'key', type: 'button', role: 'menuitem', 'data-voice-act': act.action }, act.label)) as unknown as Node);
  for (const el of ladderEls(doc, entries, foot, target, replies)) menu.appendChild(el as unknown as Node);
  if (fk) ((fk === 'settings' ? menu.querySelector('[data-vs-open]') : fk.startsWith('reply:') ? menu.querySelector(`[data-reply-mode="${fk.slice(6)}"]`) : menu.querySelector(`[data-rung="${fk}"]`)) as HTMLElement | null)?.focus();
}
/** The ladder's focusable items, in order (arrow keys move among them). */
const ladderItems = (): HTMLElement[] => [...$('voice-menu').querySelectorAll<HTMLElement>('[data-voice-act], [data-rung]:not([disabled]), [data-reply-mode], [data-vs-open]')];
function openVoiceMenu(): void {
  // voice drops fix: opening the ladder is the human's dismiss of a sticky drop on the pill (core/capture.ts)
  captureTrack = captureDismiss(captureTrack, Date.now());
  $('voice-menu').hidden = false;
  $('voice-pill').setAttribute('aria-expanded', 'true');
  ladderShown = '';
  paintVoiceMenu();
  paintVoice();
  (($('voice-menu').querySelector('[data-rung][aria-checked="true"]:not([disabled])') as HTMLElement | null) ?? ladderItems()[0])?.focus();
}
function closeVoiceMenu(focusPill = false): void {
  if ($('voice-menu').hidden) return;
  $('voice-menu').hidden = true;
  $('voice-pill').setAttribute('aria-expanded', 'false');
  if (focusPill) $('voice-pill').focus();
}

/**
 * One gesture sets voice (G-GUI-04: trusted events only). Off and a narrowing apply on the kernel's answer; the
 * first widening to ambient in this GUI login comes back as a pending presence card this same gesture approves
 * `allow` (the kernel asks for Touch ID), as a run-mode loosening does. A refusal is shown as given.
 */
async function setVoice(to: VoiceState, hsid: string | null, trusted: boolean, send: 'word' | 'pieces' | null = attachSend(voicePreset)): Promise<void> {
  if (!trusted) return;
  closeVoiceMenu();
  if (!client) return notice('not connected: voice was not changed', 'fail', { source: 'voice' });
  if (!canAttach(status)) return notice('only a human connection attaches voice', 'fail', { source: 'voice' });
  const v = voiceStatusOf(status);
  const plan = planVoice(v, to, hsid, voicePresenceDone);
  // the ladder's words in every notice (Off, Talk, Dictate, Send word, Pieces), never "ambient" / "push-to-talk"
  const toName = rungNameOf(to, send);
  if (plan.kind === 'blocked') return notice(`${toName} is not allowed: ${plan.reason}`, 'fail', { source: 'voice' });
  // the ladder: Dictate, Send word and Pieces share the ambient state, so a rung change on the same session re-attaches
  // with the new send ceiling (the kernel reports the current one as status.voice.send)
  if (plan.kind === 'same' && !(to === 'ambient' && v.send !== null && v.send !== (send ?? 'key'))) return;
  const req0 = voiceRequest(v, to, hsid);
  // TD-2026-10-21-514: an ambient attach asks for the rung's send ceiling (word | pieces; pieces takes a presence card)
  const ceil = send;
  // Aegis M-4: the liability acknowledgement (recorded by the dialog) rides the attach; the kernel writes it into the start row
  const ackOk = acked(localStorage, myPrincipal());
  const req = req0 && req0.kind === 'voice.session.start' && req0.payload.mode === 'conversation' && ceil && ackOk ? { ...req0, payload: { ...req0.payload, send: ceil, liabilityAck: VOICE_LIABILITY_ACK_HASH } } : req0;
  if (!req) return;
  if (voiceBusy) return;
  voiceBusy = true;
  try {
    // V2e seamless: attaching (or choosing an open-mic rung) while the voice app is not running starts it in the same gesture
    if (to !== 'off' && needsStart(clientOf(status))) {
      await client.call('log.append', clientRequest('start', currentCapture()));
      notice('Starting voice…', 'info', { source: 'voice' });
    }
    const r = await client.call<Record<string, unknown>>('log.append', req);
    if (r.pending === true && typeof r.cardId === 'string') {
      // Aegis L (V2d): approve in this gesture ONLY the voice-widen presence card for this session; else the stack decides
      if (!isVoiceWidenCard(store.cards.get(r.cardId), hsid)) {
        focusCard(r.cardId, 'voice card');
        notice(`${toName} for ${sessionName(hsid ?? '')}: decide the pending card in the stack`, 'warn', { held: true, source: 'voice' });
        noticeCard = { cardId: r.cardId, seen: store.cards.has(r.cardId) };
        return;
      }
      notice(`${toName} for ${sessionName(hsid ?? '')}: confirm with Touch ID`, 'warn', { held: true, source: 'voice' });
      try {
        await client.call('approve', { cardId: r.cardId, decision: 'allow' });
        voicePresenceDone = true;
        notice(null, 'info', { source: 'voice' });
      } catch (err) {
        // the widen card (strictness, detail.op voice.widen) stays in the stack: focus it so the human can decide it there
        focusCard(r.cardId, 'voice card');
        const was = rungNameOf(v.state, v.send);
        notice(err instanceof RpcError ? `voice stays ${was}: ${voiceRefusalNote(err.refusal.reason, err.refusal.data) ?? refusalText(err.refusal)}` : `voice stays ${was}`, 'fail', { source: 'voice' });
      }
    } else {
      if (to === 'ambient') voicePresenceDone = true; // the kernel already held this login's presence
      notice(null, 'info', { source: 'voice' });
    }
  } catch (err) {
    notice(err instanceof RpcError ? (voiceRefusalNote(err.refusal.reason, err.refusal.data) ?? refusalText(err.refusal)) : 'voice was not changed', 'fail', { source: 'voice' });
  } finally {
    voiceBusy = false;
    await refreshStatus();
  }
}

/* ── voice app lifecycle, enrolment, notices (V2e; core/voice-client.ts) ─ */
/** Start / Stop the voice app: one log.append request.voice.client{op} on a trusted gesture (human connections only). */
/** The voice app's fix (board header-5b: the pill's own action, or the ladder's first row while attached). */
function voiceAct(a: string, trusted: boolean): void {
  if (a === 'enrol') return openEnrol(trusted);
  if (a === 'start' || a === 'restart') void voiceClientOp('start', trusted);
}
async function voiceClientOp(op: 'start' | 'stop', trusted: boolean): Promise<void> {
  if (!trusted) return;
  closeVoiceMenu();
  if (!client) return notice('not connected: the voice app was not changed', 'fail', { source: 'voice-app' });
  if (!canAttach(status)) return notice('only a human connection starts or stops the voice app', 'fail', { source: 'voice-app' });
  try {
    await client.call('log.append', op === 'start' ? clientRequest('start', currentCapture()) : clientRequest(op));
    notice(null, 'info', { source: 'voice-app' });
  } catch (err) {
    notice(err instanceof RpcError ? refusalText(err.refusal) : `the voice app was not ${op === 'start' ? 'started' : 'stopped'}`, 'fail', { source: 'voice-app' });
  } finally {
    await refreshStatus();
  }
}

/** "your voice": the enrolment opens inline under its row in the Voice settings sheet (phrase N of 3, a level meter). */
function openEnrolFlow(): void {
  if (!canAttach(status)) return notice('only a human connection teaches Gnomon a voice', 'fail');
  setFlow('enrol');
  if (!store.enrol || store.enrol.step === 'done' || store.enrol.step === 'failed') {
    store.enrol = enrolStart();
    enrolName = '';
    enrolAgreed = false;
  }
  syncEnrolPoll();
}
/** The pill's [Teach] and the palette: the sheet, at "your voice", teaching. */
function openEnrol(trusted: boolean): void {
  if (!trusted) return;
  closeVoiceMenu();
  openVoiceSettings('voice');
  openEnrolFlow();
  voiceSheet.repaint(true);
}

function paintEnrol(): void {
  syncEnrolPoll();
  voiceSheet.repaint();
}

/** The row's one button: send the request (form), or finish with Touch ID (confirm). Trusted gestures only. */
async function submitEnrol(trusted: boolean): Promise<void> {
  const s = store.enrol;
  if (!trusted || !s) return;
  if (!client) return notice('not connected: no voice was enrolled', 'fail', { source: 'enrol' });
  if (!canAttach(status)) return notice('only a human connection teaches Gnomon a voice', 'fail', { source: 'enrol' });
  if (s.step === 'form' || s.step === 'failed') {
    const v = enrolRequest(enrolName, enrolAgreed);
    if (!v.ok) {
      store.enrol = { ...s, step: 'failed', error: v.reason };
      return paintEnrol();
    }
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
  if (!cardId) return notice(notArrivedText('Touch ID card'), 'warn');
  try {
    await client.call('approve', { cardId, decision: 'allow' });
    // allowed: the kernel asks the voice app to record (status.voice.enrolment 'requested'); progress folds in
    store.enrol = enrolAllowed({ ...s, cardId }, Date.now());
  } catch (err) {
    focusCard(cardId, 'Touch ID card');
    return notice(err instanceof RpcError ? `not enrolled yet: ${refusalText(err.refusal)}` : 'not enrolled yet', 'fail', { source: 'enrol' });
  }
  paintEnrol();
  await refreshStatus();
}

/** Close the enrolment; one whose card is still pending is cancelled by denying it (no Touch ID to say no). */
async function closeEnrol(trusted: boolean): Promise<void> {
  if (!trusted) return;
  const s = store.enrol;
  if (vsFlow === 'enrol') vsFlow = null;
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
    notice(err instanceof RpcError ? refusalText(err.refusal) : `${name} was not forgotten`, 'fail');
  }
  await refreshStatus();
}

let voiceToastShown: ToastHandle | null = null;
/**
 * A warn toast (#gui-toast, board gnomon-notices; it leaves by itself): a voice-app notice, or the kernel's idle
 * auto-off in the ladder's words (board header-5b: never a note left in the header); never a decision, never a
 * backlog replay. A newer one replaces the last.
 */
function showToast(): void {
  const t = store.voiceToast;
  store.voiceToast = null;
  if (!t || !toastFresh(t.at, Date.now())) return;
  voiceToastShown?.dismiss();
  voiceToastShown = toasts().show(t.text, { kind: 'warn' });
}

/* ── palette ────────────────────────────────────────────────────── */
/* ── #gui-wordmark-menu (board header-5b): "Gnomon ▾" holds the rare tools: Layout presets (panes and Workshop in
   place), Day / Night / Auto, Mods…, Voice settings…, Settings… ⌘, and who is connected (kernel-owned chrome is never
   a row) ── */
let appPanesOpen = false;
let link: { state: LinkState; who: { principal: string; connId: string } | null } = { state: 'connecting', who: null };
/** The quiet kernel link (core/header.ts linkView): a dot, with its word shown only when not connected. */
function setLink(state: LinkState, who: { principal: string; connId: string } | null = null): void {
  link = { state, who: state === 'connected' ? who : null };
  const lv = linkView(state, link.who);
  const el = $('conn');
  el.classList.toggle('ok', lv.ok);
  el.title = lv.title;
  const w = $('conn-word');
  put(w, lv.word);
  w.className = lv.wordShown ? 'link-word' : 'link-word sr-only';
  if (!$('wordmark-menu').hidden) paintAppMenu();
  paintLoopsWord();
}
/** The Gnomon menu's focusable rows, in order (arrow keys move among them). */
const appMenuItems = (): HTMLElement[] => [...$('wordmark-menu').querySelectorAll<HTMLElement>('[data-run]')];
function appMenuRowEl(r: AppMenuRow): Node {
  if (r.kind === 'head') return h(doc, 'div', { class: 'menu-h', role: 'presentation' }, r.label) as unknown as Node;
  if (r.kind === 'rule') return h(doc, 'div', { class: 'menu-rule', role: 'separator' }) as unknown as Node;
  if (r.kind === 'who') {
    const el = h(doc, 'div', { class: 'menu-who' }, r.text) as unknown as HTMLElement;
    el.id = 'wordmark-who'; // the menu's description (aria-describedby): who is connected
    return el;
  }
  if (r.kind === 'theme')
    return h(doc, 'div', { class: 'menu-theme', role: 'group', 'aria-label': 'Theme' }, ...r.options.map((o) => h(doc, 'button', { class: `key quiet seg-key${o.checked ? ' current' : ''}`, type: 'button', role: 'menuitemradio', 'aria-checked': String(o.checked), 'data-run': o.run, title: o.title }, o.label))) as unknown as Node;
  const attrs: Record<string, string> = { class: `mode-item app-item${r.checked ? ' current' : ''}`, type: 'button', role: r.radio ? 'menuitemradio' : 'menuitem', 'data-run': r.run };
  if (r.radio) attrs['aria-checked'] = String(!!r.checked);
  if (r.expands) attrs['aria-expanded'] = String(!!r.expanded);
  return h(doc, 'button', attrs, h(doc, 'span', { class: 'mode-name' }, r.name), r.note ? h(doc, 'span', { class: 'mode-note' }, r.note) : null, r.kbd ? h(doc, 'kbd', { class: 'mode-kbd' }, r.kbd) : null) as unknown as Node;
}
function paintAppMenu(): void {
  const m = $('wordmark-menu');
  const had = (document.activeElement as HTMLElement | null)?.closest?.('#wordmark-menu [data-run]') as HTMLElement | null;
  const fk = had?.dataset.run ?? null;
  clear(m);
  for (const r of appMenuModel({ layout, panesOpen: appPanesOpen, theme: themeSwitchEntries(theme, darkQ.matches), who: whoLine(link.state, link.who, store.head), loops: loopsMenu() })) m.appendChild(appMenuRowEl(r));
  m.setAttribute('aria-describedby', 'wordmark-who');
  if (fk) (m.querySelector(`[data-run="${fk}"]`) as HTMLElement | null)?.focus();
}
function loopsMenu(): { note: string; paused: boolean; off?: boolean } | null {
  const m = loopsOf(status);
  if (loopsOff(m)) return { note: 'off in this build', paused: false, off: true };
  return m ? { note: leafMeta(m), paused: m.pausedAll } : null;
}
function openAppMenu(focusAt: 'first' | 'last' | null): void {
  closeVoiceMenu(false);
  appPanesOpen = false;
  $('wordmark-menu').hidden = false;
  $('wordmark-btn').setAttribute('aria-expanded', 'true');
  paintAppMenu();
  const items = appMenuItems();
  if (focusAt) items[focusAt === 'first' ? 0 : items.length - 1]?.focus();
}
function closeAppMenu(focusTrigger = false): void {
  if ($('wordmark-menu').hidden) return;
  $('wordmark-menu').hidden = true;
  $('wordmark-btn').setAttribute('aria-expanded', 'false');
  if (focusTrigger) $('wordmark-btn').focus();
}

let palSel = 0;
let palItems: Command[] = [];
/** what had focus before ⌘K: Esc and a press on the scrim hand focus back to it (design-system sheet: Esc returns focus to whatever opened it) */
let palOpener: HTMLElement | null = null;
function openPalette(prefix = ''): void {
  closeAppMenu();
  if ($('palette').hidden) palOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  $('palette').hidden = false;
  const i = $<HTMLInputElement>('palette-input');
  i.value = prefix;
  paintPalette();
  i.focus();
}
/** founder 2026-10-23: Esc (wherever focus is inside it) and a press on the scrim close the palette, like every other sheet */
function closePalette(): void {
  if ($('palette').hidden) return;
  $('palette').hidden = true;
  const back = palOpener;
  palOpener = null;
  if (back?.isConnected) back.focus();
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
  // focus goes back to the opener first, so a sheet the command opens records that (not the hidden palette field) as its own opener
  closePalette();
  if (id.startsWith('theme.')) keep(THEME_KEY, (theme = parseTheme(id.slice(6))));
  else if (id === 'motion.reduce' || id === 'motion.system') keep(MOTION_KEY, (motion = parseMotion(id.slice(7))));
  else if (id.startsWith('voice.preset.')) void chooseRungUi(rungOfPresetCommand(id) ?? RUNG_OF_PRESET[parsePreset(id.slice('voice.preset.'.length))], trusted);
  else if (id === 'voice.sendword.teach') {
    openVoiceSettings('sendword');
    startTeachFlow();
    voiceSheet.repaint(true);
  } else if (id === 'voice.settings.open') openVoiceSettings();
  else if (id === 'voice.mic.toggle') void micToggle(trusted);
  else if (id === 'settings.open') settings.open();
  else if (id === 'rules.open') settings.open('rules'); // #gui-rules-view: Settings › Permissions › Rules
  else if (id === 'local.setup') settings.open(LOCAL_SECTION); // #gui-local-model: section-focused
  else if (id === 'mcp.open') settings.open(MCP_SECTION); // #gui-mcp-servers: section-focused
  else if (id === 'tools.open') openTools(trusted); // #gui-capability-browser: the focused local session's drawer
  else if (id === 'slash.open') openSlash(trusted); // #gui-slash-menu: the focused session's "/" menu
  else if (id === 'mods.open') modsPanel.open();
  else if (id === 'loops.open') loopsView.open();
  else if (id === 'loops.pause-all') void pauseAllLoops(trusted);
  else if (id === 'menu.gnomon') openAppMenu('first');
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
    openNewSessionSheet();
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
  else if (id === 'voice.enrol') openEnrol(trusted); // the Voice settings sheet, at "your voice" (it closes Settings first)
  else if (id.startsWith('voice.delay.')) setDictationDelay(parseDelay(id.slice(12)));
  else if (id === 'voice.dictation.hold') {
    // Hold belongs beside a countdown only: an ambient draft (or auto-send off) has nothing to hold
    if (hasDraft(dict) && draftControls(dict).hold === null) notice('nothing to hold: this draft never sends itself (Enter sends it)');
    else dispatchDictation({ type: 'hold', hold: !dict.hold, now: Date.now() });
  }
  else if (id === 'gui.reconnect' && trusted) void attach({ reconnect: true }, null);
  else if (id === 'diag.send' && trusted && session) void gnomonPost(fetch, '/diag', session.guiToken, `diag from palette at ${new Date().toISOString()}`);
  else if (id === 'verb.status' && client) void client.call('status').then((s) => (status = s as Record<string, unknown>));
  applyLook();
  applyLayout();
  settings.repaint();
}

/**
 * Mika 2026-10-23: a card's scoped always choices fold under "Always ▾" (per card and zone: the same card pinned and in
 * the pile folds on its own). Opening moves focus to the first choice; Esc folds and returns to the key. The fold
 * decides nothing: each choice is the decision key (data-decision="always" + its scope), pressed as before.
 */
const alwaysOpen = new Set<string>();
const zoneOf = (el: Element): 'pile' | 'pinned' => (el.closest('#pinned') ? 'pinned' : 'pile');
function setAlwaysFold(fold: HTMLElement, open: boolean): void {
  const cardId = fold.dataset.alwaysFold!;
  const card = fold.closest('.card');
  const list = card?.querySelector<HTMLElement>('.always-choices');
  if (!card || !list) return;
  const k = `${zoneOf(card)}|${cardId}`;
  if (open) alwaysOpen.add(k);
  else alwaysOpen.delete(k);
  list.classList.toggle('open', open);
  fold.setAttribute('aria-expanded', String(open));
  fold.textContent = `Always ${open ? '▴' : '▾'}`;
  (open ? list.querySelector<HTMLElement>('[data-decision]') ?? fold : fold).focus();
  if (open) list.scrollIntoView({ block: 'nearest' }); // pinned scrolls past 30vh: show every choice, not just the first
}
/** Before a stack repaint: a function that puts focus back on the same Always fold or choice, or null. */
function alwaysFocusOf(): (() => void) | null {
  const a = document.activeElement as HTMLElement | null;
  const card = a?.closest?.('.card') as HTMLElement | null;
  if (!a || !card || !(a.dataset.alwaysFold || a.closest('.always-choices'))) return null;
  const zone = zoneOf(card);
  const sel = a.dataset.alwaysFold
    ? `[data-always-fold="${CSS.escape(a.dataset.alwaysFold)}"]`
    : `.always-choices [data-card-id="${CSS.escape(a.dataset.cardId ?? '')}"][data-scope="${CSS.escape(a.dataset.scope ?? '')}"]${a.dataset.prefix !== undefined ? `[data-prefix="${CSS.escape(a.dataset.prefix)}"]` : ''}`;
  return () => document.querySelector<HTMLElement>(`#${zone === 'pinned' ? 'pinned' : 'stack'} ${sel}`)?.focus();
}
function onAlwaysKey(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  const list = (e.target as HTMLElement).closest('.always-choices.open');
  const fold = list?.closest('.card')?.querySelector<HTMLElement>('[data-always-fold]');
  if (!fold) return;
  e.preventDefault();
  e.stopPropagation();
  setAlwaysFold(fold, false);
}

/* ── events (every write verb hangs off a user gesture, G-GUI-04) ── */
function onCardPress(e: Event): void {
  const t = e.target as HTMLElement;
  const fold = t.closest('[data-always-fold]') as HTMLElement | null;
  if (fold) return setAlwaysFold(fold, fold.getAttribute('aria-expanded') !== 'true');
  const askOpt = t.closest('.ask-picker [data-ask-opt], .ask-picker [data-ask-other]') as HTMLElement | null;
  if (askOpt) return onAskPress(e, askOpt); // #gui-ask-card
  const b = t.closest('[data-decision]') as HTMLElement | null;
  if (b && e.isTrusted) void decide(b.dataset.cardId!, b.dataset.decision!, b.closest('[data-card-id].card') as HTMLElement | null, b);
  const k = t.closest('[data-command]') as HTMLElement | null;
  if (k && e.isTrusted && BLOCK_SAFE_COMMANDS.has(k.dataset.command!)) run(k.dataset.command!, e.isTrusted);
  // #gui-loops: Read unfolds a loop-trust card; an alert opens its loop run or is dismissed; the slip raises a card
  const read = t.closest('[data-loop-read]') as HTMLElement | null;
  if (read) loopsView.unfoldTrust(read.dataset.loopRead!);
  const openRun = t.closest('[data-loop-open]') as HTMLElement | null;
  if (openRun) loopsView.open({ key: openRun.dataset.loopOpen!, ...(openRun.dataset.runId ? { runId: openRun.dataset.runId } : {}) });
  // #gui-local-model: a refused-start alert's key opens Settings at the Local model section
  if (t.closest('[data-local-open]')) settings.open(LOCAL_SECTION);
  const dismiss = t.closest('[data-loop-dismiss]') as HTMLElement | null;
  if (dismiss) {
    loopDismissed.add(dismiss.dataset.loopDismiss!);
    void paintStack();
  }
  if (t.closest('[data-loop-review-all]')) loopsView.open({ waiting: true });
  const review = t.closest('[data-loop-review]') as HTMLElement | null;
  const x = review ? loopsOf(status)?.loops.find((y) => y.key === review.dataset.loopReview) : undefined;
  if (x) void loopRequest({ kind: 'request.loop.trust', payload: { loopId: x.loopId, scope: x.scope, repoKey: x.repoKey, contentHash: x.contentHash } }, e.isTrusted, `a loop-trust card for ${x.loopId} is in the stack: Read, then Trust`);
}
/** keys that scroll the transcript when it (or a row in it) has the focus */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
function wire(): void {
  $('viewport').addEventListener(
    'scroll',
    () => {
      const vp = $('viewport');
      const top = vp.scrollTop;
      // founder report 2026-10-23: the page's own write, or a scroll the layout made (WebKit clamps it when the composer
      // re-measures, before the ResizeObserver repaint), leaves stickiness alone; only the user's own scroll changes it
      scrollEvent(follow, { top, selfTop, lastTop, clientHeight: vp.clientHeight, scrollHeight: vp.scrollHeight, byUser: intent.active(performance.now()) });
      lastTop = top;
      paintTranscript();
    },
    { passive: true },
  );
  // intent to read back unsticks BEFORE the next streamed paint can snap the view down
  // Mika 2026-10-23: only when there is something above to read: a wheel tick up on a chat that does not overflow yet (or
  // is already at its top) unstuck it with nothing moved, so it stopped following once the rows outgrew the pane
  const releaseUp = (): void => {
    if (!follow.shouldStick || $('viewport').scrollTop < 1) return;
    follow.release();
    paintTranscript();
  };
  $('viewport').addEventListener('wheel', (e) => {
    if ((e as WheelEvent).deltaY !== 0) intent.mark(performance.now(), INTENT_MS.wheel);
    if ((e as WheelEvent).deltaY < 0) releaseUp();
  }, { passive: true });
  // the user's hand on the transcript (its scrollbar, a drag, a touch) is scroll intent until let go
  $('viewport').addEventListener('pointerdown', () => intent.hold(), { passive: true });
  for (const t of ['pointerup', 'pointercancel']) window.addEventListener(t, () => intent.letGo(performance.now()), { passive: true });
  $('viewport').addEventListener('focusin', () => intent.mark(performance.now(), INTENT_MS.focus));
  let touchY = 0;
  $('viewport').addEventListener('touchstart', (e) => {
    touchY = (e as TouchEvent).touches[0]?.clientY ?? 0;
    intent.hold();
  }, { passive: true });
  for (const t of ['touchend', 'touchcancel']) $('viewport').addEventListener(t, () => intent.letGo(performance.now(), INTENT_MS.touch), { passive: true });
  $('viewport').addEventListener('touchmove', (e) => {
    const y = (e as TouchEvent).touches[0]?.clientY ?? touchY;
    if (y > touchY + 2) releaseUp(); // finger moves down ⇒ content scrolls up
    touchY = y;
  }, { passive: true });
  $('viewport').addEventListener('keydown', (e) => {
    const k = (e as KeyboardEvent).key;
    if (SCROLL_KEYS.has(k)) intent.mark(performance.now(), INTENT_MS.key);
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
    // the line keeps its key and text: remount it so its ▸ / ▾ and aria-expanded follow, and keep the focus on it
    const had = document.activeElement === a;
    remountItem(a.dataset.item ?? (k.startsWith('raw:') ? k.slice(4) : k));
    paintTranscript();
    // founder report 2026-10-23: unfolding never moves the page (the focus stays on the line without scrolling to it)
    if (had) ($('viewport').querySelector(`[data-act="${CSS.escape(k)}"]`) as HTMLElement | null)?.focus({ preventScroll: true });
  };
  wireOfferSlips($('viewport'), onOfferAct); // #gui-offer-slip: trusted Open (two-step) / not now
  // #gui-host-hints: Copy (the shown command to the clipboard) and open (a Gnomon screen), trusted presses only
  wireHostSlips($('viewport'), { copy: onHostCopy, open: (id, e) => run(id, e.isTrusted) });
  $('viewport').addEventListener('click', (e) => {
    const c = (e.target as HTMLElement).closest('.choices.live [data-choice]') as HTMLElement | null;
    if (c) return onChoice(e, c);
    const send = (e.target as HTMLElement).closest('.choices.live [data-choice-send]') as HTMLElement | null;
    if (send) return onChoiceSend(e, send); // #gui-ask-card multi-select
    const rk = (e.target as HTMLElement).closest('[data-run-act]') as HTMLElement | null;
    if (rk) return onRunKey(rk, e);
    toggleAct(e.target);
  });
  // #gui-table-talk: inside the live choices a letter / number picks (only with an empty composer); arrows move
  $('viewport').addEventListener('keydown', (e) => {
    const g = (e.target as HTMLElement).closest('.choices.live') as HTMLElement | null;
    if (!g || e.metaKey || e.ctrlKey || e.altKey) return;
    const bs = [...g.querySelectorAll<HTMLElement>('[data-choice]')];
    // multi-select: the Send key is one more arrow stop after the chips
    const stops = [...g.querySelectorAll<HTMLElement>('[data-choice], [data-choice-send]')];
    const at = stops.indexOf(e.target as HTMLElement);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      return stops[(at + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : stops.length - 1)) % stops.length]?.focus();
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
  // #gui-wordmark-menu: Enter / Space are the button's own click (the first row takes focus from a key press, which
  // has no pointer: detail 0); ↓ / ↑ open on the first / last row; inside, ↑/↓/Home/End move, Esc closes back to it
  $('wordmark-btn').addEventListener('click', (e) => ($('wordmark-menu').hidden ? openAppMenu(e.detail === 0 ? 'first' : null) : closeAppMenu(true)));
  $('wordmark-btn').addEventListener('keydown', (e) => {
    const at = $('wordmark-menu').hidden ? triggerKey(e.key) : null;
    if (!at) return;
    e.preventDefault();
    openAppMenu(at);
  });
  $('wordmark-menu').addEventListener('keydown', (e) => {
    const items = appMenuItems();
    const step = menuKey(e.key, items.indexOf(document.activeElement as HTMLElement), items.length);
    if (!step) return;
    if (step.kind === 'move') {
      e.preventDefault();
      items[step.to]?.focus();
    } else {
      if (step.focusTrigger) e.preventDefault();
      e.stopPropagation(); // Esc closes this menu only (not a sheet or the speech under it)
      closeAppMenu(step.focusTrigger);
    }
  });
  $('wordmark-menu').addEventListener('click', (e) => {
    if (!e.isTrusted) return; // Aegis L2: the human's own press (a key press on a row is a trusted click too)
    const b = (e.target as HTMLElement).closest('[data-run]') as HTMLElement | null;
    const id = b?.dataset.run;
    if (!id || !APP_MENU_RUNS.has(id)) return;
    if (id === PANES_RUN) {
      appPanesOpen = !appPanesOpen; // the panes and Workshop rows open in place; focus stays on the row
      return paintAppMenu();
    }
    if (id.startsWith('theme.') || id.startsWith('layout.') || id.startsWith('pane.') || id.startsWith('workshop.')) {
      run(id, e.isTrusted); // presentation only: the menu stays open on its choice (applyLook / applyLayout repaint it)
      return paintAppMenu();
    }
    closeAppMenu(true); // a sheet returns focus to the wordmark when it closes
    run(id, e.isTrusted);
  });
  document.addEventListener('click', (e) => {
    if (!$('wordmark-menu').hidden && !(e.target as HTMLElement).closest('.wm-wrap')) closeAppMenu();
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
  const onCard = onCardPress;
  $('stack').addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('[data-pile-more]')) {
      pileOpen = true;
      return void paintStack();
    }
    onCard(e);
  });
  $('pinned').addEventListener('click', onCard);
  $('stack').addEventListener('keydown', onAlwaysKey);
  $('pinned').addEventListener('keydown', onAlwaysKey);
  // #gui-ask-card: the question card's keys, typed Other answers and the focused option's preview, in both zones
  for (const z of ['stack', 'pinned']) {
    $(z).addEventListener('keydown', onAskKey);
    $(z).addEventListener('input', onAskInput);
    $(z).addEventListener('focusin', onAskFocus);
  }
  $('stack-scope').addEventListener('click', (e) => run('stack.scope.toggle', e.isTrusted));
  $('loops-word').addEventListener('click', () => loopsView.open());
  $('composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const t = $<HTMLTextAreaElement>('composer-text');
    // Aegis M3: a dictated draft stays shown until the kernel took it (the reducer then sets what remains)
    const viaDictation = dictationOn() && dict.focusedHere && dict.parts.length > 0 && hasDraft(dict);
    // L2: a chip pick is marked picked only once the kernel took it; the composer clears only when the message went out
    const pp = pendingPick;
    pendingPick = null;
    const pm = pendingMulti;
    pendingMulti = null;
    void send(t.value, () => {
      if (!viaDictation) t.value = '';
      fitComposer();
    }).then((ok) => {
      if (pm && ok) {
        // #gui-ask-card multi-select: the sent options are marked once the kernel took the message
        pickedMulti.set(pm.item, pm.keys);
        toggledChoices.delete(pm.item);
        remountItem(pm.item);
        paintTranscript();
        // Mika Delta 11: the Send key was rebuilt inert under the focus; the conversation goes on in the composer
        if (!document.activeElement || document.activeElement === document.body) t.focus();
      }
      if (!pp || !ok) return;
      pickedChoices.set(pp.item, pp.key);
      remountItem(pp.item);
      paintTranscript();
    });
  });
  // dictation: typing in the composer, or clicking into a draft, holds it (never auto-send mid-edit)
  $('composer-tall').addEventListener('click', () => toggleComposerTall());
  window.addEventListener('resize', () => fitComposer());
  // #gui-slash-menu: "/" and one word opens the menu on the focused session (the human's own typing only)
  $('composer-text').addEventListener('input', (e) => slashMenu?.input($<HTMLTextAreaElement>('composer-text').value, focused, e.isTrusted));
  $('composer-text').addEventListener('input', () => {
    fitComposer();
    if (dictationOn() && dict.focusedHere) dispatchDictation({ type: 'userEdit', text: $<HTMLTextAreaElement>('composer-text').value, now: Date.now() });
  });
  $('composer-text').addEventListener('pointerdown', () => {
    if (dictationOn() && dict.focusedHere) dispatchDictation({ type: 'focusComposer', now: Date.now() });
  });
  $('composer-text').addEventListener('blur', () => dispatchDictation({ type: 'blurComposer', now: Date.now() }));
  // B1 at the caret: the ghost follows the caret and the composer's own scroll
  for (const t of ['select', 'keyup', 'pointerup', 'focus', 'input']) $('composer-text').addEventListener(t, () => paintGhost());
  $('composer-text').addEventListener('scroll', () => placeGhost(), { passive: true });
  // an IME composition shows in the textarea itself while it lasts (its underline and candidates sit on real text)
  $('composer-text').addEventListener('compositionstart', () => {
    composing = true;
    paintGhost();
  });
  $('composer-text').addEventListener('compositionend', () => {
    composing = false;
    paintGhost();
  });
  document.addEventListener('selectionchange', () => {
    if (ghostOn && document.activeElement === $('composer-text')) paintGhost();
  });
  $('dictation-hold').addEventListener('click', () => dispatchDictation({ type: 'hold', hold: !dict.hold, now: Date.now() }));
  $('composer-text').addEventListener('keydown', (e) => {
    if (slashMenu?.key(e)) return; // #gui-slash-menu: ↑/↓, Enter and Esc belong to the open "/" menu
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
    const b = (e.target as HTMLElement).closest('[data-mode], [data-mode-scope], [data-revoke-rule], [data-open-rules]') as HTMLButtonElement | null;
    if (!b || b.disabled) return;
    if (b.dataset.openRules !== undefined) {
      closeModeMenu();
      return settings.open('rules');
    }
    if (b.dataset.revokeRule) {
      closeModeMenu();
      $('mode-btn').focus(); // the entry is gone with the menu: focus returns to the run mode key (Mika 2026-10-23)
      const ruleId = b.dataset.revokeRule;
      if (!client) return;
      void client.call('log.append', { kind: 'request.rules.revoke', payload: { ruleId } }).then(
        () => notice('Edits by rule stopped: edits ask again in this repo', 'info'),
        (err: unknown) => notice(`Could not revoke the rule: ${err instanceof Error ? err.message : String(err)}`, 'fail'),
      );
      return;
    }
    if (b.dataset.modeScope) {
      // the secondary scope (F2): the same three choices in the palette — mode.* for this session only, mode.repo.* for the folder
      closeModeMenu();
      $('mode-btn').focus(); // the menu row is hidden now: the palette's opener (Esc returns there) is the mode key
      return openPalette(b.dataset.modeScope === 'repo' ? 'mode.repo.' : 'mode.');
    }
    void setMode(b.dataset.mode as RunMode, defaultScope(currentMode()), e.isTrusted);
  });
  // board header-5b: while the voice app can't run the pill IS its action (data-action); otherwise it opens the ladder
  $('voice-pill').addEventListener('click', (e) => {
    const a = $('voice-pill').dataset.action;
    if (a) return voiceAct(a, e.isTrusted);
    if ($('voice-menu').hidden) openVoiceMenu();
    else closeVoiceMenu(true);
  });
  // #gui-voice-ladder: ↓ on the pill opens the ladder; inside it ↑/↓/Home/End move, Esc closes back to the pill
  $('voice-pill').addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && $('voice-menu').hidden && !$('voice-pill').dataset.action) {
      e.preventDefault();
      openVoiceMenu();
    }
  });
  $('voice-menu').addEventListener('keydown', (e) => {
    const items = ladderItems();
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (n: number): void => {
      e.preventDefault();
      items[(n + items.length) % items.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Tab') closeVoiceMenu(false);
  });
  $('voice-stop').addEventListener('click', (e) => void stopSpeaking(e.isTrusted));
  $('voice-menu').addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const act = t.closest('[data-voice-act]') as HTMLElement | null;
    if (act) {
      closeVoiceMenu(true);
      return voiceAct(act.dataset.voiceAct!, e.isTrusted);
    }
    if (t.closest('[data-vs-open]')) {
      closeVoiceMenu(false);
      return openVoiceSettings();
    }
    const rm = t.closest('[data-reply-mode]') as HTMLElement | null;
    if (rm) return void setReplyMode(rm.dataset.replyMode === 'show' ? 'show' : 'speak', e.isTrusted);
    const b = t.closest('[data-rung]') as HTMLButtonElement | null;
    if (!b || b.disabled) return;
    void chooseRungUi(b.dataset.rung as Rung, e.isTrusted);
  });
  document.addEventListener('click', (e) => {
    if (!$('voice-menu').hidden && !(e.target as HTMLElement).closest('.voice-wrap')) closeVoiceMenu();
  });
  // fidelity 2: the ⋯ menu holds the item counts and the raw toggle (the comp's header has neither)
  $('more-btn').addEventListener('click', () => ($('more-menu').hidden ? openMoreMenu() : closeMoreMenu()));
  $('tools-open').addEventListener('click', (e) => {
    closeMoreMenu();
    openTools(e.isTrusted, $('more-btn'));
  });
  document.addEventListener('click', (e) => {
    if (!$('more-menu').hidden && !(e.target as HTMLElement).closest('.more-wrap')) closeMoreMenu();
  });
  document.addEventListener('click', (e) => {
    if ($('mode-menu').hidden) return;
    if (!(e.target as HTMLElement).closest('.mode-wrap')) closeModeMenu();
  });
  // #gui-folder-field: the New session sheet is aria-modal, so Tab stays inside it (the voice drawer's trapNext)
  document.addEventListener('keydown', (e) => {
    const dlg = $('new-session-dialog');
    if (e.key !== 'Tab' || dlg.hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    const form = dlg.querySelector('form') as HTMLElement;
    const items = [...form.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null && x.tabIndex >= 0);
    const a = document.activeElement as HTMLElement | null;
    // the recents are one tab stop: only the row that holds tabindex 0 counts
    const to = trapNext(items, a && form.contains(a) ? a : null, e.shiftKey);
    if (to) {
      e.preventDefault();
      to.focus();
    }
  });
  $('ns-cancel').addEventListener('click', () => {
    closeNewSessionSheet();
    clearCwdHint(hintTarget());
  });
  $('new-session-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!e.isTrusted) return; // Aegis L2: a session opens on the human's own submit only, like the card handlers
    void submitNewSession(true);
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
    else if (e.key === 'Enter' && palItems[palSel]) return run(palItems[palSel]!.id, e.isTrusted);
    else if (e.key === 'Escape') {
      if (dict.grace) return; // "Sending… Esc keeps it" wins: the document handler keeps the draft, the palette stays
      e.stopPropagation(); // the document handler would close it a second time
      return closePalette();
    }
    else return;
    e.preventDefault();
    paintPalette();
  });
  $('palette-list').addEventListener('click', (e) => {
    const r = (e.target as HTMLElement).closest('[data-id]') as HTMLElement | null;
    if (r) run(r.dataset.id!, e.isTrusted);
  });
  $('palette').addEventListener('click', (e) => {
    if (e.target === $('palette')) closePalette(); // a press on the scrim closes it
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
      closePalette();
      settings.open();
    } else if (e.key === 'Escape' && !$('palette').hidden && dict.grace) {
      // TD-2026-10-21-514 over the palette (Mika 2026-10-23): the countdown is about to send, a promise on screen; a
      // missed close costs one more Esc, a missed keep sends the draft. The first Esc keeps it, the next closes the palette
      e.preventDefault();
      dispatchDictation({ type: 'graceCancel', now: Date.now() });
    } else if (e.key === 'Escape' && !$('palette').hidden) {
      e.preventDefault(); // focus left the field (a row, the scrim): Esc still closes the palette
      closePalette();
    } else if (e.key === 'Escape' && !$('new-session-dialog').hidden) {
      e.preventDefault(); // #gui-folder-field: Esc closes the New session sheet (and the macOS chooser, if it is open)
      closeNewSessionSheet();
      clearCwdHint(hintTarget());
    } else if (e.key === 'Escape' && !$('wordmark-menu').hidden) {
      closeAppMenu(true); // #gui-wordmark-menu: back to the wordmark (a pointer opened it, so focus was not inside)
    } else if (e.key === 'Escape' && !$('voice-menu').hidden) {
      closeVoiceMenu(true); // #gui-voice-ladder: back to the pill
    } else if (e.key === 'Escape' && voiceSheet.isOpen()) {
      voiceSheet.close(); // #gui-voice-settings: an inline step ends with the sheet (a trial never outlives it)
    } else if (e.key === 'Escape' && toolsDrawer?.isOpen()) {
      e.preventDefault();
      toolsDrawer.close(); // #gui-capability-browser: focus returns to the opener
    } else if (e.key === 'Escape' && dict.grace) {
      e.preventDefault(); // TD-2026-10-21-514: "Sending… Esc keeps it"
      dispatchDictation({ type: 'graceCancel', now: Date.now() });
    } else if (e.key === 'Escape' && settings.isOpen()) {
      settings.escape(); // #gui-local-model: an open form (or the turn-off confirm) closes first, then the sheet
    } else if (e.key === 'Escape' && modsPanel.isOpen()) {
      modsPanel.close();
    } else if (e.key === 'Escape' && !editableFocus() && $('palette').hidden && loopsView.escape()) {
      e.preventDefault(); // #gui-loops: an unfolded trust card folds first, then the Loops leaf folds to its edge tab
    } else if (e.key === 'Escape' && !$('mode-menu').hidden) {
      closeModeMenu();
    } else if (e.key === 'Escape' && escStopsSpeaking({ shown: stopSpeakingShown(status), menuOpen: !$('mode-menu').hidden || !$('voice-menu').hidden, dialogOpen: !$('palette').hidden || !!document.querySelector('.overlay:not([hidden])') || !!(document.activeElement as HTMLElement | null)?.closest?.('[role="dialog"]'), inComposer: !!(document.activeElement as HTMLElement | null)?.closest?.('#composer') || document.activeElement === $('composer-text') })) {
      e.preventDefault();
      void stopSpeaking(e.isTrusted);
    } else if (e.key === 'Escape' && !editableFocus() && toasts().dismissNewestFail()) {
      e.preventDefault(); // #gui-toast: a fail stays until closed (its close key, or Esc)
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

/** DEV ONLY (#gui-preview rules-*): open Settings › Rules in a staged state for the reference shots (presses need trust). */
export function devRulesState(kind: string): void {
  if (!__GNOMON_PREVIEW__) return; // false in scripts/build.mjs: the served bundle drops it
  const rs = rulesStatusOf(status);
  const ids = rs.rules.map((r) => r.ruleId);
  let ui = emptyRulesUi();
  if (kind === 'off-open' && ids[0]) ui = toggleOffMenu(ui, ids[0]);
  else if (kind !== 'none' && ids.length > 1) {
    ui = stageRemove(stageOff(ui, ids[0]!, 'hour', rs), ids[1]!);
    const off = rs.rules.find((r) => r.state === 'off');
    if (off && kind !== 'tighten') ui = stageOn(ui, off.ruleId);
  }
  if (kind === 'close') ui = rulesBeforeClose(ui).ui;
  if (kind === 'refused') ui = { ...ui, result: refusedResult({ code: 'NOT_FOUND', reason: 'not-found', message: '#approval-broker: no standing always rule card:01JPREVIEWRULE000000000002 (unknown, or removed meanwhile)', next: [], data: { hint: 'the list has changed: look again, then save' } }) };
  if (kind === 'waiting') ui = afterSave(ui, { cardId: 'card:01JPREVIEWRULESCARD00000001', decided: false });
  rulesUi = ui;
  settings.open('rules');
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
  fitComposer(); // #gui-composer: the saved tall view and the line count from the start
  paintChatHead(); // S2.3: the quiet empty centre until a session is focused
  paintSessions(); // the ACTIVE / PAST heads show before the first row arrives
  // #bare-entry: the folder hint is decoded here but applied by attach only after the token verified (Aegis M1)
  // TD-2026-10-19-063: the page that accepted an upgrade reloads once and reattaches with the single-use resume form
  const resumed = frag ? (clearRestarting(sessionStorage), null) : takeRestart(sessionStorage);
  if (frag) void attach({ launchToken: frag.launchToken }, frag.kernelPublicKey, frag.cwd !== undefined ? cwdHintOf(frag.cwd) : null);
  else if (resumed) void attach({ resumeToken: resumed.resumeToken }, resumed.kernelPublicKey);
  else showReconnect('This page has no GUI session (a reload, a restart or a token-less launch). Reconnect asks for your presence.');
}
