/**
 * @symbol #log-anchor
 *
 * #log-anchor (TD-2026-10-29-746 slice S2, Aegis S1 H2 / S2 M-2; spec §3.1, §3.2, G-ID-15) — the kernel's use of
 * helper 1.11.0's log anchor `gnomon-head` ({logId, seq, hash} in a keychain item only the helper writes).
 *
 * START. `anchor.read` with this log's head. The verdict decides:
 *   - empty: the first start under S2 — the head is written (no newLog: an empty anchor takes any log);
 *   - ok: tracking;
 *   - ahead: the log grew past the anchor; tracking ONLY if the log's hash chain runs unbroken to the anchored head
 *     (KernelLog.chainVerifiesTo), else quarantine (fork);
 *   - rollback, fork, other-log (the log is missing, behind, rewritten, or another log): QUARANTINE.
 * In quarantine the anchor is never written, custody is `partial`, and for another log (the only move the helper's
 * row table allows) the daemon raises the `log.quarantine` root card (fresh Touch ID). A rollback or fork inside the
 * same log cannot be re-anchored by a card (the row must name another log): status says to run
 * `gnomon log quarantine`, whose new log then meets the card at the next start.
 *
 * NEVER newLog ON ITS OWN. `newLog` is sent in exactly two places: `afterQuarantineDecision` (only after the root card
 * was allowed, so the helper holds a one-time move signed with a fresh presence) and `moveToNewLog` (the kernel's own
 * rotation, with a genesis row it signed — helper ≥ HELPER_OP_MIN['anchor.genesis'] (1.11.1) checks that signature
 * against the key it certified — and only after the old log verified to the anchored head). Start-up never sends it
 * (test/log-anchor.test.ts).
 *
 * CADENCE. While tracking, the head is written when it moved, at most once per LOG_ANCHOR_CADENCE_MS (1 s, an unref'd
 * timer; the helper allows 10 writes a second), and once more at a clean stop. A narrowing row (Aegis S2 M-7) is
 * anchored at once and its append awaits the write (hookFor). So the anchor lags the log by at most
 * about a second of rows; a same-user process that rolls the log back further than that is caught at the next start.
 * Writes are serialized; a helper refusal of rollback / fork / another log puts the anchor in quarantine.
 */
import { canonicalJson } from '@a-company/gnomon-contracts';
import { HELPER_OP_MIN, versionAtLeast, type HelperTransport } from './helper.js';
import type { Signer } from '../log/signer.js';
import { isNarrowingRow } from '../log/narrowing.js';

export const LOG_ANCHOR_CADENCE_MS = 1000;
export const LOG_GENESIS_SCHEMA = 'gnomon-log-genesis:v1';

export type AnchorVerdict = 'ok' | 'ahead' | 'rollback' | 'fork' | 'other-log' | 'empty';
export interface AnchorHeadRef {
  logId: string;
  seq: number;
  hash: string;
}

export interface LogAnchorStatus {
  state: 'unavailable' | 'tracking' | 'quarantine';
  why?: string;
  verdict?: AnchorVerdict;
  /** the anchored head the helper holds (quarantine: the head the log no longer reaches) */
  anchored?: AnchorHeadRef;
  /** the log's head at start */
  local?: AnchorHeadRef;
  /** quarantine: what resolves it */
  resolve?: 'card' | 'run gnomon log quarantine';
  cadenceMs: number;
  lastWrittenSeq?: number;
}

export interface AnchoredLog {
  head(): { log: string; seq: number; hash: string };
  chainVerifiesTo(t: AnchorHeadRef): { ok: true } | { ok: false; why: string; detail: string };
  /** Aegis S2 M-6: the rows after `seq` verify under the sealed ring (H-2 bounds); absent = not checked (tests only) */
  signaturesVerifyAfter?(seq: number): { ok: true } | { ok: false; detail: string };
}

const headOf = (l: AnchoredLog): AnchorHeadRef => {
  const h = l.head();
  return { logId: h.log, seq: h.seq, hash: h.hash };
};

export class HelperLogAnchor {
  readonly #helper: HelperTransport | null;
  readonly #log: AnchoredLog;
  readonly #cadenceMs: number;
  #status: LogAnchorStatus;
  #timer: ReturnType<typeof setInterval> | null = null;
  #chain: Promise<void> = Promise.resolve();
  #written: AnchorHeadRef | null = null;

