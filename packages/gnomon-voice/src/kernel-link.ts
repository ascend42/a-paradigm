/**
 * @symbol #gnomon-voice
 *
 * KernelLink over the #gnomon-ts-client GnomonClient (hello → serverSig against the PINNED kernel key → device
 * auth as `p:<ns>/voice` with keys/voice.key; V1 `gnomon voice setup` writes the key and registers the device).
 *
 * The client is reached STRUCTURALLY (GnomonClientLike) through a dynamic import so this package neither bundles
 * the kernel nor needs it built to test. UNVERIFIED seams (align with the kernel owners):
 *   - `@a-company/gnomon` exports only "." today; the client lives at src/clients/ts and is not a published entry.
 *     `clientModule` defaults to '@a-company/gnomon/client' — that subpath export must be added (or pass a module).
 *   - The kernel key pin, the voice deviceId and the socket path come from the root-signed registry; no external
 *     helper resolves them yet, so they are read from a connect profile (VoiceConnectProfile JSON) for now.
 *   - log.read follow's session filter is passed as `{ session: hsid }`.
 */
import type { KernelLink, KernelRow, VoiceAttachment } from './types.js';

export interface VoiceConnectProfile {
  socketPath: string;
  endpointPath?: string;
  kernelKey: { keyId: string; publicKeyPem: string };
  principalId: string;
  deviceId: string;
  /** PKCS8 PEM of keys/voice.key */
  privateKeyPem: string;
}

export interface GnomonClientLike {
  principal?: string;
  call(method: string, params: unknown): Promise<unknown>;
  subscribe(params: Record<string, unknown>, h: { row(r: unknown): void; end?(e: { reason: string }): void }): Promise<unknown>;
  close(): Promise<void>;
}
export interface GnomonClientModuleLike {
  GnomonClient: { connect(o: Record<string, unknown>): Promise<GnomonClientLike> };
}

export const CLIENT_NAME = '@a-company/gnomon-voice' as const;

/** ns of `p:<ns>/voice` (speakerIds are `spk:<ns>/<name>`). */
export function nsOf(principalId: string): string {
  const m = /^p:([0-9a-z]{8})\/voice$/.exec(principalId);
  if (!m) throw new TypeError(`#gnomon-voice: ${principalId} is not a voice principal (p:<ns>/voice)`);
  return m[1]!;
}

/**
 * The attachment from `status.voice`. V2a shape: {attached: boolean, hsid, ceiling, voiceSessionId, since, idleAt, …}
 * (the ceiling becomes `mode`); V1 shape: {attached: {voiceSessionId, hsid, mode} | null}.
 */
export function attachmentFromStatus(status: unknown): VoiceAttachment | null {
  const v = (status as { voice?: Record<string, unknown> })?.voice;
  if (v && typeof v.attached === 'boolean') {
    if (!v.attached || typeof v.hsid !== 'string' || typeof v.voiceSessionId !== 'string' || typeof v.ceiling !== 'string') return null;
    return { hsid: v.hsid, voiceSessionId: v.voiceSessionId, mode: v.ceiling };
  }
  const a = v?.attached as Partial<VoiceAttachment> | null | undefined;
  if (!a || typeof a.hsid !== 'string' || typeof a.voiceSessionId !== 'string' || typeof a.mode !== 'string') return null;
  return { hsid: a.hsid, voiceSessionId: a.voiceSessionId, mode: a.mode };
}

export class GnomonKernelLink implements KernelLink {
  constructor(readonly client: GnomonClientLike) {}

  static async connect(p: VoiceConnectProfile, o: { version: string; clientModule?: GnomonClientModuleLike | string; timeoutMs?: number }): Promise<GnomonKernelLink> {
    const mod = typeof o.clientModule === 'object' ? o.clientModule : ((await import(o.clientModule ?? '@a-company/gnomon/client')) as GnomonClientModuleLike);
    const client = await mod.GnomonClient.connect({
      socketPath: p.socketPath,
      ...(p.endpointPath ? { endpointPath: p.endpointPath } : {}),
      client: { name: CLIENT_NAME, version: o.version, surface: 'voice' },
      kernelKey: p.kernelKey,
      credential: { kind: 'device', principalId: p.principalId, deviceId: p.deviceId, privateKeyPem: p.privateKeyPem },
      ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}),
    });
    return new GnomonKernelLink(client);
  }

  async attachment(): Promise<VoiceAttachment | null> {
    return attachmentFromStatus(await this.client.call('status', {}));
  }
  async append(kind: string, payload: Record<string, unknown>): Promise<{ seq: number }> {
    return (await this.client.call('log.append', { kind, payload })) as { seq: number };
  }
  send(hsid: string, text: string): Promise<unknown> {
    return this.client.call('session.send', { hsid, content: [{ text }] });
  }
  interrupt(hsid: string): Promise<unknown> {
    return this.client.call('session.stop', { hsid, interrupt: true });
  }
  async follow(hsid: string, row: (r: KernelRow) => void, end: (reason: string) => void): Promise<() => void> {
    let live = true;
    await this.client.subscribe({ session: hsid }, {
      row: (r) => {
        const x = r as Partial<KernelRow>;
        if (live && typeof x.kind === 'string') row({ seq: Number(x.seq ?? 0), kind: x.kind, ...(typeof x.session === 'string' ? { session: x.session } : {}), payload: (x.payload ?? {}) as Record<string, unknown> });
      },
      end: (e) => {
        if (live) end(e.reason);
      },
    });
    // no cancel verb exists (§4.9): a subscription ends with its connection or the kernel's attachment change
    return () => {
      live = false;
    };
  }
  close(): Promise<void> {
    return this.client.close();
  }
}
