/**
 * @symbol #gui-setup
 *
 * #gui-setup state machine (spec §11.1, §11.2 rule 11; T-2026-10-19-005
 * MVP-b) over the closed `gnomon-setup:v1` protocol of the #setup-endpoint:
 *
 *   welcome → preflight (rows; purge leftovers; an already-set-up home:
 *   Finish setup / Start Gnomon) → name → identity (1 of 2, 2 of 2) →
 *   success → handoff        (a closed socket or a failed handshake → aborted)
 *
 * The screens are the COMPLETE path (no dead end that needs `--cli`): a
 * refused or cancelled purge, a failed begin or completion return to the
 * checks with a notice (a failed begin's leftover generation is listed there
 * with its Delete button). The page sends ONLY a name, a gen the kernel
 * itself listed, and clicks. The hello is verified against the fragment
 * setup key BEFORE auth (verifyServerSig, as the launch path) and that key
 * is NEVER stored as the kernel pin (no localStorage here).
 */
import { SETUP_API, SETUP_API_ID } from '@a-company/gnomon-contracts';
import type { HelloResult } from '@a-company/gnomon-contracts';
import { RpcError } from '../core/client.js';
import { newClientNonce, verifyServerSig } from '../core/server-sig.js';
import { DIGEST12 } from './digest.js';

export type SetupPhase = 'connecting' | 'welcome' | 'preflight' | 'name' | 'identity' | 'success' | 'handoff' | 'aborted';
export interface Check {
  id: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  fix?: string;
}
export interface Presence {
  n: number;
  of: number;
  purpose: string;
  digest12: string | null;
  key?: string;
  gen?: string;
}
export interface SetupState {
  phase: SetupPhase;
  checks: Check[];
  leftover: string[];
  ok: boolean;
  existing: { rootKeyId: string; createdAt: string; registered: boolean } | null;
  defaultName: string;
  name: string | null;
  nameError: string | null;
  presence: Presence | null;
  busy: boolean;
  /** a recoverable refusal shown on the checks screen (setup goes on) */
  notice: string | null;
  result: { rootKeyId: string; principalId: string; deviceId: string; files: string[] } | null;
  error: { reason: string; message: string } | null;
  surface: 'browser' | 'wrapper';
}

/** What the flow needs from a connection (GnomonClient fits; tests pass a fake). */
export interface SetupClient {
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
  onNotification(fn: (method: string, params: unknown) => void): () => void;
  onClose(fn: (code: number) => void): () => void;
}

