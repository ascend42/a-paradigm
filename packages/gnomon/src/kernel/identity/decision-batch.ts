/**
 * @symbol #identity
 *
 * #identity decision batch (TD-2026-10-20-514; Aegis C1–C3, C7): the kernel's MIRROR of the helper's
 * `decision.sign` rules (packages/gnomon-helper/darwin/Sources/gnomon-helper/Protocol.swift bindDecisionBatch,
 * rowTableRefusal, decisionLine). ONE function per rule on each side; both are checked against the shared vectors
 * packages/gnomon-contracts/test/fixtures/decision-batch-vectors.json. The kernel uses it to
 *   - build the gnomon-root-decision:v2 row and the `intent` bytes it sends,
 *   - pre-check a batch before any prompt (a bad batch never reaches the human),
 *   - rebuild the helper's dialog line and compare `shown` BYTE-EXACT (C2).
 * The counting fake helper (test/helper-fake.ts) runs the same functions, so the TS suite exercises the rules the
 * Swift helper enforces. Self-contained on purpose (node:crypto + canonicalJson only).
 */
import { createHash } from 'node:crypto';
import { canonicalJson } from '@a-company/gnomon-contracts';

export const ROOT_DECISION_V1 = 'gnomon-root-decision:v1';
export const ROOT_DECISION_V2 = 'gnomon-root-decision:v2';
export const VOICE_ENROL_SCHEMA = 'voiceEnrolRow:v1';
export const DECISION_HELPER_VERSION = '1.8.0';
export const LOCAL_ROOT_SCHEMA = 'gnomon-root-local:v1';

/**
 * TD-2026-10-22-769: the helper version a row table first shipped in. A root card whose kind is here is refused when
 * it is RAISED if the running helper is older ("update the Gnomon app"), so a decision never reaches a helper whose
 * decision.sign does not know the kind (the batch path never falls back after a decision.sign error, Aegis C6).
 * loop-trust shipped in the 1.8.0 SOURCE after the signed 1.8.0 was cut, so it needs 1.9.0 too.
 * 8.0:local-lane C6'a2-1 (TD-2026-10-28-969, #local-tool-broker destructive Always): `permission` — a destructive
 * brokered card's `always` is root class (RaiseInput.rootDecisions ['always'], rootRows []); its table signs the decision
 * row only and first ships in helper 1.10.0 (Protocol.swift rowTableRefusal, slice a2-h, G-HLP-02). #local-tool-broker asks
 * ApprovalBroker.rootTableReady first, so an older helper is offered allow | deny only (never a raise-time refusal).
 */
export const ROW_TABLE_MIN_HELPER: Readonly<Record<string, string>> = Object.freeze({
  'loop-trust': '1.9.0',
  'local.config': '1.9.0',
  permission: '1.10.0',
  // TD-2026-10-29-746 / -894 (helper 1.11.0, G-HLP-03/04): the Touch ID switch and the kernel key migration card
  'presence.mode': '1.11.0',
  'kernel-custody': '1.11.0',
  // Aegis S1 H2: moving the helper's log anchor to another log with no genesis row
  'log.quarantine': '1.11.0',
});
export const LOG_QUARANTINE_SCHEMA = 'gnomon-log-quarantine:v1';

export const PRESENCE_MODE_SCHEMA = 'gnomon-presence-mode:v1';
export const KERNEL_CERT_KEY_SCHEMA = 'gnomon-kernel-cert-key:v1';
export const KERNEL_LEGACY_SCHEMA = 'gnomon-kernel-legacy:v1';
export const KERNEL_LEGACY_MAX_KEYS = 64;
/** The helper's presence-mode row hash (click.open): sha256 of the EXACT signed root message, domain included. */
export function presenceModeRowHash(rootMessage: Buffer): string {
  return sha256Tag(rootMessage);
}

/** Mirrors Bounds in Protocol.swift. */
export const DECISION_BOUNDS = Object.freeze({ maxMessages: 10, maxApprovals: 2, maxRootRows: 8, maxMessageBytes: 65_536, maxBytes: 256 * 1024, maxLineChars: 1200, maxReasonChars: 160 });

/** The card kinds that have a row table (C3). A root-class card's decision row names one of these. */
export const ROW_TABLE_KINDS = Object.freeze(['install', 'uninstall', 'voice.enrol', 'mod.mcp.config', 'api-token', 'peer-pair', 'grant', 'loop-trust', 'local.config', 'permission', 'presence.mode', 'kernel-custody', 'log.quarantine'] as const);
export type RowTableKind = (typeof ROW_TABLE_KINDS)[number];

export interface DecisionRowV2 {
  schemaVersion: typeof ROOT_DECISION_V2;
  cardId: string;
  cardKind: string;
  decision: string;
  contentHash: string;
  approver: string;
  rowsDigest: string;
}

