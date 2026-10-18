/**
 * @symbol $daemon-lifecycle
 *
 * $daemon-lifecycle (spec §2.4 rule 3) — idle exit. No live sessions ∧ no
 * subscribers ⇒ exit after `idleMs`. PR-5 has neither sessions nor mods nor
 * timers yet, so the holders are open #socket connections (a stand-in for
 * subscribers until M1.4 distinguishes them; a link connection will never
 * count, §3.9). M1.9: an open GUI WebSocket holds as a 'subscriber', and
 * #scheduler holds as 'timer' while a due instant is inside 10 min (the "no due
 * timers inside 10 min" clause); sessions will hold as 'session' (M1.7).
 */
export const DEFAULT_IDLE_EXIT_MS = 10 * 60_000;

export type IdleHolderKind = 'connection' | 'session' | 'subscriber' | 'timer';

export interface IdleMonitorOptions {
  idleMs: number;
  onIdle: () => void;
}

export class IdleMonitor {
  readonly idleMs: number;
  private readonly onIdle: () => void;
  private readonly held = new Map<number, IdleHolderKind>();
  private nextId = 1;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private fired = false;

  constructor(opts: IdleMonitorOptions) {
    if (!Number.isFinite(opts.idleMs) || opts.idleMs < 0) throw new RangeError('idleMs must be a non-negative number');
    this.idleMs = opts.idleMs;
    this.onIdle = opts.onIdle;
  }

  get holders(): number {
    return this.held.size;
  }

  count(kind: IdleHolderKind): number {
    let n = 0;
    for (const k of this.held.values()) if (k === kind) n++;
    return n;
  }

  get armed(): boolean {
    return this.timer !== null;
  }

  /** Begin watching; arms the timer if nothing holds the daemon. */
  start(): void {
    this.running = true;
    this.rearm();
  }

  stop(): void {
    this.running = false;
    this.disarm();
  }

  /** Hold the daemon open. The returned release is idempotent. */
  hold(kind: IdleHolderKind): () => void {
    const id = this.nextId++;
    this.held.set(id, kind);
    this.disarm();
    return () => {
      if (this.held.delete(id)) this.rearm();
    };
  }

  private disarm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private rearm(): void {
    this.disarm();
    if (!this.running || this.fired || this.held.size > 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.running || this.held.size > 0) return;
      this.fired = true;
      this.onIdle();
    }, this.idleMs);
  }
}
