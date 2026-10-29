/**
 * event:v1 — the kernel log envelope (spec §4.1) and the kind registry with
 * per-kind default labels (§9.1, §3.2 L6, S32 §6).
 *
 * Labels: `audience` ∈ private|team|org (default private), `sensitivity` ∈
 * normal|sensitive|secret (default = the §9.1 column for the kind). Both are
 * set by the APPENDING COMPONENT at append, never by the payload's author, and
 * never relaxed in place (L6). `defaultLabelsFor(kind)` is the one lookup.
 *
 * The registry is closed per namespace; new kinds are additive (§4.9). A
 * client renders an unknown kind opaquely as `{kind, principal, at}`
 * (`opaqueEventView`), never drops it.
 */

import { Checker, ISO_DATE_TIME, SHA256_TAGGED, type ValidateOptions } from './internal.js';
import { ID_PATTERNS, HSID_PATTERN, KEY_ID_PATTERN, REPO_SCOPE_PATTERN, CONTRACT_ID_PATTERN, TURN_ID_PATTERN } from './ids.js';
import { ANY_PRINCIPAL_PATTERN, DEVICE_ID_PATTERN } from './principal.js';
import { validateRefV1 } from './ref.js';
import { isClaudeModel } from './claude-model.js';
import { GIT_COMMIT_PATTERN, isModId } from './mod-id.js';
import { OFFER_DECISIONS, OFFER_MOD_PATTERN, OFFER_SUPPRESS_REASONS, OFFER_SUPPRESS_UNNAMED, OFFER_PHASES, OFFER_QUESTION_MAX, OFFER_TOKEN_PATTERN, OFFER_TOOL_PATTERN, OFFER_LIMITS, contextInProblems, isOfferQuestion, isOfferTitle } from './offer.js';

export const EVENT_V1 = 'event:v1' as const;

export const AUDIENCES = ['private', 'team', 'org'] as const;
export type Audience = (typeof AUDIENCES)[number];
export const SENSITIVITIES = ['normal', 'sensitive', 'secret'] as const;
export type Sensitivity = (typeof SENSITIVITIES)[number];
export const DEFAULT_AUDIENCE: Audience = 'private';

/** session.inject origins (§3.2 L2, §9.1); `peer` reserved M1.1 (P8-R9). Additive. */
export const INJECT_ORIGINS = ['kernel', 'client', 'peer'] as const;

/** Session `taint` (§3.3 session record, §3.9, `session.tainted{taint}`); sticky once set. Reserved M1.1 (P8-R9). */
export const SESSION_TAINTS = ['none', 'peer', 'peer-teammate'] as const;

/**
 * `approval.suspect{reason}` values the spec names literally (§3.4): the voice
 * reasons (P8-D58) and `strictness-class` (P8-D86–D88). The TTY/ancestry/
 * cached-beyond-class/connId reasons are described in prose without literal
 * names and are not invented here. Additive.
 */
export const APPROVAL_SUSPECT_REASONS = [
  'voice-unarmed',
  'voice-unenrolled',
  'voice-no-readback',
  'voice-echo-overlap',
  'voice-custody-client',
  'strictness-class',
] as const;

/** Release tags for values reserved one release ahead (§4.9, A26-11). */
export const RESERVATION_TAGS = ['M1.1:P8-D58', 'M1.1:P8-R9', 'M1.1:P8-D86-D88', 'M1.4:P8-D89', '8.0:P8-D98', '8.0:TD-2026-10-20-294', '8.0:TD-2026-10-20-086', '8.0:model-switch', '8.0:TD-2026-10-20-812', '8.0:T-2026-10-21-006', '8.0:T-2026-10-21-008', '8.0:session-rename', '8.0:loops', '8.0:TD-2026-10-23-939', '8.0:rules-view', '8.0:git-verbs', '8.0:local-lane'] as const;
export type ReservationTag = (typeof RESERVATION_TAGS)[number];

export type KindOwner = 'kernel' | 'userland';

export interface EventKindSpec {
  kind: string;
  owner: KindOwner;
  sensitivity: Sensitivity;
  /** payload fields carrying a stricter label than the event (§9.1 / §9.3). */
  fieldLabels?: Readonly<Record<string, Sensitivity>>;
  /** release the value was reserved for (one release ahead, §4.9 / A26-11). */
  reserved?: ReservationTag;
}

const D58 = 'M1.1:P8-D58' as const;
const R9 = 'M1.1:P8-R9' as const;
const D86 = 'M1.1:P8-D86-D88' as const;
const D89 = 'M1.4:P8-D89' as const;
/** P8-D98 (T-2026-10-19-001, the batched clientApiId move of TD-2026-10-19-528/-648/-908): reserved for 8.0, built by later slices. */
const D98 = '8.0:P8-D98' as const;
/** TD-2026-10-20-294 part 3 (prefix-scoped always rules, a deliberate clientApiId move). */
const PREFIX_RULES = '8.0:TD-2026-10-20-294' as const;
/** TD-2026-10-23-939 follow-up (Aegis 2026-10-23): scoped edit always rules (file / repo-edits), a deliberate clientApiId move. */
const EDIT_RULES = '8.0:TD-2026-10-23-939' as const;
/** The Rules view (session 2026-10-23-gnomon-rules-view; Aegis M2/L1/L2): turn an always rule off (for a time) and back on, one clientApiId move. */
const RULES_VIEW = '8.0:rules-view' as const;
/** TD-2026-10-20-086 F6 (the daily standing grant) + T-2026-10-20-007 (approval.auto.miss, anchoredInputHash): one clientApiId move. */
const STANDING = '8.0:TD-2026-10-20-086' as const;
/** The mid-session Claude model switch (founder ask 2026-10-20; probe p-set-model): one clientApiId move. */
const MODEL_SWITCH = '8.0:model-switch' as const;
/** The Desk (TD-2026-10-20-812: offers, the in-GUI mod install, mute) + the context meter: one clientApiId move. */
const DESK = '8.0:TD-2026-10-20-812' as const;
/** T-2026-10-21-006 (founder ruling: the Desk's suppressions go on the signed log, a deliberate clientApiId move). */
const OFFER_SUPPRESS = '8.0:T-2026-10-21-006' as const;
/** T-2026-10-21-008 (re-review M-1/M-2: offer.retired + session.anomaly, one deliberate clientApiId move). */
const REREVIEW = '8.0:T-2026-10-21-008' as const;
/** The session rename (founder ask 2026-10-20: rename a session from the GUI or the CLI): one clientApiId move. */
const SESSION_RENAME = '8.0:session-rename' as const;
/** Gnomon loops (docs/specs/gnomon-loops.md §3–§5; TD-2026-10-22-213/-129): every loop kind of steps 2–12, ONE clientApiId move. */
const LOOPS = '8.0:loops' as const;
/** Kernel-run git verbs (T-2026-10-23-002: git.init, git.push, repo.create outside the session sandbox): one clientApiId move. */
const GIT_VERB_TAG = '8.0:git-verbs' as const;
/** The local lane (TD-2026-10-27-833, T-2026-10-26-003): the kernel-brokered tools of a local session (slice C1): one clientApiId move. */
const LOCAL_LANE = '8.0:local-lane' as const;

type Row = [ns: string, owner: KindOwner, kinds: string, reserved?: ReservationTag];

