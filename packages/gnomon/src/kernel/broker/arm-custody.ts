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
 * Disarm (`approval.voice.disarm{armId, reason}`, one row per arm the kernel
 * holds, appended by the broker's kernel-signed log):
 *   - helper push (protocol v2): screen lock, screensaver, display sleep,
 *     system sleep, user switch. The helper ALREADY invalidated every arm;
 *     the kernel ends EVERY arm it references, whatever the push lists
 *     (fail closed). reason `screen-lock` for every cause (founder ruling);
 *   - helper exit (EOF / crash): reason `helper-exit` (S29-K5, spec-literal);
 *   - a connection of the pair closed: reason `conn-closed`.
 */
import type { HelperPush } from '../identity/helper.js';
import type { BrokerLog } from './broker.js';

// TODO(V0 merge): import these from @a-company/gnomon-contracts VOICE_DISARM_REASONS (founder ruling, reserved on the
// V0 branch: idle hard limit conn-closed voice-conn screen-lock policy config mode-set phrase gui cli unenrolled
// daemon-exit helper-exit handle-miss challenge-miss refused-streak). Local literals until then.
export const DISARM_REASON_HELPER_EXIT = 'helper-exit' as const;
/** Every helper session cause (lock, screensaver, display sleep, system sleep, user switch) disarms as screen-lock. */
export const DISARM_REASON_SESSION = 'screen-lock' as const;
export const DISARM_REASON_CONN_CLOSED = 'conn-closed' as const;

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

  async #disarm(ids: string[], reason: string): Promise<void> {
    for (const armId of ids) {
      if (!this.#arms.delete(armId)) continue;
      await this.#log('approval.voice.disarm', { armId, reason }).catch(() => undefined);
    }
  }

  /** A protocol-v2 session push: every arm ends (the helper already invalidated them). */
  async helperPushed(p: HelperPush): Promise<void> {
    void p; // the cause is diagnostic only; every session cause maps to one reserved reason
    await this.#disarm(this.armIds(), DISARM_REASON_SESSION);
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
  async disarm(armId: string, reason: string): Promise<void> {
    if (!this.#arms.has(armId)) return;
    await this.#key?.closeArm(armId);
    await this.#disarm([armId], reason);
  }
}