type Row = Record<string, unknown>;

export class BatchRefusal extends Error {
  readonly code: 'bad-request' | 'domain-refused' | 'batch-refused';
  readonly why: string;
  constructor(code: 'bad-request' | 'domain-refused' | 'batch-refused', why: string) {
    super(`#identity: decision batch refused (${code}): ${why}`);
    this.name = 'BatchRefusal';
    this.code = code;
    this.why = why;
  }
}

const sha256Tag = (b: Buffer | string): string => `sha256:${createHash('sha256').update(b).digest('hex')}`;
const digest12 = (b: Buffer): string => createHash('sha256').update(b).digest('hex').slice(0, 12);

/** The exact `intent` bytes of a card's detail.rootRows (C1d). */
export function intentBytes(rootRows: readonly unknown[]): Buffer {
  return Buffer.from(canonicalJson(rootRows), 'utf8');
}

/** rowsDigest = sha256(canonicalJson(detail.rootRows)) (C1c). */
export function rowsDigestOf(rootRows: readonly unknown[]): string {
  return sha256Tag(intentBytes(rootRows));
}

export function decisionRowV2(f: { cardId: string; cardKind: string; decision: string; contentHash: string; approver: string; rootRows: readonly unknown[] }): DecisionRowV2 {
  return { schemaVersion: ROOT_DECISION_V2, cardId: f.cardId, cardKind: f.cardKind, decision: f.decision, contentHash: f.contentHash, approver: f.approver, rowsDigest: rowsDigestOf(f.rootRows) };
}

export function rowKind(r: Row): string {
  if (r.schemaVersion === VOICE_ENROL_SCHEMA) return r.op === 'enrol' ? 'voice.enrol' : `voice.${typeof r.op === 'string' ? r.op : '?'}`;
  return typeof r.kind === 'string' ? r.kind : typeof r.schemaVersion === 'string' ? r.schemaVersion : 'row';
}

export function volatileFields(r: Row): readonly string[] {
  return r.schemaVersion === VOICE_ENROL_SCHEMA ? ['createdAt', 'seq', 'at'] : ['createdAt'];
}

/** A built row as the card shows it: its volatile fields dropped (C1a/b). */
export function intentOf(r: Row): Row {
  const out: Row = { ...r };
  for (const f of volatileFields(r)) delete out[f];
  return out;
}

/**
 * 8.0:loops: the closed field set of a loop.trusted root row (the cardId is bound to the decision by bindDecisionBatch).
 * Helper 1.9.0: `requestedBy` (the agent that asked, #loop-agent-ops step 12) is part of the set; before it, an
 * agent-raised trust card could never be allowed on a real helper.
 */
const LOOP_TRUSTED_FIELDS: readonly string[] = ['kind', 'loopId', 'scope', 'repoKey', 'contentHash', 'coreHash', 'closureDigest', 'sourceHash', 'cardId', 'by', 'requestedBy', 'createdAt'];
const SHA256_TAG = /^sha256:[0-9a-f]{64}$/;
/** A principal id (contracts ANY_PRINCIPAL_PATTERN), at most 128 chars. */
const PRINCIPAL = /^p:[0-9a-hjkmnp-tv-z]{8}\/[a-z0-9][a-z0-9._-]{0,63}(?:@[0-9a-f]{8})?$/;
const principalField = (v: unknown): boolean => typeof v === 'string' && v.length <= 128 && PRINCIPAL.test(v);
const LOOP_ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** TD-2026-10-22-769 (helper 1.9.0): the closed shape of a gnomon-root-local:v1 row a local.config card signs. */
const LOCAL_ROW_FIELDS: readonly string[] = ['schemaVersion', 'version', 'local', 'cardId', 'runnerSource', 'createdAt'];
/** Aegis M1: the runner dir and node path are always shown in full, so each is capped. */
export const LOCAL_PATH_MAX = 256;
const LOCAL_FIELDS: readonly string[] = ['endpoints', 'runner'];
const LOCAL_ENDPOINT_FIELDS: readonly string[] = ['id', 'base', 'model', 'compat', 'loops'];
const LOCAL_RUNNER_FIELDS: readonly string[] = ['node', 'nodeSha256', 'dir', 'treeSha256', 'entry'];
/** The local transports (config.ts LOCAL_COMPAT_NAMES; parity-tested). */
const LOCAL_COMPATS: readonly string[] = ['llama.cpp', 'ollama', 'lm-studio', 'vllm', 'mlx-lm'];
export const LOCAL_ROW_MAX_ENDPOINTS = 4;
// ASCII classes only ([0-9], never \d) so ICU (Swift) and JS agree; Swift also requires the match to span the string
const ENDPOINT_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** 8.0 is loopback only: 127.0.0.0/8, localhost or [::1], an optional port, a plain path. */
const LOOPBACK_BASE = /^https?:\/\/(?:127\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|localhost|\[::1\])(?::([0-9]{1,5}))?(?:\/[A-Za-z0-9._~%/-]*)?$/;
const HEX64 = /^[0-9a-f]{64}$/;
const absPosix = (v: string): boolean => v.startsWith('/') && !v.includes('\0');
const SAFE_ENTRY = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const isObjRow = (v: unknown): v is Row => v !== null && typeof v === 'object' && !Array.isArray(v);
const strIn = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;

