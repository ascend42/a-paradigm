/**
 * @symbol #session-runner
 * @symbol #approval-broker
 *
 * The GUI re-pin of the claude binary (TD-2026-10-19-063, flow 1). Claude
 * Code updates itself; the pin (binary.ts) then refuses every new open with
 * `claude_binary_changed`. Instead of a stopped daemon and a typed CLI
 * confirmation, the kernel PRE-STAGES a re-pin card the human approves with
 * one Touch ID.
 *
 *   TRIGGERS  (a) the supervisor's refusal of `session.open` with
 *             claude_binary_changed (`stage`, the refusal then names the
 *             cardId); (b) a poll of the resolved claude source at
 *             REPIN_POLL_MS cadence: realpath, size and mtime (the native
 *             install's symlink moves on update). `poll` NEVER writes a pin:
 *             only the card's `allow` effect does, after presence.
 *   CARD      kind `gate-class`, decision `allow` (fresh presence: ONE
 *             prompt; a root-class `install` would cost two, the approvals
 *             key's prompt and the root key's own `mode:'fresh'` sign,
 *             identity/hardware.ts). Detail {target:'claude-binary', from,
 *             to, version, source, signer}, rendered as kernel-sanitized
 *             lines. At most one pending card per `to` sha; the card expires
 *             (into deny) after REPIN_CARD_TTL_MS; a human `deny` suppresses
 *             that sha for this kernel's life (an expiry does not).
 *   SIGNER    platform/claude-verifier.ts on the PRIVATE COPY the kernel will
 *             execute (TOCTOU), never the source. An unsigned copy, a failed
 *             verify or a team other than the expected one (or other than the
 *             previous pin's) sets the `claim-mismatch` flag and a first line
 *             "NOT signed by the expected publisher"; the GUI focuses Deny.
 *   EFFECT    allow ⇒ the copy is re-hashed and repinClaudeBinary writes the
 *             pin with the copy's identity, the signer and the approval record
 *             {cardId, contentHash, decisionSig}. The supervisor logs
 *             `session.sandbox{phase:'binary-pin', by:'repin', from, to,
 *             cardId}` at the next open. Old `claude-<sha>` copies stay: a
 *             live session keeps executing its own (respawns keep their spawn
 *             sha, preflight.ts), so nothing here deletes one.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CardFlag, CardV1 } from '@a-company/gnomon-contracts';
import type { ApprovalBroker } from '../broker/broker.js';
import { CLAUDE_EXPECTED_PUBLISHER, CLAUDE_EXPECTED_TEAM, type PlatformClaudeVerifier } from '../../platform/claude-verifier.js';
import { binaryKind, readClaudePin, repinClaudeBinary, sha256File } from './binary.js';

/** Re-pin card lifetime (TTL): silence expires it into deny. */
export const REPIN_CARD_TTL_MS = 24 * 60 * 60 * 1000;
/** Poll cadence of the resolved claude source. */
export const REPIN_POLL_MS = 60_000;
/** The open refusal's `next` once a human denied the new sha (L4). */
export const REPIN_DENIED_NEXT = 're-pin denied; restart Gnomon to re-offer';

export interface RepinCardOptions {
  home: string;
  broker: Pick<ApprovalBroker, 'raise' | 'card' | 'decisionOf' | 'expire'>;
  /** the kernel principal (the card's requestedBy) */
  requestedBy: string;
  verifier: PlatformClaudeVerifier;
  /** the resolved claude source (realpath); null: none found */
  source: () => string | null;
  /** TEST RIG ONLY: accept the fake claude (a #! script) */
  allowScripts?: boolean;
}

export interface RepinDetail {
  target: 'claude-binary';
  from: string | null;
  to: string;
  version: string | null;
  source: string;
  signer: { team: string | null; verified: boolean; previous: string | null; expected: string };
}

const VERSION_IN_PATH = /(?:^|[/\\])(\d+\.\d+\.\d+)$/;