/** §9.1, namespace by namespace. Kinds are the names before `{…}`. */
const TABLE: Row[] = [
  // daemon.anchor.lag{rows, which, bootPrev?, bootNow?}: research 33 S33-07 (P8-D82) — keystore anchor lag > 1023 on open
  // (which: 'keystore'); P8-D85 — file-anchor lag > 63 relaxed across a boot change (which: 'file', with the
  // keystore anchor's recorded boot as bootPrev and this boot as bootNow; additive).
  // daemon.log.gap{lostFrom, lostTo, lostHash, bootPrev, bootNow, fileLag}: research 33 S33-10 (P8-D83) — presence-gated
  // acknowledgement of rows lost to an unclean reboot (keystore anchor ahead of the db, boot session changed);
  // fileLag (S34-24, P8-D85, additive) = rows the file anchor lagged the db by at open (0 if ahead or exact).
  // daemon.anchor.failed{seq, kind}: research 33 S34-02 (P8-D83) — a critical row whose anchoring failed after COMMIT;
  // projections treat that seq as not having taken effect.
  ['daemon', 'kernel', 'start exit lock.refused segment reexec anchor.lag log.gap anchor.failed'],
  // daemon.log.quarantined{quarantinedLog, quarantinedHead{seq, hash, segment}, evidencePath, authorizedBy}: reserved for
  // T-2026-10-17-009(a) (P8-D89, kernel-signed; not built). evidencePath is a local path: a sensitive FIELD.
  ['daemon', 'kernel', 'log.quarantined', D89],
  // key.token.revoked{tokenId}: the kernel observed a root-signed read-token revocation (M1.4 slice 3, P8-D89 —
  // revocations stay sticky across restarts by being on the chain).
  ['key', 'kernel', 'token.revoked', D89],
  [
    'socket',
    'kernel',
    'connect disconnect hello auth.ok auth.fail auth.theft auth.replay auth.reconnect.requested web.listen web.bundle.mismatch web.linger web.stop web.transport.exited gui.token.issued gui.session.ended subscription.dropped frame.dropped frame.refused',
  ],
  ['key', 'kernel', 'mint rotate registry.malformed registry.unsigned device.added device.revoked keystore.unavailable'],
  ['config', 'kernel', 'loaded unsigned prefs ignored'],
  [
    'session',
    'kernel',
    'open alias alias.rejected refused spawned inject tainted idle respawn exited orphaned routed sandbox layers.changed',
  ],
  // session.compacted{hsid, turn, reason, summaryHash, tokensBefore, tokensAfter}: T-2026-10-18-016 (P8-D93) — a
  // backend finished compacting the session's context (the local runner's successful compaction_end, §13). Typed
  // so clients need not parse the raw turn.event line; validated at append (validateSessionCompactedPayload).
  ['session', 'kernel', 'compacted'],
  // P8-D98 (TD-2026-10-19-908, §2.4 rule 11): session.drained{uuid, reason} — the old kernel drained the session to a
  // turn boundary before an upgrade; the new kernel resumes it. permit.reattributed{permitId, hsid, drainedEventId} —
  // the kernel-signed row that hands a permit to the resumed session, citing the drained row (never a mint).
  ['session', 'kernel', 'drained', D98],
  ['permit', 'kernel', 'reattributed', D98],
  // P8-D98 (TD-2026-10-19-528 F1/F2): approval.rule.revoked{ruleId, repoKey, tool, connId} — a verified human device
  // revoked a standing `always` rule (rules.revoke). approval.effect.failed{cardId, decision, effect, reason} — a
  // decided card whose effect could not be applied (never a silent success).
  ['approval', 'kernel', 'rule.revoked effect.failed', D98],
  // 8.0:rules-view (Aegis M2/L2): approval.rule.disabled{ruleId, repoKey, tool, until, batch, connId} — the human turned a
  // standing always rule off (until an ISO time on the kernel clock, ≤ RULE_OFF_MAX_MS ahead, or null = until turned
  // back on); a narrowing, written at once. approval.rule.enabled{ruleId, repoKey, tool, cause, batch?, connId?, cardId?,
  // until?} — cause 'human': the batch's ONE strictness card (detail.op 'rules.apply') was allowed with fresh presence;
  // cause 'expired': the kernel's sweep saw the off time pass (the feed shows it). Enabled only clears a disabled flag
  // on a STANDING rule: it never creates a rule and never undoes a revoke.
  ['approval', 'kernel', 'rule.disabled rule.enabled', RULES_VIEW],
  // TD-2026-10-20-086 F6: grant.standing{grantId, cardId, tuples, repos, device, expiresAt, by} — minted by ONE root-class
  // `grant` card; grant.standing.used{grantId, cardId, tuple, decision, repo, hsid} — the notify row of each use
  // (beside approval.decide{presence:'standing:<grantId>'}); grant.standing.revoked{grantId, by, reason} — a tighten,
  // no presence. request.grant.standing{tuples, repos} / request.grant.standing.revoke{grantId}: the human's asks.
  ['grant', 'kernel', 'standing standing.used standing.revoked', STANDING],
  ['request', 'kernel', 'grant.standing grant.standing.revoke', STANDING],
  // T-2026-10-20-007: approval.auto.miss{hsid, tool, why, inputHash, modeRef} — the supervisor's read-only pass refused
  // under auto-edits/ask, written before the card (a sensitive kind: why and inputHash are sensitive fields).
  ['approval', 'kernel', 'auto.miss', STANDING],
  // Aegis M1 (TD-2026-10-20-086 F5): approval.unlock.joined{connId, scope:'device'} — a new connection of the same GUI
  // device first used the device's cached unlock (the GUI feed says "another Gnomon window joined your unlock").
  ['approval', 'kernel', 'unlock.joined', STANDING],
  // model switch (probe p-set-model): request.session.model{hsid, model} — the human's ask, written by the kernel on a
  // first-party human connection; session.model{hsid, from, to, permitId, outcome} — what the switch did (closed).
  ['request', 'kernel', 'session.model', MODEL_SWITCH],
  ['session', 'kernel', 'model', MODEL_SWITCH],
  // the Desk (TD-2026-10-20-812, O1 two-step accept): offer.shown{offerId, hsid, mod, kind, phase, title, contextIn,
  // question, replyTurnId} (title and contextIn copied by the kernel from the manifest offer spec) — the kernel parsed one ```offer block (offerBlockOf) naming an installed mod's declared offer;
  // offer.decided{offerId, hsid, decision} — the human's open | not-now | stop-here; offer.kept{offerId, hsid, mod, tool}
  // — the opened offer's handoff tool ran (kept/shown is the A6 metric). request.offer.decide{offerId, decision},
  // request.offer.mute{mod, scope:'repo', hsid, muted} (A3; S0b: the human names the session, the kernel derives the
  // repo), request.mod.install{source:'git'|'folder', url|path, commit?} (A8; commit = 40 hex, git only): the human's
  // asks, written by the kernel on a first-party human connection (like request.session.model). offer.muted{mod, repo,
  // muted, hsid} — the kernel-written result of a mute: the repo scope it derived from the live session (S0b).
  // `mod` is a mod id <publisher>.<name> (S0b) everywhere in the Desk kinds.
  ['offer', 'kernel', 'shown decided kept muted', DESK],
  // T-2026-10-21-006: offer.suppressed{hsid, turn, why, name?, offerKind?} — a completed main-chain reply the #offer-router
  // evaluated showed no offer, and why (OFFER_SUPPRESS_REASONS). Ids and names only, never message text; at most one per
  // completed turn (no-block only while the session has an offerable mod).
  ['offer', 'kernel', 'suppressed', OFFER_SUPPRESS],
  // T-2026-10-21-008 (re-review M-2): offer.retired{offerId, hsid, why} — a shown, undecided offer stopped standing (why
  // in OFFER_RETIRE_REASONS: 'continued' = the reply it answered continued, a Stop-hook continuation). Ids only.
  ['offer', 'kernel', 'retired', REREVIEW],
  // T-2026-10-21-008 (re-review M-1): session.anomaly{hsid, why} — the supervisor saw a stream shape it does not expect
  // (why in SESSION_ANOMALY_REASONS: 'result-without-turn' = a result with no outstanding turn). Names only, never text.
  ['session', 'kernel', 'anomaly', REREVIEW],
  // the session rename (8.0:session-rename): request.session.rename{hsid, name} — the human's ask, written by the kernel on
  // a first-party human connection (like request.session.model); session.renamed{hsid, name} — the display name the
  // kernel set ('' = back to the derived title). The name is DISPLAY TEXT (normalizeSessionName, the §4.5 sanitizer),
  // never a capability: nothing routes, grants or permits by it.
  ['request', 'kernel', 'session.rename', SESSION_RENAME],
  ['session', 'kernel', 'renamed', SESSION_RENAME],
  ['request', 'kernel', 'offer.decide offer.mute mod.install', DESK],
  // the context meter (TD-2026-10-20-812): session.context.threshold{hsid, usedTokens, windowTokens, ratio} — a Paradigm
  // session crossed the meter's threshold (Claude checkpoints, then the human is ASKED); request.session.restart{hsid,
  // checkpointRef?} — the human's yes: restart the session fresh and recover from the checkpoint (never auto-compact).
  ['session', 'kernel', 'context.threshold', DESK],
  ['request', 'kernel', 'session.restart', DESK],
  ['turn', 'kernel', 'sent event usage result partial steer ask-user plan'],
  // §9.1 lists permit/budget as one row; split by the names the spec uses
  // elsewhere (permit.grant §3.3 S1, budget.usage §3.3 S3).
  ['permit', 'kernel', 'reserve grant deny release'],
  ['budget', 'kernel', 'usage ladder pause resume breaker.open breaker.close compute window'],
  ['billing', 'kernel', 'api.card.requested api.active api.ended api.refused'],
  ['approval', 'kernel', 'request decide unlock unlock.dropped presence.denied expire rule.learned suspect'],
  [
    'approval',
    'kernel',
    'voice.arm voice.disarm voice.intent voice.held voice.withdrawn voice.refused voice.policy.narrowed voice.handle.rotated',
    D58,
  ],
  ['request', 'kernel', 'grant voice.arm voice.narrow', D58],
  ['request', 'kernel', 'brief.send cowork.allow link.revoke', R9],
  // §3.4 strictness and run modes (P8-D86–D88): broker-only, kernel-signed (B11).
  ['approval', 'kernel', 'strictness.raised strictness.proposed strictness.lowered strictness.held mode.set auto', D86],
  ['request', 'kernel', 'strictness.set mode.set incident', D86],
  [
    'link',
    'kernel',
    'pair.offered paired renewed revoked expired connect disconnect auth.fail frame.refused paused rate relay.unreachable msg.in msg.out brief.drafted brief.sent brief.received brief.accepted brief.declined brief.expired declassified scan.hit egress.refused',
    R9,
  ],
  ['manifest', 'kernel', 'load refuse widened generate staged installed uninstall'],
  ['schedule', 'kernel', 'due dropped tend.start tend.end automation.due'],
  ['model', 'kernel', 'capabilities probe repair fallback.requested fallback.decided'],
  [
    'mod',
    'kernel',
    'installed rolled-back health effect.refused view.rendered stopped sandbox linked snapshot.refused paused repinned dev.expired unlinked',
  ],
  [
    'voice',
    'userland',
    'session.start turn.user turn.agent deck focus tts.filtered bargein session.end share enrol forget',
  ],
  ['contract', 'kernel', 'registered claim claimed released built knot progress'],
  // §7.3 review convergence (P8-D86–D88).
  ['contract', 'kernel', 'review.returned review.capped review.extended review.restarted', D86],
  ['oracle', 'kernel', 'run result'],
  ['warpline', 'kernel', 'pick admit knot resolve selvage.moved'],
  ['merge', 'kernel', 'tree conflict ci landed'],
  // §3.4 kernel-observed strictness signals (P8-D86–D88).
  ['merge', 'kernel', 'reverted ref.rewritten', D86],
  ['gate-class', 'kernel', 'detected decided'],
  ['inject', 'userland', 'receipt'],
  ['paradigm', 'userland', 'doodle.exported event'],
  ['detector', 'userland', 'event'],
  ['loop', 'userland', 'open row closed'],
  ['loop', 'kernel', 'paused'],
  ['tend', 'userland', 'digest proposal.fate teacher.drafted'],
  ['decay', 'userland', 'writeback'],
  ['calibration', 'userland', 'contested reviewer'],
  ['verdict', 'kernel', 'founder'],
  ['verdict', 'kernel', 'incident', D86],
  ['liveness', 'kernel', 'violation digest.consumed'],
  ['flow', 'userland', 'event'],
  ['neurons', 'userland', 'event'],
  // Standalone kernel-owned kinds named in §3.2 L5 and §5.
  ['blob', 'kernel', 'pruned'],
  ['digest', 'kernel', 'consumed'],
  // ── 8.0:loops (docs/specs/gnomon-loops.md §3–§5) — loop entries live in THIS tail block only ──────────────────
  // Kernel-written by #loop-registry / #loop-runner / #loop-events, folded only from kernel-signed rows (LL6). The
  // runner's per-round ledger row is `loop.round` (kernel-owned), NOT `loop.row`: `loop.row|open|closed` stay the
  // userland #learning-loop ledger (gnomon.md §5 namespace ownership, A17-3), which a granted principal may append,
  // so a runner fold over loop.row could be fed forged rows. `loop.paused` (above) stays the one kernel pause row.
  //   loop.trusted / loop.untrusted        a loop-trust card's decision / a revoke (§3.1)
  //   loop.closure.changed                 a human commit changed the config closure; the loop keeps running (§3.1)
  //   loop.run.started / loop.node / loop.round / loop.run.ended   the run ledger (§4)
  //   loop.notified                        a notify node's toast or loop-choice card (§2)
  //   loop.proposed                        an act diff went to a card instead of landing (§3.3 L2, §3.4)
  //   loop.landed / loop.land.waiting / loop.parked                 the land step (§3.2)
  //   loop.trigger.fired                   a schedule, event or continuous trigger fired (§4 #loop-events)
  //   loop.deleted / loop.resumed          a delete; a resume after any pause (the fold's pause → idle edge)
  ['loop', 'kernel', 'trusted untrusted closure.changed run.started node round notified proposed landed land.waiting parked run.ended trigger.fired deleted resumed budget.tightened', LOOPS],
  // The human's asks (§5 "Human ops"; the named request.* exception, gnomon.md §5): pause{all:true} is the kill switch.
  ['request', 'kernel', 'loop.trust loop.untrust loop.pause loop.resume loop.run loop.delete loop.budget', LOOPS],
  // The agent's ask (§5): a userland kind bound in the paradigm grant; the kernel pre-gates it (build step 12).
  ['loop', 'userland', 'request', LOOPS],
  // 8.0:git-verbs (T-2026-10-23-002): git.verb{hsid, verb, phase, inputHash, why?, cardId?, host?, exitCode?} — a
  // kernel-run git verb a session asked for through the kernel's own MCP server (gnomon_git_init / gnomon_git_push /
  // gnomon_repo_create): `requested` before any card or effect, then exactly one of `refused` (why), `ran` or `failed`
  // (exitCode). Never a URL, path, token or command output: the host is the kernel-resolved remote host only.
  ['git', 'kernel', 'verb', GIT_VERB_TAG],
  // 8.0:local-lane (TD-2026-10-27-833 slice C1, #local-tool-broker): tool.brokered{hsid, server, tool?, class?, argsHash,
  // decision, bytes, isError, cardId?} — one brokered tool call of a local session (the child's tool_request, answered
  // by the kernel): HASH-ONLY (the args are a digest, the result a byte count; never args, output, paths or model text).
  // 8.0:local-lane (TD-2026-10-27-833 slice C3', Aegis M2, #tool-selector): tool.selection{hsid, trigger, hash, added,
  // removed, found, unfitPins} — a local session's offered narrow-tool set changed: capability ids only (never the
  // query, a find_tool need or any model text).
  // 8.0:local-lane (TD-2026-10-27-833 slice C5'a1, #mcp-servers trust): tool.trust{id, label, op, binding, why?,
  // launchHash?, toolsHash?} — the human trusted or cleared an MCP server's own tool labels, or the kernel dropped that
  // trust (its launch or its tool list changed, or it was turned off). KERNEL-signed only; TrustBook folds no other row.
  // 8.0:local-lane (TD-2026-10-28-956 / -969 slice C6'a2-1, #local-tool-broker "/" runs): tool.brokered gains author
  // ('human': a "/" run the human started; absent: the model's call). tool.result.policy{hsid, repoKey, tool, bindHash,
  // policy} — the human's choice whether a tool's "/" results go to the model (send) or not (ask), keyed by the repo,
  // the brokered tool name and its bindHash: KERNEL-signed only (ResultPolicyBook folds no other row; a binding change
  // reads ask). tool.result.sent{hsid, tool, argsHash, bytes, cut, policy} — one "/" result the kernel attached to the
  // human's next turn as framed data (hash-only: never the result); its policy is send, or (slice C6'a2-3) once: the
  // human sent one held result while the tool stayed ask.
  // 8.0:local-lane (slice C6'a2-4, #local-tool-broker): a call an Always rule passed writes approval.auto{author?,
  // callId} and its tool.brokered{callId}: one random call id (call:<ULID>, never derived from the args) pairs the two
  // rows; approval.auto{author:'human'} marks a "/" run the human started (absent: the model's call).
  ['tool', 'kernel', 'brokered selection trust result.policy result.sent', LOCAL_LANE],
  // 8.0:local-lane (slice C6'a2): skill.run{hsid, name, skillHash, argsHash, via, decision, tokens?} — the human ran a
  // repo skill from "/" (native: the model's own slash skill; template: the kernel's sanitized template). Hash-only.
  ['skill', 'kernel', 'run', LOCAL_LANE],
  // 8.0:local-lane (TD-2026-10-27-833 slice B2, #local-working-memory): session.memory{hsid, op, id?, source?, kind?,
  // textHash?, bytes, why?} — one change to a local session's kernel-owned working memory: HASH-ONLY (never the text).
  // session.context{hsid, target, previous, requested, configTarget, nCtx, aboveConfig} — the human changed a local
  // session's context target; aboveConfig labels a raise past the signed config (notify-and-proceed, founder Q4).
  // 8.0:local-lane (TD-2026-10-27-833 slice C6'a1, #local-mcp-client): session.mcp{hsid, server, state, fit?, error?} —
  // one MCP server of a local session started, failed (its start, or its process after it started) or was refused (at
  // open, or a restart whose launch, trust or pin binding no longer holds), so the GUI can say so. The server is its
  // label; the error is cleaned server text, capped (a field-level sensitive label: it can name a path).
  ['session', 'kernel', 'memory context mcp', LOCAL_LANE],
];

/** Per-kind sensitivity overrides from §9.1's last column. */
const SENSITIVE_KINDS: Record<string, Sensitivity> = {
  'session.inject': 'sensitive',
  'turn.event': 'sensitive',
  'voice.turn.user': 'sensitive',
  'voice.turn.agent': 'sensitive',
  // "voiceprints secret (§14.4)": the enrol row is the one that carries the print reference.
  'voice.enrol': 'secret',
  // T-2026-10-20-007: why the read-only pass refused names command structure (paths, words)
  'approval.auto.miss': 'sensitive',
  // 8.0:git-verbs: the remote host and the verb's input digest are project detail
  'git.verb': 'sensitive',
  // 8.0:local-lane: the args digest is of model-written text
  'tool.brokered': 'sensitive',
  // 8.0:local-lane (B2): the text digest is of human or model text
  'session.memory': 'sensitive',
  // 8.0:local-lane (C6'a2): the args digest is of human-typed "/" arguments
  'tool.result.sent': 'sensitive',
  'skill.run': 'sensitive',
};

/** Field-level labels stricter than the event's (§9.1 / §9.3 redaction matrix). */
const FIELD_LABELS: Record<string, Record<string, Sensitivity>> = {
  'approval.request': { tool_input: 'sensitive' },
  'oracle.result': { evidence: 'sensitive' },
  'voice.turn.user': { audioRef: 'sensitive' },
  // Aegis round 3 (P8-D86–D88): a worktree path and a commit trailer can carry
  // project or agent-written detail; the rows stay private + normal.
  'approval.auto': { path: 'sensitive', inputHash: 'sensitive', anchoredInputHash: 'sensitive' },
  'approval.auto.miss': { why: 'sensitive', inputHash: 'sensitive' },
  // TD-2026-10-23-939 follow-up: a file rule's path is project detail, like approval.auto's
  'approval.rule.learned': { path: 'sensitive' },
  // 8.0:local-lane (C6'a1): a server's error can name a path under the human's home
  'session.mcp': { error: 'sensitive' },
  // 8.0:session-rename: a session name is the human's own words (it may echo the conversation): a limited reader never gets it
  'request.session.rename': { name: 'sensitive' },
  'session.renamed': { name: 'sensitive' },
  'merge.reverted': { trailer: 'sensitive' },
  // M1.4 slice 2 round 3 (Aegis): digests of sensitive or low-entropy content are
  // confirmation oracles for a dictionary guess, so a limited reader never gets them.
  'turn.sent': { contentHash: 'sensitive' }, // digest of the prompt content
  'approval.voice.arm': { phrasesHash: 'sensitive' }, // digest of short spoken phrases
  'approval.voice.intent': { handleHash: 'sensitive', challengeHash: 'sensitive' }, // short voice handles/challenges (§14.7)
  'link.msg.out': { hash: 'sensitive' }, // digest of a message body sent to a peer
  'inject.receipt': { shas: 'sensitive', source_hash: 'sensitive', frozenSliceHash: 'sensitive' }, // digests of model-visible bytes
  'daemon.log.quarantined': { evidencePath: 'sensitive' }, // a local filesystem path (P8-D89)
  'session.compacted': { summaryHash: 'sensitive' }, // digest of model-written summary text (P8-D93)
  // ── 8.0:loops: check/model evidence is repo output (may carry secrets), as oracle.result's evidence; landed and
  // proposed paths name project detail, as approval.auto's path (gnomon-loops.md §4 "Evidence")
  'loop.node': { evidence: 'sensitive', evidenceRef: 'sensitive' },
  'loop.landed': { paths: 'sensitive' },
  'loop.proposed': { paths: 'sensitive' },
  // build step 12 (Aegis): the agent's loop.request row names its repo by path; the path is project detail
  'loop.request': { repo: 'sensitive' },
};