/** The local.config row check (mirror of localRowRefusal in Protocol.swift). null = allowed. */
export function localRowRefusal(r: Row): string | null {
  for (const k of Object.keys(r)) if (!LOCAL_ROW_FIELDS.includes(k)) return `a local config row never carries ${k.slice(0, 40)}`;
  if (!(typeof r.version === 'number' && Number.isSafeInteger(r.version) && r.version >= 0)) return 'a local config row names its version (a whole number)';
  if (r.runnerSource !== 'bundled' && r.runnerSource !== 'override') return 'a local config row says whether its runner is bundled or an override';
  const l = r.local;
  if (!isObjRow(l)) return 'a local config row names its local section';
  for (const k of Object.keys(l)) if (!LOCAL_FIELDS.includes(k)) return `a local config never carries ${k.slice(0, 40)}`;
  const eps = l.endpoints;
  if (!Array.isArray(eps) || eps.length < 1 || eps.length > LOCAL_ROW_MAX_ENDPOINTS) return `a local config names 1..${LOCAL_ROW_MAX_ENDPOINTS} endpoints`;
  for (const e of eps) {
    if (!isObjRow(e)) return 'a local endpoint is an object';
    for (const k of Object.keys(e)) if (!LOCAL_ENDPOINT_FIELDS.includes(k)) return `a local endpoint never carries ${k.slice(0, 40)}`;
    if (!strIn(e.id, 64) || !ENDPOINT_ID.test(e.id) || !strIn(e.model, 128) || !strIn(e.compat, 32) || !LOCAL_COMPATS.includes(e.compat)) return 'a local endpoint names its id, model and a local compat';
    const m = strIn(e.base, 256) ? LOOPBACK_BASE.exec(e.base) : null;
    if (!m || (m[1] !== undefined && (Number(m[1]) < 1 || Number(m[1]) > 65535))) return 'a local endpoint is loopback only in 8.0';
    if (e.loops !== undefined && typeof e.loops !== 'boolean') return 'a local endpoint loops flag is true or false';
  }
  const ru = l.runner;
  if (!isObjRow(ru)) return 'a local config pins its runner';
  for (const k of Object.keys(ru)) if (!LOCAL_RUNNER_FIELDS.includes(k)) return `a local runner pin never carries ${k.slice(0, 40)}`;
  if (!strIn(ru.node, LOCAL_PATH_MAX) || !absPosix(ru.node) || !strIn(ru.dir, LOCAL_PATH_MAX) || !absPosix(ru.dir) || typeof ru.nodeSha256 !== 'string' || !HEX64.test(ru.nodeSha256) || typeof ru.treeSha256 !== 'string' || !HEX64.test(ru.treeSha256) || !strIn(ru.entry, 128) || !SAFE_ENTRY.test(ru.entry) || ru.entry.split('/').includes('..')) return 'a local runner pin names node, its sha256, the dir, its tree sha256 and the entry';
  return null;
}

const onlyFields = (r: Row, fields: readonly string[], what: string): string | null => {
  for (const k of Object.keys(r).sort()) if (!fields.includes(k)) return `a ${what} row never carries ${k.slice(0, 40)}`;
  return null;
};

/** helper 1.11.0: the presence.mode row (mirror of presenceModeRowRefusal in Protocol.swift). null = allowed. */
export function presenceModeRowRefusal(r: Row): string | null {
  const e = onlyFields(r, ['schemaVersion', 'mode', 'cardId', 'createdAt'], 'presence mode');
  if (e) return e;
  return r.mode === 'on' || r.mode === 'off' ? null : 'a presence mode row names on or off';
}

