/**
 * @symbol #identity
 *
 * #identity (spec §3.1 root key, approvals key, presence; §3.4 presence
 * classes; M1.3 slice 1) — the kernel's hardware keys, held by the signed
 * helper (`helper.ts`) in the Secure Enclave and NEVER in the kernel:
 *
 *   HardwareRootAuthority  RootAuthority over the helper's root key. Verifies
 *                          with the pinned public key (no helper needed);
 *                          signs with FRESH presence per signature (the
 *                          helper's prompt, a new LAContext each time).
 *                          `signRow` is synchronous (`gnomon-helper once`,
 *                          for the CLI), `signRowAsync` uses the daemon's
 *                          long-lived helper.
 *   HelperApprovalsKey     ApprovalsKey whose decisionSig is MADE BY THE
 *                          HELPER after presence: fresh (prompt; optionally
 *                          kept as this connId's cached unlock, in the
 *                          helper) or cached (the connId's unlock, no
 *                          prompt). In the same touch the helper signs a
 *                          kernel presence challenge, so the broker also gets
 *                          a `helper-se` PresenceToken bound to the decision.
 *   HelperPresenceProvider PresenceProvider for non-decision presence
 *                          (fresh, approvals key, challenge only).
 *
 * EVERY helper signature is verified against the pinned public key before it
 * is used; a helper (or an impostor on its pipe) that returns anything else
 * gets a refusal, never a token (falsifiers in test/identity-hardware.test.ts).
 * No private key material crosses the helper's pipe in either direction.
 */
import { createHash, createPublicKey, type KeyObject } from 'node:crypto';
import { canonicalJson, nsFromRootPublicKey } from '@a-company/gnomon-contracts';
import { KeyRing, p256KeyId, signaturePreimage, type SignatureDomain } from '../log/signer.js';
import { beginHardwarePresence, completeHardwarePresence, PresenceToken, type PresenceBinding, type PresencePurpose } from './presence.js';
import { RootUnavailableError, RootVerifier, rowMessage, type RootAuthority } from './root-authority.js';
import { HELPER_OP_TIMEOUT_MS, HELPER_SIGN_TIMEOUT_MS, HelperRefusal, HelperUnavailableError, versionAtLeast, type HelperOnceSync, type HelperPush, type HelperReply, type HelperTransport } from './helper.js';
import { BatchRefusal, checkDecisionBatch, DECISION_HELPER_VERSION, intentBytes } from './decision-batch.js';

/** The helper's prompt text is bounded (the helper refuses > 512 chars). */
export const HELPER_REASON_MAX = 500;

export function clampReason(s: string): string {
  const a = Array.from(s.replace(/[\u0000-\u001f\u007f]/g, ' '));
  return a.length <= HELPER_REASON_MAX ? a.join('') : `${a.slice(0, HELPER_REASON_MAX - 1).join('')}…`;
}

/** X9.63 uncompressed P-256 point (65 bytes, base64) → public KeyObject. Throws on anything else. */
export function p256FromX963(b64: string): KeyObject {
  const raw = Buffer.from(b64, 'base64');
  if (raw.length !== 65 || raw[0] !== 0x04) throw new TypeError('#identity: not an uncompressed P-256 point');
  return createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
}

export function pemOf(key: KeyObject): string {
  return key.export({ type: 'spki', format: 'pem' }).toString().replace(/\n+$/, '');
}

/** DER ECDSA-Sig-Value → IEEE-P1363 (r ‖ s, 64 bytes). Throws on malformed input. */
export function derToP1363(der: Uint8Array): Buffer {
  const b = Buffer.from(der);
  let i = 0;
  const need = (c: boolean): void => {
    if (!c) throw new TypeError('#identity: malformed DER signature');
  };
  need(b[i++] === 0x30);
  let len = b[i++]!;
  if (len === 0x81) len = b[i++]!;
  need(len === b.length - i);
  const int = (): Buffer => {
    need(b[i++] === 0x02);
    const l = b[i++]!;
    need(l > 0 && l <= 33 && i + l <= b.length);
    let v = b.subarray(i, i + l);
    i += l;
    while (v.length > 32 && v[0] === 0) v = v.subarray(1);
    need(v.length <= 32);
    return Buffer.concat([Buffer.alloc(32 - v.length), v]);
  };
  const r = int();
  const s = int();
  need(i === b.length);
  return Buffer.concat([r, s]);
}