  constructor(o: { helper?: HelperTransport | null; log: AnchoredLog; cadenceMs?: number }) {
    this.#helper = o.helper ?? null;
    this.#log = o.log;
    this.#cadenceMs = o.cadenceMs ?? LOG_ANCHOR_CADENCE_MS;
    this.#status = { state: 'unavailable', why: 'not started', cadenceMs: this.#cadenceMs };
  }

  status(): LogAnchorStatus {
    return { ...this.#status };
  }

  get quarantined(): boolean {
    return this.#status.state === 'quarantine';
  }

  #quarantine(verdict: AnchorVerdict, anchored: AnchorHeadRef | undefined, local: AnchorHeadRef, why: string): void {
    this.#status = { state: 'quarantine', verdict, ...(anchored ? { anchored } : {}), local, why, resolve: anchored && anchored.logId !== local.logId ? 'card' : 'run gnomon log quarantine', cadenceMs: this.#cadenceMs };
  }

  /** Read and judge (never sends newLog). Never throws: an unavailable helper leaves the anchor `unavailable`. */
  async start(): Promise<LogAnchorStatus> {
    const h = this.#helper;
    const local = headOf(this.#log);
    if (!h || !h.alive) return (this.#status = { state: 'unavailable', why: 'no signed helper', local, cadenceMs: this.#cadenceMs });
    if (!versionAtLeast(h.version, HELPER_OP_MIN['anchor.read']!)) return (this.#status = { state: 'unavailable', why: `helper ${h.version ?? '(unknown)'} has no anchor`, local, cadenceMs: this.#cadenceMs });
    let r: Record<string, unknown>;
    try {
      r = await h.request({ op: 'anchor.read', logId: local.logId, seq: local.seq, hash: local.hash });
    } catch (e) {
      return (this.#status = { state: 'unavailable', why: e instanceof Error ? e.message.slice(0, 200) : 'anchor.read failed', local, cadenceMs: this.#cadenceMs });
    }
    const verdict = r.verdict as AnchorVerdict;
    const anchored = r.empty === true ? undefined : { logId: String(r.logId), seq: Number(r.seq), hash: String(r.hash) };
    if (verdict === 'empty' || r.empty === true) {
      this.#status = { state: 'tracking', verdict: 'empty', local, cadenceMs: this.#cadenceMs };
      await this.tick();
      return this.status();
    }
    if (verdict === 'ok') {
      this.#written = anchored!;
      return (this.#status = { state: 'tracking', verdict, anchored, local, cadenceMs: this.#cadenceMs, lastWrittenSeq: anchored!.seq });
    }
    if (verdict === 'ahead') {
      const v = this.#log.chainVerifiesTo(anchored!);
      if (!v.ok) {
        this.#quarantine('fork', anchored, local, `the log does not verify to the anchored head: ${v.detail}`);
        return this.status();
      }
      // Aegis S2 M-6: the rows past the anchored head must verify under the sealed ring before the anchor advances
      const sv = this.#log.signaturesVerifyAfter?.(anchored!.seq);
      if (sv && !sv.ok) {
        this.#quarantine('fork', anchored, local, `the rows after the anchored head do not verify: ${sv.detail}`);
        return this.status();
      }
      this.#written = anchored!;
      this.#status = { state: 'tracking', verdict, anchored, local, cadenceMs: this.#cadenceMs, lastWrittenSeq: anchored!.seq };
      await this.tick();
      return this.status();
    }
    const words: Record<string, string> = { rollback: 'the log is behind the anchored head (rolled back or truncated)', fork: 'the log has another row at the anchored seq (rewritten)', 'other-log': 'the log is another log than the anchored one (missing or replaced)' };
    this.#quarantine(verdict === 'rollback' || verdict === 'fork' || verdict === 'other-log' ? verdict : 'fork', anchored, local, words[verdict] ?? `unknown anchor verdict ${String(verdict).slice(0, 20)}`);
    return this.status();
  }

  /** Write the head if it moved (tracking only). Serialized; refusals of rollback/fork/another log quarantine. */
  tick(): Promise<void> {
    this.#chain = this.#chain.then(async () => {
      if (this.#status.state !== 'tracking' || !this.#helper?.alive) return;
      const head = headOf(this.#log);
      if (this.#written && this.#written.logId === head.logId && this.#written.seq === head.seq) return;
      try {
        await this.#helper.request({ op: 'anchor.write', logId: head.logId, seq: head.seq, hash: head.hash });
        this.#written = head;
        this.#status = { ...this.#status, lastWrittenSeq: head.seq };
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === 'anchor-rollback' || code === 'anchor-fork' || code === 'anchor-log') this.#quarantine(code === 'anchor-log' ? 'other-log' : code === 'anchor-fork' ? 'fork' : 'rollback', this.#written ?? undefined, head, `the helper refused the anchor write (${code})`);
        // rate-limited / transient: the next tick retries
      }
    });
    return this.#chain;
  }

  /**
   * Aegis S2 M-7: a narrowing row (revocation, denial of trust, fuse rung, strictness raise) is anchored NOW, and the
   * append awaits it (KernelLog.setAnchorHook), so a same-user rollback cannot quietly drop a revocation that was
   * already acknowledged. Every other row keeps the 1 s cadence. null = nothing to await.
   */
  hookFor(e: { kind: string; payload?: unknown }): Promise<void> | null {
    return this.#status.state === 'tracking' && isNarrowingRow(e.kind, e.payload) ? this.tick() : null;
  }

  startTimer(): void {
    if (this.#timer || this.#status.state !== 'tracking') return;
    this.#timer = setInterval(() => void this.tick(), this.#cadenceMs);
    this.#timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.tick().catch(() => undefined);
  }

  /** The log.quarantine row the card signs: from the anchored head to this log. null when no card can resolve it. */
  quarantineRow(): { from: AnchorHeadRef; to: string } | null {
    const s = this.#status;
    if (s.state !== 'quarantine' || !s.anchored || !s.local || s.anchored.logId === s.local.logId) return null;
    return { from: s.anchored, to: s.local.logId };
  }

  /**
   * ONLY after the log.quarantine card was allowed (the helper then holds a one-time move from the anchored head to
   * this log): move the anchor with newLog. A refusal leaves the quarantine.
   */
  async afterQuarantineDecision(): Promise<boolean> {
    const row = this.quarantineRow();
    if (!row || !this.#helper?.alive) return false;
    const head = headOf(this.#log);
    try {
      await this.#helper.request({ op: 'anchor.write', logId: head.logId, seq: head.seq, hash: head.hash, newLog: true });
    } catch {
      return false;
    }
    this.#written = head;
    this.#status = { state: 'tracking', verdict: 'ok', anchored: head, local: head, cadenceMs: this.#cadenceMs, lastWrittenSeq: head.seq };
    this.startTimer();
    return true;
  }

  /**
   * The kernel's own rotation to a new log (the ONLY genesis sender; Aegis S2 M-2). Preconditions, all checked: the
   * anchor is tracking, the OLD log verifies to the head the helper holds, the helper is ≥ 1.11.1 (it checks the
   * genesis signature against the key it certified), and `signer` is this start's (certified) kernel key.
   */
  async moveToNewLog(o: { oldLog: AnchoredLog; newHead: AnchorHeadRef; signer: Signer }): Promise<{ ok: true } | { ok: false; why: string }> {
    const h = this.#helper;
    if (this.#status.state !== 'tracking' || !this.#written) return { ok: false, why: 'the anchor is not tracking' };
    if (!h?.alive || !versionAtLeast(h.version, HELPER_OP_MIN['anchor.genesis']!)) return { ok: false, why: `a genesis needs helper ${HELPER_OP_MIN['anchor.genesis']}` };
    const prev = this.#written;
    const v = o.oldLog.chainVerifiesTo(prev);
    if (!v.ok) return { ok: false, why: `the old log does not verify to the anchored head: ${v.detail}` };
    const genesis = canonicalJson({ schemaVersion: LOG_GENESIS_SCHEMA, logId: o.newHead.logId, prev: { logId: prev.logId, seq: prev.seq, hash: prev.hash } });
    const sig = Buffer.from(o.signer.sign('logGenesis', genesis)).toString('base64');
    try {
      await h.request({ op: 'anchor.write', logId: o.newHead.logId, seq: o.newHead.seq, hash: o.newHead.hash, newLog: true, genesis: Buffer.from(genesis, 'utf8').toString('base64'), genesisSig: sig });
    } catch (e) {
      return { ok: false, why: e instanceof Error ? e.message.slice(0, 200) : 'refused' };
    }
    this.#written = o.newHead;
    return { ok: true };
  }
}