const LOG_ID = /^log:[0-9A-HJKMNP-TV-Z]{26}$/;
/** helper 1.11.0 (Aegis S1 H2): the log.quarantine row (mirror of logQuarantineRowRefusal). null = allowed. */
export function logQuarantineRowRefusal(r: Row): string | null {
  const e = onlyFields(r, ['schemaVersion', 'from', 'to', 'cardId', 'createdAt'], 'log quarantine');
  if (e) return e;
  const f = r.from;
  const head = isObjRow(f) && Object.keys(f).length === 3 && typeof f.logId === 'string' && LOG_ID.test(f.logId) && typeof f.seq === 'number' && Number.isSafeInteger(f.seq) && f.seq >= 0 && typeof f.hash === 'string' && SHA256_TAG.test(f.hash);
  if (!head) return 'a log quarantine row names the anchored head {logId, seq, hash}';
  if (typeof r.to !== 'string' || !LOG_ID.test(r.to) || r.to === (f as Row).logId) return 'a log quarantine row names the new log';
  return null;
}

/**
 * Aegis S1 M1 (helper 1.11.0, G-HLP-04): the CLICK decision preimage names its card kind and class, so neither the
 * helper nor a verifier trusts a side field: gnomon:approve:v2\n<cardId>\n<cardKind>\n<cardClass>\n<decision>\n
 * <contentHash>\n<approver>[\n<answerDigest>]. Mirror of ClickKey.swift clickApproveRefusal; shared vectors
 * gnomon-contracts test/fixtures/click-approve-vectors.json.
 */
export const CLICK_APPROVE_DOMAIN = 'gnomon:approve:v2\n';
export const CLICK_KEY_PREFIX = 'click:';
export const CLICK_ROOT_KINDS: readonly string[] = Object.freeze(['install', 'uninstall', 'voice.enrol', 'mod.mcp.config', 'api-token', 'peer-pair', 'grant', 'loop-trust', 'local.config', 'presence.mode', 'kernel-custody', 'log.quarantine', 'repin', 'root-grant']);
const CARD_CLASSES = ['reversible', 'destructive', 'irreversible'];
export function clickApproveMessage(f: { cardId: string; cardKind: string; cardClass: string; decision: string; contentHash: string; approver: string; answerDigest?: string }): Buffer {
  return Buffer.from(`${CLICK_APPROVE_DOMAIN}${[f.cardId, f.cardKind, f.cardClass, f.decision, f.contentHash, f.approver, ...(f.answerDigest ? [f.answerDigest] : [])].join('\n')}`, 'utf8');
}
/** The click rule on the bytes: null = a click key may sign it (and a verifier may accept it). */
export function clickDecisionRefusal(m: Buffer): string | null {
  const d = Buffer.from(CLICK_APPROVE_DOMAIN, 'utf8');
  if (m.length < d.length || !m.subarray(0, d.length).equals(d)) return 'a click key signs only gnomon:approve:v2 decisions';
  const f = m.subarray(d.length).toString('utf8').split('\n');
  if ((f.length !== 6 && f.length !== 7) || f.some((x) => x === '' || Buffer.byteLength(x) > 256)) return 'a click key signs only gnomon:approve:v2 decisions';
  const [, kind, cls, decision] = f as [string, string, string, string];
  if (!CARD_CLASSES.includes(cls)) return 'an approve:v2 names its card class';
  if (CLICK_ROOT_KINDS.includes(kind)) return 'a root card is never approved by a click';
  if (decision === 'always' && cls !== 'reversible') return 'an always on a destructive or irreversible card is never a click';
  return null;
}
/**
 * Verifier side (Aegis S1 M1): a signature by a click key (keyId click:…) verifies only over a click-signable approve:v2
 * message; a click-keyed ROOT row (row-sig, or any root card kind) never verifies, whatever the signature.
 */
export function clickKeyedRefusal(signerKeyId: string, message: Buffer): string | null {
  if (!signerKeyId.startsWith(CLICK_KEY_PREFIX)) return null;
  if (message.subarray(0, 18).toString('utf8') === 'gnomon:row-sig:v1\n') return 'a click key never signs a root row';
  return clickDecisionRefusal(message);
}