/** The helper's `sigs[]` (or another array field), converted and length-checked. */
function sigsOf(reply: HelperReply, n: number, field = 'sigs'): Buffer[] {
  const sigs = reply[field];
  if (!Array.isArray(sigs) || sigs.length !== n || !sigs.every((s) => typeof s === 'string')) throw new HelperUnavailableError('protocol', 'the helper returned the wrong number of signatures');
  try {
    return (sigs as string[]).map((s) => derToP1363(Buffer.from(s, 'base64')));
  } catch {
    throw new HelperUnavailableError('protocol', 'the helper returned a malformed signature');
  }
}

const b64 = (domain: SignatureDomain, message: string): string => signaturePreimage(domain, message).toString('base64');

/**
 * Aegis H3: the digest the helper's OWN prompt line shows for each message it
 * signs — sha256 of the exact bytes, first 12 hex. The kernel puts the same
 * value in its text and the CLI prints it, so the human can match them.
 */
export function helperDigest(messageB64: string): string {
  return createHash('sha256').update(Buffer.from(messageB64, 'base64')).digest('hex').slice(0, 12);
}

/** The kernel's text with the digests the helper line must show. */
function withCheck(text: string, messages: readonly string[]): string {
  const check = ` [check ${messages.map(helperDigest).join(' ')}]`;
  const room = HELPER_REASON_MAX - check.length;
  const t = Array.from(clampReason(text));
  return `${t.length <= room ? t.join('') : `${t.slice(0, room - 1).join('')}…`}${check}`; // the check is never clipped
}

/** Public identity of this Mac's hardware keys (`keys/identity.json`, written by `gnomon identity init`). */
export interface HardwareKeys {
  /** Key generation id (helper key tags `gnomon.<gen>.root|approvals`). */
  gen: string;
  rootPublicKeyPem: string;
  approvalsPublicKeyPem: string;
}

/* ── root ──────────────────────────────────────────────────────────────── */

export class HardwareRootAuthority implements RootAuthority {
  readonly state = 'hardware' as const;
  readonly rootKeyId: string;
  readonly ns: string;
  readonly gen: string;
  readonly #verifier: RootVerifier;
  readonly #ring = new KeyRing();
  readonly #once: HelperOnceSync | null;
  readonly #helper: HelperTransport | null;

  constructor(keys: Pick<HardwareKeys, 'gen' | 'rootPublicKeyPem'>, via: { once?: HelperOnceSync; helper?: HelperTransport }) {
    const key = createPublicKey(keys.rootPublicKeyPem);
    this.#verifier = new RootVerifier(key);
    this.rootKeyId = this.#ring.addP256(key);
    this.ns = nsFromRootPublicKey(new Uint8Array(key.export({ type: 'spki', format: 'der' })));
    this.gen = keys.gen;
    this.#once = via.once ?? null;
    this.#helper = via.helper ?? null;
  }

  verifyRow(signer: string, row: unknown, sigB64: string): boolean {
    return this.#verifier.verifyRow(signer, row, sigB64);
  }

