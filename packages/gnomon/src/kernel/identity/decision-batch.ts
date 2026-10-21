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

/** Mirrors Bounds in Protocol.swift. */
export const DECISION_BOUNDS = Object.freeze({ maxMessages: 10, maxApprovals: 2, maxRootRows: 8, maxMessageBytes: 65_536, maxBytes: 256 * 1024, maxLineChars: 1200, maxReasonChars: 160 });

/** The card kinds that have a row table (C3). A root-class card's decision row names one of these. */
export const ROW_TABLE_KINDS = Object.freeze(['install', 'uninstall', 'voice.enrol', 'mod.mcp.config', 'api-token', 'peer-pair', 'grant'] as const);
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
    default:
      return null;
  }
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