const B64_STRICT = /^[A-Za-z0-9+/]+={0,2}$/;
/** helper 1.11.0: the kernel-custody rows [cert-key row, legacy row] (mirror of kernelCustodyRefusal). null = allowed. */
export function kernelCustodyRefusal(rows: readonly Row[]): string | null {
  const [k, l] = [rows[0]!, rows[1]!];
  let e = onlyFields(k, ['schemaVersion', 'certKey', 'certKeyId', 'cardId', 'createdAt'], 'kernel-cert key');
  if (e) return e;
  const b64 = k.certKey;
  const raw = typeof b64 === 'string' && b64.length === 88 && B64_STRICT.test(b64) ? Buffer.from(b64, 'base64') : null;
  if (!raw || raw.length !== 65 || raw[0] !== 0x04 || raw.toString('base64') !== b64) return 'a kernel-cert key row names a P-256 X9.63 public key';
  if (k.certKeyId !== sha256Tag(raw)) return "a kernel-cert key row's certKeyId is sha256 of its key";
  e = onlyFields(l, ['schemaVersion', 'keyIds', 'logId', 'headSeq', 'headHash', 'cardId', 'createdAt'], 'kernel legacy');
  if (e) return e;
  if (!Array.isArray(l.keyIds) || l.keyIds.length < 1 || l.keyIds.length > KERNEL_LEGACY_MAX_KEYS) return `a kernel legacy row seals 1..${KERNEL_LEGACY_MAX_KEYS} key ids`;
  const seen = new Set<string>();
  for (const v of l.keyIds as unknown[]) {
    if (typeof v !== 'string' || !/^gkey:v1:[0-9a-f]{64}$/.test(v) || seen.has(v)) return 'a kernel legacy key id is a unique gkey:v1:<64 hex>';
    seen.add(v);
  }
  if (typeof l.logId !== 'string' || !/^log:[0-9A-HJKMNP-TV-Z]{26}$/.test(l.logId)) return 'a kernel legacy row names its log';
  if (typeof l.headSeq !== 'number' || !Number.isSafeInteger(l.headSeq) || l.headSeq < 0) return 'a kernel legacy row names its head seq (a whole number)';
  if (typeof l.headHash !== 'string' || !SHA256_TAG.test(l.headHash)) return 'a kernel legacy row names its head hash';
  return null;
}

/** C3: the closed per-cardKind row table (rows after the decision row). null = allowed. */
export function rowTableRefusal(cardKind: string, rows: readonly Row[]): string | null {
  const kinds = rows.map(rowKind);
  const count = (k: string) => kinds.filter((x) => x === k).length;
  switch (cardKind) {
    case 'install': {
      if (count('grant.install') !== 1 || kinds.at(-1) !== 'grant.install') return 'an install signs exactly one grant.install, last';
      for (const k of kinds.slice(0, -1)) {
        if (!['grant.trust', 'grant.capability', 'grant.egress', 'grant.publisher'].includes(k)) return `an install never signs a ${k} row`;
        if (count(k) > 1) return `an install signs at most one ${k} row`;
      }
      const c = rows.find((r) => rowKind(r) === 'grant.capability');
      if (c && (typeof c.manifestHash !== 'string' || c.deviceId !== undefined)) return "an install's capability row names its manifest, never a device";
      const p = rows.find((r) => rowKind(r) === 'grant.publisher');
      if (p) {
        const name = typeof rows.at(-1)?.name === 'string' ? (rows.at(-1)!.name as string) : '';
        if (typeof p.publisher !== 'string' || !name.startsWith(`${p.publisher}.`)) return 'the publisher row names another publisher than the installed mod';
      }
      return null;
    }
    case 'uninstall':
      return kinds.length === 1 && kinds[0] === 'grant.uninstall' ? null : 'an uninstall signs exactly one grant.uninstall';
    case 'voice.enrol':
      return kinds.length === 1 && kinds[0] === 'voice.enrol' ? null : 'a voice enrolment signs exactly one enrol row';
    case 'loop-trust': {
      // 8.0:loops (gnomon-loops.md §3.1): a loop trust signs exactly one loop.trusted row naming the loop and its hash
      if (kinds.length !== 1 || kinds[0] !== 'loop.trusted') return 'a loop-trust signs exactly one loop.trusted row';
      const r = rows[0]!;
      for (const k of Object.keys(r)) if (!LOOP_TRUSTED_FIELDS.includes(k)) return `a loop.trusted row never carries ${k.slice(0, 40)}`;
      const hash = (v: unknown): boolean => typeof v === 'string' && SHA256_TAG.test(v);
      if (typeof r.loopId !== 'string' || !LOOP_ID.test(r.loopId) || (r.scope !== 'repo' && r.scope !== 'personal') || !hash(r.repoKey) || !hash(r.contentHash)) return 'a loop.trusted row names its loop, scope, repo and content hash';
      for (const k of ['coreHash', 'closureDigest']) if (r[k] !== undefined && !hash(r[k])) return `a loop.trusted ${k} is sha256:<64 hex>`;
      if (r.sourceHash !== undefined && !(typeof r.sourceHash === 'string' && /^[0-9a-f]{64}$/.test(r.sourceHash))) return 'a loop.trusted sourceHash is 64 hex';
      // Aegis L7 (1.9.0): who decided and who asked are principals (by may be 'root' for an agent-raised card)
      if (!(r.by === 'root' || principalField(r.by))) return 'a loop.trusted by is a principal';
      if (r.requestedBy !== undefined && !principalField(r.requestedBy)) return 'a loop.trusted requestedBy is a principal';
      return null;
    }
    case 'local.config': {
      // TD-2026-10-22-769 (helper 1.9.0): a real home's local-model config signs exactly one gnomon-root-local:v1 row
      if (kinds.length !== 1 || kinds[0] !== LOCAL_ROOT_SCHEMA) return 'a local.config signs exactly one gnomon-root-local:v1 row';
      return localRowRefusal(rows[0]!);
    }
    case 'presence.mode':
      // helper 1.11.0 (TD-2026-10-29-340/-894, G-HLP-04): the global Touch ID switch signs exactly one mode row
      if (kinds.length !== 1 || kinds[0] !== PRESENCE_MODE_SCHEMA) return 'a presence.mode signs exactly one gnomon-presence-mode:v1 row';
      return presenceModeRowRefusal(rows[0]!);
    case 'log.quarantine':
      if (kinds.length !== 1 || kinds[0] !== LOG_QUARANTINE_SCHEMA) return 'a log.quarantine signs exactly one gnomon-log-quarantine:v1 row';
      return logQuarantineRowRefusal(rows[0]!);
    case 'kernel-custody':
      // helper 1.11.0 (TD-2026-10-29-746): register the kernel-cert key, then seal the legacy kernel keys
      if (kinds.length !== 2 || kinds[0] !== KERNEL_CERT_KEY_SCHEMA || kinds[1] !== KERNEL_LEGACY_SCHEMA) return 'a kernel-custody signs a gnomon-kernel-cert-key:v1 row, then a gnomon-kernel-legacy:v1 row';
      return kernelCustodyRefusal(rows);
    case 'permission':
    case 'mod.mcp.config':
    case 'api-token':
    case 'peer-pair':
    case 'grant':
      return kinds.length === 0 ? null : `a ${cardKind} decision signs only its decision row`;
    default:
      return `no row table for card kind ${cardKind.slice(0, 40)}`;
  }
}