export function initialState(surface: 'browser' | 'wrapper'): SetupState {
  return { phase: 'connecting', checks: [], leftover: [], ok: false, existing: null, defaultName: '', name: null, nameError: null, presence: null, busy: false, notice: null, result: null, error: null, surface };
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** Keep only well-formed check rows (the kernel's; anything else is dropped, never rendered raw). */
export function checksOf(v: unknown): Check[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((c): c is Record<string, unknown> => typeof c === 'object' && c !== null)
    .filter((c) => c.status === 'pass' || c.status === 'warn' || c.status === 'fail')
    .map((c) => ({ id: str(c.id), status: c.status as Check['status'], detail: str(c.detail), ...(typeof c.fix === 'string' ? { fix: c.fix } : {}) }));
}

export function presenceOf(v: unknown): Presence | null {
  if (typeof v !== 'object' || v === null) return null;
  const p = v as Record<string, unknown>;
  if (typeof p.n !== 'number' || typeof p.of !== 'number' || typeof p.purpose !== 'string') return null;
  const d = p.digest12 === null ? null : typeof p.digest12 === 'string' && DIGEST12.test(p.digest12) ? p.digest12 : undefined;
  if (d === undefined) return null; // a malformed digest is never shown
  return { n: p.n, of: p.of, purpose: p.purpose, digest12: d, ...(typeof p.key === 'string' ? { key: p.key } : {}), ...(typeof p.gen === 'string' ? { gen: p.gen } : {}) };
}

const refusalOf = (e: unknown): { reason: string; message: string; data: Record<string, unknown> } =>
  e instanceof RpcError
    ? { reason: e.refusal.reason ?? 'error', message: e.refusal.message, data: (e.refusal.data ?? {}) as Record<string, unknown> }
    : { reason: 'error', message: e instanceof Error ? e.message : 'setup failed', data: {} };

export class SetupFlow {
  state: SetupState;
  readonly #c: SetupClient;
  readonly #render: (s: SetupState) => void;

  constructor(c: SetupClient, surface: 'browser' | 'wrapper', render: (s: SetupState) => void) {
    this.#c = c;
    this.#render = render;
    this.state = initialState(surface);
    c.onNotification((m, p) => {
      if (m === 'setup.presence') {
        const pr = presenceOf(p);
        if (pr) this.#set({ presence: pr });
      }
    });
    c.onClose(() => {
      if (this.state.phase !== 'handoff' && this.state.phase !== 'aborted') this.#set({ phase: 'aborted', busy: false, error: { reason: 'socket-closed', message: 'the setup connection closed, so setup was cancelled. Start it again.' } });
    });
  }

  #set(p: Partial<SetupState>): void {
    this.state = { ...this.state, ...p };
    this.#render(this.state);
  }

  #fail(e: unknown): void {
    const r = refusalOf(e);
    this.#set({ phase: 'aborted', busy: false, error: { reason: r.reason, message: r.message } });
  }

  /** A refusal setup survives: back to the checks (re-run, so a left-over generation shows its Delete button). */
  async #recover(e: unknown, what: string): Promise<void> {
    const r = refusalOf(e);
    // final refusals end setup (Aegis L-A: a wrong helper line, one prompt too many, the attempt cap)
    if (r.reason === 'socket-closed' || r.reason === 'delivery-unknown' || r.reason === 'setup-stopped' || r.data.final === true) return this.#set({ phase: 'aborted', busy: false, presence: null, error: { reason: r.reason, message: `setup was stopped: ${r.message}` } });
    const gen = typeof r.data.leftoverGen === 'string' ? r.data.leftoverGen : null;
    const retry = what === 'Setup' ? ' If you try again, this retry shows 2 NEW codes.' : '';
    const notice = `${what} did not finish: ${r.message}.${gen ? ` Keys of generation ${gen} were left in the Secure Enclave: delete them below, then try again.` : ''}${retry}`;
    this.#set({ busy: false, presence: null, phase: 'preflight', notice });
    await this.preflight(notice);
  }

  /** hello (verified against the fragment setup key, never pinned) → auth {setupToken} → welcome. */
  async connect(o: { setupToken: string; setupPublicKey: string; endpointPath: string; subtle: SubtleCrypto | undefined; clientNonce?: string }): Promise<void> {
    try {
      const clientNonce = o.clientNonce ?? newClientNonce();
      const hello = await this.#c.call<HelloResult & { setupApiId?: string }>('hello', { clientApis: [SETUP_API], features: [], clientNonce, client: { name: 'gnomon-gui', version: '8.0.0', surface: this.state.surface } });
      if (hello.clientApi !== SETUP_API || hello.setupApiId !== SETUP_API_ID) return this.#set({ phase: 'aborted', error: { reason: 'setup-api', message: 'this is not the setup endpoint this page knows' } });
      const v = await verifyServerSig(o.subtle, o.setupPublicKey, hello, o.endpointPath, clientNonce);
      if (!v.ok) return this.#set({ phase: 'aborted', error: { reason: v.reason, message: 'the setup server did not prove the key in this link; close this page and start setup again' } });
      await this.#c.call('auth', { setupToken: o.setupToken });
      this.#set({ phase: 'welcome' });
    } catch (e) {
      this.#fail(e);
    }
  }

  #report(r: Record<string, unknown>): Partial<SetupState> {
    const ex = r.existing as Record<string, unknown> | null;
    return {
      checks: checksOf(r.checks),
      leftover: Array.isArray(r.leftover) ? r.leftover.filter((g): g is string => typeof g === 'string') : [],
      ok: r.ok === true,
      existing: ex && typeof ex === 'object' ? { rootKeyId: str(ex.rootKeyId), createdAt: str(ex.createdAt), registered: ex.registered === true } : null,
      defaultName: str(r.defaultName),
    };
  }

  /** Clicks only request steps. */
  async preflight(notice: string | null = null): Promise<void> {
    this.#set({ busy: true });
    try {
      const r = await this.#c.call<Record<string, unknown>>('setup.preflight', {});
      this.#set({ phase: 'preflight', busy: false, notice, ...this.#report(r) });
    } catch (e) {
      const r = refusalOf(e);
      if (r.reason === 'setup-stopped') return this.#set({ phase: 'aborted', busy: false, error: { reason: r.reason, message: r.message } });
      this.#fail(e);
    }
  }

  async purge(gen: string): Promise<void> {
    if (!this.state.leftover.includes(gen)) return; // only a gen the kernel listed
    this.#set({ busy: true, presence: null, notice: null });
    try {
      const r = await this.#c.call<Record<string, unknown>>('setup.purge', { gen });
      this.#set({ busy: false, presence: null, ...this.#report(r) });
    } catch (e) {
      await this.#recover(e, `Deleting generation ${gen}`);
    }
  }

  toName(): void {
    if (this.state.ok && this.state.leftover.length === 0 && !this.state.existing) this.#set({ phase: 'name', notice: null });
  }

  /** The name is validated server-side (setup.name); a refusal stays on the name screen. */
  async submitName(name: string): Promise<void> {
    this.#set({ busy: true, nameError: null });
    try {
      const r = await this.#c.call<{ name: string }>('setup.name', { name });
      this.#set({ busy: false, name: r.name, phase: 'identity', presence: null });
    } catch (e) {
      if (e instanceof RpcError && e.refusal.reason === 'setup-params') return this.#set({ busy: false, nameError: 'lowercase letters, digits, ".", "_" or "-", starting with a letter or digit, at most 64' });
      this.#fail(e);
    }
  }

  #result(r: Record<string, unknown>): SetupState['result'] {
    return { rootKeyId: str(r.rootKeyId), principalId: str(r.principalId), deviceId: str(r.deviceId), files: Array.isArray(r.files) ? r.files.map(str) : [] };
  }

  async begin(): Promise<void> {
    this.#set({ busy: true });
    try {
      const r = await this.#c.call<Record<string, unknown>>('setup.begin', {});
      this.#set({ busy: false, presence: null, phase: 'success', result: this.#result(r) });
    } catch (e) {
      await this.#recover(e, 'Setup');
    }
  }

  /** An interrupted earlier setup: append the row the root already signed (0 prompts). */
  async complete(): Promise<void> {
    this.#set({ busy: true, notice: null });
    try {
      const r = await this.#c.call<Record<string, unknown>>('setup.complete', {});
      this.#set({ busy: false, phase: 'success', result: this.#result(r) });
    } catch (e) {
      await this.#recover(e, 'Finishing setup');
    }
  }

  /** After success, or on a home that is already fully set up: hand off to the first session. */
  async finish(): Promise<void> {
    this.#set({ busy: true });
    try {
      await this.#c.call('setup.finish', {});
      this.#set({ busy: false, phase: 'handoff' });
    } catch (e) {
      this.#fail(e);
    }
  }
}