function build(): Readonly<Record<string, EventKindSpec>> {
  const out: Record<string, EventKindSpec> = {};
  for (const [ns, owner, kinds, reserved] of TABLE) {
    for (const k of kinds.split(/\s+/)) {
      const kind = `${ns}.${k}`;
      if (out[kind]) throw new Error(`duplicate kind ${kind}`);
      out[kind] = Object.freeze({
        kind,
        owner,
        sensitivity: SENSITIVE_KINDS[kind] ?? 'normal',
        ...(FIELD_LABELS[kind] ? { fieldLabels: Object.freeze({ ...FIELD_LABELS[kind] }) } : {}),
        ...(reserved ? { reserved } : {}),
      });
    }
  }
  return Object.freeze(out);
}

/**
 * Additive payload fields reserved on EXISTING kinds (§4.11, §9.1), keyed by
 * kind, tagged with the release they were reserved for. Payloads are opaque to
 * event:v1; this table is published in the event schema so clientApiId covers it.
 */
export const RESERVED_PAYLOAD_FIELDS: Readonly<Record<string, Readonly<Record<string, ReservationTag>>>> = Object.freeze({
  // P8-D98 (§2.4 rule 11, T-2026-10-19-014 B1): the drain interrupt's row is session.inject{channel:'drain'
  // (DRAIN_INJECT_CHANNELS), deadlineMs, deadlineSource (DRAIN_DEADLINE_SOURCES), failed?:true (the write failed)}.
  'session.inject': Object.freeze({ peerRootKeyId: R9, briefId: R9, deadlineMs: D98, deadlineSource: D98, failed: D98 }),
  'session.tainted': Object.freeze({ taint: R9 }),
  'oracle.result': Object.freeze({ round: D86, range: D86, findings: D86 }),
  'contract.knot': Object.freeze({ reopenOf: D86 }),
  'contract.built': Object.freeze({ note: D86, responses: D86 }),
  'verdict.founder': Object.freeze({ override: D86 }),
  // P8-D98 (§2.4 rule 11, B2): a resumed open carries resume{drainedEventId, outcome} (DRAIN_OUTCOMES) and every
  // open carries the opener's principalClass (a resume carries it over instead of assuming 'human').
  // 8.0:loops: a loop session opens with origin:'loop' (the origin clamp, gnomon-loops.md §3.4) and names its run
  'session.open': Object.freeze({ runMode: D86, resume: D98, principalClass: D98, origin: LOOPS, loopRun: LOOPS }),
  // P8-D98 (§2.4 rule 11, B2): a resumed session's sandbox row names resumedFrom (the session.drained ev: id) and
  // drainOutcome (DRAIN_OUTCOMES); a drain-interrupted resume adds a row with phase:'resume-note' (SANDBOX_D98_PHASES),
  // note (RESUME_NOTES) and drainedEventId.
  // (the phase field already exists; its new value is published in D98_CLOSED_VALUES, as are the exit reasons
  // a drained session's session.exited{reason} writes: DRAIN_EXIT_REASONS)
  // P8-D98 (#trace-capture, TD-2026-10-19-057): the running row says traced:true when the human's per-folder trace
  // mode recorded the session's raw stream, or traced:false with traceRefused (TRACE_REFUSALS) when it could not.
  'session.sandbox': Object.freeze({ resumedFrom: D98, drainOutcome: D98, note: D98, drainedEventId: D98, traced: D98, traceRefused: D98 }),
  // P8-D98 (§2.4 rule 11, B2): every refusal of a resume names why (RESUME_REFUSALS); the row makes the refusal terminal.
  'session.refused': Object.freeze({ resume: D98 }),
  // P8-D98 (TD-2026-10-19-648 item 11, §7.4): the per-node claim generation; built in M2.2.
  'contract.claimed': Object.freeze({ claimGen: D98 }),
  // P8-D98 (TD-2026-10-19-528 F2): the match mode of a learned always-rule; only 'exact' (ALWAYS_RULE_MATCHES).
  // TD-2026-10-20-294: a prefix rule carries its words; the always decision that learned it carries the same scope.
  // TD-2026-10-23-939 follow-up: a file rule carries the kernel-resolved path of the card's edit (sensitive: project detail)
  // 8.0:local-lane (slice C5', ^local-tool-grant): a `tool` rule carries the card's bindHash (the entry, its full schema,
  // its class and the server's trust binding); a different bindHash at call time leaves the rule dormant
  'approval.rule.learned': Object.freeze({ match: D98, prefix: PREFIX_RULES, path: EDIT_RULES, bindHash: LOCAL_LANE }),
  // TD-2026-10-23-815 (Aegis L2): a standing-covered decision names the device (unlock key) the grant matched on
  'approval.decide': Object.freeze({ scope: PREFIX_RULES, device: EDIT_RULES }),
  // T-2026-10-20-007: the digest of the ANCHORED command the kernel actually ran (the rewritten updatedInput)
  'approval.auto': Object.freeze({ anchoredInputHash: STANDING }),
  // P8-D98 (TD-2026-10-19-528 F4, §2.4 rule 11): approval.expire{why:'session-drained'} (CARD_EXPIRY_WHYS).
  'approval.expire': Object.freeze({ why: D98 }),
  // P8-D89 (M1.4 slice 3): the read-token file's untrusted diagnostic names the file and why (§9.1 `{line}` stays for the registry).
  'key.registry.malformed': Object.freeze({ file: D89, reason: D89 }),
  // ── 8.0:loops: the kernel's loop pause row names the loop, why (LOOP_PAUSE_REASONS) and who (gnomon-loops.md §3.1, §3.3)
  'loop.paused': Object.freeze({ loopId: LOOPS, runId: LOOPS, reason: LOOPS, by: LOOPS }),
});

/**
 * Payload field names of the kinds reserved for P8-D86–D88, verbatim from §9.1
 * (documentation published in the event schema, so clientApiId covers it; the
 * payloads stay opaque to event:v1). None carries free text: `approval.auto`
 * carries `inputHash`, never the tool input (and `inputHash` is itself a
 * sensitive FIELD label — a digest of the tool input confirms a guess);
 * `verdict.incident` and `request.incident` carry `refs[]` and `severity`
 * only (§9.1 default `normal`).
 */
export const RESERVED_KIND_PAYLOADS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'approval.strictness.raised': ['repo', 'from', 'to', 'cause', 'signals', 'score', 'configHash'],
  'approval.strictness.proposed': ['repo', 'from', 'to', 'evidence'],
  'approval.strictness.lowered': ['repo', 'from', 'to', 'cardId', 'override'],
  'approval.strictness.held': ['repo', 'level', 'reason'],
  'approval.mode.set': ['scope', 'from', 'to', 'by', 'presence'],
  // 8.0:local-lane (C6'a2-4): author (APPROVAL_AUTO_AUTHORS; absent: the model's call) and callId (TOOL_CALL_ID_PATTERN,
  // the same id as the call's tool.brokered row) on a brokered call an Always rule passed
  'approval.auto': ['hsid', 'tool', 'path', 'inputHash', 'modeRef', 'author', 'callId'],
  'request.strictness.set': ['repo', 'to'],
  'request.mode.set': ['repo', 'hsid', 'to'],
  'request.incident': ['refs', 'severity'],
  'contract.review.returned': ['nodeId', 'round', 'openFindings'],
  'contract.review.capped': ['nodeId', 'rounds'],
  'contract.review.extended': ['nodeId', 'cardId'],
  'contract.review.restarted': ['nodeId', 'cardId'],
  'merge.reverted': ['landedRef', 'nodeId', 'detectedBy', 'trailer'],
  'merge.ref.rewritten': ['ref', 'kind'],
  'verdict.incident': ['cardId', 'refs', 'severity'],
  // P8-D89 (M1.4)
  'daemon.log.quarantined': ['quarantinedLog', 'quarantinedHead', 'evidencePath', 'authorizedBy'],
  'key.token.revoked': ['tokenId'],
  // TD-2026-10-20-086 F6 / T-2026-10-20-007
  'grant.standing': ['grantId', 'cardId', 'tuples', 'repos', 'device', 'expiresAt', 'by'],
  'grant.standing.used': ['grantId', 'cardId', 'tuple', 'decision', 'repo', 'hsid'],
  'grant.standing.revoked': ['grantId', 'by', 'reason'],
  'request.grant.standing': ['tuples', 'repos'],
  'request.grant.standing.revoke': ['grantId'],
  'approval.auto.miss': ['hsid', 'tool', 'why', 'inputHash', 'modeRef'],
  'approval.unlock.joined': ['connId', 'scope'],
  // ── 8.0:loops (docs/specs/gnomon-loops.md §3–§5): field names only; a build step adds the closed check ──
  'loop.trusted': ['loopId', 'scope', 'repoKey', 'contentHash', 'cardId', 'authoredBy'],
  'loop.untrusted': ['loopId', 'scope', 'repoKey', 'contentHash', 'by'],
  'loop.closure.changed': ['loopId', 'repoKey', 'digest', 'by'],
  'loop.run.started': ['runId', 'loopId', 'contentHash', 'trigger', 'envelopeId'],
  'loop.node': ['runId', 'nodeId', 'visit', 'verdict', 'confidence', 'model', 'permitId', 'usage', 'evidenceRef', 'effectiveAutonomy'],
  // loop.row{…} (gnomon.md §M3.2) extended additively (gnomon-loops.md §4), kernel-owned
  'loop.round': ['runId', 'loopId', 'repo', 'iter', 'goal_ref', 'tests_passing', 'tsc_errors', 'diff_lines', 'files_touched', 'symbols_touched', 'tokens', 'verdict', 'nodeVisits', 'escalations', 'landedSha'],
  'loop.notified': ['runId', 'loopId', 'nodeId', 'as', 'cardId'],
  'loop.proposed': ['runId', 'loopId', 'cardId', 'paths', 'why'],
  'loop.landed': ['loopId', 'runId', 'sha', 'paths'],
  'loop.land.waiting': ['loopId', 'runId', 'reason'],
  'loop.parked': ['loopId', 'runId', 'ref', 'reason'],
  'loop.run.ended': ['runId', 'loopId', 'reason'],
  'loop.trigger.fired': ['loopId', 'trigger', 'eventId'],
  'loop.deleted': ['loopId', 'scope', 'repoKey', 'by'],
  // LP8 (#gui-loops): a human tightened a trusted loop's caps (never raised: that is a change waiting for trust)
  'loop.budget.tightened': ['loopId', 'scope', 'repoKey', 'contentHash', 'budgets', 'by'],
  'loop.resumed': ['loopId', 'by', 'cardId'],
  'request.loop.trust': ['loopId', 'scope', 'repo'],
  'request.loop.untrust': ['loopId', 'scope', 'repo'],
  'request.loop.pause': ['loopId', 'scope', 'repo', 'all'],
  'request.loop.resume': ['loopId', 'scope', 'repo'],
  'request.loop.run': ['loopId', 'scope', 'repo'],
  'request.loop.delete': ['loopId', 'scope', 'repo'],
  'request.loop.budget': ['loopId', 'scope', 'repo', 'budgets'],
  'loop.request': ['op', 'loopId', 'scope', 'repo', 'hsid'],
});

/**
 * TD-2026-10-20-086 F6: what a daily standing grant may cover (CLOSED). Each names a (card kind, decision) the human
 * still takes by gesture, but with no presence prompt while the grant stands:
 *   mode.loosen:auto-edits  a strictness card loosening a run mode to auto-edits (detail.op mode.loosen), allow
 *   permission:always       a permission card's `always`
 *   voice.widen             a strictness card widening voice to ambient (detail.op voice.widen), allow
 *   voice-arm:allow         a voice-arm card, allow
 *   daemon-stop:restart     a daemon-stop card the kernel marked binaryUnchanged (a restart, never an upgrade), accept
 * (Aegis M2: `reconsider.extend` is NOT standing; the founder's F6 list does not name it.)
 * NEVER standing (no tuple names them, and the broker refuses them whatever a row says): root-class decisions
 * (install, use-api-token, peer-pair, a grant), a re-pin or any binary/publisher change, gate-class cards,
 * fallback-cloud, declassify, and every peer-raised (peer-flagged) card.
 */
export const STANDING_TUPLES = ['mode.loosen:auto-edits', 'permission:always', 'voice.widen', 'voice-arm:allow', 'daemon-stop:restart'] as const;
/** Tuples that apply only inside a granted repo (a match with no repo never uses them). */
export const STANDING_REPO_TUPLES = ['mode.loosen:auto-edits', 'permission:always'] as const;
export type StandingTuple = (typeof STANDING_TUPLES)[number];
/** grant.standing.revoked{reason} (CLOSED): the human's Revoke, or what ended the grant with the unlock. */
export const STANDING_REVOKE_REASONS = ['human', 'screen-lock', 'display-sleep', 'system-sleep', 'user-switch', 'helper-exit'] as const;
export type StandingRevokeReason = (typeof STANDING_REVOKE_REASONS)[number];
/** approval.decide{presence} of a decision a standing grant carried: this prefix + the grantId. */
export const STANDING_PRESENCE_PREFIX = 'standing:' as const;
/** The longest a standing grant lives (it also ends at the next screen lock, sleep or user switch). */
export const STANDING_GRANT_MAX_MS = 12 * 60 * 60_000;

/**
 * Payload fields of BUILT kinds whose payload the kernel validates at append
 * (published in the event schema, so clientApiId covers them). P8-D93.
 */