export interface ApproveFields {
  cardId: string;
  decision: string;
  contentHash: string;
}

export function parseApprove(m: Buffer): ApproveFields | null {
  const d = 'gnomon:approve:v1\n';
  if (!m.subarray(0, d.length).equals(Buffer.from(d))) return null;
  const f = m.subarray(d.length).toString('utf8').split('\n');
  if (f[0] === 'gnomon:decision:v2') f.shift();
  if (f.length < 4 || !f[0] || !f[1] || !f[2]) return null;
  return { cardId: f[0], decision: f[1], contentHash: f[2] };
}

const isObj = (v: unknown): v is Row => v !== null && typeof v === 'object' && !Array.isArray(v);

/** THE binding rule (mirror of bindDecisionBatch in Protocol.swift). Throws BatchRefusal('batch-refused'). */
export function bindDecisionBatch(approve: ApproveFields | null, rows: readonly Row[], intent: Buffer): { anchor: ApproveFields; cardKind: string } {
  const no = (why: string): never => {
    throw new BatchRefusal('batch-refused', why);
  };
  const d = rows[0];
  if (!d || d.schemaVersion !== ROOT_DECISION_V2) no('the first root row is not a gnomon-root-decision:v2 row');
  for (const r of rows.slice(1)) if (r.schemaVersion === ROOT_DECISION_V2 || r.schemaVersion === ROOT_DECISION_V1) no('two root decision rows');
  const s = (k: string): string | undefined => (typeof d![k] === 'string' ? (d![k] as string) : undefined);
  const [c, k, dec, h, appr, digest] = [s('cardId'), s('cardKind'), s('decision'), s('contentHash'), s('approver'), s('rowsDigest')];
  if (c === undefined || k === undefined || dec === undefined || h === undefined || appr === undefined || digest === undefined) no('the decision row does not name a card, kind, decision, content hash, approver and rows digest');
  const anchor = { cardId: c!, decision: dec!, contentHash: h! };
  if (approve && (approve.cardId !== anchor.cardId || approve.decision !== anchor.decision || approve.contentHash !== anchor.contentHash)) no('the decision row names another card, decision or content hash than the approval');
  if (sha256Tag(intent) !== digest) no("the intent does not hash to the decision row's rowsDigest");
  let shown: unknown;
  try {
    shown = JSON.parse(intent.toString('utf8'));
  } catch {
    shown = null;
  }
  if (!Array.isArray(shown)) no('the intent is not a JSON array');
  const later = rows.slice(1);
  if ((shown as unknown[]).length !== later.length) no('the rows signed are not the rows the card showed (count)');
  let mh: string | undefined;
  later.forEach((r, i) => {
    const want = (shown as unknown[])[i];
    if (!isObj(want) || canonicalJson(intentOf(r)) !== canonicalJson(want)) no(`root row ${i + 1} is not the row the card showed`);
    if (r.cardId !== c) no('a root row does not name the decided card');
    if (r.manifestHash !== undefined) {
      if (typeof r.manifestHash !== 'string') no('a manifestHash is not a string');
      if (mh !== undefined && mh !== r.manifestHash) no('two rows name different manifest hashes');
      mh = r.manifestHash as string;
    }
  });
  const t = rowTableRefusal(k!, later);
  if (t) no(t);
  return { anchor, cardKind: k! };
}