export class ClaudeRepinCards {
  readonly #o: RepinCardOptions;
  /** `to` sha → the pending card's id */
  readonly #pending = new Map<string, string>();
  /** shas a human denied */
  readonly #suppressed = new Set<string>();
  /** one stage at a time (two triggers for one update raise one card) */
  #queue: Promise<unknown> = Promise.resolve();
  #seen: string | null = null;

  constructor(o: RepinCardOptions) {
    this.#o = o;
  }

  /** The pending re-pin card, if any (the GUI's [Re-pin] focuses it). */
  pendingCardId(): string | null {
    for (const id of this.#pending.values()) if (this.#o.broker.card(id)?.state === 'pending') return id;
    return null;
  }

  /** A human denied `sha` (the open refusal then says so instead of pointing at a card). */
  denied(sha: string): boolean {
    return this.#suppressed.has(sha);
  }

  /** The supervisor hook: stage, then name the card or the denial for the refusal. */
  async onRefused(sourceReal: string, found: string | null): Promise<{ cardId: string | null; next?: string }> {
    const c = await this.stage(sourceReal);
    if (found && this.denied(found)) return { cardId: null, next: REPIN_DENIED_NEXT };
    return { cardId: c?.cardId ?? this.pendingCardId() };
  }

  /** The poll: stat the resolved source; on a change, stage. Never writes a pin. */
  poll(): Promise<CardV1 | null> {
    const real = this.#o.source();
    if (!real) return Promise.resolve(null);
    let id: string;
    try {
      const st = fs.statSync(real);
      id = `${real}|${st.size}|${st.mtimeMs}`;
    } catch {
      return Promise.resolve(null);
    }
    if (id === this.#seen) return Promise.resolve(null);
    // L4: remembered only once the stage succeeded, so a failed stage is retried at the next poll
    return this.stage(real).then((c) => {
      this.#seen = id;
      return c;
    });
  }

  /** Copy, hash and check the signer of `sourceReal`; raise a re-pin card unless pinned, pending or suppressed. */
  stage(sourceReal: string): Promise<CardV1 | null> {
    const next = this.#queue.then(() => this.#stage(sourceReal));
    this.#queue = next.catch(() => undefined);
    return next;
  }

  async #stage(sourceReal: string): Promise<CardV1 | null> {
    const pin = readClaudePin(this.#o.home);
    if (!pin) return null; // trust on first use is the open path's (commitPin), never a card's
    const dir = path.join(this.#o.home, 'bin');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = path.join(dir, `.claude-stage-${process.pid}-${Date.now()}`);
    await fs.promises.copyFile(sourceReal, tmp, fs.constants.COPYFILE_EXCL);
    await fs.promises.chmod(tmp, 0o500);
    // L1: the kind of the COPY (the bytes executed), never the source
    const kind = binaryKind(tmp);
    if (kind !== 'native' && !(kind === 'script' && this.#o.allowScripts)) {
      await fs.promises.rm(tmp, { force: true });
      return null; // the open refuses it claude_binary_unsupported
    }
    const to = await sha256File(tmp); // the bytes hashed (and signature-checked) are the bytes executed
    const prior = this.#pending.get(to);
    if (to === pin.sha256 || this.#suppressed.has(to) || (prior && this.#o.broker.card(prior)?.state === 'pending')) {
      await fs.promises.rm(tmp, { force: true });
      return prior && to !== pin.sha256 && !this.#suppressed.has(to) ? (this.#o.broker.card(prior) ?? null) : null;
    }
    const exec = path.join(dir, `claude-${to.slice(0, 32)}`);
    if (fs.existsSync(exec) && (await sha256File(exec)) === to) await fs.promises.rm(tmp, { force: true });
    else await fs.promises.rename(tmp, exec);
    const sig = this.#o.verifier.check(exec);
    const previous = pin.signer?.team ?? (pin.copy && fs.existsSync(pin.copy.path) ? this.#o.verifier.check(pin.copy.path).team : null);
    const mismatch = !sig.verified || sig.team !== CLAUDE_EXPECTED_TEAM || (previous !== null && previous !== sig.team);
    const version = VERSION_IN_PATH.exec(sourceReal)?.[1] ?? null;
    const detail: RepinDetail = { target: 'claude-binary', from: pin.sha256, to, version, source: sourceReal, signer: { team: sig.team, verified: sig.verified, previous, expected: CLAUDE_EXPECTED_TEAM } };
    const lines = [
      ...(mismatch ? [`NOT signed by the expected publisher (${CLAUDE_EXPECTED_PUBLISHER}, ${CLAUDE_EXPECTED_TEAM}).`] : []),
      'Claude Code updated itself. Re-pin the claude binary Gnomon runs?',
      `from ${pin.sha256}`,
      `to   ${to}`,
      `version ${version ?? '(not in the install path)'}`,
      `source ${sourceReal}`,
      signerLine(sig, previous, mismatch, this.#o.verifier.why),
      'allow: new sessions run the new binary; live sessions keep the one they started with.',
      'deny: nothing is pinned and this binary is not offered again until the kernel restarts.',
    ];
    const flags: CardFlag[] = mismatch ? ['claim-mismatch'] : [];
    const card = await this.#o.broker.raise({
      kind: 'gate-class',
      requestedBy: this.#o.requestedBy,
      attended: true,
      detail: detail as unknown as Record<string, unknown>,
      lines,
      flags,
      timeoutMs: REPIN_CARD_TTL_MS,
      effect: async (decision, ctx) => {
        if (decision !== 'allow') return;
        // M1: no rollback — an older card (from a pin since replaced) never pins
        if (readClaudePin(this.#o.home)?.sha256 !== detail.from) throw new Error('#session-runner: the pin moved since this re-pin card was raised');
        // TOCTOU: the copy is re-hashed right before the pin names it
        if ((await sha256File(exec)) !== to) throw new Error('#session-runner: the staged claude copy changed before the re-pin');
        const st = fs.statSync(exec);
        repinClaudeBinary(this.#o.home, to, sourceReal, {
          copy: { path: exec, size: st.size, mtimeMs: st.mtimeMs },
          signer: { team: sig.team, verified: sig.verified },
          approval: { cardId: card.cardId, contentHash: card.contentHash, ...(ctx.decisionSig ? { decisionSig: ctx.decisionSig } : {}), ...(ctx.rootSig ? { rootSig: ctx.rootSig } : {}) },
        });
        // M1: every other pending re-pin card is superseded (expired into deny, never decided). The pin is
        // already written, so a failed expire must not fail this effect (Aegis re-check): those cards would
        // fail M1's from-check anyway.
        for (const id of this.#pending.values()) {
          if (id === card.cardId || this.#o.broker.card(id)?.state !== 'pending') continue;
          try {
            await this.#o.broker.expire(id, 'cancelled');
          } catch {
            // best effort; the stale card is refused by the from-check if approved later
          }
        }
      },
    });
    this.#pending.set(to, card.cardId);
    void this.#o.broker.decisionOf(card.cardId).then((d) => {
      if (d === 'deny' && this.#o.broker.card(card.cardId)?.state === 'decided') this.#suppressed.add(to);
    });
    return card;
  }
}

function signerLine(sig: { team: string | null; verified: boolean }, previous: string | null, mismatch: boolean, why: string): string {
  if (!mismatch) return `signed by ${CLAUDE_EXPECTED_PUBLISHER} (${sig.team})${previous ? ', same as before' : ''}`;
  if (!sig.team) return `signature: none that verifies (the copy ${why})`;
  return `signed by team ${sig.team}${sig.verified ? '' : ' (the signature did not verify)'}; before: ${previous ?? 'unknown'}; expected ${CLAUDE_EXPECTED_TEAM}`;
}
