/**
 * @symbol $daemon-lifecycle
 *
 * $daemon-lifecycle (spec §2.4) — the lifecycle's local refusal error.
 *
 * A local, minimal shape on purpose: `refusal:v1` is being rewritten in
 * @a-company/gnomon-contracts in parallel (PR-3), so PR-5 does not import it.
 * M1.4 maps these reasons onto `refusal:v1` when the socket ABI lands.
 */
export type LifecycleRefusalReason =
  | 'already-running'
  | 'lock-race'
  | 'unsafe-home'
  | 'no-safe-endpoint'
  | 'endpoint-busy'
  | 'endpoint-acl'
  | 'quarantine-pending';

export class LifecycleRefusal extends Error {
  readonly reason: LifecycleRefusalReason;
  readonly detail: Readonly<Record<string, unknown>>;

  constructor(reason: LifecycleRefusalReason, message: string, detail: Record<string, unknown> = {}) {
    super(`gnomond: ${message}`);
    this.name = 'LifecycleRefusal';
    this.reason = reason;
    this.detail = Object.freeze({ ...detail });
  }
}

export function isLifecycleRefusal(err: unknown): err is LifecycleRefusal {
  return err instanceof LifecycleRefusal;
}
