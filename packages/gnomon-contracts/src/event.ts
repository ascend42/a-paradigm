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
export const RESERVATION_TAGS = ['M1.1:P8-D58', 'M1.1:P8-R9', 'M1.1:P8-D86-D88', 'M1.4:P8-D89', '8.0:P8-D98'] as const;
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
];

/** Per-kind sensitivity overrides from §9.1's last column. */
const SENSITIVE_KINDS: Record<string, Sensitivity> = {
  'session.inject': 'sensitive',
  'turn.event': 'sensitive',
  'voice.turn.user': 'sensitive',
  'voice.turn.agent': 'sensitive',
  // "voiceprints secret (§14.4)": the enrol row is the one that carries the print reference.
  'voice.enrol': 'secret',
};

/** Field-level labels stricter than the event's (§9.1 / §9.3 redaction matrix). */
const FIELD_LABELS: Record<string, Record<string, Sensitivity>> = {
  'approval.request': { tool_input: 'sensitive' },
  'oracle.result': { evidence: 'sensitive' },
  'voice.turn.user': { audioRef: 'sensitive' },
  // Aegis round 3 (P8-D86–D88): a worktree path and a commit trailer can carry
  // project or agent-written detail; the rows stay private + normal.
  'approval.auto': { path: 'sensitive', inputHash: 'sensitive' },
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
  'session.open': Object.freeze({ runMode: D86, resume: D98, principalClass: D98 }),
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
  'approval.rule.learned': Object.freeze({ match: D98 }),
  // P8-D98 (TD-2026-10-19-528 F4, §2.4 rule 11): approval.expire{why:'session-drained'} (CARD_EXPIRY_WHYS).
  'approval.expire': Object.freeze({ why: D98 }),
  // P8-D89 (M1.4 slice 3): the read-token file's untrusted diagnostic names the file and why (§9.1 `{line}` stays for the registry).
  'key.registry.malformed': Object.freeze({ file: D89, reason: D89 }),
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
  'approval.auto': ['hsid', 'tool', 'path', 'inputHash', 'modeRef'],
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
});

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
  'approval.effect.failed': Object.freeze(['cardId', 'decision', 'effect', 'reason']),
});

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

/** Always-rule match modes (TD-2026-10-19-528 F2): closed; only an exact match of (repoKey, tool, inputHash). */
export const ALWAYS_RULE_MATCHES = ['exact'] as const;
export type AlwaysRuleMatch = (typeof ALWAYS_RULE_MATCHES)[number];

/** F2: the always-rule `match` field accepts only 'exact' (absent = 'exact', the v1 `matchExact:true` reading). */
export function validateAlwaysRuleMatch(value: unknown): string[] {
  return value === 'exact' ? [] : [`match: must be ${ALWAYS_RULE_MATCHES.join('|')} (an always-rule never widens past an exact match)`];
}

/** A standing rule's id is the cardId whose `always` decision learned it (#always-rules; approval.auto's modeRef is `rule:<ruleId>`). */
export const RULE_ID_PATTERN = ID_PATTERNS.card;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEBAB_64 = /^[a-z][a-z0-9-]{0,63}$/;
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/;

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
  c.required('', value, keys);
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
    case 'approval.effect.failed':
      if ('cardId' in v) c.str('cardId', v.cardId, ID_PATTERNS.card, 'card:<ULID>');
      if ('decision' in v) c.str('decision', v.decision, KEBAB_64, 'a decision');
      if ('effect' in v) c.str('effect', v.effect, KEBAB_64, 'kebab-case, ≤ 64');
      if ('reason' in v) c.str('reason', v.reason, KEBAB_64, 'kebab-case, ≤ 64');
      break;
  }
  return c.errors;
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
