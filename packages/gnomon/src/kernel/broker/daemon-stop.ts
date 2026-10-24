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
 *     pending gets the SAME card (no stacked Touch ID prompts). A request that
 *     arrives while the first is still being raised shares that in-flight raise
 *     (Aegis L5), so two at the same moment also get one card.
 *   - accept → `onAccept(reason)` runs on the next turn of the event loop, so
 *     the approve reply leaves before the kernel closes its socket.
 *   - reject, or expiry (DAEMON_STOP_TIMEOUT_MS, into deny): nothing happens;
 *     the kernel keeps running.
 *
 * `reason` is carried in the card's detail (inside contentHash, so the human
 * approves the reason they saw) and handed to `onAccept`. `stop` (B0) and
 * `upgrade` (B1, the §2.4 rule 11 drain: the daemon drains every session and
 * then exits with reason `upgrade`) ride the same path; each has its own card
 * lines, so the human sees which one they are approving.
 */
import { DAEMON_STOP_REASONS as WIRE_REASONS, type CardV1, type DaemonStopReasonValue } from '@a-company/gnomon-contracts';
import { fail, type ApprovalBroker } from './broker.js';

/** Why the kernel is asked to stop: `stop`, or `upgrade` (drain and resume, §2.4 rule 11; B1). The wire's closed set. */
export type DaemonStopReason = DaemonStopReasonValue;
export const DAEMON_STOP_REASONS: readonly DaemonStopReason[] = WIRE_REASONS;

/** A daemon-stop card nobody decides expires into deny after this long; the kernel keeps running. */
export const DAEMON_STOP_TIMEOUT_MS = 2 * 60_000;

/**
 * TD-2026-10-19-063 (self-update pickup): the card the KERNEL raises itself when #update-watch sees a new build
 * stamp lives this long (it waits for the human; expiry is deny: the old kernel keeps running).
 */
export const UPGRADE_CARD_TIMEOUT_MS = 24 * 60 * 60_000;

/** Who decided the accept (the broker's effect ctx): the GUI connection a resume token is bound to. */
export interface DaemonStopAccept {
  connId: string;
}

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
  upgrade: [
    'Stop the Gnomon kernel (gnomond) on this home for an UPGRADE',
    'No new turn starts; each Claude session finishes its turn, a turn still running at the deadline is interrupted',
    'Each Claude session is saved for the new kernel to resume, then stopped; its pending cards expire',
    'Accept needs Touch ID; reject or no answer keeps it running',
  ],
});

export class DaemonStopCards {
  readonly #broker: ApprovalBroker;
  readonly #onAccept: (reason: DaemonStopReason, ctx: DaemonStopAccept) => void;
  readonly #timeoutMs: number;
  #pending: string | null = null;
  /** The reason of the pending (or raising) card: a request for a DIFFERENT reason never gets it (Aegis L2). */
  #pendingReason: DaemonStopReason | null = null;
  /** The in-flight raise (Aegis L5): concurrent requests share it, so two at once still raise ONE card. */
  #raising: Promise<CardV1> | null = null;

  constructor(broker: ApprovalBroker, onAccept: (reason: DaemonStopReason, ctx: DaemonStopAccept) => void, timeoutMs = DAEMON_STOP_TIMEOUT_MS) {
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
    const inFlight = (open && open.state === 'pending') || this.#raising !== null;
    // Aegis L2: one card at a time, and it answers ONE question — a request for another reason is refused, never
    // handed a card that would do something else (a `stop` asker must not approve an upgrade, nor the reverse)
    if (inFlight && this.#pendingReason !== reason) {
      throw fail('BAD_REQUEST', 'bad-params', `a daemon-stop card for reason '${this.#pendingReason}' is already pending; decide it first`, { pendingReason: this.#pendingReason, ...(open && open.state === 'pending' ? { cardId: open.cardId } : {}) });
    }
    if (open && open.state === 'pending') return open;
    if (this.#raising) return this.#raising;
    this.#pendingReason = reason;
    const raising = this.#broker.raise({
      kind: 'daemon-stop',
      requestedBy: asker.principal,
      attended: true,
      detail: { reason, connId: asker.connId },
      lines: [...LINES[reason], `reason: ${reason}`],
      decisions: ['accept', 'reject'],
      timeoutMs: this.#timeoutMs,
      effect: (decision, ctx) => {
        if (decision !== 'accept') return;
        setImmediate(() => this.#onAccept(reason, { connId: ctx.connId }));
      },
    });
    this.#raising = raising;
    try {
      const card = await raising;
      this.#pending = card.cardId;
      return card;
    } finally {
      this.#raising = null;
    }
  }

  /**
   * TD-2026-10-19-063: the kernel's OWN upgrade card, raised when #update-watch sees a new build stamp. It shares
   * the one-card slot (a launcher's daemon.stop{reason:'upgrade'} then gets THIS card, never a second prompt); a
   * pending `stop` card is left alone (null: the human is already deciding a stop). Expiry UPGRADE_CARD_TIMEOUT_MS.
   */
  async raiseUpgrade(kernelPrincipal: string, summary: string, timeoutMs = UPGRADE_CARD_TIMEOUT_MS): Promise<CardV1 | null> {
    const open = this.#pending ? this.#broker.card(this.#pending) : undefined;
    if ((open && open.state === 'pending') || this.#raising) return this.#pendingReason === 'upgrade' ? (open && open.state === 'pending' ? open : this.#raising) : null;
    this.#pendingReason = 'upgrade';
    const raising = this.#broker.raise({
      kind: 'daemon-stop',
      requestedBy: kernelPrincipal,
      attended: true,
      detail: { reason: 'upgrade', connId: 'kernel', update: summary },
      lines: [`Gnomon was updated: ${summary}`, 'Restart the kernel (gnomond) to run the new build', ...LINES.upgrade.slice(1), 'reason: upgrade'],
      decisions: ['accept', 'reject'],
      timeoutMs,
      effect: (decision, ctx) => {
        if (decision !== 'accept') return;
        setImmediate(() => this.#onAccept('upgrade', { connId: ctx.connId }));
      },
    });
    this.#raising = raising;
    try {
      const card = await raising;
      this.#pending = card.cardId;
      return card;
    } finally {
      this.#raising = null;
    }
  }

  /** The pending daemon-stop card id, if any. */
  pending(): string | null {
    const c = this.#pending ? this.#broker.card(this.#pending) : undefined;
    return c && c.state === 'pending' ? c.cardId : null;
  }
}