  #request(row: unknown): Record<string, unknown> {
    const kind = row && typeof row === 'object' ? String((row as { schemaVersion?: unknown; kind?: unknown }).kind ?? (row as { schemaVersion?: unknown }).schemaVersion ?? 'row') : 'row';
    const messages = [b64('row', rowMessage(row))];
    return { op: 'sign', key: 'root', gen: this.gen, mode: 'fresh', reason: withCheck(`Gnomon: sign a ${kind} row with your root key (${canonicalJson(row).length} bytes)`, messages), messages };
  }

  /** The digest the helper's prompt line will show for `row` (the CLI prints it before the touch, H3). */
  digestFor(row: unknown): string {
    return helperDigest(b64('row', rowMessage(row)));
  }

  /**
   * Sign a rotate statement for the helper (Aegis H2): the exact preimage and
   * the helper's DER signature, which a later key.create presents to the
   * helper; the P1363 form is verified here first.
   */
  async signForHelper(row: unknown): Promise<{ statement: string; sig: string }> {
    if (!this.#helper) throw new RootUnavailableError('a statement for the helper (no helper)');
    const req = this.#request(row);
    let reply: HelperReply;
    try {
      reply = await this.#helper.request(req, HELPER_SIGN_TIMEOUT_MS);
    } catch (e) {
      throw rootError(e);
    }
    this.#accept(row, reply);
    return { statement: (req.messages as string[])[0]!, sig: String((reply.sigs as string[])[0]) };
  }

  #accept(row: unknown, reply: HelperReply): { signer: string; sig: string } {
    const [sig] = sigsOf(reply, 1);
    const out = { signer: this.rootKeyId, sig: sig!.toString('base64') };
    if (!this.verifyRow(out.signer, row, out.sig)) throw new RootUnavailableError('a root signature that verifies (the helper returned one that does not)');
    return out;
  }

  /** Synchronous root signature (fresh presence; blocks while the prompt is up). The CLI path. */
  signRow(row: unknown): { signer: string; sig: string } {
    if (row === null) throw new RootUnavailableError('signing a null row');
    if (!this.#once) throw new RootUnavailableError('a synchronous root signature (no one-shot helper here; use signRowAsync)');
    try {
      return this.#accept(row, this.#once(this.#request(row), HELPER_SIGN_TIMEOUT_MS));
    } catch (e) {
      throw rootError(e);
    }
  }

  /**
   * #provisioner (I1): one fresh-presence root signature through the long-lived helper, returning the
   * helper's own prompt line (`shown`, the dialog's last line) so the caller can check it named the digest
   * it showed, plus the exact preimage and the helper's DER signature (a rotate statement needs both).
   */
  async signRowShown(row: unknown): Promise<{ signer: string; sig: string; shown: unknown; statement: string; helperSig: string }> {
    if (!this.#helper) throw new RootUnavailableError('a root signature with its prompt line (no helper)');
    const req = this.#request(row);
    let reply: HelperReply;
    try {
      reply = await this.#helper.request(req, HELPER_SIGN_TIMEOUT_MS);
    } catch (e) {
      throw rootError(e);
    }
    const out = this.#accept(row, reply);
    return { ...out, shown: reply.shown, statement: (req.messages as string[])[0]!, helperSig: String((reply.sigs as string[])[0]) };
  }

  async signRowAsync(row: unknown): Promise<{ signer: string; sig: string }> {
    if (!this.#helper) return this.signRow(row);
    try {
      return this.#accept(row, await this.#helper.request(this.#request(row), HELPER_SIGN_TIMEOUT_MS));
    } catch (e) {
      throw rootError(e);
    }
  }
}

function rootError(e: unknown): Error {
  if (e instanceof RootUnavailableError) return e;
  if (e instanceof HelperRefusal) return new RootUnavailableError(`the root key (helper: ${e.code})`);
  if (e instanceof HelperUnavailableError) return new RootUnavailableError(`the root key (helper ${e.reason})`);
  return new RootUnavailableError('the root key');
}

/* ── approvals ─────────────────────────────────────────────────────────── */

export interface DecisionSignRequest {
  connId: string;
  /**
   * F5 (TD-2026-10-20-086): the key the helper holds the cached unlock under (the GUI device's `udev:` key, broker
   * unlockKeyOf); absent = connId. The presence challenge stays bound to the real connId.
   */
  unlockKey?: string;
  approver: string;
  /** approveMessage(cardId, decision, contentHash, approver) */
  message: string;
  mode: 'fresh' | 'cached';
  /** fresh: the kernel-composed prompt text */
  prompt?: string;
  /** fresh: keep the evaluated context as this connection's cached unlock (in the helper) */
  keepUnlock?: boolean;
  /** fresh: the presence token to mint in the same touch */
  presence?: { purpose: PresencePurpose; binding: PresenceBinding };
}

export interface DecisionSignResult {
  decisionSig: string;
  token: PresenceToken | null;
  kept: boolean;
  /** F4: helper 1.7.0's unlock bounds on a kept sign ({idleSeconds, absoluteSeconds, maxSignatures}); absent from 1.6.0 */
  bounds?: unknown;
}

/**
 * TD-2026-10-20-514: ONE helper request (`decision.sign`, helper >= 1.8.0) for a whole card decision: the approvals
 * messages (decisionSig + the presence challenge) and every root row, under one fresh presence.
 */
export interface DecisionBatchRequest {
  connId: string;
  approver: string;
  /** decisionMessage(...); absent = the root-only form (a client-supplied decisionSig) */
  message?: string;
  /** the kernel-composed prompt text (the helper caps it, AFTER its own line) */
  prompt: string;
  /** the presence token to mint in the same touch */
  presence?: { purpose: PresencePurpose; binding: PresenceBinding };
  /** [the gnomon-root-decision:v2 row, ...the rows the commit writes] */
  rows: readonly object[];
  /** the card's detail.rootRows: what rowsDigest commits to (sent as `intent`) */
  intent: readonly unknown[];
  /** the PINNED root key: every root signature is verified against it before it is returned */
  root: { readonly rootKeyId: string | null; verifyRow(signer: string, row: unknown, sigB64: string): boolean };
}

export interface DecisionBatchResult {
  decisionSig: string | null;
  token: PresenceToken | null;
  /** one per request row, in order (rootSigs[0] is the decision row's) */
  rootSigs: Array<{ signer: string; sig: string }>;
  /** the helper's own dialog line, byte-equal to the kernel's rebuild */
  shown: string;
}

/** Thrown by signDecision when the human declined (FORBIDDEN presence). */
export class HardwarePresenceDenied extends Error {
  constructor(readonly why: string) {
    super(`#identity: presence was not proved (${why})`);
    this.name = 'HardwarePresenceDenied';
  }
}

/** Thrown by a cached signDecision when the helper holds no unlock for the connection (exited, idle, screen lock). */
export class HelperUnlockGone extends Error {
  constructor() {
    super('#identity: the helper holds no unlock for this connection');
    this.name = 'HelperUnlockGone';
  }
}

export class HelperApprovalsKey {
  readonly keyId: string;
  readonly principalId: string;
  readonly gen: string;
  readonly #ring = new KeyRing();
  readonly #helper: HelperTransport;

  /** `principalId` = the human the approvals key belongs to (its root-signed registry row). */
  constructor(keys: Pick<HardwareKeys, 'gen' | 'approvalsPublicKeyPem'>, principalId: string, helper: HelperTransport) {
    this.keyId = this.#ring.addP256(keys.approvalsPublicKeyPem);
    this.principalId = principalId;
    this.gen = keys.gen;
    this.#helper = helper;
  }

  available(): boolean {
    return this.#helper.alive;
  }

  /** ApprovalsKey.verify: only this key, only for its human. */
  verify(approver: string, message: string, sigB64: string): 'ok' | 'bad' | 'unavailable' {
    if (approver !== this.principalId || typeof sigB64 !== 'string') return 'bad';
    return this.#ring.verify(this.keyId, 'approve', message, Buffer.from(sigB64, 'base64')) === 'ok' ? 'ok' : 'bad';
  }

  /** The helper signs the decision after presence (fresh) or under the connection's unlock (cached). */
  async signDecision(req: DecisionSignRequest): Promise<DecisionSignResult> {
    if (req.approver !== this.principalId) throw new HardwarePresenceDenied('the approver is not the human this approvals key belongs to');
    const challenge = req.mode === 'fresh' && req.presence ? beginHardwarePresence(req.presence.purpose, req.presence.binding, req.connId) : null;
    const messages = [b64('approve', req.message), ...(challenge ? [b64('presence', challenge.message)] : [])];
    let reply: HelperReply;
    try {
      reply = await this.#helper.request(
        {
          op: 'sign',
          key: 'approvals',
          gen: this.gen,
          mode: req.mode,
          connId: req.unlockKey ?? req.connId,
          ...(req.mode === 'fresh' ? { reason: withCheck(req.prompt ?? 'Gnomon: approve a decision', messages), keep: req.keepUnlock === true } : {}),
          messages,
        },
        HELPER_SIGN_TIMEOUT_MS,
      );
    } catch (e) {
      if (challenge) completeHardwarePresence(challenge.challengeId, this.keyId, new Uint8Array(0), this.#ring); // burn the challenge
      if (e instanceof HelperRefusal && e.code === 'no-unlock') throw new HelperUnlockGone();
      if (e instanceof HelperRefusal && e.code === 'presence-denied') throw new HardwarePresenceDenied('declined at the prompt');
      throw e;
    }
    const sigs = sigsOf(reply, messages.length);
    const decisionSig = sigs[0]!.toString('base64');
    if (this.verify(req.approver, req.message, decisionSig) !== 'ok') {
      if (challenge) completeHardwarePresence(challenge.challengeId, this.keyId, new Uint8Array(0), this.#ring);
      throw new HardwarePresenceDenied('the helper returned a decisionSig that does not verify');
    }
    let token: PresenceToken | null = null;
    if (challenge) {
      const t = completeHardwarePresence(challenge.challengeId, this.keyId, sigs[1]!, this.#ring);
      if (!PresenceToken.is(t)) throw new HardwarePresenceDenied(`presence attestation ${t}`);
      token = t;
    }
    return { decisionSig, token, kept: reply.kept === true, ...(reply.kept === true && reply.bounds !== undefined ? { bounds: reply.bounds } : {}) };
  }

  /** TD-2026-10-20-514: the running helper's version (its handshake; else one `info`). null = unknown. */
  async helperVersion(): Promise<string | null> {
    if (typeof this.#helper.version === 'string') return this.#helper.version;
    try {
      const r = await this.#helper.request({ op: 'info' }, HELPER_OP_TIMEOUT_MS);
      return typeof r.version === 'string' ? r.version : null;
    } catch {
      return null;
    }
  }

  /** Does the helper take `decision.sign` (>= 1.8.0)? The path is chosen from info.version ONLY (Aegis C6). */
  async decisionBatchAvailable(): Promise<boolean> {
    return versionAtLeast(await this.helperVersion(), DECISION_HELPER_VERSION);
  }

  /**
   * TD-2026-10-20-514: ONE fresh presence signs the whole decision (helper `decision.sign`). The batch is checked here
   * first by the same rules the helper enforces (decision-batch.ts), so a bad batch never prompts; then EVERY
   * signature is verified against the pinned keys and `shown` is compared byte-exact with the kernel's rebuild of the
   * helper's line (Aegis C2). Any mismatch burns the presence challenge and throws: nothing is returned half-checked.
   */
  async signDecisionBatch(req: DecisionBatchRequest): Promise<DecisionBatchResult> {
    if (req.approver !== this.principalId) throw new HardwarePresenceDenied('the approver is not the human this approvals key belongs to');
    if (req.root.rootKeyId === null) throw new RootUnavailableError('a decision batch (no root key)');
    const challenge = req.presence ? beginHardwarePresence(req.presence.purpose, req.presence.binding, req.connId) : null;
    const burn = (): void => {
      if (challenge) completeHardwarePresence(challenge.challengeId, this.keyId, new Uint8Array(0), this.#ring);
    };
    const approvals = [...(req.message !== undefined ? [b64('approve', req.message)] : []), ...(challenge ? [b64('presence', challenge.message)] : [])];
    const root = req.rows.map((r) => b64('row', rowMessage(r)));
    const intent = intentBytes(req.intent);
    let expected: string;
    try {
      expected = checkDecisionBatch(approvals.map((m) => Buffer.from(m, 'base64')), root.map((m) => Buffer.from(m, 'base64')), intent).line;
    } catch (e) {
      burn();
      throw e instanceof BatchRefusal ? new HardwarePresenceDenied(`the decision batch is refused before any prompt (${e.why})`) : e;
    }
    let reply: HelperReply;
    try {
      reply = await this.#helper.request(
        { op: 'decision.sign', gen: this.gen, connId: req.connId, reason: clampReason(req.prompt), approvals, root, intent: intent.toString('base64') },
        HELPER_SIGN_TIMEOUT_MS,
      );
    } catch (e) {
      burn();
      if (e instanceof HelperRefusal && e.code === 'presence-denied') throw new HardwarePresenceDenied('declined at the prompt');
      throw e;
    }
    try {
      const aSigs = sigsOf(reply, approvals.length, 'approvalSigs');
      const rSigs = sigsOf(reply, root.length, 'rootSigs');
      if (reply.shown !== expected) throw new HardwarePresenceDenied('the helper showed another line than the one this decision signs');
      let decisionSig: string | null = null;
      if (req.message !== undefined) {
        decisionSig = aSigs[0]!.toString('base64');
        if (this.verify(req.approver, req.message, decisionSig) !== 'ok') throw new HardwarePresenceDenied('the helper returned a decisionSig that does not verify');
      }
      const rootSigs = req.rows.map((row, i) => {
        const out = { signer: req.root.rootKeyId!, sig: rSigs[i]!.toString('base64') };
        if (!req.root.verifyRow(out.signer, row, out.sig)) throw new HardwarePresenceDenied('the helper returned a root signature that does not verify');
        return out;
      });
      let token: PresenceToken | null = null;
      if (challenge) {
        const t = completeHardwarePresence(challenge.challengeId, this.keyId, aSigs[approvals.length - 1]!, this.#ring);
        if (!PresenceToken.is(t)) throw new HardwarePresenceDenied(`presence attestation ${t}`);
        token = t;
      }
      return { decisionSig, token, rootSigs, shown: expected };
    } catch (e) {
      burn(); // no-op once completed
      throw e instanceof HelperUnavailableError ? new HardwarePresenceDenied(e.message) : e;
    }
  }

  /**
   * Drop a connection's unlock in the helper (idle, expired, exhausted, closed, failed). Never throws.
   * T-2026-10-18-028 M3: no longer best-effort. A drop the helper does not answer escalates to
   * `unlock.drop-all`, and if THAT fails the helper process is ended (recycle, else close): its unlocks die with the process
   * (EOF on stdin, main.swift), and the broker drops its own on the exit (helperExited). Fail closed:
   * the cost is a fresh prompt on every connection, never a live unlock the kernel lost track of.
   */
  async dropUnlock(connId: string): Promise<void> {
    if (!(this.#helper.running ?? this.#helper.alive)) return; // no process, no unlocks (and never start one just to drop)
    try {
      await this.#helper.request({ op: 'unlock.drop', connId });
      return;
    } catch {
      /* escalate */
    }
    try {
      await this.#helper.request({ op: 'unlock.drop-all' });
      return;
    } catch {
      /* escalate */
    }
    await (this.#helper.recycle ? this.#helper.recycle() : this.#helper.close()).catch(() => undefined);
  }

  /**
   * A connection closed (protocol v2 `conn.close`): the helper drops its cached unlock AND closes every
   * voice arm naming it (§14.7). Never throws; escalates like dropUnlock (drop-all + close-all, then end
   * the process), so a closed connection never leaves a live arm behind.
   */
  async connectionClosed(connId: string): Promise<void> {
    if (!(this.#helper.running ?? this.#helper.alive)) return;
    try {
      await this.#helper.request({ op: 'conn.close', connId });
      return;
    } catch {
      /* escalate */
    }
    try {
      await this.#helper.request({ op: 'unlock.drop-all' });
      await this.#helper.request({ op: 'arm.close-all' });
      return;
    } catch {
      /* escalate */
    }
    await (this.#helper.recycle ? this.#helper.recycle() : this.#helper.close()).catch(() => undefined);
  }

  /**
   * Open a voice arm (§14.7, S29-K5): ONE fresh presence prompt, bound by the helper to {humanConnId,
   * voiceConnId}; the evaluated context stays in the helper keyed by armId. `messages` are signed in the
   * same touch under the FRESH approvals domains (the voice-arm card decision; G-BRK-06: never the voice
   * domain). Throws HardwarePresenceDenied on a declined prompt, HelperRefusal otherwise (arm-exists,
   * arm-limit, arm-invalidated: the session locked during the prompt).
   */
  async openArm(req: { armId: string; humanConnId: string; voiceConnId: string; hardSeconds: number; idleSeconds?: number; maxSignatures?: number; prompt: string; messages: string[] }): Promise<{ sigs: Buffer[]; shown: unknown }> {
    const messages = req.messages.map((m) => b64('approve', m));
    let reply: HelperReply;
    try {
      reply = await this.#helper.request(
        {
          op: 'arm.open',
          armId: req.armId,
          gen: this.gen,
          humanConnId: req.humanConnId,
          voiceConnId: req.voiceConnId,
          hardSeconds: req.hardSeconds,
          ...(req.idleSeconds !== undefined ? { idleSeconds: req.idleSeconds } : {}),
          ...(req.maxSignatures !== undefined ? { maxSignatures: req.maxSignatures } : {}),
          reason: withCheck(req.prompt, messages),
          messages,
        },
        HELPER_SIGN_TIMEOUT_MS,
      );
    } catch (e) {
      if (e instanceof HelperRefusal && e.code === 'presence-denied') throw new HardwarePresenceDenied('declined at the prompt');
      throw e;
    }
    const sigs = sigsOf(reply, messages.length);
    req.messages.forEach((m, i) => {
      if (this.verify(this.principalId, m, sigs[i]!.toString('base64')) !== 'ok') throw new HardwarePresenceDenied('the helper returned an arm signature that does not verify');
    });
    return { sigs, shown: reply.shown };
  }

  /** Sign voice decisions under a live arm (domain `gnomon:approve-voice:v1` ONLY, G-BRK-06). Each signature is verified before use. */
  async signUnderArm(req: { armId: string; humanConnId: string; voiceConnId: string; messages: string[] }): Promise<Buffer[]> {
    const messages = req.messages.map((m) => b64('approveVoice', m));
    const reply = await this.#helper.request({ op: 'arm.sign', armId: req.armId, gen: this.gen, humanConnId: req.humanConnId, voiceConnId: req.voiceConnId, messages });
    const sigs = sigsOf(reply, messages.length);
    req.messages.forEach((m, i) => {
      if (this.#ring.verify(this.keyId, 'approveVoice', m, sigs[i]!) !== 'ok') throw new HardwarePresenceDenied('the helper returned a voice signature that does not verify');
    });
    return sigs;
  }

  /** Close one arm in the helper. Never throws: a close the helper does not answer escalates to ending the process. */
  async closeArm(armId: string): Promise<void> {
    if (!(this.#helper.running ?? this.#helper.alive)) return;
    try {
      await this.#helper.request({ op: 'arm.close', armId });
      return;
    } catch {
      /* escalate */
    }
    await (this.#helper.recycle ? this.#helper.recycle() : this.#helper.close()).catch(() => undefined);
  }

  /** Close every arm in the helper (never throws; escalates like closeArm). */
  async closeAllArms(): Promise<void> {
    if (!(this.#helper.running ?? this.#helper.alive)) return;
    try {
      await this.#helper.request({ op: 'arm.close-all' });
      return;
    } catch {
      /* escalate */
    }
    await (this.#helper.recycle ? this.#helper.recycle() : this.#helper.close()).catch(() => undefined);
  }

  /** A helper exit drops every unlock and every arm (§3.1 failure modes, S29-K5). */
  onHelperExit(cb: () => void): void {
    this.#helper.onExit(cb);
  }

  /** Protocol v2: the helper's session observer ended every arm and unlock (lock, sleep, user switch). */
  onHelperPush(cb: (p: HelperPush) => void): void {
    this.#helper.onPush?.(cb);
  }

  /** Fresh presence for a non-decision purpose (challenge only). */
  async provePresence(purpose: PresencePurpose, binding: PresenceBinding, connId: string, prompt: string): Promise<PresenceToken> {
    const c = beginHardwarePresence(purpose, binding, connId);
    let reply: HelperReply;
    try {
      const messages = [b64('presence', c.message)];
      reply = await this.#helper.request({ op: 'sign', key: 'approvals', gen: this.gen, mode: 'fresh', connId, reason: withCheck(prompt, messages), keep: false, messages }, HELPER_SIGN_TIMEOUT_MS);
    } catch (e) {
      completeHardwarePresence(c.challengeId, this.keyId, new Uint8Array(0), this.#ring);
      if (e instanceof HelperRefusal && e.code === 'presence-denied') throw new HardwarePresenceDenied('declined at the prompt');
      throw e;
    }
    const t = completeHardwarePresence(c.challengeId, this.keyId, sigsOf(reply, 1)[0]!, this.#ring);
    if (!PresenceToken.is(t)) throw new HardwarePresenceDenied(`presence attestation ${t}`);
    return t;
  }
}

/** p256KeyId of a PEM (identity.json readers). */
export function p256KeyIdOfPem(pem: string): string {
  return p256KeyId(createPublicKey(pem));
}