/** C2: what one row says on the dialog (mirror of rowShown). null = a field the dialog cannot show. */
export function rowShown(r: Row, compactCaps: boolean): string | null {
  const s = (k: string): string | null => (typeof r[k] === 'string' ? (r[k] as string) : null);
  const strs = (k: string): string[] | null => (Array.isArray(r[k]) && (r[k] as unknown[]).every((x) => typeof x === 'string') ? (r[k] as string[]) : null);
  switch (rowKind(r)) {
    case 'grant.install': {
      const [n, src, p] = [s('name'), s('source'), s('packageHash')];
      return n !== null && src !== null && p !== null ? `install ${n} from ${src} ${p.slice(0, 19)}` : null;
    }
    case 'grant.trust':
      return s('tier') !== null ? `trust ${s('tier')}` : null;
    case 'grant.capability': {
      const caps = strs('capabilities');
      if (!caps || caps.length === 0) return null;
      // Aegis ruling: the full line lists every read path; the compacted line shows only their count
      const reads = strs('read') ?? [];
      if (compactCaps) return `${caps.length} capabilities sha:${digest12(Buffer.from(caps.join(','), 'utf8'))}${reads.length ? ` (reads ${reads.length} paths)` : ''}`;
      return `capabilities ${caps.join(',')}${reads.length ? ` (reads ${reads.join(' ')})` : ''}`;
    }
    case 'grant.egress': {
      const hosts = strs('hosts');
      return hosts && hosts.length ? `egress ${hosts.join(' ')}` : null;
    }
    case 'grant.publisher': {
      const [p, h, n] = [s('publisher'), s('host'), s('namespace')];
      return p !== null && h !== null && n !== null ? `publisher ${p} → ${h}/${n}` : null;
    }
    case 'grant.uninstall':
      return s('name') !== null ? `uninstall ${s('name')}` : null;
    case 'voice.enrol':
      return s('speakerId') !== null ? `voice enrol ${s('speakerId')}` : null;
    case 'loop.trusted': {
      const [l, sc, rk, h] = [s('loopId'), s('scope'), s('repoKey'), s('contentHash')];
      return l !== null && sc !== null && rk !== null && h !== null ? `trust loop ${sc}/${l} repo ${rk.slice(7, 19)} ${h.slice(0, 19)}` : null;
    }
    case LOCAL_ROOT_SCHEMA:
      return localRowShown(r);
    case PRESENCE_MODE_SCHEMA:
      return s('mode') === null ? null : s('mode') === 'off' ? 'Touch ID OFF: every approval becomes a click (root actions keep Touch ID)' : 'Touch ID ON';
    case LOG_QUARANTINE_SCHEMA: {
      const f = r.from;
      if (!isObjRow(f) || typeof f.logId !== 'string' || typeof f.seq !== 'number' || !Number.isSafeInteger(f.seq) || f.seq < 0 || typeof f.hash !== 'string' || s('to') === null) return null;
      return `QUARANTINE log ${f.logId} at seq ${f.seq} ${f.hash.slice(0, 19)} and anchor the new log ${s('to')}`;
    }
    case KERNEL_CERT_KEY_SCHEMA:
      return s('certKeyId') === null ? null : `register the kernel-cert key ${s('certKeyId')!.slice(0, 19)}`;
    case KERNEL_LEGACY_SCHEMA: {
      const [log, h] = [s('logId'), s('headHash')];
      const seq = r.headSeq;
      if (!Array.isArray(r.keyIds) || log === null || h === null || typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) return null;
      return `seal ${r.keyIds.length} legacy kernel keys of ${log} at seq ${seq} ${h.slice(0, 19)}`;
    }
    default:
      return null;
  }
}

/**
 * C2 for a local config row (mirror of localRowShown): the version, every endpoint in full, then the runner IN FULL
 * (Aegis M1: never compacted; a row that does not fit is refused too-large-to-show). An override runner is marked.
 */
