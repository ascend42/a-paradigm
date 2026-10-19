/**
 * @symbol #approval-broker
 *
 * The `daemon-stop` card (spec §3.1 I3, §2.4 rule 11; founder ruling F3 of
 * TD-2026-10-19-528, T-2026-10-19-014 slice B0). `gnomon daemon stop` never
 * stops the kernel by itself: the kernel raises a signed `daemon-stop` card and
 * stops only when the human accepts it with FRESH presence (Touch ID). The
 * class table (classes.ts) makes both `accept` and `reject` fresh, so a cached
 * unlock never decides it.
 *
 *   - Only a human principal on a verified device connection may ask
 *     (credential `device`). An agent, session, mod, voice, read-token or peer
 *     connection, and a GUI launch-token connection, are refused
 *     FORBIDDEN{matrix} and no card is raised.
 *   - One pending daemon-stop card at a time: a second request while one is
 *     pending gets the SAME card (no stacked Touch ID prompts).
 *   - accept → `onAccept(reason)` runs on the next turn of the event loop, so
 *     the approve reply leaves before the kernel closes its socket.
 *   - reject, or expiry (DAEMON_STOP_TIMEOUT_MS, into deny): nothing happens;
 *     the kernel keeps running.
 *
 * `reason` is carried in the card's detail (inside contentHash, so the human
 * approves the reason they saw) and handed to `onAccept`. B0 raises only
 * `stop`; slice B1 adds `upgrade` (§2.4 rule 11 drain) to DaemonStopReason and
 * passes it through the same path.
 */
import type { CardV1 } from '@a-company/gnomon-contracts';
import { fail, type ApprovalBroker } from './broker.js';

/** Why the kernel is asked to stop. B1 adds 'upgrade' (drain and resume, §2.4 rule 11). */
export type DaemonStopReason = 'stop';
export const DAEMON_STOP_REASONS: readonly DaemonStopReason[] = Object.freeze(['stop'] as const);

/** A daemon-stop card nobody decides expires into deny after this long; the kernel keeps running. */
export const DAEMON_STOP_TIMEOUT_MS = 2 * 60_000;

export interface DaemonStopAsker {
  connId: string;
  principal: string | undefined;
  /** dispatch matrix class of the asking connection */
  principalClass: string;
  /** how the connection authenticated: only `device` may ask */
  credential: string | undefined;
}

const LINES: Readonly<Record<DaemonStopReason, readonly string[]>> = Object.freeze({
  stop: ['Stop the Gnomon kernel (gnomond) on this home', 'Every running session and mod child is stopped first', 'Accept needs Touch ID; reject or no answer keeps it running'],
});

export class DaemonStopCards {
  readonly #broker: ApprovalBroker;
  readonly #onAccept: (reason: DaemonStopReason) => void;
  readonly #timeoutMs: number;
  #pending: string | null = null;

  constructor(broker: ApprovalBroker, onAccept: (reason: DaemonStopReason) => void, timeoutMs = DAEMON_STOP_TIMEOUT_MS) {
    this.#broker = broker;
    this.#onAccept = onAccept;
    this.#timeoutMs = timeoutMs;
  }

  /** Raise (or return the pending) daemon-stop card for a verified human device connection. */
  async request(asker: DaemonStopAsker, reason: DaemonStopReason = 'stop'): Promise<CardV1> {
    if (asker.principalClass !== 'human' || asker.credential !== 'device' || typeof asker.principal !== 'string') {
      throw fail('FORBIDDEN', 'matrix', `daemon stop is asked only by a human on a verified device connection (§3.1 I3); this ${asker.principalClass} connection never asks`, { verb: 'daemon stop' });
    }
    if (!DAEMON_STOP_REASONS.includes(reason)) throw fail('BAD_REQUEST', 'bad-params', `reason must be one of ${DAEMON_STOP_REASONS.join(', ')}`);
    const open = this.#pending ? this.#broker.card(this.#pending) : undefined;
    if (open && open.state === 'pending') return open;
    const card = await this.#broker.raise({
      kind: 'daemon-stop',
      requestedBy: asker.principal,
      attended: true,
      detail: { reason, connId: asker.connId },
      lines: [...LINES[reason], `reason: ${reason}`],
      decisions: ['accept', 'reject'],
      timeoutMs: this.#timeoutMs,
      effect: (decision) => {
        if (decision !== 'accept') return;
        setImmediate(() => this.#onAccept(reason));
      },
    });
    this.#pending = card.cardId;
    return card;
  }

  /** The pending daemon-stop card id, if any. */
  pending(): string | null {
    const c = this.#pending ? this.#broker.card(this.#pending) : undefined;
    return c && c.state === 'pending' ? c.cardId : null;
  }
}