export const KIND_PAYLOADS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'session.compacted': Object.freeze(['hsid', 'turn', 'reason', 'summaryHash', 'tokensBefore', 'tokensAfter']),
  // P8-D98: closed payloads of the kinds reserved in the T-2026-10-19-001 move (validateKindPayload).
  'session.drained': Object.freeze(['uuid', 'reason']),
  // renewedByDrain + expiresAt: the founder ruling on carry-over (§2.4 rule 11) — a permit live at the drain gets a fresh window.
  'permit.reattributed': Object.freeze(['permitId', 'hsid', 'drainedEventId', 'renewedByDrain', 'expiresAt']),
  'approval.rule.revoked': Object.freeze(['ruleId', 'repoKey', 'tool', 'connId']),
  // 8.0:rules-view: the off / back-on rows of a standing always rule (validateKindPayload)
  'approval.rule.disabled': Object.freeze(['ruleId', 'repoKey', 'tool', 'until', 'batch', 'connId']),
  'approval.rule.enabled': Object.freeze(['ruleId', 'repoKey', 'tool', 'cause', 'batch', 'connId', 'cardId', 'until']),
  'approval.effect.failed': Object.freeze(['cardId', 'decision', 'effect', 'reason']),
  // model switch (8.0:model-switch): the human's ask and its closing row (validateKindPayload)
  'request.session.model': Object.freeze(['hsid', 'model']),
  'session.model': Object.freeze(['hsid', 'from', 'to', 'permitId', 'outcome']),
  // the Desk + the context meter (8.0:TD-2026-10-20-812). Closed, no free text except offer.shown's model-written
  // `question` (≤ OFFER_QUESTION_MAX, control/format/separator characters refused) and its manifest-declared `title`.
  'offer.shown': Object.freeze(['offerId', 'hsid', 'mod', 'kind', 'phase', 'title', 'contextIn', 'question', 'replyTurnId']),
  'offer.decided': Object.freeze(['offerId', 'hsid', 'decision']),
  'offer.kept': Object.freeze(['offerId', 'hsid', 'mod', 'tool']),
  'request.offer.decide': Object.freeze(['offerId', 'decision']),
  'request.offer.mute': Object.freeze(['mod', 'scope', 'hsid', 'muted']),
  'offer.muted': Object.freeze(['mod', 'repo', 'muted', 'hsid']),
  // T-2026-10-21-006: names only (name = the block's mod id, offerKind = its kind; both absent for no-block / malformed)
  'offer.suppressed': Object.freeze(['hsid', 'turn', 'why', 'name', 'offerKind']),
  // T-2026-10-21-008: ids and closed reasons only
  'offer.retired': Object.freeze(['offerId', 'hsid', 'why']),
  'session.anomaly': Object.freeze(['hsid', 'why']),
  // source 'git' carries url (https only) and optionally commit (40 hex), 'folder' carries path (absolute); the other keys are refused
  'request.mod.install': Object.freeze(['source', 'url', 'path', 'commit']),
  'request.session.restart': Object.freeze(['hsid', 'checkpointRef']),
  // 8.0:session-rename: the name is normalised display text (isSessionName); '' resets to the derived title
  'request.session.rename': Object.freeze(['hsid', 'name']),
  'session.renamed': Object.freeze(['hsid', 'name']),
  'session.context.threshold': Object.freeze(['hsid', 'usedTokens', 'windowTokens', 'ratio']),
  // 8.0:git-verbs: closed, ids and closed values only (host is a validated DNS name, never a URL)
  'git.verb': Object.freeze(['hsid', 'verb', 'phase', 'inputHash', 'why', 'cardId', 'host', 'exitCode']),
  // 8.0:local-lane: closed and hash-only (tool and class absent when the name resolved to no offered tool)
  'tool.brokered': Object.freeze(['hsid', 'server', 'tool', 'class', 'argsHash', 'decision', 'bytes', 'isError', 'cardId', 'author', 'callId']),
  // 8.0:local-lane (C6'a2): closed; the repo key, the brokered tool name, its bindHash and the closed policy only
  'tool.result.policy': Object.freeze(['hsid', 'repoKey', 'tool', 'bindHash', 'policy']),
  // 8.0:local-lane (C6'a2): closed and hash-only (never the result)
  'tool.result.sent': Object.freeze(['hsid', 'tool', 'argsHash', 'bytes', 'cut', 'policy']),
  // 8.0:local-lane (C6'a2): closed and hash-only (never the skill text or the arguments)
  'skill.run': Object.freeze(['hsid', 'name', 'skillHash', 'argsHash', 'via', 'decision', 'tokens']),
  // 8.0:local-lane (B2): closed and hash-only; delete carries no entry fields, refused carries why
  'session.memory': Object.freeze(['hsid', 'op', 'id', 'source', 'kind', 'textHash', 'bytes', 'why']),
  // 8.0:local-lane (C3'): closed; ids are capability ids, the hash the selection's; no query or need text
  'tool.selection': Object.freeze(['hsid', 'trigger', 'hash', 'added', 'removed', 'found', 'unfitPins']),
  // 8.0:local-lane (C5'a1): closed; ids, the server label, hashes and closed values only (never a command or a value)
  'tool.trust': Object.freeze(['id', 'label', 'op', 'binding', 'why', 'launchHash', 'toolsHash']),
  // 8.0:local-lane (C6'a1): closed state and fit; refused carries fit, failed carries error
  'session.mcp': Object.freeze(['hsid', 'server', 'state', 'fit', 'error']),
  'session.context': Object.freeze(['hsid', 'target', 'previous', 'requested', 'configTarget', 'nCtx', 'aboveConfig']),
});

/** Keys of a KIND_PAYLOADS entry that may be absent (every other key is required). */
export const KIND_PAYLOAD_OPTIONAL: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'request.mod.install': Object.freeze(['url', 'path', 'commit']),
  'request.session.restart': Object.freeze(['checkpointRef']),
  'offer.suppressed': Object.freeze(['name', 'offerKind']),
  'git.verb': Object.freeze(['why', 'cardId', 'host', 'exitCode']),
  'tool.brokered': Object.freeze(['tool', 'class', 'cardId', 'author', 'callId']),
  'skill.run': Object.freeze(['tokens']),
  'session.memory': Object.freeze(['id', 'source', 'kind', 'textHash', 'why']),
  // 8.0:local-lane (C5'a1): a set row carries launchHash and toolsHash (a drop names which one changed)
  'tool.trust': Object.freeze(['why', 'launchHash', 'toolsHash']),
  'session.mcp': Object.freeze(['fit', 'error']),
  // 8.0:rules-view: cause 'human' carries batch, connId and cardId; cause 'expired' carries until (validateKindPayload)
  'approval.rule.enabled': Object.freeze(['batch', 'connId', 'cardId', 'until']),
});

/** git.verb{verb} (CLOSED, 8.0:git-verbs): the kernel-run git verbs a session may ask for. */
export const GIT_VERBS = ['git.init', 'git.push', 'repo.create', 'git.worktree.add', 'git.worktree.remove'] as const;
export type GitVerb = (typeof GIT_VERBS)[number];
/**
 * git.verb{phase} (CLOSED): requested (before any card or effect), then one of refused | ran | failed. `lookup` (Aegis
 * L6) is a read the kernel made with the human's credentials before the card (repo.create's `gh api user`), host only.
 */
export const GIT_VERB_PHASES = ['requested', 'refused', 'ran', 'failed', 'lookup'] as const;
export type GitVerbPhase = (typeof GIT_VERB_PHASES)[number];
/**
 * git.verb{why} (CLOSED): why a verb was refused (phase refused) or did not finish (phase failed).
 *   not-a-root          the folder is not this session's root
 *   in-repo             init: the folder (or a folder above it) is already in a git repo
 *   protected-folder    init: the home folder, a system folder or the Gnomon home
 *   no-repo             push/create: the session root is not a repo whose .git is a real folder at the root
 *   dotgit-link         .git is a symlink or a gitfile pointer (never followed)
 *   unsafe-config       push/create: the repo config has a key outside the plain allowlist (hooks, helpers, includes, rewrites…)
 *   bad-input           an argument failed validation (repo name, owner, branch, remote, visibility)
 *   no-branch           push: detached HEAD, or the branch does not exist
 *   no-remote           push: the remote is not configured
 *   bad-remote          push: the remote URL is not https/ssh to a plain host (file, ext::, git://, http, userinfo, local paths)
 *   remote-exists       create: the remote name is already configured
 *   remote-changed      push: the remote resolved differently after the card (re-read before the push)
 *   mode-manual         the session is in manual run mode (no approved plan)
 *   loop-session        a loop session never runs a git verb
 *   denied              the human denied the card (or it expired)
 *   no-approval-surface no broker could take the card
 *   tool-missing        git or gh is not installed where the kernel looks
 *   not-authenticated   gh is not signed in (repo create)
 *   command-failed      git or gh exited non-zero (exitCode carried)
 *   timeout             git or gh ran past the kernel's limit
 *   worktree-exists     worktree add: a worktree (or anything) of that name, or that branch, already exists
 *   no-worktree         worktree remove: no kernel worktree of that name
 *   cancelled           8.0:local-lane: a local session's brokered call was aborted, passed its deadline, or its session
 *                       ended (before the card, while it was open, or after the decision; nothing ran)
 *   busy                the session already has the most verb calls in flight (Aegis L5)
 *   unguarded           worktree verbs: this session's profile has no kernel-worktree denies (win32/linux)
 *   secret-in-push      push: the kernel's secret scan hit in the pushed commits and the human denied the card
 */
export const GIT_VERB_REASONS = [
  'not-a-root',
  'in-repo',
  'protected-folder',
  'no-repo',
  'dotgit-link',
  'unsafe-config',
  'bad-input',
  'no-branch',
  'no-remote',
  'bad-remote',
  'remote-exists',
  'remote-changed',
  'mode-manual',
  'loop-session',
  'denied',
  'no-approval-surface',
  'tool-missing',
  'not-authenticated',
  'command-failed',
  'timeout',
  'worktree-exists',
  'no-worktree',
  'busy',
  'unguarded',
  'secret-in-push',
  'cancelled',
] as const;
export type GitVerbReason = (typeof GIT_VERB_REASONS)[number];
/** git.verb{host}: a lowercase DNS name (LDH labels; punycode stays visible as xn--), at most 253 characters. */
export const GIT_VERB_HOST_PATTERN = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/;

/** tool.brokered{class} (CLOSED, 8.0:local-lane): a brokered tool's grant class (read runs; mutate/destructive take a card). */
export const TOOL_BROKER_CLASSES = ['read', 'mutate', 'destructive'] as const;
export type ToolBrokerClass = (typeof TOOL_BROKER_CLASSES)[number];
/**
 * tool.brokered{decision} (CLOSED, 8.0:local-lane): what the kernel did with one brokered call.
 *   ran                 a read-class tool ran
 *   approved            a mutate/destructive tool's card was allowed and it ran
 *   denied              the human denied the card (or it expired)
 *   unknown-tool        the name is not in the session's offered set
 *   bad-args            the args failed the full schema (unknown key, type, size, a control or bidi character)
 *   loop-session        a loop session never runs a brokered tool
 *   no-approval-surface no broker could take the card
 *   cancelled           the call was aborted (abort, tool_cancel, the session's stop) before the target ran
 *   expired             the call's kernel deadline passed (a pending card expired) before the target ran
 *   allowed-cancelled   the card was ALLOWED but the call was cancelled or expired before the target ran
 *   cooldown            the same args were denied moments ago (a deny cool-down)
 *   suspended           this session's brokered calls are suspended after repeated denies or cancelled cards
 *   refused             the target refused the call for another reason (manual mode, bad input, remote changed, …)
 *   busy                the session already has MAX_BROKERED_IN_FLIGHT calls in flight
 *   not-running         the session is not running
 */
export const TOOL_BROKERED_DECISIONS = ['ran', 'approved', 'denied', 'unknown-tool', 'bad-args', 'loop-session', 'no-approval-surface', 'cancelled', 'expired', 'allowed-cancelled', 'cooldown', 'suspended', 'refused', 'busy', 'not-running'] as const;
export type ToolBrokeredDecision = (typeof TOOL_BROKERED_DECISIONS)[number];
/**
 * tool.selection{trigger} (CLOSED, 8.0:local-lane C3'): why the kernel re-selected a local session's narrow tools.
 * `tier` (C4'a, #local-tool-tier): the human committed a tool-tier change (request.session.tier).
 */
export const TOOL_SELECTION_TRIGGERS = ['goal', 'steer', 'find', 'periodic', 'list_changed', 'pin', 'mode', 'tier'] as const;
export type ToolSelectionTrigger = (typeof TOOL_SELECTION_TRIGGERS)[number];
/** tool.selection{added, removed, found}: capability ids `<server>/<tool>[.<op>]@<sha256(schema)[:8]>`, at most this many each. */
export const TOOL_SELECTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}\/[A-Za-z][A-Za-z0-9_.-]{0,63}@[0-9a-f]{8}$/;
export const TOOL_SELECTION_MAX_IDS = 64;
/**
 * tool.brokered{author} (CLOSED, 8.0:local-lane C6'a2): `human` marks a "/" run the human started
 * (request.session.tools.run); absent, the call is the model's.
 */
export const TOOL_BROKERED_AUTHORS = ['human'] as const;
export type ToolBrokeredAuthor = (typeof TOOL_BROKERED_AUTHORS)[number];
/**
 * approval.auto{author} (CLOSED, 8.0:local-lane C6'a2-4): `human` marks a brokered "/" run an Always rule passed;
 * absent, the call was the model's (or the row is not a brokered call's).
 */
export const APPROVAL_AUTO_AUTHORS = ['human'] as const;
export type ApprovalAutoAuthor = (typeof APPROVAL_AUTO_AUTHORS)[number];
/**
 * approval.auto{callId} / tool.brokered{callId} (8.0:local-lane C6'a2-4): `call:<ULID>`, minted at random by the kernel
 * for one brokered call an Always rule passed (never derived from the args); the two rows of that call carry the same id.
 */
