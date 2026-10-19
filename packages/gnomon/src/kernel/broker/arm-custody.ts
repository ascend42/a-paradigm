/**
 * @symbol #approval-broker
 *
 * #approval-broker voice-arm REFERENCES (spec §14.7 Arms, S29-K5, S26-C3 /
 * A26-01 / A26-03; helper 1.6.0, V5 of TD-2026-10-19-194). The arm's unlock
 * lives in the helper keyed by `armId`; the kernel keeps only the reference
 * `{armId, humanConnId, voiceConnId}`. V5 scope: the custody bridge. The
 * arm record proper (class, repos, idle/hard/decision counts, the voice-arm
 * card) is V7.
 *
 * Disarm (`approval.voice.disarm{armId, reason, cause?}`, one row per arm the
 * kernel holds, appended by the broker's kernel-signed log; reasons from the
 * closed contracts VOICE_DISARM_REASONS):
 *   - helper push (protocol v2): the helper ALREADY invalidated every arm; the
 *     kernel ends EVERY arm it references, whatever the push lists (fail
 *     closed). reason per SESSION_DISARM_REASON, `cause` = the push's cause
 *     (Aegis L3, the same field approval.unlock.dropped carries);
 *   - helper exit (EOF / crash): reason `helper-exit` (S29-K5);
 *   - a connection of the pair closed: reason `conn-closed`.
 */
import type { VoiceDisarmReason } from '@a-company/gnomon-contracts';
import type { HelperPush, HelperSessionCause } from '../identity/helper.js';
import type { BrokerLog } from './broker.js';

export const DISARM_REASON_HELPER_EXIT = 'helper-exit' satisfies VoiceDisarmReason;
export const DISARM_REASON_CONN_CLOSED = 'conn-closed' satisfies VoiceDisarmReason;
/** Helper session cause → reserved disarm reason (V0 reserved the distinct ones; a screensaver counts as a lock). */
export const SESSION_DISARM_REASON: Readonly<Record<HelperSessionCause, VoiceDisarmReason>> = Object.freeze({
  'screen-lock': 'screen-lock',
  screensaver: 'screen-lock',
  'display-sleep': 'display-sleep',
  'system-sleep': 'system-sleep',
  'user-switch': 'user-switch',
});

export interface ArmRef {
  armId: string;
  humanConnId: string;
  voiceConnId: string;
}

/** What the custody needs of the helper-held approvals key (HelperApprovalsKey). */
export interface ArmKey {
  closeArm(armId: string): Promise<void>;
}

export class VoiceArmCustody {
  readonly #arms = new Map<string, ArmRef>();
  readonly #log: BrokerLog;
  readonly #key: ArmKey | null;

  constructor(log: BrokerLog, key: ArmKey | null = null) {
    this.#log = log;
    this.#key = key;
  }

  /** Record a reference after the helper's arm.open succeeded. */
  opened(ref: ArmRef): void {
    this.#arms.set(ref.armId, { ...ref });
  }

  armIds(): string[] {
    return [...this.#arms.keys()].sort();
  }

  has(armId: string): boolean {
    return this.#arms.has(armId);
  }

  async #disarm(ids: string[], reason: VoiceDisarmReason, cause?: string): Promise<void> {
    for (const armId of ids) {
      if (!this.#arms.delete(armId)) continue;
      await this.#log('approval.voice.disarm', { armId, reason, ...(cause ? { cause } : {}) }).catch(() => undefined);
    }
  }

  /** A protocol-v2 session push: every arm ends (the helper already invalidated them). */
  async helperPushed(p: HelperPush): Promise<void> {
    await this.#disarm(this.armIds(), SESSION_DISARM_REASON[p.cause], p.cause);
  }

  /** The helper exited: every arm's unlock is gone with it (S29-K5). */
  async helperExited(): Promise<void> {
    await this.#disarm(this.armIds(), DISARM_REASON_HELPER_EXIT);
  }

  /** A connection closed: every arm naming it ends (the helper's conn.close closes its side). */
  async connectionClosed(connId: string): Promise<void> {
    const ids = [...this.#arms.values()].filter((a) => a.humanConnId === connId || a.voiceConnId === connId).map((a) => a.armId);
    await this.#disarm(ids, DISARM_REASON_CONN_CLOSED);
  }

  /** An explicit disarm (V7 callers: phrase, GUI, policy change): closes the helper side, then logs. */
  async disarm(armId: string, reason: VoiceDisarmReason): Promise<void> {
    if (!this.#arms.has(armId)) return;
    await this.#key?.closeArm(armId);
    await this.#disarm([armId], reason);
  }
}