export function localRowShown(r: Row): string | null {
  const l = r.local;
  if (!isObjRow(l) || !Array.isArray(l.endpoints) || !isObjRow(l.runner) || typeof r.version !== 'number') return null;
  const eps: string[] = [];
  for (const e of l.endpoints as unknown[]) {
    if (!isObjRow(e) || typeof e.id !== 'string' || typeof e.base !== 'string' || typeof e.model !== 'string' || typeof e.compat !== 'string') return null;
    eps.push(`endpoint ${e.id} ${e.base} model ${e.model} (${e.compat})${e.loops === true ? ' loops: yes' : ' loops: no'}`);
  }
  const ru = l.runner;
  if (typeof ru.dir !== 'string' || typeof ru.treeSha256 !== 'string' || typeof ru.node !== 'string' || typeof ru.nodeSha256 !== 'string' || typeof ru.entry !== 'string') return null;
  const which = r.runnerSource === 'override' ? 'OVERRIDE runner' : 'bundled runner';
  return `local model config v${r.version}: ${eps.join(', ')}; ${which} ${ru.dir}/${ru.entry} tree ${ru.treeSha256.slice(0, 12)} node ${ru.node} ${ru.nodeSha256.slice(0, 12)}`;
}

const UNSHOWABLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;

/** C2: the helper's own line (mirror of decisionLine). Throws BatchRefusal('batch-refused'). */
export function decisionLine(b: { approvals: readonly Buffer[]; root: readonly Buffer[]; rows: readonly Row[]; anchor: ApproveFields; cardKind: string }): string {
  const digests = [...b.approvals, ...b.root].map(digest12).join(' ');
  const build = (compact: boolean): string => {
    const parts = b.rows.slice(1).map((r) => {
      const t = rowShown(r, compact);
      if (t === null) throw new BatchRefusal('batch-refused', 'a root row cannot be shown on the dialog');
      return t;
    });
    const head = `Gnomon Helper: ONE presence signs ${b.anchor.decision} on ${b.cardKind} ${b.anchor.cardId} ${b.anchor.contentHash.slice(0, 19)}`;
    return `${head}${parts.length ? `; ${parts.join('; ')}` : ''}; digests ${digests}`;
  };
  let line = build(false);
  if (line.length > DECISION_BOUNDS.maxLineChars) line = build(true);
  if (line.length > DECISION_BOUNDS.maxLineChars) throw new BatchRefusal('batch-refused', 'too-large-to-show');
  if (UNSHOWABLE.test(line)) throw new BatchRefusal('batch-refused', 'a root row holds a character the dialog cannot show');
  return line;
}

/**
 * The whole request check (mirror of decisionBatch + decisionLine): shapes and bounds, domains, binding, line.
 * Returns the line the helper will show; throws BatchRefusal with the helper's code.
 */
export function checkDecisionBatch(approvals: readonly Buffer[], root: readonly Buffer[], intent: Buffer): { line: string; anchor: ApproveFields; cardKind: string; rows: Row[] } {
  const B = DECISION_BOUNDS;
  const badReq = (why: string): never => {
    throw new BatchRefusal('bad-request', why);
  };
  if (approvals.length > B.maxApprovals) badReq(`approvals must be an array of 0..${B.maxApprovals}`);
  if (root.length < 1 || root.length > B.maxRootRows) badReq(`root must be an array of 1..${B.maxRootRows}`);
  for (const m of [...approvals, ...root]) if (m.length === 0 || m.length > B.maxMessageBytes) badReq('each message must be 1..65536 bytes');
  if (approvals.length + root.length > B.maxMessages) badReq(`a decision signs at most ${B.maxMessages} messages`);
  if (intent.length === 0 || intent.length > B.maxMessageBytes) badReq('intent must be the rootRows JSON');
  if ([...approvals, ...root].reduce((n, m) => n + m.length, intent.length) > B.maxBytes) badReq(`a decision signs at most ${B.maxBytes} bytes`);
  let approve: ApproveFields | null = null;
  let presences = 0;
  const starts = (m: Buffer, d: string): boolean => m.subarray(0, d.length).equals(Buffer.from(d));
  for (const m of approvals) {
    if (starts(m, 'gnomon:approve:v1\n')) {
      if (approve) badReq('at most one approve message per decision');
      approve = parseApprove(m) ?? badReq('the approve message is not a decision preimage');
    } else if (starts(m, 'gnomon:presence:v1\n')) {
      if (++presences > 1) badReq('at most one presence message per decision');
    } else throw new BatchRefusal('domain-refused', 'the approvals key signs only approve:v1 and presence:v1 in a decision');
  }
  const rows: Row[] = [];
  for (const m of root) {
    const d = 'gnomon:row-sig:v1\n';
    if (!starts(m, d)) throw new BatchRefusal('domain-refused', 'the root key signs only row-sig:v1 rows');
    let o: unknown;
    try {
      o = JSON.parse(m.subarray(d.length).toString('utf8'));
    } catch {
      o = null;
    }
    if (!isObj(o)) badReq('each root row must be a JSON object');
    rows.push(o as Row);
  }
  const { anchor, cardKind } = bindDecisionBatch(approve, rows, intent);
  return { line: decisionLine({ approvals, root, rows, anchor, cardKind }), anchor, cardKind, rows };
}