export const TOOL_CALL_ID_PATTERN = /^call:[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
/**
 * tool.result.policy{policy} / tool.result.sent{policy} (CLOSED, C6'a2): send (a "/" result of this tool goes to the
 * model with the human's next turn, as framed data) or ask (it does not). No row, or a binding change: ask.
 */
export const TOOL_RESULT_POLICIES = ['send', 'ask'] as const;
export type ToolResultPolicy = (typeof TOOL_RESULT_POLICIES)[number];
/**
 * tool.result.sent{policy} (CLOSED, C6'a2-3): the policies above, plus `once` — a held "/" result the human sent to the
 * model one time (request.session.tools.send) while the tool's policy stayed ask or unchosen. tool.result.policy never
 * takes `once` (it is not a standing choice).
 */
export const TOOL_RESULT_SENT_POLICIES = [...TOOL_RESULT_POLICIES, 'once'] as const;
export type ToolResultSentPolicy = (typeof TOOL_RESULT_SENT_POLICIES)[number];
/** skill.run{name}: a repo skill name (lowercase letters, digits and hyphens, at most 64). */
export const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** skill.run{via} (CLOSED, C6'a2): native (the model's own slash skill) or template (the kernel's sanitized template). */
export const SKILL_RUN_VIAS = ['native', 'template'] as const;
export type SkillRunVia = (typeof SKILL_RUN_VIAS)[number];
/** skill.run{decision} (CLOSED, C6'a2): ran, refused (not listed, bad arguments, a loop session…) or over-budget. */
export const SKILL_RUN_DECISIONS = ['ran', 'refused', 'over-budget'] as const;
export type SkillRunDecision = (typeof SKILL_RUN_DECISIONS)[number];
/** tool.brokered{server}: the MCP server name the call went to (`gnomon` = the kernel's own SDK server). */
export const TOOL_BROKER_SERVER_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** tool.brokered{tool}: an offered tool name (kernel-chosen, never model text). */
export const TOOL_BROKER_TOOL_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
/**
 * tool.trust{op} (CLOSED, 8.0:local-lane C5'a1, #mcp-servers): set (the human's commit of request.mcp.trust), cleared
 * (the human's clear) or dropped (the kernel: the server's binding changed, or it was turned off).
 */
export const TOOL_TRUST_OPS = ['set', 'cleared', 'dropped'] as const;
export type ToolTrustOp = (typeof TOOL_TRUST_OPS)[number];
/**
 * tool.trust{why} (CLOSED): human (set and cleared), launch-changed (its command, args, env, plugin version: the launch
 * hash or plugin version moved), tools-changed (its tools/list: names, schemas, annotations, op-annotations moved),
 * disabled (the human turned the server off).
 */
export const TOOL_TRUST_WHYS = ['human', 'launch-changed', 'tools-changed', 'disabled'] as const;
export type ToolTrustWhy = (typeof TOOL_TRUST_WHYS)[number];
/**
 * session.mcp{state} (CLOSED, 8.0:local-lane C6'a1): started (its initialize answered), failed (a start, or its process
 * after it started, ended with an error: `error`), refused (never run: `fit`).
 */
export const SESSION_MCP_STATES = ['started', 'failed', 'refused'] as const;
export type SessionMcpState = (typeof SESSION_MCP_STATES)[number];
/**
 * session.mcp{fit} (CLOSED, state refused only): remote-refused, launch-writable, label-reserved and pin-mismatch as
 * #local-mcp-client's ServerFit; trust-changed (a restart of a server narrowed as trusted whose trust binding no longer
 * holds); disabled (a restart of a server the human turned off, or relaunched under another hash, since open).
 */
export const SESSION_MCP_FITS = ['remote-refused', 'launch-writable', 'label-reserved', 'pin-mismatch', 'trust-changed', 'disabled'] as const;
export type SessionMcpFit = (typeof SESSION_MCP_FITS)[number];
/** session.mcp{error}: cleaned server text, at most this many characters, no control characters. */
export const SESSION_MCP_ERROR_MAX = 240;
/** tool.trust{id}: a user or plugin MCP server id (`<source>:<owner>:<name>`, printable ASCII, no space). */
export const TOOL_TRUST_ID_PATTERN = /^(?:user|plugin):[\x21-\x7e]{0,255}:[\x21-\x7e]{1,128}$/;
/** tool.trust{launchHash}: the server's launch hash (#mcp-servers declHash, keyed: it never confirms a guessed value). */
export const TOOL_TRUST_LAUNCH_PATTERN = /^hmac-sha256:[0-9a-f]{64}$/;

/**
 * session.memory{op} (CLOSED, 8.0:local-lane slice B2): what changed in a local session's working memory.
 *   add      a new entry (a model note, a file the session edited, the goal of a first prompt)
 *   replace  a kernel entry replaced in place (the goal of a new prompt, the latest failing tool)
 *   forget   the model forgot one of its own notes
 *   evict    the oldest model note left to make room (human and kernel entries are never evicted)
 *   refused  an entry was refused (why)
 *   delete   the human deleted the session's whole memory (no entry fields)
 */
export const SESSION_MEMORY_OPS = ['add', 'replace', 'forget', 'evict', 'refused', 'delete'] as const;
export type SessionMemoryOp = (typeof SESSION_MEMORY_OPS)[number];
/** session.memory{kind} (CLOSED): the entry's kind. */
export const SESSION_MEMORY_KINDS = ['goal', 'fact', 'note', 'file-ref', 'tool-pin'] as const;
export type SessionMemoryKind = (typeof SESSION_MEMORY_KINDS)[number];
/**
 * session.memory{why} (CLOSED, op refused only):
 *   full        the memory holds its cap of entries and none may be evicted
 *   too-long    the text is over the entry's cap
 *   empty       the text is empty
 *   not-found   forget named an id that is not in memory
 *   not-a-note  forget named an entry the model did not write
 *   off           this session has no working memory (a loop session)
 *   child-refused the child refused the kernel's memory_set or set_context (Aegis B2 L1; no entry fields)
 */
export const SESSION_MEMORY_REFUSALS = ['full', 'too-long', 'empty', 'not-found', 'not-a-note', 'off', 'child-refused'] as const;
export type SessionMemoryRefusal = (typeof SESSION_MEMORY_REFUSALS)[number];
/** session.memory{source}: who wrote the entry — the human, the kernel, the model, or a tool behind a named MCP server. */
export const SESSION_MEMORY_SOURCE_PATTERN = /^(?:human|kernel|model|tool:[a-z0-9][a-z0-9_-]{0,63})$/;
/** session.memory{id}: a working-memory entry id (kernel-minted, never reused in a session). */
export const SESSION_MEMORY_ID_PATTERN = /^wm-[1-9]\d{0,8}$/;

/**
 * turn.result{turn} (review M2, a deliberate clientApiId move): the id of the LATEST turn the result closes. The
 * supervisor closes every outstanding turn up to and including it: a queued message Claude Code folded into the
 * running turn (its replay arrived before that turn's result) is closed by the same result. A row written before
 * this field (no `turn`) pairs in send order (FIFO), the oldest open turn first.
 */
/** offer.retired{why} (CLOSED, T-2026-10-21-008): 'continued' = the reply the offer answered continued (a Stop hook). */
export const OFFER_RETIRE_REASONS = ['continued'] as const;
export type OfferRetireReason = (typeof OFFER_RETIRE_REASONS)[number];
/** session.anomaly{why} (CLOSED, T-2026-10-21-008): 'result-without-turn' = a result arrived with no outstanding turn. */
export const SESSION_ANOMALY_REASONS = ['result-without-turn'] as const;
export type SessionAnomalyReason = (typeof SESSION_ANOMALY_REASONS)[number];

export const TURN_RESULT_PAIRING = Object.freeze({ key: 'turn', pattern: TURN_ID_PATTERN.source, closesThrough: true, absent: 'fifo' } as const);

/**
 * 8.0:session-rename: a session's display name. At most SESSION_NAME_MAX code points after normalisation
 * (normalizeSessionName in display.ts: the §4.5 sanitizer, whitespace runs to one space, trimmed); the raw input a
 * client sends is at most SESSION_NAME_INPUT_MAX UTF-16 code units. '' means "no name": the derived title shows.
 */
export const SESSION_NAME_MAX = 80;
export const SESSION_NAME_INPUT_MAX = 1024;
const SESSION_NAME_UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u;
/**
 * A normalised session name (the shape session.renamed / request.session.rename carry): a string of 0..SESSION_NAME_MAX
 * code points with no control, format, line/paragraph separator or lone surrogate character, no whitespace but single
 * U+0020 spaces, and no leading or trailing space. A structural check: the ONE sanitizer is display.ts's.
 */
export function isSessionName(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > SESSION_NAME_MAX * 2) return false;
  if ([...v].length > SESSION_NAME_MAX || SESSION_NAME_UNSAFE.test(v)) return false;
  if (/[^\S ]| {2}/u.test(v)) return false;
  return v === v.trim();
}

/** request.offer.mute{scope} (CLOSED): a mod is muted per repo (A3: Neurons on everywhere, mute per repo). */
export const OFFER_MUTE_SCOPES = ['repo'] as const;
/** request.mod.install{source} (CLOSED, A8): a git URL or a local folder. No registry. */
export const MOD_INSTALL_SOURCES = ['git', 'folder'] as const;
export type ModInstallSource = (typeof MOD_INSTALL_SOURCES)[number];
/** request.mod.install limits: url and path length (UTF-16 code units). */
export const MOD_INSTALL_LIMITS = Object.freeze({ url: 512, path: 1024 });
/**
 * request.mod.install{url}: https only, a host of letters, digits, dots and hyphens (no userinfo, so no `@` before the
 * path), an optional port, then a path of URL-safe printable characters. One pass, no nested quantifier.
 */
export const MOD_INSTALL_URL_PATTERN = /^https:\/\/[A-Za-z0-9][A-Za-z0-9.-]{0,252}(?::[0-9]{1,5})?(?:\/[A-Za-z0-9._~%!$&'()*+,;=:@\/?#-]*)?$/;
/** request.session.restart{checkpointRef}: the opaque id of the Paradigm checkpoint to recover from. */
export const CHECKPOINT_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
/** offer ids: `offer:<ULID>` (ID_PREFIXES.offer). */
export const OFFER_ID_PATTERN = ID_PATTERNS.offer;

/**
 * `session.model{outcome}` (CLOSED, 8.0:model-switch): what one request.session.model came to.
 *   switched         claude answered set_model success; the session runs `to` under the new spawn permit `permitId`
 *   backend-refused  claude answered an error (e.g. an unknown model); nothing changed, the new permit was released
 *   timeout          claude did not answer within the kernel's wait; the kernel keeps `from` on record and HOLDS the new
 *                    permit `permitId` until `reconciled` (released then if the switch never took, or when the session exits)
 *   permit-refused   the fuse or law 7 refused the new spawn permit; nothing was sent (permitId null)
 *   reconciled       after a `timeout`, the next main-chain assistant message's `message.model` (ground truth) said which
 *                    model actually runs: `to` is the model now on record (`from` again when the switch never took;
 *                    then `to` may be 'claude', Claude Code's default), `permitId` the spawn permit the session runs under
 *                    (the timeout's held permit when the switch took)
 */
export const SESSION_MODEL_OUTCOMES = ['switched', 'backend-refused', 'timeout', 'permit-refused', 'reconciled'] as const;
export type SessionModelOutcome = (typeof SESSION_MODEL_OUTCOMES)[number];
/**
 * The context guard of a switch (8.0:model-switch): no session is switched to a 200k model (a target WITHOUT the
 * `fromSuffix` `[1m]`, whatever the source model) while more than this many tokens of context are in use (the last
 * main-chain assistant message's usage), nor while that is unknown (a resumed session before its first message).
 * Refused UNSUPPORTED{context-too-large}; checkpoint + compact first is the context-meter build's.
 */
export const MODEL_SWITCH_CONTEXT_GUARD = Object.freeze({ fromSuffix: '[1m]', maxTokens: 160_000 });
/** The `from` of a session that runs Claude Code's own default model (session.open{model} absent). */
export const CLAUDE_DEFAULT_MODEL = 'claude' as const;

/** session.drained reasons (§2.4 rule 11): closed. An upgrade is the only drain in 8.0. */
export const DRAIN_REASONS = ['upgrade'] as const;
export type DrainReason = (typeof DRAIN_REASONS)[number];

/**
 * §2.4 rule 11 (P8-D98, T-2026-10-19-014 B1/B2): closed value sets of the drain-and-resume rows.
 * - DRAIN_OUTCOMES: `session.open.resume.outcome` and `session.sandbox.drainOutcome`.
 * - DRAIN_EXIT_REASONS: the `session.exited{reason}` a drained session's stop writes (drain-clean resumes normally;
 *   drain-interrupted resumes idle with the resume note and is never continued). Other exit reasons are not drains.
 * - DRAIN_INJECT_CHANNELS: `session.inject{channel}` of the drain interrupt.
 * - DRAIN_DEADLINE_SOURCES: `session.inject{deadlineSource}` (no root-signed config names a drain deadline yet).
 * - SANDBOX_D98_PHASES / RESUME_NOTES: the resume-note row's `phase` and `note`.
 */
export const DRAIN_OUTCOMES = ['clean', 'interrupted'] as const;
export type DrainOutcomeValue = (typeof DRAIN_OUTCOMES)[number];
export const DRAIN_EXIT_REASONS = ['drain-clean', 'drain-interrupted'] as const;
export type DrainExitReason = (typeof DRAIN_EXIT_REASONS)[number];
export const DRAIN_INJECT_CHANNELS = ['drain'] as const;
export const DRAIN_DEADLINE_SOURCES = ['default', 'caller'] as const;
export const SANDBOX_D98_PHASES = ['resume-note'] as const;
export const RESUME_NOTES = ['turn interrupted by update'] as const;
/** `session.refused{resume}` (closed): why a drained session was not resumed. Any such kernel-signed row uses up the drain record. */
export const RESUME_REFUSALS = ['cwd-gone', 'not-human', 'transcripts-withheld', 'layers-changed', 'git-changed', 'permit-missing', 'permit-unfit', 'billing-refused', 'spawn-failed'] as const;
export type ResumeRefusal = (typeof RESUME_REFUSALS)[number];

/** `session.sandbox{traceRefused}` (closed, #trace-capture): why a traced folder's session was not recorded. */
export const TRACE_REFUSALS = ['trace-unsafe', 'trace-unavailable'] as const;
export type TraceRefusalValue = (typeof TRACE_REFUSALS)[number];

/**
 * `approval.voice.disarm{armId, reason}` (§14.7 Disarm, §2.4 rule 11; TD-2026-10-19-194, founder ruling: reserved
 * now, the one deliberate clientApiId move before any client ships). CLOSED. One value per §14.7 disarm trigger:
 * idle / hard expiry, decision limit, either connection closing, a second voice connection, screen lock, display
 * sleep, user switch, system sleep, voice-policy change, config change, any approval.mode.set, the disarm phrase,
 * GUI / CLI Disarm, an unenrolled decision phrase, daemon exit (incl. the drain), helper exit, a gate-arm handle or
 * challenge miss, 3 consecutive refused intents on a reversible arm. `display-sleep`, `user-switch` and
 * `system-sleep` were added to the ruled list because §14.7 names them as triggers apart from screen lock.
 */
export const VOICE_DISARM_REASONS = [
  'idle',
  'hard',
  'limit',
  'conn-closed',
  'voice-conn',
  'screen-lock',
  'display-sleep',
  'user-switch',
  'system-sleep',
  'policy',
  'config',
  'mode-set',
  'phrase',
  'gui',
  'cli',
  'unenrolled',
  'daemon-exit',
  'helper-exit',
  'handle-miss',
  'challenge-miss',
  'refused-streak',
] as const;
export type VoiceDisarmReason = (typeof VOICE_DISARM_REASONS)[number];

/**
 * Always-rule match modes (TD-2026-10-19-528 F2, amended TD-2026-10-20-294): closed. `exact` = (repoKey, tool,
 * inputHash); `prefix` = a Bash rule that widens ONLY within a single literal simple command whose argv starts with
 * the learned words (approval.rule.learned{match:'prefix', prefix}). TD-2026-10-23-939 follow-up (Aegis): `file` = later
 * edits of one kernel-resolved path (approval.rule.learned{match:'file', path}); `repo-edits` = every edit the auto-edits
 * pass allows in the repo. Both match only through the supervisor's auto-edits pass, never in manual mode.
 * 8.0:local-lane (C5', ^local-tool-grant): `tool` = later calls of ONE brokered tool (+ op) on ONE server in the repo,
 * any arguments, while the card's bindHash still holds (approval.rule.learned{match:'tool', bindHash}).
 */
export const ALWAYS_RULE_MATCHES = ['exact', 'prefix', 'file', 'repo-edits', 'tool'] as const;
export type AlwaysRuleMatch = (typeof ALWAYS_RULE_MATCHES)[number];

/** F2: the always-rule `match` field is closed (absent = 'exact', the v1 `matchExact:true` reading). */
export function validateAlwaysRuleMatch(value: unknown): string[] {
  return (ALWAYS_RULE_MATCHES as readonly unknown[]).includes(value) ? [] : [`match: must be ${ALWAYS_RULE_MATCHES.join('|')} (a prefix rule widens only within one literal simple command; file and repo-edits only through the auto-edits pass)`];
}

/** A standing rule's id is the cardId whose `always` decision learned it (#always-rules; approval.auto's modeRef is `rule:<ruleId>`). */
export const RULE_ID_PATTERN = ID_PATTERNS.card;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEBAB_64 = /^[a-z][a-z0-9-]{0,63}$/;
/**
 * A rule's tool name: a Claude tool name, or (8.0:local-lane C5') a brokered MCP tool `mcp:<server>/<tool>` (the
 * namespaced name a brokered card shows). Checked on approval.rule.revoked / disabled / enabled rows only.
 */
export const TOOL_NAME = /^(?:[A-Za-z][A-Za-z0-9_.:-]{0,127}|mcp:[a-z0-9][a-z0-9_-]{0,63}\/[A-Za-z][A-Za-z0-9_.-]{0,63})$/;

export interface SessionDrainedPayload {
  /** The backend session uuid the new kernel resumes with `--resume <uuid>`. */
  uuid: string;
  reason: DrainReason;
}
export interface PermitReattributedPayload {
  permitId: string;
  hsid: string;
  /** The `ev:` id of the session.drained row this re-attribution cites. */
  drainedEventId: string;
  /** Always true: the permit was live at the drain and was carried over with a fresh window (never minted). */
  renewedByDrain: true;
  /** The carried-over permit's new expiry (ISO date-time). */
  expiresAt: string;
}
export interface ApprovalRuleRevokedPayload {
  ruleId: string;
  repoKey: string;
  tool: string;
  /** The verified human device connection that revoked it. */
  connId: string;
}
/** 8.0:rules-view: the most changes one request.rules.apply batch may carry (one per rule). */
export const RULES_APPLY_MAX = 64;
/** 8.0:rules-view (Aegis L2): an "off for a time" ends at most this far ahead of the kernel clock. */
export const RULE_OFF_MAX_MS = 7 * 24 * 60 * 60_000;
/** 8.0:rules-view: what a request.rules.apply change does (CLOSED). remove and off narrow (at once); on loosens (one card). */
export const RULE_CHANGE_OPS = ['remove', 'off', 'on'] as const;
export type RuleChangeOp = (typeof RULE_CHANGE_OPS)[number];
/** 8.0:rules-view: approval.rule.enabled{cause} (CLOSED). */
export const RULE_ENABLE_CAUSES = ['human', 'expired'] as const;
export type RuleEnableCause = (typeof RULE_ENABLE_CAUSES)[number];
/** 8.0:rules-view: the id of one request.rules.apply batch (every row it writes names it). */
export const RULES_BATCH_PATTERN = /^batch:[0-9A-HJKMNP-TV-Z]{26}$/;
/** 8.0:rules-view: request.rules.apply{changes}: `until` (off only) is an ISO time or 'manual' (until turned back on). */
export interface RulesApplyChange {
  ruleId: string;
  op: RuleChangeOp;
  until?: string;
}
export interface ApprovalRuleDisabledPayload {
  ruleId: string;
  repoKey: string;
  tool: string;
  /** ISO date-time on the kernel clock, or null: off until the human turns it back on */
  until: string | null;
  batch: string;
  connId: string;
}
export interface ApprovalRuleEnabledPayload {
  ruleId: string;
  repoKey: string;
  tool: string;
  cause: RuleEnableCause;
  /** cause 'human' */
  batch?: string;
  connId?: string;
  cardId?: string;
  /** the disabled row's until: the flag it clears (cause 'human': null when the off had no end) */
  until?: string | null;
}
export interface ApprovalEffectFailedPayload {
  cardId: string;
  decision: string;
  /** What the decision was to do (kebab-case, e.g. `tool-answer`), never free text. */
  effect: string;
  /** Why it failed (kebab-case), never free text. */
  reason: string;
}

/** Closed checks of the P8-D98 kinds (and session.compacted). Returns errors; [] = valid; an unchecked kind is an error. */
export function validateKindPayload(kind: string, value: unknown): string[] {
  if (kind === 'session.compacted') return validateSessionCompactedPayload(value);
  const keys = KIND_PAYLOADS[kind];
  if (!keys) return [`${kind}: no closed payload check`];
  const c = new Checker('strict');
  if (!c.obj('', value)) return c.errors;
  c.closed('', value, keys);
  const optional = KIND_PAYLOAD_OPTIONAL[kind] ?? [];
  c.required('', value, keys.filter((k) => !optional.includes(k)));
  const v = value as Record<string, unknown>;
  switch (kind) {
    case 'session.drained':
      if ('uuid' in v) c.str('uuid', v.uuid, UUID_PATTERN, 'a lowercase uuid');
      if ('reason' in v) c.closedEnum('reason', v.reason, DRAIN_REASONS);
      break;
    case 'permit.reattributed':
      if ('permitId' in v) c.str('permitId', v.permitId, ID_PATTERNS.permit, 'permit:v1:<ULID>');
      if ('hsid' in v) c.str('hsid', v.hsid, HSID_PATTERN, 'an hsid');
      if ('drainedEventId' in v) c.str('drainedEventId', v.drainedEventId, ID_PATTERNS.ev, 'ev:<ULID>');
      if ('renewedByDrain' in v && v.renewedByDrain !== true) c.fail('renewedByDrain', 'must be true (a carried-over permit is always renewed)');
      if ('expiresAt' in v) c.str('expiresAt', v.expiresAt, ISO_DATE_TIME, 'an ISO date-time');
      break;
    case 'approval.rule.revoked':
      if ('ruleId' in v) c.str('ruleId', v.ruleId, RULE_ID_PATTERN, 'card:<ULID> (the learning card)');
      if ('repoKey' in v) c.str('repoKey', v.repoKey, SHA256_TAGGED, 'sha256:<hex> (the repo key of #always-rules)');
      if ('tool' in v) c.str('tool', v.tool, TOOL_NAME, 'a tool name');
      if ('connId' in v) c.str('connId', v.connId, ID_PATTERNS.conn, 'conn:<ULID>');
      break;
    case 'approval.rule.disabled':
      if ('ruleId' in v) c.str('ruleId', v.ruleId, RULE_ID_PATTERN, 'card:<ULID> (the learning card)');
      if ('repoKey' in v) c.str('repoKey', v.repoKey, SHA256_TAGGED, 'sha256:<hex> (the repo key of #always-rules)');
      if ('tool' in v) c.str('tool', v.tool, TOOL_NAME, 'a tool name');
      if ('until' in v && v.until !== null) c.str('until', v.until, ISO_DATE_TIME, 'an ISO date-time or null (until turned back on)');
      if ('batch' in v) c.str('batch', v.batch, RULES_BATCH_PATTERN, 'batch:<ULID>');
      if ('connId' in v) c.str('connId', v.connId, ID_PATTERNS.conn, 'conn:<ULID>');
      break;
    case 'approval.rule.enabled':
      if ('ruleId' in v) c.str('ruleId', v.ruleId, RULE_ID_PATTERN, 'card:<ULID> (the learning card)');
      if ('repoKey' in v) c.str('repoKey', v.repoKey, SHA256_TAGGED, 'sha256:<hex> (the repo key of #always-rules)');
      if ('tool' in v) c.str('tool', v.tool, TOOL_NAME, 'a tool name');
      if ('cause' in v) c.closedEnum('cause', v.cause, RULE_ENABLE_CAUSES);
      if ('batch' in v) c.str('batch', v.batch, RULES_BATCH_PATTERN, 'batch:<ULID>');
      if ('connId' in v) c.str('connId', v.connId, ID_PATTERNS.conn, 'conn:<ULID>');
      if ('cardId' in v) c.str('cardId', v.cardId, ID_PATTERNS.card, 'card:<ULID> (the rules.apply card)');
      if ('until' in v && !(v.cause === 'human' && v.until === null)) c.str('until', v.until, ISO_DATE_TIME, "an ISO date-time (null only for cause 'human': the off had no end)");
      if (v.cause === 'human') {
        // Aegis M-2: the allowed card names the off flag it clears (its until, null = until turned back on)
        for (const k of ['batch', 'connId', 'cardId', 'until']) if (!(k in v)) c.fail(k, "is required when cause is 'human' (the allowed card and the off it clears)");
      } else if (v.cause === 'expired') {
        if (!('until' in v)) c.fail('until', "is required when cause is 'expired' (the off time that passed)");
        for (const k of ['batch', 'connId', 'cardId']) if (k in v) c.fail(k, "is only for cause 'human'");
      }
      break;
    case 'request.session.model':
      if ('hsid' in v) c.str('hsid', v.hsid, HSID_PATTERN, 'an hsid');
      if ('model' in v && !isClaudeModel(v.model)) c.fail('model', 'must be a Claude model alias or a strict claude-… id');
      break;
    case 'session.model':
      if ('hsid' in v) c.str('hsid', v.hsid, HSID_PATTERN, 'an hsid');
      if ('from' in v && v.from !== CLAUDE_DEFAULT_MODEL && !isClaudeModel(v.from)) c.fail('from', "must be 'claude' or a Claude model");
      if ('to' in v && !isClaudeModel(v.to) && !(v.outcome === 'reconciled' && v.to === CLAUDE_DEFAULT_MODEL)) c.fail('to', "must be a Claude model alias or a strict claude-… id ('claude' only when reconciled back to the default)");
      if ('permitId' in v && v.permitId !== null) c.str('permitId', v.permitId, ID_PATTERNS.permit, 'permit:v1:<ULID> or null');
      if ('outcome' in v) c.closedEnum('outcome', v.outcome, SESSION_MODEL_OUTCOMES);
      if (v.outcome === 'permit-refused' && v.permitId !== null) c.fail('permitId', 'is null when the permit was refused');
      if (v.outcome !== 'permit-refused' && v.permitId === null) c.fail('permitId', 'names the new spawn permit');
      break;
    case 'offer.shown':
      if ('offerId' in v) c.str('offerId', v.offerId, OFFER_ID_PATTERN, 'offer:<ULID>');
      if ('hsid' in v) c.str('hsid', v.hsid, HSID_PATTERN, 'an hsid');
      if ('mod' in v) modId(c, v.mod);
      if ('kind' in v) c.str('kind', v.kind, OFFER_TOKEN_PATTERN, 'an offer kind (kebab, ≤ 64)');
      if ('phase' in v) c.closedEnum('phase', v.phase, OFFER_PHASES);
      if ('title' in v && !isOfferTitle(v.title)) c.fail('title', `must be the declared single-line title (≤ ${OFFER_LIMITS.title}, none of < > " \`)`);
      if ('contextIn' in v) for (const e of contextInProblems(v.contextIn)) c.fail('', e);
      if ('question' in v && !isOfferQuestion(v.question)) c.fail('question', `must be single-line text of 1..${OFFER_QUESTION_MAX} code points, no control, format or separator character`);
      if ('replyTurnId' in v) c.str('replyTurnId', v.replyTurnId, TURN_ID_PATTERN, 'turn:<hsid>/<n>');
      break;
    case 'offer.decided':
      if ('offerId' in v) c.str('offerId', v.offerId, OFFER_ID_PATTERN, 'offer:<ULID>');
      if ('hsid' in v) c.str('hsid', v.hsid, HSID_PATTERN, 'an hsid');
      if ('decision' in v) c.closedEnum('decision', v.decision, OFFER_DECISIONS);
      break;
    case 'offer.kept':
      if ('offerId' in v) c.str('offerId', v.offerId, OFFER_ID_PATTERN, 'offer:<ULID>');
      if ('hsid' in v) c.str('hsid', v.hsid, HSID_PATTERN, 'an hsid');
      if ('mod' in v) modId(c, v.mod);
      if ('tool' in v) c.str('tool', v.tool, OFFER_TOOL_PATTERN, 'an MCP tool name');
      break;
    case 'offer.retired':
      if ('offerId' in v) c.str('offerId', v.offerId, OFFER_ID_PATTERN, 'offer:<ULID>');
      if ('hsid' in v) c.str('hsid', v.hsid, HSID_PATTERN, 'an hsid');
      if ('why' in v) c.closedEnum('why', v.why, OFFER_RETIRE_REASONS);
      break;
    case 'session.anomaly':
      if ('hsid' in v) c.str('hsid', v.hsid, HSID_PATTERN, 'an hsid');
      if ('why' in v) c.closedEnum('why', v.why, SESSION_ANOMALY_REASONS);
      break;
    case 'tool.brokered':
      if ('hsid' in v) c.str('hsid', v.hsid, HSID_PATTERN, 'an hsid');
      if ('server' in v) c.str('server', v.server, TOOL_BROKER_SERVER_PATTERN, 'an MCP server name');
      if ('tool' in v) c.str('tool', v.tool, TOOL_BROKER_TOOL_PATTERN, 'a tool name');
      if ('class' in v) c.closedEnum('class', v.class, TOOL_BROKER_CLASSES);
      if ('argsHash' in v) c.str('argsHash', v.argsHash, SHA256_TAGGED, 'sha256:<hex>');
      if ('decision' in v) c.closedEnum('decision', v.decision, TOOL_BROKERED_DECISIONS);
      if ('bytes' in v && (typeof v.bytes !== 'number' || !Number.isSafeInteger(v.bytes) || v.bytes < 0)) c.fail('bytes', 'must be a non-negative integer');
      if ('isError' in v && typeof v.isError !== 'boolean') c.fail('isError', 'must be a boolean');
      if ('cardId' in v) c.str('cardId', v.cardId, ID_PATTERNS.card, 'card:<ULID>');
      if (('tool' in v) !== ('class' in v)) c.fail('class', 'is present exactly when the tool resolved');
      if ('author' in v) c.closedEnum('author', v.author, TOOL_BROKERED_AUTHORS);
      if ('callId' in v) c.str('callId', v.callId, TOOL_CALL_ID_PATTERN, 'call:<ULID>');
      break;
    case 'tool.result.policy':
      if ('hsid' in v) c.str('hsid', v.hsid, HSID_PATTERN, 'an hsid');
      if ('repoKey' in v) c.str('repoKey', v.repoKey, SHA256_TAGGED, 'sha256:<hex> (the repo key)');
      if ('tool' in v) c.str('tool', v.tool, TOOL_NAME, 'a brokered tool name (mcp:<server>/<tool>)');
      if ('tool' in v && typeof v.tool === 'string' && !v.tool.startsWith('mcp:')) c.fail('tool', 'is a brokered MCP tool name (mcp:<server>/<tool>)');
      if ('bindHash' in v) c.str('bindHash', v.bindHash, SHA256_TAGGED, 'sha256:<hex>');
      if ('policy' in v) c.closedEnum('policy', v.policy, TOOL_RESULT_POLICIES);
      break;
    case 'tool.result.sent':
      if ('hsid' in v) c.str('hsid', v.hsid, HSID_PATTERN, 'an hsid');
      if ('tool' in v) c.str('tool', v.tool, TOOL_NAME, 'a brokered tool name (mcp:<server>/<tool>)');
      if ('argsHash' in v) c.str('argsHash', v.argsHash, SHA256_TAGGED, 'sha256:<hex>');
      if ('bytes' in v && (typeof v.bytes !== 'number' || !Number.isSafeInteger(v.bytes) || v.bytes < 0)) c.fail('bytes', 'must be a non-negative integer');
      if ('cut' in v && typeof v.cut !== 'boolean') c.fail('cut', 'must be a boolean');
      if ('policy' in v) c.closedEnum('policy', v.policy, TOOL_RESULT_SENT_POLICIES);
      break;
    case 'skill.run':
      if ('hsid' in v) c.str('hsid', v.hsid, HSID_PATTERN, 'an hsid');
      if ('name' in v) c.str('name', v.name, SKILL_NAME_PATTERN, 'a skill name');
      if ('skillHash' in v) c.str('skillHash', v.skillHash, SHA256_TAGGED, 'sha256:<hex>');
      if ('argsHash' in v) c.str('argsHash', v.argsHash, SHA256_TAGGED, 'sha256:<hex>');
      if ('via' in v) c.closedEnum('via', v.via, SKILL_RUN_VIAS);
      if ('decision' in v) c.closedEnum('decision', v.decision, SKILL_RUN_DECISIONS);
      if ('tokens' in v && (typeof v.tokens !== 'number' || !Number.isSafeInteger(v.tokens) || v.tokens < 0)) c.fail('tokens', 'must be a non-negative integer');
      break;
    case 'tool.trust': {
      if ('id' in v) c.str('id', v.id, TOOL_TRUST_ID_PATTERN, 'a user or plugin MCP server id');
      if ('label' in v) c.str('label', v.label, TOOL_BROKER_SERVER_PATTERN, 'an MCP server label');
      if ('op' in v) c.closedEnum('op', v.op, TOOL_TRUST_OPS);
      if ('binding' in v) c.str('binding', v.binding, SHA256_TAGGED, 'sha256:<hex>');
      if ('why' in v) c.closedEnum('why', v.why, TOOL_TRUST_WHYS);
      if ('launchHash' in v) c.str('launchHash', v.launchHash, TOOL_TRUST_LAUNCH_PATTERN, 'hmac-sha256:<hex>');
      if ('toolsHash' in v) c.str('toolsHash', v.toolsHash, SHA256_TAGGED, 'sha256:<hex>');
      if (v.op === 'set' && !('launchHash' in v && 'toolsHash' in v && v.why === 'human')) c.fail('op', 'a set row carries launchHash, toolsHash and why human');
      if (v.op === 'cleared' && v.why !== 'human') c.fail('why', 'a cleared row is the human\'s (why human)');
      if (v.op === 'dropped' && !(v.why === 'launch-changed' || v.why === 'tools-changed' || v.why === 'disabled')) c.fail('why', 'a dropped row names launch-changed, tools-changed or disabled');
      break;
    }
    case 'session.mcp': {
      if ('hsid' in v) c.str('hsid', v.hsid, HSID_PATTERN, 'an hsid');
      if ('server' in v) c.str('server', v.server, TOOL_BROKER_SERVER_PATTERN, 'an MCP server label');
      if ('state' in v) c.closedEnum('state', v.state, SESSION_MCP_STATES);
      if ('fit' in v) c.closedEnum('fit', v.fit, SESSION_MCP_FITS);
      if ('error' in v && (typeof v.error !== 'string' || v.error.length === 0 || [...v.error].length > SESSION_MCP_ERROR_MAX || /[\p{Cc}]/u.test(v.error))) c.fail('error', `must be 1..${SESSION_MCP_ERROR_MAX} characters of text`);
      if (('fit' in v) !== (v.state === 'refused')) c.fail('fit', 'is present exactly when state is refused');
      if (('error' in v) !== (v.state === 'failed')) c.fail('error', 'is present exactly when state is failed');
      break;
    }
    case 'tool.selection': {
      if ('hsid' in v) c.str('hsid', v.hsid, HSID_PATTERN, 'an hsid');
      if ('trigger' in v) c.closedEnum('trigger', v.trigger, TOOL_SELECTION_TRIGGERS);
      if ('hash' in v) c.str('hash', v.hash, SHA256_TAGGED, 'sha256:<hex>');
      for (const k of ['added', 'removed', 'found'] as const) {
        if (!(k in v)) continue;
        const a = v[k];
        if (!Array.isArray(a) || a.length > TOOL_SELECTION_MAX_IDS || !a.every((x) => typeof x === 'string' && TOOL_SELECTION_ID_PATTERN.test(x))) c.fail(k, `must be at most ${TOOL_SELECTION_MAX_IDS} capability ids`);
      }
      if ('unfitPins' in v && (typeof v.unfitPins !== 'number' || !Number.isSafeInteger(v.unfitPins) || v.unfitPins < 0 || v.unfitPins > 64)) c.fail('unfitPins', 'must be an integer 0..64');
      break;
    }
    case 'session.memory': {
      if ('hsid' in v) c.str('hsid', v.hsid, HSID_PATTERN, 'an hsid');
      if ('op' in v) c.closedEnum('op', v.op, SESSION_MEMORY_OPS);
      if ('id' in v) c.str('id', v.id, SESSION_MEMORY_ID_PATTERN, 'wm-<n>');
      if ('source' in v) c.str('source', v.source, SESSION_MEMORY_SOURCE_PATTERN, 'human | kernel | model | tool:<server>');
      if ('kind' in v) c.closedEnum('kind', v.kind, SESSION_MEMORY_KINDS);
      if ('textHash' in v) c.str('textHash', v.textHash, SHA256_TAGGED, 'sha256:<hex>');
      if ('bytes' in v && (typeof v.bytes !== 'number' || !Number.isSafeInteger(v.bytes) || v.bytes < 0)) c.fail('bytes', 'must be a non-negative integer');
      if ('why' in v) c.closedEnum('why', v.why, SESSION_MEMORY_REFUSALS);
      if (('why' in v) !== (v.op === 'refused')) c.fail('why', 'is present exactly when op is refused');
      if (v.op === 'delete' && ('id' in v || 'source' in v || 'kind' in v || 'textHash' in v)) c.fail('op', 'delete carries no entry fields');
      if (v.op !== 'delete' && v.op !== 'refused' && !('id' in v && 'source' in v && 'kind' in v && 'textHash' in v)) c.fail('id', 'an entry change carries id, source, kind and textHash');
      break;
    }
    case 'session.context': {
      if ('hsid' in v) c.str('hsid', v.hsid, HSID_PATTERN, 'an hsid');
      for (const k of ['target', 'previous', 'requested', 'configTarget'] as const) if (k in v) c.int(k, v[k], 1);
      if ('nCtx' in v && v.nCtx !== null && (typeof v.nCtx !== 'number' || !Number.isSafeInteger(v.nCtx) || v.nCtx < 1)) c.fail('nCtx', 'must be a positive integer or null (unknown)');
      if ('aboveConfig' in v && typeof v.aboveConfig !== 'boolean') c.fail('aboveConfig', 'must be a boolean');
      if (typeof v.target === 'number' && typeof v.configTarget === 'number' && typeof v.aboveConfig === 'boolean' && v.aboveConfig !== v.target > v.configTarget) c.fail('aboveConfig', 'is true exactly when target is above configTarget');
      break;
    }
    case 'git.verb':
      if ('hsid' in v) c.str('hsid', v.hsid, HSID_PATTERN, 'an hsid');
      if ('verb' in v) c.closedEnum('verb', v.verb, GIT_VERBS);
      if ('phase' in v) c.closedEnum('phase', v.phase, GIT_VERB_PHASES);
      if ('inputHash' in v) c.str('inputHash', v.inputHash, SHA256_TAGGED, 'sha256:<hex>');
      if ('why' in v) c.closedEnum('why', v.why, GIT_VERB_REASONS);
      if ('cardId' in v) c.str('cardId', v.cardId, ID_PATTERNS.card, 'card:<ULID>');
      if ('host' in v) c.str('host', v.host, GIT_VERB_HOST_PATTERN, 'a lowercase DNS host');
      if ('exitCode' in v && (typeof v.exitCode !== 'number' || !Number.isInteger(v.exitCode) || v.exitCode < -1 || v.exitCode > 255)) c.fail('exitCode', 'must be an integer exit code (-1 = killed)');
      if ((v.phase === 'refused' || v.phase === 'failed') && !('why' in v)) c.fail('why', 'names why a refused or failed verb stopped');
      if ((v.phase === 'requested' || v.phase === 'ran' || v.phase === 'lookup') && 'why' in v) c.fail('why', 'only a refused or failed verb names a why');
      break;
    case 'offer.suppressed': {
      if ('hsid' in v) c.str('hsid', v.hsid, HSID_PATTERN, 'an hsid');
      if ('turn' in v) c.str('turn', v.turn, TURN_ID_PATTERN, 'turn:<hsid>/<n>');
      // review C1: the turn is one of THIS session's turns (its id embeds the payload's hsid)
      if (typeof v.turn === 'string' && typeof v.hsid === 'string') {
        const m = TURN_ID_PATTERN.exec(v.turn);
        if (m && m[1] !== v.hsid) c.fail('turn', 'must be a turn of the payload hsid (turn:<hsid>/<n>)');
      }
      if ('why' in v) c.closedEnum('why', v.why, OFFER_SUPPRESS_REASONS);
      if ('name' in v) {
        c.str('name', v.name, OFFER_MOD_PATTERN, 'a mod id <publisher>.<name>');
        if (typeof v.name === 'string' && OFFER_MOD_PATTERN.test(v.name) && !isModId(v.name)) c.fail('name', 'a mod id is at most 60 characters');
      }
      if ('offerKind' in v) c.str('offerKind', v.offerKind, OFFER_TOKEN_PATTERN, 'an offer kind (kebab, ≤ 64)');
      const unnamed = (OFFER_SUPPRESS_UNNAMED as readonly unknown[]).includes(v.why);
      if (unnamed && ('name' in v || 'offerKind' in v)) c.fail('', `why ${String(v.why)} names no mod or kind`);
      if (!unnamed && typeof v.why === 'string' && (OFFER_SUPPRESS_REASONS as readonly string[]).includes(v.why) && (!('name' in v) || !('offerKind' in v))) c.fail('', `why ${v.why} names the block's mod (name) and kind (offerKind)`);
      break;
    }
    case 'request.offer.decide':
      if ('offerId' in v) c.str('offerId', v.offerId, OFFER_ID_PATTERN, 'offer:<ULID>');
      if ('decision' in v) c.closedEnum('decision', v.decision, OFFER_DECISIONS);
      break;
    case 'request.offer.mute':
      if ('mod' in v) modId(c, v.mod);
      if ('scope' in v) c.closedEnum('scope', v.scope, OFFER_MUTE_SCOPES);
      if ('hsid' in v) c.str('hsid', v.hsid, HSID_PATTERN, 'an hsid');
      if ('muted' in v) c.bool('muted', v.muted);
      break;
    case 'offer.muted':
      if ('mod' in v) modId(c, v.mod);
      if ('repo' in v) c.str('repo', v.repo, REPO_SCOPE_PATTERN, 'repo:<16 hex>');
      if ('muted' in v) c.bool('muted', v.muted);
      if ('hsid' in v) c.str('hsid', v.hsid, HSID_PATTERN, 'an hsid');
      break;
    case 'request.mod.install':
      if ('source' in v) c.closedEnum('source', v.source, MOD_INSTALL_SOURCES);
      if (v.source === 'git') {
        if ('path' in v) c.fail('path', "is refused for source 'git' (url names it)");
        if ('commit' in v && (typeof v.commit !== 'string' || !GIT_COMMIT_PATTERN.test(v.commit))) c.fail('commit', 'must be a 40-hex commit id (a sha256-format repo is refused in 8.0)');
        if (!('url' in v)) c.fail('', 'missing property "url" (source git)');
        else if (typeof v.url !== 'string' || v.url.length > MOD_INSTALL_LIMITS.url || !MOD_INSTALL_URL_PATTERN.test(v.url)) c.fail('url', `must be an https URL (no userinfo, no control character, ≤ ${MOD_INSTALL_LIMITS.url})`);
      } else if (v.source === 'folder') {
        if ('url' in v) c.fail('url', "is refused for source 'folder' (path names it)");
        if ('commit' in v) c.fail('commit', "is refused for source 'folder' (git only)");
        if (!('path' in v)) c.fail('', 'missing property "path" (source folder)');
        else if (!isInstallPath(v.path)) c.fail('path', `must be an absolute path (≤ ${MOD_INSTALL_LIMITS.path}) with no control character and no '..' segment`);
      }
      break;
    case 'request.session.rename':
    case 'session.renamed':
      if ('hsid' in v) c.str('hsid', v.hsid, HSID_PATTERN, 'an hsid');
      if ('name' in v && !isSessionName(v.name)) c.fail('name', `must be a normalised session name (≤ ${SESSION_NAME_MAX} code points, one line, no control or format character, trimmed; '' resets)`);
      break;
    case 'request.session.restart':
      if ('hsid' in v) c.str('hsid', v.hsid, HSID_PATTERN, 'an hsid');
      if ('checkpointRef' in v) c.str('checkpointRef', v.checkpointRef, CHECKPOINT_REF_PATTERN, 'a checkpoint id (≤ 128, [A-Za-z0-9._:-])');
      break;
    case 'session.context.threshold': {
      if ('hsid' in v) c.str('hsid', v.hsid, HSID_PATTERN, 'an hsid');
      if ('usedTokens' in v) c.int('usedTokens', v.usedTokens, 0);
      if ('windowTokens' in v) c.int('windowTokens', v.windowTokens, 1);
      const u = v.usedTokens;
      const w = v.windowTokens;
      if ('ratio' in v && (typeof v.ratio !== 'number' || !Number.isFinite(v.ratio) || v.ratio < 0 || v.ratio > 1)) c.fail('ratio', 'must be a number in [0, 1]');
      else if (typeof u === 'number' && typeof w === 'number' && w > 0 && Number.isSafeInteger(u) && Number.isSafeInteger(w)) {
        if (u > w) c.fail('usedTokens', 'cannot exceed windowTokens');
        else if (typeof v.ratio === 'number' && Math.abs(v.ratio - u / w) > 1e-3) c.fail('ratio', 'must equal usedTokens / windowTokens (±0.001)');
      }
      break;
    }
    case 'approval.effect.failed':
      if ('cardId' in v) c.str('cardId', v.cardId, ID_PATTERNS.card, 'card:<ULID>');
      if ('decision' in v) c.str('decision', v.decision, KEBAB_64, 'a decision');
      if ('effect' in v) c.str('effect', v.effect, KEBAB_64, 'kebab-case, ≤ 64');
      if ('reason' in v) c.str('reason', v.reason, KEBAB_64, 'kebab-case, ≤ 64');
      break;
  }
  return c.errors;
}

/** A mod id field of a Desk kind: MOD_ID_PATTERN and the ≤ 60 total (isModId). */
function modId(c: Checker, v: unknown): void {
  c.str('mod', v, OFFER_MOD_PATTERN, 'a mod id <publisher>.<name>');
  if (typeof v === 'string' && OFFER_MOD_PATTERN.test(v) && !isModId(v)) c.fail('mod', 'a mod id is at most 60 characters');
}

// eslint-disable-next-line no-control-regex
const PATH_UNSAFE = /[\u0000-\u001F\u007F-\u009F\p{Zl}\p{Zp}\p{Cf}]/u;
/**
 * request.mod.install{path}: absolute (POSIX `/…` or Windows `X:\…` / `X:/…`), bounded, no unsafe character, no UNC or
 * device prefix, no ':' past the drive, no segment made only of dots and spaces except a single '.'.
 */
export function isInstallPath(v: unknown): v is string {
  if (typeof v !== 'string' || v.length < 2 || v.length > MOD_INSTALL_LIMITS.path || PATH_UNSAFE.test(v)) return false;
  const c0 = v.charCodeAt(0);
  const posix = v[0] === '/';
  const drive = ((c0 >= 0x41 && c0 <= 0x5a) || (c0 >= 0x61 && c0 <= 0x7a)) && v[1] === ':' && (v[2] === '\\' || v[2] === '/');
  if (!posix && !drive) return false;
  // Aegis M3: no UNC or device path (//, \\, \\?\, \\.\), no ':' past the drive (alternate data streams)
  if (v.startsWith('//') || v.startsWith('\\\\') || v.indexOf(':', 2) !== -1) return false;
  // no segment of only dots and spaces other than a single '.' ('..', '...', '. ', ' .' all resolve surprisingly on win32)
  for (const seg of v.split(/[\\/]/)) {
    if (seg === '' || seg === '.') continue;
    let onlyDots = true;
    for (let i = 0; i < seg.length; i++) if (seg[i] !== '.' && seg[i] !== ' ') onlyDots = false;
    if (onlyDots) return false;
  }
  return true;
}

/** session.compacted reasons (Aegis, P8-D93): closed; a backend value outside it is recorded as `unspecified`. */
export const COMPACTION_REASONS = ['threshold', 'overflow', 'manual', 'unspecified'] as const;
export type CompactionReason = (typeof COMPACTION_REASONS)[number];

export interface SessionCompactedPayload {
  hsid: string;
  /** The turn in flight when compaction ran (turn:<hsid>/<n>), or null before the first turn. */
  turn: string | null;
  /** Why the backend compacted (COMPACTION_REASONS). */
  reason: CompactionReason;
  /** sha256:<hex> of the summary text (a sensitive FIELD: it confirms a guess at the summary). */
  summaryHash: string;
  tokensBefore: number;
  tokensAfter: number;
}

/** Closed check of a session.compacted payload (T-2026-10-18-016, P8-D93). Returns errors; [] = valid. */
export function validateSessionCompactedPayload(value: unknown): string[] {
  const c = new Checker('strict');
  if (!c.obj('', value)) return c.errors;
  const keys = KIND_PAYLOADS['session.compacted']!;
  c.closed('', value, keys);
  c.required('', value, keys);
  if ('hsid' in value) c.str('hsid', value.hsid, HSID_PATTERN, 'hsid');
  if ('turn' in value && value.turn !== null) c.str('turn', value.turn, TURN_ID_PATTERN, 'turn:<hsid>/<n> or null');
  if ('reason' in value && !(COMPACTION_REASONS as readonly unknown[]).includes(value.reason)) c.fail('reason', `must be one of ${COMPACTION_REASONS.join('|')}`);
  if ('summaryHash' in value) c.str('summaryHash', value.summaryHash, SHA256_TAGGED, 'sha256:<hex>');
  for (const k of ['tokensBefore', 'tokensAfter'] as const) {
    if (k in value && (!Number.isSafeInteger(value[k]) || (value[k] as number) < 0)) c.fail(k, 'must be a non-negative integer');
  }
  return c.errors;
}

/* ── 8.0:loops closed values (docs/specs/gnomon-loops.md; published in the descriptor's `loops` block) ────────── */

/** A node's verdict (§2): the only thing an edge branches on (LL2). */
export const LOOP_VERDICTS = ['pass', 'fail', 'unsure', 'unavailable', 'error'] as const;
export type LoopVerdict = (typeof LOOP_VERDICTS)[number];
/** A loop's (and a node's effective) autonomy (§2, §3.3). */
export const LOOP_AUTONOMY = ['act', 'propose', 'observe'] as const;
export type LoopAutonomy = (typeof LOOP_AUTONOMY)[number];
/** Where a definition lives (§2): a repo's .paradigm/loops or the human's ~/.gnomon/loops. */
export const LOOP_SCOPES = ['repo', 'personal'] as const;
export type LoopScope = (typeof LOOP_SCOPES)[number];
/** loop.request{op} (§5): the agent's kernel ops (reads go through log.read). */
export const LOOP_REQUEST_OPS = ['create', 'update', 'run', 'pause', 'resume', 'delete'] as const;
export type LoopRequestOp = (typeof LOOP_REQUEST_OPS)[number];
/** loop.paused{reason} (§2 run ends, §3.1, §3.3, §3.5, §3.6). Kernel pauses resume only with fresh presence. */
export const LOOP_PAUSE_REASONS = ['human', 'agent', 'kill-switch', 'content-changed', 'closure-changed', 'thrash', 'strictness', 'budget', 'node-exit', 'unavailable', 'timeout'] as const;
export type LoopPauseReason = (typeof LOOP_PAUSE_REASONS)[number];
/** loop.run.ended{reason} (§2, §4 Restart). */
export const LOOP_RUN_END_REASONS = ['goal', 'stop', 'budget', 'node-exit', 'paused', 'kill-switch', 'content-changed', 'closure-changed', 'thrash', 'strictness', 'untrusted', 'daemon-restart', 'error'] as const;
export type LoopRunEndReason = (typeof LOOP_RUN_END_REASONS)[number];
/** loop.closure.changed{by} / who landed a config-closure change (§3.1): only `human` keeps the loop running. */
export const LOOP_CLOSURE_BY = ['human', 'loop', 'agent'] as const;
/** loop.land.waiting{reason} / loop.parked{reason} (§3.2 refusals). */
export const LOOP_LAND_WAIT_REASONS = ['dirty', 'held', 'rename', 'untracked', 'ignored', 'gitlink', 'attributes', 'case-fold', 'in-progress', 'index-lock', 'human-turn', 'branch-moved', 'bytes-changed', 'gate-class', 'max-wait'] as const;
export type LoopLandWaitReason = (typeof LOOP_LAND_WAIT_REASONS)[number];
/** session.open{origin} of a loop session (§3.4, the origin clamp). */
export const LOOP_SESSION_ORIGIN = 'loop' as const;

/** The frozen kind registry (§9.1). */
export const EVENT_KINDS: Readonly<Record<string, EventKindSpec>> = build();
export const EVENT_KIND_NAMES: readonly string[] = Object.freeze(Object.keys(EVENT_KINDS).sort());

/**
 * Userland namespaces whose kinds the spec does not enumerate (§5, §9.1:
 * `credit{outcome}`, `broke{class}`, mod kinds): any kind under them is valid
 * and labelled `normal` unless the granting manifest declares otherwise.
 * `modns.<name>.*` labels come from the mod's manifest per kind (§9.1).
 */
export const OPEN_USERLAND_NAMESPACES = ['credit', 'broke', 'modns'] as const;

export const KIND_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;
export const MODNS_KIND_PATTERN = /^modns\.[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;

export function isKnownKind(kind: string): boolean {
  if (Object.hasOwn(EVENT_KINDS, kind)) return true;
  if (MODNS_KIND_PATTERN.test(kind)) return true;
  return OPEN_USERLAND_NAMESPACES.some((ns) => ns !== 'modns' && kind.startsWith(`${ns}.`) && KIND_PATTERN.test(kind));
}

export function kindOwner(kind: string): KindOwner | undefined {
  if (Object.hasOwn(EVENT_KINDS, kind)) return EVENT_KINDS[kind]!.owner;
  return isKnownKind(kind) ? 'userland' : undefined;
}

export interface EventLabels {
  audience: Audience;
  sensitivity: Sensitivity;
}

/**
 * Default labels for a kind (S32 §6). Returns undefined for an unregistered
 * kind — "a kind missing from the table fails CI", so the kernel must refuse
 * to append it rather than guess `normal`. `manifestSensitivity` is the label a
 * mod manifest declares for a `modns.*` kind.
 */
export function defaultLabelsFor(kind: string, manifestSensitivity?: Sensitivity): EventLabels | undefined {
  const spec = EVENT_KINDS[kind];
  if (spec) return { audience: DEFAULT_AUDIENCE, sensitivity: spec.sensitivity };
  if (!isKnownKind(kind)) return undefined;
  return { audience: DEFAULT_AUDIENCE, sensitivity: manifestSensitivity ?? 'normal' };
}

/* ── envelope ─────────────────────────────────────────────────────────────── */

export interface EventScopeV1 {
  /** reserved (Q4): always null in 8.0. */
  org: null;
  team: null;
  repo?: string;
  loop?: string;
  contract?: string;
}

export interface EventV1<P = unknown> {
  schemaVersion: typeof EVENT_V1;
  id: string;
  log: string;
  seq: number;
  at: string;
  principal: string;
  keyId?: string;
  deviceId?: string;
  connId?: string;
  idem?: string;
  session?: string;
  scope?: EventScopeV1;
  audience: Audience;
  sensitivity: Sensitivity;
  kind: string;
  causes?: string[];
  payload?: P;
  ref?: string;
  refHash?: string;
  prev: string;
  hash: string;
  sig?: string;
}

export const EVENT_V1_KEYS = [
  'schemaVersion',
  'id',
  'log',
  'seq',
  'at',
  'principal',
  'keyId',
  'deviceId',
  'connId',
  'idem',
  'session',
  'scope',
  'audience',
  'sensitivity',
  'kind',
  'causes',
  'payload',
  'ref',
  'refHash',
  'prev',
  'hash',
  'sig',
] as const;
export const EVENT_V1_REQUIRED = [
  'schemaVersion',
  'id',
  'log',
  'seq',
  'at',
  'principal',
  'audience',
  'sensitivity',
  'kind',
  'prev',
  'hash',
] as const;
export const EVENT_SCOPE_KEYS = ['org', 'team', 'repo', 'loop', 'contract'] as const;

const LOOP_ID = /^loop:.+$/;

/**
 * Validate an event:v1 envelope. Strict additionally requires a registered
 * kind and — when `checkDefaultLabels` is set — that the labels are no looser
 * than the kind's default (L6: a component may tighten, never relax).
 */
export function validateEventV1(
  value: unknown,
  opts: ValidateOptions & { checkDefaultLabels?: boolean } = {},
): string[] {
  const c = new Checker(opts.mode ?? 'strict');
  if (!c.obj('', value)) return c.errors;
  const v = value;
  c.closed('', v, EVENT_V1_KEYS);
  c.required('', v, EVENT_V1_REQUIRED);
  if ('schemaVersion' in v && v.schemaVersion !== EVENT_V1) c.fail('schemaVersion', `must be ${EVENT_V1}`);
  if ('id' in v) c.str('id', v.id, ID_PATTERNS.ev, 'ev:<ULID>');
  if ('log' in v) c.str('log', v.log, ID_PATTERNS.log, 'log:<ULID>');
  if ('seq' in v) c.int('seq', v.seq, 1);
  if ('at' in v) c.str('at', v.at, ISO_DATE_TIME, 'an ISO-8601 date-time');
  if ('principal' in v) c.str('principal', v.principal, ANY_PRINCIPAL_PATTERN, 'p:<ns>/<name>[@<rootKeyId8>]');
  if ('keyId' in v) c.str('keyId', v.keyId, KEY_ID_PATTERN, 'a keyId');
  if ('deviceId' in v) c.str('deviceId', v.deviceId, DEVICE_ID_PATTERN, 'dev:<ns>/<host>');
  if ('connId' in v) c.str('connId', v.connId, ID_PATTERNS.conn, 'conn:<ULID>');
  if ('idem' in v) c.str('idem', v.idem, SHA256_TAGGED, 'sha256:<hex>');
  if ('session' in v) c.str('session', v.session, HSID_PATTERN, 'an hsid');
  if ('scope' in v && c.obj('scope', v.scope)) {
    const s = v.scope;
    c.closed('scope', s, EVENT_SCOPE_KEYS);
    c.required('scope', s, ['org', 'team']);
    if ('org' in s && s.org !== null) c.fail('scope.org', 'reserved: must be null');
    if ('team' in s && s.team !== null) c.fail('scope.team', 'reserved: must be null');
    if ('repo' in s) c.str('scope.repo', s.repo, REPO_SCOPE_PATTERN, 'repo:<16 hex>');
    if ('loop' in s) c.str('scope.loop', s.loop, LOOP_ID, 'loop:<id>');
    if ('contract' in s) c.str('scope.contract', s.contract, CONTRACT_ID_PATTERN, 'contract:v1:<64 hex>');
  }
  if ('audience' in v) c.closedEnum('audience', v.audience, AUDIENCES);
  if ('sensitivity' in v) c.closedEnum('sensitivity', v.sensitivity, SENSITIVITIES);
  if ('kind' in v && c.str('kind', v.kind, KIND_PATTERN, 'a dotted kind')) {
    if (c.mode === 'strict' && !isKnownKind(v.kind)) c.fail('kind', `unregistered kind ${v.kind}`);
    if (opts.checkDefaultLabels && typeof v.sensitivity === 'string') {
      const d = defaultLabelsFor(v.kind);
      const order = SENSITIVITIES as readonly string[];
      if (d && order.indexOf(v.sensitivity) < order.indexOf(d.sensitivity)) {
        c.fail('sensitivity', `looser than the ${v.kind} default (${d.sensitivity})`);
      }
    }
  }
  if ('causes' in v && c.arr('causes', v.causes)) {
    v.causes.forEach((r, i) => {
      for (const e of validateRefV1(r, { mode: c.mode })) c.fail(`causes[${i}]`, e);
    });
  }
  if ('ref' in v) for (const e of validateRefV1(v.ref, { mode: c.mode })) c.fail('ref', e);
  if ('refHash' in v) c.str('refHash', v.refHash, SHA256_TAGGED, 'sha256:<hex>');
  if ('prev' in v) c.str('prev', v.prev, SHA256_TAGGED, 'sha256:<hex>');
  if ('hash' in v) c.str('hash', v.hash, SHA256_TAGGED, 'sha256:<hex>');
  if ('sig' in v) c.str('sig', v.sig, /^.+$/, 'a non-empty string');
  return c.errors;
}

export function isEventV1(value: unknown, opts: ValidateOptions = {}): value is EventV1 {
  return validateEventV1(value, opts).length === 0;
}

/** How a client shows a kind it does not know (§4.9): opaque, never dropped. */
export function opaqueEventView(e: Pick<EventV1, 'kind' | 'principal' | 'at'>): {
  kind: string;
  principal: string;
  at: string;
} {
  return { kind: e.kind, principal: e.principal, at: e.at };
}
